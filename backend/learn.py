"""Flashcards with FSRS spaced repetition."""
from __future__ import annotations

import json
from datetime import datetime, timezone

from fsrs import Card, Rating, Scheduler

from . import db

_sched = Scheduler(enable_fuzzing=True)
RATINGS = {1: Rating.Again, 2: Rating.Hard, 3: Rating.Good, 4: Rating.Easy}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def add(book_id, page, front: str, back: str, context: str, card_type: str = "vocab") -> dict:
    front = front.strip()
    ctype = card_type if card_type in ("vocab", "causal", "cloze", "scenario") else "vocab"
    dup = db.one("SELECT id FROM cards WHERE lower(front)=lower(?) AND COALESCE(book_id,0)=COALESCE(?,0)", (front, book_id))
    if dup:
        return {"id": dup["id"], "duplicate": True}
    c = Card()
    d = c.to_dict()
    cid = db.run(
        "INSERT INTO cards(book_id, page, front, back, context, card_type, fsrs, due, created) VALUES(?,?,?,?,?,?,?,?,?)",
        (book_id, page, front, back.strip(), context.strip(), ctype, json.dumps(d), d["due"], db.now()),
    )
    return {"id": cid, "duplicate": False}


def due(limit: int = 50) -> list[dict]:
    return db.rows(
        "SELECT c.*, b.title AS book_title FROM cards c LEFT JOIN books b ON b.id=c.book_id "
        "WHERE c.due<=? ORDER BY c.due LIMIT ?", (_now(), limit))


def review(card_id: int, rating: int) -> dict:
    row = db.one("SELECT fsrs, reps FROM cards WHERE id=?", (card_id,))
    if not row:
        raise KeyError(card_id)
    card = Card.from_dict(json.loads(row["fsrs"]))
    card, _ = _sched.review_card(card, RATINGS[int(rating)])
    d = card.to_dict()
    db.run("UPDATE cards SET fsrs=?, due=?, reps=? WHERE id=?", (json.dumps(d), d["due"], row["reps"] + 1, card_id))
    return {"due": d["due"]}


def stats() -> dict:
    n = db.one("SELECT COUNT(*) n FROM cards")["n"]
    d = db.one("SELECT COUNT(*) n FROM cards WHERE due<=?", (_now(),))["n"]
    return {"total": n, "due": d}


def all_cards() -> list[dict]:
    return db.rows("SELECT c.id, c.book_id, c.front, c.back, c.context, COALESCE(c.card_type,'vocab') AS card_type, c.due, c.reps, c.page, b.title AS book_title "
                   "FROM cards c LEFT JOIN books b ON b.id=c.book_id ORDER BY c.created DESC")
