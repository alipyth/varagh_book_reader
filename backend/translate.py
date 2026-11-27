"""On-demand streaming translation, glossary builder, word lookup and model comparison.

Nothing is translated until the reader asks for it (a paragraph click or the
"translate page" button). Every result is stored in SQLite, so the same text is
never sent to a model twice.
"""
from __future__ import annotations

import hashlib
import json
import re
import threading
import time
import traceback
from collections import Counter

from . import db, prompts
from .config import load_settings
from .providers import LLMError, chat, open_stream, parse_json
from .router import resolve

# ------------------------------------------------------------------ helpers

def glossary_for(book_id: int) -> list[tuple[str, str]]:
    rs = db.rows("SELECT term, fa FROM glossary WHERE book_id=? AND fa<>'' ORDER BY length(term) DESC", (book_id,))
    return [(r["term"], r["fa"]) for r in rs]


def page_paragraphs(book_id: int, page: int) -> list[dict]:
    return db.rows("SELECT id, kind, text FROM paragraphs WHERE book_id=? AND page=? ORDER BY idx", (book_id, page))


def _batches(items: list[dict], max_chars: int) -> list[list[dict]]:
    out, cur, size = [], [], 0
    for it in items:
        n = len(it["text"])
        if cur and size + n > max_chars:
            out.append(cur); cur, size = [], 0
        cur.append(it); size += n
    if cur:
        out.append(cur)
    return out


# ------------------------------------------------------------------ on-demand streaming translation

ERR = "\u0000ERR:"


def _finish(gen, on_done):
    """Relay deltas; call on_done(full_text) only if the stream completed (not on client abort)."""
    parts = []
    try:
        for d in gen:
            parts.append(d)
            yield d
    except LLMError as e:
        yield ERR + str(e)
        return
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        yield ERR + f"خطای غیرمنتظره: {e}"
        return
    text = "".join(parts).strip()
    if text:
        on_done(text)


def stream_paragraph(pid: int, kind: str = "base"):
    """Returns (meta, generator). Already-translated base paragraphs come straight from the database."""
    s = load_settings()
    p = db.one("SELECT * FROM paragraphs WHERE id=?", (pid,))
    if not p:
        raise LLMError("پاراگراف پیدا نشد")
    if kind == "base":
        hit = db.one("SELECT text, provider, model FROM translations WHERE para_id=? AND kind='base'", (pid,))
        if hit:
            return {"provider": hit["provider"], "model": hit["model"], "cached": True}, iter([hit["text"]])
        if p["kind"] == "raw":
            _store(pid, "base", "none", "", p["text"])
            return {"provider": "none", "model": "", "cached": True}, iter([p["text"]])
    task = "better" if kind == "better" else "translate_para"
    provider, model, note = resolve(task, s, explicit=(kind == "better"))
    terms = prompts.relevant_terms(glossary_for(p["book_id"]), p["text"])
    if kind == "better":
        prev = db.one("SELECT text FROM paragraphs WHERE book_id=? AND idx=?", (p["book_id"], p["idx"] - 1))
        nxt = db.one("SELECT text FROM paragraphs WHERE book_id=? AND idx=?", (p["book_id"], p["idx"] + 1))
        user = prompts.better(p["text"], prev["text"] if prev else "", nxt["text"] if nxt else "", terms)
    else:
        user = prompts.single(p["text"], terms)
    gen = open_stream(provider, model, prompts.TRANSLATOR, user, settings=s, task=task)
    return ({"provider": provider, "model": model, "cached": False, "note": note},
            _finish(gen, lambda t: _store(pid, kind, provider, model, t)))


def _store(pid: int, kind: str, provider: str, model: str, text: str) -> None:
    db.run("INSERT OR REPLACE INTO translations(para_id, kind, provider, model, text, created) VALUES(?,?,?,?,?,?)",
           (pid, kind, provider, model, text.strip(), db.now()))


# Control characters in the page stream: "\x01<paragraph id>\x02" starts a paragraph,
# "\x04<json>" at the very end carries a summary. The client splits on them.
CTRL_START, CTRL_SEP, CTRL_END = "\x01", "\x02", "\x04"
MARKER = re.compile(r"<<<\s*(\d+)\s*>>>")
PARTIAL = re.compile(r"<{1,3}\s*\d*\s*>{0,2}$")


def _ctrl(pid: int) -> str:
    return f"{CTRL_START}{pid}{CTRL_SEP}"


class _MarkerRelay:
    """Turns the model's <<<n>>> markers into paragraph control codes while streaming."""

    def __init__(self, ids: list[int]):
        self.ids, self.buf = ids, ""

    def feed(self, s: str) -> str:
        self.buf += s
        out, last = "", 0
        for m in MARKER.finditer(self.buf):
            out += self.buf[last:m.start()]
            n = int(m.group(1))
            if 1 <= n <= len(self.ids):
                out += _ctrl(self.ids[n - 1])
            last = m.end()
        rest = self.buf[last:]
        hold = PARTIAL.search(rest)
        if hold:
            out += rest[:hold.start()]
            self.buf = rest[hold.start():]
        else:
            out += rest
            self.buf = ""
        return out

    def flush(self) -> str:
        out, self.buf = self.buf, ""
        return out


def _segments(raw: str, n: int) -> list[str] | None:
    """Split a marked-up page translation into exactly n paragraph translations, or None."""
    parts = MARKER.split(raw)
    found: dict[int, str] = {}
    for i in range(1, len(parts) - 1, 2):
        k, txt = int(parts[i]), parts[i + 1].strip()
        if 1 <= k <= n and txt:
            found[k] = (found.get(k, "") + "\n\n" + txt).strip()
    if len(found) == n:
        return [found[k] for k in range(1, n + 1)]
    plain = [x.strip() for x in re.split(r"\n\s*\n", MARKER.sub("\n\n", raw)) if x.strip()]
    if len(plain) == n:
        return plain
    return None


def page_state(book_id: int, page: int) -> tuple[list[dict], dict[int, dict]]:
    paras = page_paragraphs(book_id, page)
    tr: dict[int, dict] = {}
    for r in db.rows("SELECT t.* FROM translations t JOIN paragraphs p ON p.id=t.para_id WHERE p.book_id=? AND p.page=?",
                     (book_id, page)):
        tr.setdefault(r["para_id"], {})[r["kind"]] = r
    return paras, tr


def stream_page(book_id: int, page: int):
    """One request for the whole page. Paragraphs that already have a translation are reused as they are;
    only the missing ones are sent to the model, and each result is stored per paragraph, so the
    paragraph view and the page view share the same translations."""
    s = load_settings()
    paras, tr = page_state(book_id, page)
    if not paras:
        raise LLMError("این صفحه متنی برای ترجمه ندارد")
    missing = [p for p in paras if p["kind"] != "raw" and "base" not in tr.get(p["id"], {})]

    # already-translated paragraphs are streamed back first; all missing ones go out together in one
    # request (split only when the page is longer than the chunk limit). The client puts them in page order.
    if missing:
        provider, model, note = resolve("translate_page", s)
        chunk_key = {"openai": "page_chunk_chars_openai", "cli2api": "page_chunk_chars_cli2api"}.get(
            provider, "page_chunk_chars_ollama"
        )
        limit = int(s["reading"].get(chunk_key, 6000 if provider == "cli2api" else 2500))
        chunks = _batches(missing, limit)
    else:
        provider = model = note = None
        chunks = []
    missing_ids = {p["id"] for p in missing}
    units: list = [p for p in paras if p["id"] not in missing_ids] + chunks

    gloss = glossary_for(book_id)

    def opener(chunk):
        body = "\n\n".join(f"<<<{i + 1}>>>\n{p['text']}" for i, p in enumerate(chunk))
        terms = prompts.relevant_terms(gloss, body)
        return open_stream(provider, model, prompts.TRANSLATOR, prompts.page_marked(body, len(chunk), terms),
                           settings=s, task="translate_page", num_ctx=s["ollama"].get("num_ctx_page"))

    first_chunk = next((u for u in units if isinstance(u, list)), None)
    first_stream = opener(first_chunk) if first_chunk else None   # connect now so errors become HTTP errors

    def gen():
        misaligned, stored = False, 0
        full_text: list[str] = []
        try:
            for u in units:
                if isinstance(u, dict):
                    t = tr.get(u["id"], {})
                    shown = (t.get("better") or t.get("base") or {}).get("text")
                    if u["kind"] == "raw" and not shown:
                        _store(u["id"], "base", "none", "", u["text"]); shown = u["text"]
                    full_text.append(shown or "")
                    yield _ctrl(u["id"]) + (shown or "")
                    continue
                stream = first_stream if u is first_chunk else opener(u)
                relay, raw = _MarkerRelay([p["id"] for p in u]), ""
                yield _ctrl(u[0]["id"])
                for d in stream:
                    raw += d
                    out = relay.feed(d)
                    if out:
                        yield out
                tail = relay.flush()
                if tail:
                    yield tail
                segs = _segments(raw, len(u))
                if segs:
                    for p, t in zip(u, segs):
                        _store(p["id"], "base", provider, model, t)
                    stored += len(u)
                    full_text.extend(segs)
                else:
                    misaligned = True
                    full_text.append(MARKER.sub("\n\n", raw).strip())
        except LLMError as e:
            yield ERR + str(e)
            return
        except Exception as e:  # noqa: BLE001
            traceback.print_exc()
            yield ERR + f"خطای غیرمنتظره: {e}"
            return
        if misaligned:
            # keep the page view even when the model did not keep the paragraph markers
            db.run("INSERT OR REPLACE INTO page_translations(book_id, page, provider, model, text, created) VALUES(?,?,?,?,?,?)",
                   (book_id, page, provider, model, "\n\n".join(x for x in full_text if x), db.now()))
        yield CTRL_END + json.dumps({"misaligned": misaligned, "stored": stored, "sent": len(missing)})

    meta = {"provider": provider or "", "model": model or "", "cached": not missing, "note": note}
    return meta, gen()


def assembled_page(paras: list[dict], tr: dict[int, dict]) -> dict | None:
    """The page view built from paragraph translations, when every paragraph has one."""
    if not paras:
        return None
    parts, models = [], Counter()
    for p in paras:
        t = tr.get(p["id"], {})
        row = t.get("better") or t.get("base")
        if not row:
            if p["kind"] == "raw":
                parts.append(p["text"]); continue
            return None
        parts.append(row["text"])
        if row["provider"] != "none":
            models[(row["provider"], row["model"])] += 1
    (prov, model), _ = models.most_common(1)[0] if models else (("none", ""), 0)
    return {"text": "\n\n".join(parts), "provider": prov, "model": model, "assembled": True}


# ------------------------------------------------------------------ glossary

STOP = set("""The A An I In On At Of And But Or If It Its He She They We You His Her Their Our My Me This That These Those
When Where What Why How Who Whom Which There Here Then Than So As For From To With Without By Not No Yes All Any Some
Mr Mrs Ms Dr Chapter Part Book Page One Two Three First Second Third Also Yet Now Still Even Just Only Such
Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September
October November December Contents Introduction Preface Index Figure Table""".split())
CAP_SEQ = re.compile(r"\b([A-Z][a-z]{2,}(?:\s+(?:of\s+|the\s+)?[A-Z][a-z]{2,}){0,3})\b")


def name_counts(book_id: int) -> tuple[Counter, dict[str, str]]:
    """Capitalised names and their counts. A capitalised word at the start of a sentence counts
    only if the same word never appears in lower case elsewhere (so "Elinor" counts, "However" does not)."""
    paras = db.rows("SELECT text FROM paragraphs WHERE book_id=? AND kind='p'", (book_id,))
    lower = set()
    for p in paras:
        lower.update(re.findall(r"\b[a-z][a-z']+\b", p["text"]))
    counts: Counter = Counter()
    example: dict[str, str] = {}
    for p in paras:
        for sent in re.split(r"(?<=[.!?])\s+", p["text"]):
            for m in CAP_SEQ.finditer(sent):
                term = m.group(1)
                first = term.split()[0]
                if first in STOP:
                    continue
                lead = sent[:m.start()].strip(" \"'“‘(—-")
                if not lead and first.lower() in lower:
                    continue
                counts[term] += 1
                example.setdefault(term, sent[:180])
    return counts, example


def glossary_candidates(book_id: int, top: int = 80) -> list[tuple[str, str]]:
    counts, example = name_counts(book_id)
    existing = {r["term"] for r in db.rows("SELECT term FROM glossary WHERE book_id=?", (book_id,))}
    return [(t, example[t]) for t, c in counts.most_common(top * 2) if c >= 3 and t not in existing][:top]


def build_glossary(book_id: int) -> int:
    s = load_settings()
    db.run("UPDATE books SET glossary_status='running' WHERE id=?", (book_id,))
    try:
        cands = glossary_candidates(book_id)
        if not cands:
            db.run("UPDATE books SET glossary_status='done' WHERE id=?", (book_id,))
            return 0
        provider, model, _ = resolve("glossary", s)
        added = 0
        counts = {t: 0 for t, _ in cands}
        for i in range(0, len(cands), 40):
            out = chat(provider, model, prompts.GLOSSARY_SYS, prompts.glossary(cands[i:i + 40]),
                       settings=s, task="glossary", json_mode=True)
            data = parse_json(out)
            for t in (data.get("terms", []) if isinstance(data, dict) else data):
                if isinstance(t, dict) and t.get("term") and t.get("fa"):
                    kind = str(t.get("kind") or "other").lower().strip()
                    kind = kind if kind in ("person", "place", "org", "concept") else "other"
                    db.run("INSERT OR IGNORE INTO glossary(book_id, term, fa, count, manual, kind) VALUES(?,?,?,?,0,?)",
                           (book_id, t["term"].strip(), t["fa"].strip(), counts.get(t["term"], 0), kind))
                    added += 1
        db.run("UPDATE books SET glossary_status='done' WHERE id=?", (book_id,))
        return added
    except Exception as e:
        db.run("UPDATE books SET glossary_status=? WHERE id=?", ("error: " + str(e)[:300], book_id))
        raise


# ------------------------------------------------------------------ lookup

def lookup(word: str, sentence: str) -> dict:
    s = load_settings()
    provider, model, _ = resolve("lookup", s)
    key = hashlib.sha256(f"{model}|{word.lower()}|{sentence}".encode()).hexdigest()
    hit = db.one("SELECT data FROM lookups WHERE key=?", (key,))
    if hit:
        return json.loads(hit["data"])
    out = chat(provider, model, prompts.LOOKUP_SYS, prompts.lookup(word, sentence), settings=s, task="lookup", json_mode=True)
    data = parse_json(out)
    if not isinstance(data, dict):
        raise LLMError("پاسخ مدل قابل خواندن نبود")
    data["word"] = data.get("word") or word
    data["_model"] = f"{provider} · {model}"
    db.run("INSERT OR REPLACE INTO lookups(key, data, created) VALUES(?,?,?)", (key, json.dumps(data, ensure_ascii=False), db.now()))
    return data


# ------------------------------------------------------------------ model comparison

def compare(book_id: int, page: int, targets: list[dict], max_chars: int = 1200) -> dict:
    s = load_settings()
    paras = [p for p in page_paragraphs(book_id, page) if p["kind"] != "raw"]
    sample, size = [], 0
    for p in paras:
        if sample and size + len(p["text"]) > max_chars:
            break
        sample.append(p); size += len(p["text"])
    gloss = glossary_for(book_id)
    results = []
    for t in targets[:4]:
        prov, model = t.get("provider"), (t.get("model") or "").strip()
        if not model:
            continue
        before = db.one("SELECT COALESCE(MAX(id),0) m FROM usage")["m"]
        t0 = time.time()
        try:
            outs = [chat(prov, model, prompts.TRANSLATOR, prompts.single(p["text"], prompts.relevant_terms(gloss, p["text"])),
                         settings=s, task="compare") for p in sample]
            err = None
        except LLMError as e:
            outs, err = [], str(e)
        u = db.one("SELECT COALESCE(SUM(in_tok),0) i, COALESCE(SUM(out_tok),0) o FROM usage WHERE id>?", (before,))
        results.append({"provider": prov, "model": model, "seconds": round(time.time() - t0, 1),
                        "in_tok": u["i"], "out_tok": u["o"], "items": outs, "error": err})
    return {"source": [p["text"] for p in sample], "results": results}


# ------------------------------------------------------------------ glossary jobs (background)

_gloss_running: set[int] = set()
_gloss_lock = threading.Lock()


def start_glossary(book_id: int) -> bool:
    with _gloss_lock:
        if book_id in _gloss_running:
            return False
        _gloss_running.add(book_id)

    def job():
        try:
            build_glossary(book_id)
        except Exception as e:  # noqa: BLE001
            if not isinstance(e, LLMError):
                traceback.print_exc()
        finally:
            with _gloss_lock:
                _gloss_running.discard(book_id)
    db.run("UPDATE books SET glossary_status='running' WHERE id=?", (book_id,))
    threading.Thread(target=job, daemon=True).start()
    return True
