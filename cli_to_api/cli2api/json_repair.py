"""Extract a JSON object from messy LLM output.

LLMs often wrap JSON in prose or ```json fences, emit <think> blocks, leave
trailing commas, or write LaTeX (``\\frac``, ``\\alpha``) without escaping the
backslash. ``extract_json`` tries progressively more aggressive repairs.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, Union

JSON_INSTRUCTION = (
    "\n\nRespond with ONLY a single valid JSON object. "
    "No markdown fences, no explanations before or after it."
)

_TRAILING_COMMA = re.compile(r",\s*([}\]])")


def _repair_escapes(s: str) -> str:
    """Fix invalid backslash escapes and raw control characters inside strings."""
    s = _TRAILING_COMMA.sub(r"\1", s)
    out = []
    in_string = False
    i, n = 0, len(s)
    while i < n:
        ch = s[i]
        if not in_string:
            if ch == '"':
                in_string = True
            out.append(ch)
            i += 1
            continue
        if ch == '"':
            in_string = False
            out.append(ch)
            i += 1
            continue
        if ch == "\\":
            if i + 1 >= n:
                out.append("\\\\")
                i += 1
                continue
            nxt = s[i + 1]
            if nxt in '"\\/':
                out.append("\\" + nxt)
                i += 2
                continue
            if nxt in "bfnrt":
                # \frac, \text, \beta, \nabla ... are LaTeX, not control chars
                if i + 2 < n and s[i + 2].isalpha():
                    out.append("\\\\" + nxt)
                else:
                    out.append("\\" + nxt)
                i += 2
                continue
            if nxt == "u" and re.fullmatch(r"[0-9a-fA-F]{4}", s[i + 2 : i + 6] or ""):
                out.append(s[i : i + 6])
                i += 6
                continue
            out.append("\\\\" + nxt)
            i += 2
            continue
        if ch == "\n":
            out.append("\\n")
        elif ch == "\r":
            out.append("\\r")
        elif ch == "\t":
            out.append("\\t")
        else:
            out.append(ch)
        i += 1
    return "".join(out)


def _try(text: str) -> Union[Dict[str, Any], list, None]:
    try:
        val = json.loads(text, strict=False)
    except (ValueError, TypeError):
        return None
    return val if isinstance(val, (dict, list)) else None


def extract_json(raw: str) -> Union[Dict[str, Any], list]:
    """Return the first JSON object/array found in ``raw`` or raise ValueError."""
    cleaned = re.sub(r"<think>.*?</think>", "", raw or "", flags=re.DOTALL | re.IGNORECASE).strip()

    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", cleaned, flags=re.IGNORECASE)
    if fence:
        cleaned = fence.group(1).strip()

    if (val := _try(cleaned)) is not None:
        return val

    candidates = []
    for open_c, close_c in (("{", "}"), ("[", "]")):
        start, end = cleaned.find(open_c), cleaned.rfind(close_c)
        if start != -1 and end > start:
            candidates.append((start, cleaned[start : end + 1]))
    candidates.sort(key=lambda c: c[0])  # whichever structure starts first

    for _, cand in candidates:
        for attempt in (
            cand,
            _repair_escapes(cand),
            _TRAILING_COMMA.sub(r"\1", re.sub(r'\\(?!["\\])', r"\\\\", cand)),
        ):
            if (val := _try(attempt)) is not None:
                return val

    raise ValueError("model output did not contain valid JSON")
