"""Convert OpenAI-style chat messages into a single prompt for a CLI."""

from __future__ import annotations

from typing import Any, Dict, List


def content_to_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):  # [{"type": "text", "text": "..."}, ...]
        parts = []
        for part in content:
            if isinstance(part, dict):
                if part.get("type") in (None, "text", "input_text"):
                    parts.append(str(part.get("text") or ""))
                elif part.get("type") in ("image_url", "input_image"):
                    parts.append("[image omitted: CLI backends accept text only]")
            elif isinstance(part, str):
                parts.append(part)
        return "\n".join(p for p in parts if p)
    return str(content)


_ROLE_NAMES = {"user": "User", "assistant": "Assistant", "tool": "Tool", "function": "Tool"}


def messages_to_prompt(messages: List[Dict[str, Any]]) -> str:
    """Flatten a conversation.

    * A lone user message is passed through verbatim.
    * System/developer messages become a leading instruction block.
    * Multi-turn history is rendered as a labelled transcript ending with the
      latest user turn, so a stateless CLI still sees the context.
    """
    system_parts: List[str] = []
    turns: List[Dict[str, str]] = []
    for msg in messages or []:
        role = str(msg.get("role") or "user")
        text = content_to_text(msg.get("content")).strip()
        if not text:
            continue
        if role in ("system", "developer"):
            system_parts.append(text)
        else:
            turns.append({"role": role, "text": text})

    if not turns:
        raise ValueError("messages must contain at least one non-empty user message")

    system = "\n\n".join(system_parts)
    if len(turns) == 1 and turns[0]["role"] == "user":
        return f"{system}\n\n{turns[0]['text']}" if system else turns[0]["text"]

    lines: List[str] = []
    if system:
        lines += ["[Instructions]", system, ""]
    lines.append("[Conversation so far]")
    for t in turns[:-1]:
        lines.append(f"{_ROLE_NAMES.get(t['role'], t['role'].title())}: {t['text']}")
    last = turns[-1]
    lines += ["", f"[Latest {_ROLE_NAMES.get(last['role'], last['role']).lower()} message — reply to this]", last["text"]]
    return "\n".join(lines)
