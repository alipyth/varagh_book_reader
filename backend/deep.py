"""Deep learning engine for Varagh:
1. Chapter X-Ray (pre-reading blueprint)
2. Contextual Socratic Tutor (chat with page/chapter, no spoilers)
3. Live Feynman Technique Check (explain in your own words -> pinpoint gaps)
4. Concept & Argument Graph (claims, evidence, supports/contradicts/depends_on)
5. Conceptual & Cloze FSRS Card generator (causal, cloze, scenario)
6. 4-Level Depth Explanation (eli5, technical, compare, domain analogy)
7. Devil's Advocate & Critique mode (steelman, counterarguments, blind spots)
8. Information Density Heatmap (core / example / fluff per paragraph)
9. Visual Diagram / Formula Region Analyzer
10. Cross-Book Second Brain connections & Obsidian Markdown export/sync
"""
from __future__ import annotations

import base64
import json
import math
import re
import tempfile
from collections import Counter
from pathlib import Path

import httpx
import pymupdf as fitz

from . import db, prompts
from .config import BOOKS_DIR, load_settings
from .providers import LLMError, chat, open_stream, parse_json
from .router import resolve
from .study import _condense, chapter_range
from .translate import _finish, glossary_for


def _chapter_or_window(book_id: int, page: int) -> tuple[int, int, str]:
    rng = chapter_range(book_id, page)
    if rng:
        return rng
    b = db.one("SELECT pages FROM books WHERE id=?", (book_id,))
    total = (b or {}).get("pages") or page
    start = max(1, page - 4)
    end = min(total, page + 5)
    return start, end, f"صفحه‌ی {start} تا {end}"


# ------------------------------------------------------------------ 1. Chapter X-Ray
XRAY_SYS = """You are an analytical reading coach (Mortimer Adler's Inspectional Reading).
Build a sharp pre-reading X-Ray blueprint in fluent Persian so a deep learner grasps the chapter's architecture in 60 seconds.
Use ONLY the given text. Return JSON only."""


def get_xray(book_id: int, page: int) -> dict:
    start, end, label = _chapter_or_window(book_id, page)
    r = db.one("SELECT data, provider, model, created FROM xrays WHERE book_id=? AND start_page=? AND end_page=?",
               (book_id, start, end))
    data = json.loads(r["data"]) if r else None
    if data and r:
        data.update(provider=r["provider"], model=r["model"])
    return {"start": start, "end": end, "label": label, "xray": data}


def build_xray(book_id: int, page: int) -> dict:
    start, end, label = _chapter_or_window(book_id, page)
    s = load_settings()
    provider, model, _ = resolve("mindmap", s)
    text, _ = _condense(book_id, start, end, provider, model, s, "mindmap", marks=True)
    user = (
        "Create a pre-reading X-Ray blueprint for this chapter in Persian. Return JSON with this exact schema:\n"
        '{"thesis":"1-2 sentence central thesis of the chapter",'
        '"core_claims":[{"claim":"concise core claim","page":12}],'
        '"key_questions":["3 to 4 questions this chapter tries to answer"],'
        '"prerequisites":["2 to 3 concepts/terms to keep in mind"],'
        '"read_slow":["2 to 3 high-value ideas/sections worth deep attention"],'
        '"can_skim":["1 to 3 illustrative stories/repetitions safe to skim"],'
        '"takeaway":"one memorable bottom-line insight"}\n\n---\n' + text
    )
    out = parse_json(chat(provider, model, XRAY_SYS, user, settings=s, task="mindmap",
                          json_mode=True, num_ctx=s["ollama"].get("num_ctx_page")))
    if not isinstance(out, dict) or not out.get("thesis"):
        raise LLMError("مدل نقشه‌ی پیش‌خوانی معتبر برنگرداند؛ دوباره امتحان کن.")
    db.run("INSERT OR REPLACE INTO xrays(book_id, start_page, end_page, data, provider, model, created) VALUES(?,?,?,?,?,?,?)",
           (book_id, start, end, json.dumps(out, ensure_ascii=False), provider, model, db.now()))
    out.update(provider=provider, model=model)
    return {"start": start, "end": end, "label": label, "xray": out}


# ------------------------------------------------------------------ 2. Contextual Socratic Tutor
TUTOR_SYS = """You are an extraordinary, crystal-clear Persian teacher and Socratic tutor (like 3Blue1Brown + Richard Feynman).
Rules:
- Explain in warm, vivid, simple Persian first—use concrete everyday analogies before formal terms.
- Format all math in proper LaTeX ($...$ inline, $$...$$ display).
- Ground every answer in the book text up to the reader's current page (NEVER spoil later pages).
- Whenever a mathematical function, curve, or quantitative relationship helps intuition, include ONE interactive plot block using this exact fenced syntax:
```plot
{"title":"عنوان نمودار","x_label":"x","y_label":"f(x)","x_min":-5,"x_max":5,"params":[{"name":"w0","label":"بایاس","min":-5,"max":5,"step":0.5,"default":0},{"name":"w1","label":"وزن / شیب","min":-3,"max":3,"step":0.2,"default":1}],"curves":[{"label":"خطی","expr":"w0 + w1*x","color":"#2159A0"},{"label":"غیرخطی","expr":"w0 + w1*x*x","color":"#E3A92B"}]}
```
(Allowed math ops in expr: + - * / ^, sin, cos, tan, exp, log, sqrt, abs, tanh, sigmoid, x, and your param names.)
- When mode is 'grill', ask 2-3 probing Socratic questions that test real understanding.
- When mode is 'practice', give a super simple intuition, an interactive ```plot``` if relevant, and 2 short hands-on practice questions (with answers hidden in a clear section at the end).
- Otherwise answer clearly, concisely, and end with 1 short follow-up question."""


def get_tutor_history(book_id: int, page: int) -> list[dict]:
    return db.rows(
        "SELECT id, role, content, provider, model, created FROM tutor_msgs WHERE book_id=? AND page=? ORDER BY id",
        (book_id, page),
    )


def clear_tutor_history(book_id: int, page: int) -> None:
    db.run("DELETE FROM tutor_msgs WHERE book_id=? AND page=?", (book_id, page))


def stream_tutor(book_id: int, page: int, message: str, mode: str = "ask", para_id: int | None = None):
    s = load_settings()
    provider, model, _ = resolve("explain", s)
    # Build spoiler-free context: current page + brief prior pages
    cur_paras = db.rows("SELECT id, text FROM paragraphs WHERE book_id=? AND page=? AND kind<>'raw' ORDER BY idx",
                        (book_id, page))
    prev_paras = db.rows("SELECT page, text FROM paragraphs WHERE book_id=? AND page BETWEEN ? AND ? AND kind<>'raw' ORDER BY idx",
                         (book_id, max(1, page - 2), max(1, page - 1)))
    focus_para = db.one("SELECT text FROM paragraphs WHERE id=?", (para_id,)) if para_id else None

    cur_text = "\n\n".join(p["text"] for p in cur_paras)[:4500]
    prev_text = "\n".join(f"[p.{p['page']}] {p['text']}" for p in prev_paras)[-2000:]
    hist = get_tutor_history(book_id, page)[-8:]
    hist_txt = "\n".join(f"{'خواننده' if h['role'] == 'user' else 'استاد'}: {h['content']}" for h in hist)

    msg = message.strip()
    if mode == "grill" and not msg:
        msg = "با ۲ تا ۳ سؤال سقراطی عمیق مرا از این صفحه بسنج تا ببینم واقعاً درکش کرده‌ام یا فقط فکر می‌کنم فهمیده‌ام."
    elif mode == "connect" and not msg:
        msg = "ایده‌های این صفحه چه ربطی به صفحه‌های قبلی دارند و چه چیزی به بحث اضافه می‌کنند؟"
    elif mode == "practice" and not msg:
        msg = "مفهوم یا فرمول اصلی این صفحه را خیلی ساده توضیح بده، اگر نمودار لازم دارد یک نمودار تعاملی رسم کن، و ۲ تمرین عملی و کوتاه بده."

    if not msg:
        raise LLMError("پیامت خالی است")

    db.run("INSERT INTO tutor_msgs(book_id, page, role, content, provider, model, created) VALUES(?,?,?,?,?,?,?)",
           (book_id, page, "user", msg, "", "", db.now()))

    user_prompt = (
        f"Mode: {mode}\nCurrent page: {page}\n"
        + (f"\nPrevious pages excerpt (context):\n{prev_text}\n" if prev_text else "")
        + f"\nCurrent page text:\n{cur_text}\n"
        + (f"\nFocused paragraph:\n{focus_para['text']}\n" if focus_para else "")
        + (f"\nConversation so far:\n{hist_txt}\n" if hist_txt else "")
        + f"\nReader's message:\n{msg}"
    )

    gen = open_stream(provider, model, TUTOR_SYS, user_prompt, settings=s, task="explain",
                      num_ctx=s["ollama"].get("num_ctx_page"))

    def save(t: str):
        db.run("INSERT INTO tutor_msgs(book_id, page, role, content, provider, model, created) VALUES(?,?,?,?,?,?,?)",
               (book_id, page, "assistant", t.strip(), provider, model, db.now()))

    return {"provider": provider, "model": model}, _finish(gen, save)


# ------------------------------------------------------------------ 3. Live Feynman Technique Check
FEYNMAN_SYS = """You are a rigorous Feynman-technique mentor for a Persian-speaking learner.
The learner tried to explain a concept/chapter in their own simple words.
Compare their explanation against the source chapter text. Find EXACT gaps, hand-waving, logical jumps, or hidden assumptions, and quote the relevant part of the book.
Write in Persian. Return JSON only."""


def get_feynman(book_id: int, page: int) -> dict:
    start, end, label = _chapter_or_window(book_id, page)
    items = db.rows(
        "SELECT id, topic, explanation, feedback_json, provider, model, created FROM feynman "
        "WHERE book_id=? AND start_page=? AND end_page=? ORDER BY id DESC LIMIT 10",
        (book_id, start, end),
    )
    for it in items:
        it["feedback"] = json.loads(it.pop("feedback_json") or "{}")
    return {"start": start, "end": end, "label": label, "items": items}


def check_feynman(book_id: int, page: int, topic: str, explanation: str) -> dict:
    if len(explanation.strip()) < 25:
        raise LLMError("اول حداقل دو جمله با کلمه‌های خودت توضیح بده.")
    start, end, label = _chapter_or_window(book_id, page)
    s = load_settings()
    provider, model, _ = resolve("quiz", s)
    src, _ = _condense(book_id, start, end, provider, model, s, "quiz", marks=True)
    user = (
        f"Chapter ({label}):\n{src[:7000]}\n\n"
        f"Topic the learner is explaining: {topic.strip() or label}\n"
        f"Learner's explanation:\n{explanation.strip()[:3000]}\n\n"
        "Evaluate rigorously. Return JSON:\n"
        '{"score":0-100,'
        '"clear_parts":["1-3 things the learner explained accurately"],'
        '"gaps":[{"missing":"what is missing, vague, or inaccurate","book_quote":"short English/Persian reference from source","page":12}],'
        '"hidden_assumptions":["1-2 unstated assumptions or logical leaps"],'
        '"simpler_analogy":"a crystal-clear Persian analogy to lock in the hardest part",'
        '"next_step":"one concrete sentence telling the learner what to re-explain"}'
    )
    out = parse_json(chat(provider, model, FEYNMAN_SYS, user, settings=s, task="quiz",
                          json_mode=True, num_ctx=s["ollama"].get("num_ctx_page")))
    if not isinstance(out, dict):
        raise LLMError("پاسخ مدل قابل خواندن نبود")
    db.run(
        "INSERT INTO feynman(book_id, start_page, end_page, topic, explanation, feedback_json, provider, model, created) VALUES(?,?,?,?,?,?,?,?,?)",
        (book_id, start, end, (topic.strip() or label)[:200], explanation.strip()[:3000],
         json.dumps(out, ensure_ascii=False), provider, model, db.now()),
    )
    return {"start": start, "end": end, "label": label, "feedback": out, "provider": provider, "model": model}


# ------------------------------------------------------------------ 4. Concept & Argument Graph
CONCEPT_SYS = """You extract conceptual & logical argument graphs from books for a Persian-speaking deep learner.
Focus on CONCEPTS, CLAIMS, EVIDENCE, and LOGICAL RELATIONS (not just proper names).
Write all labels and summaries in concise Persian. Return JSON only."""


def get_concept_graph(book_id: int, start: int, end: int) -> dict | None:
    r = db.one("SELECT data, provider, model FROM concept_graphs WHERE book_id=? AND start_page=? AND end_page=?",
               (book_id, start, end))
    if not r:
        return None
    d = json.loads(r["data"])
    d.update(provider=r["provider"], model=r["model"], start=start, end=end)
    return d


def build_concept_graph(book_id: int, start: int, end: int) -> dict:
    s = load_settings()
    provider, model, _ = resolve("graph", s)
    text, _ = _condense(book_id, start, end, provider, model, s, "graph", marks=True)
    user = (
        "Extract a Concept & Argument Graph of this passage (8 to 16 key nodes, 8 to 24 directed edges).\n"
        "Node kinds: concept | claim | evidence | question\n"
        "Edge relations: supports | contradicts | depends_on | causes | example_of\n"
        "Return JSON:\n"
        '{"nodes":[{"id":"n1","label":"short Persian title (max 5 words)","kind":"concept|claim|evidence|question","summary":"1-2 Persian sentences","page":12}],'
        '"edges":[{"from":"n1","to":"n2","relation":"supports|contradicts|depends_on|causes|example_of","label":"2-4 word Persian verb phrase"}]}\n\n---\n'
        + text
    )
    out = parse_json(chat(provider, model, CONCEPT_SYS, user, settings=s, task="graph",
                          json_mode=True, num_ctx=s["ollama"].get("num_ctx_page")))
    if not isinstance(out, dict) or not out.get("nodes"):
        raise LLMError("مدل گراف مفهومی معتبری برنگرداند؛ دوباره امتحان کن.")
    nodes = []
    valid_ids = set()
    for i, n in enumerate(out.get("nodes") or []):
        if not isinstance(n, dict) or not n.get("label"):
            continue
        nid = str(n.get("id") or f"n{i + 1}")
        valid_ids.add(nid)
        kind = str(n.get("kind") or "concept").lower()
        if kind not in ("concept", "claim", "evidence", "question"):
            kind = "concept"
        try:
            pg = int(n.get("page") or start)
        except (TypeError, ValueError):
            pg = start
        nodes.append({"id": nid, "label": str(n["label"]).strip()[:80], "kind": kind,
                      "summary": str(n.get("summary") or "").strip()[:350], "page": pg})
    edges = []
    for e in out.get("edges") or []:
        if not isinstance(e, dict):
            continue
        fr, to = str(e.get("from") or ""), str(e.get("to") or "")
        if fr in valid_ids and to in valid_ids and fr != to:
            rel = str(e.get("relation") or "supports").lower()
            if rel not in ("supports", "contradicts", "depends_on", "causes", "example_of"):
                rel = "supports"
            edges.append({"from": fr, "to": to, "relation": rel, "label": str(e.get("label") or rel).strip()[:50]})
    data = {"nodes": nodes, "edges": edges}
    db.run("INSERT OR REPLACE INTO concept_graphs(book_id, start_page, end_page, data, provider, model, created) VALUES(?,?,?,?,?,?,?)",
           (book_id, start, end, json.dumps(data, ensure_ascii=False), provider, model, db.now()))
    data.update(provider=provider, model=model, start=start, end=end)
    return data


# ------------------------------------------------------------------ 5. Conceptual & Cloze FSRS Cards
CARDS_SYS = """You design high-retention spaced-repetition flashcards (FSRS) for a Persian-speaking deep learner.
Never create trivial vocabulary cards; focus on mental models, causal mechanisms, and real-world application.
Write in fluent Persian. Return JSON only."""


def generate_conceptual_cards(para_id: int) -> dict:
    p = db.one("SELECT * FROM paragraphs WHERE id=?", (para_id,))
    if not p:
        raise LLMError("پاراگراف پیدا نشد")
    prev = db.one("SELECT text FROM paragraphs WHERE book_id=? AND idx=?", (p["book_id"], p["idx"] - 1))
    s = load_settings()
    provider, model, _ = resolve("quiz", s)
    ctx = f"Previous paragraph:\n{prev['text'][-500:]}\n\n" if prev else ""
    user = (
        ctx + f"Target paragraph:\n{p['text']}\n\n"
        "Generate exactly 3 distinct, high-retention Persian flashcards from this paragraph:\n"
        "1) type='causal': A deep Why/How question testing the mechanism or argument.\n"
        "2) type='cloze': A concise key statement with the crucial concept wrapped in {{...}} (e.g. «اصل {{بازگشت به میانگین}} می‌گوید...»), and put the hidden term + brief explanation in 'back'.\n"
        "3) type='scenario': A concrete real-world scenario asking which principle/idea applies and why.\n"
        'Return JSON: {"cards":[{"type":"causal|cloze|scenario","front":"...","back":"..."}]}'
    )
    out = parse_json(chat(provider, model, CARDS_SYS, user, settings=s, task="quiz", json_mode=True))
    raw_cards = out.get("cards", []) if isinstance(out, dict) else (out if isinstance(out, list) else [])
    cards = []
    for c in raw_cards[:4]:
        if isinstance(c, dict) and c.get("front") and c.get("back"):
            ctype = str(c.get("type") or "causal").lower()
            if ctype not in ("causal", "cloze", "scenario"):
                ctype = "causal"
            cards.append({"type": ctype, "front": str(c["front"]).strip(), "back": str(c["back"]).strip()})
    if not cards:
        raise LLMError("مدل کارتی تولید نکرد؛ دوباره امتحان کن.")
    return {"book_id": p["book_id"], "page": p["page"], "cards": cards, "provider": provider, "model": model}


# ------------------------------------------------------------------ 6. 4-Level Depth Explanation
DEPTH_LEVELS = {
    "eli5": "شهودی و ساده (ELI5)",
    "technical": "دقیق و فنی",
    "compare": "مقایسه با مفاهیم مشابه",
    "analogy": "قیاس با حوزه‌ی تخصصی من",
}

DEEP_EXPLAIN_SYS = """You are an elite polymath teacher explaining a dense book paragraph to a Persian-speaking learner.
Write in crisp, engaging Persian. Never spoil later parts of the book."""


def get_para_explains(para_id: int) -> dict[str, str]:
    return {r["level"]: r["text"] for r in db.rows("SELECT level, text FROM para_explains WHERE para_id=?", (para_id,))}


def stream_deep_explain(para_id: int, level: str = "eli5"):
    if level not in DEPTH_LEVELS:
        raise LLMError("سطح توضیح نامعتبر است")
    p = db.one("SELECT * FROM paragraphs WHERE id=?", (para_id,))
    if not p:
        raise LLMError("پاراگراف پیدا نشد")
    prev = db.one("SELECT text FROM paragraphs WHERE book_id=? AND idx=?", (p["book_id"], p["idx"] - 1))
    s = load_settings()
    domain = (s["reading"].get("user_domain") or "مهندسی نرم‌افزار و هوش مصنوعی").strip()
    provider, model, _ = resolve("explain", s)
    terms = prompts.relevant_terms(glossary_for(p["book_id"]), p["text"])

    instr = {
        "eli5": "Explain this paragraph intuitively in plain, vivid Persian using an everyday example anyone can visualize (3-5 sentences).",
        "technical": "Give a precise, rigorous technical/logical breakdown in Persian: exact definitions, premises, mechanism, and implications without dumbing it down (4-6 sentences).",
        "compare": "Clarify this idea in Persian by contrasting it with 2 closely related or commonly confused concepts—explicitly state where the boundary lies.",
        "analogy": f"Explain the core mechanism of this paragraph using a sharp, accurate analogy from the reader's own field: «{domain}». Point out both where the analogy fits and where it breaks.",
    }[level]

    ctx = f"Previous paragraph:\n{prev['text'][-600:]}\n\n" if prev else ""
    user = prompts.glossary_block(terms) + ctx + instr + "\n\n---\n" + p["text"]
    gen = open_stream(provider, model, DEEP_EXPLAIN_SYS, user, settings=s, task="explain")

    def save(t: str):
        db.run("INSERT OR REPLACE INTO para_explains(para_id, level, domain, text, provider, model, created) VALUES(?,?,?,?,?,?,?)",
               (para_id, level, domain if level == "analogy" else "", t.strip(), provider, model, db.now()))

    return {"provider": provider, "model": model, "level": level}, _finish(gen, save)


# ------------------------------------------------------------------ 7. Devil's Advocate & Critique Mode
CRITIQUE_SYS = """You are a sharp critical-thinking philosopher and devil's advocate for a Persian-speaking deep learner.
First steelman the author's argument fairly, then stress-test it with the strongest counterarguments, blind spots, and rival schools of thought.
Write in fluent Persian. Return JSON only."""


def get_critique(book_id: int, page: int) -> dict:
    start, end, label = _chapter_or_window(book_id, page)
    r = db.one("SELECT data, provider, model FROM critiques WHERE book_id=? AND start_page=? AND end_page=?",
               (book_id, start, end))
    data = json.loads(r["data"]) if r else None
    if data and r:
        data.update(provider=r["provider"], model=r["model"])
    return {"start": start, "end": end, "label": label, "critique": data}


def build_critique(book_id: int, page: int) -> dict:
    start, end, label = _chapter_or_window(book_id, page)
    s = load_settings()
    provider, model, _ = resolve("mindmap", s)
    text, _ = _condense(book_id, start, end, provider, model, s, "mindmap", marks=False)
    user = (
        "Critically examine this chapter/passage in Persian. Return JSON:\n"
        '{"steelman":"the strongest, fairest 2-sentence version of the author\'s argument",'
        '"counterarguments":[{"point":"sharp counterargument title","thinker":"rival thinker, field, or school of thought","detail":"2 sentences explaining the objection"}],'
        '"blind_spots":["2-3 hidden assumptions or ignored edge cases"],'
        '"overgeneralizations":["1-2 places where the author stretches the evidence"],'
        '"reflection_question":"one tough question for the reader to decide for themselves"}\n\n---\n' + text
    )
    out = parse_json(chat(provider, model, CRITIQUE_SYS, user, settings=s, task="mindmap",
                          json_mode=True, num_ctx=s["ollama"].get("num_ctx_page")))
    if not isinstance(out, dict) or not out.get("steelman"):
        raise LLMError("مدل نقد معتبری برنگرداند؛ دوباره امتحان کن.")
    db.run("INSERT OR REPLACE INTO critiques(book_id, start_page, end_page, data, provider, model, created) VALUES(?,?,?,?,?,?,?)",
           (book_id, start, end, json.dumps(out, ensure_ascii=False), provider, model, db.now()))
    out.update(provider=provider, model=model)
    return {"start": start, "end": end, "label": label, "critique": out}


# ------------------------------------------------------------------ 8. Information Density Heatmap
HEATMAP_SYS = """You classify paragraphs on a book page by information density so a fast deep learner knows where to slow down and where to skim.
Categories:
- core: central thesis, key definition, novel mechanism, crucial argument (read slowly)
- example: illustration, story, case study, supporting quote/data
- fluff: transition, intro/outro filler, repetition of an earlier point (safe to skim)
Return JSON only."""


def get_heatmap(book_id: int, page: int) -> dict | None:
    r = db.one("SELECT data, provider, model FROM page_heatmap WHERE book_id=? AND page=?", (book_id, page))
    if not r:
        return None
    return {"items": json.loads(r["data"]), "provider": r["provider"], "model": r["model"]}


def build_heatmap(book_id: int, page: int) -> dict:
    paras = db.rows("SELECT id, text FROM paragraphs WHERE book_id=? AND page=? AND kind<>'raw' ORDER BY idx", (book_id, page))
    if not paras:
        raise LLMError("این صفحه متنی برای تحلیل چگالی ندارد.")
    s = load_settings()
    provider, model, _ = resolve("translate_para", s)
    payload = "\n\n".join(f"[{p['id']}] {p['text'][:500]}" for p in paras)
    user = (
        "Classify each numbered paragraph below as 'core', 'example', or 'fluff', with a very short Persian reason (max 8 words).\n"
        'Return JSON: {"items":[{"id":123,"tier":"core|example|fluff","why":"دلیل کوتاه فارسی"}]}\n\n---\n' + payload
    )
    out = parse_json(chat(provider, model, HEATMAP_SYS, user, settings=s, task="translate_para", json_mode=True))
    raw_items = out.get("items", []) if isinstance(out, dict) else (out if isinstance(out, list) else [])
    valid = {p["id"] for p in paras}
    result: dict[str, dict] = {}
    for it in raw_items:
        if not isinstance(it, dict):
            continue
        try:
            pid = int(it.get("id"))
        except (TypeError, ValueError):
            continue
        if pid not in valid:
            continue
        tier = str(it.get("tier") or "example").lower().strip()
        if tier not in ("core", "example", "fluff"):
            tier = "example"
        result[str(pid)] = {"tier": tier, "why": str(it.get("why") or "").strip()[:120]}
    db.run("INSERT OR REPLACE INTO page_heatmap(book_id, page, data, provider, model, created) VALUES(?,?,?,?,?,?)",
           (book_id, page, json.dumps(result, ensure_ascii=False), provider, model, db.now()))
    return {"items": result, "provider": provider, "model": model}


# ------------------------------------------------------------------ 9. Visual Diagram / Formula Region Analyzer
REGION_SYS = """You are a 3Blue1Brown-style interactive Persian math & science teacher.
Turn a selected formula, diagram, or passage from a book page into an interactive learning card:
- Explain in crystal-clear, simple Persian with a concrete everyday analogy (no dry robotic jargon).
- Break down every symbol into interactive chips.
- Whenever there is a mathematical formula, curve, or relationship, design an `interactive_plot` with 1-3 tunable sliders (`params`) and 1-2 `curves` using safe expressions (ops: + - * / ^, sin, cos, tan, exp, log, sqrt, abs, tanh, sigmoid, x, and param names).
- Always create 2 short, fun interactive multiple-choice exercises (`exercises`) that test real intuition.
Return JSON only."""


def _region_prompt(q: str, region_text: str, page_ctx: str, img_path: str = "") -> str:
    return (
        f"User question: {q}\n"
        + (f"Cropped image file path (inspect if supported): {img_path}\n" if img_path else "")
        + (f"Text/symbols inside selected box:\n{region_text}\n\n" if region_text else "")
        + f"Surrounding page context:\n{page_ctx}\n\n"
        "Return JSON with this exact schema:\n"
        '{"title":"عنوان کوتاه فارسی",'
        '"formula_latex":"clean LaTeX formula (without $$) or empty if no formula",'
        '"simple_explain":"توضیح خیلی ساده، صمیمی و شهودی در ۳ تا ۵ جمله (می‌تواند شامل $...$ باشد)",'
        '"analogy":"یک مثال ملموس و روزمره که مفهوم را در ۵ ثانیه جا بیندازد",'
        '"symbols":[{"sym":"LaTeX symbol e.g. \\\\omega_1","name":"نام کوتاه فارسی","meaning":"توضیح کوتاه و ساده"}],'
        '"interactive_plot":null or {"title":"عنوان نمودار تعاملی","x_label":"x","y_label":"f(x)","x_min":-5,"x_max":5,'
        '"params":[{"name":"w0","label":"بایاس","min":-5,"max":5,"step":0.5,"default":1},{"name":"w1","label":"وزن","min":-3,"max":3,"step":0.2,"default":1.5}],'
        '"curves":[{"label":"تابع خطی","expr":"w0 + w1*x","color":"#2159A0"},{"label":"مقایسه غیرخطی","expr":"w0 + w1*x*x","color":"#E3A92B"}]},'
        '"exercises":[{"q":"سؤال کوتاه و شهودی (می‌تواند شامل $...$ باشد)","options":["گزینه ۱","گزینه ۲","گزینه ۳"],"answer_idx":0,"hint":"راهنمایی کوتاه","solution":"توضیح کوتاه چرا این گزینه درست است"}]}'
    )


def analyze_page_region(book_id: int, page: int, x: float, y: float, w: float, h: float, question: str = "") -> dict:
    """Crop a region of a PDF/EPUB page and return an interactive formula/diagram learning card."""
    path = _find_book_file(book_id)
    if not path:
        raise LLMError("فایل اصلی این کتاب برای برش تصویر در دسترس نیست.")
    x, y = max(0.0, min(0.98, x)), max(0.0, min(0.98, y))
    w, h = max(0.02, min(1.0 - x, w)), max(0.02, min(1.0 - y, h))
    with fitz.open(path) as doc:
        if not 1 <= page <= doc.page_count:
            raise LLMError("شماره‌ی صفحه نامعتبر است")
        pg = doc[page - 1]
        r = pg.rect
        clip = fitz.Rect(r.x0 + x * r.width, r.y0 + y * r.height,
                         r.x0 + (x + w) * r.width, r.y0 + (y + h) * r.height)
        pix = pg.get_pixmap(matrix=fitz.Matrix(2.2, 2.2), clip=clip)
        png_bytes = pix.tobytes("png")
        region_text = pg.get_text("text", clip=clip).strip()
        page_ctx = pg.get_text("text").strip()[:2500]

    s = load_settings()
    provider, model, _ = resolve("explain", s)
    q = question.strip() or "این فرمول یا نمودار را خیلی ساده و شهودی توضیح بده، اگر نمودار می‌خواهد برایم رسم کن، و ۲ تمرین کوتاه بده."

    raw_out = ""
    mode = "hybrid"
    if provider == "openai" and s["openai"].get("api_key"):
        b64 = base64.b64encode(png_bytes).decode()
        cfg = s["openai"]
        url = cfg["base_url"].rstrip("/") + "/chat/completions"
        headers = {"api-key": cfg["api_key"]} if cfg.get("auth") == "api-key" else {"Authorization": f"Bearer {cfg['api_key']}"}
        body = {
            "model": model,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": REGION_SYS},
                {"role": "user", "content": [
                    {"type": "text", "text": _region_prompt(q, region_text, page_ctx[:1500])},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
                ]},
            ],
        }
        try:
            resp = httpx.post(url, json=body, headers=headers, timeout=float(cfg.get("timeout", 180)))
            if resp.status_code == 200:
                raw_out = resp.json()["choices"][0]["message"]["content"]
                mode = "vision"
        except Exception:
            pass
    elif provider == "ollama":
        b64 = base64.b64encode(png_bytes).decode()
        cfg = s["ollama"]
        try:
            resp = httpx.post(
                cfg["base_url"].rstrip("/") + "/api/chat",
                json={"model": model, "stream": False, "format": "json", "messages": [
                    {"role": "system", "content": REGION_SYS},
                    {"role": "user", "content": _region_prompt(q, region_text, page_ctx[:1200]), "images": [b64]},
                ]},
                timeout=float(cfg.get("timeout", 300)),
            )
            if resp.status_code == 200:
                raw_out = resp.json().get("message", {}).get("content", "").strip()
                mode = "vision"
        except Exception:
            pass

    if not raw_out:
        tmp = Path(tempfile.gettempdir()) / f"varagh_crop_{book_id}_{page}.png"
        tmp.write_bytes(png_bytes)
        raw_out = chat(provider, model, REGION_SYS, _region_prompt(q, region_text, page_ctx, str(tmp)),
                       settings=s, task="explain", json_mode=True)

    try:
        card = parse_json(raw_out)
        if isinstance(card, dict) and (card.get("simple_explain") or card.get("title")):
            return {"card": card, "text": card.get("simple_explain", ""), "mode": mode, "provider": provider, "model": model}
    except Exception:
        pass
    return {"card": None, "text": raw_out, "mode": mode, "provider": provider, "model": model}


def _find_book_file(book_id: int) -> Path | None:
    for ext in (".pdf", ".epub"):
        p = BOOKS_DIR / f"{book_id}{ext}"
        if p.exists():
            return p
    return None


# ------------------------------------------------------------------ 10. Cross-Book Second Brain & Obsidian Export
_WORD_RE = re.compile(r"[A-Za-z]{4,}|[\u0600-\u06FF]{3,}")
_STOP_WORDS = {
    "that", "this", "with", "from", "have", "were", "been", "their", "there", "which", "would", "could", "should",
    "about", "into", "more", "some", "than", "then", "them", "these", "those", "when", "what", "where", "will",
    "your", "they", "also", "only", "such", "other", "over", "after", "before", "because", "between", "through",
    "است", "هست", "این", "برای", "باید", "می‌شود", "دارد", "کرد", "شود", "های", "بود", "یک", "هم", "اما",
}


def _tokens(text: str) -> Counter:
    return Counter(w.lower() for w in _WORD_RE.findall(text or "") if w.lower() not in _STOP_WORDS)


def cross_book_connections(book_id: int, page: int, limit: int = 8) -> dict:
    """Find related highlights, notes, cards, and passages from OTHER books (no Ollama required)."""
    cur_paras = db.rows("SELECT text FROM paragraphs WHERE book_id=? AND page=? AND kind<>'raw'", (book_id, page))
    if not cur_paras:
        return {"matches": [], "keywords": []}
    qvec = _tokens(" ".join(p["text"] for p in cur_paras))
    top_kw = [w for w, _ in qvec.most_common(12)]
    if not top_kw:
        return {"matches": [], "keywords": []}

    other_books = {b["id"]: b["title"] for b in db.rows("SELECT id, title FROM books WHERE id<>? AND status='ready'", (book_id,))}
    if not other_books:
        return {"matches": [], "keywords": top_kw[:6]}

    candidates: list[dict] = []
    # 1. Journal notes from other books
    for j in db.rows("SELECT book_id, text, page_from FROM journal WHERE book_id<>?", (book_id,)):
        if j["book_id"] in other_books:
            candidates.append({"kind": "journal", "book_id": j["book_id"], "book": other_books[j["book_id"]],
                               "page": j["page_from"] or 1, "text": j["text"], "boost": 1.6})
    # 2. Cards from other books
    for c in db.rows("SELECT book_id, page, front, back FROM cards WHERE book_id<>?", (book_id,)):
        if c["book_id"] in other_books:
            candidates.append({"kind": "card", "book_id": c["book_id"], "book": other_books[c["book_id"]],
                               "page": c["page"] or 1, "text": f"{c['front']} — {c['back']}", "boost": 1.5})
    # 3. Tagged paragraphs from other books
    for t in db.rows(
        "SELECT t.book_id, t.page, p.text, tr.text AS fa FROM tags t JOIN paragraphs p ON p.id=t.para_id "
        "LEFT JOIN translations tr ON tr.para_id=t.para_id AND tr.kind='base' WHERE t.book_id<>?", (book_id,)
    ):
        if t["book_id"] in other_books:
            candidates.append({"kind": "highlight", "book_id": t["book_id"], "book": other_books[t["book_id"]],
                               "page": t["page"], "text": t["fa"] or t["text"], "boost": 1.4})
    # 4. Paragraphs from other books matching top keywords
    like_clauses = " OR ".join("p.text LIKE ?" for _ in top_kw[:6])
    like_args = tuple(f"%{w}%" for w in top_kw[:6])
    for r in db.rows(
        f"SELECT p.book_id, p.page, p.text, tr.text AS fa FROM paragraphs p "
        f"LEFT JOIN translations tr ON tr.para_id=p.id AND tr.kind='base' "
        f"WHERE p.book_id<>? AND p.kind<>'raw' AND ({like_clauses}) LIMIT 120",
        (book_id, *like_args),
    ):
        if r["book_id"] in other_books:
            candidates.append({"kind": "passage", "book_id": r["book_id"], "book": other_books[r["book_id"]],
                               "page": r["page"], "text": r["text"], "fa": r.get("fa") or "", "boost": 1.0})

    qnorm = math.sqrt(sum(v * v for v in qvec.values())) or 1.0
    scored = []
    seen_keys = set()
    for cand in candidates:
        key = (cand["book_id"], cand["page"], cand["kind"])
        if key in seen_keys:
            continue
        vec = _tokens(cand["text"] + " " + cand.get("fa", ""))
        if not vec:
            continue
        dot = sum(qvec[w] * c for w, c in vec.items() if w in qvec)
        if dot <= 0:
            continue
        norm = math.sqrt(sum(v * v for v in vec.values())) or 1.0
        shared = sorted((set(qvec) & set(vec)), key=lambda w: -(qvec[w] + vec[w]))[:4]
        score = (dot / (qnorm * norm)) * cand["boost"]
        seen_keys.add(key)
        scored.append({
            "kind": cand["kind"], "book_id": cand["book_id"], "book": cand["book"],
            "page": cand["page"], "snippet": (cand.get("fa") or cand["text"])[:260],
            "shared": shared, "score": round(score, 3),
        })
    scored.sort(key=lambda x: -x["score"])
    return {"matches": scored[:limit], "keywords": top_kw[:6]}


def synthesize_connections(book_id: int, page: int) -> dict:
    """Use the LLM to synthesize how this page connects to or contradicts ideas from other books."""
    conn = cross_book_connections(book_id, page, limit=6)
    if not conn["matches"]:
        raise LLMError("هنوز ارتباطی با کتاب‌های دیگر پیدا نشد. حداقل دو کتاب در کتابخانه داشته باش.")
    cur_text = "\n".join(p["text"] for p in db.rows(
        "SELECT text FROM paragraphs WHERE book_id=? AND page=? AND kind<>'raw' ORDER BY idx", (book_id, page)
    ))[:2500]
    b = db.one("SELECT title FROM books WHERE id=?", (book_id,))
    refs = "\n".join(f"- [{m['book']} · ص {m['page']}]: {m['snippet']}" for m in conn["matches"])
    s = load_settings()
    provider, model, _ = resolve("explain", s)
    prompt = (
        f"Current book: {(b or {}).get('title', '')} (page {page}):\n{cur_text}\n\n"
        f"Related excerpts/notes from other books in the reader's library:\n{refs}\n\n"
        "In 3-5 sharp Persian bullet points, explain how the ideas on this page connect to, reinforce, or contradict the other books."
    )
    txt = chat(provider, model, "You are a syntopical reading assistant connecting ideas across books in fluent Persian.",
               prompt, settings=s, task="explain")
    return {"synthesis": txt, "matches": conn["matches"], "provider": provider, "model": model}


def export_obsidian_markdown(book_id: int) -> tuple[str, str]:
    """Generate a rich Obsidian-ready Markdown note with YAML frontmatter."""
    b = db.one("SELECT * FROM books WHERE id=?", (book_id,))
    if not b:
        raise LLMError("کتاب پیدا نشد")
    title = b["title"] or f"Book {book_id}"
    lines = [
        "---",
        f'title: "{title.replace(chr(34), "")}"',
        f'author: "{(b.get("author") or "").replace(chr(34), "")}"',
        f"pages: {b.get('pages', 0)}",
        f"last_page: {b.get('last_page', 1)}",
        "tags: [varagh, book-notes]",
        "---",
        "",
        f"# {title}",
        "",
    ]

    xrays = db.rows("SELECT start_page, end_page, data FROM xrays WHERE book_id=? ORDER BY start_page", (book_id,))
    if xrays:
        lines.append("## 🩻 پیش‌خوانی فصل‌ها (X-Ray)")
        for x in xrays:
            d = json.loads(x["data"])
            lines.append(f"### ص {x['start_page']} تا {x['end_page']}")
            if d.get("thesis"):
                lines.append(f"> **تز اصلی:** {d['thesis']}")
            for cl in d.get("core_claims") or []:
                lines.append(f"- {cl.get('claim', '')} *(ص {cl.get('page', x['start_page'])})*")
            if d.get("takeaway"):
                lines.append(f"- **جمع‌بندی:** {d['takeaway']}")
            lines.append("")

    critiques = db.rows("SELECT start_page, end_page, data FROM critiques WHERE book_id=? ORDER BY start_page", (book_id,))
    if critiques:
        lines.append("## ⚖️ نقد و وکیل مدافع شیطان")
        for c in critiques:
            d = json.loads(c["data"])
            lines.append(f"### ص {c['start_page']} تا {c['end_page']}")
            if d.get("steelman"):
                lines.append(f"- **قوی‌ترین صورت استدلال نویسنده:** {d['steelman']}")
            for ca in d.get("counterarguments") or []:
                lines.append(f"- **نقد ({ca.get('thinker', '')}):** {ca.get('point', '')} — {ca.get('detail', '')}")
            lines.append("")

    feyns = db.rows("SELECT start_page, end_page, topic, explanation, feedback_json FROM feynman WHERE book_id=? ORDER BY id", (book_id,))
    if feyns:
        lines.append("## 🧠 تمرین‌های فاینمن")
        for f in feyns:
            fb = json.loads(f["feedback_json"] or "{}")
            lines.append(f"### {f['topic']} (امتیاز: {fb.get('score', '—')}/100)")
            lines.append(f"{f['explanation']}\n")
            if fb.get("simpler_analogy"):
                lines.append(f"> **قیاس طلایی:** {fb['simpler_analogy']}\n")

    tags = db.rows(
        "SELECT t.page, t.tag, p.text, tr.text AS fa FROM tags t JOIN paragraphs p ON p.id=t.para_id "
        "LEFT JOIN translations tr ON tr.para_id=t.para_id AND tr.kind='base' WHERE t.book_id=? ORDER BY t.page, p.idx",
        (book_id,),
    )
    if tags:
        lines.append("## 🔖 هایلایت‌ها")
        for t in tags:
            lines.append(f"- **[ص {t['page']} · #{t['tag']}]** {t['fa'] or t['text']}")
            if t["fa"]:
                lines.append(f"  > {t['text'][:300]}")
        lines.append("")

    journals = db.rows("SELECT page_from, page_to, text, created FROM journal WHERE book_id=? ORDER BY id", (book_id,))
    if journals:
        lines.append("## 📓 یادداشت‌های جلسات")
        for j in journals:
            lines.append(f"- *(ص {j['page_from']}–{j['page_to']})* {j['text']}")
        lines.append("")

    cards = db.rows("SELECT page, front, back, COALESCE(card_type,'vocab') AS card_type FROM cards WHERE book_id=? ORDER BY page, id", (book_id,))
    if cards:
        lines.append("## 🗂️ کارت‌های یادآوری")
        for c in cards:
            lines.append(f"- **[{c['card_type']} · ص {c['page'] or 0}]** {c['front']} :: {c['back']}")
        lines.append("")

    safe_name = re.sub(r'[<>:"/\\|?*]+', "-", title).strip(" .")[:80] or f"book-{book_id}"
    return "\n".join(lines), f"{safe_name}.md"


def sync_obsidian(book_id: int) -> dict:
    s = load_settings()
    vault = (s["reading"].get("obsidian_vault") or "").strip()
    if not vault:
        raise LLMError("مسیر پوشه‌ی Obsidian Vault در تنظیمات وارد نشده است.")
    vpath = Path(vault).expanduser()
    if not vpath.is_dir():
        raise LLMError(f"پوشه‌ی Obsidian پیدا نشد: {vpath}")
    md, fname = export_obsidian_markdown(book_id)
    dest = vpath / fname
    dest.write_text(md, encoding="utf-8")
    return {"ok": True, "path": str(dest), "filename": fname}
