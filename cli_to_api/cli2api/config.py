"""Settings and provider definitions.

Configuration is layered (later wins):
  1. built-in defaults (see BUILTIN_PROVIDERS)
  2. a TOML file  (``--config``, ``$CLI2API_CONFIG`` or ``./cli2api.toml``)
  3. environment variables (``CLI2API_*``)
  4. command-line flags
"""

from __future__ import annotations

import os
import shlex
import sys
from dataclasses import dataclass, field, fields
from pathlib import Path
from typing import Any, Dict, List, Optional

if sys.version_info >= (3, 11):
    import tomllib
else:  # pragma: no cover
    try:
        import tomli as tomllib  # type: ignore[no-redef]
    except ImportError:
        tomllib = None  # type: ignore[assignment]


@dataclass
class Provider:
    """One backend that can answer prompts."""

    id: str
    type: str = "cli"  # "cli" | "ollama" | "openai"
    label: str = ""
    description: str = ""
    enabled: bool = True

    # --- type = "cli" ---------------------------------------------------
    # argv template. May contain {prompt} and {model} placeholders.
    command: List[str] = field(default_factory=list)
    # "stdin": prompt is written to the process stdin (safest, no length limit)
    # "arg":   prompt replaces {prompt} in the command (appended if absent)
    prompt_mode: str = "stdin"
    # Extra args appended when the client asks for a sub-model, e.g. "claude/sonnet".
    model_args: List[str] = field(default_factory=list)
    default_model: str = ""
    # Known sub-models for this provider (used when dynamic discovery is unavailable).
    models: List[str] = field(default_factory=list)
    env: Dict[str, str] = field(default_factory=dict)
    cwd: str = ""
    timeout: Optional[float] = None
    strip_ansi: bool = True

    # --- type = "ollama" | "openai" -------------------------------------
    base_url: str = ""
    api_key: str = ""

    @property
    def binary(self) -> str:
        return self.command[0] if self.command else ""

    @classmethod
    def from_dict(cls, pid: str, data: Dict[str, Any], base: Optional["Provider"] = None) -> "Provider":
        known = {f.name for f in fields(cls)}
        unknown = set(data) - known
        if unknown:
            raise ValueError(f"provider '{pid}': unknown keys {sorted(unknown)}")
        values: Dict[str, Any] = {}
        if base is not None:
            values = {f.name: getattr(base, f.name) for f in fields(cls)}
        values.update(data)
        values["id"] = pid
        cmd = values.get("command")
        if isinstance(cmd, str):
            values["command"] = split_command(cmd)
        args = values.get("model_args")
        if isinstance(args, str):
            values["model_args"] = split_command(args)
        p = cls(**values)
        if p.type not in ("cli", "ollama", "openai"):
            raise ValueError(f"provider '{pid}': type must be cli, ollama or openai")
        if p.prompt_mode not in ("stdin", "arg"):
            raise ValueError(f"provider '{pid}': prompt_mode must be 'stdin' or 'arg'")
        if p.type == "cli" and not p.command:
            raise ValueError(f"provider '{pid}': 'command' is required for cli providers")
        return p


def split_command(cmd: str) -> List[str]:
    """Split a command string into argv, keeping Windows backslashes intact."""
    parts = shlex.split(cmd, posix=(os.name != "nt"))
    return [p[1:-1] if len(p) >= 2 and p[0] == p[-1] and p[0] in "\"'" else p for p in parts]


# Built-in presets. Each is only *offered* when its binary is found on this machine.
BUILTIN_PROVIDERS: Dict[str, Dict[str, Any]] = {
    "claude": {
        "label": "Claude Code",
        "description": "Anthropic Claude Code CLI (uses your Claude subscription or API key)",
        "command": ["claude", "-p", "--output-format", "text"],
        "prompt_mode": "stdin",
        "model_args": ["--model", "{model}"],
        "models": ["sonnet", "opus", "haiku", "claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"],
    },
    "gemini": {
        "label": "Gemini CLI",
        "description": "Google Gemini CLI",
        "command": ["gemini"],
        "prompt_mode": "stdin",
        "model_args": ["-m", "{model}"],
        "models": ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
    },
    "codex": {
        "label": "OpenAI Codex CLI",
        "description": "OpenAI Codex CLI in non-interactive exec mode",
        "command": ["codex", "exec", "--skip-git-repo-check", "-"],
        "prompt_mode": "stdin",
        "model_args": ["-m", "{model}"],
        "models": ["gpt-5.4", "gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.1-codex-mini", "o3", "o4-mini"],
    },
    "agy": {
        "label": "Antigravity CLI",
        "description": "Google Antigravity CLI in print mode (low effort)",
        "command": ["agy", "--disable-slash-commands", "--effort", "low", "--output-format", "text", "-p", "{prompt}"],
        "prompt_mode": "arg",
        "model_args": ["--model", "{model}"],
    },
    "kimi": {
        "label": "Kimi CLI",
        "description": "Moonshot Kimi CLI in print mode",
        "command": ["kimi", "--print", "--output-format", "text", "--command", "{prompt}"],
        "prompt_mode": "arg",
        "model_args": ["--model", "{model}"],
        "models": ["kimi-k2", "kimi-latest"],
    },
    "opencode": {
        "label": "OpenCode",
        "description": "OpenCode headless run (model as provider/model, e.g. opencode/anthropic/claude-sonnet-4)",
        "command": ["opencode", "run", "{prompt}"],
        "prompt_mode": "arg",
        "model_args": ["-m", "{model}"],
        "models": ["anthropic/claude-sonnet-4", "openai/gpt-5", "google/gemini-2.5-pro"],
    },
    "cline": {
        "label": "Cline CLI",
        "description": "Cline CLI (headless when stdout is not a terminal)",
        "command": ["cline", "{prompt}"],
        "prompt_mode": "arg",
        "model_args": ["-m", "{model}"],
        "models": ["claude-sonnet-4-5", "gpt-4o", "gemini-2.5-pro"],
    },
    "cursor": {
        "label": "Cursor Agent",
        "description": "Cursor agent CLI in print mode",
        "command": ["cursor-agent", "-p", "--output-format", "text", "{prompt}"],
        "prompt_mode": "arg",
        "model_args": ["--model", "{model}"],
        "models": ["auto", "sonnet-4.5", "gpt-5"],
    },
    "copilot": {
        "label": "GitHub Copilot CLI",
        "description": "GitHub Copilot CLI in prompt mode",
        "command": ["copilot", "-p", "{prompt}"],
        "prompt_mode": "arg",
        "model_args": ["--model", "{model}"],
        "models": ["claude-sonnet-4.5", "gpt-5", "gemini-2.5-pro"],
    },
    "qwen": {
        "label": "Qwen Code",
        "description": "Qwen Code CLI (reads the prompt from stdin)",
        "command": ["qwen"],
        "prompt_mode": "stdin",
        "model_args": ["-m", "{model}"],
        "models": ["qwen3-coder-plus", "qwen3-coder-flash"],
    },
    "ollama-cli": {
        "label": "Ollama (CLI)",
        "description": "Run a local model through `ollama run`",
        "command": ["ollama", "run", "{model}"],
        "prompt_mode": "stdin",
        "default_model": "llama3.1",
    },
    "ollama": {
        "type": "ollama",
        "label": "Ollama (HTTP)",
        "description": "Local Ollama server; use model 'ollama/<name>'",
        "base_url": "http://localhost:11434",
    },
}


@dataclass
class Settings:
    host: str = "127.0.0.1"
    port: int = 8787
    api_key: str = ""
    # Extra keys, e.g. one per user/app you hand the endpoint to.
    api_keys: List[str] = field(default_factory=list)
    max_concurrency: int = 4
    timeout: float = 300.0
    workdir: str = ""
    default_provider: str = ""
    cors_origins: List[str] = field(default_factory=list)
    # Map model names clients send to providers, e.g. {"gpt-4o" = "claude"}.
    aliases: Dict[str, str] = field(default_factory=dict)
    providers: Dict[str, Provider] = field(default_factory=dict)

    def all_api_keys(self) -> List[str]:
        return [k for k in [self.api_key, *self.api_keys] if k]

    def resolved_workdir(self) -> Path:
        path = Path(self.workdir).expanduser() if self.workdir else Path.home() / ".cli2api" / "workspace"
        path.mkdir(parents=True, exist_ok=True)
        return path


def _find_config_file(explicit: Optional[str]) -> Optional[Path]:
    for cand in (explicit, os.environ.get("CLI2API_CONFIG"), "cli2api.toml"):
        if cand:
            p = Path(cand).expanduser()
            if p.is_file():
                return p
            if cand == explicit or cand == os.environ.get("CLI2API_CONFIG"):
                raise FileNotFoundError(f"config file not found: {p}")
    return None


def load_settings(config_path: Optional[str] = None, overrides: Optional[Dict[str, Any]] = None) -> Settings:
    data: Dict[str, Any] = {}
    path = _find_config_file(config_path)
    if path:
        if tomllib is None:
            raise RuntimeError("Python <3.11 requires 'tomli' to read TOML config files (pip install tomli)")
        with open(path, "rb") as fh:
            data = tomllib.load(fh)

    server = dict(data.get("server") or {})
    env_map = {
        "CLI2API_HOST": ("host", str),
        "CLI2API_PORT": ("port", int),
        "CLI2API_API_KEY": ("api_key", str),
        "CLI2API_API_KEYS": ("api_keys", lambda v: [x.strip() for x in v.split(",") if x.strip()]),
        "CLI2API_MAX_CONCURRENCY": ("max_concurrency", int),
        "CLI2API_TIMEOUT": ("timeout", float),
        "CLI2API_WORKDIR": ("workdir", str),
        "CLI2API_DEFAULT_PROVIDER": ("default_provider", str),
        "CLI2API_CORS_ORIGINS": ("cors_origins", lambda v: [x.strip() for x in v.split(",") if x.strip()]),
    }
    for env, (key, conv) in env_map.items():
        if os.environ.get(env):
            server[key] = conv(os.environ[env])
    for key, val in (overrides or {}).items():
        if val is not None:
            server[key] = val

    allowed = {f.name for f in fields(Settings)} - {"providers", "aliases"}
    unknown = set(server) - allowed
    if unknown:
        raise ValueError(f"[server]: unknown keys {sorted(unknown)}")
    settings = Settings(**server)
    settings.aliases = {str(k): str(v) for k, v in (data.get("aliases") or {}).items()}

    use_builtins = data.get("use_builtin_providers", True)
    providers: Dict[str, Provider] = {}
    if use_builtins:
        for pid, spec in BUILTIN_PROVIDERS.items():
            providers[pid] = Provider.from_dict(pid, spec)
    for pid, spec in (data.get("providers") or {}).items():
        providers[pid] = Provider.from_dict(pid, spec, base=providers.get(pid))

    if os.environ.get("OLLAMA_HOST") and "ollama" in providers:
        host = os.environ["OLLAMA_HOST"]
        providers["ollama"].base_url = host if host.startswith("http") else f"http://{host}"

    settings.providers = {pid: p for pid, p in providers.items() if p.enabled}
    return settings
