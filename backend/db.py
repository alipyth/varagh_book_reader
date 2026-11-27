"""SQLite storage. One short-lived connection per call; WAL mode for the background worker."""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone

from .config import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS books(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT, author TEXT, filename TEXT,
  pages INTEGER DEFAULT 0,
  last_page INTEGER DEFAULT 1,
  toc_json TEXT DEFAULT '[]',
  status TEXT DEFAULT 'ingesting',
  error TEXT,
  glossary_status TEXT DEFAULT '',
  created TEXT
);
CREATE TABLE IF NOT EXISTS paragraphs(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER, page INTEGER, idx INTEGER,
  kind TEXT,           -- p | h | raw
  text TEXT
);
CREATE INDEX IF NOT EXISTS ix_para_page ON paragraphs(book_id, page, idx);
CREATE TABLE IF NOT EXISTS translations(
  para_id INTEGER, kind TEXT,  -- base | better
  provider TEXT, model TEXT, text TEXT, created TEXT,
  PRIMARY KEY(para_id, kind)
);
CREATE TABLE IF NOT EXISTS page_translations(
  book_id INTEGER, page INTEGER,
  provider TEXT, model TEXT, text TEXT, created TEXT,
  PRIMARY KEY(book_id, page)
);
CREATE TABLE IF NOT EXISTS glossary(
  book_id INTEGER, term TEXT, fa TEXT, count INTEGER DEFAULT 0, manual INTEGER DEFAULT 0,
  PRIMARY KEY(book_id, term)
);
CREATE TABLE IF NOT EXISTS lookups(
  key TEXT PRIMARY KEY, data TEXT, created TEXT
);
CREATE TABLE IF NOT EXISTS cards(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER, page INTEGER,
  front TEXT, back TEXT, context TEXT,
  fsrs TEXT, due TEXT, reps INTEGER DEFAULT 0, created TEXT
);
CREATE INDEX IF NOT EXISTS ix_cards_due ON cards(due);
CREATE TABLE IF NOT EXISTS usage(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT, month TEXT, provider TEXT, model TEXT, task TEXT,
  in_tok INTEGER, out_tok INTEGER
);
CREATE INDEX IF NOT EXISTS ix_usage_month ON usage(month, provider);
CREATE TABLE IF NOT EXISTS relations(
  book_id INTEGER, a TEXT, b TEXT, label TEXT, summary TEXT, upto INTEGER, model TEXT, created TEXT,
  PRIMARY KEY(book_id, a, b)
);
CREATE TABLE IF NOT EXISTS mindmaps(
  book_id INTEGER, start_page INTEGER, end_page INTEGER, data TEXT, provider TEXT, model TEXT, created TEXT,
  PRIMARY KEY(book_id, start_page, end_page)
);
CREATE TABLE IF NOT EXISTS recaps(
  book_id INTEGER, start_page INTEGER, end_page INTEGER, text TEXT, provider TEXT, model TEXT, created TEXT,
  PRIMARY KEY(book_id, start_page, end_page)
);
CREATE TABLE IF NOT EXISTS quizzes(
  book_id INTEGER, start_page INTEGER, end_page INTEGER, data TEXT, provider TEXT, model TEXT, created TEXT,
  PRIMARY KEY(book_id, start_page, end_page)
);
CREATE TABLE IF NOT EXISTS palace(
  id INTEGER PRIMARY KEY AUTOINCREMENT, book_id INTEGER, room_start INTEGER, spot INTEGER,
  idea TEXT, cue TEXT, page INTEGER, source TEXT, recalled INTEGER DEFAULT 0, missed INTEGER DEFAULT 0, created TEXT
);
CREATE TABLE IF NOT EXISTS tags(
  para_id INTEGER, book_id INTEGER, page INTEGER, tag TEXT, created TEXT, PRIMARY KEY(para_id, tag)
);
CREATE INDEX IF NOT EXISTS ix_tags_book ON tags(book_id, page);
CREATE TABLE IF NOT EXISTS explains(para_id INTEGER PRIMARY KEY, text TEXT, provider TEXT, model TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS journal(
  id INTEGER PRIMARY KEY AUTOINCREMENT, book_id INTEGER, text TEXT, page_from INTEGER, page_to INTEGER, minutes INTEGER, created TEXT
);
CREATE TABLE IF NOT EXISTS reading_log(
  book_id INTEGER, page INTEGER, day TEXT, seconds INTEGER, ts TEXT, PRIMARY KEY(book_id, page, day)
);
CREATE TABLE IF NOT EXISTS posts(
  book_id INTEGER, start_page INTEGER, end_page INTEGER, outline TEXT, text TEXT, updated TEXT,
  PRIMARY KEY(book_id, start_page, end_page)
);
CREATE TABLE IF NOT EXISTS embeddings(para_id INTEGER, book_id INTEGER, model TEXT, vec BLOB, PRIMARY KEY(para_id, model));
CREATE INDEX IF NOT EXISTS ix_emb_book ON embeddings(book_id, model);
CREATE TABLE IF NOT EXISTS image_prompts(
  id INTEGER PRIMARY KEY AUTOINCREMENT, book_id INTEGER, page INTEGER, style TEXT, aspect TEXT, lang TEXT,
  wish TEXT, text TEXT, provider TEXT, model TEXT, created TEXT
);
CREATE TABLE IF NOT EXISTS xrays(
  book_id INTEGER, start_page INTEGER, end_page INTEGER, data TEXT, provider TEXT, model TEXT, created TEXT,
  PRIMARY KEY(book_id, start_page, end_page)
);
CREATE TABLE IF NOT EXISTS tutor_msgs(
  id INTEGER PRIMARY KEY AUTOINCREMENT, book_id INTEGER, page INTEGER, role TEXT, content TEXT,
  provider TEXT, model TEXT, created TEXT
);
CREATE INDEX IF NOT EXISTS ix_tutor_bp ON tutor_msgs(book_id, page, id);
CREATE TABLE IF NOT EXISTS feynman(
  id INTEGER PRIMARY KEY AUTOINCREMENT, book_id INTEGER, start_page INTEGER, end_page INTEGER,
  topic TEXT, explanation TEXT, feedback_json TEXT, provider TEXT, model TEXT, created TEXT
);
CREATE TABLE IF NOT EXISTS concept_graphs(
  book_id INTEGER, start_page INTEGER, end_page INTEGER, data TEXT, provider TEXT, model TEXT, created TEXT,
  PRIMARY KEY(book_id, start_page, end_page)
);
CREATE TABLE IF NOT EXISTS para_explains(
  para_id INTEGER, level TEXT, domain TEXT, text TEXT, provider TEXT, model TEXT, created TEXT,
  PRIMARY KEY(para_id, level)
);
CREATE TABLE IF NOT EXISTS critiques(
  book_id INTEGER, start_page INTEGER, end_page INTEGER, data TEXT, provider TEXT, model TEXT, created TEXT,
  PRIMARY KEY(book_id, start_page, end_page)
);
CREATE TABLE IF NOT EXISTS page_heatmap(
  book_id INTEGER, page INTEGER, data TEXT, provider TEXT, model TEXT, created TEXT,
  PRIMARY KEY(book_id, page)
);
"""


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def month() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m")


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH, timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA foreign_keys=ON")
    return con


@contextmanager
def db():
    con = connect()
    try:
        yield con
        con.commit()
    finally:
        con.close()


def init() -> None:
    with db() as con:
        con.executescript(SCHEMA)
        cols = {r[1] for r in con.execute("PRAGMA table_info(books)")}
        if "opened" not in cols:
            con.execute("ALTER TABLE books ADD COLUMN opened TEXT")
        gcols = {r[1] for r in con.execute("PRAGMA table_info(glossary)")}
        if "kind" not in gcols:
            con.execute("ALTER TABLE glossary ADD COLUMN kind TEXT DEFAULT 'other'")
        ccols = {r[1] for r in con.execute("PRAGMA table_info(cards)")}
        if "card_type" not in ccols:
            con.execute("ALTER TABLE cards ADD COLUMN card_type TEXT DEFAULT 'vocab'")
        # books left half-imported by a crash
        con.execute("UPDATE books SET status='error', error='ورود کتاب نیمه‌کاره ماند؛ دوباره آپلود کن' WHERE status='ingesting'")
        con.execute("UPDATE books SET glossary_status='' WHERE glossary_status='running'")


def rows(sql: str, args=()) -> list[dict]:
    with db() as con:
        return [dict(r) for r in con.execute(sql, args).fetchall()]


def one(sql: str, args=()) -> dict | None:
    with db() as con:
        r = con.execute(sql, args).fetchone()
        return dict(r) if r else None


def run(sql: str, args=()) -> int:
    with db() as con:
        cur = con.execute(sql, args)
        return cur.lastrowid


def record_usage(provider: str, model: str, task: str, in_tok: int, out_tok: int) -> None:
    run(
        "INSERT INTO usage(ts, month, provider, model, task, in_tok, out_tok) VALUES(?,?,?,?,?,?,?)",
        (now(), month(), provider, model, task, int(in_tok or 0), int(out_tok or 0)),
    )


def openai_tokens_this_month() -> int:
    r = one("SELECT COALESCE(SUM(in_tok+out_tok),0) AS t FROM usage WHERE month=? AND provider='openai'", (month(),))
    return int(r["t"]) if r else 0
