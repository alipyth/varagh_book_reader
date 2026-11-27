"""Command-line entry point: ``cli2api serve | detect | ask | init``."""

from __future__ import annotations

import argparse
import asyncio
import ipaddress
import json
import sys
from pathlib import Path
from typing import List, Optional

from . import __version__
from .config import load_settings

EXAMPLE_CONFIG = """\
# cli2api configuration — every key is optional.
# Docs: https://github.com/alipyth/CLI_to_API#configuration

[server]
host = "127.0.0.1"        # use "0.0.0.0" to expose on your LAN (set api_key!)
port = 8787
api_key = ""              # clients send:  Authorization: Bearer <api_key>
# api_keys = ["key-for-app-1", "key-for-friend"]   # hand out several keys
max_concurrency = 4       # how many CLI processes may run at once
timeout = 300             # seconds per request
default_provider = "claude"
# workdir = "~/.cli2api/workspace"   # folder the CLIs run in
# cors_origins = ["http://localhost:3000"]

# Let apps with hard-coded model names use your CLIs:
# [aliases]
# "gpt-4o" = "claude"
# "gpt-4o-mini" = "claude/haiku"
# "fast" = "ollama/llama3.1"

# Override a built-in preset:
# [providers.claude]
# command = ["claude", "-p", "--output-format", "text", "--max-turns", "1"]

# Disable a preset:
# [providers.kimi]
# enabled = false

# Add ANY command-line tool. The prompt goes to stdin by default,
# or into {prompt} when prompt_mode = "arg".
# [providers.my-script]
# label = "My script"
# command = ["python", "my_bot.py"]
# prompt_mode = "stdin"

# Proxy an OpenAI-compatible server (LM Studio, vLLM, OpenRouter, ...)
# [providers.lmstudio]
# type = "openai"
# base_url = "http://localhost:1234/v1"
# api_key = ""
# default_model = "qwen2.5-7b-instruct"
"""


def _is_loopback(host: str) -> bool:
    if host in ("localhost",):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def cmd_serve(args: argparse.Namespace) -> int:
    import uvicorn

    from .server import create_app

    settings = load_settings(args.config, {"host": args.host, "port": args.port, "api_key": args.api_key})
    if not _is_loopback(settings.host) and not settings.all_api_keys():
        print(
            "\n  WARNING: listening on a non-loopback address without an API key.\n"
            "  Anyone who can reach this port can run prompts on YOUR accounts.\n"
            "  Set CLI2API_API_KEY or --api-key.\n",
            file=sys.stderr,
        )
    app = create_app(settings)
    names = ", ".join(p.id for p in app.state.gateway.available()) or "none found"
    shown_host = "localhost" if settings.host in ("0.0.0.0", "::") else settings.host
    print(f"\n  cli2api v{__version__}")
    print(f"  Providers : {names}")
    print(f"  API       : http://{shown_host}:{settings.port}/v1")
    print(f"  Playground: http://{shown_host}:{settings.port}/")
    print(f"  Docs      : http://{shown_host}:{settings.port}/docs\n")
    uvicorn.run(app, host=settings.host, port=settings.port, log_level=args.log_level)
    return 0


def cmd_detect(args: argparse.Namespace) -> int:
    from .gateway import Gateway

    gw = Gateway(load_settings(args.config))
    rows = gw.detect()
    if args.json:
        print(json.dumps(rows, indent=2, ensure_ascii=False))
        return 0
    print(f"{'':2}{'PROVIDER':<12} {'TYPE':<7} {'STATUS':<14} PATH / URL")
    for r in rows:
        if r["type"] == "cli":
            ok = r["installed"]
            status = "installed" if ok else "not found"
            mark = "✓" if ok else "✗"
            loc = r["path"] or " ".join(r["command"])
        else:
            mark, status, loc = "•", "http", r["base_url"] or ""
        print(f"{mark:2}{r['id']:<12} {r['type']:<7} {status:<14} {loc}")
    return 0


def cmd_ask(args: argparse.Namespace) -> int:
    from .gateway import Gateway
    from .json_repair import extract_json
    from .runner import CLIError

    prompt = " ".join(args.prompt) if args.prompt else sys.stdin.read()
    if not prompt.strip():
        print("error: empty prompt", file=sys.stderr)
        return 2
    gw = Gateway(load_settings(args.config))

    async def go() -> int:
        if args.json:
            out = await gw.complete(args.model, prompt, json_mode=True)
            print(json.dumps(extract_json(out), indent=2, ensure_ascii=False))
            return 0
        async for chunk in gw.stream(args.model, prompt):
            sys.stdout.write(chunk)
            sys.stdout.flush()
        sys.stdout.write("\n")
        return 0

    try:
        return asyncio.run(go())
    except (CLIError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1


def cmd_init(args: argparse.Namespace) -> int:
    path = Path(args.path)
    if path.exists() and not args.force:
        print(f"{path} already exists (use --force to overwrite)", file=sys.stderr)
        return 1
    path.write_text(EXAMPLE_CONFIG, encoding="utf-8")
    print(f"wrote {path}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="cli2api", description="Expose local AI CLIs as an OpenAI-compatible API.")
    parser.add_argument("--version", action="version", version=f"cli2api {__version__}")
    parser.add_argument("-c", "--config", help="path to cli2api.toml")
    sub = parser.add_subparsers(dest="command")

    s = sub.add_parser("serve", help="start the HTTP server (default)")
    s.add_argument("--host")
    s.add_argument("--port", type=int)
    s.add_argument("--api-key")
    s.add_argument("--log-level", default="info")
    s.set_defaults(func=cmd_serve)

    d = sub.add_parser("detect", help="list providers and whether they are installed")
    d.add_argument("--json", action="store_true")
    d.set_defaults(func=cmd_detect)

    a = sub.add_parser("ask", help="send one prompt without starting a server")
    a.add_argument("prompt", nargs="*", help="prompt text (reads stdin if omitted)")
    a.add_argument("-m", "--model", help="provider id, e.g. claude or claude/sonnet")
    a.add_argument("--json", action="store_true", help="force and repair JSON output")
    a.set_defaults(func=cmd_ask)

    i = sub.add_parser("init", help="write an example cli2api.toml")
    i.add_argument("path", nargs="?", default="cli2api.toml")
    i.add_argument("--force", action="store_true")
    i.set_defaults(func=cmd_init)
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except Exception:
            pass
    parser = build_parser()
    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        args = parser.parse_args([*(argv or sys.argv[1:]), "serve"])
    return args.func(args)
