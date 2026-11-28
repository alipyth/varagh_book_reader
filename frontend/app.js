/* ورق — frontend (vanilla JS, no build step) */
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const view = $("#view");
const fa = n => (n ?? 0).toLocaleString(LOCALE);   // locale-aware number (Persian digits only in the Persian UI)
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LS = {
  get(k, d) { try { const v = localStorage.getItem("varagh." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("varagh." + k, JSON.stringify(v)); } catch {} },
};
const ERR = "\u0000ERR:";
const HEAT_LABEL = tr("🔥 چگالی", "🔥 Density");

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  toc: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h10M4 18h13"/></svg>',
  panel: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>',
  theme: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"/></svg>',
  back: IS_FA ? '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  prev: IS_FA ? '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  next: IS_FA ? '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M12 16V4M6 10l6-6 6 6M4 20h16"/></svg>',
  graph: '<svg viewBox="0 0 24 24"><circle cx="6" cy="7" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8.3 8.2l2.6 7.5M15.6 7l-2.7 8.8M8.5 6.8l7-.6"/></svg>',
  mind: '<svg viewBox="0 0 24 24"><rect x="15" y="9.5" width="6" height="5" rx="1.5"/><rect x="3" y="3" width="6" height="4" rx="1.5"/><rect x="3" y="10" width="6" height="4" rx="1.5"/><rect x="3" y="17" width="6" height="4" rx="1.5"/><path d="M15 12h-2.5M12.5 5v14M12.5 5H9M12.5 12H9M12.5 19H9"/></svg>',
  image: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  wow: '<svg viewBox="0 0 24 24"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>',
  unclear: '<svg viewBox="0 0 24 24"><path d="M9.2 9a3 3 0 1 1 4.3 2.7c-.9.5-1.5 1.2-1.5 2.3v.5"/><circle cx="12" cy="18" r=".6" fill="currentColor"/></svg>',
  love: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7M5 10v10h14V10"/><path d="M10 20v-5h4v5"/></svg>',
  walk: '<svg viewBox="0 0 24 24"><circle cx="13" cy="4.5" r="1.8"/><path d="M10 21l2-6 3 3v4M8 12l2-4 4 1 2 3M12 15l-1-4"/></svg>',
  post: '<svg viewBox="0 0 24 24"><path d="M21 4L3 11l6 2 2 6 3-4 5 4z"/><path d="M9 13l12-9"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M9 11l3 3 8-8"/><path d="M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9"/></svg>',
  fit: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
};

async function api(path, opts = {}) {
  const o = { ...opts, headers: { ...(opts.headers || {}) } };
  if (o.body && !(o.body instanceof FormData)) { o.headers["Content-Type"] = "application/json"; o.body = JSON.stringify(o.body); }
  const r = await fetch(path, o);
  let data = null;
  try { data = await r.json(); } catch {}
  if (!r.ok) throw new Error((data && (typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail))) || tr(`خطای ${r.status}`, `Error ${r.status}`));
  return data;
}

/* POST that streams plain text back; calls onDelta(fullTextSoFar). */
async function streamPost(url, signal, onDelta) {
  const r = await fetch(url, { method: "POST", signal });
  if (!r.ok) {
    let d = null; try { d = await r.json(); } catch {}
    throw new Error((d && d.detail) || tr(`خطای ${r.status}`, `Error ${r.status}`));
  }
  const meta = { provider: r.headers.get("X-Provider"), model: decodeURIComponent(r.headers.get("X-Model") || ""),
                 cached: r.headers.get("X-Cached") === "1", note: decodeURIComponent(r.headers.get("X-Note") || "") };
  const reader = r.body.getReader(), dec = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
    const i = text.indexOf(ERR);
    if (i !== -1) { onDelta(text.slice(0, i)); throw new Error(text.slice(i + ERR.length)); }
    onDelta(text);
  }
  return { text: text.trim(), meta };
}

let toastTimer;
function toast(msg, bad = false) {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast" + (bad ? " bad" : ""); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), bad ? 6000 : 2400);
}
const shortModel = m => (m || "").length > 24 ? m.slice(0, 22) + "…" : (m || "");
function providerPill(provider, model) {
  if (!provider || provider === "none") return "";
  const label = provider === "ollama" ? "Ollama" : provider === "cli2api" ? "CLI2API" : "OpenAI";
  return `<span class="pill ${provider}" title="${esc(model)}">${label} · ${esc(shortModel(model))}</span>`;
}

/* ---------------------------------------------------------------- router */
let cleanup = [];
const onLeave = fn => cleanup.push(fn);
async function route() {
  cleanup.forEach(f => { try { f(); } catch {} }); cleanup = [];
  hidePopover();
  const h = location.hash.replace(/^#\/?/, "");
  const [name, ...rest] = h.split("/");
  const navName = name === "read" || !name ? "library" : name;
  $$(".rail a[data-nav]").forEach(a => a.classList.toggle("on", a.dataset.nav === navName));
  view.scrollTop = 0;
  try {
    if (name === "read") await Reader(+rest[0], +rest[1] || 0);
    else if (name === "cards") await Cards();
    else if (name === "settings") await Settings();
    else if (name === "compare") await Compare();
    else if (name === "evening") await Evening();
    else if (name === "search") await Search();
    else if (name === "stats") await Stats();
    else await Library();
  } catch (e) {
    view.innerHTML = `<div class="pagewrap-main"><div class="error-box">${esc(e.message)}</div><a class="btn" href="#/">${tr(`بازگشت به کتابخانه`, `Back to library`)}</a></div>`;
  }
  refreshDue();
}
window.addEventListener("hashchange", route);

async function refreshDue() {
  try {
    const { stats } = await api("/api/cards/due");
    const b = $("#due-badge"); b.hidden = !stats.due; b.textContent = fa(stats.due);
  } catch {}
}

/* ---------------------------------------------------------------- library */
async function Library() {
  const [books, { settings }] = await Promise.all([api("/api/books"), api("/api/settings")]);
  const needModel = !settings.tasks.translate_para.model;
  view.innerHTML = `<div class="pagewrap-main">
    <div class="head"><div><h1>${tr("کتابخانه", "Library")}</h1><p>${tr(`فایل PDF، EPUB، TXT/MD رها کن یا لینک مقاله اضافه کن. هیچ چیزی تا وقتی خودت نخواهی ترجمه نمی‌شود.`, `Drop a PDF, EPUB or TXT/MD file, or add an article link. Nothing is translated until you ask.`)}</p></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="add-url">${tr(`+ مقاله / متن`, `+ Article / text`)}</button>
      <label class="btn primary" for="file">${ICON.upload} ${tr("افزودن کتاب", "Add book")}</label><input type="file" id="file" accept=".pdf,.epub,.txt,.md,application/pdf,application/epub+zip,text/plain,text/markdown" hidden multiple></div></div>
    ${needModel ? `<div class="banner"><span>${tr(`هنوز مدلی برای ترجمه انتخاب نکرده‌ای. بدون آن، کلیک روی پاراگراف کاری نمی‌کند.`, `You haven't picked a translation model yet. Without one, clicking a paragraph does nothing.`)}</span><a class="btn sm" href="#/settings">${tr(`انتخاب مدل`, `Choose model`)}</a></div>` : ""}
    <div id="upmsg" class="small muted" hidden></div>
    <div id="shelf"></div></div>
    <div class="dropzone" id="dz" hidden>${tr(`PDF / EPUB / TXT را رها کن`, `Drop a PDF / EPUB / TXT`)}</div>`;

  const shelf = $("#shelf");
  if (!books.length) {
    shelf.innerHTML = `<div class="empty">
      <div><h2 style="margin-bottom:14px">${tr(`اولین کتابت را اضافه کن`, `Add your first book`)}</h2><ol>
        <li>${tr(`در <a href="#/settings">تنظیمات</a> آدرس Ollama و کلید OpenAI را بده و برای هر کار مدل انتخاب کن.`, `In <a href="#/settings">Settings</a>, enter your Ollama address and OpenAI key, and pick a model for each task.`)}</li>
        <li>${tr(`یک PDF متنی را اینجا بکش یا دکمه‌ی «افزودن کتاب» را بزن.`, `Drag a text PDF here, or press “Add book”.`)}</li>
        <li>${tr(`کتاب را باز کن؛ روی هر پاراگراف کلیک کنی ترجمه می‌شود، یا کل صفحه را یکجا ترجمه کن.`, `Open the book; click any paragraph to translate it, or translate the whole page at once.`)}</li></ol></div>
      <div class="demo" aria-label="${tr("نمونه", "Example")}"><div dir="rtl" lang="fa">وقتی صفحه‌های پیش رو را نوشتم، تنها در جنگل زندگی می‌کردم، یک مایل دور از هر همسایه‌ای.</div>
        <div class="en" dir="ltr">When I wrote the following pages, I lived alone, in the woods, a mile from any neighbor.</div></div></div>`;
  } else {
    const last = books.find(b => b.opened && b.status === "ready");
    if (last) {
      const pct = Math.round((last.last_page / last.pages) * 100);
      shelf.insertAdjacentHTML("beforebegin", `<div class="hero">
        <a class="cover" href="#/read/${last.id}/${last.last_page}" aria-label="${tr(`ادامه‌ی ${esc(last.title)}`, `Continue ${esc(last.title)}`)}"><img src="/api/books/${last.id}/cover" alt=""></a>
        <div class="info"><span class="eyebrow">${tr(`ادامه‌ی خواندن`, `Continue reading`)}</span><h2 dir="auto">${esc(last.title)}</h2>${last.author ? `<div class="muted small" dir="ltr" style="text-align:start">${esc(last.author)}</div>` : ""}
          <div class="progress"><i style="width:${pct}%"></i></div>
          <div class="kv"><span>${tr(`صفحه‌ی ${fa(last.last_page)} از ${fa(last.pages)}`, `Page ${fa(last.last_page)} of ${fa(last.pages)}`)}</span><span>${fa(pct)}${PCT}</span></div>
          <div><a class="btn go" href="#/read/${last.id}/${last.last_page}">${ICON.play} ${tr(`ادامه از صفحه‌ی ${fa(last.last_page)}`, `Continue from page ${fa(last.last_page)}`)}</a></div></div></div>
        <div class="sect">${tr(`همه‌ی کتاب‌ها · ${fa(books.length)}`, `All books · ${fa(books.length)}`)}</div>`);
    }
    shelf.className = "shelf";
    shelf.innerHTML = books.map(b => {
      const pct = b.pages ? Math.round((b.last_page / b.pages) * 100) : 0;
      const ready = b.status === "ready";
      const state = b.status === "ingesting" ? `<div class="state">${tr(`در حال آماده‌سازی…`, `Preparing…`)}</div>` : b.status === "error" ? `<div class="state">${esc(b.error)}</div>` : "";
      return `<div class="book">
        ${ready ? `<a class="cover" href="#/read/${b.id}/${b.last_page}" aria-label="${tr(`باز کردن ${esc(b.title)}`, `Open ${esc(b.title)}`)}"><img src="/api/books/${b.id}/cover" alt="" loading="lazy"></a>`
          : `<div class="cover">${state}</div>`}
        <div><h2 title="${esc(b.title)}">${esc(b.title)}</h2>${b.author ? `<div class="by">${esc(b.author)}</div>` : ""}</div>
        ${ready ? `<div class="progress"><i style="width:${pct}%"></i></div>` : ""}
        <div class="meta"><span>${ready ? `${tr(`ص ${fa(b.last_page)} از ${fa(b.pages)} · ${fa(b.translated_pct)}٪ ترجمه`, `p. ${fa(b.last_page)} of ${fa(b.pages)} · ${fa(b.translated_pct)}% translated`)}` : ""}</span>
          <button class="btn ghost sm danger" data-del="${b.id}">${tr("حذف", "Delete")}</button></div></div>`;
    }).join("");
  }

  $$("[data-del]").forEach(btn => btn.addEventListener("click", async () => {
    if (btn.dataset.sure !== "1") { btn.dataset.sure = "1"; btn.textContent = tr("مطمئنی؟", "Sure?"); setTimeout(() => { btn.dataset.sure = ""; btn.textContent = tr("حذف", "Delete"); }, 3000); return; }
    await api(`/api/books/${btn.dataset.del}`, { method: "DELETE" }); toast(tr("کتاب حذف شد", "Book deleted")); route();
  }));

  const upload = async files => {
    const msg = $("#upmsg");
    for (const f of files) {
      if (!/\.(pdf|epub|txt|md)$/i.test(f.name)) { toast(tr("فرمت مجاز: PDF، EPUB، TXT یا MD", "Allowed formats: PDF, EPUB, TXT or MD"), true); continue; }
      msg.hidden = false; msg.textContent = tr(`در حال بارگذاری ${f.name}…`, `Uploading ${f.name}…`);
      const fd = new FormData(); fd.append("file", f);
      try { await api("/api/books", { method: "POST", body: fd }); } catch (e) { toast(e.message, true); }
    }
    route();
  };
  $("#add-url").onclick = () => Deep.openAddModal(route);
  $("#file").addEventListener("change", e => upload([...e.target.files]));
  const dz = $("#dz");
  const over = e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); dz.hidden = false; } };
  const leave = e => { if (e.type === "drop" || !e.relatedTarget) { dz.hidden = true; } };
  const drop = e => { e.preventDefault(); dz.hidden = true; if (e.dataTransfer.files.length) upload([...e.dataTransfer.files]); };
  window.addEventListener("dragover", over); window.addEventListener("dragleave", leave); window.addEventListener("drop", drop);
  onLeave(() => { window.removeEventListener("dragover", over); window.removeEventListener("dragleave", leave); window.removeEventListener("drop", drop); });

  if (books.some(b => b.status === "ingesting")) {
    const t = setTimeout(() => { if (!location.hash.replace(/^#\/?/, "")) route(); }, 1500);
    onLeave(() => clearTimeout(t));
  }
}

/* ---------------------------------------------------------------- reader */
async function Reader(bookId, pageArg) {
  const [book, { settings }] = await Promise.all([api(`/api/books/${bookId}`), api("/api/settings")]);
  if (book.status !== "ready") throw new Error(book.error || tr("کتاب هنوز آماده نیست", "The book isn't ready yet"));
  const S = {
    page: Math.min(pageArg || book.last_page || 1, book.pages),
    mode: LS.get("mode", "para"), layout: LS.get("layout", "side"), rt: LS.get("rt", "auto"),
    fs: LS.get("fs", 1.1), drawer: LS.get("drawer", innerWidth > 1200), tools: LS.get("tools", innerWidth > 1650),
    tab: "tutor", hl: null, overlay: null, heatOn: false, onlyCore: false, focusPara: null,
  };
  const DEXP = {}; // pid -> { open: bool, active: 'eli5'|'technical'|'compare'|'analogy', live: string }
  let data = null, alive = true;
  const Q = { list: [], cur: null };           // client-side translation queue (one request at a time)
  let pageCtrl = null;                         // page-mode stream
  const task = settings.tasks;

  api("/api/warmup", { method: "POST" }).catch(() => {});

  view.innerHTML = `<div class="reader" id="reader">
    <header class="rtop">
      <a class="btn icon ghost" href="#/" title="${tr("کتابخانه", "Library")}" aria-label="${tr("کتابخانه", "Library")}">${ICON.back}</a>
      <button class="btn icon ghost" id="tDrawer" title="${tr("فهرست مطالب", "Contents")}" aria-label="${tr("فهرست مطالب", "Contents")}">${ICON.toc}</button>
      <div class="title"><b dir="auto" title="${esc(book.title)}">${esc(book.title)}</b><span>${esc(book.author || "")}</span></div>
      <div class="seg" id="mode" role="group" aria-label="${tr("نوع ترجمه", "Translation mode")}"><button data-v="para">${tr("پاراگرافی", "Paragraph")}</button><button data-v="page">${tr("صفحه‌ای", "Page")}</button></div>
      <div class="seg" id="layout" role="group" aria-label="${tr("چیدمان", "Layout")}"><button data-v="side">${tr("کنار هم", "Side by side")}</button><button data-v="stack">${tr("زیر هم", "Stacked")}</button><button data-v="fa">${tr("فقط فارسی", "Persian only")}</button></div>
      <span class="grow"></span>
      <div class="studybtns" role="group" aria-label="${tr("ابزارهای مطالعه‌ی عمیق", "Deep study tools")}">
        <button class="btn sm primary" id="oDeep" title="${tr("پیش‌خوانی X-Ray، آزمون فاینمن، نقد کتاب، گراف مفاهیم، نقشه‌ی ذهنی و سؤال‌ها", "Chapter X-ray, Feynman test, critique, concept graph, mind map and questions")}">${tr("🧠 مطالعه‌ی عمیق", "🧠 Deep study")}</button>
        <button class="btn sm ghost" id="tHeat" title="${tr("رنگ‌بندی پاراگراف‌ها بر اساس چگالی اطلاعات (محوری / مثال / تکرار)", "Color paragraphs by information density (core / example / filler)")}">${HEAT_LABEL}</button>
        <button class="btn sm ghost" id="tCore" hidden title="${tr("فقط پاراگراف‌های محوری را نشان بده", "Show only core paragraphs")}">${tr("فقط محوری", "Core only")}</button>
      </div>
      <button class="btn go" id="bigBtn"></button>
      <button class="btn icon ghost" id="smaller" title="${tr("متن کوچک‌تر", "Smaller text")}" aria-label="${tr("متن کوچک‌تر", "Smaller text")}">A−</button>
      <button class="btn icon ghost" id="bigger" title="${tr("متن بزرگ‌تر", "Larger text")}" aria-label="${tr("متن بزرگ‌تر", "Larger text")}">A+</button>
      <button class="btn icon ghost" id="theme" title="${tr("پوسته‌ی خواندن", "Reading theme")}" aria-label="${tr("پوسته‌ی خواندن", "Reading theme")}">${ICON.theme}</button>
      <button class="btn sm" id="tTools" title="${tr("باز و بسته کردن پنل دستیار و ابزارهای صفحه", "Toggle the assistant and page tools panel")}">${tr("💬 دستیار", "💬 Assistant")}</button>
    </header>
    <aside class="drawer" id="drawer"><div class="drawer-head"><b>${tr("فهرست مطالب", "Contents")}</b><button class="btn icon ghost" id="closeDrawer" aria-label="${tr("بستن فهرست", "Close contents")}">${ICON.close}</button></div><div class="toc" id="toc"></div></aside>
    <section class="canvas" id="canvas"></section>
    <section class="overlay" id="overlay" hidden></section>
    <div class="welcome" id="welcome" hidden></div>
    <aside class="tools" id="tools">
      <div class="tools-resizer" id="toolsResizer" title="${tr("بکش برای تغییر عرض پنل", "Drag to resize the panel")}"></div>
      <div class="tools-head"><b>${tr("ابزارهای این صفحه", "Page tools")}</b>
        <div style="display:flex;gap:4px;align-items:center">
          <button class="btn sm ghost" id="expandTools" title="${tr("بزرگ / کوچک کردن عرض پنل", "Widen / narrow the panel")}">${tr("⤢ بزرگ", "⤢ Wider")}</button>
          <button class="btn sm ghost" id="closeTools" aria-label="${tr("بستن پنل", "Close panel")}">${tr("× بستن", "× Close")}</button>
        </div>
      </div>
      <div class="tabs" role="tablist">
        <button data-tab="tutor">${tr(`💬 گفت‌وگو با صفحه`, `💬 Chat with page`)}</button>
        <button data-tab="brain">${tr(`🔗 بین‌کتابی و Obsidian`, `🔗 Cross-book & Obsidian`)}</button>
        <button data-tab="gloss">${tr(`📖 واژه‌نامه`, `📖 Glossary`)}</button>
        <button data-tab="review">${tr(`📊 مرور و مصرف`, `📊 Review & usage`)}</button>
      </div>
      <div class="tabpane" id="tabpane"></div>
    </aside>
    <footer class="rbottom">
      <button class="btn icon ghost" id="prev" title="${tr("صفحه‌ی قبل (کلید →)", "Previous page (← key)")}" aria-label="${tr("صفحه‌ی قبل", "Previous page")}">${ICON.prev}</button>
      <input type="range" id="scrub" min="1" max="${book.pages}" aria-label="${tr("صفحه", "Page")}">
      <button class="btn icon ghost" id="next" title="${tr("صفحه‌ی بعد (کلید ←)", "Next page (→ key)")}" aria-label="${tr("صفحه‌ی بعد", "Next page")}">${ICON.next}</button>
      <span class="pg">${tr("صفحه", "Page")} <input type="number" id="pin" min="1" max="${book.pages}" aria-label="${tr("شماره‌ی صفحه", "Page number")}"> ${tr("از", "of")} ${fa(book.pages)}</span>
      <span id="hlchip"></span>
      <span class="stat" id="stat"></span>
      <span id="who"></span>
    </footer></div>`;

  const R = $("#reader"), canvas = $("#canvas");

  function applyChrome() {
    R.dataset.rt = S.rt === "auto" ? "" : S.rt;
    R.style.setProperty("--fs", S.fs + "rem");
    $$("#mode button").forEach(b => b.classList.toggle("on", b.dataset.v === S.mode));
    $$("#layout button").forEach(b => b.classList.toggle("on", b.dataset.v === S.layout));
    $("#layout").hidden = S.mode !== "para";
    $("#drawer").hidden = !S.drawer; $("#tools").hidden = !S.tools;
    $$(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === S.tab));
  }
  applyChrome();

  $$("#mode button").forEach(b => b.onclick = () => { stopQueue(); S.mode = b.dataset.v; LS.set("mode", S.mode); applyChrome(); render(); });
  $$("#layout button").forEach(b => b.onclick = () => { S.layout = b.dataset.v; LS.set("layout", S.layout); applyChrome(); render(); });
  $("#smaller").onclick = () => { S.fs = Math.max(.9, +(S.fs - .06).toFixed(2)); LS.set("fs", S.fs); applyChrome(); };
  $("#bigger").onclick = () => { S.fs = Math.min(1.7, +(S.fs + .06).toFixed(2)); LS.set("fs", S.fs); applyChrome(); };
  const themes = ["auto", "day", "sepia", "night"], themeNames = { auto: tr("مثل سیستم", "System"), day: tr("روز", "Day"), sepia: tr("کاغذی", "Sepia"), night: tr("شب", "Night") };
  $("#theme").onclick = () => { S.rt = themes[(themes.indexOf(S.rt) + 1) % themes.length]; LS.set("rt", S.rt); applyChrome(); toast(tr("پوسته: ", "Theme: ") + themeNames[S.rt]); };
  $("#tDrawer").onclick = () => { S.drawer = !S.drawer; LS.set("drawer", S.drawer); applyChrome(); };
  $("#closeDrawer").onclick = () => { S.drawer = false; LS.set("drawer", false); applyChrome(); };
  $("#tTools").onclick = () => { S.tools = !S.tools; LS.set("tools", S.tools); applyChrome(); if (S.tools) renderTab(); };
  $("#closeTools").onclick = () => { S.tools = false; LS.set("tools", false); applyChrome(); };
  /* Resizable & expandable tools sidebar */
  const toolsEl = $("#tools");
  let toolsW = LS.get("toolsW", 420);
  const applyToolsW = w => {
    toolsW = Math.max(320, Math.min(Math.round(innerWidth * 0.82), w));
    toolsEl.style.width = toolsW + "px";
    $("#expandTools").textContent = toolsW >= 620 ? tr("⤡ معمولی", "⤡ Normal") : tr("⤢ بزرگ", "⤢ Wider");
  };
  applyToolsW(toolsW);
  $("#expandTools").onclick = () => { applyToolsW(toolsW >= 620 ? 420 : Math.min(760, Math.round(innerWidth * 0.58))); LS.set("toolsW", toolsW); };
  $("#toolsResizer").onpointerdown = e => {
    e.preventDefault();
    const startX = e.clientX, startW = toolsEl.getBoundingClientRect().width;
    $("#toolsResizer").classList.add("dragging");
    const move = ev => {
      // In RTL, tools sidebar is on the left edge, so dragging right increases width
      const delta = document.dir === "rtl" || getComputedStyle(document.documentElement).direction === "rtl" ? (ev.clientX - startX) : (startX - ev.clientX);
      applyToolsW(startW + delta);
    };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      $("#toolsResizer").classList.remove("dragging");
      LS.set("toolsW", toolsW);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  $$(".tabs button").forEach(b => b.onclick = () => { S.tab = b.dataset.tab; applyChrome(); renderTab(); });
  $("#oDeep").onclick = () => openOverlay("deep");
  $("#tHeat").onclick = async () => {
    if (!data) return;
    if (S.heatOn) { S.heatOn = false; S.onlyCore = false; $("#tHeat").classList.remove("primary"); $("#tCore").hidden = true; render(); return; }
    if (!data.heatmap) {
      $("#tHeat").disabled = true; $("#tHeat").textContent = tr("🔥 در حال تحلیل…", "🔥 Analyzing…");
      try {
        const r = await api(`/api/books/${bookId}/pages/${S.page}/heatmap`, { method: "POST" });
        data.heatmap = r.heatmap?.items || {};
        refreshUsage();
      } catch (e) { toast(e.message, true); $("#tHeat").disabled = false; $("#tHeat").textContent = HEAT_LABEL; return; }
      $("#tHeat").disabled = false; $("#tHeat").textContent = HEAT_LABEL;
    }
    S.heatOn = true; $("#tHeat").classList.add("primary"); $("#tCore").hidden = false; render();
  };
  $("#tCore").onclick = () => { S.onlyCore = !S.onlyCore; $("#tCore").classList.toggle("primary", S.onlyCore); render(); };
  $("#prev").onclick = () => go(S.page - 1);
  $("#next").onclick = () => go(S.page + 1);
  $("#pin").onchange = e => go(+e.target.value);
  $("#scrub").oninput = e => { $("#pin").value = e.target.value; };
  $("#scrub").onchange = e => go(+e.target.value);

  const keys = e => {
    if (e.key === "Escape") {
      if (S.overlay) { closeOverlay(); return; }
      if (S.tools && innerWidth <= 1100) { S.tools = false; applyChrome(); return; }
    }
    if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
    // Arrow keys follow reading direction: in RTL, ← is the next page.
    if (e.key === "ArrowLeft") go(IS_FA ? S.page + 1 : S.page - 1);
    else if (e.key === "ArrowRight") go(IS_FA ? S.page - 1 : S.page + 1);
  };
  document.addEventListener("keydown", keys);
  onLeave(() => { alive = false; stopAll(); document.removeEventListener("keydown", keys); });

  function go(p) {
    p = Math.max(1, Math.min(book.pages, p || 1));
    if (p === S.page && data) return;
    stopAll();
    S.page = p;
    history.replaceState(null, "", `#/read/${bookId}/${p}`);
    load();
  }

  /* --- contents */
  const toc = book.toc || [];
  function renderToc() {
    let cur = -1; toc.forEach((t, i) => { if (t[2] <= S.page) cur = i; });
    $("#toc").innerHTML = toc.length ? toc.map((t, i) =>
      `<a href="#" data-p="${t[2]}" class="l${t[0]} ${i === cur ? "cur" : ""}" style="padding-inline-start:${Math.min(4, Math.max(0, t[0] - 1)) * 12 + 10}px"><b dir="auto">${esc(t[1])}</b><span>${fa(t[2])}</span></a>`).join("")
      : `<p class="small muted">${tr(`این کتاب فهرست مطالب ندارد.`, `This book has no table of contents.`)}</p>`;
    $$("#toc a").forEach(a => a.onclick = e => { e.preventDefault(); go(+a.dataset.p); if (innerWidth < 900) { S.drawer = false; applyChrome(); } });
  }

  async function load() {
    $("#pin").value = S.page; $("#scrub").value = S.page;
    renderToc();
    api(`/api/books/${bookId}/progress`, { method: "PUT", body: { page: S.page } }).catch(() => {});
    const want = S.page;
    try { const d = await api(`/api/books/${bookId}/pages/${S.page}`); if (!alive || want !== S.page) return; data = d; }
    catch (e) { canvas.innerHTML = `<div class="sheet"><div class="error-box">${esc(e.message)}</div></div>`; return; }
    canvas.scrollTop = 0;
    render();
    renderChip();
    if (S.tools && ["tutor", "brain", "image"].includes(S.tab)) renderTab();
    if (S.overlay === "mind") Mind.refresh();
    if (S.overlay === "graph") Graph.refresh();
  }

  /* --- top-bar state */
  function whoFor(t) { const x = task[t]; return x && x.model ? `<a href="#/settings" style="text-decoration:none" title="${tr("تغییر مدل در تنظیمات", "Change the model in Settings")}">${providerPill(x.provider, x.model)}</a>` : `<a class="pill err" href="#/settings">${tr(`مدل انتخاب نشده`, `No model selected`)}</a>`; }
  function updateBar() {
    const big = $("#bigBtn");
    if (!data) return;
    if (S.mode === "para") {
      const left = data.paragraphs.filter(p => !p.base && p.kind !== "raw").length;
      const busy = Q.cur || Q.list.length || pageCtrl;
      $("#who").innerHTML = whoFor("translate_para");
      big.hidden = !busy && !left;
      big.innerHTML = busy ? `${ICON.stop} ${tr("توقف", "Stop")}` : `${ICON.play} ${tr("ترجمه‌ی همه‌ی پاراگراف‌ها", "Translate all paragraphs")} <span class="small">(${fa(left)})</span>`;
      big.onclick = busy ? stopAll : translateAll;
      const done = data.paragraphs.filter(p => p.base || p.kind === "raw").length;
      $("#stat").textContent = data.paragraphs.length ? tr(`${fa(done)} از ${fa(data.paragraphs.length)} پاراگراف این صفحه ترجمه شده`, `${fa(done)} of ${fa(data.paragraphs.length)} paragraphs on this page translated`) : "";
    } else {
      $("#who").innerHTML = whoFor("translate_page");
      big.hidden = !pageCtrl;
      big.innerHTML = `${ICON.stop} ${tr("توقف", "Stop")}`; big.onclick = stopAll;
      $("#stat").textContent = data.page_translation ? tr("این صفحه ترجمه شده", "This page is translated") : "";
    }
  }

  function render() {
    if (!data) return;
    canvas.classList.toggle("is-split", S.mode === "page");
    if (S.mode === "page") renderPage(); else renderParas();
    updateBar();
  }

  /* --- paragraph mode */
  const live = {};  // pid -> {state:'queued'|'live'|'error', text, error}
  const HM_FA = { core: tr("🟡 محوری", "🟡 Core"), example: tr("🔵 مثال", "🔵 Example"), fluff: tr("⚪ تکرار/حاشیه", "⚪ Repetition / aside") };
  const DE_LVLS = [["eli5", tr("شهودی", "Intuitive")], ["technical", tr("فنی", "Technical")], ["compare", tr("مقایسه", "Compare")], ["analogy", tr("قیاس با حوزه‌ی من", "Analogy to my field")]];
  function deepExpHtml(p) {
    const st = DEXP[p.id];
    const hasAny = p.deep_explains && Object.keys(p.deep_explains).length;
    if (st?.closed) return "";
    if (!st?.open && !hasAny) return "";
    const active = st?.active || Object.keys(p.deep_explains || {})[0] || "eli5";
    const text = st?.live != null ? st.live : (p.deep_explains?.[active] || "");
    return `<div class="dexp-bar">${DE_LVLS.map(([k, l]) => `<button class="btn sm ${active === k ? "primary" : "ghost"}" data-dexp="${k}">${l}</button>`).join("")}
      <button class="btn sm ghost" data-dexp-close title="${tr("بستن توضیح", "Close explanation")}">×</button></div>
      ${text || st?.live != null ? `<div class="dexp-box">${renderMd(text)}${st?.live != null ? '<span class="caret"></span>' : ""}</div>` : ""}`;
  }
  function rowInner(p) {
    const L = live[p.id] || {};
    const shown = p.better || p.base;
    const hm = S.heatOn && data?.heatmap ? data.heatmap[String(p.id)] : null;
    const hmHtml = hm ? `<div class="hm-badge ${hm.tier}" title="${esc(hm.why)}">${HM_FA[hm.tier] || hm.tier}${hm.why ? ` · ${esc(hm.why)}` : ""}</div>` : "";
    let faHtml;
    if (p.kind === "raw") faHtml = `<span dir="ltr">${esc(p.text)}</span>`;
    else if (L.state === "live") faHtml = esc(L.text) + '<span class="caret"></span>';
    else if (L.state === "streamed") faHtml = esc(L.text);
    else if (L.state === "queued") faHtml = `<span class="todo">${tr(`در صف ترجمه…`, `Queued for translation…`)}</span>`;
    else if (L.state === "error") faHtml = `<div class="err">${esc(L.error)}</div><div class="acts" style="opacity:1"><button class="btn sm" data-a="retry">${tr("تلاش دوباره", "Retry")}</button><a class="btn sm ghost" href="#/settings">${tr("تنظیمات", "Settings")}</a></div>`;
    else if (shown) faHtml = `${hlFa(entFa(esc(shown.text)))}<div class="acts">
        ${providerPill((p.better || p.base).provider, (p.better || p.base).model)}
        ${p.better ? `<span class="tag">${tr("نسخه‌ی بهتر", "Better version")}</span><button class="btn sm ghost" data-a="base">${tr("نسخه‌ی اولیه", "Original version")}</button>`
                   : `<button class="btn sm ghost" data-a="better" title="${esc(task.better.provider + " · " + task.better.model)}">${tr(`✦ بهتر`, `✦ Better`)}</button>`}
        <button class="btn sm ghost" data-a="deep">${tr("توضیح ۴ سطحی", "4-level explain")}</button>
        <button class="btn sm ghost" data-a="cards">${tr("کارت مفهومی", "Concept cards")}</button>
        <button class="btn sm ghost" data-a="ask">${tr("💬 استاد", "💬 Tutor")}</button>
        <button class="btn sm ghost" data-a="redo">${tr("دوباره", "Redo")}</button>
        <button class="btn sm ghost" data-a="copy">${tr("کپی", "Copy")}</button></div>`;
    else faHtml = `<span class="todo">${tr(`برای ترجمه کلیک کن`, `Click to translate`)}</span><div class="acts">
        <button class="btn sm ghost" data-a="deep">${tr("توضیح ۴ سطحی", "4-level explain")}</button>
        <button class="btn sm ghost" data-a="cards">${tr("کارت مفهومی", "Concept cards")}</button>
        <button class="btn sm ghost" data-a="ask">${tr("💬 استاد", "💬 Tutor")}</button></div>`;
    return `<div class="fa">${hmHtml}${faHtml}${!L.state ? deepExpHtml(p) : ""}${shown && !L.state ? explainHtml(p) : ""}</div><div class="src" dir="ltr">${hlEn(entEn(esc(p.text)))}</div>${rxHtml(p)}`;
  }
  function rowClass(p) {
    const L = live[p.id] || {};
    const hm = S.heatOn && data?.heatmap ? data.heatmap[String(p.id)] : null;
    return `row ${(p.tags || []).map(t => "t-" + t).join(" ")} ${p.kind} ${hm ? "hm-" + hm.tier : ""} ${(p.base || p.better) && !L.state ? "done" : ""} ${L.state || ""}`;
  }
  function renderParas() {
    if (!data.paragraphs.length) {
      canvas.innerHTML = `<div class="sheet"><div class="paper cta"><b>${tr(`این صفحه متنی ندارد`, `This page has no text`)}</b><span>${tr(`احتمالاً تصویر یا صفحه‌ی خالی است.`, `It's probably an image or a blank page.`)}</span>
        <img src="/api/books/${bookId}/pages/${S.page}/image" alt="${tr("تصویر صفحه", "Page image")}" style="max-width:380px;width:100%;border:1px solid var(--line);border-radius:6px"></div></div>`;
      return;
    }
    canvas.innerHTML = `<div class="sheet lay-${S.layout} ${S.heatOn && S.onlyCore ? "hm-only-core" : ""}">
      <div class="colheads"><span>${tr("فارسی", "Persian")}</span><span>English</span></div>
      <div class="paper" id="rows">${data.paragraphs.map(p => `<div class="${rowClass(p)}" data-id="${p.id}" tabindex="0">${rowInner(p)}</div>`).join("")}</div>${chapterEndCard()}</div>`;
    $("#rows").addEventListener("click", onRowClick);
    scrollToMark(); flashRow();
    $("#rows").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.classList.contains("row")) onRowClick({ target: e.target }); });
  }
  function paintRow(p) {
    const el = $(`.row[data-id="${p.id}"]`, canvas);
    if (!el) return;
    el.className = rowClass(p);
    el.innerHTML = rowInner(p);
  }
  function paintLive(p) {
    const el = $(`.row[data-id="${p.id}"] .fa`, canvas);
    if (el) el.innerHTML = esc(live[p.id].text) + '<span class="caret"></span>';
  }

  function onRowClick(e) {
    const row = e.target.closest(".row"); if (!row) return;
    const p = data.paragraphs.find(x => x.id === +row.dataset.id); if (!p) return;
    if (e.target.closest("[data-dexp-close]")) { DEXP[p.id] = { ...(DEXP[p.id] || {}), open: false, closed: true, live: null }; paintRow(p); return; }
    const deBtn = e.target.closest("[data-dexp]");
    if (deBtn) return runDeepExplain(p, deBtn.dataset.dexp);
    const btn = e.target.closest("[data-a]");
    if (btn) return rowAction(p, btn.dataset.a);
    if (e.target.closest("a, .ent, .dexp-bar, .dexp-box")) return;
    if (window.getSelection().toString().trim()) return;   // selecting a word for lookup
    if (p.kind === "raw" || p.base || live[p.id]) return;
    enqueue(p);
  }

  async function runDeepExplain(p, level) {
    DEXP[p.id] = { open: true, active: level, live: null };
    if (p.deep_explains?.[level]) { paintRow(p); return; }
    DEXP[p.id].live = ""; paintRow(p);
    try {
      const { text } = await streamPost(`/api/paragraphs/${p.id}/explain-deep?level=${level}`, null, t => {
        DEXP[p.id].live = t;
        const box = $(`.row[data-id="${p.id}"] .dexp-box`, canvas);
        if (box) box.innerHTML = renderMd(t) + '<span class="caret"></span>';
      });
      p.deep_explains = { ...(p.deep_explains || {}), [level]: text };
    } catch (e) { toast(e.message, true); }
    DEXP[p.id].live = null; paintRow(p); refreshUsage();
  }

  async function rowAction(p, a) {
    if (a === "copy") {
      try { await navigator.clipboard.writeText((p.better || p.base).text); toast(tr("کپی شد", "Copied")); } catch { toast(tr("کپی نشد", "Couldn't copy"), true); }
    } else if (a === "better") { enqueue(p, "better"); }
    else if (a === "deep") { runDeepExplain(p, DEXP[p.id]?.active || "eli5"); }
    else if (a === "cards") { Deep.openCardsModal(p.id, () => { refreshDue(); if (S.tab === "words") renderTab(); }); }
    else if (a === "ask") { S.focusPara = p; S.tools = true; S.tab = "tutor"; LS.set("tools", true); applyChrome(); renderTab(); }
    else if (a === "base") { await api(`/api/paragraphs/${p.id}/translation?kind=better`, { method: "DELETE" }); p.better = null; paintRow(p); }
    else if (a === "redo") {
      await api(`/api/paragraphs/${p.id}/translation?kind=base`, { method: "DELETE" });
      if (p.better) await api(`/api/paragraphs/${p.id}/translation?kind=better`, { method: "DELETE" });
      p.base = p.better = null; enqueue(p);
    } else if (a === "explain") { explainPara(p);
    } else if (a === "retry") { const k = live[p.id]?.kind || "base"; delete live[p.id]; enqueue(p, k); }
  }

  function enqueue(p, kind = "base") {
    if (Q.list.some(x => x.p.id === p.id) || Q.cur?.p.id === p.id) return;
    live[p.id] = { state: "queued", text: "" };
    Q.list.push({ p, kind });
    paintRow(p); pump(); updateBar();
  }
  /* "translate all paragraphs" and "translate whole page" are the same single request */
  const translateAll = () => runPageStream();
  let pageStreamText = "";
  function parseStream(t) {
    let meta = null;
    const e = t.indexOf("\x04");
    if (e !== -1) { try { meta = JSON.parse(t.slice(e + 1)); } catch {} t = t.slice(0, e); }
    const order = [], map = {};
    t.split("\x01").slice(1).forEach(seg => {
      const i = seg.indexOf("\x02"); if (i === -1) return;
      const id = +seg.slice(0, i);
      if (!(id in map)) { order.push(id); map[id] = ""; }
      map[id] += seg.slice(i + 1);
    });
    return { order, map, meta };
  }
  async function runPageStream() {
    if (pageCtrl) return;
    stopQueue();
    const want = S.page;
    const ids = data.paragraphs.filter(p => !p.base && p.kind !== "raw").map(p => p.id);
    ids.forEach(id => { live[id] = { state: "queued", text: "" }; });
    pageCtrl = new AbortController(); pageStreamText = "";
    render();
    let result = null;
    try {
      const { text, meta } = await streamPost(`/api/books/${bookId}/pages/${want}/translate`, pageCtrl.signal, t => {
        if (!alive || want !== S.page) return;
        const r = parseStream(t);
        pageStreamText = data.paragraphs.map(p => (r.map[p.id] || "").trim()).filter(Boolean).join("\n\n");
        if (S.mode === "para") {
          const lastId = r.order[r.order.length - 1];
          r.order.forEach(id => {
            if (!live[id]) return;
            const txt = r.map[id].trim(), st = id === lastId && !r.meta ? "live" : "streamed";
            if (live[id].text !== txt || live[id].state !== st) { live[id].text = txt; live[id].state = st; paintRow(data.paragraphs.find(p => p.id === id)); }
          });
        } else {
          const el = $("#ptext"); if (el) el.innerHTML = paras(pageStreamText) + (r.meta ? "" : '<span class="caret"></span>');
        }
      });
      result = parseStream(text).meta;
      if (meta.note) toast(meta.note);
    } catch (e) {
      if (e.name !== "AbortError" && alive && want === S.page) toast(e.message, true);
    }
    pageCtrl = null;
    ids.forEach(id => delete live[id]);
    if (!alive || want !== S.page) return;
    try { data = await api(`/api/books/${bookId}/pages/${want}`); } catch {}
    render(); refreshUsage();
    if (result?.misaligned) toast(tr("مدل مرز پاراگراف‌ها را نگه نداشت؛ ترجمه در حالت صفحه‌ای ذخیره شد و پاراگراف‌های بی‌ترجمه را می‌توانی تک‌تک ترجمه کنی.", "The model didn't keep paragraph boundaries; the translation was saved in page mode and you can translate the remaining paragraphs one by one."), true);
    else if (result?.sent) toast(tr(`${fa(result.stored)} پاراگراف با یک درخواست ترجمه شد`, `${fa(result.stored)} paragraphs translated in one request`));
  }
  async function pump() {
    if (Q.cur || !Q.list.length) return;
    const job = Q.cur = Q.list.shift();
    job.ctrl = new AbortController();
    const { p, kind } = job;
    live[p.id] = { state: "live", text: "", kind };
    paintRow(p);
    try {
      const { text, meta } = await streamPost(`/api/paragraphs/${p.id}/translate?kind=${kind}`, job.ctrl.signal, t => {
        live[p.id].text = t; paintLive(p);
      });
      p[kind] = { text, provider: meta.provider, model: meta.model };
      if (meta.note) toast(meta.note);
      delete live[p.id];
    } catch (e) {
      if (e.name === "AbortError") delete live[p.id];
      else live[p.id] = { state: "error", error: e.message, kind };
    }
    if (Q.cur === job) Q.cur = null;
    if (alive) { paintRow(p); updateBar(); pump(); refreshUsage(); }
  }
  function stopQueue() {
    Q.list.forEach(j => delete live[j.p.id]);
    const affected = Q.list.map(j => j.p);
    Q.list = [];
    if (Q.cur) { Q.cur.ctrl.abort(); }
    if (alive && data && S.mode === "para") affected.forEach(paintRow);
  }
  function stopAll() {
    stopQueue();
    if (pageCtrl) pageCtrl.abort();       // runPageStream reloads the page; finished parts are already saved
    if (alive) updateBar();
  }

  /* --- page mode */
  function paras(text, deco) { return text.split(/\n\s*\n/).filter(s => s.trim()).map(s => `<p>${deco ? hlFa(entFa(esc(s.trim()))) : esc(s.trim())}</p>`).join(""); }
  function renderPage() {
    const pt = data.page_translation;
    const img = data.has_file
      ? `<div class="pane img-pane"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span class="small muted">${tr("صفحه‌ی", "Page")} ${fa(S.page)}</span>
          <button class="btn sm" id="img-analyze">${tr(`🔍 تحلیل نمودار / فرمول`, `🔍 Analyze chart / formula`)}</button></div>
          <div class="img-wrap"><img src="/api/books/${bookId}/pages/${S.page}/image?zoom=1.6" alt="${tr(`صفحه‌ی ${fa(S.page)} از فایل اصلی`, `Page ${fa(S.page)} of the original file`)}" draggable="false"></div>
          <div id="img-an-out" class="deep-box" style="margin-top:12px" hidden></div></div>`
      : `<div class="pane img-pane"><p class="small muted">${tr(`این سند متنی است و تصویر صفحه ندارد.`, `This is a text document; it has no page images.`)}</p></div>`;
    let inner;
    if (!data.paragraphs.length) inner = `<div class="cta"><b>${tr(`این صفحه متنی برای ترجمه ندارد`, `This page has no text to translate`)}</b></div>`;
    else if (pageCtrl) inner = `<div class="page-meta"><span class="pill busy">${tr("در حال ترجمه", "Translating")}</span></div><div id="ptext">${paras(pageStreamText)}<span class="caret"></span></div>`;
    else if (pt) inner = `<div class="page-meta"><span>${providerPill(pt.provider, pt.model)}</span>
        <span><button class="btn sm ghost" id="pcopy">${tr("کپی", "Copy")}</button><button class="btn sm ghost" id="predo">${tr("ترجمه‌ی دوباره", "Translate again")}</button></span></div>
        <div id="ptext">${paras(pt.text, true)}</div>${chapterEndCard()}`;
    else {
      const todo = data.paragraphs.filter(p => !p.base && p.kind !== "raw");
      const done = data.paragraphs.filter(p => p.kind !== "raw").length - todo.length;
      inner = `<div class="cta" id="pcta"><b>${tr(`این صفحه هنوز کامل ترجمه نشده`, `This page isn't fully translated yet`)}</b>
        <span class="small">${done ? tr(`${fa(done)} پاراگراف از قبل ترجمه شده و دوباره فرستاده نمی‌شود؛ `, `${fa(done)} paragraphs are already translated and won't be resent; `) : ""}${tr(`${fa(todo.length)} پاراگراف (${fa(todo.reduce((n, p) => n + p.text.length, 0))} کاراکتر) با یک درخواست`, `${fa(todo.length)} paragraphs (${fa(todo.reduce((n, p) => n + p.text.length, 0))} characters) in one request`)} · ${whoFor("translate_page")}</span>
        <button class="btn go" id="pgo">${ICON.play} ${tr(`ترجمه‌ی کل صفحه`, `Translate whole page`)}</button></div>`;
    }
    canvas.innerHTML = `<div class="split"><div class="pane fa-pane"><div class="inner">${inner}
      ${data.paragraphs.length ? `<details class="origs"><summary>${tr(`متن اصلی این صفحه (برای انتخاب کلمه)`, `Original text of this page (for selecting words)`)}</summary>${data.paragraphs.map(p => `<p class="src" dir="ltr">${hlEn(entEn(esc(p.text)))}</p>`).join("")}</details>` : ""}
      </div></div>${img}</div>`;
    if ($("#pgo")) $("#pgo").onclick = runPageStream;
    if (S.hl && $(".fa-pane mark") == null && $(".origs mark")) $(".origs").open = true;
    scrollToMark();
    if ($("#predo")) $("#predo").onclick = async e => {
      const b = e.currentTarget;
      if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = tr("ترجمه‌ی همه‌ی پاراگراف‌های این صفحه پاک و دوباره فرستاده می‌شود. مطمئنی؟", "All paragraph translations on this page will be cleared and resent. Sure?"); return; }
      await api(`/api/books/${bookId}/pages/${S.page}/translation`, { method: "DELETE" });
      data = await api(`/api/books/${bookId}/pages/${S.page}`); runPageStream();
    };
    if ($("#pcopy")) $("#pcopy").onclick = async () => { try { await navigator.clipboard.writeText(pt.text); toast(tr("کپی شد", "Copied")); } catch { toast(tr("کپی نشد", "Couldn't copy"), true); } };
    if (data.has_file) Deep.attachRegionAnalyzer(canvas, bookId, S.page, refreshUsage);
  }
  /* --- tools panel */
  async function renderTab() {
    const pane = $("#tabpane");
    if (!S.tools) return;
    if (S.tab === "tutor") {
      return Deep.renderTutorTab(pane, { bookId, getPage: () => S.page, focusPara: S.focusPara, clearFocusPara: () => { S.focusPara = null; }, refreshUsage });
    }
    if (S.tab === "brain") {
      return Deep.renderBrainTab(pane, { bookId, getPage: () => S.page, refreshUsage });
    }
    if (S.tab === "gloss") {
      const g = await api(`/api/books/${bookId}/glossary`);
      const running = g.status === "running";
      const kinds = [["person", tr("شخص", "Person")], ["place", tr("مکان", "Place")], ["org", tr("سازمان", "Organization")], ["concept", tr("مفهوم", "Concept")], ["other", tr("دیگر", "Other")]];
      const kindSel = (v, attr) => `<select ${attr} class="kind">${kinds.map(([k, l]) => `<option value="${k}" ${v === k ? "selected" : ""}>${l}</option>`).join("")}</select>`;
      pane.innerHTML = `<p class="small muted">${tr(`روی هر اصطلاح بزن تا صفحه‌هایی که در آن آمده را ببینی و به آن‌جا بروی.`, `Tap a term to see the pages it appears on and jump there.`)}</p>
        <div style="display:flex;gap:8px;align-items:center;justify-content:space-between">
          <span class="small">${running ? `<span class="pill busy">${tr("در حال ساخت", "Building")}</span>` : (g.status || "").startsWith("error") ? `<span style="color:var(--danger)">${esc(g.status.slice(7))}</span>` : tr(`${fa(g.items.length)} اصطلاح`, `${fa(g.items.length)} terms`)}</span>
          <button class="btn sm" id="gbuild" ${running ? "disabled" : ""} title="${esc(task.glossary.provider + " · " + (task.glossary.model || task.translate_para.model))}">${g.items.length ? tr("پیدا کردن اصطلاحات بیشتر", "Find more terms") : tr("ساخت خودکار واژه‌نامه", "Build glossary automatically")}</button></div>
        <input type="text" id="gfilter" placeholder="${tr("جست‌وجو در واژه‌نامه…", "Search the glossary…")}" aria-label="${tr("جست‌وجو در واژه‌نامه", "Search the glossary")}">
        <div class="gloss">${g.items.map(t => `<div class="gi" data-term="${esc(t.term)}">
            <div class="g"><button class="termbtn en" data-find="${esc(t.term)}" title="${tr(`نمایش صفحه‌هایی که «${esc(t.term)}» در آن آمده`, `Show pages where “${esc(t.term)}” appears`)}">${esc(t.term)}</button>
            <input type="text" value="${esc(t.fa)}" data-fa="${esc(t.term)}" aria-label="${tr(`ترجمه‌ی ${esc(t.term)}`, `Translation of ${esc(t.term)}`)}">
            ${kindSel(t.kind || "other", `data-kind="${esc(t.term)}" aria-label="${tr("نوع", "Type of")} ${esc(t.term)}"`)}
            <button class="btn sm ghost" data-rm="${esc(t.term)}" aria-label="${tr(`حذف ${esc(t.term)}`, `Delete ${esc(t.term)}`)}">×</button></div>
            <div class="occ" hidden></div></div>`).join("")}</div>
        <form class="gadd" id="gadd"><input id="gterm" type="text" class="ltr" placeholder="English"><input id="gfa" type="text" dir="rtl" placeholder="${tr("فارسی", "Persian")}">${kindSel("person", `id="gkind" aria-label="${tr("نوع", "Type")}"`)}<button class="btn sm">${tr("افزودن", "Add")}</button></form>
        <p class="small muted">${tr(`برای جست‌وجوی هر کلمه‌ی دیگر: آن را در متن انگلیسی انتخاب کن و از پنجره‌ی معنی «همه‌ی صفحه‌ها» را بزن.`, `To search for any other word, select it in the English text and press “All pages” in the definition popup.`)}</p>`;
      const save = async (term, body) => { await api(`/api/books/${bookId}/glossary`, { method: "PUT", body: { term, ...body } }); toast(tr("ذخیره شد", "Saved")); await loadEntities(); render(); };
      $$("#tabpane input[data-fa]").forEach(i => i.onchange = () => save(i.dataset.fa, { fa: i.value }));
      $$("#tabpane select[data-kind]").forEach(sel => sel.onchange = () => {
        const fav = $(`#tabpane input[data-fa="${CSS.escape(sel.dataset.kind)}"]`).value;
        save(sel.dataset.kind, { fa: fav, kind: sel.value });
      });
      $$("#tabpane [data-rm]").forEach(b => b.onclick = async () => { await api(`/api/books/${bookId}/glossary?term=${encodeURIComponent(b.dataset.rm)}`, { method: "DELETE" }); renderTab(); });
      $$("#tabpane [data-find]").forEach(b => b.onclick = async () => {
        const box = b.closest(".gi").querySelector(".occ");
        if (!box.hidden) { box.hidden = true; return; }
        const faTerm = b.closest(".gi").querySelector("input[data-fa]").value;
        box.hidden = false; box.innerHTML = `<span class="small muted">${tr(`در حال جست‌وجو…`, `Searching…`)}</span>`;
        const r = await api(`/api/books/${bookId}/find?q=${encodeURIComponent(b.dataset.find)}`);
        showOccurrences(box, r, faTerm, true);
      });
      $("#gfilter").oninput = e => {
        const q = e.target.value.trim().toLowerCase();
        $$("#tabpane .gi").forEach(el => { el.hidden = q && !(el.dataset.term.toLowerCase().includes(q) || el.querySelector("input[data-fa]").value.includes(q)); });
      };
      $("#gadd").onsubmit = async e => {
        e.preventDefault();
        const term = $("#gterm").value.trim(), f = $("#gfa").value.trim();
        if (!term || !f) return toast(tr("هر دو خانه را پر کن", "Fill in both fields"), true);
        await api(`/api/books/${bookId}/glossary`, { method: "PUT", body: { term, fa: f, kind: $("#gkind").value } }); renderTab();
      };
      $("#gbuild").onclick = async () => { await api(`/api/books/${bookId}/glossary/build`, { method: "POST" }); renderTab(); };
      if (running && alive) { const t = setTimeout(() => { if (S.tab === "gloss") renderTab(); }, 2500); onLeave(() => clearTimeout(t)); }
      else if (g.items.length !== ENT.list.length) { await loadEntities(); render(); }
    } else if (S.tab === "image") {
      renderImageTab(pane);
    } else if (S.tab === "review") {
      renderReviewTab(pane);
    } else if (S.tab === "notebook") {
      renderNotebookTab(pane);
    } else if (S.tab === "words") {
      const { cards } = await api("/api/cards");
      const mine = cards.filter(c => c.book_id === bookId);
      pane.innerHTML = `<p class="small muted">${tr(`کلمه‌ای را در متن انگلیسی انتخاب کن تا معنی‌اش بیاید و به کارت‌ها اضافه شود.`, `Select a word in the English text to see its meaning and add it to your cards.`)}</p>
        ${mine.length ? `<div class="wordlist">${mine.map(c => `<div><span class="en">${esc(c.front)}</span><span>${esc(c.back)}</span></div>`).join("")}</div>
        <a class="btn sm" href="#/cards">${tr(`مرور کارت‌ها`, `Review cards`)}</a>` : `<p class="small">${tr(`هنوز کلمه‌ای از این کتاب ذخیره نکرده‌ای.`, `You haven't saved any words from this book yet.`)}</p>`}`;
    } else {
      const u = await api("/api/usage");
      const pct = u.cap ? Math.min(100, u.openai_tokens / u.cap * 100) : 0;
      pane.innerHTML = `<div class="meter"><h3>${tr(`OpenAI این ماه`, `OpenAI this month`)}</h3><div class="track"><i style="width:${pct}%"></i></div></div>
        <div class="kv"><span>${tr(`${fa(u.openai_tokens)} از ${u.cap ? fa(u.cap) : "∞"} توکن`, `${fa(u.openai_tokens)} of ${u.cap ? fa(u.cap) : "∞"} tokens`)}</span><span>${u.cost ? "$" + u.cost.toFixed(2) : ""}</span></div>
        ${u.local_share != null ? `<div class="kv"><span>${tr("سهم Ollama از درخواست‌ها", "Ollama share of requests")}</span><span>${fa(u.local_share)}${PCT}</span></div>` : ""}
        <div class="wordlist">${u.rows.map(r => `<div><span>${providerPill(r.provider, r.model)}</span><span class="small muted">${tr(`${fa(r.calls)} درخواست`, `${fa(r.calls)} requests`)}</span></div>`).join("")}</div>`;
    }
  }
  function refreshUsage() { if (S.tools && S.tab === "usage") renderTab(); }

  /* --- find & highlight */
  const reEsc = t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function hlEn(html) {
    if (!S.hl) return html;
    const re = new RegExp(`(?<![A-Za-z])(${reEsc(esc(S.hl.term))})(?![A-Za-z])`, "gi");
    return html.replace(re, '<mark class="hl">$1</mark>');
  }
  function hlFa(html) {
    if (!S.hl || !S.hl.fa) return html;
    const t = esc(S.hl.fa);
    return html.split(t).join(`<mark class="hl">${t}</mark>`);
  }
  function scrollToMark() {
    if (!S.hl) return;
    requestAnimationFrame(() => { const m = $("mark.hl", canvas); if (m) m.scrollIntoView({ block: "center", behavior: "smooth" }); });
  }
  function setHighlight(r, faTerm, idx) {
    if (!r.pages.length) return;
    idx = idx < 0 ? 0 : idx;
    S.hl = { term: r.term, fa: faTerm, pages: r.pages.map(p => p.page), i: idx };
    const target = S.hl.pages[idx];
    if (target === S.page) { render(); renderChip(); } else go(target);
  }
  function renderChip() {
    const el = $("#hlchip");
    if (!S.hl) { el.innerHTML = ""; return; }
    const i = S.hl.pages.indexOf(S.page);
    if (i !== -1) S.hl.i = i;
    el.innerHTML = `<span class="hlchip"><mark class="hl" dir="ltr">${esc(S.hl.term)}</mark>
      <span class="small">${i === -1 ? tr("در این صفحه نیست", "Not on this page") : tr(`${fa(i + 1)} از ${fa(S.hl.pages.length)} صفحه`, `${fa(i + 1)} of ${fa(S.hl.pages.length)} pages`)}</span>
      <button class="btn icon ghost" data-h="prev" title="${tr("صفحه‌ی قبلی که آمده", "Previous occurrence")}" aria-label="${tr("قبلی", "Previous")}">${ICON.prev}</button>
      <button class="btn icon ghost" data-h="next" title="${tr("صفحه‌ی بعدی که آمده", "Next occurrence")}" aria-label="${tr("بعدی", "Next")}">${ICON.next}</button>
      <button class="btn icon ghost" data-h="x" title="${tr("پاک کردن نشانه‌گذاری", "Clear highlights")}" aria-label="${tr("بستن", "Close")}">${ICON.close}</button></span>`;
    $$("#hlchip [data-h]").forEach(b => b.onclick = () => {
      const h = b.dataset.h, P = S.hl.pages;
      if (h === "x") { S.hl = null; renderChip(); render(); return; }
      const next = h === "next" ? P.find(p => p > S.page) : [...P].reverse().find(p => p < S.page);
      if (next) go(next); else toast(h === "next" ? tr("بعد از این صفحه جای دیگری نیامده", "No later occurrences") : tr("قبل از این صفحه جای دیگری نیامده", "No earlier occurrences"));
    });
  }
  function showOccurrences(box, r, faTerm, jump) {
    if (!r.pages.length) { box.innerHTML = `<span class="small muted">${tr(`در متن پیدا نشد.`, `Not found in the text.`)}</span>`; return; }
    const here = S.page;
    box.innerHTML = `<div class="small muted">${tr(`${fa(r.total)} بار در ${fa(r.pages.length)} صفحه`, `${fa(r.total)} times on ${fa(r.pages.length)} pages`)}</div>` + r.pages.map((p, i) =>
      `<button class="occ-i ${p.page > here ? "later" : ""}" data-i="${i}"><b>${tr("ص", "p.")} ${fa(p.page)}</b>${p.count > 1 ? `<span class="small muted"> · ${tr(`${fa(p.count)} بار`, `${fa(p.count)}×`)}</span>` : ""}${p.page > here ? `<span class="later-tag">${tr("جلوتر از جایی که هستی", "Ahead of where you are")}</span>` : ""}
        <span class="snip" dir="ltr">${esc(p.snippet).replace(new RegExp(`(?<![A-Za-z])(${reEsc(esc(r.term))})(?![A-Za-z])`, "gi"), "<mark>$1</mark>")}</span></button>`).join("");
    $$(".occ-i", box).forEach(b => b.onclick = () => setHighlight(r, faTerm, +b.dataset.i));
    if (jump) setHighlight(r, faTerm, 0);
  }

  /* --- image prompt tab */
  const STYLE_FA = { cinematic: tr("سینمایی", "Cinematic"), watercolor: tr("آبرنگ", "Watercolor"), oil: tr("رنگ روغن", "Oil painting"), storybook: tr("کتاب کودک", "Storybook"), persian: tr("مینیاتور ایرانی", "Persian miniature"),
                     ink: tr("طراحی با جوهر", "Ink drawing"), anime: tr("انیمه", "Anime"), photo: tr("عکس واقعی", "Photo"), concept: tr("کانسپت آرت", "Concept art") };
  let imgCtrl = null;
  async function renderImageTab(pane) {
    const pageAt = S.page;
    const { items } = await api(`/api/books/${bookId}/pages/${pageAt}/image-prompts`);
    if (S.tab !== "image" || pageAt !== S.page) return;
    const st = LS.get("img", { style: "cinematic", aspect: "16:9", lang: "en" });
    const who = task.image_prompt?.model ? task.image_prompt : task.translate_para;
    pane.innerHTML = `<p class="small muted">${tr(`یک پرامپت برای مدل‌های تصویرساز (Midjourney، DALL·E، Flux، Stable Diffusion) از صحنه‌ی اصلی صفحه‌ی ${fa(pageAt)} می‌نویسد. فقط پرامپت؛ تصویری ساخته نمی‌شود.`, `Writes a prompt for image models (Midjourney, DALL·E, Flux, Stable Diffusion) from the main scene on page ${fa(pageAt)}. Prompt only; no image is generated.`)}</p>
      <div class="r2"><div class="field"><label for="i-style">${tr("سبک", "Style")}</label><select id="i-style">${Object.entries(STYLE_FA).map(([k, l]) => `<option value="${k}" ${st.style === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div class="field"><label for="i-aspect">${tr(`نسبت تصویر`, `Aspect ratio`)}</label><select id="i-aspect">${["16:9", "3:2", "1:1", "4:5", "9:16"].map(a => `<option ${st.aspect === a ? "selected" : ""}>${a}</option>`).join("")}</select></div></div>
      <div class="field"><label>${tr(`زبان پرامپت`, `Prompt language`)}</label><div class="seg" id="i-lang"><button data-v="en" class="${st.lang === "en" ? "on" : ""}">English</button><button data-v="fa" class="${st.lang === "fa" ? "on" : ""}">${tr("فارسی", "Persian")}</button></div></div>
      <div class="field"><label for="i-wish">${tr(`چه چیزی حتماً در تصویر باشد؟ (اختیاری)`, `Anything that must be in the image? (optional)`)}</label><textarea id="i-wish" rows="2" placeholder="${tr(`مثلاً: کلبه‌ی کنار دریاچه در سپیده‌دم`, `e.g. a cabin by the lake at dawn`)}"></textarea></div>
      <button class="btn go" id="i-go">${ICON.image} ${tr(`نوشتن پرامپت برای این صفحه`, `Write a prompt for this page`)}</button>
      <span class="small muted">${providerPill(who.provider, who.model)}</span>
      <div id="i-out"></div>
      ${items.length ? `<h3 style="margin-top:6px">${tr(`پرامپت‌های قبلی این صفحه`, `Earlier prompts for this page`)}</h3>${items.map(it => promptCard(it.text, it.lang, `${STYLE_FA[it.style] || it.style} · ${it.aspect}`, it.id)).join("")}` : ""}`;
    const save = () => LS.set("img", { style: $("#i-style").value, aspect: $("#i-aspect").value, lang: $(".on", $("#i-lang")).dataset.v });
    $("#i-style").onchange = save; $("#i-aspect").onchange = save;
    $$("#i-lang button").forEach(b => b.onclick = () => { $$("#i-lang button").forEach(x => x.classList.toggle("on", x === b)); save(); });
    bindPromptCards(pane);
    $("#i-go").onclick = async () => {
      save();
      const o = LS.get("img", {});
      const out = $("#i-out");
      if (imgCtrl) imgCtrl.abort();
      imgCtrl = new AbortController();
      $("#i-go").disabled = true;
      out.innerHTML = promptCard("", o.lang, tr("در حال نوشتن…", "Writing…"));
      const box = $(".ptext", out);
      try {
        const q = new URLSearchParams({ style: o.style, aspect: o.aspect, lang: o.lang, wish: $("#i-wish").value });
        await streamPost(`/api/books/${bookId}/pages/${pageAt}/image-prompt?${q}`, imgCtrl.signal, t => { box.innerHTML = esc(t) + '<span class="caret"></span>'; });
        imgCtrl = null;
        if (S.tab === "image" && pageAt === S.page) renderTab();
      } catch (e) {
        if (e.name !== "AbortError") out.innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
        const b = $("#i-go"); if (b) b.disabled = false;
      }
    };
  }
  function promptCard(text, lang, meta, id) {
    return `<div class="promptcard"><div class="ptext" dir="${lang === "fa" ? "rtl" : "ltr"}">${esc(text)}</div>
      <div class="pfoot"><span class="small muted">${esc(meta || "")}</span><span>
      ${text ? `<button class="btn sm" data-copy>${tr("کپی", "Copy")}</button>` : ""}${id ? `<button class="btn sm ghost danger" data-delp="${id}" aria-label="${tr("حذف", "Delete")}">×</button>` : ""}</span></div></div>`;
  }
  function bindPromptCards(root) {
    $$("[data-copy]", root).forEach(b => b.onclick = async () => {
      const t = b.closest(".promptcard").querySelector(".ptext").textContent;
      try { await navigator.clipboard.writeText(t); toast(tr("پرامپت کپی شد", "Prompt copied")); } catch { toast(tr("کپی نشد", "Couldn't copy"), true); }
    });
    $$("[data-delp]", root).forEach(b => b.onclick = async () => { await api(`/api/image-prompts/${b.dataset.delp}`, { method: "DELETE" }); renderTab(); });
  }

  /* --- overlays: graph and mind map */
  const ov = $("#overlay");
  function openOverlay(kind) {
    if (S.overlay === kind) return closeOverlay();
    S.overlay = kind; ov.hidden = false;
    $("#oGraph")?.classList.toggle("on", kind === "graph"); $("#oMind")?.classList.toggle("on", kind === "mind");
    $("#oPalace")?.classList.toggle("on", kind === "palace"); $("#oDeep")?.classList.toggle("go", kind === "deep");
    if (kind === "deep") {
      Deep.openDeepOverlay(ov, { bookId, getPage: () => S.page, closeOverlay, goPage: go, refreshUsage, openOtherOverlay: k => { S.overlay = null; openOverlay(k); } });
      return;
    }
    ({ graph: Graph, mind: Mind, quiz: Quiz, palace: Palace, post: Post })[kind].open();
  }
  function closeOverlay() {
    S.overlay = null; ov.hidden = true; ov.innerHTML = "";
    $("#oGraph")?.classList.remove("on"); $("#oMind")?.classList.remove("on"); $("#oPalace")?.classList.remove("on"); $("#oDeep")?.classList.remove("go");
    Graph.stop();
  }
  const ovHead = (title, controls) => `<div class="ov-head"><h2>${title}</h2>${controls}<span class="grow"></span>
    <button class="btn icon ghost" data-fit title="${tr("جا دادن در صفحه", "Fit to screen")}" aria-label="${tr("جا دادن در صفحه", "Fit to screen")}">${ICON.fit}</button>
    <button class="btn icon ghost" data-close title="${tr("بستن", "Close")}" aria-label="${tr("بستن", "Close")}">${ICON.close}</button></div>`;

  /* pan & zoom for a stage element inside a viewport */
  function panZoom(viewport, stage, onChange) {
    const T = { x: 0, y: 0, k: 1 };
    const apply = () => { stage.style.transform = `translate(${T.x}px,${T.y}px) scale(${T.k})`; onChange && onChange(T); };
    viewport.addEventListener("wheel", e => {
      e.preventDefault();
      const r = viewport.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      const k2 = Math.max(.2, Math.min(3, T.k * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      T.x = mx - (mx - T.x) * (k2 / T.k); T.y = my - (my - T.y) * (k2 / T.k); T.k = k2; apply();
    }, { passive: false });
    let drag = null;
    viewport.addEventListener("pointerdown", e => {
      if (e.target.closest("[data-node],button,.mm-node,.ov-card")) return;
      drag = { x: e.clientX - T.x, y: e.clientY - T.y }; viewport.setPointerCapture(e.pointerId); viewport.classList.add("grabbing");
    });
    viewport.addEventListener("pointermove", e => { if (drag) { T.x = e.clientX - drag.x; T.y = e.clientY - drag.y; apply(); } });
    viewport.addEventListener("pointerup", () => { drag = null; viewport.classList.remove("grabbing"); });
    return {
      T, apply,
      fit(bb) {
        const r = viewport.getBoundingClientRect(), pad = 40;
        const k = Math.min(1.4, (r.width - pad * 2) / Math.max(bb.w, 1), (r.height - pad * 2) / Math.max(bb.h, 1));
        T.k = Math.max(.2, k); T.x = (r.width - bb.w * T.k) / 2 - bb.x * T.k; T.y = (r.height - bb.h * T.k) / 2 - bb.y * T.k; apply();
      },
    };
  }

  const KIND = { person: [tr("شخص", "Person"), "var(--accent)"], place: [tr("مکان", "Place"), "var(--local)"], org: [tr("سازمان", "Organization"), "var(--cloud)"], concept: [tr("مفهوم", "Concept"), "var(--saffron)"], other: [tr("دیگر", "Other"), "var(--muted)"] };

  const Graph = (() => {
    let g = { scope: "upto", filter: null, data: null, raf: 0, pz: null, sel: null, loadedFor: 0 };
    function stop() { cancelAnimationFrame(g.raf); g.raf = 0; }
    function open() {
      ov.innerHTML = ovHead(tr("گراف شخصیت‌ها", "Character graph"), `
        <div class="seg" id="g-filter"><button data-v="person">${tr("افراد", "People")}</button><button data-v="person,place">${tr("افراد و مکان‌ها", "People & places")}</button><button data-v="">${tr("همه", "All")}</button></div>
        <div class="seg" id="g-scope"><button data-v="upto">${tr("تا صفحه‌ی فعلی", "Up to this page")}</button><button data-v="all">${tr("کل کتاب", "Whole book")}</button></div>
        <button class="btn sm" id="g-explain">${tr("توضیح رابطه‌های اصلی با مدل", "Explain main relationships with the model")}</button>`) +
        `<div class="ov-body" id="g-view"><div class="ov-stage" id="g-stage"></div><div class="ov-card" id="g-card" hidden></div><div class="ov-note" id="g-note"></div></div>`;
      $("[data-close]", ov).onclick = closeOverlay;
      $("[data-fit]", ov).onclick = fit;
      $$("#g-scope button").forEach(b => b.onclick = () => { g.scope = b.dataset.v; load(); });
      $$("#g-filter button").forEach(b => b.onclick = () => { g.filter = b.dataset.v; load(); });
      $("#g-explain").onclick = explainTop;
      g.pz = panZoom($("#g-view"), $("#g-stage"));
      load();
    }
    function refresh() { if (g.scope === "upto" && g.loadedFor !== S.page) load(); }
    async function load() {
      stop();
      const upto = g.scope === "upto" ? S.page : 0;
      if (g.filter === null) {
        const gl = await api(`/api/books/${bookId}/glossary`);
        g.filter = gl.items.some(t => t.kind === "person") ? "person" : "";
      }
      $$("#g-scope button").forEach(b => b.classList.toggle("on", b.dataset.v === g.scope));
      $$("#g-filter button").forEach(b => b.classList.toggle("on", b.dataset.v === g.filter));
      const d = await api(`/api/books/${bookId}/graph?upto=${upto}&kinds=${encodeURIComponent(g.filter)}`);
      if (S.overlay !== "graph") return;
      g.data = d; g.loadedFor = S.page; g.sel = null; $("#g-card").hidden = true;
      $("#g-note").innerHTML = `${!d.from_glossary ? tr(`این گراف از اسم‌های پرتکرار متن ساخته شده. برای جدا کردن افراد از مکان‌ها، <button class="linkbtn" id="g-gl">واژه‌نامه را بساز</button>. `, `This graph is built from frequent names in the text. To separate people from places, <button class="linkbtn" id="g-gl">build the glossary</button>. `) : ""}
        ${g.scope === "upto" ? tr(`فقط تا صفحه‌ی ${fa(d.upto)}؛ چیزی از ادامه‌ی کتاب لو نمی‌رود.`, `Only up to page ${fa(d.upto)}, so nothing later is spoiled.`) : tr("کل کتاب؛ ممکن است اتفاق‌های بعدی لو برود.", "Whole book; later events may be spoiled.")} ${tr("خط‌ها یعنی دو نام در یک پاراگراف آمده‌اند؛ هرچه ضخیم‌تر، دفعات بیشتر.", "A line means two names appear in the same paragraph; the thicker, the more often.")}`;
      if ($("#g-gl")) $("#g-gl").onclick = async () => { await api(`/api/books/${bookId}/glossary/build`, { method: "POST" }); S.tools = true; S.tab = "gloss"; applyChrome(); renderTab(); toast(tr("ساخت واژه‌نامه شروع شد", "Glossary build started")); };
      if (!d.nodes.length) { $("#g-stage").innerHTML = ""; $("#g-card").hidden = false; $("#g-card").innerHTML = `<b>${tr(`چیزی برای نمایش نیست`, `Nothing to show`)}</b><p class="small muted">${g.filter ? tr("با این فیلتر نامی پیدا نشد. «همه» را امتحان کن یا نوع اصطلاحات را در واژه‌نامه مشخص کن.", "No names match this filter. Try “All”, or set term types in the glossary.") : tr("هنوز نام پرتکراری در این بخش از کتاب نیامده.", "No frequent names in this part of the book yet.")}</p>`; return; }
      simulate();
    }
    function simulate() {
      const d = g.data, N = d.nodes.length;
      const idx = new Map(d.nodes.map((n, i) => [n.id, i]));
      const maxC = Math.max(...d.nodes.map(n => n.count));
      g.nodes = d.nodes.map((n, i) => ({ ...n, r: 9 + 20 * Math.sqrt(n.count / maxC), x: 260 * Math.cos(2 * Math.PI * i / N) + Math.random() * 10, y: 260 * Math.sin(2 * Math.PI * i / N) + Math.random() * 10, vx: 0, vy: 0 }));
      const maxW = Math.max(1, ...d.edges.map(e => e.w));
      g.edges = d.edges.map(e => ({ ...e, s: idx.get(e.a), t: idx.get(e.b) }));
      g.stage = $("#g-stage");
      g.stage.innerHTML = `<svg class="gsvg" id="g-svg" overflow="visible" width="1" height="1"><g id="g-edges"></g><g id="g-labels"></g><g id="g-nodes"></g></svg>`;
      const E = $("#g-edges"), NL = $("#g-nodes");
      E.innerHTML = g.edges.map((e, i) => `<g class="edge" data-e="${i}"><line class="hit"/><line class="vis" style="stroke-width:${1 + 4 * e.w / maxW}"/></g>`).join("");
      NL.innerHTML = g.nodes.map((n, i) => `<g class="node" data-node="${i}" tabindex="0"><circle r="${n.r}" style="fill:${KIND[n.kind]?.[1] || KIND.other[1]}"/>
        <text y="${n.r + 16}">${esc(n.fa || n.id)}</text></g>`).join("");
      $$(".edge", E).forEach(el => el.onclick = e => { e.stopPropagation(); selectEdge(+el.dataset.e); });
      $$(".node", NL).forEach(el => {
        el.onpointerdown = e => {
          e.stopPropagation(); const n = g.nodes[+el.dataset.node]; n.fixed = true; el.setPointerCapture(e.pointerId);
          const move = ev => { const T = g.pz.T, r = $("#g-view").getBoundingClientRect(); n.x = (ev.clientX - r.left - T.x) / T.k; n.y = (ev.clientY - r.top - T.y) / T.k; n.moved = true; draw(); };
          const up = () => { el.removeEventListener("pointermove", move); el.removeEventListener("pointerup", up); if (!n.moved) selectNode(+el.dataset.node); n.moved = false; };
          el.addEventListener("pointermove", move); el.addEventListener("pointerup", up);
        };
        el.onkeydown = e => { if (e.key === "Enter") selectNode(+el.dataset.node); };
      });
      let alpha = 1, ticks = 0;
      const step = () => {
        for (let k = 0; k < 3; k++) tick(alpha);
        alpha *= 0.975; ticks++;
        draw();
        if (ticks === 25) fit();
        if (alpha > 0.02 && S.overlay === "graph") g.raf = requestAnimationFrame(step); else { g.raf = 0; fit(); }
      };
      g.raf = requestAnimationFrame(step);
    }
    function tick(alpha) {
      const ns = g.nodes;
      for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
        const a = ns[i], b = ns[j]; let dx = b.x - a.x, dy = b.y - a.y; let d2 = dx * dx + dy * dy || 0.01;
        const f = 5200 / d2 * alpha, d = Math.sqrt(d2); dx /= d; dy /= d;
        a.vx -= dx * f; a.vy -= dy * f; b.vx += dx * f; b.vy += dy * f;
      }
      const maxW = Math.max(1, ...g.edges.map(e => e.w));
      for (const e of g.edges) {
        const a = ns[e.s], b = ns[e.t]; const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const rest = 150 - 60 * (e.w / maxW), f = (d - rest) * 0.02 * alpha * (0.4 + e.w / maxW);
        a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f;
      }
      for (const n of ns) {
        n.vx -= n.x * 0.004 * alpha; n.vy -= n.y * 0.004 * alpha;
        if (!n.fixed) { n.x += n.vx; n.y += n.vy; }
        n.vx *= 0.6; n.vy *= 0.6;
      }
    }
    function draw() {
      $$("#g-edges .edge").forEach((el, i) => {
        const e = g.edges[i], a = g.nodes[e.s], b = g.nodes[e.t];
        el.querySelectorAll("line").forEach(l => { l.setAttribute("x1", a.x); l.setAttribute("y1", a.y); l.setAttribute("x2", b.x); l.setAttribute("y2", b.y); });
      });
      $("#g-labels").innerHTML = g.edges.map((e, i) => e.label ? `<text class="elabel" data-e="${i}" x="${(g.nodes[e.s].x + g.nodes[e.t].x) / 2}" y="${(g.nodes[e.s].y + g.nodes[e.t].y) / 2}">${esc(e.label)}</text>` : "").join("");
      $$("#g-labels .elabel").forEach(el => el.onclick = () => selectEdge(+el.dataset.e));
      $$("#g-nodes .node").forEach((el, i) => el.setAttribute("transform", `translate(${g.nodes[i].x},${g.nodes[i].y})`));
    }
    function fit() {
      if (!g.nodes || !g.nodes.length) return;
      const xs = g.nodes.map(n => n.x), ys = g.nodes.map(n => n.y);
      const x = Math.min(...xs) - 60, y = Math.min(...ys) - 40, w = Math.max(...xs) - x + 60, h = Math.max(...ys) - y + 60;
      g.pz.fit({ x, y, w, h });
    }
    function dim(keepNodes, keepEdges) {
      $$("#g-nodes .node").forEach((el, i) => el.classList.toggle("dim", !!keepNodes && !keepNodes.has(i)));
      $$("#g-edges .edge").forEach((el, i) => el.classList.toggle("dim", !!keepEdges && !keepEdges.has(i)));
      $$("#g-nodes .node").forEach((el, i) => el.classList.toggle("sel", g.sel?.type === "n" && g.sel.i === i));
    }
    function nodeName(n) { return n.fa ? `${esc(n.fa)} <span class="en small muted" dir="ltr">${esc(n.id)}</span>` : `<span class="en" dir="ltr">${esc(n.id)}</span>`; }
    function selectNode(i) {
      const n = g.nodes[i]; g.sel = { type: "n", i };
      const links = g.edges.map((e, k) => ({ e, k })).filter(({ e }) => e.s === i || e.t === i).sort((a, b) => b.e.w - a.e.w);
      dim(new Set([i, ...links.map(({ e }) => e.s === i ? e.t : e.s)]), new Set(links.map(l => l.k)));
      const card = $("#g-card"); card.hidden = false;
      card.innerHTML = `<div class="cardhead"><div><b style="font-size:1.05rem">${nodeName(n)}</b>
          <div class="small muted"><span class="kdot" style="background:${KIND[n.kind]?.[1]}"></span>${KIND[n.kind]?.[0] || ""} · ${tr(`${fa(n.count)} بار · اولین بار ص ${fa(n.first)}`, `${fa(n.count)}× · first on p. ${fa(n.first)}`)}</div></div>
          <button class="btn icon ghost" data-x aria-label="${tr("بستن", "Close")}">${ICON.close}</button></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn sm" data-first>${tr(`رفتن به اولین حضور`, `Go to first appearance`)}</button><button class="btn sm ghost" data-all>${tr("همه‌ی صفحه‌ها", "All pages")}</button></div>
        <h3>${tr("ارتباط‌ها", "Connections")}</h3>
        <div class="links">${links.slice(0, 12).map(({ e, k }) => { const o = g.nodes[e.s === i ? e.t : e.s]; return `<div class="lk">
          <button class="linkbtn" data-n="${e.s === i ? e.t : e.s}">${esc(o.fa || o.id)}</button><span class="small muted">${tr(`${fa(e.w)} پاراگراف مشترک`, `${fa(e.w)} shared paragraphs`)}</span>
          ${e.label ? `<div class="lab"><b>${esc(e.label)}</b> <span class="small">${esc(e.summary || "")}</span></div>` : `<button class="btn sm ghost" data-ex="${k}">${tr("توضیح رابطه", "Explain relationship")}</button>`}</div>`; }).join("") || `<span class="small muted">${tr(`با کسی در یک پاراگراف نیامده.`, `Never appears in a paragraph with anyone else.`)}</span>`}</div>`;
      bindCard(card, n);
    }
    function selectEdge(k) {
      const e = g.edges[k], a = g.nodes[e.s], b = g.nodes[e.t]; g.sel = { type: "e", k };
      dim(new Set([e.s, e.t]), new Set([k]));
      const card = $("#g-card"); card.hidden = false;
      card.innerHTML = `<div class="cardhead"><b>${esc(a.fa || a.id)} ${tr("و", "&amp;")} ${esc(b.fa || b.id)}</b><button class="btn icon ghost" data-x aria-label="${tr("بستن", "Close")}">${ICON.close}</button></div>
        <div class="small muted">${tr(`${fa(e.w)} پاراگراف مشترک`, `${fa(e.w)} shared paragraphs`)} ${g.scope === "upto" ? tr(`تا صفحه‌ی ${fa(S.page)}`, `up to page ${fa(S.page)}`) : ""}</div>
        ${e.label ? `<div class="lab"><b>${esc(e.label)}</b><p class="small">${esc(e.summary || "")}</p><span class="small muted">${tr(`بر اساس متن تا صفحه‌ی ${fa(e.label_upto)}`, `Based on the text up to page ${fa(e.label_upto)}`)}</span></div>` : ""}
        <button class="btn sm ${e.label ? "ghost" : ""}" data-ex="${k}">${e.label ? tr("توضیح دوباره با متن تا این صفحه", "Re-explain with text up to this page") : tr("توضیح این رابطه با مدل", "Explain this relationship with the model")}</button>`;
      bindCard(card);
    }
    function bindCard(card, n) {
      $("[data-x]", card).onclick = () => { card.hidden = true; g.sel = null; dim(null, null); };
      if (n) {
        $("[data-first]", card).onclick = async () => { const r = await api(`/api/books/${bookId}/find?q=${encodeURIComponent(n.id)}`); closeOverlay(); setHighlight(r, n.fa, 0); };
        $("[data-all]", card).onclick = async () => { const r = await api(`/api/books/${bookId}/find?q=${encodeURIComponent(n.id)}`); closeOverlay(); setHighlight(r, n.fa, Math.max(0, r.pages.findIndex(p => p.page >= S.page))); };
      }
      $$("[data-n]", card).forEach(b => b.onclick = () => selectNode(+b.dataset.n));
      $$("[data-ex]", card).forEach(b => b.onclick = async () => {
        b.disabled = true; b.textContent = tr("در حال بررسی…", "Checking…");
        try { await explain(+b.dataset.ex); } catch (e) { toast(e.message, true); b.disabled = false; b.textContent = tr("توضیح رابطه", "Explain relationship"); return; }
        g.sel?.type === "n" ? selectNode(g.sel.i) : selectEdge(+b.dataset.ex);
      });
    }
    async function explain(k) {
      const e = g.edges[k];
      const r = await api(`/api/books/${bookId}/graph/explain`, { method: "POST", body: { a: e.a, b: e.b, upto: g.scope === "upto" ? S.page : book.pages } });
      e.label = r.label; e.summary = r.summary; e.label_upto = r.upto; draw();
    }
    async function explainTop() {
      if (!g.edges) return;
      const todo = g.edges.map((e, k) => ({ e, k })).filter(x => !x.e.label).sort((a, b) => b.e.w - a.e.w).slice(0, 8);
      if (!todo.length) return toast(tr("رابطه‌های اصلی قبلاً توضیح داده شده‌اند", "The main relationships are already explained"));
      const btn = $("#g-explain"); btn.disabled = true;
      let n = 0;
      for (const { k } of todo) {
        if (S.overlay !== "graph") return;
        btn.textContent = tr(`در حال توضیح ${fa(++n)} از ${fa(todo.length)}…`, `Explaining ${fa(++n)} of ${fa(todo.length)}…`);
        try { await explain(k); } catch (e) { toast(e.message, true); break; }
      }
      btn.disabled = false; btn.textContent = tr("توضیح رابطه‌های اصلی با مدل", "Explain main relationships with the model");
    }
    return { open, refresh, stop };
  })();

  const Mind = (() => {
    let m = { scope: LS.get("mmScope", "page"), info: null, collapsed: new Set(), pz: null, busy: false };
    const COLORS = ["#2159A0", "#2D7A57", "#6A4BA6", "#C0841A", "#B23A5B", "#1F8A8A", "#8A5A2B"];
    function open() {
      ov.innerHTML = ovHead(tr("نقشه‌ی ذهنی", "Mind map"), `
        <div class="seg" id="m-scope"><button data-v="page">${tr("این صفحه", "This page")}</button><button data-v="chapter">${tr("این فصل", "This chapter")}</button><button data-v="recent">${tr("۱۰ صفحه‌ی اخیر", "Last 10 pages")}</button></div>
        <span class="small muted" id="m-info"></span>
        <button class="btn sm" id="m-build" hidden>${tr("ساختن دوباره", "Rebuild")}</button><button class="btn sm ghost" id="m-copy" hidden>${tr("کپی به‌صورت Markdown", "Copy as Markdown")}</button>`) +
        `<div class="ov-body" id="m-view"><div class="ov-stage" id="m-stage"></div></div>`;
      $("[data-close]", ov).onclick = closeOverlay;
      $("[data-fit]", ov).onclick = fit;
      $$("#m-scope button").forEach(b => b.onclick = () => { m.scope = b.dataset.v; LS.set("mmScope", m.scope); load(); });
      $("#m-build").onclick = build;
      $("#m-copy").onclick = async () => { try { await navigator.clipboard.writeText(toMd(m.info.map.tree)); toast(tr("کپی شد؛ در Obsidian یا XMind می‌توانی بچسبانی", "Copied; paste it into Obsidian or XMind")); } catch { toast(tr("کپی نشد", "Couldn't copy"), true); } };
      m.pz = panZoom($("#m-view"), $("#m-stage"));
      load();
    }
    function refresh() { if (!m.busy) load(); }
    async function load() {
      $$("#m-scope button").forEach(b => b.classList.toggle("on", b.dataset.v === m.scope));
      let info;
      try { info = await api(`/api/books/${bookId}/mindmap?scope=${m.scope}&page=${S.page}`); }
      catch (e) { $("#m-stage").innerHTML = ""; $("#m-info").textContent = ""; showCta(e.message); return; }
      if (S.overlay !== "mind") return;
      m.info = info; m.collapsed = new Set();
      info.label = trS(info.label).replace(/\d+/g, d => fa(+d));
      $("#m-info").textContent = `${info.label}${info.start !== info.end ? tr(` (ص ${fa(info.start)} تا ${fa(info.end)})`, ` (pp. ${fa(info.start)}–${fa(info.end)})`) : ""}`;
      $("#m-build").hidden = !info.map; $("#m-copy").hidden = !info.map;
      if (info.map) renderTree(); else showCta();
    }
    function showCta(err) {
      const who = task.mindmap?.model ? task.mindmap : task.translate_para;
      const info = m.info;
      $("#m-stage").innerHTML = "";
      const view = $("#m-view");
      $(".ov-cta", view)?.remove();
      view.insertAdjacentHTML("beforeend", `<div class="ov-cta">${err ? `<div class="error-box">${esc(err)}</div>` : `
        <b>${tr(`برای ${esc(info.label)} هنوز نقشه‌ی ذهنی ساخته نشده`, `No mind map yet for ${esc(info.label)}`)}</b>
        <span class="small">${tr(`${fa(info.chars)} کاراکتر متن`, `${fa(info.chars)} characters of text`)} · ${providerPill(who.provider, who.model)}</span>
        ${info.chars > (who.provider === "openai" ? 40000 : who.provider === "cli2api" ? 18000 : 3000) ? `<span class="small muted">${tr(`متن طولانی است؛ اول خلاصه‌ی هر بخش گرفته می‌شود و بعد نقشه ساخته می‌شود. با Ollama ممکن است چند دقیقه طول بکشد.`, `The text is long: each section is summarized first, then the map is built. With Ollama this can take a few minutes.`)}</span>` : ""}
        <button class="btn go" id="m-go">${ICON.mind} ${tr("ساختن نقشه‌ی ذهنی", "Build mind map")}</button>`}</div>`);
      if ($("#m-go")) $("#m-go").onclick = build;
    }
    async function build() {
      if (m.busy) return;
      m.busy = true;
      $(".ov-cta", $("#m-view"))?.remove();
      $("#m-stage").innerHTML = "";
      $("#m-view").insertAdjacentHTML("beforeend", `<div class="ov-cta"><span class="pill busy">${tr(`در حال ساختن نقشه‌ی ذهنی…`, `Building mind map…`)}</span></div>`);
      const scopeAt = m.scope, pageAt = S.page;
      try {
        const r = await api(`/api/books/${bookId}/mindmap?scope=${scopeAt}&page=${pageAt}`, { method: "POST" });
        m.busy = false;
        if (S.overlay !== "mind") return;
        $(".ov-cta", $("#m-view"))?.remove();
        m.info = { ...m.info, map: r.map }; m.collapsed = new Set();
        $("#m-build").hidden = false; $("#m-copy").hidden = false;
        renderTree(); refreshUsage();
      } catch (e) {
        m.busy = false;
        $(".ov-cta", $("#m-view"))?.remove(); showCta(e.message);
      }
    }
    function renderTree() {
      $(".ov-cta", $("#m-view"))?.remove();
      const tree = m.info.map.tree, stage = $("#m-stage");
      let uid = 0;
      const flat = [];
      (function walk(n, depth, color, parent) {
        const id = uid++; const node = { id, n, depth, color, parent, kids: [] };
        flat.push(node); if (parent) parent.kids.push(node);
        if (!m.collapsed.has(id)) (n.children || []).forEach((c, i) => walk(c, depth + 1, depth === 0 ? COLORS[i % COLORS.length] : color, node));
        else { uid += countAll(n) - 1; }
      })(tree, 0, "var(--ink)", null);
      stage.innerHTML = `<svg class="mm-lines" overflow="visible" width="1" height="1"></svg>` + flat.map(f =>
        `<div class="mm-node d${Math.min(f.depth, 3)}" data-id="${f.id}" style="--c:${f.color}" tabindex="0">${esc(f.n.title)}${(f.n.children || []).length && m.collapsed.has(f.id) ? `<span class="mm-more">+${fa(countAll(f.n) - 1)}</span>` : ""}</div>`).join("");
      const els = new Map($$(".mm-node", stage).map(el => [+el.dataset.id, el]));
      flat.forEach(f => { const el = els.get(f.id); f.w = el.offsetWidth; f.h = el.offsetHeight; });
      const GAPY = 14, GAPX = 70;
      const colW = []; flat.forEach(f => colW[f.depth] = Math.max(colW[f.depth] || 0, f.w));
      const colX = [0]; for (let d = 1; d < colW.length; d++) colX[d] = colX[d - 1] - GAPX - colW[d];   // RTL: children to the left
      const size = f => { f.sh = f.kids.length ? Math.max(f.h, f.kids.reduce((s, k) => s + size(k), 0) + GAPY * (f.kids.length - 1)) : f.h; return f.sh; };
      const root = flat[0]; size(root);
      (function place(f, top) {
        f.y = top + f.sh / 2 - f.h / 2;
        f.x = f.depth === 0 ? 0 : colX[f.depth] + (colW[f.depth] - f.w);   // right-align each column toward its parent
        let t = top + (f.sh - (f.kids.reduce((s, k) => s + k.sh, 0) + GAPY * Math.max(0, f.kids.length - 1))) / 2;
        f.kids.forEach(k => { place(k, t); t += k.sh + GAPY; });
      })(root, 0);
      flat.forEach(f => { const el = els.get(f.id); el.style.left = f.x + "px"; el.style.top = f.y + "px"; });
      $(".mm-lines", stage).innerHTML = flat.filter(f => f.parent).map(f => {
        const p = f.parent, x1 = p.x, y1 = p.y + p.h / 2, x2 = f.x + f.w, y2 = f.y + f.h / 2, mx = (x1 + x2) / 2;
        return `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" style="stroke:${f.color}"/>`;
      }).join("");
      els.forEach((el, id) => {
        const f = flat.find(x => x.id === id);
        if ((f.n.children || []).length && f.depth > 0) {
          el.classList.add("has-kids");
          el.onclick = () => { m.collapsed.has(id) ? m.collapsed.delete(id) : m.collapsed.add(id); m.keepView = true; renderTree(); m.keepView = false; };
          el.onkeydown = e => { if (e.key === "Enter") el.click(); };
        }
      });
      const xs = flat.map(f => f.x), ys = flat.map(f => f.y);
      m.bb = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...flat.map(f => f.x + f.w)) - Math.min(...xs), h: Math.max(...flat.map(f => f.y + f.h)) - Math.min(...ys) };
      if (!m.keepView) fit();
    }
    function countAll(n) { return 1 + (n.children || []).reduce((s, c) => s + countAll(c), 0); }
    function fit() { if (m.bb) m.pz.fit(m.bb); }
    function toMd(n, d = 0) { return `${"  ".repeat(Math.max(0, d - 1))}${d === 0 ? "# " : "- "}${n.title}\n` + (n.children || []).map(c => toMd(c, d + 1)).join(""); }
    return { open, refresh };
  })();

  /* --- word lookup on selection inside original text */
  canvas.addEventListener("mouseup", () => setTimeout(() => {
    const sel = window.getSelection(); const txt = sel.toString().trim();
    if (!txt || txt.length > 60 || !/[A-Za-z]/.test(txt)) return;
    const node = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    const src = node && node.closest(".src"); if (!src) return;
    const full = src.textContent;
    const sentence = (full.match(/[^.!?]*[.!?]+["”’)]*|[^.!?]+$/g) || [full]).find(s => s.includes(txt)) || full;
    lookupPopover(txt, sentence.trim(), sel.getRangeAt(0).getBoundingClientRect(), { bookId, page: S.page, after: () => { if (S.tab === "words") renderTab(); },
      find: async w => { const r = await api(`/api/books/${bookId}/find?q=${encodeURIComponent(w)}`); if (!r.pages.length) return toast(tr("جای دیگری پیدا نشد", "Not found anywhere else")); setHighlight(r, "", r.pages.findIndex(x => x.page >= S.page)); } });
  }, 10));


  /* --- "who was this?" cards: names from the glossary become hoverable in the text */
  const ENT = { list: [], en: null, fa: null, byEn: new Map(), byFa: new Map() };
  async function loadEntities() {
    try {
      const g = await api(`/api/books/${bookId}/glossary`);
      ENT.list = g.items; ENT.byEn = new Map(); ENT.byFa = new Map();
      const en = [], faT = [];
      g.items.forEach((t, i) => {
        const e = esc(t.term); ENT.byEn.set(e, i); en.push(e);
        if (t.fa && t.fa.length > 1) { const f = esc(t.fa); ENT.byFa.set(f, i); faT.push(f); }
      });
      const alt = arr => arr.sort((a, b) => b.length - a.length).map(reEsc).join("|");
      ENT.en = en.length ? new RegExp(`(?<![A-Za-z])(${alt(en)})(?![A-Za-z])`, "g") : null;
      ENT.fa = faT.length ? new RegExp(`(?<![\\u0600-\\u06FF\\u200c])(${alt(faT)})`, "g") : null;
    } catch {}
  }
  const entEn = html => ENT.en ? html.replace(ENT.en, m => `<span class="ent" data-e="${ENT.byEn.get(m)}">${m}</span>`) : html;
  const entFa = html => ENT.fa ? html.replace(ENT.fa, m => `<span class="ent" data-e="${ENT.byFa.get(m)}">${m}</span>`) : html;
  const KIND_FA = { person: KIND.person[0], place: KIND.place[0], org: KIND.org[0], concept: KIND.concept[0], other: "" };

  async function whoCard(i, el) {
    const t = ENT.list[i]; if (!t) return;
    const pop = $("#popover");
    pop.className = "popover whocard"; pop.hidden = false; pop.dataset.e = i;
    pop.innerHTML = `<div class="w"><span>${esc(t.fa || t.term)}</span><small>${esc(KIND_FA[t.kind] || "")}</small></div><span class="small muted">${tr(`در حال خواندن…`, `Reading…`)}</span>`;
    placePopover(pop, el.getBoundingClientRect());
    let d;
    try { d = await api(`/api/books/${bookId}/who?term=${encodeURIComponent(t.term)}&upto=${S.page}`); }
    catch (e) { pop.innerHTML = `<div class="small" style="color:var(--danger)">${esc(e.message)}</div>`; return; }
    if (pop.hidden || pop.dataset.e !== String(i)) return;
    const pat = new RegExp(`(?<![A-Za-z])(${reEsc(esc(d.term))})(?![A-Za-z])`, "gi");
    const snip = s => `<div class="wsnip"><button class="linkbtn" data-go="${s.page}">${tr("ص", "p.")} ${fa(s.page)}</button> <span dir="ltr">${esc(s.text).replace(pat, "<mark>$1</mark>")}</span></div>`;
    pop.innerHTML = `<div class="w"><span>${esc(d.fa || d.term)}</span><small class="en" dir="ltr">${esc(d.term)}</small></div>
      <div class="small muted">${KIND_FA[d.kind] ? `<span class="kdot" style="background:${KIND[d.kind]?.[1]}"></span>${KIND_FA[d.kind]} · ` : ""}${d.count ? tr(`${fa(d.count)} بار در ${fa(d.pages)} صفحه تا این‌جا`, `${fa(d.count)}× on ${fa(d.pages)} pages so far`) : tr("تا این صفحه هنوز نیامده", "Not mentioned yet up to this page")}</div>
      ${d.first ? `<h4>${tr("اولین بار", "First mention")}</h4>${snip(d.first)}` : ""}
      ${d.last ? `<h4>${tr(`آخرین بار پیش از این`, `Most recent mention before this`)}</h4>${snip(d.last)}` : ""}
      ${d.links.length ? `<h4>${tr(`بیشتر با این‌ها آمده`, `Most often appears with`)}</h4><div class="wlinks">${d.links.map(l => `<span class="wl" title="${esc(l.summary || "")}"><b>${esc(l.fa || l.term)}</b>${l.label ? ` <span class="small">· ${esc(l.label)}</span>` : ` <span class="small muted">${fa(l.w)}</span>`}</span>`).join("")}</div>` : ""}
      <div class="foot"><span class="small muted">${tr(`بدون درخواست به مدل`, `No model request`)}</span><span style="display:flex;gap:6px">
        <button class="btn sm ghost" data-graph>${tr("در گراف", "In graph")}</button><button class="btn sm" data-all>${tr("همه‌ی صفحه‌ها", "All pages")}</button></span></div>`;
    placePopover(pop, el.getBoundingClientRect());
    $$("[data-go]", pop).forEach(b => b.onclick = () => { hidePopover(); setHighlight({ term: d.term, pages: [+b.dataset.go] }, d.fa, 0); });
    $("[data-all]", pop).onclick = async () => { hidePopover(); const r = await api(`/api/books/${bookId}/find?q=${encodeURIComponent(d.term)}`); setHighlight(r, d.fa, Math.max(0, r.pages.findIndex(p => p.page >= S.page))); };
    $("[data-graph]", pop).onclick = () => { hidePopover(); if (S.overlay !== "graph") openOverlay("graph"); };
  }
  let hoverT = null;
  const canHover = matchMedia("(hover: hover)").matches;
  canvas.addEventListener("click", e => {
    const el = e.target.closest(".ent"); if (!el || window.getSelection().toString().trim()) return;
    e.stopPropagation(); clearTimeout(hoverT); whoCard(+el.dataset.e, el);
  }, true);
  if (canHover) {
    canvas.addEventListener("mouseover", e => {
      const el = e.target.closest(".ent"); if (!el) return;
      clearTimeout(hoverT); hoverT = setTimeout(() => whoCard(+el.dataset.e, el), 550);
    });
    let hideT = null;
    const pop = $("#popover");
    const later = () => { clearTimeout(hideT); hideT = setTimeout(() => { if (pop.classList.contains("whocard") && !pop.matches(":hover")) hidePopover(); }, 450); };
    canvas.addEventListener("mouseout", e => { if (e.target.closest(".ent")) { clearTimeout(hoverT); later(); } });
    pop.addEventListener("mouseleave", () => { if (pop.classList.contains("whocard")) later(); });
    pop.addEventListener("mouseenter", () => clearTimeout(hideT));
  }

  /* --- chapters (same rule as the server: top two TOC levels) */
  function chapterOf(page) {
    const toc = book.toc || []; if (!toc.length) return null;
    const top = Math.min(...toc.map(t => t[0]));
    const heads = toc.filter(t => t[0] <= top + 1);
    let cur = -1; heads.forEach((t, i) => { if (t[2] <= page) cur = i; });
    if (cur < 0) return null;
    return { start: heads[cur][2], end: cur + 1 < heads.length ? Math.max(heads[cur][2], heads[cur + 1][2] - 1) : book.pages, title: heads[cur][1] };
  }
  function chapterEndCard() {
    const ch = chapterOf(S.page);
    if (!ch || ch.end !== S.page) return "";
    return `<div class="chend"><div><span class="eyebrow-s">${tr(`پایان فصل`, `End of chapter`)}</span><b dir="auto">${esc(ch.title)}</b>
      <span class="small muted">${tr(`چند سؤال کوتاه کمک می‌کند چیزهای مهم این فصل در ذهنت بماند.`, `A few short questions help the key points of this chapter stick.`)}</span></div>
      <span class="row-acts"><button class="btn ghost" data-post>${ICON.post} ${tr("پست آموزشی", "Teaching post")}</button><button class="btn go" data-quiz>${ICON.check} ${tr("مرور این فصل", "Review this chapter")}</button></span></div>`;
  }
  canvas.addEventListener("click", e => { if (e.target.closest("[data-quiz]")) openOverlay("quiz"); if (e.target.closest("[data-post]")) openOverlay("post"); });

  /* --- welcome back + recap */
  const wel = $("#welcome");
  function ago(iso) {
    const h = (Date.now() - new Date(iso)) / 36e5;
    if (h < 24) return tr(`${fa(Math.round(h))} ساعت پیش`, `${fa(Math.round(h))} hours ago`);
    const d = Math.round(h / 24); return d < 30 ? tr(`${fa(d)} روز پیش`, `${fa(d)} days ago`) : tr(`${fa(Math.round(d / 30))} ماه پیش`, `${fa(Math.round(d / 30))} months ago`);
  }
  async function showWelcome() {
    const r = await api(`/api/books/${bookId}/recap?page=${book.last_page}`);
    const ch = chapterOf(book.last_page);
    wel.hidden = false;
    wel.innerHTML = `<div class="wel-head"><div><span class="eyebrow-s">${tr(`خوش برگشتی`, `Welcome back`)}</span>
        <b>${tr(`آخرین بار ${ago(book.opened)} تا صفحه‌ی ${fa(book.last_page)} خواندی`, `Last time, ${ago(book.opened)}, you read up to page ${fa(book.last_page)}`)}${ch ? ` · <span dir="auto">${esc(ch.title)}</span>` : ""}</b></div>
        <button class="btn icon ghost" data-x aria-label="${tr("بستن", "Close")}">${ICON.close}</button></div>
      <div id="wel-body">${recapBody(r)}</div>`;
    $("[data-x]", wel).onclick = () => { wel.hidden = true; };
    bindRecap(wel, r, book.last_page);
  }
  function recapBody(r) {
    const who = task.recap?.model ? task.recap : task.translate_para;
    return r.recap ? `<h4>${tr("قبلاً در این کتاب…", "Previously in this book…")} <span class="small muted">(${tr(`ص ${fa(r.start)} تا ${fa(r.end)}`, `pp. ${fa(r.start)}–${fa(r.end)}`)})</span></h4><p class="recap-text">${esc(r.recap.text)}</p>
        <div class="row-acts"><button class="btn sm ghost" data-recap>${tr("نوشتن دوباره", "Rewrite")}</button></div>`
      : `<p class="small muted">${tr(`می‌خواهی خلاصه‌ای از ${fa(r.end - r.start + 1)} صفحه‌ی آخر (ص ${fa(r.start)} تا ${fa(r.end)}، ${fa(r.chars)} کاراکتر) را ببینی؟`, `Want a recap of the last ${fa(r.end - r.start + 1)} pages (pp. ${fa(r.start)}–${fa(r.end)}, ${fa(r.chars)} characters)?`)}</p>
        <div class="row-acts"><button class="btn go" data-recap>${ICON.play} ${tr("«قبلاً در این کتاب…»", "“Previously in this book…”")}</button><span class="small">${providerPill(who.provider, who.model)}</span></div>`;
  }
  function bindRecap(root, r, page) {
    const b = $("[data-recap]", root); if (!b) return;
    b.onclick = async () => {
      const box = $("#wel-body", root) || root.querySelector(".recap-box");
      box.innerHTML = `<h4>${tr("قبلاً در این کتاب…", "Previously in this book…")}</h4><p class="recap-text"><span class="caret"></span></p>`;
      const out = $(".recap-text", box);
      try {
        await streamPost(`/api/books/${bookId}/recap?page=${page}`, null, t => { out.innerHTML = esc(t) + '<span class="caret"></span>'; });
        const r2 = await api(`/api/books/${bookId}/recap?page=${page}`);
        box.innerHTML = recapBody(r2); bindRecap(root, r2, page); refreshUsage();
      } catch (e) { box.innerHTML = `<div class="error-box">${esc(e.message)}</div>`; }
    };
  }

  /* --- review tab */
  async function renderReviewTab(pane) {
    const pageAt = S.page;
    const [r, q, u] = await Promise.all([
      api(`/api/books/${bookId}/recap?page=${pageAt}`),
      api(`/api/books/${bookId}/quiz?page=${pageAt}&scope=chapter`),
      api("/api/usage").catch(() => null),
    ]);
    if (S.tab !== "review" || pageAt !== S.page) return;
    q.label = trS(q.label).replace(/\d+/g, d => fa(+d));
    const usageHtml = u ? `<hr class="sep"><h4>${tr("مصرف این ماه", "Usage this month")}</h4>
      <div class="wordlist">${(u.rows || []).map(x => `<div><span>${providerPill(x.provider, x.model)}</span><span class="small muted">${tr(`${fa(x.calls)} درخواست`, `${fa(x.calls)} requests`)}</span></div>`).join("") || `<p class="small muted">${tr(`هنوز درخواستی ثبت نشده.`, `No requests yet.`)}</p>`}</div>` : "";
    pane.innerHTML = `<div class="recap-box">${recapBody(r)}</div>
      <hr class="sep">
      <h4>${tr("سؤال‌های مرور", "Review questions")} <span class="small muted" dir="auto">${esc(q.label)}</span></h4>
      <p class="small muted">${q.quiz ? tr(`${fa(q.quiz.questions.length)} سؤال آماده است.`, `${fa(q.quiz.questions.length)} questions ready.`) : tr(`از ص ${fa(q.start)} تا ${fa(q.end)} (${fa(q.chars)} کاراکتر)؛ سؤال‌ها یک بار ساخته و ذخیره می‌شوند.`, `pp. ${fa(q.start)}–${fa(q.end)} (${fa(q.chars)} characters); questions are generated once and saved.`)}</p>
      <button class="btn ${q.quiz ? "" : "go"}" id="rv-quiz">${ICON.check} ${q.quiz ? tr("باز کردن سؤال‌ها", "Open questions") : tr("ساختن سؤال‌های این فصل", "Generate questions for this chapter")}</button>
      <hr class="sep">
      <h4>${tr(`خواندن آفلاین روی گوشی`, `Offline reading on your phone`)}</h4>
      <p class="small muted">${tr(`این فصل یا کل کتاب را به یک فایل HTML تبدیل کن که بدون اینترنت باز می‌شود.`, `Export this chapter or the whole book as an HTML file that opens without internet.`)}</p>
      <div class="row-acts"><a class="btn sm" href="/api/books/${bookId}/export?page=${pageAt}&scope=chapter">${tr(`دانلود این فصل`, `Download this chapter`)}</a><a class="btn sm ghost" href="/api/books/${bookId}/export?scope=book">${tr("کل کتاب", "Whole book")}</a></div>${usageHtml}`;
    bindRecap(pane, r, pageAt);
    $("#rv-quiz").onclick = () => openOverlay("quiz");
  }

  /* --- chapter questions overlay */
  const Quiz = (() => {
    let st = null;
    async function open() {
      ov.innerHTML = ovHead(tr("مرور فصل", "Chapter review"), `<span class="small muted" id="q-info"></span>`).replace(/<button class="btn icon ghost" data-fit[^>]*>.*?<\/button>/, "") +
        `<div class="ov-scroll" id="q-body"><div class="ov-cta" style="position:static;min-height:40vh"><span class="pill busy">${tr(`در حال آماده کردن…`, `Preparing…`)}</span></div></div>`;
      $("[data-close]", ov).onclick = closeOverlay;
      const pageAt = S.page;
      let info = await api(`/api/books/${bookId}/quiz?page=${pageAt}&scope=chapter`);
      info.label = trS(info.label).replace(/\d+/g, d => fa(+d));
      $("#q-info").innerHTML = `<span dir="auto">${esc(info.label)}</span> · ${tr(`ص ${fa(info.start)} تا ${fa(info.end)}`, `pp. ${fa(info.start)}–${fa(info.end)}`)}`;
      if (!info.quiz) {
        const who = task.quiz?.model ? task.quiz : task.translate_para;
        $("#q-body").innerHTML = `<div class="ov-cta" style="position:static;min-height:50vh"><b>${tr(`سؤال‌های این فصل هنوز ساخته نشده`, `No questions for this chapter yet`)}</b>
          <span class="small">${tr(`${fa(info.chars)} کاراکتر متن`, `${fa(info.chars)} characters of text`)} · ${providerPill(who.provider, who.model)}</span>
          ${info.chars > (who.provider === "openai" ? 40000 : who.provider === "cli2api" ? 18000 : 3000) ? `<span class="small muted">${tr(`فصل طولانی است؛ اول هر بخش خلاصه می‌شود. با Ollama ممکن است چند دقیقه طول بکشد.`, `The chapter is long, so each section is summarized first. With Ollama this can take a few minutes.`)}</span>` : ""}
          <button class="btn go" id="q-go">${ICON.check} ${tr("ساختن سؤال‌ها", "Generate questions")}</button></div>`;
        $("#q-go").onclick = async () => {
          $("#q-body").innerHTML = `<div class="ov-cta" style="position:static;min-height:50vh"><span class="pill busy">${tr(`در حال نوشتن سؤال‌ها…`, `Writing questions…`)}</span></div>`;
          try { info = await api(`/api/books/${bookId}/quiz?page=${pageAt}&scope=chapter`, { method: "POST" }); info.label = trS(info.label).replace(/\d+/g, d => fa(+d)); refreshUsage(); }
          catch (e) { $("#q-body").innerHTML = `<div class="error-box" style="margin:20px">${esc(e.message)}</div>`; return; }
          if (S.overlay === "quiz") show(info);
        };
        return;
      }
      show(info);
    }
    function show(info) {
      st = { info, done: new Set() };
      const qz = info.quiz;
      $("#q-body").innerHTML = `<div class="quiz">
        ${qz.summary ? `<div class="qsum"><span class="eyebrow-s">${tr(`خلاصه‌ی فصل`, `Chapter summary`)}</span><p>${esc(qz.summary)}</p></div>` : ""}
        <div class="qprog" id="q-prog"></div>
        ${qz.questions.map((q, i) => `<div class="qcard" data-i="${i}">
          <div class="qhead"><span class="qn">${fa(i + 1)}</span><span class="pill ${q.type === "reflect" ? "openai" : ""}">${q.type === "reflect" ? tr("فکر کن", "Reflect") : tr("یادآوری", "Recall")}</span></div>
          <p class="qq">${esc(q.q)}</p>
          <textarea rows="2" placeholder="${q.type === "reflect" ? tr("نظر خودت را بنویس…", "Write your own view…") : tr("اول از حافظه جواب بده…", "Answer from memory first…")}" aria-label="${tr(`جواب سؤال ${fa(i + 1)}`, `Answer to question ${fa(i + 1)}`)}"></textarea>
          <div class="qacts"><button class="btn sm" data-show>${tr("نمایش جواب", "Show answer")}</button><button class="btn sm ghost" data-check title="${tr("با مدل؛ هزینه‌ی کمی دارد", "Uses the model; small cost")}">${tr("بررسی جواب من", "Check my answer")}</button>
            <button class="btn sm ghost" data-card>${tr("افزودن به کارت‌ها", "Add to cards")}</button></div>
          <div class="qfb" hidden></div>
          <div class="qans" hidden><b>${q.type === "reflect" ? tr("نکته‌هایی برای فکر کردن", "Points to consider") : tr("جواب", "Answer")}</b><p>${esc(q.a)}</p>${q.page ? `<button class="linkbtn" data-page="${q.page}">${tr(`رفتن به صفحه‌ی ${fa(q.page)}`, `Go to page ${fa(q.page)}`)}</button>` : ""}</div>
        </div>`).join("")}
        <div class="qfoot"><span class="small muted">${tr(`سؤال‌ها ذخیره شده‌اند؛ دفعه‌ی بعد بدون هزینه باز می‌شوند.`, `Questions are saved; next time they open at no cost.`)}</span><button class="btn sm ghost" id="q-redo">${tr(`ساختن سؤال‌های تازه`, `Generate new questions`)}</button></div></div>`;
      prog();
      $$(".qcard", ov).forEach(card => {
        const i = +card.dataset.i, q = qz.questions[i];
        $("[data-show]", card).onclick = () => { $(".qans", card).hidden = false; st.done.add(i); prog(); };
        $("[data-check]", card).onclick = async e => {
          const ans = $("textarea", card).value.trim();
          if (!ans) return toast(tr("اول جوابت را بنویس", "Write your answer first"), true);
          const b = e.currentTarget; b.disabled = true; b.textContent = tr("در حال بررسی…", "Checking…");
          try {
            const f = await api(`/api/books/${bookId}/quiz/feedback`, { method: "POST", body: { start: info.start, end: info.end, idx: i, answer: ans } });
            const V = { correct: [tr("درست", "Correct"), "ok"], partial: [tr("تقریباً", "Almost"), "mid"], wrong: [tr("نه دقیقاً", "Not quite"), "no"] }[f.verdict];
            const fb = $(".qfb", card); fb.hidden = false;
            fb.innerHTML = `${q.type === "reflect" ? "" : `<span class="verdict ${V[1]}">${V[0]}</span> `}${esc(f.feedback)}`;
            $(".qans", card).hidden = false; st.done.add(i); prog(); refreshUsage();
          } catch (err) { toast(err.message, true); }
          b.disabled = false; b.textContent = tr("بررسی جواب من", "Check my answer");
        };
        $("[data-card]", card).onclick = async () => {
          const r = await api("/api/cards", { method: "POST", body: { book_id: bookId, page: q.page || info.start, front: q.q, back: q.a, context: info.label } });
          toast(r.duplicate ? tr("این سؤال قبلاً کارت شده", "This question is already a card") : tr("به کارت‌ها اضافه شد", "Added to cards")); refreshDue();
        };
        const pg = $("[data-page]", card); if (pg) pg.onclick = () => { closeOverlay(); go(+pg.dataset.page); };
      });
      $("#q-redo").onclick = async e => {
        const b = e.currentTarget;
        if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = tr("دوباره به مدل فرستاده می‌شود. مطمئنی؟", "This will be sent to the model again. Sure?"); return; }
        $("#q-body").innerHTML = `<div class="ov-cta" style="position:static;min-height:50vh"><span class="pill busy">${tr(`در حال نوشتن سؤال‌ها…`, `Writing questions…`)}</span></div>`;
        try { const n = await api(`/api/books/${bookId}/quiz?page=${info.end}&scope=chapter`, { method: "POST" }); n.label = trS(n.label).replace(/\d+/g, d => fa(+d)); show(n); refreshUsage(); }
        catch (err) { $("#q-body").innerHTML = `<div class="error-box" style="margin:20px">${esc(err.message)}</div>`; }
      };
    }
    function prog() {
      const n = st.info.quiz.questions.length, d = st.done.size;
      $("#q-prog").innerHTML = `<div class="track"><i style="width:${d / n * 100}%"></i></div><span class="small muted">${tr(`${fa(d)} از ${fa(n)} سؤال`, `${fa(d)} of ${fa(n)} questions`)}</span>`;
    }
    return { open, refresh() {} };
  })();

  /* --- emotion tags & simple explanations */
  const TAG_FA = { wow: tr("شگفت‌زده‌ام کرد", "Surprised me"), unclear: tr("برایم مبهم بود", "Unclear to me"), love: tr("دوستش داشتم", "Loved it") };
  function rxHtml(p) {
    if (p.kind === "raw") return "";
    const on = t => (p.tags || []).includes(t) ? "on" : "";
    return `<div class="rx" role="group" aria-label="${tr("واکنش به این پاراگراف", "React to this paragraph")}">
      <button class="rxb wow ${on("wow")}" data-tag="wow" title="${TAG_FA.wow}" aria-label="${TAG_FA.wow}">${ICON.wow}</button>
      <button class="rxb unclear ${on("unclear")}" data-tag="unclear" title="${TAG_FA.unclear}" aria-label="${TAG_FA.unclear}">${ICON.unclear}</button>
      <button class="rxb love ${on("love")}" data-tag="love" title="${TAG_FA.love}" aria-label="${TAG_FA.love}">${ICON.love}</button>
      <button class="rxb pin" data-pin title="${tr("گذاشتن در قصر حافظه", "Place in memory palace")}" aria-label="${tr("گذاشتن در قصر حافظه", "Place in memory palace")}">${ICON.pin}</button></div>`;
  }
  function explainHtml(p) {
    if (EXPL[p.id]) return `<div class="explain"><b>${tr("به زبان ساده", "In plain words")}</b><p>${esc(EXPL[p.id])}<span class="caret"></span></p></div>`;
    if (p.explain) return `<div class="explain"><b>${tr("به زبان ساده", "In plain words")}</b><p>${esc(p.explain)}</p><button class="btn sm ghost" data-a="explain">${tr("توضیح دوباره", "Explain again")}</button></div>`;
    if ((p.tags || []).includes("unclear")) return `<div class="explain ask"><span class="small">${tr(`این پاراگراف را مبهم علامت زدی.`, `You marked this paragraph as unclear.`)}</span><button class="btn sm" data-a="explain">${tr("توضیح به زبان ساده", "Explain in plain words")}</button></div>`;
    return "";
  }
  const EXPL = {};
  async function toggleTag(p, tag) {
    try {
      const r = await api(`/api/paragraphs/${p.id}/tag?tag=${tag}`, { method: "POST" });
      p.tags = r.tags; paintRow(p);
      if (r.on && tag === "unclear") toast(tr("علامت خورد؛ هر وقت خواستی «توضیح به زبان ساده» را بزن", "Marked. Press “Explain in plain words” whenever you like"));
      if (S.tab === "notebook") renderTab();
    } catch (e) { toast(e.message, true); }
  }
  async function explainPara(p) {
    EXPL[p.id] = ""; paintRow(p);
    try {
      const { text } = await streamPost(`/api/paragraphs/${p.id}/explain`, null, t => {
        EXPL[p.id] = t; const el = $(`.row[data-id="${p.id}"] .explain p`, canvas); if (el) el.innerHTML = esc(t) + '<span class="caret"></span>';
      });
      p.explain = text;
    } catch (e) { toast(e.message, true); }
    delete EXPL[p.id]; paintRow(p); refreshUsage();
  }

  /* --- put something in the memory palace */
  function pinForm(p, anchor) {
    const pop = $("#popover");
    pop.className = "popover pinform"; pop.hidden = false; delete pop.dataset.e;
    const shown = (p.better || p.base)?.text || "";
    pop.innerHTML = `<div class="w"><span>${tr("گذاشتن در قصر حافظه", "Place in memory palace")}</span></div>
      <label class="small muted" for="pin-idea">${tr(`چه چیزی را می‌خواهی به خاطر بسپاری؟ (کوتاه، با کلمه‌های خودت)`, `What do you want to remember? (short, in your own words)`)}</label>
      <textarea id="pin-idea" rows="3">${esc(shown.slice(0, 180))}</textarea>
      <label class="small muted" for="pin-cue">${tr(`یک تصویر ذهنی عجیب یا خنده‌دار برایش (اختیاری)`, `A strange or funny mental image for it (optional)`)}</label>
      <input id="pin-cue" type="text" placeholder="${tr(`مثلاً: یک جعبه سیب که روی صندلی گریه می‌کند`, `e.g. a crate of apples crying on a chair`)}">
      <div class="foot"><span class="small muted">${tr(`در اتاق همین فصل`, `In this chapter's room`)}</span><button class="btn sm primary" id="pin-save">${tr("گذاشتن", "Place")}</button></div>`;
    placePopover(pop, anchor.getBoundingClientRect());
    $("#pin-idea").focus();
    $("#pin-save").onclick = async () => {
      try {
        const r = await api(`/api/books/${bookId}/palace`, { method: "POST", body: { page: S.page, idea: $("#pin-idea").value, cue: $("#pin-cue").value } });
        hidePopover(); toast(tr(`در «${r.room}»، ${r.spot} گذاشته شد`, `Placed in the ${trS(r.room)}, ${trS(r.spot)}`));
      } catch (e) { toast(e.message, true); }
    };
  }
  canvas.addEventListener("click", e => {
    const b = e.target.closest(".rxb"); if (!b) return;
    e.stopPropagation();
    const row = b.closest(".row"); const p = data.paragraphs.find(x => x.id === +row.dataset.id); if (!p) return;
    if (b.dataset.pin !== undefined) pinForm(p, b); else toggleTag(p, b.dataset.tag);
  }, true);

  /* --- reading time & the end-of-session sentence */
  const sess = { start: Date.now(), active: 0, last: Date.now(), from: S.page, to: S.page, wrote: false };
  const bump = () => { sess.last = Date.now(); };
  ["scroll", "pointermove", "keydown", "touchstart", "click"].forEach(ev => canvas.addEventListener(ev, bump, { passive: true }));
  document.addEventListener("keydown", bump);
  const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const beat = setInterval(() => {
    if (document.visibilityState !== "visible" || Date.now() - sess.last > 90000) return;
    sess.active += 30; sess.to = Math.max(sess.to, S.page); sess.from = Math.min(sess.from, S.page);
    api("/api/log", { method: "POST", body: { book_id: bookId, page: S.page, seconds: 30, day: localDay() } }).catch(() => {});
  }, 30000);
  onLeave(() => {
    clearInterval(beat);
    document.removeEventListener("keydown", bump);
    if (sess.active >= 180 && !sess.wrote) setTimeout(() => journalPrompt({ bookId, title: book.title, from: sess.from, to: sess.to, minutes: Math.round(sess.active / 60) }), 300);
  });

  /* --- notebook tab: today's sentence, journal, tagged paragraphs */
  async function renderNotebookTab(pane) {
    const [j, t] = await Promise.all([api(`/api/journal?book_id=${bookId}`), api(`/api/books/${bookId}/tags`)]);
    if (S.tab !== "notebook") return;
    const groups = { love: [], wow: [], unclear: [] };
    t.items.forEach(x => groups[x.tag]?.push(x));
    pane.innerHTML = `<h4>${tr(`امروز چی فهمیدم؟`, `What did I learn today?`)}</h4>
      <textarea id="nb-text" rows="2" placeholder="${tr(`یک جمله با کلمه‌های خودت…`, `One sentence in your own words…`)}"></textarea>
      <button class="btn sm primary" id="nb-save">${tr("ثبت در دفترچه", "Save to journal")}</button>
      ${j.items.length ? `<div class="journal">${j.items.map(x => `<div class="jitem"><p>${esc(x.text)}</p>
        <span class="small muted">${new Date(x.created).toLocaleDateString(LOCALE, { day: "numeric", month: "long" })} · ${tr("ص", "p.")} ${fa(x.page_from)}${x.page_to > x.page_from ? `–${fa(x.page_to)}` : ""}</span></div>`).join("")}</div>` : ""}
      <hr class="sep">
      ${Object.entries(groups).map(([k, arr]) => `<h4><span class="tagdot ${k}"></span>${TAG_FA[k]} <span class="small muted">${fa(arr.length)}</span></h4>
        ${arr.length ? arr.slice(0, 30).map(x => `<button class="tagged" data-go="${x.page}" data-pid="${x.para_id}"><b>${tr("ص", "p.")} ${fa(x.page)}</b> <span>${esc((x.fa || x.text).slice(0, 110))}…</span>
          ${k === "unclear" ? `<span class="small ${x.explain ? "ok" : "muted"}">${x.explain ? tr("توضیح داده شده", "Explained") : tr("هنوز توضیح داده نشده", "Not explained yet")}</span>` : ""}</button>`).join("") : `<p class="small muted">${tr(`هنوز چیزی علامت نزده‌ای. روی پاراگراف‌ها دکمه‌های کوچک کنارشان را بزن.`, `Nothing tagged yet. Use the small buttons next to paragraphs.`)}</p>`}`).join("")}`;
    $("#nb-save").onclick = async () => {
      try { await api("/api/journal", { method: "POST", body: { book_id: bookId, text: $("#nb-text").value, page_from: sess.from, page_to: Math.max(sess.to, S.page), minutes: Math.round(sess.active / 60) } }); sess.wrote = true; toast(tr("در دفترچه ثبت شد", "Saved to journal")); renderTab(); }
      catch (e) { toast(e.message, true); }
    };
    $$(".tagged", pane).forEach(b => b.onclick = () => { FLASH = +b.dataset.pid; go(+b.dataset.go); if (+b.dataset.go === S.page) flashRow(); });
  }
  let FLASH = (() => { try { const v = sessionStorage.getItem("varagh.flash"); sessionStorage.removeItem("varagh.flash"); return v ? +v : null; } catch { return null; } })();
  function flashRow() {
    if (!FLASH) return;
    const id = FLASH; FLASH = null;
    requestAnimationFrame(() => { const el = $(`.row[data-id="${id}"]`, canvas); if (el) { el.scrollIntoView({ block: "center", behavior: "smooth" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 2400); } });
  }

  /* --- memory palace overlay */
  const Palace = (() => {
    let pd = null;
    async function open() {
      ov.innerHTML = ovHead(tr("قصر حافظه", "Memory palace"), `<button class="btn sm go" id="pl-walk">${ICON.walk} ${tr("قدم زدن در قصر", "Walk the palace")}</button>
        <span class="small muted">${tr(`هر فصل یک اتاق است. هر چیز مهم را جایی در اتاقش بگذار؛ موقع مرور در خانه قدم می‌زنی و برش می‌داری.`, `Each chapter is a room. Place each important idea somewhere in its room; when reviewing, you walk through the house and pick them up.`)}</span>`).replace(/<button class="btn icon ghost" data-fit[^>]*>.*?<\/button>/, "") +
        `<div class="ov-scroll" id="pl-body"></div>`;
      $("[data-close]", ov).onclick = closeOverlay;
      $("#pl-walk").onclick = walk;
      await load();
    }
    async function load() {
      pd = await api(`/api/books/${bookId}/palace`);
      if (S.overlay !== "palace") return;
      const cur = pd.rooms.find(r => r.start <= S.page && S.page <= r.end);
      $("#pl-body").innerHTML = `<div class="house">${pd.rooms.map((r, i) => `<section class="room ${r.open ? "" : "locked"} ${r === cur ? "here" : ""}">
        <header><span class="rname">${esc(trS(r.room))}</span><b dir="auto">${esc(trS(r.title))}</b><span class="small muted">${tr("ص", "pp.")} ${fa(r.start)}–${fa(r.end)}</span></header>
        ${r.open ? `<ol class="spots">${pd.spots.slice(0, Math.max(5, r.items.length ? Math.max(...r.items.map(x => x.spot)) + 1 : 5)).map((sp, si) => {
          const it = r.items.find(x => x.spot === si);
          return `<li class="${it ? "full" : ""}"><span class="sp">${esc(trS(sp))}</span>${it ? `<div class="it"><p class="cue">${esc(it.cue || "—")}</p><p class="idea">${esc(it.idea)}</p>
            <span class="itm">${it.recalled + it.missed ? tr(`${fa(it.recalled)} از ${fa(it.recalled + it.missed)} بار یادت آمد · `, `recalled ${fa(it.recalled)} of ${fa(it.recalled + it.missed)} times · `) : ""}<button class="linkbtn" data-go="${it.page}">${tr("ص", "p.")} ${fa(it.page)}</button> <button class="linkbtn danger" data-del="${it.id}">${tr("برداشتن", "Remove")}</button></span></div>` : `<span class="empty-spot">${tr("خالی", "Empty")}</span>`}</li>`;
        }).join("")}</ol>
        <div class="room-acts"><button class="btn sm" data-fill="${r.end >= S.page && r.start <= S.page ? S.page : r.end}" ${r.items.length >= 5 ? "disabled" : ""}>${tr(`پر کردن جاهای خالی با مدل`, `Fill empty spots with the model`)}</button></div>`
          : `<p class="small muted">${tr(`هنوز به این فصل نرسیده‌ای؛ درش بسته است.`, `You haven't reached this chapter yet; its door is closed.`)}</p>`}</section>`).join("")}</div>`;
      $$("[data-del]", ov).forEach(b => b.onclick = async () => { await api(`/api/palace/${b.dataset.del}`, { method: "DELETE" }); load(); });
      $$("[data-go]", ov).forEach(b => b.onclick = () => { closeOverlay(); go(+b.dataset.go); });
      $$("[data-fill]", ov).forEach(b => b.onclick = async () => {
        b.disabled = true; b.textContent = tr("مدل دارد صحنه‌ها را می‌چیند…", "The model is setting the scenes…");
        try { const r = await api(`/api/books/${bookId}/palace/fill?page=${b.dataset.fill}`, { method: "POST" }); toast(tr(`${fa(r.added)} چیز در «${r.room}» گذاشته شد`, `${fa(r.added)} items placed in the ${trS(r.room)}`)); refreshUsage(); }
        catch (e) { toast(e.message, true); }
        load();
      });
      $(".room.here", ov)?.scrollIntoView({ block: "nearest" });
    }
    function walk() {
      const items = pd.rooms.filter(r => r.open).flatMap(r => r.items.map(it => ({ ...it, room: r.room, title: r.title })));
      if (!items.length) return toast(tr("قصر هنوز خالی است. اول چیزی در اتاق‌ها بگذار.", "The palace is still empty. Place something in the rooms first."), true);
      let i = 0, shown = false, ok = 0;
      const body = $("#pl-body");
      const step = () => {
        if (i >= items.length) {
          body.innerHTML = `<div class="walk"><div class="wcard"><span class="eyebrow-s">${tr(`پایان قدم زدن`, `Walk complete`)}</span><b class="big">${fa(ok)} ${tr("از", "of")} ${fa(items.length)}</b><p class="muted">${tr(`چیزهایی که یادت نیامد، دفعه‌ی بعد زودتر سراغت می‌آیند. هرچه تصویرها عجیب‌تر باشند، بهتر می‌مانند.`, `What you didn't recall will come up sooner next time. The stranger the images, the better they stick.`)}</p>
            <button class="btn" id="w-back">${tr(`برگشت به نقشه‌ی خانه`, `Back to the house map`)}</button></div></div>`;
          $("#w-back").onclick = load; return;
        }
        const it = items[i];
        body.innerHTML = `<div class="walk"><div class="wprog">${items.map((_, k) => `<i class="${k < i ? "done" : k === i ? "cur" : ""}"></i>`).join("")}</div>
          <div class="wcard"><span class="eyebrow-s">${esc(trS(it.room))} · ${esc(trS(SPOTS_FA[it.spot] || ""))}</span>
          <p class="wq">${it.cue ? esc(it.cue) : tr("این‌جا چه گذاشته بودی؟", "What did you leave here?")}</p>
          ${shown ? `<p class="wa">${esc(it.idea)}</p><div class="wbtns"><button class="btn" data-r="0">${tr("یادم نیامد", "Didn't recall")}</button><button class="btn go" data-r="1">${tr("یادم آمد", "Recalled")}</button></div>`
            : `<button class="btn primary" id="w-show">${tr("چه چیزی این‌جا بود؟", "What was here?")} <span class="small">(${tr("فاصله", "Space")})</span></button>`}</div></div>`;
        if (!shown) $("#w-show").onclick = () => { shown = true; step(); };
        $$("[data-r]", body).forEach(b => b.onclick = async () => {
          const good = b.dataset.r === "1"; if (good) ok++;
          api(`/api/palace/${it.id}/recall`, { method: "POST", body: { ok: good } }).catch(() => {});
          i++; shown = false; step();
        });
      };
      const key = e => { if (S.overlay !== "palace") return document.removeEventListener("keydown", key); if (e.key === " " && $("#w-show")) { e.preventDefault(); $("#w-show").click(); } };
      document.addEventListener("keydown", key);
      step();
    }
    return { open, refresh() { if (S.overlay === "palace") load(); } };
  })();
  const SPOTS_FA = ["کنار در", "روی میز", "لب پنجره", "روی قفسه", "روی صندلی", "کنار شومینه", "پشت پرده", "وسط فرش"];

  /* --- teaching post overlay */
  const Post = (() => {
    let info = null, saveT = null;
    async function open() {
      ov.innerHTML = ovHead(tr("پست آموزشی از این فصل", "Teaching post from this chapter"), `<span class="small muted" id="po-info"></span>`).replace(/<button class="btn icon ghost" data-fit[^>]*>.*?<\/button>/, "") +
        `<div class="ov-scroll"><div class="postwrap" id="po-body"></div></div>`;
      $("[data-close]", ov).onclick = closeOverlay;
      info = await api(`/api/books/${bookId}/post?page=${S.page}`);
      info.label = trS(info.label).replace(/\d+/g, d => fa(+d));
      $("#po-info").innerHTML = `<span dir="auto">${esc(info.label)}</span> · ${tr(`ص ${fa(info.start)} تا ${fa(info.end)}`, `pp. ${fa(info.start)}–${fa(info.end)}`)}`;
      render();
    }
    function outlineHtml(o) {
      const who = task.post?.model ? task.post : task.translate_para;
      if (!o) return `<div class="ov-cta" style="position:static;min-height:30vh"><b>${tr("اسکلت پست", "Post outline")}</b><span class="small">${tr("مدل فقط ساختار و ایده می‌دهد؛ نوشتن با خودت است.", "The model only suggests structure and ideas; the writing is yours.")}</span>
        <button class="btn go" id="po-outline">${ICON.mind} ${tr("ساختن اسکلت", "Build outline")}</button><span class="small">${providerPill(who.provider, who.model)}</span></div>`;
      return `<div class="outline"><h4>${tr(`شروع‌های پیشنهادی`, `Suggested openings`)}</h4><ul>${(o.hooks || []).map(h => `<li>${esc(h)}</li>`).join("")}</ul>
        <h4>${tr(`سه نکته‌ی اصلی`, `Three main points`)}</h4><ol>${(o.points || []).map(p => `<li><b>${esc(p.title)}</b><span class="small muted"> — ${esc(p.why || "")}</span></li>`).join("")}</ol>
        ${o.example ? `<h4>${tr(`مثال یا نقل‌قول`, `Example or quote`)}</h4><p>${esc(o.example)}</p>` : ""}
        ${o.question ? `<h4>${tr(`سؤال پایانی برای مخاطب`, `Closing question for readers`)}</h4><p>${esc(o.question)}</p>` : ""}
        ${(o.tips || []).length ? `<h4>${tr(`نکته‌ی نوشتن`, `Writing tips`)}</h4><ul class="small">${o.tips.map(t => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
        <button class="btn sm ghost" id="po-outline">${tr("اسکلت تازه", "New outline")}</button></div>`;
    }
    function render() {
      const p = info.post || {};
      $("#po-body").innerHTML = `<aside class="po-side">${outlineHtml(p.outline)}</aside>
        <section class="po-main"><label class="small muted" for="po-text">${tr(`نوشته‌ی تو (برای تلگرام؛ کوتاه‌تر از ۱۵۰۰ کاراکتر بهتر خوانده می‌شود)`, `Your post (for Telegram; under 1,500 characters reads best)`)}</label>
        <textarea id="po-text" rows="14" placeholder="${tr(`با یکی از شروع‌ها یا جمله‌ی خودت شروع کن…`, `Start with one of the openings or your own sentence…`)}">${esc(p.text || "")}</textarea>
        <div class="po-bar"><span class="small muted" id="po-count"></span><span style="display:flex;gap:6px">
          <button class="btn sm ghost" id="po-copy">${tr("کپی", "Copy")}</button><button class="btn sm" id="po-fb">${tr("بازخورد روی نوشته‌ی من", "Feedback on my writing")}</button></span></div>
        <div id="po-fbox"></div></section>`;
      const ta = $("#po-text");
      const count = () => { const n = ta.value.length; $("#po-count").textContent = tr(`${fa(n)} کاراکتر`, `${fa(n)} characters`) + (n > 4096 ? tr(" · بیشتر از حد یک پیام تلگرام", " · over Telegram's message limit") : n > 1500 ? tr(" · کمی بلند است", " · a bit long") : ""); };
      count();
      ta.oninput = () => { count(); clearTimeout(saveT); saveT = setTimeout(() => api(`/api/books/${bookId}/post?page=${info.start}`, { method: "PUT", body: { text: ta.value } }).catch(() => {}), 700); };
      $("#po-copy").onclick = async () => { try { await navigator.clipboard.writeText(ta.value); toast(tr("کپی شد؛ در تلگرام بچسبان", "Copied; paste it into Telegram")); } catch { toast(tr("کپی نشد", "Couldn't copy"), true); } };
      $("#po-fb").onclick = async e => {
        const b = e.currentTarget; b.disabled = true; b.textContent = tr("در حال خواندن نوشته‌ات…", "Reading your post…");
        try {
          const f = await api(`/api/books/${bookId}/post/feedback?page=${info.start}`, { method: "POST", body: { text: ta.value } });
          $("#po-fbox").innerHTML = `<div class="fbbox">${f.good.length ? `<h4>${tr(`چه چیزی خوب است`, `What works`)}</h4><ul>${f.good.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
            ${f.improve.length ? `<h4>${tr("پیشنهاد", "Suggestions")}</h4><ul>${f.improve.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
            ${f.accuracy ? `<h4>${tr("دقت", "Accuracy")}</h4><p>${esc(f.accuracy)}</p>` : ""}</div>`;
          refreshUsage();
        } catch (err) { toast(err.message, true); }
        b.disabled = false; b.textContent = tr("بازخورد روی نوشته‌ی من", "Feedback on my writing");
      };
      const ob = $("#po-outline");
      if (ob) ob.onclick = async () => {
        ob.disabled = true; ob.textContent = tr("در حال ساختن…", "Building…");
        try { const r = await api(`/api/books/${bookId}/post/outline?page=${info.start}`, { method: "POST" }); info.post = { ...(info.post || {}), outline: r.outline, text: ta.value }; render(); refreshUsage(); }
        catch (err) { toast(err.message, true); ob.disabled = false; ob.textContent = tr("ساختن اسکلت", "Build outline"); }
      };
    }
    return { open, refresh() {} };
  })();

  await loadEntities();
  load();
  renderTab();
  const gapH = book.opened ? (Date.now() - new Date(book.opened)) / 36e5 : 0;
  if (gapH > 8 && book.last_page > 1 && !pageArg) showWelcome().catch(() => {});
  else if (gapH > 8 && book.last_page > 1 && pageArg === book.last_page) showWelcome().catch(() => {});
}

/* ---------------------------------------------------------------- lookup popover */
function hidePopover() { $("#popover").hidden = true; }
document.addEventListener("mousedown", e => { if (!e.target.closest("#popover")) hidePopover(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") hidePopover(); });

function placePopover(pop, rect) {
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let left = rect.left + rect.width / 2 - w / 2;
  left = Math.max(12, Math.min(left, innerWidth - w - 12));
  let top = rect.bottom + 10; if (top + h > innerHeight - 12) top = Math.max(12, rect.top - h - 10);
  pop.style.left = left + "px"; pop.style.top = top + "px";
}

async function lookupPopover(word, sentence, rect, ctx) {
  const pop = $("#popover");
  pop.className = "popover"; delete pop.dataset.e;
  pop.innerHTML = `<div class="w"><span>${esc(word)}</span><small>${tr(`در حال جست‌وجو…`, `Searching…`)}</small></div>`;
  pop.hidden = false;
  const place = () => placePopover(pop, rect);
  place();
  try {
    const d = await api("/api/lookup", { method: "POST", body: { word, sentence } });
    const others = (d.other_meanings_fa || []).filter(Boolean);
    const back = [d.meaning_fa, others.length ? "(" + others.slice(0, 3).join("، ") + ")" : ""].filter(Boolean).join(" ");
    pop.innerHTML = `<div class="w"><span>${esc(d.lemma && d.lemma.toLowerCase() !== word.toLowerCase() ? `${word} → ${d.lemma}` : word)}</span><small>${esc(d.ipa || "")}</small></div>
      <div class="small muted">${esc(d.pos_fa || "")}</div>
      <div class="mean">${esc(d.meaning_fa || "")}</div>
      ${others.length ? `<ul>${others.slice(0, 4).map(o => `<li>${esc(o)}</li>`).join("")}</ul>` : ""}
      ${d.note_fa ? `<div class="small">${esc(d.note_fa)}</div>` : ""}
      <div class="foot"><span class="small muted">${esc(d._model || "")}</span><span style="display:flex;gap:6px">${ctx.find ? `<button class="btn sm ghost" id="findall">${tr("همه‌ی صفحه‌ها", "All pages")}</button>` : ""}<button class="btn sm primary" id="addcard">${tr("افزودن به کارت‌ها", "Add to cards")}</button></span></div>`;
    if ($("#findall")) $("#findall").onclick = () => { hidePopover(); ctx.find(word); };
    place();
    $("#addcard").onclick = async () => {
      const r = await api("/api/cards", { method: "POST", body: { book_id: ctx.bookId, page: ctx.page, front: word, back, context: sentence } });
      toast(r.duplicate ? tr("این کلمه قبلاً کارت شده", "This word is already a card") : tr("به کارت‌ها اضافه شد", "Added to cards")); hidePopover(); refreshDue(); ctx.after && ctx.after();
    };
  } catch (e) {
    pop.innerHTML = `<div class="w"><span>${esc(word)}</span></div><div class="small" style="color:var(--danger)">${esc(e.message)}</div>`;
    place();
  }
}

/* ---------------------------------------------------------------- cards */
async function Cards() {
  const [{ cards: due, stats }, { cards: all }] = await Promise.all([api("/api/cards/due"), api("/api/cards")]);
  view.innerHTML = `<div class="pagewrap-main">
    <div class="head"><div><h1>${tr(`مرور کارت‌ها`, `Review cards`)}</h1>
      <p>${tr(`${fa(stats.due)} کارت برای امروز · ${fa(stats.total)} کارت در کل · زمان‌بندی با FSRS`, `${fa(stats.due)} cards due today · ${fa(stats.total)} cards total · scheduled with FSRS`)}</p></div>
      ${all.length ? `<a class="btn" href="/api/cards/export.tsv">${tr(`خروجی برای Anki`, `Export for Anki`)}</a>` : ""}</div>
    <div class="review" id="rev"></div>
    <h2>${tr(`همه‌ی کارت‌ها`, `All cards`)}</h2>
    <div class="card tablebox" style="padding:0">${all.length ? `<table><thead><tr><th>${tr("کلمه", "Word")}</th><th>${tr("معنی", "Meaning")}</th><th>${tr("کتاب", "Book")}</th><th>${tr("مرور بعدی", "Next review")}</th><th></th></tr></thead><tbody>
      ${all.map(c => `<tr><td class="en">${esc(c.front)}</td><td>${esc(c.back)}</td><td class="small">${esc(c.book_title || "")}${c.page ? tr(" · ص ", " · p. ") + fa(c.page) : ""}</td>
      <td class="small">${relTime(c.due)}</td><td><button class="btn sm ghost danger" data-del="${c.id}">${tr("حذف", "Delete")}</button></td></tr>`).join("")}</tbody></table>`
      : `<p style="padding:20px" class="muted">${tr(`هنوز کارتی نساخته‌ای. در صفحه‌ی خواندن، کلمه‌ای از متن انگلیسی را انتخاب کن تا معنی‌اش بیاید و به کارت‌ها اضافه شود.`, `No cards yet. While reading, select a word in the English text to see its meaning and add it to your cards.`)}</p>`}</div></div>`;
  $$("[data-del]").forEach(b => b.onclick = async () => { await api(`/api/cards/${b.dataset.del}`, { method: "DELETE" }); route(); });

  let i = 0, flipped = false;
  const rev = $("#rev");
  const show = () => {
    if (i >= due.length) {
      rev.innerHTML = `<div class="fcard"><b style="font-size:1.2rem">${due.length ? tr("مرور امروز تمام شد", "Today's review is done") : tr("کارتی برای مرور نمانده", "No cards left to review")}</b><span class="muted small">${tr(`کارت‌ها طبق برنامه‌ی FSRS دوباره ظاهر می‌شوند.`, `Cards come back according to the FSRS schedule.`)}</span></div>`;
      refreshDue(); return;
    }
    const c = due[i];
    const CT = { vocab: tr("لغت", "Vocabulary"), causal: tr("علت و مکانیزم", "Cause & mechanism"), cloze: tr("جای‌خالی", "Cloze"), scenario: tr("سناریوی کاربردی", "Applied scenario") };
    const isCloze = c.card_type === "cloze" || /\{\{.+?\}\}/.test(c.front || "");
    const frontHtml = isCloze
      ? esc(c.front).replace(/\{\{(.+?)\}\}/g, flipped ? "<mark>$1</mark>" : "<mark>[ _____ ]</mark>")
      : esc(c.front);
    const ctx = esc(c.context || "").replace(new RegExp(esc(c.front).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), m => `<mark>${m}</mark>`);
    rev.innerHTML = `<div class="muted small">${fa(i + 1)} ${tr("از", "of")} ${fa(due.length)} · <span class="pill cli2api">${CT[c.card_type] || CT.vocab}</span></div>
      <div class="fcard"><div class="front" dir="auto" style="${c.card_type && c.card_type !== "vocab" ? "font-family:var(--f-ui);font-size:1.3rem;line-height:1.8" : ""}">${frontHtml}</div>${c.context ? `<div class="ctx">${ctx}</div>` : ""}
      ${flipped ? `<div class="back">${esc(c.back)}</div><div class="small muted">${esc(c.book_title || "")}${c.page ? tr(" · ص ", " · p. ") + fa(c.page) : ""}</div>` : ""}</div>
      ${flipped ? `<div class="rates">${[[tr("دوباره", "Again"), 1], [tr("سخت", "Hard"), 2], [tr("خوب", "Good"), 3], [tr("آسان", "Easy"), 4]].map(([t, r]) => `<button data-r="${r}">${t}<small>${tr("کلید", "key")} ${fa(r)}</small></button>`).join("")}</div>`
      : `<button class="btn primary" id="flip">${tr("نمایش معنی", "Show meaning")} <span class="small">(${tr("فاصله", "Space")})</span></button>`}`;
    if (!flipped) $("#flip").onclick = () => { flipped = true; show(); };
    $$("[data-r]").forEach(b => b.onclick = () => rate(+b.dataset.r));
  };
  const rate = async r => { await api(`/api/cards/${due[i].id}/review`, { method: "POST", body: { rating: r } }); i++; flipped = false; show(); };
  const keys = e => {
    if (i >= due.length || document.activeElement?.tagName === "INPUT") return;
    if (e.key === " " && !flipped) { e.preventDefault(); flipped = true; show(); }
    else if (flipped && ["1", "2", "3", "4"].includes(e.key)) rate(+e.key);
  };
  document.addEventListener("keydown", keys); onLeave(() => document.removeEventListener("keydown", keys));
  show();
}
function relTime(iso) {
  const d = (new Date(iso) - new Date()) / 36e5;
  if (d <= 0) return tr("الان", "now");
  if (d < 1) return tr(`${fa(Math.round(d * 60))} دقیقه‌ی دیگر`, `in ${fa(Math.round(d * 60))} min`);
  if (d < 24) return tr(`${fa(Math.round(d))} ساعت دیگر`, `in ${fa(Math.round(d))} h`);
  return tr(`${fa(Math.round(d / 24))} روز دیگر`, `in ${fa(Math.round(d / 24))} days`);
}

/* ---------------------------------------------------------------- settings */
async function fetchModels(provider, statusEl) {
  try {
    const { models } = await api(`/api/models/${provider}`);
    const dl = $(`#dl-${provider}`); if (dl) dl.innerHTML = models.map(m => `<option value="${esc(m)}">`).join("");
    if (statusEl) { statusEl.className = "status-line ok"; statusEl.textContent = tr(`متصل شد · ${fa(models.length)} مدل پیدا شد`, `Connected · ${fa(models.length)} models found`); }
  } catch (e) {
    if (statusEl) { statusEl.className = "status-line bad"; statusEl.textContent = e.message; }
  }
}

async function Settings() {
  const [{ settings: s, tasks }, u] = await Promise.all([api("/api/settings"), api("/api/usage")]);
  const f = (id, label, val, type = "text", hint = "", cls = "") =>
    `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" class="${cls}" value="${esc(val)}" ${type === "number" ? 'step="any"' : ""}>${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
  const c = (id, label, on) => `<label class="check"><input type="checkbox" id="${id}" ${on ? "checked" : ""}> ${label}</label>`;

  const cli2 = s.cli2api || {};
  let cliCatalog = {
    default_cli: cli2.default_cli || "agy",
    providers: [{ id: cli2.default_cli || "agy", label: cli2.default_cli || "agy", type: "cli", installed: true }],
    models_by_provider: {},
    all_models: [],
  };

  view.innerHTML = `<div class="pagewrap-main">
    <div class="head"><div><h1>${tr("تنظیمات", "Settings")}</h1><p>${tr("اتصال مدل‌ها (CLI2API، Ollama و OpenAI اختصاصی)، انتخاب CLI و مدل برای هر کار، و سقف هزینه.", "Model connections (CLI2API, Ollama and OpenAI-compatible), the CLI and model for each task, and the spending cap.")}</p></div>
      <div class="field" style="min-width:180px"><label for="ui-lang">${tr("زبان رابط", "Interface language")}</label>
        <select id="ui-lang"><option value="en" ${IS_FA ? "" : "selected"}>English</option><option value="fa" ${IS_FA ? "selected" : ""}>فارسی</option></select></div></div>
    <datalist id="dl-ollama"></datalist><datalist id="dl-openai"></datalist><datalist id="dl-cli2api"></datalist>
    <div class="settings">
      <div class="card wide">
        <h2>${tr(`کدام مدل برای کدام کار`, `Which model for which task`)}</h2>
        <p class="small muted">${tr(`برای هر کار می‌توانی <b>CLI2API</b>، <b>Ollama</b> یا <b>OpenAI</b> را انتخاب کنی. در حالت CLI2API اول CLI (مثل <code>agy</code>، <code>claude</code>، <code>codex</code>...) و بعد مدل داخل آن را انتخاب کن. کاری که مدل ندارد از مدل ترجمه‌ی پاراگرافی استفاده می‌کند.`, `For each task you can choose <b>CLI2API</b>, <b>Ollama</b> or <b>OpenAI</b>. With CLI2API, pick the CLI first (<code>agy</code>, <code>claude</code>, <code>codex</code>…) and then a model inside it. Tasks without a model use the paragraph-translation model.`)}</p>
        <div id="task-list">${Object.entries(tasks).map(([k, l]) => [k, trS(l)]).map(([k, label]) => `
          <div class="task" data-task="${k}"><b class="small">${label}</b>
            <select data-prov aria-label="${tr(`ارائه‌دهنده برای ${label}`, `Provider for ${label}`)}">
              <option value="cli2api" ${s.tasks[k].provider === "cli2api" ? "selected" : ""}>CLI2API</option>
              <option value="ollama" ${s.tasks[k].provider === "ollama" ? "selected" : ""}>Ollama</option>
              <option value="openai" ${s.tasks[k].provider === "openai" ? "selected" : ""}>OpenAI</option>
            </select>
            <div class="task-model-cell" data-cell>
              <input data-model class="ltr" list="dl-${s.tasks[k].provider}" value="${esc(s.tasks[k].model)}" placeholder="${k === "translate_para" ? tr("نام مدل", "Model name") : tr("خالی = همان مدل ترجمه‌ی پاراگرافی", "Empty = same as paragraph translation")}" aria-label="${tr(`مدل برای ${label}`, `Model for ${label}`)}">
            </div>
          </div>`).join("")}</div>
      </div>
      <div class="card wide">
        <h2><span class="pill cli2api">CLI2API</span> ${tr(`اتصال به CLIهای محلی (agy، claude، codex و…)`, `Connect to local CLIs (agy, claude, codex, …)`)}</h2>
        <div class="r2">
          ${f("c2-url", tr("آدرس سرور CLI2API", "CLI2API server URL"), cli2.base_url || "http://127.0.0.1:8787", "url", tr("پیش‌فرض: http://127.0.0.1:8787", "Default: http://127.0.0.1:8787"), "ltr")}
          <div class="field"><label for="c2-cli">${tr("CLI پیش‌فرض", "Default CLI")}</label>
            <select id="c2-cli" class="ltr"><option value="${esc(cli2.default_cli || "agy")}">${esc(cli2.default_cli || "agy")}</option></select>
            <span class="hint">${tr(`مدل‌های agy روی حالت <b>low</b> اجرا می‌شوند.`, `agy models run in <b>low</b> mode.`)}</span></div>
        </div>
        <div class="r2">
          ${f("c2-dir", tr("مسیر پوشه‌ی cli_to_api (اختیاری)", "cli_to_api folder path (optional)"), cli2.cli_to_api_dir || "", "text", tr("خالی = نسخه‌ی همراه برنامه (CLI_to_API)", "Empty = the bundled copy (CLI_to_API)"), "ltr")}
          <div class="field"><label for="c2-key">${tr("کلید API (اختیاری)", "API key (optional)")}</label>
            <div style="display:flex;gap:8px"><input id="c2-key" type="password" class="ltr" autocomplete="off" placeholder="${cli2.has_key ? tr("ذخیره شده: ", "Saved: ") + esc(cli2.api_key_masked) : tr("اگر روی cli2api کلید نگذاشتی خالی بگذار", "Leave empty if cli2api has no key")}">
            ${cli2.has_key ? `<button class="btn ghost danger" id="c2-del">${tr("حذف", "Delete")}</button>` : ""}</div></div>
        </div>
        <div class="r3">
          ${f("c2-timeout", tr("timeout (ثانیه)", "timeout (seconds)"), cli2.timeout ?? 300, "number")}
          <div style="display:flex;align-items:center">${c("c2-auto", tr("اجرای خودکار سرور CLI2API", "Start the CLI2API server automatically"), cli2.auto_start !== false)}</div>
          <div style="display:flex;align-items:center">${c("c2-json", tr("JSON mode برای واژه‌نامه و معنی کلمه", "JSON mode for glossary and word lookup"), cli2.json_mode !== false)}</div>
        </div>
        <div class="cli-pills" id="c2-clis"></div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn" id="c2-test">${tr(`اتصال و دریافت CLIها و مدل‌ها`, `Connect and fetch CLIs & models`)}</button><span class="status-line" id="c2-st"></span></div>
      </div>
      <div class="card">
        <h2><span class="pill ollama">Ollama</span> ${tr("روی همین کامپیوتر", "on this computer")}</h2>
        ${f("ol-url", tr("آدرس سرور", "Server URL"), s.ollama.base_url, "url", "", "ltr")}
        <div class="r3">${f("ol-ctx", tr("num_ctx پاراگرافی", "num_ctx (paragraph)"), s.ollama.num_ctx, "number")}${f("ol-ctxp", tr("num_ctx صفحه‌ای", "num_ctx (page)"), s.ollama.num_ctx_page, "number")}${f("ol-temp", "temperature", s.ollama.temperature, "number")}</div>
        <div class="r2">${f("ol-keep", "keep_alive", s.ollama.keep_alive, "text", tr("مدت ماندن مدل در حافظه، مثل 30m", "How long the model stays loaded, e.g. 30m"), "ltr")}
          <div class="field"><label for="ol-fb">${tr(`مدل جایگزین وقتی سقف OpenAI پر شود`, `Fallback model when the OpenAI cap is reached`)}</label><input id="ol-fb" list="dl-ollama" class="ltr" value="${esc(s.ollama.fallback_model)}"></div></div>
        <div class="field"><label for="ol-emb">${tr(`مدل جست‌وجوی معنایی (embedding)`, `Semantic search model (embedding)`)}</label><input id="ol-emb" list="dl-ollama" class="ltr" value="${esc(s.ollama.embed_model || "")}" placeholder="bge-m3">
          <span class="hint">${tr(`برای جست‌وجوی فارسی و انگلیسی، مدل چندزبانه مثل bge-m3 (با ollama pull bge-m3 نصب می‌شود). خالی = جست‌وجو فقط بر اساس کلمه.`, `For Persian and English search, use a multilingual model like bge-m3 (install with ollama pull bge-m3). Empty = keyword search only.`)}</span></div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn" id="ol-test">${tr("اتصال و دریافت مدل‌ها", "Connect and fetch models")}</button><span class="status-line" id="ol-st"></span></div>
      </div>
      <div class="card">
        <h2><span class="pill openai">OpenAI</span> ${tr(`یا هر API سازگار`, `or any compatible API`)}</h2>
        ${f("oa-url", "Base URL", s.openai.base_url, "url", tr("برای endpoint اختصاصی، آدرس خودش تا /v1", "For a custom endpoint, its URL up to /v1"), "ltr")}
        <div class="field"><label for="oa-key">${tr("کلید API", "API key")}</label>
          <div style="display:flex;gap:8px"><input id="oa-key" type="password" class="ltr" autocomplete="off" placeholder="${s.openai.has_key ? tr("ذخیره شده: ", "Saved: ") + esc(s.openai.api_key_masked) : "sk-…"}">
          ${s.openai.has_key ? `<button class="btn ghost danger" id="oa-del">${tr("حذف", "Delete")}</button>` : ""}</div>
          <span class="hint">${tr(`فقط روی همین کامپیوتر در data/settings.json ذخیره می‌شود. برای تغییر، کلید جدید را بنویس.`, `Stored only on this computer, in data/settings.json. To change it, type a new key.`)}</span></div>
        <div class="r2"><div class="field"><label for="oa-auth">${tr("احراز هویت", "Authentication")}</label><select id="oa-auth"><option value="bearer" ${s.openai.auth !== "api-key" ? "selected" : ""}>Authorization: Bearer</option><option value="api-key" ${s.openai.auth === "api-key" ? "selected" : ""}>api-key (Azure)</option></select></div>
          ${f("oa-ver", tr("api-version (فقط Azure)", "api-version (Azure only)"), s.openai.api_version, "text", "", "ltr")}</div>
        <div class="r2">${c("oa-json", tr("JSON mode برای واژه‌نامه و معنی کلمه", "JSON mode for glossary and word lookup"), s.openai.json_mode)}${c("oa-st", tr("ارسال temperature", "Send temperature"), s.openai.send_temperature)}</div>
        <div class="r2">${f("oa-temp", "temperature", s.openai.temperature, "number", tr("بعضی مدل‌های جدید temperature قبول نمی‌کنند؛ پیش‌فرض خاموش است.", "Some newer models reject temperature; off by default."))}${f("oa-timeout", tr("timeout (ثانیه)", "timeout (seconds)"), s.openai.timeout, "number")}</div>
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn" id="oa-test">${tr("اتصال و دریافت مدل‌ها", "Connect and fetch models")}</button><span class="status-line" id="oa-st2"></span></div>
      </div>
      <div class="card">
        <h2>${tr(`بودجه‌ی OpenAI`, `OpenAI budget`)}</h2>
        ${f("b-cap", tr("سقف ماهانه (توکن ورودی + خروجی)", "Monthly cap (input + output tokens)"), s.budget.monthly_token_cap, "number", tr("۰ یعنی بدون سقف", "0 means no cap"))}
        <div class="r2">${f("b-pin", tr("قیمت ۱ میلیون توکن ورودی ($)", "Price per 1M input tokens ($)"), s.budget.price_in_per_m, "number")}${f("b-pout", tr("قیمت ۱ میلیون توکن خروجی ($)", "Price per 1M output tokens ($)"), s.budget.price_out_per_m, "number")}</div>
        <span class="hint small muted">${tr(`قیمت‌ها فقط برای نمایش هزینه‌ی تخمینی است.`, `Prices are only used to show an estimated cost.`)}</span>
        ${c("b-fb", tr("وقتی سقف پر شد، ترجمه با Ollama ادامه پیدا کند", "When the cap is reached, continue translating with Ollama"), s.budget.fallback_to_ollama)}
      </div>
      <div class="card">
        <h2>${tr(`ترجمه و یادگیری عمیق`, `Translation & deep study`)}</h2>
        <div class="r3">${f("r-pco", tr("طول تکه (Ollama)", "Chunk length (Ollama)"), s.reading.page_chunk_chars_ollama, "number", tr("کاراکتر در هر درخواست", "characters per request"))}
          ${f("r-pca", tr("طول تکه (OpenAI)", "Chunk length (OpenAI)"), s.reading.page_chunk_chars_openai, "number")}
          ${f("r-pcc", tr("طول تکه (CLI2API)", "Chunk length (CLI2API)"), s.reading.page_chunk_chars_cli2api ?? 6000, "number")}</div>
        <div class="r2">
          ${f("r-dom", tr("حوزه‌ی تخصصی من (برای قیاس‌ها)", "My field (for analogies)"), s.reading.user_domain || "مهندسی نرم‌افزار و هوش مصنوعی", "text", tr("در توضیح سطح ۴، مثال‌ها با این حوزه قیاس می‌شوند", "Level-4 explanations draw analogies from this field"))}
          ${f("r-obs", tr("پوشه‌ی Obsidian Vault (اختیاری)", "Obsidian vault folder (optional)"), s.reading.obsidian_vault || "", "text", tr("برای همگام‌سازی مستقیم فایل‌های .md", "For syncing .md files directly"), "ltr")}
        </div>
        ${c("r-ag", tr("بعد از افزودن کتاب، واژه‌نامه خودکار ساخته شود", "Build the glossary automatically after adding a book"), s.reading.auto_glossary)}
      </div>
      <div class="card wide" id="phone"><h2>${tr("خواندن روی گوشی", "Read on your phone")}</h2><p class="small muted">${tr(`در حال بارگذاری…`, `Loading…`)}</p></div>
      <div class="card wide">
        <h2>${tr(`مصرف این ماه (${esc(u.month)})`, `Usage this month (${esc(u.month)})`)}</h2>
        ${u.rows.length ? `<div class="tablebox"><table><thead><tr><th>${tr("مدل", "Model")}</th><th>${tr("درخواست", "Requests")}</th><th>${tr("توکن ورودی", "Input tokens")}</th><th>${tr("توکن خروجی", "Output tokens")}</th></tr></thead><tbody>
          ${u.rows.map(r => `<tr><td>${providerPill(r.provider, r.model)}</td><td>${fa(r.calls)}</td><td>${fa(r.in_tok)}</td><td>${fa(r.out_tok)}</td></tr>`).join("")}
          </tbody></table></div><p class="small muted">OpenAI: ${tr(`${fa(u.openai_tokens)} از ${u.cap ? fa(u.cap) : "∞"} توکن`, `${fa(u.openai_tokens)} of ${u.cap ? fa(u.cap) : "∞"} tokens`)}${u.cost ? ` · ${tr("حدود", "about")} $${u.cost.toFixed(2)}` : ""}</p>` : `<p class="muted small">${tr(`هنوز درخواستی ثبت نشده.`, `No requests yet.`)}</p>`}
      </div>
    </div>
    <div class="savebar"><button class="btn primary" id="save">${tr(`ذخیره‌ی تنظیمات`, `Save settings`)}</button></div></div>`;

  function splitCliModel(val) {
    const v = (val || "").trim();
    if (!v) return { cli: $("#c2-cli")?.value || cliCatalog.default_cli || "agy", sub: "", inherit: true };
    const i = v.indexOf("/");
    if (i === -1) return { cli: v, sub: "", inherit: false };
    return { cli: v.slice(0, i), sub: v.slice(i + 1), inherit: false };
  }

  function readTaskModel(row) {
    const prov = $("[data-prov]", row).value;
    if (prov !== "cli2api") return ($("[data-model]", row)?.value || "").trim();
    const cliSel = $("[data-cli]", row);
    const modSel = $("[data-cli-model]", row);
    const customInp = $("[data-cli-custom]", row);
    if (!cliSel || !modSel) return ($("[data-model]", row)?.value || "").trim();
    const mv = modSel.value;
    if (mv === "__inherit__") return "";
    const cli = cliSel.value;
    if (mv === "__default__") return cli;
    if (mv === "__custom__") {
      const c = (customInp?.value || "").trim();
      return c ? `${cli}/${c}` : "";
    }
    return `${cli}/${mv}`;
  }

  function renderTaskCell(row, initialVal) {
    const k = row.dataset.task;
    const prov = $("[data-prov]", row).value;
    const cell = $("[data-cell]", row);
    const val = initialVal !== undefined ? initialVal : readTaskModel(row);
    if (prov !== "cli2api") {
      cell.innerHTML = `<input data-model class="ltr" list="dl-${prov}" value="${esc(val)}" placeholder="${k === "translate_para" ? tr("نام مدل", "Model name") : tr("خالی = همان مدل ترجمه‌ی پاراگرافی", "Empty = same as paragraph translation")}" aria-label="${tr("مدل", "Model")}">`;
      return;
    }
    const parsed = splitCliModel(val);
    const provs = cliCatalog.providers.length ? cliCatalog.providers : [{ id: "agy", label: "Antigravity CLI" }];
    const provIds = provs.map(p => p.id);
    const curCli = provIds.includes(parsed.cli) ? parsed.cli : (parsed.cli || provs[0].id);
    const cliOptions = provs.map(p => `<option value="${esc(p.id)}" ${p.id === curCli ? "selected" : ""}>${esc(p.id)}</option>`).join("")
      + (!provIds.includes(curCli) ? `<option value="${esc(curCli)}" selected>${esc(curCli)}</option>` : "");

    cell.innerHTML = `<select data-cli class="ltr" aria-label="CLI">${cliOptions}</select>
      <select data-cli-model class="ltr" aria-label="${tr("مدل CLI", "CLI model")}"></select>
      <input data-cli-custom class="ltr" placeholder="${tr(`نام مدل دلخواه…`, `Custom model name…`)}" hidden>`;

    const cliSel = $("[data-cli]", cell);
    const modSel = $("[data-cli-model]", cell);
    const customInp = $("[data-cli-custom]", cell);

    function populateModels(selectedSub, isInherit) {
      const cli = cliSel.value;
      const list = cliCatalog.models_by_provider[cli] || [];
      const subs = list.map(x => x.submodel);
      let opts = "";
      if (k !== "translate_para") {
        opts += `<option value="__inherit__" ${isInherit ? "selected" : ""}>${tr(`— همان مدل ترجمه‌ی پاراگرافی —`, `— same as paragraph translation —`)}</option>`;
      }
      if (!list.length) {
        opts += `<option value="__default__" ${!isInherit && !selectedSub ? "selected" : ""}>${tr("پیش‌فرض", "Default")} ${esc(cli)}</option>`;
      } else {
        opts += list.map(m => `<option value="${esc(m.submodel)}" ${!isInherit && m.submodel === selectedSub ? "selected" : ""}>${esc(m.label || m.submodel)}</option>`).join("");
        opts += `<option value="__default__" ${!isInherit && !selectedSub ? "selected" : ""}>${tr("پیش‌فرض", "Default")} ${esc(cli)}</option>`;
      }
      const isCustom = !isInherit && selectedSub && !subs.includes(selectedSub);
      opts += `<option value="__custom__" ${isCustom ? "selected" : ""}>${tr("مدل دلخواه…", "Custom model…")}</option>`;
      modSel.innerHTML = opts;
      if (isCustom) {
        customInp.hidden = false;
        customInp.value = selectedSub;
      } else {
        customInp.hidden = true;
        customInp.value = "";
      }
    }

    populateModels(parsed.sub, parsed.inherit);
    cliSel.onchange = () => {
      const list = cliCatalog.models_by_provider[cliSel.value] || [];
      populateModels(list.length ? list[0].submodel : "", false);
    };
    modSel.onchange = () => {
      customInp.hidden = modSel.value !== "__custom__";
      if (!customInp.hidden) customInp.focus();
    };
  }

  $$(".task").forEach(row => {
    const k = row.dataset.task;
    renderTaskCell(row, s.tasks[k].model);
    $("[data-prov]", row).onchange = () => {
      const prov = $("[data-prov]", row).value;
      if (prov === "cli2api") {
        const defCli = $("#c2-cli")?.value || cliCatalog.default_cli || "agy";
        const list = cliCatalog.models_by_provider[defCli] || [];
        const defVal = k === "translate_para" ? (list.length ? `${defCli}/${list[0].submodel}` : defCli) : "";
        renderTaskCell(row, defVal);
      } else {
        renderTaskCell(row, "");
        $("[data-model]", row)?.focus();
      }
    };
  });

  async function loadCliCatalog(statusEl, refresh = false) {
    if (statusEl) { statusEl.className = "status-line"; statusEl.textContent = tr("در حال اتصال به CLI2API…", "Connecting to CLI2API…"); }
    try {
      const cat = await api(`/api/cli2api/catalog${refresh ? "?refresh=true" : ""}`);
      cliCatalog = cat;
      const dl = $("#dl-cli2api");
      if (dl) dl.innerHTML = (cat.all_models || []).map(m => `<option value="${esc(m)}">`).join("");
      const defSel = $("#c2-cli");
      const curDef = defSel.value || cat.default_cli || "agy";
      defSel.innerHTML = cat.providers.map(p => `<option value="${esc(p.id)}" ${p.id === curDef ? "selected" : ""}>${esc(p.id)} — ${esc(p.label)}</option>`).join("");
      $("#c2-clis").innerHTML = cat.providers.map(p => {
        const cnt = (cat.models_by_provider[p.id] || []).length;
        return `<span class="pill cli2api" title="${esc(p.label)}">${esc(p.id)}${cnt ? ` (${fa(cnt)})` : ""}</span>`;
      }).join("");
      // Re-render cli2api task rows preserving current selections
      $$(".task").forEach(row => {
        if ($("[data-prov]", row).value === "cli2api") {
          renderTaskCell(row, readTaskModel(row));
        }
      });
      if (statusEl) { statusEl.className = "status-line ok"; statusEl.textContent = tr(`متصل شد · ${fa(cat.providers.length)} CLI و ${fa((cat.all_models || []).length)} مدل پیدا شد`, `Connected · found ${fa(cat.providers.length)} CLIs and ${fa((cat.all_models || []).length)} models`); }
    } catch (e) {
      if (statusEl) { statusEl.className = "status-line bad"; statusEl.textContent = e.message; }
    }
  }

  const collect = () => {
    const num = id => +$("#" + id).value;
    const body = {
      cli2api: {
        base_url: $("#c2-url").value.trim(),
        default_cli: $("#c2-cli").value || "agy",
        cli_to_api_dir: $("#c2-dir").value.trim(),
        timeout: num("c2-timeout"),
        auto_start: $("#c2-auto").checked,
        json_mode: $("#c2-json").checked,
      },
      ollama: { base_url: $("#ol-url").value.trim(), embed_model: $("#ol-emb").value.trim(), num_ctx: num("ol-ctx"), num_ctx_page: num("ol-ctxp"), temperature: num("ol-temp"), keep_alive: $("#ol-keep").value.trim(), fallback_model: $("#ol-fb").value.trim() },
      openai: { base_url: $("#oa-url").value.trim(), auth: $("#oa-auth").value, api_version: $("#oa-ver").value.trim(), json_mode: $("#oa-json").checked, send_temperature: $("#oa-st").checked, temperature: num("oa-temp"), timeout: num("oa-timeout") },
      tasks: Object.fromEntries($$(".task").map(r => [r.dataset.task, { provider: $("[data-prov]", r).value, model: readTaskModel(r) }])),
      budget: { monthly_token_cap: num("b-cap"), price_in_per_m: num("b-pin"), price_out_per_m: num("b-pout"), fallback_to_ollama: $("#b-fb").checked },
      reading: { page_chunk_chars_ollama: num("r-pco"), page_chunk_chars_openai: num("r-pca"), page_chunk_chars_cli2api: num("r-pcc"), user_domain: $("#r-dom").value.trim(), obsidian_vault: $("#r-obs").value.trim(), auto_glossary: $("#r-ag").checked },
    };
    const key = $("#oa-key").value.trim(); if (key) body.openai.api_key = key;
    const c2key = $("#c2-key").value.trim(); if (c2key) body.cli2api.api_key = c2key;
    return body;
  };
  const save = async quiet => { await api("/api/settings", { method: "PUT", body: collect() }); if (!quiet) toast(tr("تنظیمات ذخیره شد", "Settings saved")); };
  $("#save").onclick = async () => { try { await save(); route(); } catch (e) { toast(e.message, true); } };
  $("#c2-test").onclick = async () => { await save(true); $("#c2-key").value = ""; loadCliCatalog($("#c2-st"), true); };
  $("#ol-test").onclick = async () => { await save(true); fetchModels("ollama", $("#ol-st")); };
  $("#oa-test").onclick = async () => { await save(true); $("#oa-key").value = ""; fetchModels("openai", $("#oa-st2")); };
  if ($("#oa-del")) $("#oa-del").onclick = async () => { await api("/api/settings/openai-key", { method: "DELETE" }); toast(tr("کلید حذف شد", "Key deleted")); route(); };
  if ($("#c2-del")) $("#c2-del").onclick = async () => { await api("/api/settings/cli2api-key", { method: "DELETE" }); toast(tr("کلید CLI2API حذف شد", "CLI2API key deleted")); route(); };
  loadCliCatalog($("#c2-st"), false);
  fetchModels("ollama", $("#ol-st"));
  if (s.openai.has_key) fetchModels("openai", $("#oa-st2"));
  $("#ui-lang").onchange = e => setLang(e.target.value);
  phoneCard();
}

async function phoneCard() {
  const el = $("#phone"); if (!el) return;
  let d;
  try { d = await api("/api/server"); } catch (e) { el.innerHTML = `<h2>${tr("خواندن روی گوشی", "Read on your phone")}</h2><div class="error-box">${esc(e.message)}</div>`; return; }
  const pending = d.lan !== d.active;
  el.innerHTML = `<h2>${tr("خواندن روی گوشی", "Read on your phone")}</h2>
    <div class="phone">
      <div class="phone-text">
        <label class="check"><input type="checkbox" id="lan" ${d.lan ? "checked" : ""}> ${tr(`اجازه بده گوشی‌ام از طریق Wi-Fi خانه به ورق وصل شود`, `Let my phone connect to Varagh over home Wi-Fi`)}</label>
        ${pending ? `<div class="banner" style="margin-top:8px"><span>${d.lan ? tr("برای روشن شدن، پنجره‌ی ورق را ببند و دوباره <b>run.bat</b> را اجرا کن.", "To turn this on, close the Varagh window and run <b>run.bat</b> (or run.sh) again.") : tr("برای خاموش شدن، پنجره‌ی ورق را ببند و دوباره <b>run.bat</b> را اجرا کن.", "To turn this off, close the Varagh window and run <b>run.bat</b> (or run.sh) again.")}</span></div>` : ""}
        ${d.active ? `<ol class="small">
          <li>${tr(`گوشی و لپ‌تاپ باید به یک Wi-Fi وصل باشند.`, `Your phone and laptop must be on the same Wi-Fi.`)}</li>
          <li>${tr(`کد QR را با دوربین گوشی اسکن کن (یا لینک را در مرورگر گوشی باز کن). این لینک یک کد ورود دارد؛ دستگاه‌های دیگر بدون آن راه ندارند.`, `Scan the QR code with your phone's camera (or open the link in the phone's browser). The link carries a login code; other devices can't get in without it.`)}</li>
          <li>${tr(`در مرورگر گوشی «Add to Home screen» را بزن تا ورق مثل یک اپ روی صفحه‌ی اصلی بنشیند.`, `In the phone's browser, tap “Add to Home screen” so Varagh sits on your home screen like an app.`)}</li>
          <li>${tr(`اگر ویندوز پرسید، به Python اجازه‌ی دسترسی در «Private networks» بده.`, `If Windows asks, allow Python access on “Private networks”.`)}</li></ol>
          ${d.urls.map(u => `<code class="url" dir="ltr">${esc(u)}</code>`).join("")}
          <div class="row-acts"><button class="btn sm ghost" id="tok">${tr(`ساختن کد ورود تازه (دستگاه‌های قبلی خارج می‌شوند)`, `Create a new login code (signs out other devices)`)}</button></div>`
        : `<p class="small muted">${tr(`وقتی روشن باشد، ورق روی همین لپ‌تاپ اجرا می‌شود و گوشی فقط صفحه‌ها را نشان می‌دهد؛ پس لپ‌تاپ باید روشن باشد.`, `When on, Varagh still runs on this laptop and the phone just shows the pages, so the laptop must stay on.`)}</p>`}
        <p class="small muted">${tr(`بدون لپ‌تاپ و بدون اینترنت: از زبانه‌ی «مرور» در صفحه‌ی خواندن، فصل یا کل کتاب را به یک فایل HTML تبدیل کن و روی گوشی باز کن. (نصب کامل آفلاین مرورگرها فقط روی HTTPS ممکن است.)`, `Without the laptop or internet: from the “Review” tab in the reader, export a chapter or the whole book as an HTML file and open it on your phone. (Full offline install in browsers only works over HTTPS.)`)}</p>
      </div>
      ${d.active && d.qr ? `<div class="qr" aria-label="${tr(`کد QR برای باز کردن ورق روی گوشی`, `QR code to open Varagh on your phone`)}">${d.qr}</div>` : ""}
    </div>`;
  const box = document.createElement("div");
  box.className = "card wide"; box.id = "datacard";
  box.innerHTML = `<h2>${tr("داده‌ها", "Data")}</h2>
    <p class="small muted">${tr(`کتاب‌ها، ترجمه‌ها، کارت‌ها و تنظیمات این‌جا نگه داشته می‌شوند. برای پشتیبان‌گیری همین پوشه را کپی کن:`, `Books, translations, cards and settings are kept here. To back up, copy this folder:`)}</p>
    <code class="url" dir="ltr">${esc(d.data_dir)}</code>
    <h3 style="margin-top:10px">${tr(`آوردن داده‌های نسخه‌ی قبلی`, `Import data from a previous version`)}</h3>
    <p class="small muted">${tr(`اگر قبلاً ورق را از فایل زیپ اجرا می‌کردی، مسیر پوشه‌ی آن (یا پوشه‌ی data داخلش) را بده تا کتاب‌ها و همه‌چیز به این نسخه بیاید. داده‌های فعلی جایگزین می‌شوند.`, `If you used to run Varagh from a zip file, enter that folder's path (or the data folder inside it) to bring your books and everything else into this version. Current data will be replaced.`)}</p>
    <div class="r2" style="grid-template-columns:minmax(0,1fr) auto"><input id="imp-path" class="ltr" placeholder="C:\\Users\\Ali\\Downloads\\varagh"><button class="btn" id="imp-go">${tr("آوردن داده‌ها", "Import data")}</button></div>`;
  document.getElementById("datacard")?.remove();
  el.after(box);
  $("#imp-go").onclick = async e => {
    const b = e.currentTarget;
    if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = tr("داده‌های فعلی جایگزین می‌شوند. مطمئنی؟", "Current data will be replaced. Sure?"); return; }
    try { await api("/api/import-data", { method: "POST", body: { path: $("#imp-path").value } }); toast(tr("داده‌ها آمدند", "Data imported")); location.hash = "#/"; }
    catch (err) { toast(err.message, true); b.dataset.sure = ""; b.textContent = tr("آوردن داده‌ها", "Import data"); }
  };
  $("#lan").onchange = async e => { await api("/api/server", { method: "PUT", body: { lan: e.target.checked } }); phoneCard(); };
  if ($("#tok")) $("#tok").onclick = async () => { await api("/api/server/token", { method: "POST" }); toast(tr("کد ورود تازه ساخته شد", "New login code created")); phoneCard(); };
}

/* ---------------------------------------------------------------- compare */
async function Compare() {
  const [books, { settings: s }] = await Promise.all([api("/api/books"), api("/api/settings")]);
  const ready = books.filter(b => b.status === "ready");
  const defaults = [s.tasks.translate_para, s.tasks.better, { provider: "ollama", model: "" }];
  view.innerHTML = `<div class="pagewrap-main">
    <div class="head"><div><h1>${tr(`مقایسه‌ی مدل‌ها`, `Compare models`)}</h1>
      <p>${tr(`چند پاراگراف از کتاب خودت را با چند مدل ترجمه کن و کنار هم ببین. مصرف OpenAI در این آزمون هم حساب می‌شود.`, `Translate a few paragraphs from your own book with several models and compare them side by side. OpenAI usage in this test counts too.`)}</p></div></div>
    <datalist id="dl-ollama"></datalist><datalist id="dl-openai"></datalist><datalist id="dl-cli2api"></datalist>
    ${ready.length ? `<div class="card" style="display:flex;flex-direction:column;gap:14px;max-width:900px">
      <div class="r2"><div class="field"><label for="c-book">${tr("کتاب", "Book")}</label><select id="c-book">${ready.map(b => `<option value="${b.id}">${esc(b.title)}</option>`).join("")}</select></div>
        <div class="field"><label for="c-page">${tr("صفحه", "Page")}</label><input id="c-page" type="number" min="1" value="${ready[0].last_page || 1}"></div></div>
      ${defaults.map((t, i) => `<div class="target">
        <select data-prov aria-label="${tr(`ارائه‌دهنده ${i + 1}`, `Provider ${i + 1}`)}"><option value="cli2api" ${t.provider === "cli2api" ? "selected" : ""}>CLI2API</option><option value="ollama" ${t.provider === "ollama" ? "selected" : ""}>Ollama</option><option value="openai" ${t.provider === "openai" ? "selected" : ""}>OpenAI</option></select>
        <input data-model class="ltr" list="dl-${t.provider}" value="${esc(t.model)}" placeholder="${tr(`نام مدل (خالی = نادیده)`, `Model name (empty = skip)`)}" aria-label="${tr(`مدل ${i + 1}`, `Model ${i + 1}`)}"></div>`).join("")}
      <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><button class="btn go" id="run">${ICON.play} ${tr("اجرای مقایسه", "Run comparison")}</button><span class="small muted" id="c-msg"></span></div>
    </div><div class="cmp-grid" id="out"></div>` : `<div class="card">${tr(`اول یک کتاب اضافه کن.`, `Add a book first.`)}</div>`}</div>`;
  if (!ready.length) return;
  fetchModels("cli2api"); fetchModels("ollama"); if (s.openai.has_key) fetchModels("openai");
  $$(".target").forEach(r => { const sel = $("[data-prov]", r), inp = $("[data-model]", r); sel.onchange = () => { inp.setAttribute("list", "dl-" + sel.value); inp.value = ""; }; });
  $("#run").onclick = async () => {
    const targets = $$(".target").map(r => ({ provider: $("[data-prov]", r).value, model: $("[data-model]", r).value.trim() })).filter(t => t.model);
    if (!targets.length) return toast(tr("حداقل یک مدل وارد کن", "Enter at least one model"), true);
    $("#run").disabled = true; $("#c-msg").textContent = tr("در حال ترجمه… مدل‌های محلی ممکن است کمی طول بکشند.", "Translating… local models may take a while.");
    $("#out").innerHTML = "";
    try {
      const d = await api("/api/compare", { method: "POST", body: { book_id: +$("#c-book").value, page: +$("#c-page").value, targets } });
      $("#out").innerHTML = `<div class="cmp-col src"><div class="h"><b>${tr("متن اصلی", "Original")}</b></div>${d.source.map(t => `<p>${esc(t)}</p>`).join("")}</div>` +
        d.results.map(r => `<div class="cmp-col"><div class="h">${providerPill(r.provider, r.model)}
          <span class="small muted">${tr(`${fa(r.seconds)} ثانیه · ${fa(r.in_tok)} ورودی · ${fa(r.out_tok)} خروجی`, `${fa(r.seconds)} s · ${fa(r.in_tok)} in · ${fa(r.out_tok)} out`)}</span></div>
          ${r.error ? `<div class="error-box">${esc(r.error)}</div>` : r.items.map(t => `<p>${esc(t)}</p>`).join("")}</div>`).join("");
      $("#c-msg").textContent = d.source.length ? "" : tr("این صفحه متنی برای مقایسه ندارد؛ صفحه‌ی دیگری انتخاب کن.", "This page has no text to compare; pick another page.");
    } catch (e) { toast(e.message, true); $("#c-msg").textContent = ""; }
    $("#run").disabled = false;
  };
}

route();
