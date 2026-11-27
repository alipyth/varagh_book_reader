"""Safely run a CLI provider and stream its stdout.

Design notes
------------
* Never uses ``shell=True``. The prompt is passed either through **stdin**
  (default, no length limit, no quoting issues) or as a single argv element.
* On Windows, npm-installed tools are ``.cmd`` shims that run through
  ``cmd.exe``, which re-parses arguments (``&``, ``|``, ``%`` ...). Putting
  user text into such argv would allow command injection, so for ``.cmd``
  shims we resolve the underlying ``node script.js`` and run it directly;
  if that is impossible, arg mode is refused.
* Uses plain threads + ``subprocess.Popen`` so it works on every asyncio
  event loop (uvicorn on Windows may use the selector loop, which cannot
  spawn asyncio subprocesses).
"""

from __future__ import annotations

import asyncio
import codecs
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator, Dict, List, Optional, Tuple

from .config import Provider

IS_WINDOWS = os.name == "nt"

_ANSI_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07")
_MODEL_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,127}$")
_SHIM_JS_RE = re.compile(r'"%~?dp0%?\\?([^"%]+?\.(?:js|mjs|cjs))"', re.IGNORECASE)


class CLIError(RuntimeError):
    def __init__(self, message: str, status: int = 502, stderr: str = ""):
        super().__init__(message)
        self.status = status
        self.stderr = stderr


def _extra_search_dirs() -> List[str]:
    home = Path.home()
    dirs = [home / ".local" / "bin", home / ".npm-global" / "bin", home / ".bun" / "bin", Path("/usr/local/bin"), Path("/opt/homebrew/bin")]
    if IS_WINDOWS:
        env = os.environ
        for base, sub in (
            ("APPDATA", "npm"),
            ("LOCALAPPDATA", r"Programs\Ollama"),
            ("LOCALAPPDATA", r"agy\bin"),
            ("LOCALAPPDATA", r"Programs\OpenAI\Codex\bin"),
        ):
            if env.get(base):
                dirs.append(Path(env[base]) / sub)
    return [str(d) for d in dirs]


def which(binary: str) -> Optional[str]:
    """Locate an executable on PATH or in common per-user install folders."""
    if not binary:
        return None
    if os.path.isabs(binary) or os.sep in binary or "/" in binary:
        return binary if os.path.isfile(binary) else None
    found = shutil.which(binary)
    if found:
        return found
    exts = [".exe", ".cmd", ".bat", ""] if IS_WINDOWS else [""]
    for d in _extra_search_dirs():
        for ext in exts:
            cand = os.path.join(d, binary + ext)
            if os.path.isfile(cand) and (IS_WINDOWS or os.access(cand, os.X_OK)):
                return cand
    return None


def _resolve_cmd_shim(path: str) -> Optional[List[str]]:
    """Turn an npm ``foo.cmd`` shim into ``[node, /abs/script.js]``."""
    try:
        text = Path(path).read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return None
    match = _SHIM_JS_RE.search(text)
    if not match:
        return None
    script = os.path.normpath(os.path.join(os.path.dirname(path), match.group(1)))
    if not os.path.isfile(script):
        return None
    local_node = os.path.join(os.path.dirname(path), "node.exe")
    node = local_node if os.path.isfile(local_node) else shutil.which("node")
    return [node, script] if node else None


def validate_model(model: str) -> str:
    if not _MODEL_RE.match(model):
        raise CLIError(f"invalid model name: {model!r}", status=400)
    return model


@dataclass
class Invocation:
    argv: List[str]
    stdin: bytes
    cwd: str
    env: Dict[str, str]
    timeout: float


def build_invocation(
    provider: Provider,
    prompt: str,
    model: str = "",
    *,
    cwd: str,
    timeout: float,
) -> Invocation:
    """Expand the provider's command template into a concrete argv."""
    model = validate_model(model) if model else ""
    effective_model = model or provider.default_model

    template = list(provider.command)
    uses_model_placeholder = any("{model}" in t for t in template)
    if uses_model_placeholder and not effective_model:
        raise CLIError(f"provider '{provider.id}' needs a model, e.g. '{provider.id}/<model>'", status=400)
    if model and not uses_model_placeholder:
        if not provider.model_args:
            raise CLIError(f"provider '{provider.id}' does not support selecting a model", status=400)
        template += provider.model_args

    has_prompt_placeholder = any("{prompt}" in t for t in template)
    use_arg = provider.prompt_mode == "arg" or has_prompt_placeholder
    if use_arg and not has_prompt_placeholder:
        template.append("{prompt}")

    # A prompt that starts with '-' could be parsed as a flag.
    safe_prompt = (" " + prompt) if prompt.startswith("-") else prompt
    argv = []
    for tok in template:
        tok = tok.replace("{model}", effective_model)
        if use_arg:
            tok = tok.replace("{prompt}", safe_prompt)
        argv.append(tok)

    exe = which(argv[0])
    if not exe:
        raise CLIError(f"'{argv[0]}' is not installed or not on PATH", status=503)
    argv[0] = exe

    if IS_WINDOWS and exe.lower().endswith((".cmd", ".bat")):
        shim = _resolve_cmd_shim(exe)
        if shim:
            argv = shim + argv[1:]
        elif use_arg:
            raise CLIError(
                f"refusing to pass the prompt as an argument to the batch file {exe!r} "
                "(cmd.exe would re-parse it). Set prompt_mode = \"stdin\" for this provider.",
                status=500,
            )
        else:
            argv = ["cmd", "/d", "/c", *argv]

    env = dict(os.environ)
    env.update({"NO_COLOR": "1", "FORCE_COLOR": "0", "TERM": "dumb", "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"})
    env.update(provider.env)

    return Invocation(
        argv=argv,
        stdin=b"" if use_arg else prompt.encode("utf-8"),
        cwd=provider.cwd or cwd,
        env=env,
        timeout=provider.timeout or timeout,
    )


def _kill_tree(proc: subprocess.Popen) -> None:
    if proc.poll() is not None:
        return
    try:
        if IS_WINDOWS:
            subprocess.run(
                ["taskkill", "/T", "/F", "/PID", str(proc.pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        else:
            os.killpg(proc.pid, signal.SIGKILL)
    except Exception:
        pass
    try:
        proc.kill()
    except Exception:
        pass


async def stream_process(inv: Invocation, *, strip_ansi: bool = True) -> AsyncIterator[str]:
    """Run the invocation and yield decoded stdout text as it arrives.

    Raises CLIError on non-zero exit (when there was no stdout), on timeout,
    or if the binary cannot be started. The process is killed if the consumer
    stops iterating early (e.g. the HTTP client disconnects).
    """
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue[Tuple[str, Optional[str]]] = asyncio.Queue()

    popen_kw: Dict[str, object] = {}
    if IS_WINDOWS:
        popen_kw["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    else:
        popen_kw["start_new_session"] = True

    try:
        proc = subprocess.Popen(
            inv.argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=inv.cwd,
            env=inv.env,
            **popen_kw,  # type: ignore[arg-type]
        )
    except OSError as exc:
        raise CLIError(f"failed to start {inv.argv[0]!r}: {exc}", status=503) from exc

    stderr_chunks: List[bytes] = []

    def feed_stdin() -> None:
        try:
            if inv.stdin:
                proc.stdin.write(inv.stdin)  # type: ignore[union-attr]
            proc.stdin.close()  # type: ignore[union-attr]
        except (BrokenPipeError, OSError, ValueError):
            pass

    def pump_stdout() -> None:
        decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        stream = proc.stdout
        try:
            while True:
                chunk = stream.read1(4096) if hasattr(stream, "read1") else stream.read(4096)  # type: ignore[union-attr]
                if not chunk:
                    break
                text = decoder.decode(chunk)
                if text:
                    loop.call_soon_threadsafe(queue.put_nowait, ("out", text))
            tail = decoder.decode(b"", final=True)
            if tail:
                loop.call_soon_threadsafe(queue.put_nowait, ("out", tail))
        except (OSError, ValueError):
            pass
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, ("eof", None))

    def pump_stderr() -> None:
        try:
            for chunk in iter(lambda: proc.stderr.read(4096), b""):  # type: ignore[union-attr]
                stderr_chunks.append(chunk)
        except (OSError, ValueError):
            pass

    threads = [threading.Thread(target=t, daemon=True) for t in (feed_stdin, pump_stdout, pump_stderr)]
    for t in threads:
        t.start()

    deadline = time.monotonic() + inv.timeout
    produced = False
    finished = False
    pending_esc = ""
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise asyncio.TimeoutError
            kind, text = await asyncio.wait_for(queue.get(), timeout=remaining)
            if kind == "eof":
                break
            assert text is not None
            if strip_ansi:
                text = pending_esc + text
                # keep a possibly incomplete escape sequence for the next chunk
                cut = text.rfind("\x1b")
                if cut != -1 and not _ANSI_RE.match(text, cut):
                    pending_esc, text = text[cut:], text[:cut]
                else:
                    pending_esc = ""
                text = _ANSI_RE.sub("", text)
            if text:
                produced = produced or bool(text.strip())
                yield text
        if pending_esc:
            yield pending_esc

        remaining = max(0.1, deadline - time.monotonic())
        rc = await asyncio.wait_for(asyncio.to_thread(proc.wait), timeout=remaining)
        threads[2].join(timeout=2)
        finished = True
        if rc != 0 and not produced:
            err = b"".join(stderr_chunks).decode("utf-8", errors="replace").strip()
            err = _ANSI_RE.sub("", err)
            raise CLIError(f"CLI exited with code {rc}: {err[-2000:] or 'no output'}", status=502, stderr=err)
    except asyncio.TimeoutError:
        raise CLIError(f"CLI timed out after {inv.timeout:.0f}s", status=504) from None
    finally:
        if not finished:
            _kill_tree(proc)
        for pipe in (proc.stdout, proc.stderr):
            try:
                pipe.close()  # type: ignore[union-attr]
            except Exception:
                pass


async def run_process(inv: Invocation, *, strip_ansi: bool = True) -> str:
    parts = [chunk async for chunk in stream_process(inv, strip_ansi=strip_ansi)]
    return "".join(parts).strip()


def describe_argv(argv: List[str]) -> str:
    """Human-readable command line (for logs / `cli2api detect`)."""
    if IS_WINDOWS:
        return subprocess.list2cmdline(argv)
    import shlex

    return " ".join(shlex.quote(a) for a in argv)


__all__ = [
    "CLIError",
    "Invocation",
    "build_invocation",
    "describe_argv",
    "run_process",
    "stream_process",
    "which",
]
