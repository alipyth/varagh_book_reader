"""Three providers behind one function: Ollama (local), OpenAI-compatible endpoints, and cli2api."""
from __future__ import annotations

import atexit
import json
import os
import re
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx

from . import db


class LLMError(Exception):
    pass


class BudgetError(LLMError):
    pass


_THINK = re.compile(r"<think>.*?</think>", re.S)


def _clean(text: str) -> str:
    return _THINK.sub("", text or "").strip()


def chat(provider: str, model: str, system: str, user: str, *, settings: dict, task: str,
         json_mode: bool = False, num_ctx: int | None = None) -> str:
    if not model:
        raise LLMError(f"برای «{task}» مدلی انتخاب نشده. از صفحه‌ی تنظیمات یک مدل انتخاب کن.")
    if provider == "ollama":
        return _ollama(model, system, user, settings["ollama"], task, json_mode, num_ctx)
    if provider == "openai":
        return _openai(model, system, user, settings["openai"], task, json_mode)
    if provider == "cli2api":
        return _cli2api(model, system, user, settings["cli2api"], task, json_mode)
    raise LLMError(f"ارائه‌دهنده‌ی ناشناخته: {provider}")


# ---------------------------------------------------------------- Ollama
def _ollama(model, system, user, cfg, task, json_mode, num_ctx):
    body = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "stream": False,
        "keep_alive": cfg.get("keep_alive", "30m"),
        "options": {
            "num_ctx": int(num_ctx or cfg.get("num_ctx", 4096)),
            "temperature": float(cfg.get("temperature", 0.2)),
        },
    }
    if json_mode:
        body["format"] = "json"
    url = cfg["base_url"].rstrip("/") + "/api/chat"
    try:
        r = httpx.post(url, json=body, timeout=float(cfg.get("timeout", 900)))
    except httpx.HTTPError as e:
        raise LLMError(f"Ollama در دسترس نیست ({cfg['base_url']}). مطمئن شو اجرا شده. جزئیات: {e}") from e
    if r.status_code != 200:
        raise LLMError(f"خطای Ollama ({r.status_code}): {r.text[:300]}")
    data = r.json()
    db.record_usage("ollama", model, task, data.get("prompt_eval_count", 0), data.get("eval_count", 0))
    return _clean(data.get("message", {}).get("content", ""))


# ---------------------------------------------------------------- OpenAI-compatible
def _oa_headers(cfg: dict) -> dict:
    if cfg.get("auth") == "api-key":
        return {"api-key": cfg["api_key"]}
    return {"Authorization": f"Bearer {cfg['api_key']}"}


def _oa_url(cfg: dict, path: str) -> str:
    url = cfg["base_url"].rstrip("/") + path
    if cfg.get("api_version"):
        url += ("&" if "?" in url else "?") + "api-version=" + cfg["api_version"]
    return url


def _openai(model, system, user, cfg, task, json_mode):
    if not cfg.get("api_key"):
        raise LLMError("کلید API برای OpenAI وارد نشده. از صفحه‌ی تنظیمات واردش کن.")
    url = _oa_url(cfg, "/chat/completions")
    headers = _oa_headers(cfg)
    body = {"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
    if cfg.get("send_temperature"):
        body["temperature"] = float(cfg.get("temperature", 0.3))
    if json_mode and cfg.get("json_mode", True):
        body["response_format"] = {"type": "json_object"}

    timeout = float(cfg.get("timeout", 180))
    for attempt in range(3):
        try:
            r = httpx.post(url, json=body, headers=headers, timeout=timeout)
        except httpx.HTTPError as e:
            raise LLMError(f"اتصال به OpenAI برقرار نشد ({cfg['base_url']}): {e}") from e
        if r.status_code == 400 and attempt < 2:
            msg = r.text.lower()
            # some models/endpoints reject these parameters; retry without them
            if "response_format" in msg and "response_format" in body:
                body.pop("response_format"); continue
            if "temperature" in msg and "temperature" in body:
                body.pop("temperature"); continue
        break
    if r.status_code == 401:
        raise LLMError("کلید API برای OpenAI معتبر نیست (401).")
    if r.status_code == 429:
        raise LLMError("OpenAI محدودیت نرخ یا اعتبار داد (429). کمی بعد دوباره امتحان کن.")
    if r.status_code != 200:
        raise LLMError(f"خطای OpenAI ({r.status_code}): {r.text[:300]}")
    data = r.json()
    u = data.get("usage") or {}
    db.record_usage("openai", model, task, u.get("prompt_tokens", 0), u.get("completion_tokens", 0))
    try:
        return _clean(data["choices"][0]["message"]["content"])
    except (KeyError, IndexError, TypeError):
        raise LLMError(f"پاسخ نامعتبر از OpenAI: {str(data)[:300]}")


# ---------------------------------------------------------------- cli2api
_cli2api_lock = threading.Lock()
_cli2api_proc: subprocess.Popen | None = None


def _stop_cli2api() -> None:
    global _cli2api_proc
    proc = _cli2api_proc
    _cli2api_proc = None
    if proc and proc.poll() is None:
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass


atexit.register(_stop_cli2api)


def _cli2api_headers(cfg: dict) -> dict:
    key = (cfg.get("api_key") or "").strip()
    return {"Authorization": f"Bearer {key}"} if key else {}


def _cli2api_base(cfg: dict) -> str:
    return (cfg.get("base_url") or "http://127.0.0.1:8787").rstrip("/")


def _cli2api_err_msg(resp: httpx.Response, fallback_prefix: str = "خطای CLI2API") -> str:
    try:
        raw = resp.read() if not hasattr(resp, "_content") or resp._content is None else resp.content
        d = json.loads(raw.decode("utf-8", "ignore"))
        msg = (d.get("error") or {}).get("message") or d.get("detail")
        if msg:
            return f"{fallback_prefix} ({resp.status_code}): {msg}"
    except Exception:
        pass
    try:
        txt = resp.text[:300]
    except Exception:
        txt = ""
    return f"{fallback_prefix} ({resp.status_code}): {txt}"


def _ensure_cli2api(cfg: dict) -> None:
    """If cli2api is configured on localhost and auto_start is enabled, launch it when not running."""
    global _cli2api_proc
    base = _cli2api_base(cfg)
    try:
        r = httpx.get(base + "/health", timeout=1.5)
        if r.status_code == 200:
            return
    except httpx.HTTPError:
        pass

    if not cfg.get("auto_start", True):
        return
    parsed = urlparse(base)
    if (parsed.hostname or "") not in ("127.0.0.1", "localhost"):
        return
    from .config import ROOT
    raw_dir = (cfg.get("cli_to_api_dir") or "").strip()
    bundled = ROOT / "cli_to_api"
    cdir = Path(raw_dir) if raw_dir and (Path(raw_dir) / "cli2api").is_dir() else bundled
    if not (cdir / "cli2api").is_dir():
        return

    with _cli2api_lock:
        try:
            r = httpx.get(base + "/health", timeout=1.5)
            if r.status_code == 200:
                return
        except httpx.HTTPError:
            pass

        # Pick python interpreter: prefer cli_to_api's own .venv if present, else current sys.executable
        py_cand = cdir / ".venv" / ("Scripts" if os.name == "nt" else "bin") / ("python.exe" if os.name == "nt" else "python")
        py = str(py_cand) if py_cand.is_file() else sys.executable
        host = parsed.hostname or "127.0.0.1"
        port = str(parsed.port or 8787)
        env = dict(os.environ)
        prev_pp = env.get("PYTHONPATH", "")
        env["PYTHONPATH"] = f"{cdir}{os.pathsep}{prev_pp}" if prev_pp else str(cdir)
        env["CLI2API_DEFAULT_PROVIDER"] = cfg.get("default_cli") or "agy"
        kw: dict = {"cwd": str(cdir), "env": env, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL}
        if os.name == "nt":
            kw["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            _cli2api_proc = subprocess.Popen(
                [py, "-m", "uvicorn", "cli2api.server:create_app", "--factory", "--host", host, "--port", port, "--log-level", "warning"],
                **kw,
            )
        except OSError:
            return

        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline:
            if _cli2api_proc.poll() is not None:
                break
            try:
                r = httpx.get(base + "/health", timeout=1.0)
                if r.status_code == 200:
                    return
            except httpx.HTTPError:
                pass
            time.sleep(0.25)


def _cli2api(model, system, user, cfg, task, json_mode):
    _ensure_cli2api(cfg)
    base = _cli2api_base(cfg)
    url = base + "/v1/chat/completions"
    headers = _cli2api_headers(cfg)
    body: dict = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "stream": False,
    }
    if json_mode and cfg.get("json_mode", True):
        body["response_format"] = {"type": "json_object"}
    timeout = float(cfg.get("timeout", 300))
    try:
        r = httpx.post(url, json=body, headers=headers, timeout=timeout)
    except httpx.HTTPError as e:
        raise LLMError(f"CLI2API در دسترس نیست ({base}). مطمئن شو اجرا شده یا مسیرش در تنظیمات درست است. جزئیات: {e}") from e
    if r.status_code == 401:
        raise LLMError("کلید API برای CLI2API معتبر نیست (401).")
    if r.status_code != 200:
        raise LLMError(_cli2api_err_msg(r))
    data = r.json()
    u = data.get("usage") or {}
    db.record_usage("cli2api", model, task, u.get("prompt_tokens", 0), u.get("completion_tokens", 0))
    try:
        return _clean(data["choices"][0]["message"]["content"])
    except (KeyError, IndexError, TypeError):
        raise LLMError(f"پاسخ نامعتبر از CLI2API: {str(data)[:300]}")


# ---------------------------------------------------------------- streaming
class _ThinkFilter:
    """Hide a leading <think>…</think> block from reasoning models while streaming."""

    def __init__(self):
        self.buf, self.mode = "", "start"  # start | think | pass

    def feed(self, s: str) -> str:
        if self.mode == "pass":
            return s
        self.buf += s
        if self.mode == "start":
            t = self.buf.lstrip()
            if not t:
                return ""
            if "<think>".startswith(t[:7]) and len(t) < 7:
                return ""                      # could still become <think>
            if t.startswith("<think>"):
                self.mode = "think"
            else:
                self.mode, out, self.buf = "pass", self.buf, ""
                return out
        if self.mode == "think" and "</think>" in self.buf:
            out = self.buf.split("</think>", 1)[1].lstrip()
            self.mode, self.buf = "pass", ""
            return out
        return ""


def open_stream(provider: str, model: str, system: str, user: str, *, settings: dict, task: str,
                num_ctx: int | None = None):
    """Connect eagerly (so connection/auth errors raise here), then return a generator of text deltas."""
    if not model:
        raise LLMError(f"برای «{task}» مدلی انتخاب نشده. از صفحه‌ی تنظیمات یک مدل انتخاب کن.")
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    client = httpx.Client(timeout=httpx.Timeout(connect=10, read=None, write=30, pool=10))

    if provider == "ollama":
        cfg = settings["ollama"]
        body = {"model": model, "messages": messages, "stream": True, "keep_alive": cfg.get("keep_alive", "30m"),
                "options": {"num_ctx": int(num_ctx or cfg.get("num_ctx", 4096)), "temperature": float(cfg.get("temperature", 0.2))}}
        try:
            resp = client.send(client.build_request("POST", cfg["base_url"].rstrip("/") + "/api/chat", json=body), stream=True)
        except httpx.HTTPError as e:
            client.close()
            raise LLMError(f"Ollama در دسترس نیست ({cfg['base_url']}). مطمئن شو اجرا شده. جزئیات: {e}") from e
        if resp.status_code != 200:
            txt = resp.read().decode("utf-8", "ignore"); client.close()
            if "not found" in txt.lower():
                raise LLMError(f"مدل «{model}» روی Ollama نصب نیست. با دستور ollama pull {model} نصبش کن.")
            raise LLMError(f"خطای Ollama ({resp.status_code}): {txt[:300]}")

        def gen():
            flt, pin, pout = _ThinkFilter(), 0, 0
            try:
                for line in resp.iter_lines():
                    if not line:
                        continue
                    d = json.loads(line)
                    if d.get("error"):
                        raise LLMError("خطای Ollama: " + d["error"])
                    out = flt.feed(d.get("message", {}).get("content", ""))
                    if out:
                        yield out
                    if d.get("done"):
                        pin, pout = d.get("prompt_eval_count", 0), d.get("eval_count", 0)
            finally:
                resp.close(); client.close()
                db.record_usage("ollama", model, task, pin, pout)
        return gen()

    if provider == "openai":
        cfg = settings["openai"]
        if not cfg.get("api_key"):
            client.close()
            raise LLMError("کلید API برای OpenAI وارد نشده. از صفحه‌ی تنظیمات واردش کن.")
        body = {"model": model, "messages": messages, "stream": True, "stream_options": {"include_usage": True}}
        if cfg.get("send_temperature"):
            body["temperature"] = float(cfg.get("temperature", 0.3))
        for attempt in range(3):
            try:
                resp = client.send(client.build_request("POST", _oa_url(cfg, "/chat/completions"), json=body,
                                                        headers=_oa_headers(cfg)), stream=True)
            except httpx.HTTPError as e:
                client.close()
                raise LLMError(f"اتصال به OpenAI برقرار نشد ({cfg['base_url']}): {e}") from e
            if resp.status_code == 400 and attempt < 2:
                msg = resp.read().decode("utf-8", "ignore").lower(); resp.close()
                if "stream_options" in msg and "stream_options" in body:
                    body.pop("stream_options"); continue
                if "temperature" in msg and "temperature" in body:
                    body.pop("temperature"); continue
                client.close()
                raise LLMError(f"خطای OpenAI (400): {msg[:300]}")
            break
        if resp.status_code != 200:
            txt = resp.read().decode("utf-8", "ignore"); client.close()
            if resp.status_code == 401:
                raise LLMError("کلید API برای OpenAI معتبر نیست (401).")
            if resp.status_code == 429:
                raise LLMError("OpenAI محدودیت نرخ یا اعتبار داد (429). کمی بعد دوباره امتحان کن.")
            raise LLMError(f"خطای OpenAI ({resp.status_code}): {txt[:300]}")

        def gen():
            flt, usage, chars = _ThinkFilter(), None, 0
            try:
                for line in resp.iter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    d = json.loads(data)
                    if d.get("usage"):
                        usage = d["usage"]
                    for ch in d.get("choices") or []:
                        delta = (ch.get("delta") or {}).get("content") or ""
                        out = flt.feed(delta)
                        if out:
                            chars += len(out)
                            yield out
            finally:
                resp.close(); client.close()
                if usage:
                    db.record_usage("openai", model, task, usage.get("prompt_tokens", 0), usage.get("completion_tokens", 0))
                else:  # endpoint gave no usage: rough estimate so the budget still moves
                    db.record_usage("openai", model, task, (len(system) + len(user)) // 4, chars // 2)
        return gen()

    if provider == "cli2api":
        cfg = settings["cli2api"]
        _ensure_cli2api(cfg)
        base = _cli2api_base(cfg)
        body = {"model": model, "messages": messages, "stream": True}
        try:
            resp = client.send(
                client.build_request("POST", base + "/v1/chat/completions", json=body, headers=_cli2api_headers(cfg)),
                stream=True,
            )
        except httpx.HTTPError as e:
            client.close()
            raise LLMError(f"CLI2API در دسترس نیست ({base}). مطمئن شو اجرا شده یا مسیرش در تنظیمات درست است. جزئیات: {e}") from e
        if resp.status_code != 200:
            err = _cli2api_err_msg(resp)
            resp.close(); client.close()
            if resp.status_code == 401:
                raise LLMError("کلید API برای CLI2API معتبر نیست (401).")
            raise LLMError(err)

        def gen():
            flt, chars = _ThinkFilter(), 0
            try:
                for line in resp.iter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    d = json.loads(data)
                    if d.get("error"):
                        msg = d["error"].get("message") if isinstance(d["error"], dict) else str(d["error"])
                        raise LLMError(f"خطای CLI2API: {msg}")
                    for ch in d.get("choices") or []:
                        delta = (ch.get("delta") or {}).get("content") or ""
                        out = flt.feed(delta)
                        if out:
                            chars += len(out)
                            yield out
            finally:
                resp.close(); client.close()
                db.record_usage("cli2api", model, task, (len(system) + len(user)) // 4, chars // 2)
        return gen()

    client.close()
    raise LLMError(f"ارائه‌دهنده‌ی ناشناخته: {provider}")


def warmup(settings: dict, model: str) -> None:
    """Load an Ollama model into memory so the first translation starts fast."""
    cfg = settings["ollama"]
    try:
        httpx.post(cfg["base_url"].rstrip("/") + "/api/generate",
                   json={"model": model, "keep_alive": cfg.get("keep_alive", "30m")}, timeout=120)
    except httpx.HTTPError:
        pass


# ---------------------------------------------------------------- model lists
def list_models(provider: str, settings: dict) -> list[str]:
    try:
        if provider == "ollama":
            cfg = settings["ollama"]
            r = httpx.get(cfg["base_url"].rstrip("/") + "/api/tags", timeout=10)
            r.raise_for_status()
            return sorted(m["name"] for m in r.json().get("models", []))
        if provider == "openai":
            cfg = settings["openai"]
            if not cfg.get("api_key"):
                raise LLMError("اول کلید API را وارد و ذخیره کن.")
            r = httpx.get(_oa_url(cfg, "/models"), headers=_oa_headers(cfg), timeout=20)
            if r.status_code == 401:
                raise LLMError("کلید API معتبر نیست (401).")
            r.raise_for_status()
            return sorted(m["id"] for m in r.json().get("data", []))
        if provider == "cli2api":
            cat = list_cli2api_catalog(settings)
            return cat["all_models"]
    except LLMError:
        raise
    except Exception as e:  # noqa: BLE001
        raise LLMError(f"فهرست مدل‌ها دریافت نشد: {e}") from e
    raise LLMError("ارائه‌دهنده‌ی ناشناخته")


def list_cli2api_catalog(settings: dict, *, refresh: bool = False) -> dict:
    """Fetch installed CLIs and their selectable sub-models from cli2api."""
    cfg = settings["cli2api"]
    _ensure_cli2api(cfg)
    base = _cli2api_base(cfg)
    headers = _cli2api_headers(cfg)
    try:
        with httpx.Client(timeout=25) as client:
            rp = client.get(base + "/v1/providers", headers=headers)
            if rp.status_code == 401:
                raise LLMError("کلید API برای CLI2API معتبر نیست (401).")
            rp.raise_for_status()
            raw_providers = rp.json().get("data", [])

            rm = client.get(base + "/v1/models", headers=headers)
            rm.raise_for_status()
            raw_models = rm.json().get("data", [])

            # If refresh requested for agy or any installed cli, hit /v1/providers/{pid}/models?refresh=true
            if refresh:
                refreshed: list[dict] = []
                for p in raw_providers:
                    if p.get("type") == "cli" and not p.get("installed"):
                        continue
                    rsub = client.get(f"{base}/v1/providers/{p['id']}/models?refresh=true", headers=headers)
                    if rsub.status_code == 200:
                        refreshed.extend(rsub.json().get("data", []))
                if refreshed:
                    raw_models = refreshed
    except LLMError:
        raise
    except Exception as e:  # noqa: BLE001
        raise LLMError(f"اتصال به CLI2API ({base}) برقرار نشد: {e}") from e

    default_cli = cfg.get("default_cli") or "agy"
    installed = [p for p in raw_providers if p.get("type") != "cli" or p.get("installed")]
    # Put default_cli (agy) first
    installed.sort(key=lambda p: (0 if p["id"] == default_cli else 1, p["id"]))

    models_by_provider: dict[str, list[dict]] = {p["id"]: [] for p in installed}
    seen_per_prov: dict[str, set[str]] = {p["id"]: set() for p in installed}

    for m in raw_models:
        mid = m.get("id") or ""
        if not mid:
            continue
        pid = m.get("provider") or (mid.split("/", 1)[0] if "/" in mid else mid)
        sub = m.get("submodel") if "submodel" in m else (mid.split("/", 1)[1] if "/" in mid else "")
        if pid not in models_by_provider:
            continue
        if not sub:
            continue
        if mid in seen_per_prov[pid]:
            continue
        seen_per_prov[pid].add(mid)
        models_by_provider[pid].append({"id": mid, "submodel": sub, "label": m.get("label") or sub})

    all_models: list[str] = []
    for p in installed:
        pid = p["id"]
        if models_by_provider[pid]:
            all_models.extend(x["id"] for x in models_by_provider[pid])
        else:
            all_models.append(pid)

    return {
        "base_url": base,
        "default_cli": default_cli,
        "providers": [
            {
                "id": p["id"],
                "label": p.get("label") or p["id"],
                "type": p.get("type", "cli"),
                "installed": p.get("installed", True),
                "supports_model_selection": p.get("supports_model_selection", True),
            }
            for p in installed
        ],
        "models_by_provider": models_by_provider,
        "all_models": all_models,
    }


def parse_json(text: str):
    """Parse JSON even if the model wrapped it in prose or code fences."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?|```$", "", text, flags=re.M).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    for open_c, close_c in (("{", "}"), ("[", "]")):
        s, e = text.find(open_c), text.rfind(close_c)
        if s != -1 and e > s:
            try:
                return json.loads(text[s : e + 1])
            except json.JSONDecodeError:
                continue
    raise LLMError("خروجی مدل JSON معتبر نبود.")
