"""Decide which provider/model handles a task, and guard the monthly OpenAI budget."""
from __future__ import annotations

from . import db
from .providers import BudgetError, LLMError


def budget_state(settings: dict) -> dict:
    used = db.openai_tokens_this_month()
    cap = int(settings["budget"].get("monthly_token_cap") or 0)
    return {"used": used, "cap": cap, "exceeded": bool(cap) and used >= cap}


def resolve(task: str, settings: dict, *, explicit: bool = False) -> tuple[str, str, str | None]:
    """Returns (provider, model, note). note explains a fallback, if any."""
    t = settings["tasks"].get(task) or {}
    if not t.get("model"):                      # tasks without their own model use the translation model
        t = settings["tasks"].get("translate_para") or {}
    provider, model = t.get("provider", "ollama"), t.get("model", "")
    if provider == "openai" and budget_state(settings)["exceeded"]:
        if explicit or not settings["budget"].get("fallback_to_ollama", True):
            raise BudgetError("سقف ماهانه‌ی توکن OpenAI پر شده. در تنظیمات سقف را بالا ببر یا از Ollama استفاده کن.")
        fb = fallback_ollama_model(settings)
        if not fb:
            raise BudgetError("سقف OpenAI پر شده و مدل جایگزین Ollama تعیین نشده.")
        return "ollama", fb, "سقف OpenAI پر شد؛ با Ollama ترجمه شد"
    if not model:
        raise LLMError(f"برای کار «{task}» مدلی انتخاب نشده. به تنظیمات برو.")
    return provider, model, None


def fallback_ollama_model(settings: dict) -> str:
    fb = settings["ollama"].get("fallback_model")
    if fb:
        return fb
    for t in settings["tasks"].values():
        if t.get("provider") == "ollama" and t.get("model"):
            return t["model"]
    return ""
