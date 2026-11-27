"""FastAPI application exposing an OpenAI-compatible API in front of local CLIs."""

from __future__ import annotations

import hmac
import json
import time
import uuid
from importlib import resources
from typing import Any, AsyncIterator, Dict, List, Optional, Union

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from . import __version__
from .config import Settings, load_settings
from .gateway import Gateway
from .json_repair import extract_json
from .prompt import messages_to_prompt
from .runner import CLIError


# ---------------------------------------------------------------------- schemas
class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="allow")
    role: str = "user"
    content: Union[str, List[Any], None] = None


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    model: Optional[str] = None
    messages: List[ChatMessage]
    stream: bool = False
    response_format: Optional[Dict[str, Any]] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    timeout: Optional[float] = Field(default=None, description="cli2api extension: per-request timeout (s)")


class RunRequest(BaseModel):
    prompt: str = Field(min_length=1)
    model: Optional[str] = Field(default=None, description="provider id, optionally with /submodel")
    json_output: bool = Field(default=False, alias="json")
    timeout: Optional[float] = None
    model_config = ConfigDict(populate_by_name=True)


def _estimate_tokens(text: str) -> int:
    return max(1, len(text) // 4) if text else 0


def _error(status: int, message: str, etype: str = "cli2api_error") -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"message": message, "type": etype, "code": status}})


# ---------------------------------------------------------------------- app
def create_app(settings: Optional[Settings] = None) -> FastAPI:
    settings = settings or load_settings()
    gateway = Gateway(settings)

    app = FastAPI(
        title="cli2api",
        version=__version__,
        description="Turn local AI CLIs (Claude Code, Gemini, Codex, Ollama, ...) into an OpenAI-compatible API.",
    )
    app.state.settings = settings
    app.state.gateway = gateway

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    async def require_key(request: Request) -> None:
        keys = settings.all_api_keys()
        if not keys:
            return
        auth = request.headers.get("authorization", "")
        token = auth[7:].strip() if auth.lower().startswith("bearer ") else request.headers.get("x-api-key", "")
        if not any(hmac.compare_digest(token.encode(), k.encode()) for k in keys):
            raise HTTPException(status_code=401, detail="invalid or missing API key")

    @app.exception_handler(CLIError)
    async def _cli_error(_: Request, exc: CLIError) -> JSONResponse:
        return _error(exc.status, str(exc))

    @app.exception_handler(HTTPException)
    async def _http_error(_: Request, exc: HTTPException) -> JSONResponse:
        return _error(exc.status_code, str(exc.detail), "invalid_request_error")

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = (exc.errors() or [{}])[0]
        where = ".".join(str(p) for p in first.get("loc", ()) if p != "body")
        return _error(422, f"{where}: {first.get('msg', 'invalid request')}".strip(": "), "invalid_request_error")

    # -------------------------------------------------------------- meta
    @app.get("/", response_class=HTMLResponse, include_in_schema=False)
    async def playground() -> str:
        return resources.files("cli2api").joinpath("static/playground.html").read_text(encoding="utf-8")

    @app.get("/health")
    async def health() -> Dict[str, Any]:
        return {"status": "ok", "version": __version__, "providers": [p.id for p in gateway.available()]}

    @app.get("/v1/providers", dependencies=[Depends(require_key)])
    async def providers() -> Dict[str, Any]:
        return {"object": "list", "data": gateway.detect()}

    @app.get("/v1/providers/{pid}/models", dependencies=[Depends(require_key)])
    async def provider_models(pid: str, refresh: bool = False) -> Dict[str, Any]:
        provider = settings.providers.get(pid)
        if provider is None:
            raise HTTPException(status_code=404, detail=f"unknown provider '{pid}'")
        data = await gateway.provider_models(provider, refresh=refresh)
        return {"object": "list", "provider": pid, "data": data}

    @app.get("/v1/models", dependencies=[Depends(require_key)])
    async def models() -> Dict[str, Any]:
        now = int(time.time())
        data = [{"object": "model", "created": now, **m} for m in await gateway.list_models()]
        return {"object": "list", "data": data}

    # -------------------------------------------------------------- simple endpoint
    @app.post("/v1/run", dependencies=[Depends(require_key)])
    async def run(req: RunRequest) -> Dict[str, Any]:
        provider, _ = gateway.resolve(req.model)
        started = time.perf_counter()
        output = await gateway.complete(req.model, req.prompt, json_mode=req.json_output, timeout=req.timeout)
        result: Dict[str, Any] = {
            "model": req.model or provider.id,
            "output": output,
            "duration_ms": int((time.perf_counter() - started) * 1000),
        }
        if req.json_output:
            try:
                result["json"] = extract_json(output)
            except ValueError:
                raise CLIError("model did not return valid JSON. Raw output: " + output[:1500], status=502)
        return result

    # -------------------------------------------------------------- OpenAI compatible
    @app.post("/v1/chat/completions", dependencies=[Depends(require_key)])
    async def chat_completions(req: ChatRequest):
        try:
            prompt = messages_to_prompt([m.model_dump() for m in req.messages])
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

        provider, sub = gateway.resolve(req.model)
        model_name = req.model or provider.id
        json_mode = bool(req.response_format and req.response_format.get("type") in ("json_object", "json_schema"))
        if json_mode and req.response_format.get("type") == "json_schema":
            schema = (req.response_format.get("json_schema") or {}).get("schema")
            if schema:
                prompt += "\n\nThe JSON must conform to this JSON Schema:\n" + json.dumps(schema, ensure_ascii=False)
        params = {k: v for k, v in (("temperature", req.temperature), ("max_tokens", req.max_tokens)) if v is not None}
        cid = f"chatcmpl-{uuid.uuid4().hex[:24]}"
        created = int(time.time())

        def finalize(text: str) -> str:
            if not json_mode:
                return text
            try:
                return json.dumps(extract_json(text), ensure_ascii=False)
            except ValueError:
                raise CLIError("model did not return valid JSON. Raw output: " + text[:1500], status=502)

        if not req.stream:
            text = finalize(await gateway.complete(req.model, prompt, json_mode=json_mode, timeout=req.timeout, params=params))
            return {
                "id": cid,
                "object": "chat.completion",
                "created": created,
                "model": model_name,
                "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}],
                "usage": {
                    "prompt_tokens": _estimate_tokens(prompt),
                    "completion_tokens": _estimate_tokens(text),
                    "total_tokens": _estimate_tokens(prompt) + _estimate_tokens(text),
                },
            }

        def chunk(delta: Dict[str, Any], finish: Optional[str] = None) -> str:
            body = {
                "id": cid,
                "object": "chat.completion.chunk",
                "created": created,
                "model": model_name,
                "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
            }
            return f"data: {json.dumps(body, ensure_ascii=False)}\n\n"

        # Start the process before returning headers so startup errors become proper HTTP errors.
        gen = gateway.stream(req.model, prompt, json_mode=json_mode, timeout=req.timeout, params=params)
        try:
            first = await gen.__anext__()
        except StopAsyncIteration:
            first = ""

        async def sse() -> AsyncIterator[str]:
            yield chunk({"role": "assistant", "content": ""})
            try:
                if json_mode:  # JSON must be validated as a whole, so buffer it
                    rest = [c async for c in gen]
                    yield chunk({"content": finalize((first + "".join(rest)).strip())})
                else:
                    if first:
                        yield chunk({"content": first})
                    async for piece in gen:
                        yield chunk({"content": piece})
                yield chunk({}, "stop")
            except CLIError as exc:
                yield f"data: {json.dumps({'error': {'message': str(exc), 'code': exc.status}})}\n\n"
            finally:
                await gen.aclose()
            yield "data: [DONE]\n\n"

        return StreamingResponse(sse(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    return app
