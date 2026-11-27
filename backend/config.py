"""Paths and user settings (stored as JSON in data/settings.json)."""
from __future__ import annotations

import copy
import json
import os
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# the installed Windows app keeps data in %LOCALAPPDATA%\Varagh\data (set by the launcher)
DATA = Path(os.environ["VARAGH_DATA"]) if os.environ.get("VARAGH_DATA") else ROOT / "data"
BOOKS_DIR = DATA / "books"
COVERS_DIR = DATA / "covers"
DB_PATH = DATA / "varagh.db"
SETTINGS_PATH = DATA / "settings.json"
FRONTEND = ROOT / "frontend"

DATA.mkdir(parents=True, exist_ok=True)
BOOKS_DIR.mkdir(exist_ok=True)
COVERS_DIR.mkdir(exist_ok=True)

TASKS = {
    "translate_para": "ترجمه‌ی پاراگرافی",
    "translate_page": "ترجمه‌ی صفحه‌ای",
    "better": "ترجمه‌ی بهتر (دستی)",
    "glossary": "ساخت واژه‌نامه",
    "lookup": "معنی کلمه",
    "graph": "توضیح رابطه‌ها در گراف",
    "mindmap": "نقشه‌ی ذهنی",
    "image_prompt": "پرامپت تصویرسازی",
    "recap": "خلاصه‌ی «قبلاً در این کتاب»",
    "quiz": "سؤال‌های مرور فصل",
    "explain": "توضیح پاراگراف مبهم",
    "palace": "قصر حافظه",
    "post": "اسکلت و بازخورد پست آموزشی",
}

DEFAULTS: dict = {
    "openai": {
        "base_url": "https://api.openai.com/v1",
        "api_key": "",
        "auth": "bearer",
        "api_version": "",
        "json_mode": True,
        "send_temperature": False,
        "temperature": 0.3,
        "timeout": 180,
    },
    "ollama": {
        "base_url": "http://127.0.0.1:11434",
        "num_ctx": 4096,
        "num_ctx_page": 8192,
        "keep_alive": "30m",
        "temperature": 0.2,
        "fallback_model": "",
        "embed_model": "",
        "timeout": 900,
    },
    "cli2api": {
        "base_url": "http://127.0.0.1:8787",
        "api_key": "",
        "default_cli": "agy",
        "effort": "low",
        "json_mode": True,
        "timeout": 300,
        "auto_start": True,
        "cli_to_api_dir": "",
    },
    "tasks": {
        "translate_para": {"provider": "cli2api", "model": "agy/gemini-3.8-flash-low"},
        "translate_page": {"provider": "cli2api", "model": "agy/gemini-3.8-flash-low"},
        "better": {"provider": "cli2api", "model": "agy/gemini-4-neon-low"},
        "glossary": {"provider": "cli2api", "model": "agy/gemini-3.8-flash-low"},
        "lookup": {"provider": "cli2api", "model": "agy/gemini-3.8-flash-low"},
        "graph": {"provider": "cli2api", "model": ""},
        "mindmap": {"provider": "cli2api", "model": ""},
        "image_prompt": {"provider": "cli2api", "model": ""},
        "recap": {"provider": "cli2api", "model": ""},
        "quiz": {"provider": "cli2api", "model": ""},
        "explain": {"provider": "cli2api", "model": ""},
        "palace": {"provider": "cli2api", "model": ""},
        "post": {"provider": "cli2api", "model": ""},
    },
    "server": {"lan": False, "token": ""},
    "budget": {
        "monthly_token_cap": 2_000_000,
        "price_in_per_m": 0.0,
        "price_out_per_m": 0.0,
        "fallback_to_ollama": True,
    },
    "reading": {
        "page_chunk_chars_ollama": 2500,
        "page_chunk_chars_openai": 12000,
        "page_chunk_chars_cli2api": 6000,
        "auto_glossary": False,
        "mindmap_chunk_chars_ollama": 3000,
        "mindmap_chunk_chars_openai": 40000,
        "mindmap_chunk_chars_cli2api": 18000,
        "user_domain": "مهندسی نرم‌افزار و هوش مصنوعی",
        "obsidian_vault": "",
    },
}

_lock = threading.Lock()


def _merge(base: dict, over: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _merge(out[k], v)
        else:
            out[k] = v
    return out


def load_settings() -> dict:
    with _lock:
        if SETTINGS_PATH.exists():
            try:
                raw = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
            except Exception:
                raw = {}
        else:
            raw = {}
        return _merge(DEFAULTS, raw)


def save_settings(new: dict) -> dict:
    merged = _merge(load_settings(), new)
    with _lock:
        SETTINGS_PATH.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    return merged


def mask_key(key: str) -> str:
    if not key:
        return ""
    return key[:3] + "…" + key[-4:] if len(key) > 10 else "…"
