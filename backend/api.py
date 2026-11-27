"""HTTP API + static frontend."""
from __future__ import annotations

import io
import json
import secrets
import socket
import re
import shutil
import threading
from pathlib import Path

import pymupdf as fitz
from fastapi import FastAPI, File, HTTPException, UploadFile
from urllib.parse import quote

from fastapi import Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import db, deep, learn
from .config import BOOKS_DIR, COVERS_DIR, FRONTEND, TASKS, load_settings, mask_key, save_settings
from .ingest import ingest, ingest_plain_text, ingest_url
from .providers import LLMError, list_cli2api_catalog, list_models, warmup
from .router import budget_state
from . import extras, study
from .translate import assembled_page, compare, lookup, page_state, start_glossary, stream_page, stream_paragraph

app = FastAPI(title="Varagh")


@app.on_event("startup")
def _startup():
    db.init()
    s = load_settings()
    if not s["server"].get("token"):
        save_settings({"server": {"token": secrets.token_urlsafe(9)}})


LOCAL = ("127.0.0.1", "::1", "localhost")
LOCKED_PAGE = """<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>ورق</title><body style="font-family:Tahoma,sans-serif;background:#0E1621;color:#E3E9EF;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center">
<div><h2>ورق</h2><p>برای باز کردن ورق روی این دستگاه، کد QR صفحه‌ی تنظیمات را روی لپ‌تاپ اسکن کن.</p></div></body></html>"""


@app.middleware("http")
async def lan_guard(request: Request, call_next):
    """Requests from the laptop itself pass; other devices on the Wi-Fi need the access link once."""
    host = request.client.host if request.client else ""
    if host in LOCAL or host.startswith("127."):
        return await call_next(request)
    tok = load_settings()["server"].get("token") or ""
    t = request.query_params.get("t")
    if tok and t == tok:
        resp = RedirectResponse(url=str(request.url.remove_query_params("t")), status_code=302)
        resp.set_cookie("varagh_t", tok, max_age=60 * 60 * 24 * 365, httponly=True, samesite="lax")
        return resp
    if tok and request.cookies.get("varagh_t") == tok:
        return await call_next(request)
    if request.url.path.startswith("/api/"):
        return JSONResponse({"detail": "دسترسی ندارید. لینک ورود را از تنظیمات لپ‌تاپ اسکن کنید."}, status_code=401)
    return HTMLResponse(LOCKED_PAGE, status_code=401)


@app.exception_handler(LLMError)
def _llm_error(_, exc: LLMError):
    return JSONResponse({"detail": str(exc)}, status_code=400)


@app.get("/api/health")
def health():
    return {"app": "varagh", "ok": True}


# ------------------------------------------------------------------ settings
@app.get("/api/settings")
def get_settings():
    s = load_settings()
    s["openai"]["api_key_masked"] = mask_key(s["openai"].get("api_key", ""))
    s["openai"]["has_key"] = bool(s["openai"].get("api_key"))
    s["openai"].pop("api_key", None)
    s["cli2api"]["api_key_masked"] = mask_key(s["cli2api"].get("api_key", ""))
    s["cli2api"]["has_key"] = bool(s["cli2api"].get("api_key"))
    s["cli2api"].pop("api_key", None)
    return {"settings": s, "tasks": TASKS}


@app.put("/api/settings")
def put_settings(body: dict):
    for key_section in ("openai", "cli2api"):
        sec = body.get(key_section) or {}
        sec.pop("api_key_masked", None); sec.pop("has_key", None)
        if "api_key" in sec and not sec["api_key"]:
            sec.pop("api_key")          # empty field = keep existing key
    save_settings(body)
    return get_settings()


@app.delete("/api/settings/openai-key")
def delete_key():
    s = load_settings(); s["openai"]["api_key"] = ""; save_settings(s)
    return {"ok": True}


@app.delete("/api/settings/cli2api-key")
def delete_cli2api_key():
    s = load_settings(); s["cli2api"]["api_key"] = ""; save_settings(s)
    return {"ok": True}


@app.get("/api/models/{provider}")
def models(provider: str):
    return {"models": list_models(provider, load_settings())}


@app.get("/api/cli2api/catalog")
def cli2api_catalog(refresh: bool = False):
    return list_cli2api_catalog(load_settings(), refresh=refresh)


@app.get("/api/usage")
def usage():
    s = load_settings()
    m = db.month()
    by = db.rows("SELECT provider, model, SUM(in_tok) in_tok, SUM(out_tok) out_tok, COUNT(*) calls "
                 "FROM usage WHERE month=? GROUP BY provider, model ORDER BY provider, model", (m,))
    b = budget_state(s)
    oin = sum(r["in_tok"] for r in by if r["provider"] == "openai")
    oout = sum(r["out_tok"] for r in by if r["provider"] == "openai")
    cost = oin / 1e6 * float(s["budget"]["price_in_per_m"] or 0) + oout / 1e6 * float(s["budget"]["price_out_per_m"] or 0)
    total = sum(r["calls"] for r in by) or 0
    local = sum(r["calls"] for r in by if r["provider"] == "ollama")
    return {"month": m, "rows": by, "openai_tokens": b["used"], "cap": b["cap"], "exceeded": b["exceeded"],
            "cost": round(cost, 4), "local_share": round(local / total * 100) if total else None}


# ------------------------------------------------------------------ books
def _book(book_id: int) -> dict:
    b = db.one("SELECT * FROM books WHERE id=?", (book_id,))
    if not b:
        raise HTTPException(404, "کتاب پیدا نشد")
    b["toc"] = json.loads(b.pop("toc_json") or "[]")
    return b


@app.get("/api/books")
def books():
    rs = db.rows("SELECT id, title, author, pages, last_page, status, error, glossary_status, created, opened FROM books ORDER BY COALESCE(opened, created) DESC")
    for r in rs:
        t = db.one("SELECT COUNT(*) n FROM translations t JOIN paragraphs p ON p.id=t.para_id WHERE p.book_id=? AND t.kind='base'", (r["id"],))
        n = db.one("SELECT COUNT(*) n FROM paragraphs WHERE book_id=?", (r["id"],))
        r["translated_pct"] = round(t["n"] / n["n"] * 100) if n["n"] else 0
    return rs


def _clean_title(t: str) -> str:
    t = re.sub(r"^Microsoft Word\s*-\s*", "", t or "").strip()
    return re.sub(r"\.(docx?|pdf|indd)$", "", t, flags=re.I).strip()


ALLOWED_EXTS = (".pdf", ".epub", ".txt", ".md")


@app.post("/api/books")
async def upload(file: UploadFile = File(...)):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTS:
        raise HTTPException(400, "فرمت‌های مجاز: PDF، EPUB، TXT و MD")
    stem = Path(file.filename).stem
    book_id = db.run("INSERT INTO books(title, filename, status, created) VALUES(?,?, 'ingesting', ?)",
                     (stem, file.filename, db.now()))
    dest = BOOKS_DIR / f"{book_id}{ext}"
    with dest.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    def job():
        ingest(book_id, str(dest))
        b = db.one("SELECT title, status FROM books WHERE id=?", (book_id,))
        if b and b["status"] == "ready":
            clean = _clean_title(b["title"]) or stem
            db.run("UPDATE books SET title=? WHERE id=?", (clean, book_id))
            if load_settings()["reading"].get("auto_glossary", True):
                start_glossary(book_id)

    threading.Thread(target=job, daemon=True).start()
    return {"id": book_id}


class UrlBookReq(BaseModel):
    url: str


@app.post("/api/books/from-url")
def upload_from_url(req: UrlBookReq):
    url = req.url.strip()
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "آدرس باید با http:// یا https:// شروع شود")
    book_id = db.run("INSERT INTO books(title, filename, status, created) VALUES(?,?, 'ingesting', ?)",
                     (url[:80], url, db.now()))

    def job():
        ingest_url(book_id, url)
        b = db.one("SELECT status FROM books WHERE id=?", (book_id,))
        if b and b["status"] == "ready" and load_settings()["reading"].get("auto_glossary", False):
            start_glossary(book_id)

    threading.Thread(target=job, daemon=True).start()
    return {"id": book_id}


class TextBookReq(BaseModel):
    title: str
    text: str


@app.post("/api/books/from-text")
def upload_from_text(req: TextBookReq):
    if len(req.text.strip()) < 50:
        raise HTTPException(400, "متن خیلی کوتاه است")
    title = req.title.strip() or "یادداشت / مقاله"
    book_id = db.run("INSERT INTO books(title, filename, status, created) VALUES(?,?, 'ingesting', ?)",
                     (title, f"{title}.txt", db.now()))
    ingest_plain_text(book_id, req.text, title=title)
    return {"id": book_id}


@app.get("/api/books/{book_id}")
def book(book_id: int):
    return _book(book_id)


@app.delete("/api/books/{book_id}")
def delete_book(book_id: int):
    with db.db() as con:
        con.execute("DELETE FROM translations WHERE para_id IN (SELECT id FROM paragraphs WHERE book_id=?)", (book_id,))
        con.execute("DELETE FROM explains WHERE para_id IN (SELECT id FROM paragraphs WHERE book_id=?)", (book_id,))
        con.execute("DELETE FROM para_explains WHERE para_id IN (SELECT id FROM paragraphs WHERE book_id=?)", (book_id,))
        for t in ("paragraphs", "page_translations", "glossary", "relations", "mindmaps", "image_prompts", "recaps", "quizzes",
                  "palace", "tags", "journal", "reading_log", "posts", "embeddings",
                  "xrays", "tutor_msgs", "feynman", "concept_graphs", "critiques", "page_heatmap"):
            con.execute(f"DELETE FROM {t} WHERE book_id=?", (book_id,))
        con.execute("DELETE FROM books WHERE id=?", (book_id,))
    for ext in ALLOWED_EXTS:
        (BOOKS_DIR / f"{book_id}{ext}").unlink(missing_ok=True)
    (COVERS_DIR / f"{book_id}.png").unlink(missing_ok=True)
    return {"ok": True}


class Progress(BaseModel):
    page: int


@app.put("/api/books/{book_id}/progress")
def progress(book_id: int, body: Progress):
    db.run("UPDATE books SET last_page=?, opened=? WHERE id=?", (body.page, db.now(), book_id))
    return {"ok": True}


@app.get("/api/books/{book_id}/pages/{page}")
def page(book_id: int, page: int):
    """Page content plus any stored translations. Never starts a translation by itself."""
    b = _book(book_id)
    if b["status"] != "ready":
        raise HTTPException(409, "کتاب هنوز آماده نیست")
    page = max(1, min(page, b["pages"]))
    paras, tr = page_state(book_id, page)
    pick = lambda r: {"text": r["text"], "provider": r["provider"], "model": r["model"]} if r else None  # noqa: E731
    pt = assembled_page(paras, tr) or db.one("SELECT text, provider, model FROM page_translations WHERE book_id=? AND page=?", (book_id, page))
    ids = [p["id"] for p in paras]
    tagmap, exmap, dexmap = {}, {}, {}
    if ids:
        marks = ",".join("?" * len(ids))
        for r in db.rows(f"SELECT para_id, tag FROM tags WHERE para_id IN ({marks})", tuple(ids)):
            tagmap.setdefault(r["para_id"], []).append(r["tag"])
        exmap = {r["para_id"]: r["text"] for r in db.rows(f"SELECT para_id, text FROM explains WHERE para_id IN ({marks})", tuple(ids))}
        for r in db.rows(f"SELECT para_id, level, text FROM para_explains WHERE para_id IN ({marks})", tuple(ids)):
            dexmap.setdefault(r["para_id"], {})[r["level"]] = r["text"]
    for p in paras:
        p["tags"] = tagmap.get(p["id"], [])
        p["explain"] = exmap.get(p["id"])
        p["deep_explains"] = dexmap.get(p["id"], {})
        p["base"] = pick(tr.get(p["id"], {}).get("base"))
        p["better"] = pick(tr.get(p["id"], {}).get("better"))
    hm = deep.get_heatmap(book_id, page)
    return {"page": page, "pages": b["pages"], "paragraphs": paras, "page_translation": pt,
            "heatmap": hm["items"] if hm else None, "has_file": bool(deep._find_book_file(book_id))}


def _stream(meta: dict, gen) -> StreamingResponse:
    headers = {"X-Provider": meta.get("provider") or "", "X-Model": quote(meta.get("model") or ""),
               "X-Cached": "1" if meta.get("cached") else "0", "X-Note": quote(meta.get("note") or ""),
               "Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    return StreamingResponse(gen, media_type="text/plain; charset=utf-8", headers=headers)


@app.post("/api/paragraphs/{pid}/translate")
def translate_paragraph(pid: int, kind: str = "base"):
    if kind not in ("base", "better"):
        raise HTTPException(400, "kind نامعتبر")
    meta, gen = stream_paragraph(pid, kind)
    return _stream(meta, gen)


@app.delete("/api/paragraphs/{pid}/translation")
def drop_translation(pid: int, kind: str = "base"):
    db.run("DELETE FROM translations WHERE para_id=? AND kind=?", (pid, kind))
    return {"ok": True}


@app.post("/api/books/{book_id}/pages/{page}/translate")
def translate_page(book_id: int, page: int):
    meta, gen = stream_page(book_id, page)
    return _stream(meta, gen)


@app.delete("/api/books/{book_id}/pages/{page}/translation")
def drop_page_translation(book_id: int, page: int):
    db.run("DELETE FROM page_translations WHERE book_id=? AND page=?", (book_id, page))
    db.run("DELETE FROM translations WHERE para_id IN (SELECT id FROM paragraphs WHERE book_id=? AND page=? AND kind<>'raw')",
           (book_id, page))
    return {"ok": True}


@app.post("/api/warmup")
def do_warmup():
    """Preload the Ollama translation model so the first click answers quickly."""
    s = load_settings()
    t = s["tasks"]["translate_para"]
    if t.get("provider") == "ollama" and t.get("model"):
        threading.Thread(target=warmup, args=(s, t["model"]), daemon=True).start()
        return {"warming": t["model"]}
    return {"warming": None}


@app.get("/api/books/{book_id}/cover")
def cover(book_id: int):
    dest = COVERS_DIR / f"{book_id}.png"
    if not dest.exists():
        path = deep._find_book_file(book_id)
        if path:
            with fitz.open(path) as doc:
                doc[0].get_pixmap(matrix=fitz.Matrix(0.6, 0.6)).save(dest)
        else:
            b = db.one("SELECT title FROM books WHERE id=?", (book_id,))
            if not b:
                raise HTTPException(404)
            import html as _html
            t = _html.escape((b["title"] or "متن")[:42])
            svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 320">'
                   f'<rect width="240" height="320" fill="#182638"/><rect x="16" y="16" width="208" height="288" rx="8" fill="none" stroke="#E3A92B" stroke-opacity=".5"/>'
                   f'<text x="120" y="155" fill="#F4F6F9" font-family="Tahoma,sans-serif" font-size="16" font-weight="700" text-anchor="middle">{t}</text>'
                   f'<text x="120" y="280" fill="#E3A92B" font-family="Tahoma,sans-serif" font-size="11" text-anchor="middle">ورق · مقاله / متن</text></svg>')
            return Response(svg, media_type="image/svg+xml", headers={"Cache-Control": "max-age=86400"})
    return FileResponse(dest, media_type="image/png", headers={"Cache-Control": "max-age=86400"})


@app.get("/api/books/{book_id}/pages/{page}/image")
def page_image(book_id: int, page: int, zoom: float = 1.4):
    path = deep._find_book_file(book_id)
    if not path:
        raise HTTPException(404)
    with fitz.open(path) as doc:
        if not 1 <= page <= doc.page_count:
            raise HTTPException(404)
        pix = doc[page - 1].get_pixmap(matrix=fitz.Matrix(min(zoom, 3), min(zoom, 3)))
        return Response(pix.tobytes("png"), media_type="image/png", headers={"Cache-Control": "max-age=86400"})


# ------------------------------------------------------------------ glossary
@app.get("/api/books/{book_id}/glossary")
def glossary(book_id: int):
    b = db.one("SELECT glossary_status FROM books WHERE id=?", (book_id,))
    items = db.rows("SELECT term, fa, manual, kind FROM glossary WHERE book_id=? ORDER BY manual DESC, term", (book_id,))
    return {"status": (b or {}).get("glossary_status", ""), "items": items}


class Term(BaseModel):
    term: str
    fa: str
    kind: str | None = None


@app.put("/api/books/{book_id}/glossary")
def put_term(book_id: int, t: Term):
    if not t.term.strip():
        raise HTTPException(400, "اصطلاح خالی است")
    kind = t.kind if t.kind in ("person", "place", "org", "concept", "other") else None
    db.run("INSERT INTO glossary(book_id, term, fa, manual, kind) VALUES(?,?,?,1,COALESCE(?,'other')) "
           "ON CONFLICT(book_id, term) DO UPDATE SET fa=excluded.fa, manual=1, kind=COALESCE(?, kind)",
           (book_id, t.term.strip(), t.fa.strip(), kind, kind))
    return {"ok": True}


@app.delete("/api/books/{book_id}/glossary")
def del_term(book_id: int, term: str):
    db.run("DELETE FROM glossary WHERE book_id=? AND term=?", (book_id, term))
    return {"ok": True}


@app.post("/api/books/{book_id}/glossary/build")
def build(book_id: int):
    return {"started": start_glossary(book_id)}


# ------------------------------------------------------------------ lookup & cards
class LookupReq(BaseModel):
    word: str
    sentence: str = ""


@app.post("/api/lookup")
def do_lookup(r: LookupReq):
    w = r.word.strip()
    if not w or len(w) > 80:
        raise HTTPException(400, "یک کلمه یا عبارت کوتاه انتخاب کن")
    return lookup(w, r.sentence.strip()[:500])


class CardReq(BaseModel):
    book_id: int | None = None
    page: int | None = None
    front: str
    back: str
    context: str = ""
    card_type: str = "vocab"


@app.post("/api/cards")
def add_card(c: CardReq):
    return learn.add(c.book_id, c.page, c.front, c.back, c.context, c.card_type)


@app.get("/api/cards")
def cards():
    return {"cards": learn.all_cards(), "stats": learn.stats()}


@app.get("/api/cards/due")
def due():
    return {"cards": learn.due(), "stats": learn.stats()}


class Review(BaseModel):
    rating: int


@app.post("/api/cards/{cid}/review")
def review(cid: int, r: Review):
    if r.rating not in (1, 2, 3, 4):
        raise HTTPException(400, "rating باید ۱ تا ۴ باشد")
    return learn.review(cid, r.rating)


@app.delete("/api/cards/{cid}")
def del_card(cid: int):
    db.run("DELETE FROM cards WHERE id=?", (cid,))
    return {"ok": True}


@app.get("/api/cards/export.tsv")
def export_cards():
    buf = io.StringIO()
    for c in learn.all_cards():
        clean = lambda s: (s or "").replace("\t", " ").replace("\n", "<br>")  # noqa: E731
        buf.write(f"{clean(c['front'])}\t{clean(c['back'])}<br><i>{clean(c['context'])}</i>\n")
    return PlainTextResponse(buf.getvalue(), headers={"Content-Disposition": "attachment; filename=varagh-cards.tsv"})


# ------------------------------------------------------------------ compare
class CompareReq(BaseModel):
    book_id: int
    page: int
    targets: list[dict]


@app.post("/api/compare")
def do_compare(r: CompareReq):
    return compare(r.book_id, r.page, r.targets)


# ------------------------------------------------------------------ study tools
@app.get("/api/books/{book_id}/find")
def find(book_id: int, q: str):
    return study.find(book_id, q)


@app.get("/api/books/{book_id}/graph")
def graph(book_id: int, upto: int = 0, kinds: str = ""):
    b = _book(book_id)
    upto = upto if 1 <= upto <= b["pages"] else b["pages"]
    ks = {k for k in kinds.split(",") if k} or None
    return study.graph(book_id, upto, ks)


class RelReq(BaseModel):
    a: str
    b: str
    upto: int


@app.post("/api/books/{book_id}/graph/explain")
def explain(book_id: int, r: RelReq):
    return study.explain_relation(book_id, r.a, r.b, r.upto)


def _mm_range(book_id: int, scope: str, page: int) -> tuple[int, int, str]:
    b = _book(book_id)
    page = max(1, min(page, b["pages"]))
    if scope == "chapter":
        rng = study.chapter_range(book_id, page)
        if not rng:
            raise HTTPException(400, "این کتاب فهرست مطالب ندارد؛ «این صفحه» یا «۱۰ صفحه‌ی اخیر» را انتخاب کن.")
        return rng
    if scope == "recent":
        return max(1, page - 9), page, f"صفحه‌ی {max(1, page - 9)} تا {page}"
    return page, page, f"صفحه‌ی {page}"


@app.get("/api/books/{book_id}/mindmap")
def mindmap_get(book_id: int, scope: str = "page", page: int = 1):
    start, end, label = _mm_range(book_id, scope, page)
    chars = db.one("SELECT COALESCE(SUM(length(text)),0) n FROM paragraphs WHERE book_id=? AND page BETWEEN ? AND ?", (book_id, start, end))["n"]
    return {"start": start, "end": end, "label": label, "chars": chars, "map": study.get_mindmap(book_id, start, end)}


@app.post("/api/books/{book_id}/mindmap")
def mindmap_build(book_id: int, scope: str = "page", page: int = 1):
    start, end, label = _mm_range(book_id, scope, page)
    m = study.build_mindmap(book_id, start, end)
    return {"start": start, "end": end, "label": label, "map": m}


@app.get("/api/books/{book_id}/who")
def who(book_id: int, term: str, upto: int = 0):
    b = _book(book_id)
    return study.who(book_id, term, upto if 1 <= upto <= b["pages"] else b["pages"])


def _chars(book_id: int, start: int, end: int) -> int:
    return db.one("SELECT COALESCE(SUM(length(text)),0) n FROM paragraphs WHERE book_id=? AND page BETWEEN ? AND ?",
                  (book_id, start, end))["n"]


@app.get("/api/books/{book_id}/recap")
def recap_get(book_id: int, page: int):
    b = _book(book_id)
    start, end = study.recap_range(book_id, max(1, min(page, b["pages"])))
    return {"start": start, "end": end, "chars": _chars(book_id, start, end), "recap": study.get_recap(book_id, start, end)}


@app.post("/api/books/{book_id}/recap")
def recap_build(book_id: int, page: int):
    b = _book(book_id)
    start, end = study.recap_range(book_id, max(1, min(page, b["pages"])))
    db.run("DELETE FROM recaps WHERE book_id=? AND start_page=? AND end_page=?", (book_id, start, end))
    meta, gen = study.stream_recap(book_id, start, end)
    return _stream(meta, gen)


def _quiz_range(book_id: int, scope: str, page: int) -> tuple[int, int, str]:
    if scope == "chapter":
        rng = study.chapter_range(book_id, page)
        if rng:
            return rng
    return _mm_range(book_id, "recent", page)


@app.get("/api/books/{book_id}/quiz")
def quiz_get(book_id: int, page: int, scope: str = "chapter"):
    start, end, label = _quiz_range(book_id, scope, page)
    return {"start": start, "end": end, "label": label, "chars": _chars(book_id, start, end), "quiz": study.get_quiz(book_id, start, end)}


@app.post("/api/books/{book_id}/quiz")
def quiz_build(book_id: int, page: int, scope: str = "chapter"):
    start, end, label = _quiz_range(book_id, scope, page)
    return {"start": start, "end": end, "label": label, "quiz": study.build_quiz(book_id, start, end)}


class FeedbackReq(BaseModel):
    start: int
    end: int
    idx: int
    answer: str


@app.post("/api/books/{book_id}/quiz/feedback")
def quiz_feedback(book_id: int, r: FeedbackReq):
    if not r.answer.strip():
        raise HTTPException(400, "اول جوابت را بنویس")
    return study.quiz_feedback(book_id, r.start, r.end, r.idx, r.answer)


@app.get("/api/books/{book_id}/pages/{page}/image-prompts")
def image_prompts(book_id: int, page: int):
    return {"items": study.image_prompts(book_id, page), "styles": list(study.STYLES)}


@app.post("/api/books/{book_id}/pages/{page}/image-prompt")
def image_prompt(book_id: int, page: int, style: str = "cinematic", aspect: str = "16:9", lang: str = "en", wish: str = ""):
    meta, gen = study.stream_image_prompt(book_id, page, style, aspect, lang, wish)
    return _stream(meta, gen)


@app.delete("/api/image-prompts/{pid}")
def del_image_prompt(pid: int):
    db.run("DELETE FROM image_prompts WHERE id=?", (pid,))
    return {"ok": True}


# ------------------------------------------------------------------ memory palace
@app.get("/api/books/{book_id}/palace")
def palace_get(book_id: int):
    _book(book_id)
    return extras.palace(book_id)


class PalaceItem(BaseModel):
    page: int
    idea: str
    cue: str = ""


@app.post("/api/books/{book_id}/palace")
def palace_add(book_id: int, it: PalaceItem):
    if not it.idea.strip():
        raise HTTPException(400, "چیزی که باید به خاطر بسپاری را بنویس")
    return extras.palace_add(book_id, it.page, it.idea, it.cue)


@app.post("/api/books/{book_id}/palace/fill")
def palace_fill(book_id: int, page: int):
    return extras.palace_fill(book_id, page)


class PalaceEdit(BaseModel):
    idea: str | None = None
    cue: str | None = None


@app.put("/api/palace/{pid}")
def palace_edit(pid: int, e: PalaceEdit):
    if e.idea is not None:
        db.run("UPDATE palace SET idea=? WHERE id=?", (e.idea.strip()[:400], pid))
    if e.cue is not None:
        db.run("UPDATE palace SET cue=? WHERE id=?", (e.cue.strip()[:400], pid))
    return {"ok": True}


class Recall(BaseModel):
    ok: bool


@app.post("/api/palace/{pid}/recall")
def palace_recall(pid: int, r: Recall):
    db.run(f"UPDATE palace SET {'recalled=recalled+1' if r.ok else 'missed=missed+1'} WHERE id=?", (pid,))
    return {"ok": True}


@app.delete("/api/palace/{pid}")
def palace_del(pid: int):
    db.run("DELETE FROM palace WHERE id=?", (pid,))
    return {"ok": True}


# ------------------------------------------------------------------ emotion tags & explanations
@app.post("/api/paragraphs/{pid}/tag")
def tag(pid: int, tag: str):
    return extras.toggle_tag(pid, tag)


@app.get("/api/books/{book_id}/tags")
def tags(book_id: int, tag: str = ""):
    return {"items": extras.tagged(book_id, tag or None), "labels": extras.TAGS}


@app.post("/api/paragraphs/{pid}/explain")
def explain_para(pid: int):
    db.run("DELETE FROM explains WHERE para_id=?", (pid,))
    meta, gen = extras.stream_explain(pid)
    return _stream(meta, gen)


# ------------------------------------------------------------------ journal
@app.get("/api/journal")
def journal_list(book_id: int = 0):
    return {"items": extras.journal(book_id or None)}


class JournalReq(BaseModel):
    book_id: int
    text: str
    page_from: int = 0
    page_to: int = 0
    minutes: int = 0


@app.post("/api/journal")
def journal_add(j: JournalReq):
    return {"id": extras.journal_add(j.book_id, j.text, j.page_from, j.page_to, j.minutes)}


@app.delete("/api/journal/{jid}")
def journal_del(jid: int):
    db.run("DELETE FROM journal WHERE id=?", (jid,))
    return {"ok": True}


# ------------------------------------------------------------------ evening review, reading log, stats
@app.get("/api/evening")
def evening(since: str):
    return extras.evening(since)


class LogReq(BaseModel):
    book_id: int
    page: int
    seconds: int
    day: str


@app.post("/api/log")
def log(r: LogReq):
    extras.log_reading(r.book_id, r.page, r.seconds, r.day[:10])
    return {"ok": True}


@app.get("/api/stats")
def stats(today: str):
    return extras.stats(today[:10])


# ------------------------------------------------------------------ teaching post
def _chapter(book_id: int, page: int) -> tuple[int, int, str]:
    return _quiz_range(book_id, "chapter", page)


@app.get("/api/books/{book_id}/post")
def post_get(book_id: int, page: int):
    start, end, label = _chapter(book_id, page)
    return {"start": start, "end": end, "label": label, "post": extras.post_get(book_id, start, end)}


@app.post("/api/books/{book_id}/post/outline")
def post_outline(book_id: int, page: int):
    start, end, label = _chapter(book_id, page)
    return {"outline": extras.post_outline(book_id, start, end)}


class PostText(BaseModel):
    text: str


@app.put("/api/books/{book_id}/post")
def post_save(book_id: int, page: int, p: PostText):
    start, end, _ = _chapter(book_id, page)
    extras.post_save(book_id, start, end, p.text[:8000])
    return {"ok": True}


@app.post("/api/books/{book_id}/post/feedback")
def post_feedback(book_id: int, page: int, p: PostText):
    start, end, _ = _chapter(book_id, page)
    return extras.post_feedback(book_id, start, end, p.text)


# ------------------------------------------------------------------ search
@app.get("/api/search")
def search(q: str, book_id: int = 0):
    return extras.search(q, book_id or None)


@app.get("/api/books/{book_id}/index")
def index_state(book_id: int):
    return extras.index_state(book_id)


@app.post("/api/books/{book_id}/index")
def index_build(book_id: int):
    return {"started": extras.start_index(book_id)}


@app.get("/api/index")
def index_all():
    return {"books": [{"id": b["id"], "title": b["title"], **extras.index_state(b["id"])}
                      for b in db.rows("SELECT id, title FROM books WHERE status='ready' ORDER BY title")]}


# ------------------------------------------------------------------ phone access & offline export
def _lan_ips() -> list[str]:
    ips = []
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1)); ips.append(s.getsockname()[0]); s.close()
    except OSError:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            if not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except OSError:
        pass
    return ips


@app.get("/api/server")
def server_info(request: Request):
    import qrcode
    import qrcode.image.svg
    s = load_settings()
    port = request.url.port or 8765
    urls = [f"http://{ip}:{port}/?t={s['server']['token']}" for ip in _lan_ips()]
    qr = ""
    if urls:
        buf = io.BytesIO()
        qrcode.make(urls[0], image_factory=qrcode.image.svg.SvgPathImage, box_size=8, border=2).save(buf)
        qr = buf.getvalue().decode()
    host = getattr(request.app.state, "bound_host", "127.0.0.1")
    from .config import DATA
    return {"lan": s["server"]["lan"], "active": host == "0.0.0.0", "urls": urls, "qr": qr, "data_dir": str(DATA)}


class ServerReq(BaseModel):
    lan: bool


@app.put("/api/server")
def server_set(r: ServerReq):
    save_settings({"server": {"lan": r.lan}})
    return {"ok": True}


@app.post("/api/server/token")
def server_token():
    save_settings({"server": {"token": secrets.token_urlsafe(9)}})
    return {"ok": True}


class ImportReq(BaseModel):
    path: str


@app.post("/api/import-data")
def import_data(r: ImportReq, request: Request):
    """Copy the data folder of an older (zip) installation into the current data folder."""
    host = request.client.host if request.client else ""
    if host not in LOCAL and not host.startswith("127."):
        raise HTTPException(403, "فقط از روی خود لپ‌تاپ")
    src = Path(r.path.strip().strip('"'))
    if src.is_file():
        src = src.parent
    if (src / "data" / "varagh.db").exists():
        src = src / "data"
    if not (src / "varagh.db").exists():
        raise HTTPException(400, "در این پوشه فایل varagh.db پیدا نشد. پوشه‌ی data نسخه‌ی قبلی (یا خود پوشه‌ی varagh) را بده.")
    from .config import DATA
    if src.resolve() == DATA.resolve():
        raise HTTPException(400, "این همان پوشه‌ی داده‌های فعلی است.")
    for ext in ("", "-wal", "-shm"):
        (DATA / f"varagh.db{ext}").unlink(missing_ok=True)
        if (src / f"varagh.db{ext}").exists():
            shutil.copy2(src / f"varagh.db{ext}", DATA / f"varagh.db{ext}")
    if (src / "settings.json").exists():
        shutil.copy2(src / "settings.json", DATA / "settings.json")
    for d in ("books", "covers"):
        if (src / d).is_dir():
            shutil.copytree(src / d, DATA / d, dirs_exist_ok=True)
    db.init()
    return {"ok": True}


@app.get("/api/books/{book_id}/export")
def export(book_id: int, page: int = 1, scope: str = "chapter"):
    b = _book(book_id)
    if scope == "book":
        start, end = 1, b["pages"]
    else:
        start, end, _ = _quiz_range(book_id, scope, page)
    doc, fname = extras.export_html(book_id, start, end)
    return Response(doc, media_type="text/html; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{fname}"'})


# ------------------------------------------------------------------ deep learning (10 features)
@app.get("/api/books/{book_id}/xray")
def xray_get(book_id: int, page: int = 1):
    _book(book_id)
    return deep.get_xray(book_id, page)


@app.post("/api/books/{book_id}/xray")
def xray_build(book_id: int, page: int = 1):
    _book(book_id)
    return deep.build_xray(book_id, page)


@app.get("/api/books/{book_id}/tutor")
def tutor_get(book_id: int, page: int = 1):
    _book(book_id)
    return {"messages": deep.get_tutor_history(book_id, page)}


class TutorReq(BaseModel):
    page: int = 1
    message: str = ""
    mode: str = "ask"
    para_id: int | None = None


@app.post("/api/books/{book_id}/tutor")
def tutor_chat(book_id: int, r: TutorReq):
    _book(book_id)
    meta, gen = deep.stream_tutor(book_id, r.page, r.message, r.mode, r.para_id)
    return _stream(meta, gen)


@app.delete("/api/books/{book_id}/tutor")
def tutor_clear(book_id: int, page: int = 1):
    deep.clear_tutor_history(book_id, page)
    return {"ok": True}


@app.get("/api/books/{book_id}/feynman")
def feynman_get(book_id: int, page: int = 1):
    _book(book_id)
    return deep.get_feynman(book_id, page)


class FeynmanReq(BaseModel):
    page: int = 1
    topic: str = ""
    explanation: str


@app.post("/api/books/{book_id}/feynman")
def feynman_check(book_id: int, r: FeynmanReq):
    _book(book_id)
    return deep.check_feynman(book_id, r.page, r.topic, r.explanation)


@app.get("/api/books/{book_id}/concepts")
def concepts_get(book_id: int, scope: str = "chapter", page: int = 1):
    start, end, label = _quiz_range(book_id, scope, page) if scope == "chapter" else _mm_range(book_id, scope, page)
    return {"start": start, "end": end, "label": label, "graph": deep.get_concept_graph(book_id, start, end)}


@app.post("/api/books/{book_id}/concepts")
def concepts_build(book_id: int, scope: str = "chapter", page: int = 1):
    start, end, label = _quiz_range(book_id, scope, page) if scope == "chapter" else _mm_range(book_id, scope, page)
    return {"start": start, "end": end, "label": label, "graph": deep.build_concept_graph(book_id, start, end)}


@app.post("/api/paragraphs/{pid}/cards/generate")
def para_cards_gen(pid: int):
    return deep.generate_conceptual_cards(pid)


@app.post("/api/paragraphs/{pid}/explain-deep")
def para_explain_deep(pid: int, level: str = "eli5"):
    meta, gen = deep.stream_deep_explain(pid, level)
    return _stream(meta, gen)


@app.get("/api/books/{book_id}/critique")
def critique_get(book_id: int, page: int = 1):
    _book(book_id)
    return deep.get_critique(book_id, page)


@app.post("/api/books/{book_id}/critique")
def critique_build(book_id: int, page: int = 1):
    _book(book_id)
    return deep.build_critique(book_id, page)


@app.get("/api/books/{book_id}/pages/{page}/heatmap")
def heatmap_get(book_id: int, page: int):
    _book(book_id)
    return {"heatmap": deep.get_heatmap(book_id, page)}


@app.post("/api/books/{book_id}/pages/{page}/heatmap")
def heatmap_build(book_id: int, page: int):
    _book(book_id)
    return {"heatmap": deep.build_heatmap(book_id, page)}


class RegionReq(BaseModel):
    x: float
    y: float
    w: float
    h: float
    question: str = ""


@app.post("/api/books/{book_id}/pages/{page}/analyze-region")
def analyze_region(book_id: int, page: int, r: RegionReq):
    _book(book_id)
    return deep.analyze_page_region(book_id, page, r.x, r.y, r.w, r.h, r.question)


@app.get("/api/books/{book_id}/pages/{page}/connections")
def connections_get(book_id: int, page: int):
    _book(book_id)
    return deep.cross_book_connections(book_id, page)


@app.post("/api/books/{book_id}/pages/{page}/connections/synthesize")
def connections_synth(book_id: int, page: int):
    _book(book_id)
    return deep.synthesize_connections(book_id, page)


@app.get("/api/books/{book_id}/export-obsidian")
def export_obsidian(book_id: int):
    md, fname = deep.export_obsidian_markdown(book_id)
    return Response(md, media_type="text/markdown; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{quote(fname)}"'})


@app.post("/api/books/{book_id}/sync-obsidian")
def sync_obsidian(book_id: int):
    return deep.sync_obsidian(book_id)


# ------------------------------------------------------------------ frontend
app.mount("/static", StaticFiles(directory=FRONTEND), name="static")


@app.get("/")
def index():
    return FileResponse(FRONTEND / "index.html")
