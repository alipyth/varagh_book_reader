"""Prompts. The system prompts are fixed strings placed first, so endpoints with
automatic prompt caching can reuse them across calls."""
from __future__ import annotations

import json
import re

TRANSLATOR = """You are an expert literary translator into Persian (Farsi).
Rules:
- Translate faithfully and completely. Never summarize, skip sentences, or add explanations.
- Write natural, fluent, modern Persian prose, as a skilled Iranian translator would.
- Use Persian punctuation (، ؛ « » ؟) and the zero-width non-joiner where standard (e.g. می‌روم، کتاب‌ها).
- If a glossary is given, use its Persian renderings exactly and consistently.
- Keep numbers, formulas, code, and URLs unchanged.
- Headings stay short headings."""


def glossary_block(terms: list[tuple[str, str]]) -> str:
    if not terms:
        return ""
    lines = "\n".join(f"- {t} = {fa}" for t, fa in terms)
    return f"Glossary (use exactly):\n{lines}\n\n"


def para_batch(items: list[dict], terms) -> str:
    payload = json.dumps([{"id": str(i["id"]), "text": i["text"]} for i in items], ensure_ascii=False)
    return (
        glossary_block(terms)
        + "Translate every item's text into Persian. Return JSON only, in this exact shape:\n"
        + '{"items":[{"id":"<same id>","fa":"<Persian translation>"}]}\n\n'
        + "Items:\n" + payload
    )


def single(text: str, terms) -> str:
    return glossary_block(terms) + "Translate into Persian. Output only the translation.\n\n" + text


def page(paragraphs: list[str], terms) -> str:
    body = "\n\n".join(paragraphs)
    return (
        glossary_block(terms)
        + "Translate this book page into Persian as one continuous, well-flowing text. "
        + "Keep the paragraph breaks: separate paragraphs with one blank line. "
        + "Output only the Persian translation.\n\n---\n" + body
    )


def page_marked(body: str, n: int, terms) -> str:
    return (
        glossary_block(terms)
        + f"Translate this book page into Persian as natural, well-flowing prose. It is split into {n} numbered segments. "
        + "Before each segment's translation, write its marker exactly as given (for example <<<1>>>) on its own line. "
        + "Keep every marker, keep their order, and never merge or split segments. "
        + "Output only the markers and the Persian translation.\n\n" + body
    )


def better(text: str, prev: str, nxt: str, terms) -> str:
    ctx = ""
    if prev:
        ctx += f"Previous paragraph (context only, do not translate):\n{prev[-600:]}\n\n"
    if nxt:
        ctx += f"Next paragraph (context only, do not translate):\n{nxt[:600]}\n\n"
    return (
        glossary_block(terms) + ctx
        + "Translate the following paragraph into the finest literary Persian you can, "
        + "preserving tone, rhythm and nuance. Output only the translation.\n\n---\n" + text
    )


GLOSSARY_SYS = """You build translation glossaries for English→Persian book translation.
Return JSON only."""


def glossary(cands: list[tuple[str, str]]) -> str:
    items = "\n".join(f"- {t} :: {ex}" for t, ex in cands)
    return (
        "Below are candidate terms from one book, each with an example sentence.\n"
        "Keep only names of people, places, organizations, and key concepts or technical terms that must be "
        "translated consistently. Drop ordinary words. For each kept term give its Persian rendering "
        "(transliterate personal names the standard Persian way) and its kind: "
        "person (a character or real person), place, org, concept, or other.\n"
        'Return JSON: {"terms":[{"term":"<exact term>","fa":"<Persian>","kind":"person|place|org|concept|other"}]}\n\n' + items
    )


LOOKUP_SYS = """You are an English–Persian dictionary for a Persian speaker learning English. Answer in Persian.
Return JSON only."""


def lookup(word: str, sentence: str) -> str:
    return (
        f"Word or phrase: {word}\nSentence: {sentence}\n\n"
        "Return JSON with keys:\n"
        '{"word":"...","lemma":"base form","ipa":"IPA pronunciation","pos_fa":"نقش دستوری به فارسی",'
        '"meaning_fa":"short Persian meaning in THIS sentence","other_meanings_fa":["..."],'
        '"note_fa":"one short usage note in Persian, or empty"}'
    )


def relevant_terms(glossary: list[tuple[str, str]], text: str, limit: int = 30) -> list[tuple[str, str]]:
    out = []
    for term, fa in glossary:
        if not fa:
            continue
        if re.search(r"(?<![A-Za-z])" + re.escape(term) + r"(?![A-Za-z])", text, re.I):
            out.append((term, fa))
            if len(out) >= limit:
                break
    return out


# ------------------------------------------------------------------ study tools

RELATION_SYS = """You analyse relationships between characters in a book, for a Persian-speaking reader.
Use ONLY the excerpts given; never use outside knowledge of the book, and never reveal later events. Return JSON only."""


def relation(a: str, b: str, excerpts: list[str]) -> str:
    ex = "\n\n".join(f"[{i + 1}] {e}" for i, e in enumerate(excerpts))
    return (
        f"Entities: {a} and {b}\n\nExcerpts where both appear:\n{ex}\n\n"
        "Describe how they are related, based only on these excerpts. Return JSON:\n"
        '{"label":"2 to 4 word Persian label for the relationship, e.g. «دوست قدیمی» or «رقیب»",'
        '"summary":"one or two Persian sentences explaining the relationship"}'
    )


MINDMAP_SYS = """You turn book passages into clear mind maps for a Persian-speaking reader. Write every node in fluent Persian.
Return JSON only."""


def mindmap(text: str, scope_label: str) -> str:
    return (
        f"Build a mind map of the following {scope_label}. The root is the central topic. "
        "Use 3 to 7 main branches (themes, events, characters, arguments or ideas), each with 1 to 5 short children; "
        "a third level only where it really helps. Node titles are short Persian phrases (at most 8 words).\n"
        'Return JSON: {"title":"...","children":[{"title":"...","children":[{"title":"..."}]}]}\n\n---\n' + text
    )


NOTES_SYS = "You summarise book passages into compact notes. Write in Persian."


def notes(text: str, keep_pages: bool = False) -> str:
    keep = " The text contains page markers like [p.12]; start each bullet with the marker of the page it comes from." if keep_pages else ""
    return ("List the key points of this passage as at most 8 short Persian bullet points "
            "(events, ideas, characters, arguments)." + keep + " Output only the bullets.\n\n---\n" + text)


IMAGE_SYS = """You are an expert prompt writer for text-to-image models (Midjourney, DALL·E, Stable Diffusion, Flux).
You write vivid, concrete, visual prompts. Output only the prompt text, nothing else."""


def image_prompt(text: str, style: str, aspect: str, lang: str, wish: str) -> str:
    language = "Persian" if lang == "fa" else "English"
    return (
        "Read this book page and write ONE image-generation prompt for its most visually striking scene or moment. "
        "Describe concretely: main subject(s) and what they are doing, setting and period, time of day, lighting, "
        "mood and color palette, composition and camera angle.\n"
        f"Art style: {style}.\n"
        f"Aspect ratio: {aspect}.\n"
        + (f"The reader also wants: {wish}\n" if wish else "")
        + "No text, letters or captions in the image. Do not name the book or author. "
        f"Write the prompt in {language}, 60 to 120 words, as one paragraph.\n\n---\n" + text
    )


RECAP_SYS = """You write short "Previously in this book…" recaps for a Persian-speaking reader returning to a book.
Write only in fluent Persian. Use only what is in the given text; never guess what happens next."""


def recap(text: str) -> str:
    return ("Write a recap of the passage below in 4 to 7 Persian sentences, as a friendly reminder for someone who "
            "stopped reading a few days ago. Name the key people or ideas, say what happened or what was argued, and end "
            "with where things stand on the last page. No headings, no bullet points.\n\n---\n" + text)


QUIZ_SYS = """You write review questions that help a Persian-speaking reader understand and remember what they read.
Write only in Persian. Use only the given text. Return JSON only."""


def quiz(text: str) -> str:
    return (
        "From the passage below (a chapter of a book), write:\n"
        "1. summary: a 3 to 4 sentence Persian summary.\n"
        "2. questions: 4 recall questions about the most important events, ideas or characters (not trivia), each with a "
        "short model answer and the page number it comes from (the text has markers like [p.12]); then 1 reflective "
        "question that asks the reader what they think, with a few short points to consider as its answer.\n"
        'Return JSON: {"summary":"...","questions":[{"q":"...","a":"...","page":12,"type":"recall"},'
        '{"q":"...","a":"...","page":0,"type":"reflect"}]}\n\n---\n' + text
    )


def feedback(question: str, model_answer: str, answer: str, qtype: str) -> str:
    if qtype == "reflect":
        rule = "This is an opinion question: there is no wrong answer. Encourage the reader and add one idea they could consider."
    else:
        rule = "Judge whether the reader's answer matches the reference answer in substance (wording does not matter)."
    return (
        f"Question: {question}\nReference answer: {model_answer}\nReader's answer: {answer}\n\n{rule}\n"
        'Return JSON: {"verdict":"correct|partial|wrong","feedback":"one or two short, kind Persian sentences"}'
    )


PALACE_SYS = """You design memory-palace images (method of loci) for a Persian-speaking reader.
Each image must be vivid, concrete, a little strange or funny, and clearly placed at the given spot, so it is easy to remember.
Write in Persian. Return JSON only."""


def palace(text: str, room: str, spots: list[str]) -> str:
    sp = "\n".join(f"- {x}" for x in spots)
    return (
        f"The reader's memory palace has a room called «{room}» for this chapter. Free spots in the room:\n{sp}\n\n"
        f"Pick the {len(spots)} most important ideas, events or arguments of the passage (in reading order) and place one at each spot. "
        "For each give: idea (one short Persian sentence stating what to remember), cue (a vivid Persian image of 1-2 sentences "
        "that happens AT that spot and encodes the idea), page (from the [p.N] markers).\n"
        'Return JSON: {"items":[{"spot":"...","idea":"...","cue":"...","page":12}]}\n\n---\n' + text
    )


EXPLAIN_SYS = """You help a Persian-speaking reader understand a difficult paragraph of an English book.
Explain in simple, warm Persian. Never reveal what happens later in the book."""


def explain(text: str, prev: str, terms) -> str:
    ctx = f"Previous paragraph (context):\n{prev[-700:]}\n\n" if prev else ""
    return (
        glossary_block(terms) + ctx
        + "Explain the paragraph below in simple Persian, in 3 to 6 sentences: what it says in plain words, why it matters here, "
        "and any idiom, cultural or historical reference, or hard sentence structure that makes it confusing. "
        "No headings.\n\n---\n" + text
    )


POST_SYS = """You coach a Persian content creator who writes short educational posts for a Telegram channel about books they read.
You help with structure and give feedback, but you never write the post for them. Write in Persian. Return JSON only."""


def post_outline(text: str) -> str:
    return (
        "From this chapter, prepare a skeleton the creator can use to write ONE short Telegram post (under 1500 characters) "
        "that teaches the chapter's most useful idea to their audience. Do not write the post itself.\n"
        "Return JSON: {\"hooks\":[3 short opening-line ideas],\"points\":[{\"title\":\"key point in a few words\",\"why\":\"why it matters, one sentence\"} x3],"
        "\"example\":\"one concrete example or quote idea from the chapter to use\",\"question\":\"a question to ask the audience at the end\","
        "\"tips\":[2 short writing tips]}\n\n---\n" + text
    )


def post_feedback(source: str, draft: str) -> str:
    return (
        f"Chapter notes:\n{source}\n\nThe creator's draft post:\n{draft}\n\n"
        "Give feedback without rewriting the post. Return JSON: {\"good\":[up to 3 things that work],"
        "\"improve\":[up to 3 concrete suggestions],\"accuracy\":\"one sentence: is anything inaccurate compared to the chapter?\"}"
    )
