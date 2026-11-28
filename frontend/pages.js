/* ورق — extra pages: evening review, search, statistics, and the end-of-session journal prompt.
   Loaded before app.js; uses its helpers ($, api, esc, fa, toast…) at call time. */
"use strict";

/* ---------------------------------------------------------------- end-of-session sentence */
function journalPrompt({ bookId, title, from, to, minutes }) {
  if (document.getElementById("jmodal")) return;
  const m = document.createElement("div");
  m.id = "jmodal"; m.className = "modal-back";
  m.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="jm-t">
    <span class="eyebrow-s">${tr(`پایان این جلسه · ${fa(minutes)} دقیقه`, `End of session · ${fa(minutes)} min`)}</span>
    <h2 id="jm-t">${tr(`امروز از «<span dir="auto">${esc(title)}</span>» چی فهمیدی؟`, `What did you take away from <span dir="auto">${esc(title)}</span> today?`)}</h2>
    <p class="small muted">${tr(`یک جمله با کلمه‌های خودت. همین یک جمله کمک می‌کند خلاصه‌ی امروز در ذهنت بماند، و کم‌کم دفترچه‌ی این کتاب می‌شود.`, `One sentence in your own words. It helps today's reading stick, and over time it becomes this book's journal.`)}</p>
    <textarea id="jm-text" rows="3" placeholder="${tr(`امروز فهمیدم که…`, `Today I learned that…`)}"></textarea>
    <div class="row-acts" style="justify-content:space-between"><button class="btn ghost" id="jm-skip">${tr(`این بار نه`, `Not now`)}</button><button class="btn primary" id="jm-save">${tr(`ثبت در دفترچه`, `Save to journal`)}</button></div></div>`;
  document.body.appendChild(m);
  const close = () => m.remove();
  $("#jm-text").focus();
  $("#jm-skip").onclick = close;
  m.addEventListener("click", e => { if (e.target === m) close(); });
  $("#jm-save").onclick = async () => {
    try { await api("/api/journal", { method: "POST", body: { book_id: bookId, text: $("#jm-text").value, page_from: from, page_to: to, minutes } }); toast(tr("در دفترچه ثبت شد", "Saved to journal")); close(); }
    catch (e) { toast(e.message, true); }
  };
}

/* ---------------------------------------------------------------- evening review */
function localMidnightISO(daysBack = 0) {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - daysBack);
  return d.toISOString();
}

async function Evening() {
  let back = 0;
  const load = async () => {
    const d = await api(`/api/evening?since=${encodeURIComponent(localMidnightISO(back))}`);
    const items = [];
    d.journal.forEach(j => items.push({ kind: "journal", j }));
    d.tags.forEach(t => items.push({ kind: "tag", t }));
    d.palace.forEach(p => items.push({ kind: "palace", p }));
    d.cards.forEach(c => items.push({ kind: "card", c }));
    render(d, items);
  };
  const head = d => `<div class="ev-head"><div><span class="eyebrow-s">${tr(`مرور شب`, `Evening review`)}</span>
      <h1>${back ? tr("دیروز و امروز چه خواندی؟", "What did you read yesterday and today?") : tr("امروز چه خواندی؟", "What did you read today?")}</h1>
      <p>${tr(`${fa(Math.round(d.seconds / 60))} دقیقه خواندن · ${fa(d.pages)} صفحه`, `${fa(Math.round(d.seconds / 60))} min reading · ${fa(d.pages)} pages`)}</p></div>
      <div class="seg" id="ev-range"><button data-v="0" class="${back ? "" : "on"}">${tr("امروز", "Today")}</button><button data-v="1" class="${back ? "on" : ""}">${tr(`از دیروز`, `Since yesterday`)}</button></div></div>`;
  const render = (d, items) => {
    if (!items.length) {
      view.innerHTML = `<div class="evening">${head(d)}<div class="ev-card"><b>${tr(`چیزی برای مرور نیست`, `Nothing to review`)}</b>
        <p class="muted">${tr(`موقع خواندن، پاراگراف‌هایی را که دوست داشتی یا شگفت‌زده‌ات کرد علامت بزن، یک جمله در دفترچه بنویس یا کلمه‌ای کارت کن؛ شب این‌جا دوباره می‌بینی‌شان. مرور کوتاه پیش از خواب به جا افتادن حافظه کمک می‌کند.`, `While reading, mark paragraphs you loved or that surprised you, write a sentence in the journal, or turn a word into a card; you'll see them here again in the evening. A short review before sleep helps memory settle.`)}</p>
        <a class="btn" href="#/">${tr(`رفتن به کتابخانه`, `Go to library`)}</a></div></div>`;
      bindRange(); return;
    }
    let i = 0, shown = false;
    const step = () => {
      const it = items[i];
      let inner = "";
      if (!it) {
        inner = `<div class="ev-card done"><span class="eyebrow-s">${tr(`تمام شد`, `Done`)}</span><b class="big">${tr(`شب بخیر`, `Good night`)}</b>
          <p class="muted">${tr(`${fa(items.length)} چیز را مرور کردی. فردا صبح کارت‌های موعددار منتظرت هستند.`, `You reviewed ${fa(items.length)} items. Tomorrow morning your due cards will be waiting.`)}</p><a class="btn" href="#/cards">${tr("کارت‌ها", "Cards")}</a></div>`;
      } else if (it.kind === "journal") {
        inner = `<div class="ev-card"><span class="eyebrow-s">${tr(`جمله‌ی خودت`, `Your sentence`)} · <span dir="auto">${esc(it.j.title || "")}</span></span><p class="ev-quote">${esc(it.j.text)}</p>
          <button class="btn primary" data-next>${tr("بعدی", "Next")}</button></div>`;
      } else if (it.kind === "tag") {
        const lab = it.t.tag === "love" ? tr("دوستش داشتی", "You loved this") : tr("شگفت‌زده‌ات کرد", "This surprised you");
        inner = `<div class="ev-card"><span class="eyebrow-s">${lab} · <span dir="auto">${esc(it.t.title || "")}</span> · ${tr("ص", "p.")} ${fa(it.t.page)}</span>
          ${it.t.fa ? `<p class="ev-quote">${esc(it.t.fa)}</p>` : ""}<p class="ev-en" dir="ltr">${esc(it.t.text)}</p>
          <p class="small muted">${tr(`چرا این تکه برایت مهم بود؟ یک لحظه به آن فکر کن.`, `Why did this passage matter to you? Think about it for a moment.`)}</p><button class="btn primary" data-next>${tr("بعدی", "Next")}</button></div>`;
      } else if (it.kind === "palace") {
        inner = `<div class="ev-card"><span class="eyebrow-s">${tr("قصر حافظه", "Memory palace")} · ${esc(trS(it.p.room))} · ${esc(trS(it.p.spot_name))}</span>
          <p class="ev-quote">${esc(it.p.cue || tr("این‌جا چه گذاشته بودی؟", "What did you leave here?"))}</p>
          ${shown ? `<p class="ev-ans">${esc(it.p.idea)}</p><button class="btn primary" data-next>${tr("بعدی", "Next")}</button>` : `<button class="btn" data-show>${tr(`چه چیزی این‌جا بود؟`, `What was here?`)}</button>`}</div>`;
      } else {
        inner = `<div class="ev-card"><span class="eyebrow-s">${tr(`کارت امروز`, `Today's card`)} · <span dir="auto">${esc(it.c.title || "")}</span></span>
          <p class="ev-word" dir="auto">${esc(it.c.front)}</p>${it.c.context ? `<p class="ev-en" dir="ltr">${esc(it.c.context)}</p>` : ""}
          ${shown ? `<p class="ev-ans">${esc(it.c.back)}</p><button class="btn primary" data-next>${tr("بعدی", "Next")}</button>` : `<button class="btn" data-show>${tr(`معنی‌اش چه بود؟`, `What did it mean?`)}</button>`}</div>`;
      }
      view.innerHTML = `<div class="evening">${head(d)}<div class="ev-prog">${items.map((_, k) => `<i class="${k < i ? "done" : k === i ? "cur" : ""}"></i>`).join("")}</div>${inner}</div>`;
      bindRange();
      const nx = $("[data-next]"); if (nx) { nx.onclick = () => { i++; shown = false; step(); }; nx.focus(); }
      const sh = $("[data-show]"); if (sh) { sh.onclick = () => { shown = true; step(); }; sh.focus(); }
    };
    step();
  };
  const bindRange = () => $$("#ev-range button").forEach(b => b.onclick = () => { back = +b.dataset.v; load(); });
  await load();
}

/* ---------------------------------------------------------------- search */
async function Search() {
  const [idx, books, { settings }] = await Promise.all([api("/api/index"), api("/api/books"), api("/api/settings")]);
  const model = settings.ollama.embed_model;
  let lastQ = "";
  view.innerHTML = `<div class="pagewrap-main">
    <div class="head"><div><h1>${tr(`جست‌وجو در کتاب‌ها`, `Search your books`)}</h1>
      <p>${model ? tr(`جست‌وجوی معنایی با <span class="en" dir="ltr">${esc(model)}</span>؛ می‌توانی فارسی یا انگلیسی بپرسی، مثلاً «کجا درباره‌ی تنهایی خواندم؟».`, `Semantic search with <span class="en" dir="ltr">${esc(model)}</span>. Ask in English or Persian, e.g. “where did I read about solitude?”`) : tr(`جست‌وجوی معنایی خاموش است و نتیجه‌ها بر اساس کلمه‌اند. برای روشن کردنش در <a href="#/settings">تنظیمات</a> «مدل جست‌وجوی معنایی» را بگذار.`, `Semantic search is off, so results are keyword-based. To turn it on, set the “semantic search model” in <a href="#/settings">Settings</a>.`)}</p></div></div>
    <form class="searchbar" id="sform"><input id="sq" type="search" placeholder="${tr(`درباره‌ی چه می‌گردی؟`, `What are you looking for?`)}" aria-label="${tr("جست‌وجو", "Search")}" autocomplete="off">
      <select id="sbook" aria-label="${tr("کتاب", "Book")}"><option value="0">${tr("همه‌ی کتاب‌ها", "All books")}</option>${books.filter(b => b.status === "ready").map(b => `<option value="${b.id}">${esc(b.title)}</option>`).join("")}</select>
      <button class="btn primary">${tr("جست‌وجو", "Search")}</button></form>
    <div id="sres"></div>
    ${model ? `<div class="card"><h2>${tr(`ایندکس معنایی کتاب‌ها`, `Semantic index`)}</h2><p class="small muted">${tr(`هر کتاب یک بار روی Ollama ایندکس می‌شود (رایگان و آفلاین). تا وقتی ایندکس کامل نشده، فقط بخش ایندکس‌شده جست‌وجو می‌شود.`, `Each book is indexed once with Ollama (free and offline). Until indexing finishes, only the indexed part is searched.`)}</p>
      <div id="idx">${idxRows(idx.books)}</div></div>` : ""}</div>`;
  const run = async e => {
    e && e.preventDefault();
    const q = $("#sq").value.trim(); if (!q) return;
    lastQ = q;
    $("#sres").innerHTML = `<p class="muted small">${tr(`در حال جست‌وجو…`, `Searching…`)}</p>`;
    try {
      const r = await api(`/api/search?q=${encodeURIComponent(q)}&book_id=${$("#sbook").value}`);
      if (q !== lastQ) return;
      const words = q.split(/\s+/).filter(w => w.length > 2).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const mark = t => words.length && !r.semantic ? esc(t).replace(new RegExp(`(${words.join("|")})`, "gi"), "<mark>$1</mark>") : esc(t);
      $("#sres").innerHTML = (r.note ? `<p class="small muted">${esc(r.note)}</p>` : "") + (r.results.length ? `<div class="results">${r.results.map(x => `
        <button class="result" data-b="${x.book_id}" data-p="${x.page}" data-id="${x.id}">
          <span class="rmeta"><b dir="auto">${esc(x.title)}</b> · ${tr("ص", "p.")} ${fa(x.page)}${r.semantic ? `<span class="score" title="${tr(`میزان نزدیکی معنایی`, `Semantic similarity`)}"><i style="width:${Math.max(4, Math.round(x.score * 100))}%"></i></span>` : ""}</span>
          ${x.fa ? `<span class="rfa">${mark(x.fa.slice(0, 260))}</span>` : ""}<span class="ren" dir="ltr">${mark(x.text.slice(0, 260))}</span></button>`).join("")}</div>`
        : `<p class="muted">${tr(`چیزی پیدا نشد.`, `Nothing found.`)}</p>`);
      $$(".result").forEach(b => b.onclick = () => { try { sessionStorage.setItem("varagh.flash", b.dataset.id); } catch {} location.hash = `#/read/${b.dataset.b}/${b.dataset.p}`; });
    } catch (err) { $("#sres").innerHTML = `<div class="error-box">${esc(err.message)}</div>`; }
  };
  $("#sform").onsubmit = run;
  $("#sq").focus();
  const bindIdx = () => $$("[data-index]").forEach(b => b.onclick = async () => {
    try { await api(`/api/books/${b.dataset.index}/index`, { method: "POST" }); poll(); } catch (e) { toast(e.message, true); }
  });
  const poll = async () => {
    const d = await api("/api/index"); const el = $("#idx"); if (!el) return;
    el.innerHTML = idxRows(d.books); bindIdx();
    if (d.books.some(b => b.running)) { const t = setTimeout(poll, 2000); onLeave(() => clearTimeout(t)); }
  };
  bindIdx();
  if (idx.books.some(b => b.running)) poll();
}
function idxRows(list) {
  if (!list.length) return `<p class="small muted">${tr(`هنوز کتابی نداری.`, `No books yet.`)}</p>`;
  return list.map(b => {
    const pct = b.total ? Math.round(b.done / b.total * 100) : 0;
    return `<div class="idxrow"><b dir="auto">${esc(b.title)}</b><div class="progress"><i style="width:${pct}%"></i></div>
      <span class="small muted">${fa(pct)}${PCT}</span>${b.running ? `<span class="pill busy">${tr(`در حال ایندکس`, `Indexing`)}</span>` : pct < 100 ? `<button class="btn sm" data-index="${b.id}">${b.done ? tr("ادامه", "Resume") : tr("ایندکس کن", "Index")}</button>` : `<span class="pill ollama">${tr("آماده", "Ready")}</span>`}</div>`;
  }).join("");
}

/* ---------------------------------------------------------------- statistics */
function localDayStr(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
const TAGC = { wow: "var(--c-wow)", unclear: "var(--c-unclear)", love: "var(--c-love)" };
const TAGN = { wow: tr("شگفت‌زده", "Surprised"), unclear: tr("مبهم", "Unclear"), love: tr("دوست داشتم", "Loved") };

async function Stats() {
  const s = await api(`/api/stats?today=${localDayStr()}`);
  const tile = (v, l, sub = "") => `<div class="kpi"><b>${v}</b><span>${l}</span>${sub ? `<small>${sub}</small>` : ""}</div>`;
  view.innerHTML = `<div class="pagewrap-main">
    <div class="head"><div><h1>${tr(`آمار یادگیری`, `Learning stats`)}</h1><p>${tr(`همه‌ی این‌ها روی همین کامپیوتر حساب می‌شود.`, `Everything is calculated locally on this computer.`)}</p></div></div>
    <div class="kpis">
      ${tile(fa(s.streak), tr("روز پشت سر هم", "day streak"), s.streak ? tr("هر روز حداقل یک دقیقه", "at least a minute every day") : tr("امروز شروع کن", "start today"))}
      ${tile(fa(Math.round(s.minutes / 60 * 10) / 10), tr("ساعت خواندن", "hours read"), tr(`${fa(s.pages)} صفحه`, `${fa(s.pages)} pages`))}
      ${tile(s.wpm ? fa(s.wpm) : "—", tr("کلمه در دقیقه", "words per minute"), s.wpm ? tr("سرعت خواندن متن اصلی", "reading speed of the original") : tr("بعد از چند جلسه حساب می‌شود", "calculated after a few sessions"))}
      ${tile(fa(s.cards), tr("کارت", "cards"), tr(`${fa(s.mature)} کارت جاافتاده`, `${fa(s.mature)} mature`))}
      ${tile(fa(s.journal), tr("جمله در دفترچه", "journal sentences"))}
      ${tile(fa(s.palace), tr("چیز در قصر حافظه", "memory palace items"))}
    </div>
    <section class="card chartcard"><h2>${tr(`دقیقه‌های خواندن در ۳۰ روز اخیر`, `Reading minutes, last 30 days`)}</h2><div class="chart" id="ch-daily"></div></section>
    <section class="card chartcard"><h2>${tr(`رشد واژگان (تعداد کارت‌ها)`, `Vocabulary growth (cards)`)}</h2><div class="chart" id="ch-growth"></div></section>
    <section class="card chartcard"><h2>${tr(`هر فصل چقدر در ذهنت مانده`, `How much of each chapter you remember`)}</h2>
      <p class="small muted">${tr(`احتمال این‌که همین الان کارت‌های هر فصل یادت بیاید (از روی برنامه‌ی FSRS) و نتیجه‌ی قدم زدن در قصر حافظه. هرچه کوتاه‌تر، وقت مرور است.`, `The chance you'd recall each chapter's cards right now (from the FSRS schedule) plus your memory-palace walks. The shorter the bar, the more it's time to review.`)}</p>
      <div id="ch-ret"></div></section>
    <section class="card chartcard"><h2>${tr(`مسیر احساسی کتاب‌ها`, `Emotional arc of your books`)}</h2>
      <p class="small muted">${tr(`برچسب‌هایی که موقع خواندن زدی، در طول هر کتاب.`, `The reactions you tagged while reading, across each book.`)}</p><div id="ch-arcs"></div></section></div>`;
  barChart($("#ch-daily"), s.daily.map(d => ({ x: d.day, y: d.minutes, label: `${new Date(d.day + "T12:00").toLocaleDateString(LOCALE, { day: "numeric", month: "short" })}: ${tr(`${fa(d.minutes)} دقیقه، ${fa(d.pages)} صفحه`, `${fa(d.minutes)} min, ${fa(d.pages)} pages`)}` })));
  lineChart($("#ch-growth"), [{ name: tr("کارت‌ها", "Cards"), color: "var(--accent)", pts: s.growth.map(g => ({ x: g.day, y: g.total })) }],
    s.growth.map(g => g.day), d => new Date(d + "T12:00").toLocaleDateString(LOCALE, { day: "numeric", month: "short" }));
  const ret = $("#ch-ret");
  if (!s.retention.length) ret.innerHTML = `<p class="muted small">${tr(`هنوز داده‌ای نیست. کارت بساز و مرورشان کن، یا در قصر حافظه قدم بزن.`, `No data yet. Make some cards and review them, or take a walk through the memory palace.`)}</p>`;
  else {
    let lastBook = null;
    ret.innerHTML = s.retention.map(r => {
      const head = r.book_id !== lastBook ? `<h3 class="rbook" dir="auto">${esc(r.book)}</h3>` : ""; lastBook = r.book_id;
      return `${head}<div class="hbar" title="${tr(`${fa(r.n)} مورد`, `${fa(r.n)} items`)}"><span class="hl" dir="auto">${esc(trS(r.chapter))}</span>
        <span class="htrack"><i style="width:${r.value}%;background:var(--accent)"></i></span><span class="hv">${fa(r.value)}${PCT}</span></div>`;
    }).join("");
  }
  const arcs = $("#ch-arcs");
  if (!s.arcs.length) arcs.innerHTML = `<p class="muted small">${tr(`هنوز برچسبی نزده‌ای. موقع خواندن، دکمه‌های کوچک کنار هر پاراگراف را بزن.`, `No tags yet. While reading, use the small buttons next to each paragraph.`)}</p>`;
  else arcs.innerHTML = s.arcs.map((a, i) => `<h3 class="rbook" dir="auto">${esc(a.book)}</h3><div class="chart" id="arc-${i}"></div>`).join("");
  s.arcs.forEach((a, i) => {
    const xs = Array.from({ length: a.bins }, (_, k) => k);
    lineChart($(`#arc-${i}`), Object.keys(TAGN).map(k => ({ name: TAGN[k], color: TAGC[k], pts: xs.map(x => ({ x, y: a.series[k][x] })) })),
      xs, x => `${tr("ص", "p.")} ${fa(Math.round(x * a.size + 1))}`, true);
  });
}

/* ---- small SVG charts (one y-axis, thin marks, recessive grid, hover tooltip) */
function niceMax(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; }
function chartTip(el) {
  let tip = el.querySelector(".ctip"); if (!tip) { tip = document.createElement("div"); tip.className = "ctip"; tip.hidden = true; el.appendChild(tip); }
  return tip;
}
function barChart(el, data) {
  const W = 760, H = 220, L = 34, R = 8, T = 10, B = 26;
  const max = niceMax(Math.max(...data.map(d => d.y), 1));
  const bw = (W - L - R) / data.length;
  const y = v => T + (H - T - B) * (1 - v / max);
  const ticks = [0, max / 2, max];
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${tr(`نمودار ستونی`, `Bar chart`)}">
    ${ticks.map(t => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${fa(t)}</text>`).join("")}
    ${data.map((d, i) => {
      const h = Math.max(0, H - B - y(d.y)), x = L + i * bw + 2;
      return `<g class="bar" data-i="${i}"><rect class="hit" x="${L + i * bw}" y="${T}" width="${bw}" height="${H - T - B}"/>
        ${d.y > 0 ? `<path d="M${x},${H - B} V${H - B - h + Math.min(4, h)} q0,-${Math.min(4, h)} ${Math.min(4, h)},-${Math.min(4, h)} H${x + bw - 4 - Math.min(4, h)} q${Math.min(4, h)},0 ${Math.min(4, h)},${Math.min(4, h)} V${H - B} Z" fill="var(--accent)"/>` : ""}</g>`;
    }).join("")}
    ${[0, Math.floor(data.length / 2), data.length - 1].map(i => `<text class="axis" x="${L + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle">${new Date(data[i].x + "T12:00").toLocaleDateString(LOCALE, { day: "numeric", month: "short" })}</text>`).join("")}
  </svg>`;
  const tip = chartTip(el);
  $$(".bar", el).forEach(g => {
    g.onmouseenter = e => { const d = data[+g.dataset.i]; tip.textContent = d.label; tip.hidden = false; moveTip(el, tip, e); g.classList.add("on"); };
    g.onmousemove = e => moveTip(el, tip, e);
    g.onmouseleave = () => { tip.hidden = true; g.classList.remove("on"); };
  });
}
function lineChart(el, series, xs, fmtX, legend = false) {
  const W = 760, H = 200, L = 34, R = 70, T = 10, B = 26;
  const max = niceMax(Math.max(1, ...series.flatMap(s => s.pts.map(p => p.y))));
  const n = Math.max(1, xs.length - 1);
  const x = i => L + (W - L - R) * (i / n), y = v => T + (H - T - B) * (1 - v / max);
  el.innerHTML = `${legend ? `<div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join("")}</div>` : ""}
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${tr(`نمودار خطی`, `Line chart`)}">
    ${[0, max / 2, max].map(t => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${fa(t)}</text>`).join("")}
    ${series.map(s => `<path d="${s.pts.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.y)}`).join(" ")}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      ${s.pts.length ? `<circle cx="${x(s.pts.length - 1)}" cy="${y(s.pts[s.pts.length - 1].y)}" r="4" fill="${s.color}" stroke="var(--paper)" stroke-width="2"/>
      <text class="dlabel" x="${x(s.pts.length - 1) + 8}" y="${y(s.pts[s.pts.length - 1].y) + 4}">${legend ? s.name : fa(s.pts[s.pts.length - 1].y)}</text>` : ""}`).join("")}
    ${[0, Math.floor(n / 2), n].map(i => `<text class="axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${fmtX(xs[i])}</text>`).join("")}
    <line class="cross" id="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
    <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/></svg>`;
  const tip = chartTip(el), svg = el.querySelector("svg"), cross = el.querySelector(".cross");
  svg.onmousemove = e => {
    const r = svg.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * W;
    const i = Math.max(0, Math.min(n, Math.round((px - L) / (W - L - R) * n)));
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    tip.innerHTML = `<b>${fmtX(xs[i])}</b>` + series.map(s => `<div><i style="background:${s.color}"></i>${s.name}: ${fa(s.pts[i]?.y ?? 0)}</div>`).join("");
    tip.hidden = false; moveTip(el, tip, e);
  };
  svg.onmouseleave = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); };
}
function moveTip(el, tip, e) {
  const r = el.getBoundingClientRect();
  let left = e.clientX - r.left + 12; if (left + tip.offsetWidth > r.width) left = e.clientX - r.left - tip.offsetWidth - 12;
  tip.style.left = Math.max(0, left) + "px"; tip.style.top = (e.clientY - r.top - 10) + "px";
}
