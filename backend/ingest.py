"""PDF / EPUB / TXT / MD / Web-Article → clean paragraphs."""
from __future__ import annotations

from html.parser import HTMLParser
import json
import re
import statistics
from collections import Counter
from pathlib import Path

import httpx
import pymupdf as fitz

from . import db

TERMINAL = tuple('.!?:;"”’)»…')
ROMAN_OR_NUM = re.compile(r"^[\divxlcdm\s\-–—.|/]+$", re.I)
LETTER = re.compile(r"[A-Za-zÀ-ÿ؀-ۿ]")


def _norm(t: str) -> str:
    return re.sub(r"\d+", "#", re.sub(r"\s+", " ", t.strip().lower()))


def _join_lines(lines: list[str]) -> str:
    out = ""
    for ln in lines:
        ln = ln.strip()
        if not ln:
            continue
        if not out:
            out = ln
        elif out.endswith("-") and ln[:1].islower():
            out = out[:-1] + ln          # de-hyphenate "exam-\nple"
        else:
            out += " " + ln
    return re.sub(r"\s+", " ", out).strip()


def _blocks(page) -> list[dict]:
    d = page.get_text("dict")
    res = []
    for b in d["blocks"]:
        if b.get("type") != 0:
            continue
        lines, sizes, chars = [], [], 0
        bx0, by0, bx1, by1 = b["bbox"]
        for ln in b["lines"]:
            txt = "".join(s["text"] for s in ln["spans"])
            if not txt.strip():
                continue
            n = len(txt.strip())
            sizes.extend([s["size"] for s in ln["spans"] if s["text"].strip()])
            chars += n
            lines.append({"text": txt, "x1": ln["bbox"][2]})
        if not lines:
            continue
        res.append({
            "bbox": (bx0, by0, bx1, by1),
            "lines": lines,
            "size": statistics.median(sizes) if sizes else 0,
            "chars": chars,
        })
    return res


def _split_paragraphs(block: dict) -> list[str]:
    """A block may hold several paragraphs; split where a line ends early with terminal punctuation."""
    bx0, _, bx1, _ = block["bbox"]
    width = max(bx1 - bx0, 1)
    paras, cur = [], []
    for i, ln in enumerate(block["lines"]):
        cur.append(ln["text"])
        t = ln["text"].rstrip()
        short = (ln["x1"] - bx0) < width * 0.72
        if short and t.endswith(TERMINAL) and i < len(block["lines"]) - 1 and len(block["lines"]) > 2:
            paras.append(_join_lines(cur)); cur = []
    if cur:
        paras.append(_join_lines(cur))
    return [p for p in paras if p]


def ingest(book_id: int, path: str) -> None:
    ext = Path(path).suffix.lower()
    if ext in (".txt", ".md"):
        try:
            text = Path(path).read_text(encoding="utf-8", errors="replace")
            ingest_plain_text(book_id, text)
        except Exception as e:  # noqa: BLE001
            db.run("UPDATE books SET status='error', error=? WHERE id=?", (f"خطا در خواندن فایل متنی: {e}", book_id))
        return
    try:
        doc = fitz.open(path)
    except Exception as e:  # noqa: BLE001
        db.run("UPDATE books SET status='error', error=? WHERE id=?", (f"فایل باز نشد: {e}", book_id))
        return
    try:
        _ingest(book_id, doc)
    except Exception as e:  # noqa: BLE001
        db.run("UPDATE books SET status='error', error=? WHERE id=?", (f"خطا در پردازش فایل: {e}", book_id))
        raise
    finally:
        doc.close()


def ingest_plain_text(book_id: int, text: str, title: str = "", author: str = "") -> None:
    """Split Markdown or plain text (or fetched web article) into clean virtual pages (~2200 chars each)."""
    raw_blocks = [b.strip() for b in re.split(r"\n\s*\n", text.replace("\r\n", "\n")) if b.strip()]
    if not raw_blocks:
        db.run("UPDATE books SET status='error', error=? WHERE id=?", ("متن خالی است.", book_id))
        return
    paragraphs: list[dict] = []
    toc: list = []
    page, page_chars = 1, 0
    for blk in raw_blocks:
        m = re.match(r"^(#{1,3})\s+(.+)$", blk)
        if m:
            lvl = len(m.group(1))
            htxt = m.group(2).strip()
            if page_chars > 600:
                page += 1; page_chars = 0
            toc.append([lvl, htxt, page])
            paragraphs.append({"page": page, "kind": "h", "text": htxt})
            page_chars += len(htxt)
            continue
        clean = re.sub(r"\s+", " ", blk).strip()
        if page_chars + len(clean) > 2200 and page_chars > 400:
            page += 1; page_chars = 0
        kind = "raw" if len(LETTER.findall(clean)) < 2 else "p"
        paragraphs.append({"page": page, "kind": kind, "text": clean})
        page_chars += len(clean)
    with db.db() as con:
        con.executemany(
            "INSERT INTO paragraphs(book_id, page, idx, kind, text) VALUES(?,?,?,?,?)",
            [(book_id, p["page"], i, p["kind"], p["text"]) for i, p in enumerate(paragraphs)],
        )
        con.execute(
            "UPDATE books SET pages=?, toc_json=?, status='ready', error=NULL,"
            " title=CASE WHEN ?<>'' THEN ? ELSE title END, author=CASE WHEN ?<>'' THEN ? ELSE author END WHERE id=?",
            (page, json.dumps(toc, ensure_ascii=False), title.strip(), title.strip(), author.strip(), author.strip(), book_id),
        )


class _ArticleExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self._skip = 0
        self._in_title = False
        self.title = ""
        self.blocks: list[str] = []
        self._cur: list[str] = []
        self._prefix = ""

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in ("script", "style", "nav", "footer", "header", "aside", "noscript", "svg"):
            self._skip += 1
        elif tag == "title":
            self._in_title = True
        elif tag in ("h1", "h2", "h3"):
            self._flush()
            self._prefix = "#" * int(tag[1]) + " "
        elif tag in ("p", "li", "blockquote", "pre"):
            self._flush()
            self._prefix = ""

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in ("script", "style", "nav", "footer", "header", "aside", "noscript", "svg"):
            self._skip = max(0, self._skip - 1)
        elif tag == "title":
            self._in_title = False
        elif tag in ("h1", "h2", "h3", "p", "li", "blockquote", "pre"):
            self._flush()

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif self._skip == 0:
            self._cur.append(data)

    def _flush(self):
        txt = re.sub(r"\s+", " ", "".join(self._cur)).strip()
        if len(txt) >= 12 or (self._prefix and len(txt) >= 3):
            self.blocks.append(self._prefix + txt)
        self._cur, self._prefix = [], ""


def ingest_url(book_id: int, url: str) -> None:
    """Fetch an HTML article or ArXiv abstract/PDF URL and ingest it."""
    try:
        # Support arXiv PDF links directly if user pastes arxiv.org/pdf/...
        r = httpx.get(url, follow_redirects=True, timeout=30, headers={"User-Agent": "VaraghReader/1.0"})
        r.raise_for_status()
        ctype = (r.headers.get("content-type") or "").lower()
        if "application/pdf" in ctype or url.lower().endswith(".pdf"):
            from .config import BOOKS_DIR
            dest = BOOKS_DIR / f"{book_id}.pdf"
            dest.write_bytes(r.content)
            ingest(book_id, str(dest))
            return
        parser = _ArticleExtractor()
        parser.feed(r.text)
        parser._flush()
        body = "\n\n".join(parser.blocks)
        if len(body) < 150:
            db.run("UPDATE books SET status='error', error=? WHERE id=?", ("متن کافی از این لینک استخراج نشد.", book_id))
            return
        title = re.sub(r"\s+", " ", parser.title).strip()[:160]
        ingest_plain_text(book_id, body, title=title, author=url.split("/")[2] if "://" in url else "")
    except Exception as e:  # noqa: BLE001
        db.run("UPDATE books SET status='error', error=? WHERE id=?", (f"خطا در دریافت لینک: {e}", book_id))


def _ingest(book_id: int, doc) -> None:
    n = doc.page_count
    pages = []
    margin_counter: Counter = Counter()
    all_sizes: list[float] = []
    for pno in range(n):
        page = doc[pno]
        h = page.rect.height
        blocks = _blocks(page)
        for b in blocks:
            y0, y1 = b["bbox"][1], b["bbox"][3]
            b["margin"] = y1 < h * 0.09 or y0 > h * 0.91
            if b["margin"]:
                margin_counter[_norm(" ".join(l["text"] for l in b["lines"]))] += 1
            all_sizes.extend([b["size"]] * max(1, b["chars"] // 40))
        pages.append(blocks)

    body_size = statistics.median(all_sizes) if all_sizes else 10
    repeat_min = max(3, int(n * 0.2))

    total_chars = 0
    paragraphs: list[dict] = []  # {page, kind, text}
    for pno, blocks in enumerate(pages, start=1):
        page_paras = []
        for b in blocks:
            raw = " ".join(l["text"] for l in b["lines"]).strip()
            if b["margin"]:
                if margin_counter[_norm(raw)] >= repeat_min:
                    continue
                if len(raw) <= 10 and ROMAN_OR_NUM.match(raw):
                    continue
            is_heading = b["size"] >= body_size * 1.15 and len(raw) < 160
            for text in ([_join_lines([l["text"] for l in b["lines"]])] if is_heading else _split_paragraphs(b)):
                if len(LETTER.findall(text)) < 2:
                    kind = "raw"
                elif is_heading:
                    kind = "h"
                else:
                    kind = "p"
                page_paras.append({"page": pno, "kind": kind, "text": text})
                total_chars += len(text)

        # stitch a paragraph broken across the page boundary
        if paragraphs and page_paras:
            prev, first = paragraphs[-1], page_paras[0]
            if (prev["kind"] == "p" and first["kind"] == "p"
                    and not prev["text"].rstrip().endswith(TERMINAL)
                    and (first["text"][:1].islower() or prev["text"].endswith("-"))):
                if prev["text"].endswith("-") and first["text"][:1].islower():
                    prev["text"] = prev["text"][:-1] + first["text"]
                else:
                    prev["text"] += " " + first["text"]
                page_paras.pop(0)
        paragraphs.extend(page_paras)

    if total_chars < 200:
        db.run("UPDATE books SET status='error', error=? WHERE id=?",
               ("این PDF متن قابل استخراج ندارد (احتمالاً اسکن‌شده است). ورق فقط PDF متنی را پشتیبانی می‌کند.", book_id))
        return

    toc = [[lvl, title, pg] for lvl, title, pg in doc.get_toc(simple=True) if pg >= 1]
    meta = doc.metadata or {}
    with db.db() as con:
        con.executemany(
            "INSERT INTO paragraphs(book_id, page, idx, kind, text) VALUES(?,?,?,?,?)",
            [(book_id, p["page"], i, p["kind"], p["text"]) for i, p in enumerate(paragraphs)],
        )
        title = (meta.get("title") or "").strip()
        con.execute(
            "UPDATE books SET pages=?, toc_json=?, status='ready', error=NULL,"
            " title=CASE WHEN ?<>'' THEN ? ELSE title END, author=? WHERE id=?",
            (n, json.dumps(toc, ensure_ascii=False), title, title, (meta.get("author") or "").strip(), book_id),
        )
