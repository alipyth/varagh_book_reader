"""Memory palace, session journal, emotion tags, evening review, teaching posts,
semantic search, reading log and learning statistics, offline chapter export."""
from __future__ import annotations

import base64
import html
import json
import math
import operator
from array import array
import re
import threading
import traceback
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

import httpx
from fsrs import Card, Scheduler

from . import db, prompts
from .config import FRONTEND, load_settings
from .providers import LLMError, chat, open_stream, parse_json
from .router import resolve
from .study import _condense, chapter_range
from .translate import _finish, glossary_for

# ------------------------------------------------------------------ rooms (chapters) of the memory palace
ROOM_NAMES = ["ورودی", "هال", "کتابخانه", "آشپزخانه", "اتاق کار", "اتاق خواب", "حیاط", "زیرزمین",
              "بالکن", "راه‌پله", "اتاق موسیقی", "انباری", "گلخانه", "اتاق زیر شیروانی"]
SPOTS = ["کنار در", "روی میز", "لب پنجره", "روی قفسه", "روی صندلی", "کنار شومینه", "پشت پرده", "وسط فرش"]


def rooms(book_id: int) -> list[dict]:
    b = db.one("SELECT pages, toc_json, last_page FROM books WHERE id=?", (book_id,))
    toc = json.loads(b["toc_json"] or "[]")
    out = []
    if toc:
        top = min(t[0] for t in toc)
        heads = [t for t in toc if t[0] <= top + 1]
        for i, (lvl, title, pg) in enumerate(heads):
            end = (heads[i + 1][2] - 1) if i + 1 < len(heads) else b["pages"]
            out.append({"start": pg, "end": max(pg, end), "title": title})
        if out and out[0]["start"] > 1:
            out.insert(0, {"start": 1, "end": out[0]["start"] - 1, "title": "پیش از فصل اول"})
    else:
        for s in range(1, b["pages"] + 1, 10):
            out.append({"start": s, "end": min(b["pages"], s + 9), "title": f"صفحه‌ی {s} تا {min(b['pages'], s + 9)}"})
    for i, r in enumerate(out):
        r["room"] = ROOM_NAMES[i % len(ROOM_NAMES)] + ("" if i < len(ROOM_NAMES) else f" {i // len(ROOM_NAMES) + 1}")
        r["open"] = r["start"] <= (b["last_page"] or 1)
    return out


def room_of(book_id: int, page: int) -> dict:
    for r in rooms(book_id):
        if r["start"] <= page <= r["end"]:
            return r
    return rooms(book_id)[-1]


def palace(book_id: int) -> dict:
    items = db.rows("SELECT * FROM palace WHERE book_id=? ORDER BY room_start, spot", (book_id,))
    by = defaultdict(list)
    for it in items:
        it["spot_name"] = SPOTS[it["spot"] % len(SPOTS)]
        by[it["room_start"]].append(it)
    rs = rooms(book_id)
    for r in rs:
        r["items"] = by.get(r["start"], [])
    return {"rooms": rs, "spots": SPOTS}


def _free_spot(book_id: int, room_start: int) -> int:
    used = {r["spot"] for r in db.rows("SELECT spot FROM palace WHERE book_id=? AND room_start=?", (book_id, room_start))}
    for i in range(len(SPOTS)):
        if i not in used:
            return i
    raise LLMError("این اتاق پر است (۸ جا). یکی از چیزهای این اتاق را بردار.")


def palace_add(book_id: int, page: int, idea: str, cue: str, source: str = "manual") -> dict:
    r = room_of(book_id, page)
    spot = _free_spot(book_id, r["start"])
    pid = db.run("INSERT INTO palace(book_id, room_start, spot, idea, cue, page, source, created) VALUES(?,?,?,?,?,?,?,?)",
                 (book_id, r["start"], spot, idea.strip()[:400], cue.strip()[:400], page, source, db.now()))
    return {"id": pid, "room": r["room"], "spot": SPOTS[spot]}


def palace_fill(book_id: int, page: int) -> dict:
    """Ask the model for the chapter's key ideas, each with a vivid image placed at a free spot."""
    r = room_of(book_id, page)
    used = {x["spot"] for x in db.rows("SELECT spot FROM palace WHERE book_id=? AND room_start=?", (book_id, r["start"]))}
    free = [i for i in range(5) if i not in used]
    if not free:
        raise LLMError("جاهای اصلی این اتاق پر است.")
    s = load_settings()
    provider, model, _ = resolve("palace", s)
    text, _ = _condense(book_id, r["start"], min(r["end"], page if page >= r["start"] else r["end"]), provider, model, s, "palace", marks=True)
    out = parse_json(chat(provider, model, prompts.PALACE_SYS, prompts.palace(text, r["room"], [SPOTS[i] for i in free]),
                          settings=s, task="palace", json_mode=True, num_ctx=s["ollama"].get("num_ctx_page")))
    items = out.get("items", []) if isinstance(out, dict) else out
    added = 0
    for spot, it in zip(free, [i for i in items if isinstance(i, dict) and i.get("idea")]):
        try:
            pg = int(it.get("page") or r["start"])
        except (TypeError, ValueError):
            pg = r["start"]
        db.run("INSERT INTO palace(book_id, room_start, spot, idea, cue, page, source, created) VALUES(?,?,?,?,?,?,?,?)",
               (book_id, r["start"], spot, str(it["idea"]).strip()[:400], str(it.get("cue") or "").strip()[:400],
                pg if r["start"] <= pg <= r["end"] else r["start"], "auto", db.now()))
        added += 1
    if not added:
        raise LLMError("مدل چیزی برای گذاشتن در اتاق برنگرداند؛ دوباره امتحان کن.")
    return {"added": added, "room": r["room"]}


# ------------------------------------------------------------------ emotion tags and explanations
TAGS = {"wow": "شگفت‌زده‌ام کرد", "unclear": "برایم مبهم بود", "love": "دوستش داشتم"}


def toggle_tag(para_id: int, tag: str) -> dict:
    if tag not in TAGS:
        raise LLMError("برچسب ناشناخته")
    p = db.one("SELECT book_id, page FROM paragraphs WHERE id=?", (para_id,))
    if not p:
        raise LLMError("پاراگراف پیدا نشد")
    if db.one("SELECT 1 FROM tags WHERE para_id=? AND tag=?", (para_id, tag)):
        db.run("DELETE FROM tags WHERE para_id=? AND tag=?", (para_id, tag))
        on = False
    else:
        db.run("INSERT INTO tags(para_id, book_id, page, tag, created) VALUES(?,?,?,?,?)", (para_id, p["book_id"], p["page"], tag, db.now()))
        on = True
    return {"tag": tag, "on": on, "tags": [r["tag"] for r in db.rows("SELECT tag FROM tags WHERE para_id=?", (para_id,))]}


def tagged(book_id: int, tag: str | None = None) -> list[dict]:
    q = ("SELECT t.para_id, t.page, t.tag, t.created, p.text, tr.text AS fa, e.text AS explain "
         "FROM tags t JOIN paragraphs p ON p.id=t.para_id "
         "LEFT JOIN translations tr ON tr.para_id=t.para_id AND tr.kind='base' "
         "LEFT JOIN explains e ON e.para_id=t.para_id WHERE t.book_id=?")
    args: list = [book_id]
    if tag:
        q += " AND t.tag=?"; args.append(tag)
    return db.rows(q + " ORDER BY t.page, p.idx", tuple(args))


def stream_explain(para_id: int):
    p = db.one("SELECT * FROM paragraphs WHERE id=?", (para_id,))
    if not p:
        raise LLMError("پاراگراف پیدا نشد")
    prev = db.one("SELECT text FROM paragraphs WHERE book_id=? AND idx=?", (p["book_id"], p["idx"] - 1))
    s = load_settings()
    provider, model, _ = resolve("explain", s)
    terms = prompts.relevant_terms(glossary_for(p["book_id"]), p["text"])
    gen = open_stream(provider, model, prompts.EXPLAIN_SYS, prompts.explain(p["text"], prev["text"] if prev else "", terms),
                      settings=s, task="explain")

    def save(t):
        db.run("INSERT OR REPLACE INTO explains(para_id, text, provider, model, created) VALUES(?,?,?,?,?)",
               (para_id, t, provider, model, db.now()))
    return {"provider": provider, "model": model}, _finish(gen, save)


# ------------------------------------------------------------------ journal
def journal(book_id: int | None = None) -> list[dict]:
    if book_id:
        return db.rows("SELECT j.*, b.title FROM journal j LEFT JOIN books b ON b.id=j.book_id WHERE j.book_id=? ORDER BY j.created DESC", (book_id,))
    return db.rows("SELECT j.*, b.title FROM journal j LEFT JOIN books b ON b.id=j.book_id ORDER BY j.created DESC LIMIT 200")


def journal_add(book_id: int, text: str, page_from: int, page_to: int, minutes: int) -> int:
    if not text.strip():
        raise LLMError("جمله‌ای ننوشتی")
    return db.run("INSERT INTO journal(book_id, text, page_from, page_to, minutes, created) VALUES(?,?,?,?,?,?)",
                  (book_id, text.strip()[:1000], page_from, page_to, minutes, db.now()))


# ------------------------------------------------------------------ evening review
def evening(since: str) -> dict:
    tags = db.rows("SELECT t.para_id, t.book_id, t.page, t.tag, p.text, tr.text AS fa, b.title FROM tags t "
                   "JOIN paragraphs p ON p.id=t.para_id LEFT JOIN translations tr ON tr.para_id=t.para_id AND tr.kind='base' "
                   "LEFT JOIN books b ON b.id=t.book_id WHERE t.created>=? AND t.tag IN ('love','wow') ORDER BY t.created", (since,))
    notes = db.rows("SELECT j.text, j.book_id, j.page_from, j.page_to, b.title FROM journal j LEFT JOIN books b ON b.id=j.book_id "
                    "WHERE j.created>=? ORDER BY j.created", (since,))
    cards = db.rows("SELECT c.id, c.front, c.back, c.context, c.page, b.title FROM cards c LEFT JOIN books b ON b.id=c.book_id "
                    "WHERE c.created>=? ORDER BY c.created", (since,))
    pal = db.rows("SELECT p.id, p.idea, p.cue, p.spot, p.room_start, p.book_id, b.title FROM palace p LEFT JOIN books b ON b.id=p.book_id "
                  "WHERE p.created>=? ORDER BY p.created", (since,))
    for x in pal:
        x["spot_name"] = SPOTS[x["spot"] % len(SPOTS)]
        x["room"] = room_of(x["book_id"], x["room_start"])["room"]
    read = db.one("SELECT COALESCE(SUM(seconds),0) s, COUNT(DISTINCT book_id||'-'||page) p FROM reading_log WHERE ts>=?", (since,))
    return {"tags": tags, "journal": notes, "cards": cards, "palace": pal, "seconds": read["s"], "pages": read["p"]}


# ------------------------------------------------------------------ teaching post
def post_get(book_id: int, start: int, end: int) -> dict | None:
    r = db.one("SELECT * FROM posts WHERE book_id=? AND start_page=? AND end_page=?", (book_id, start, end))
    if r:
        r["outline"] = json.loads(r["outline"] or "null")
    return r


def post_outline(book_id: int, start: int, end: int) -> dict:
    s = load_settings()
    provider, model, _ = resolve("post", s)
    text, _ = _condense(book_id, start, end, provider, model, s, "post", marks=False)
    out = parse_json(chat(provider, model, prompts.POST_SYS, prompts.post_outline(text), settings=s, task="post",
                          json_mode=True, num_ctx=s["ollama"].get("num_ctx_page")))
    if not isinstance(out, dict) or not out.get("points"):
        raise LLMError("مدل اسکلت قابل استفاده‌ای برنگرداند؛ دوباره امتحان کن.")
    existing = post_get(book_id, start, end)
    db.run("INSERT INTO posts(book_id, start_page, end_page, outline, text, updated) VALUES(?,?,?,?,?,?) "
           "ON CONFLICT(book_id, start_page, end_page) DO UPDATE SET outline=excluded.outline, updated=excluded.updated",
           (book_id, start, end, json.dumps(out, ensure_ascii=False), existing["text"] if existing else "", db.now()))
    return out


def post_save(book_id: int, start: int, end: int, text: str) -> None:
    db.run("INSERT INTO posts(book_id, start_page, end_page, outline, text, updated) VALUES(?,?,?,?,?,?) "
           "ON CONFLICT(book_id, start_page, end_page) DO UPDATE SET text=excluded.text, updated=excluded.updated",
           (book_id, start, end, None, text, db.now()))


def post_feedback(book_id: int, start: int, end: int, text: str) -> dict:
    if len(text.strip()) < 40:
        raise LLMError("اول چند جمله بنویس، بعد بازخورد بگیر.")
    s = load_settings()
    provider, model, _ = resolve("post", s)
    src, _ = _condense(book_id, start, end, provider, model, s, "post", marks=False)
    out = parse_json(chat(provider, model, prompts.POST_SYS, prompts.post_feedback(src[:6000], text[:4000]),
                          settings=s, task="post", json_mode=True, num_ctx=s["ollama"].get("num_ctx_page")))
    if not isinstance(out, dict):
        raise LLMError("پاسخ مدل قابل خواندن نبود")
    return {"good": [str(x) for x in out.get("good", [])][:4], "improve": [str(x) for x in out.get("improve", [])][:4],
            "accuracy": str(out.get("accuracy") or "")}


# ------------------------------------------------------------------ semantic search
_embed_running: set[int] = set()


def _unit(v) -> array:
    a = array("f", v)
    n = math.sqrt(sum(x * x for x in a)) or 1.0
    return array("f", (x / n for x in a))


def _embed(texts: list[str], s: dict) -> list:
    cfg = s["ollama"]
    model = cfg.get("embed_model") or ""
    if not model:
        raise LLMError("مدل embedding انتخاب نشده. در تنظیمات، بخش Ollama، «مدل جست‌وجوی معنایی» را بگذار (مثلاً bge-m3).")
    base = cfg["base_url"].rstrip("/")
    try:
        r = httpx.post(base + "/api/embed", json={"model": model, "input": texts, "keep_alive": cfg.get("keep_alive", "30m")}, timeout=600)
        if r.status_code == 404 and "not found" not in r.text.lower():
            vecs = []
            for t in texts:   # older Ollama
                r2 = httpx.post(base + "/api/embeddings", json={"model": model, "prompt": t}, timeout=120)
                r2.raise_for_status(); vecs.append(r2.json()["embedding"])
        else:
            if r.status_code != 200:
                if "not found" in r.text.lower():
                    raise LLMError(f"مدل «{model}» روی Ollama نصب نیست. با ollama pull {model} نصبش کن.")
                raise LLMError(f"خطای Ollama ({r.status_code}): {r.text[:200]}")
            vecs = r.json()["embeddings"]
    except httpx.HTTPError as e:
        raise LLMError(f"Ollama در دسترس نیست: {e}") from e
    return [_unit(v) for v in vecs]


def index_state(book_id: int) -> dict:
    s = load_settings()
    model = s["ollama"].get("embed_model") or ""
    total = db.one("SELECT COUNT(*) n FROM paragraphs WHERE book_id=? AND kind<>'raw'", (book_id,))["n"]
    done = db.one("SELECT COUNT(*) n FROM embeddings WHERE book_id=? AND model=?", (book_id, model))["n"] if model else 0
    return {"model": model, "total": total, "done": done, "running": book_id in _embed_running}


def start_index(book_id: int) -> bool:
    s = load_settings()
    if not s["ollama"].get("embed_model"):
        raise LLMError("مدل embedding انتخاب نشده. در تنظیمات، بخش Ollama، «مدل جست‌وجوی معنایی» را بگذار (مثلاً bge-m3).")
    if book_id in _embed_running:
        return False
    _embed_running.add(book_id)

    def job():
        try:
            model = s["ollama"]["embed_model"]
            todo = db.rows("SELECT p.id, p.text FROM paragraphs p LEFT JOIN embeddings e ON e.para_id=p.id AND e.model=? "
                           "WHERE p.book_id=? AND p.kind<>'raw' AND e.para_id IS NULL ORDER BY p.idx", (model, book_id))
            for i in range(0, len(todo), 24):
                batch = todo[i:i + 24]
                vecs = _embed([t["text"][:2000] for t in batch], s)
                with db.db() as con:
                    con.executemany("INSERT OR REPLACE INTO embeddings(para_id, book_id, model, vec) VALUES(?,?,?,?)",
                                    [(t["id"], book_id, model, v.tobytes()) for t, v in zip(batch, vecs)])
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        finally:
            _embed_running.discard(book_id)
    threading.Thread(target=job, daemon=True).start()
    return True


def search(q: str, book_id: int | None = None, limit: int = 25) -> dict:
    q = q.strip()
    if not q:
        return {"semantic": False, "results": []}
    s = load_settings()
    model = s["ollama"].get("embed_model") or ""
    results, semantic, note = [], False, ""
    rows = []
    if model:
        sql = "SELECT e.para_id, e.vec FROM embeddings e WHERE e.model=?" + (" AND e.book_id=?" if book_id else "")
        rows = db.rows(sql, (model, book_id) if book_id else (model,))
    if rows:
        try:
            qv = _embed([q], s)[0]
            scored = []
            for r in rows:
                v = array("f"); v.frombytes(r["vec"])
                if len(v) == len(qv):
                    scored.append((sum(map(operator.mul, v, qv)), r["para_id"]))
            scored.sort(reverse=True)
            ids = [pid for _, pid in scored[:limit]]
            sc = {pid: sc_ for sc_, pid in scored[:limit]}
            semantic = True
        except LLMError as e:
            note, ids, sc = str(e), [], {}
    else:
        ids, sc = [], {}
        note = "" if model else "جست‌وجوی معنایی خاموش است؛ نتیجه‌ها بر اساس کلمه است."
    if not semantic:
        like = f"%{q}%"
        sql = ("SELECT DISTINCT p.id FROM paragraphs p LEFT JOIN translations t ON t.para_id=p.id "
               "WHERE (p.text LIKE ? OR t.text LIKE ?)" + (" AND p.book_id=?" if book_id else "") + " ORDER BY p.book_id, p.idx LIMIT ?")
        ids = [r["id"] for r in db.rows(sql, (like, like, book_id, limit) if book_id else (like, like, limit))]
    if ids:
        marks = ",".join("?" * len(ids))
        info = {r["id"]: r for r in db.rows(
            f"SELECT p.id, p.book_id, p.page, p.text, b.title, t.text AS fa FROM paragraphs p JOIN books b ON b.id=p.book_id "
            f"LEFT JOIN translations t ON t.para_id=p.id AND t.kind='base' WHERE p.id IN ({marks})", tuple(ids))}
        for i in ids:
            if i in info:
                r = info[i]; r["score"] = round(sc.get(i, 0), 3); results.append(r)
    return {"semantic": semantic, "results": results, "note": note}


# ------------------------------------------------------------------ reading log & stats
def log_reading(book_id: int, page: int, seconds: int, day: str) -> None:
    seconds = max(0, min(int(seconds), 120))
    db.run("INSERT INTO reading_log(book_id, page, day, seconds, ts) VALUES(?,?,?,?,?) "
           "ON CONFLICT(book_id, page, day) DO UPDATE SET seconds=seconds+excluded.seconds, ts=excluded.ts",
           (book_id, page, day, seconds, db.now()))


_sched = Scheduler()


def stats(today: str) -> dict:
    t = datetime.strptime(today, "%Y-%m-%d").date()
    days = [(t - timedelta(days=i)).isoformat() for i in range(29, -1, -1)]
    per_day = {r["day"]: r for r in db.rows("SELECT day, SUM(seconds) s, COUNT(*) p FROM reading_log GROUP BY day")}
    daily = [{"day": d, "minutes": round((per_day.get(d) or {}).get("s", 0) / 60, 1), "pages": (per_day.get(d) or {}).get("p", 0)} for d in days]
    streak, d = 0, t
    if not (per_day.get(d.isoformat()) or {}).get("s"):
        d = d - timedelta(days=1)                    # today not started yet: keep yesterday's streak alive
    while (per_day.get(d.isoformat()) or {}).get("s", 0) >= 60:
        streak += 1; d -= timedelta(days=1)

    # reading speed: words on pages you spent time on / time spent
    rows = db.rows("SELECT r.book_id, r.page, r.seconds, (SELECT COALESCE(SUM(length(text) - length(replace(text,' ',''))+1),0) "
                   "FROM paragraphs p WHERE p.book_id=r.book_id AND p.page=r.page) words FROM reading_log r")
    secs = sum(r["seconds"] for r in rows if r["seconds"] >= 20)
    words = sum(r["words"] for r in rows if r["seconds"] >= 20)
    wpm = round(words / (secs / 60)) if secs >= 120 else None

    # vocabulary growth & card maturity
    cards = db.rows("SELECT c.created, c.fsrs, c.book_id, c.page FROM cards c ORDER BY c.created")
    growth, n, by_day = [], 0, Counter(c["created"][:10] for c in cards)
    first = min([c["created"][:10] for c in cards] or [days[0]])
    start = min(datetime.strptime(first, "%Y-%m-%d").date(), t - timedelta(days=29))
    cur, n = start, 0
    while cur <= t:
        n += by_day.get(cur.isoformat(), 0)
        if cur.isoformat() in days:
            growth.append({"day": cur.isoformat(), "total": n})
        cur += timedelta(days=1)
    now = datetime.now(timezone.utc)
    mature, retr = 0, []
    for c in cards:
        card = Card.from_dict(json.loads(c["fsrs"]))
        if (card.stability or 0) >= 21:
            mature += 1
        rr = _sched.get_card_retrievability(card, now) if card.last_review else None
        retr.append((c, rr))

    # retention per chapter (cards + palace walks), only for chapters you have reviewed something from
    books = {b["id"]: b for b in db.rows("SELECT id, title, pages FROM books WHERE status='ready'")}
    chap = defaultdict(lambda: {"sum": 0.0, "n": 0, "cards": 0})
    for c, rr in retr:
        if c["book_id"] in books and rr is not None:
            rng = chapter_range(c["book_id"], c["page"] or 1)
            key = (c["book_id"], rng[0] if rng else 1, rng[2] if rng else "")
            chap[key]["sum"] += rr; chap[key]["n"] += 1
    for p in db.rows("SELECT book_id, room_start, recalled, missed FROM palace WHERE recalled+missed>0"):
        if p["book_id"] in books:
            rng = chapter_range(p["book_id"], p["room_start"])
            key = (p["book_id"], rng[0] if rng else 1, rng[2] if rng else "")
            chap[key]["sum"] += p["recalled"] / (p["recalled"] + p["missed"]); chap[key]["n"] += 1
    retention = [{"book_id": k[0], "book": books[k[0]]["title"], "start": k[1], "chapter": k[2] or f"از صفحه‌ی {k[1]}",
                  "value": round(v["sum"] / v["n"] * 100), "n": v["n"]} for k, v in chap.items() if v["n"]]
    retention.sort(key=lambda x: (x["book_id"], x["start"]))

    # emotional arc per book
    arcs = []
    for bid, b in books.items():
        tg = db.rows("SELECT page, tag FROM tags WHERE book_id=?", (bid,))
        if not tg:
            continue
        bins = max(1, min(20, b["pages"] // 5 or 1))
        size = b["pages"] / bins
        series = {k: [0] * bins for k in TAGS}
        for r in tg:
            series[r["tag"]][min(bins - 1, int((r["page"] - 1) / size))] += 1
        arcs.append({"book_id": bid, "book": b["title"], "bins": bins, "size": size, "series": series})

    tot = db.one("SELECT COALESCE(SUM(seconds),0) s, COUNT(DISTINCT book_id||'-'||page) p FROM reading_log")
    return {"daily": daily, "streak": streak, "wpm": wpm, "growth": growth, "cards": len(cards), "mature": mature,
            "retention": retention, "arcs": arcs, "minutes": round(tot["s"] / 60), "pages": tot["p"],
            "journal": db.one("SELECT COUNT(*) n FROM journal")["n"], "palace": db.one("SELECT COUNT(*) n FROM palace")["n"]}


# ------------------------------------------------------------------ offline chapter export
def export_html(book_id: int, start: int, end: int) -> tuple[str, str]:
    b = db.one("SELECT title, author, pages FROM books WHERE id=?", (book_id,))
    rows = db.rows("SELECT p.page, p.kind, p.text, COALESCE(tb.text, t.text) fa FROM paragraphs p "
                   "LEFT JOIN translations t ON t.para_id=p.id AND t.kind='base' "
                   "LEFT JOIN translations tb ON tb.para_id=p.id AND tb.kind='better' "
                   "WHERE p.book_id=? AND p.page BETWEEN ? AND ? ORDER BY p.idx", (book_id, start, end))
    font = base64.b64encode((FRONTEND / "fonts" / "Vazirmatn.woff2").read_bytes()).decode()
    e = html.escape
    body, last = [], None
    for r in rows:
        if r["page"] != last:
            body.append(f'<div class="pg">صفحه‌ی {r["page"]}</div>'); last = r["page"]
        cls = "h" if r["kind"] == "h" else ""
        fa = f'<p class="fa">{e(r["fa"])}</p>' if r["fa"] else '<p class="fa none">ترجمه نشده</p>'
        body.append(f'<div class="p {cls}">{fa}<details><summary>متن اصلی</summary><p class="en">{e(r["text"])}</p></details></div>')
    title = f'{b["title"]} · ص {start} تا {end}'
    doc = f"""<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>{e(title)}</title>
<style>@font-face{{font-family:V;src:url(data:font/woff2;base64,{font}) format("woff2");font-weight:100 900}}
:root{{--bg:#F6F1E6;--ink:#2B2418;--mu:#7A6D58;--line:#E2D6BE}}
@media (prefers-color-scheme:dark){{:root{{--bg:#11161C;--ink:#D5DDE5;--mu:#86939F;--line:#26303A}}}}
body{{margin:0;background:var(--bg);color:var(--ink);font-family:V,Tahoma,sans-serif;line-height:2.1;font-size:18px}}
main{{max-width:680px;margin:0 auto;padding:24px 18px 80px}} h1{{font-size:1.3rem;line-height:1.5}}
.pg{{color:var(--mu);font-size:.8rem;border-top:1px dashed var(--line);margin-top:28px;padding-top:6px}}
.p{{margin:14px 0}} .h .fa{{font-weight:800;font-size:1.15em}} .fa{{margin:0;text-align:justify}} .none{{color:var(--mu);font-size:.85rem}}
details summary{{color:var(--mu);font-size:.75rem;cursor:pointer}} .en{{direction:ltr;text-align:left;font-family:Georgia,serif;font-size:.9em;color:var(--mu);line-height:1.7}}
</style></head><body><main><h1>{e(b["title"])}</h1><div class="pg" style="border:0">{e(b["author"] or "")} · صفحه‌ی {start} تا {end} · ساخته‌شده با ورق</div>
{''.join(body)}</main></body></html>"""
    fname = re.sub(r"[^A-Za-z0-9_-]+", "-", b["title"])[:40].strip("-") or "book"
    return doc, f"{fname}-p{start}-{end}.html"
