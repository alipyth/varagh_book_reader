"""Study tools: find a term in the book, character graph, mind maps, image prompts.

The character graph itself is computed locally (names that appear in the same
paragraph are linked), so it is free and instant. A model is only called when
you ask it to explain one relationship, build a mind map, or write an image prompt.
"""
from __future__ import annotations

import itertools
import json
import re
from collections import Counter, defaultdict

from . import db, prompts
from .config import load_settings
from .providers import LLMError, chat, open_stream, parse_json
from .router import resolve
from .translate import _finish, name_counts


def _pattern(term: str) -> re.Pattern:
    return re.compile(r"(?<![A-Za-z])" + re.escape(term) + r"(?![A-Za-z])", re.I)


# ------------------------------------------------------------------ find
def find(book_id: int, term: str) -> dict:
    term = term.strip()
    if not term:
        return {"term": term, "pages": [], "total": 0}
    pat = _pattern(term)
    rows = db.rows("SELECT page, text FROM paragraphs WHERE book_id=? AND text LIKE ? ORDER BY idx",
                   (book_id, f"%{term}%"))
    pages: dict[int, dict] = {}
    for r in rows:
        ms = list(pat.finditer(r["text"]))
        if not ms:
            continue
        pg = pages.setdefault(r["page"], {"page": r["page"], "count": 0, "snippet": ""})
        pg["count"] += len(ms)
        if not pg["snippet"]:
            m = ms[0]
            s, e = max(0, m.start() - 70), min(len(r["text"]), m.end() + 70)
            pg["snippet"] = ("…" if s else "") + r["text"][s:e] + ("…" if e < len(r["text"]) else "")
    out = sorted(pages.values(), key=lambda x: x["page"])
    return {"term": term, "pages": out, "total": sum(p["count"] for p in out)}


# ------------------------------------------------------------------ graph
def _entities(book_id: int) -> tuple[list[dict], bool]:
    """Glossary terms if there are any; otherwise capitalised names found in the text."""
    g = db.rows("SELECT term, fa, kind FROM glossary WHERE book_id=?", (book_id,))
    if g:
        return [{"id": r["term"], "fa": r["fa"], "kind": r["kind"] or "other"} for r in g], True
    counts, _ = name_counts(book_id)
    return [{"id": t, "fa": "", "kind": "other"} for t, c in counts.most_common(60) if c >= 3], False


def graph(book_id: int, upto: int, kinds: set[str] | None = None, max_nodes: int = 40) -> dict:
    ents, from_glossary = _entities(book_id)
    if kinds:
        ents = [e for e in ents if e["kind"] in kinds]
    if not ents:
        return {"nodes": [], "edges": [], "from_glossary": from_glossary}
    # longest names first so "Walden Pond" wins over "Walden" inside the same span
    ents.sort(key=lambda e: -len(e["id"]))
    pats = [(e["id"], _pattern(e["id"])) for e in ents]
    count: Counter = Counter()
    first: dict[str, int] = {}
    co: Counter = Counter()
    for p in db.rows("SELECT page, text FROM paragraphs WHERE book_id=? AND page<=? AND kind<>'raw' ORDER BY idx", (book_id, upto)):
        text, present = p["text"], []
        for eid, pat in pats:
            n = len(pat.findall(text))
            if n:
                count[eid] += n
                first.setdefault(eid, p["page"])
                present.append(eid)
        for a, b in itertools.combinations(sorted(set(present)), 2):
            co[(a, b)] += 1
    top = {eid for eid, _ in count.most_common(max_nodes)}
    by_id = {e["id"]: e for e in ents}
    nodes = [{"id": eid, "fa": by_id[eid]["fa"], "kind": by_id[eid]["kind"], "count": count[eid], "first": first[eid]}
             for eid in top]
    edges = [(a, b, w) for (a, b), w in co.items() if a in top and b in top]
    edges.sort(key=lambda x: -x[2])
    min_w = 2 if len(edges) > 60 else 1
    edges = [e for e in edges if e[2] >= min_w][:150]
    labels = {(r["a"], r["b"]): r for r in db.rows("SELECT a, b, label, summary, upto FROM relations WHERE book_id=?", (book_id,))}
    out_edges = []
    for a, b, w in edges:
        lab = labels.get((a, b))
        out_edges.append({"a": a, "b": b, "w": w, "label": lab["label"] if lab else None,
                          "summary": lab["summary"] if lab else None, "label_upto": lab["upto"] if lab else None})
    return {"nodes": nodes, "edges": out_edges, "from_glossary": from_glossary, "upto": upto}


def explain_relation(book_id: int, a: str, b: str, upto: int) -> dict:
    a, b = sorted([a, b])
    pa, pb = _pattern(a), _pattern(b)
    ex = []
    for p in db.rows("SELECT page, text FROM paragraphs WHERE book_id=? AND page<=? ORDER BY idx", (book_id, upto)):
        if pa.search(p["text"]) and pb.search(p["text"]):
            ex.append(p["text"][:700])
    if not ex:
        raise LLMError("این دو تا این صفحه با هم در یک پاراگراف نیامده‌اند.")
    # a spread of excerpts: the first, the latest, and some in between
    pick = ex if len(ex) <= 5 else [ex[0], ex[len(ex) // 3], ex[len(ex) // 2], ex[2 * len(ex) // 3], ex[-1]]
    s = load_settings()
    provider, model, _ = resolve("graph", s)
    out = parse_json(chat(provider, model, prompts.RELATION_SYS, prompts.relation(a, b, pick),
                          settings=s, task="graph", json_mode=True))
    if not isinstance(out, dict) or not out.get("label"):
        raise LLMError("مدل توضیح قابل استفاده‌ای برنگرداند؛ دوباره امتحان کن.")
    db.run("INSERT OR REPLACE INTO relations(book_id, a, b, label, summary, upto, model, created) VALUES(?,?,?,?,?,?,?,?)",
           (book_id, a, b, out["label"].strip(), (out.get("summary") or "").strip(), upto, model, db.now()))
    return {"a": a, "b": b, "label": out["label"].strip(), "summary": (out.get("summary") or "").strip(), "upto": upto}


# ------------------------------------------------------------------ mind map
def chapter_range(book_id: int, page: int) -> tuple[int, int, str] | None:
    b = db.one("SELECT toc_json, pages FROM books WHERE id=?", (book_id,))
    toc = json.loads(b["toc_json"] or "[]")
    if not toc:
        return None
    top_level = min(t[0] for t in toc)
    heads = [t for t in toc if t[0] <= top_level + 1]
    cur = None
    for i, t in enumerate(heads):
        if t[2] <= page:
            cur = i
    if cur is None:
        return None
    start = heads[cur][2]
    end = (heads[cur + 1][2] - 1) if cur + 1 < len(heads) else b["pages"]
    return start, max(start, end), heads[cur][1]


def get_mindmap(book_id: int, start: int, end: int) -> dict | None:
    r = db.one("SELECT data, provider, model, created FROM mindmaps WHERE book_id=? AND start_page=? AND end_page=?",
               (book_id, start, end))
    if not r:
        return None
    return {"tree": json.loads(r["data"]), "provider": r["provider"], "model": r["model"], "start": start, "end": end}


def build_mindmap(book_id: int, start: int, end: int) -> dict:
    s = load_settings()
    provider, model, _ = resolve("mindmap", s)
    paras = db.rows("SELECT text FROM paragraphs WHERE book_id=? AND page BETWEEN ? AND ? AND kind<>'raw' ORDER BY idx",
                    (book_id, start, end))
    if not paras:
        raise LLMError("این محدوده متنی ندارد.")
    text = "\n\n".join(p["text"] for p in paras)
    mm_key = {"openai": "mindmap_chunk_chars_openai", "cli2api": "mindmap_chunk_chars_cli2api"}.get(
        provider, "mindmap_chunk_chars_ollama"
    )
    limit = int(s["reading"].get(mm_key, 18000 if provider == "cli2api" else 3000))
    label = "book page" if start == end else f"book passage (pages {start}-{end})"
    if len(text) > limit:
        # map-reduce: short Persian notes per chunk, then one mind map from the notes
        chunks, cur = [], ""
        for p in paras:
            if cur and len(cur) + len(p["text"]) > limit:
                chunks.append(cur); cur = ""
            cur += p["text"] + "\n\n"
        if cur:
            chunks.append(cur)
        notes = [chat(provider, model, prompts.NOTES_SYS, prompts.notes(c), settings=s, task="mindmap",
                      num_ctx=s["ollama"].get("num_ctx_page")) for c in chunks]
        text = "\n".join(notes)
        label = f"notes taken from a book passage (pages {start}-{end})"
    out = parse_json(chat(provider, model, prompts.MINDMAP_SYS, prompts.mindmap(text, label), settings=s,
                          task="mindmap", json_mode=True, num_ctx=s["ollama"].get("num_ctx_page")))
    tree = _clean_tree(out)
    if not tree.get("children"):
        raise LLMError("مدل نقشه‌ی ذهنی قابل استفاده‌ای برنگرداند؛ دوباره امتحان کن یا مدل قوی‌تری انتخاب کن.")
    db.run("INSERT OR REPLACE INTO mindmaps(book_id, start_page, end_page, data, provider, model, created) VALUES(?,?,?,?,?,?,?)",
           (book_id, start, end, json.dumps(tree, ensure_ascii=False), provider, model, db.now()))
    return {"tree": tree, "provider": provider, "model": model, "start": start, "end": end}


def _clean_tree(node, depth: int = 0) -> dict:
    if isinstance(node, list):
        node = {"title": "", "children": node}
    if not isinstance(node, dict):
        return {"title": str(node)[:120], "children": []}
    title = str(node.get("title") or node.get("name") or node.get("text") or "").strip()[:160]
    kids = node.get("children") or node.get("branches") or []
    kids = [_clean_tree(k, depth + 1) for k in kids if k] if depth < 4 and isinstance(kids, list) else []
    return {"title": title, "children": [k for k in kids if k["title"]]}


# ------------------------------------------------------------------ image prompt
STYLES = {
    "cinematic": "cinematic film still, dramatic lighting, shallow depth of field",
    "watercolor": "loose watercolor illustration, soft washes, visible paper texture",
    "oil": "classical oil painting, rich brushwork, painterly light",
    "storybook": "children's storybook illustration, warm, gentle, hand-drawn",
    "persian": "Persian miniature painting style, flat perspective, ornate borders, jewel-like colors",
    "ink": "black ink drawing, cross-hatching, engraving style",
    "anime": "anime key visual, detailed background art",
    "photo": "photorealistic, natural light, 35mm photograph",
    "concept": "digital concept art, epic scale, atmospheric",
}


def stream_image_prompt(book_id: int, page: int, style: str, aspect: str, lang: str, wish: str):
    s = load_settings()
    paras = db.rows("SELECT text FROM paragraphs WHERE book_id=? AND page=? AND kind<>'raw' ORDER BY idx", (book_id, page))
    if not paras:
        raise LLMError("این صفحه متنی ندارد که از آن تصویر ساخته شود.")
    provider, model, _ = resolve("image_prompt", s)
    text = "\n\n".join(p["text"] for p in paras)
    text = text[: (12000 if provider == "openai" else 8000 if provider == "cli2api" else 3500)]
    style_txt = STYLES.get(style, style or STYLES["cinematic"])
    gen = open_stream(provider, model, prompts.IMAGE_SYS, prompts.image_prompt(text, style_txt, aspect, lang, wish.strip()[:300]),
                      settings=s, task="image_prompt", num_ctx=s["ollama"].get("num_ctx_page"))

    def save(t):
        db.run("INSERT INTO image_prompts(book_id, page, style, aspect, lang, wish, text, provider, model, created) "
               "VALUES(?,?,?,?,?,?,?,?,?,?)", (book_id, page, style, aspect, lang, wish, t.strip().strip('"'), provider, model, db.now()))
    return {"provider": provider, "model": model}, _finish(gen, save)


def image_prompts(book_id: int, page: int) -> list[dict]:
    return db.rows("SELECT id, style, aspect, lang, wish, text, provider, model, created FROM image_prompts "
                   "WHERE book_id=? AND page=? ORDER BY id DESC LIMIT 10", (book_id, page))


# ------------------------------------------------------------------ "who was this?" card (no model call)
def _sentence_with(text: str, pat: re.Pattern) -> str:
    for sent in re.split(r"(?<=[.!?…])\s+", text):
        if pat.search(sent):
            return sent[:260]
    return text[:260]


def who(book_id: int, term: str, upto: int) -> dict:
    g = db.one("SELECT term, fa, kind FROM glossary WHERE book_id=? AND term=?", (book_id, term))
    if not g:
        raise LLMError("این نام در واژه‌نامه نیست")
    pat = _pattern(term)
    others = [r for r in db.rows("SELECT term, fa FROM glossary WHERE book_id=? AND term<>?", (book_id, term))]
    opats = [(o["term"], o["fa"], _pattern(o["term"])) for o in others]
    count, first, last, pages = 0, None, None, set()
    co: Counter = Counter()
    for p in db.rows("SELECT page, text FROM paragraphs WHERE book_id=? AND page<=? AND kind<>'raw' ORDER BY idx", (book_id, upto)):
        n = len(pat.findall(p["text"]))
        if not n:
            continue
        count += n
        pages.add(p["page"])
        snip = {"page": p["page"], "text": _sentence_with(p["text"], pat)}
        first = first or snip
        last = snip
        for ot, _, op in opats:
            if op.search(p["text"]):
                co[ot] += 1
    labels = {}
    for r in db.rows("SELECT a, b, label, summary FROM relations WHERE book_id=? AND (a=? OR b=?)", (book_id, term, term)):
        labels[r["b"] if r["a"] == term else r["a"]] = {"label": r["label"], "summary": r["summary"]}
    fa_of = {o["term"]: o["fa"] for o in others}
    links = [{"term": t, "fa": fa_of.get(t, ""), "w": w, **labels.get(t, {})} for t, w in co.most_common(6)]
    return {"term": term, "fa": g["fa"], "kind": g["kind"] or "other", "count": count, "pages": len(pages),
            "first": first, "last": last if last and first and last["page"] != first["page"] else None,
            "links": links, "upto": upto}


# ------------------------------------------------------------------ recap and chapter questions
def _range_text(book_id: int, start: int, end: int, marks: bool = False) -> list[tuple[int, str]]:
    rows = db.rows("SELECT page, text FROM paragraphs WHERE book_id=? AND page BETWEEN ? AND ? AND kind<>'raw' ORDER BY idx",
                   (book_id, start, end))
    return [(r["page"], r["text"]) for r in rows]


def _condense(book_id: int, start: int, end: int, provider: str, model: str, s: dict, task: str, marks: bool) -> tuple[str, bool]:
    """Returns (text, condensed). Long ranges are first reduced to short notes, chunk by chunk."""
    paras = _range_text(book_id, start, end)
    if not paras:
        raise LLMError("این محدوده متنی ندارد.")
    fmt = (lambda pg, t: f"[p.{pg}] {t}") if marks else (lambda pg, t: t)
    full = "\n\n".join(fmt(pg, t) for pg, t in paras)
    mm_key = {"openai": "mindmap_chunk_chars_openai", "cli2api": "mindmap_chunk_chars_cli2api"}.get(
        provider, "mindmap_chunk_chars_ollama"
    )
    limit = int(s["reading"].get(mm_key, 18000 if provider == "cli2api" else 3000))
    if len(full) <= limit:
        return full, False
    chunks, cur = [], ""
    for pg, t in paras:
        piece = fmt(pg, t) + "\n\n"
        if cur and len(cur) + len(piece) > limit:
            chunks.append(cur); cur = ""
        cur += piece
    if cur:
        chunks.append(cur)
    notes = [chat(provider, model, prompts.NOTES_SYS, prompts.notes(c, keep_pages=marks), settings=s, task=task,
                  num_ctx=s["ollama"].get("num_ctx_page")) for c in chunks]
    return "\n".join(notes), True


def recap_range(book_id: int, page: int) -> tuple[int, int]:
    return max(1, page - 9), page


def get_recap(book_id: int, start: int, end: int) -> dict | None:
    return db.one("SELECT text, provider, model, created FROM recaps WHERE book_id=? AND start_page=? AND end_page=?",
                  (book_id, start, end))


def stream_recap(book_id: int, start: int, end: int):
    s = load_settings()
    provider, model, _ = resolve("recap", s)
    text, _ = _condense(book_id, start, end, provider, model, s, "recap", marks=False)
    gen = open_stream(provider, model, prompts.RECAP_SYS, prompts.recap(text), settings=s, task="recap",
                      num_ctx=s["ollama"].get("num_ctx_page"))

    def save(t):
        db.run("INSERT OR REPLACE INTO recaps(book_id, start_page, end_page, text, provider, model, created) VALUES(?,?,?,?,?,?,?)",
               (book_id, start, end, t, provider, model, db.now()))
    return {"provider": provider, "model": model}, _finish(gen, save)


def get_quiz(book_id: int, start: int, end: int) -> dict | None:
    r = db.one("SELECT data, provider, model FROM quizzes WHERE book_id=? AND start_page=? AND end_page=?", (book_id, start, end))
    if not r:
        return None
    d = json.loads(r["data"]); d.update(provider=r["provider"], model=r["model"])
    return d


def build_quiz(book_id: int, start: int, end: int) -> dict:
    s = load_settings()
    provider, model, _ = resolve("quiz", s)
    text, _ = _condense(book_id, start, end, provider, model, s, "quiz", marks=True)
    out = parse_json(chat(provider, model, prompts.QUIZ_SYS, prompts.quiz(text), settings=s, task="quiz",
                          json_mode=True, num_ctx=s["ollama"].get("num_ctx_page")))
    if not isinstance(out, dict):
        raise LLMError("مدل سؤال قابل استفاده‌ای برنگرداند؛ دوباره امتحان کن.")
    qs = []
    for q in out.get("questions") or []:
        if not isinstance(q, dict) or not q.get("q"):
            continue
        try:
            pg = int(q.get("page") or 0)
        except (TypeError, ValueError):
            pg = 0
        qs.append({"q": str(q["q"]).strip(), "a": str(q.get("a") or "").strip(),
                   "type": "reflect" if str(q.get("type", "")).startswith("reflect") else "recall",
                   "page": pg if start <= pg <= end else 0})
    if not qs:
        raise LLMError("مدل سؤال قابل استفاده‌ای برنگرداند؛ دوباره امتحان کن یا مدل قوی‌تری انتخاب کن.")
    data = {"summary": str(out.get("summary") or "").strip(), "questions": qs}
    db.run("INSERT OR REPLACE INTO quizzes(book_id, start_page, end_page, data, provider, model, created) VALUES(?,?,?,?,?,?,?)",
           (book_id, start, end, json.dumps(data, ensure_ascii=False), provider, model, db.now()))
    data.update(provider=provider, model=model)
    return data


def quiz_feedback(book_id: int, start: int, end: int, idx: int, answer: str) -> dict:
    qz = get_quiz(book_id, start, end)
    if not qz or not 0 <= idx < len(qz["questions"]):
        raise LLMError("سؤال پیدا نشد")
    q = qz["questions"][idx]
    s = load_settings()
    provider, model, _ = resolve("quiz", s)
    out = parse_json(chat(provider, model, prompts.QUIZ_SYS, prompts.feedback(q["q"], q["a"], answer[:1500], q["type"]),
                          settings=s, task="quiz", json_mode=True))
    if not isinstance(out, dict):
        raise LLMError("پاسخ مدل قابل خواندن نبود")
    v = str(out.get("verdict") or "").lower()
    return {"verdict": v if v in ("correct", "partial", "wrong") else "partial", "feedback": str(out.get("feedback") or "").strip()}
