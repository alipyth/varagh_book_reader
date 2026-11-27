"""Provider registry, detection and dispatch (CLI / Ollama HTTP / OpenAI-compatible upstream)."""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import time
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple

import httpx

from .config import Provider, Settings
from .json_repair import JSON_INSTRUCTION
from .runner import CLIError, build_invocation, stream_process, validate_model, which


class Gateway:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.workdir = str(settings.resolved_workdir())
        self._sem = asyncio.Semaphore(max(1, settings.max_concurrency))
        self._model_cache: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}

    # ------------------------------------------------------------------ discovery
    def detect(self) -> List[Dict[str, Any]]:
        out = []
        for p in self.settings.providers.values():
            path = which(p.binary) if p.type == "cli" else None
            out.append(
                {
                    "id": p.id,
                    "type": p.type,
                    "label": p.label or p.id,
                    "description": p.description,
                    "installed": bool(path) if p.type == "cli" else None,
                    "path": path or "",
                    "command": p.command,
                    "prompt_mode": p.prompt_mode if p.type == "cli" else None,
                    "base_url": p.base_url or None,
                    "supports_model_selection": bool(p.model_args or any("{model}" in c for c in p.command)) or p.type != "cli",
                }
            )
        return out

    def available(self) -> List[Provider]:
        return [p for p in self.settings.providers.values() if p.type != "cli" or which(p.binary)]

    async def ollama_models(self, provider: Provider) -> List[str]:
        base = (provider.base_url or "http://localhost:11434").rstrip("/")
        try:
            async with httpx.AsyncClient(timeout=2.5) as client:
                resp = await client.get(f"{base}/api/tags")
                resp.raise_for_status()
                return [m.get("name", "") for m in resp.json().get("models", []) if m.get("name")]
        except Exception:
            return []

    async def _openai_models(self, provider: Provider) -> List[str]:
        if not provider.base_url:
            return []
        headers = {"Authorization": f"Bearer {provider.api_key}"} if provider.api_key else {}
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                resp = await client.get(f"{provider.base_url.rstrip('/')}/models", headers=headers)
                resp.raise_for_status()
                return [m.get("id", "") for m in resp.json().get("data", []) if m.get("id")]
        except Exception:
            return []

    def _discover_agy_models_sync(self, binary: str) -> List[Dict[str, Any]]:
        exe = which(binary)
        if not exe:
            return []
        kw: Dict[str, Any] = {}
        if os.name == "nt":
            kw["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            res = subprocess.run(
                [exe, "models"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=15,
                **kw,
            )
        except Exception:
            return []
        if res.returncode != 0:
            return []
        raw: List[Tuple[str, str]] = []
        for line in res.stdout.splitlines():
            line = line.strip()
            if not line or line.lower().startswith("fetching"):
                continue
            if "\t" in line:
                mid, _, label = line.partition("\t")
            else:
                parts = line.split(None, 1)
                mid = parts[0]
                label = parts[1] if len(parts) > 1 else mid
            mid = mid.strip()
            label = label.strip() or mid
            if mid and not mid.startswith("-") and " " not in mid:
                raw.append((mid, label))
        # Prioritize all -low models first, then models without effort suffix, then remaining variants.
        low = [x for x in raw if x[0].endswith("-low")]
        other_no_effort = [x for x in raw if not any(x[0].endswith(s) for s in ("-low", "-medium", "-high", "-xhigh"))]
        rest = [x for x in raw if x not in low and x not in other_no_effort]
        ordered = low + other_no_effort + rest
        return [
            {
                "id": f"agy/{mid}",
                "provider": "agy",
                "submodel": mid,
                "label": label,
                "owned_by": "local-cli",
            }
            for mid, label in ordered
        ]

    async def provider_models(self, provider: Provider, *, refresh: bool = False) -> List[Dict[str, Any]]:
        now = time.monotonic()
        cached = self._model_cache.get(provider.id)
        if not refresh and cached and (now - cached[0]) < 60.0:
            return list(cached[1])

        items: List[Dict[str, Any]] = []
        if provider.type == "ollama" or provider.id == "ollama-cli":
            names = await self.ollama_models(provider)
            items = [
                {"id": f"{provider.id}/{n}", "provider": provider.id, "submodel": n, "label": n, "owned_by": "ollama"}
                for n in names
            ]
        elif provider.type == "openai":
            names = await self._openai_models(provider)
            items = [
                {"id": f"{provider.id}/{n}", "provider": provider.id, "submodel": n, "label": n, "owned_by": "openai"}
                for n in names
            ]
        elif provider.id == "agy" and which(provider.binary):
            items = await asyncio.to_thread(self._discover_agy_models_sync, provider.binary)
            if items and provider.models:
                seen = {x["submodel"] for x in items}
                for m in provider.models:
                    if m not in seen:
                        items.append({"id": f"agy/{m}", "provider": "agy", "submodel": m, "label": m, "owned_by": "local-cli"})
        else:
            for m in provider.models:
                items.append(
                    {"id": f"{provider.id}/{m}", "provider": provider.id, "submodel": m, "label": m, "owned_by": "local-cli"}
                )

        self._model_cache[provider.id] = (now, items)
        return list(items)

    async def list_models(self) -> List[Dict[str, Any]]:
        models: List[Dict[str, Any]] = []
        seen: set[str] = set()
        for p in self.available():
            if p.type == "ollama":
                sub = await self.provider_models(p)
                for m in sub:
                    if m["id"] not in seen:
                        seen.add(m["id"])
                        models.append(m)
                continue
            if p.id not in seen:
                seen.add(p.id)
                models.append(
                    {
                        "id": p.id,
                        "provider": p.id,
                        "submodel": "",
                        "owned_by": p.type if p.type != "cli" else "local-cli",
                        "label": p.label or p.id,
                    }
                )
            for m in await self.provider_models(p):
                if m["id"] not in seen:
                    seen.add(m["id"])
                    models.append(m)
        for a, t in self.settings.aliases.items():
            if a not in seen:
                seen.add(a)
                models.append({"id": a, "owned_by": "alias", "label": f"alias of {t}"})
        return models

    # ------------------------------------------------------------------ routing
    def resolve(self, model: Optional[str]) -> Tuple[Provider, str]:
        name = (model or "").strip() or self.settings.default_provider
        name = self.settings.aliases.get(name, name)
        if not name:
            avail = [p for p in self.available() if p.type == "cli"]
            if not avail:
                raise CLIError("no provider available: install a CLI or set a default provider", status=503)
            return avail[0], ""
        pid, _, sub = name.partition("/")
        provider = self.settings.providers.get(pid)
        if provider is None:
            raise CLIError(f"unknown model/provider '{pid}'. See GET /v1/models", status=404)
        return provider, sub

    # ------------------------------------------------------------------ execution
    async def stream(
        self,
        model: Optional[str],
        prompt: str,
        *,
        json_mode: bool = False,
        timeout: Optional[float] = None,
        params: Optional[Dict[str, Any]] = None,
    ) -> AsyncIterator[str]:
        provider, sub = self.resolve(model)
        if json_mode:
            prompt = prompt + JSON_INSTRUCTION
        async with self._sem:
            if provider.type == "cli":
                inv = build_invocation(provider, prompt, sub, cwd=self.workdir, timeout=timeout or self.settings.timeout)
                async for chunk in stream_process(inv, strip_ansi=provider.strip_ansi):
                    yield chunk
            elif provider.type == "ollama":
                async for chunk in self._stream_ollama(provider, sub, prompt, json_mode, timeout, params or {}):
                    yield chunk
            else:
                async for chunk in self._stream_openai(provider, sub, prompt, json_mode, timeout, params or {}):
                    yield chunk

    async def complete(self, model: Optional[str], prompt: str, **kw: Any) -> str:
        return "".join([c async for c in self.stream(model, prompt, **kw)]).strip()

    # ------------------------------------------------------------------ http backends
    async def _stream_ollama(
        self, p: Provider, sub: str, prompt: str, json_mode: bool, timeout: Optional[float], params: Dict[str, Any]
    ) -> AsyncIterator[str]:
        model = validate_model(sub) if sub else p.default_model
        if not model:
            names = await self.ollama_models(p)
            if not names:
                raise CLIError("Ollama is unreachable or has no models (try `ollama pull llama3.1`)", status=503)
            model = names[0]
        payload: Dict[str, Any] = {"model": model, "messages": [{"role": "user", "content": prompt}], "stream": True}
        if json_mode:
            payload["format"] = "json"
        if "temperature" in params:
            payload["options"] = {"temperature": params["temperature"]}
        url = f"{p.base_url.rstrip('/')}/api/chat"
        try:
            async with httpx.AsyncClient(timeout=timeout or self.settings.timeout) as client:
                async with client.stream("POST", url, json=payload) as resp:
                    if resp.status_code >= 400:
                        body = (await resp.aread()).decode("utf-8", "replace")
                        raise CLIError(f"ollama error {resp.status_code}: {body[:500]}", status=502)
                    async for line in resp.aiter_lines():
                        if not line.strip():
                            continue
                        data = json.loads(line)
                        if data.get("error"):
                            raise CLIError(f"ollama: {data['error']}", status=502)
                        text = (data.get("message") or {}).get("content", "")
                        if text:
                            yield text
        except httpx.HTTPError as exc:
            raise CLIError(f"cannot reach Ollama at {p.base_url}: {exc}", status=503) from exc

    async def _stream_openai(
        self, p: Provider, sub: str, prompt: str, json_mode: bool, timeout: Optional[float], params: Dict[str, Any]
    ) -> AsyncIterator[str]:
        model = sub or p.default_model
        if not model:
            raise CLIError(f"provider '{p.id}' needs a model, e.g. '{p.id}/gpt-4o-mini'", status=400)
        payload: Dict[str, Any] = {"model": model, "messages": [{"role": "user", "content": prompt}], "stream": True}
        payload.update({k: v for k, v in params.items() if k in ("temperature", "top_p", "max_tokens", "stop", "seed")})
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        headers = {"Authorization": f"Bearer {p.api_key}"} if p.api_key else {}
        url = f"{p.base_url.rstrip('/')}/chat/completions"
        try:
            async with httpx.AsyncClient(timeout=timeout or self.settings.timeout) as client:
                async with client.stream("POST", url, json=payload, headers=headers) as resp:
                    if resp.status_code >= 400:
                        body = (await resp.aread()).decode("utf-8", "replace")
                        raise CLIError(f"upstream error {resp.status_code}: {body[:500]}", status=502)
                    async for line in resp.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            break
                        choice = (json.loads(data).get("choices") or [{}])[0]
                        text = (choice.get("delta") or {}).get("content") or ""
                        if text:
                            yield text
        except httpx.HTTPError as exc:
            raise CLIError(f"cannot reach upstream {p.base_url}: {exc}", status=503) from exc
