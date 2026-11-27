/* ورق — Deep Learning UI (all 10 features):
   X-Ray, Socratic Tutor, Feynman Check, Concept & Argument Graph, Conceptual/Cloze Cards,
   4-Level Depth Explain, Devil's Advocate Critique, Density Heatmap, Visual Region Analyzer,
   Cross-Book Second Brain & Obsidian Sync, plus URL/Text Ingestion modal. */
"use strict";

/* KaTeX math renderer with clean Unicode fallback if offline */
window.renderTex = function renderTex(expr, displayMode = false) {
  const clean = String(expr || "").trim();
  if (!clean) return "";
  if (typeof window !== "undefined" && window.katex && window.katex.renderToString) {
    try {
      return window.katex.renderToString(clean, { displayMode, throwOnError: false, strict: false });
    } catch {}
  }
  // Fallback prettifier if KaTeX CDN is unreachable
  const sym = {
    "\\omega": "ω", "\\alpha": "α", "\\beta": "β", "\\gamma": "γ", "\\theta": "θ", "\\lambda": "λ",
    "\\sigma": "σ", "\\mu": "μ", "\\pi": "π", "\\sum": "∑", "\\prod": "∏", "\\int": "∫",
    "\\infty": "∞", "\\le": "≤", "\\ge": "≥", "\\neq": "≠", "\\approx": "≈", "\\times": "×", "\\cdot": "·",
  };
  let s = clean;
  for (const [k, v] of Object.entries(sym)) s = s.split(k).join(v);
  s = s.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, "($1)/($2)").replace(/[{}]/g, "");
  return displayMode ? `<div class="md-math-block" dir="ltr">${esc(s)}</div>` : `<span class="md-math" dir="ltr">${esc(s)}</span>`;
};

/* Safe math evaluator for interactive plots */
function compileExpr(expr, paramNames) {
  let s = String(expr || "x").trim()
    .replace(/\^/g, "**")
    .replace(/\b(sin|cos|tan|exp|log|sqrt|abs|pow|tanh|min|max)\b/g, "Math.$1")
    .replace(/\bPI\b/g, "Math.PI")
    .replace(/\bE\b/g, "Math.E");
  // Strict allowlist check: only identifiers we know + math operators/digits
  const allowed = new Set(["x", "Math", "sin", "cos", "tan", "exp", "log", "sqrt", "abs", "pow", "tanh", "min", "max", "PI", "E", "sigmoid", ...paramNames]);
  const ids = s.match(/[A-Za-z_][A-Za-z0-9_]*/g) || [];
  for (const id of ids) {
    if (!allowed.has(id)) return () => NaN;
  }
  if (/[;{}\[\]=`"'\\]/.test(s)) return () => NaN;
  try {
    const fn = new Function("x", "sigmoid", ...paramNames, `"use strict"; return (${s});`);
    const sig = v => 1 / (1 + Math.exp(-v));
    return (x, pvals) => {
      try { const y = fn(x, sig, ...pvals); return Number.isFinite(y) ? y : NaN; }
      catch { return NaN; }
    };
  } catch { return () => NaN; }
}

window.mountInteractivePlot = function mountInteractivePlot(el, spec) {
  if (!el || !spec || !Array.isArray(spec.curves) || !spec.curves.length) return;
  const params = Array.isArray(spec.params) ? spec.params : [];
  const pNames = params.map(p => p.name);
  const state = params.map(p => Number(p.default ?? 1));
  const xMin = Number(spec.x_min ?? -5), xMax = Number(spec.x_max ?? 5);
  const fns = spec.curves.map(c => compileExpr(c.expr, pNames));
  const colors = ["#2159A0", "#E3A92B", "#2D7A57", "#B23A5B", "#6A4BA6"];

  el.innerHTML = `<div class="iplot">
    <div class="iplot-head"><b>📊 ${esc(spec.title || "نمودار تعاملی")}</b>
      <div class="iplot-leg">${spec.curves.map((c, i) => `<span><i style="background:${c.color || colors[i % colors.length]}"></i>${esc(c.label || c.expr)}</span>`).join("")}</div>
    </div>
    <svg class="iplot-svg" viewBox="0 0 520 250" role="img" aria-label="نمودار تعاملی"></svg>
    ${params.length ? `<div class="iplot-sliders">${params.map((p, i) => `
      <label class="islider">
        <span class="isl-top"><span>${esc(p.label || p.name)}</span><b dir="ltr" data-val="${i}">${state[i]}</b></span>
        <input type="range" data-p="${i}" min="${p.min ?? -5}" max="${p.max ?? 5}" step="${p.step ?? 0.1}" value="${state[i]}">
      </label>`).join("")}</div>` : ""}
  </div>`;

  const svg = $(".iplot-svg", el);
  const draw = () => {
    const W = 520, H = 250, L = 42, R = 16, T = 14, B = 28;
    const N = 120;
    const series = fns.map(fn => {
      const pts = [];
      for (let i = 0; i <= N; i++) {
        const x = xMin + (xMax - xMin) * (i / N);
        const y = fn(x, state);
        if (Number.isFinite(y) && Math.abs(y) < 1e4) pts.push([x, y]);
        else pts.push(null);
      }
      return pts;
    });
    const ys = series.flat().filter(Boolean).map(p => p[1]);
    let yMin = ys.length ? Math.min(...ys, -1) : -5;
    let yMax = ys.length ? Math.max(...ys, 1) : 5;
    if (yMax - yMin < 1e-3) { yMin -= 2; yMax += 2; }
    const pad = (yMax - yMin) * 0.1; yMin -= pad; yMax += pad;
    const sx = x => L + (W - L - R) * ((x - xMin) / (xMax - xMin));
    const sy = y => T + (H - T - B) * (1 - (y - yMin) / (yMax - yMin));

    const y0 = yMin <= 0 && yMax >= 0 ? sy(0) : null;
    const x0 = xMin <= 0 && xMax >= 0 ? sx(0) : null;
    const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
      const yv = yMin + (yMax - yMin) * f, yp = sy(yv);
      return `<line x1="${L}" x2="${W - R}" y1="${yp}" y2="${yp}" stroke="var(--line)" stroke-dasharray="3 3"/>
        <text x="${L - 6}" y="${yp + 3}" text-anchor="end" font-size="10" fill="var(--muted)">${yv.toFixed(1)}</text>`;
    }).join("");
    const xticks = [0, 0.5, 1].map(f => {
      const xv = xMin + (xMax - xMin) * f, xp = sx(xv);
      return `<text x="${xp}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--muted)">${xv.toFixed(1)}</text>`;
    }).join("");
    const axes = (y0 !== null ? `<line x1="${L}" x2="${W - R}" y1="${y0}" y2="${y0}" stroke="var(--muted)" stroke-width="1.2"/>` : "")
      + (x0 !== null ? `<line x1="${x0}" x2="${x0}" y1="${T}" y2="${H - B}" stroke="var(--muted)" stroke-width="1.2"/>` : "");
    const paths = series.map((pts, ci) => {
      let d = "", pen = false;
      for (const p of pts) {
        if (!p) { pen = false; continue; }
        d += `${pen ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)} `;
        pen = true;
      }
      return d ? `<path d="${d}" fill="none" stroke="${spec.curves[ci].color || colors[ci % colors.length]}" stroke-width="2.5" stroke-linecap="round"/>` : "";
    }).join("");

    svg.innerHTML = `${grid}${axes}${paths}${xticks}
      <text x="${W - R}" y="${H - 8}" text-anchor="end" font-size="10" font-weight="700" fill="var(--ink)">${esc(spec.x_label || "x")}</text>
      <text x="${L + 6}" y="${T + 10}" text-anchor="start" font-size="10" font-weight="700" fill="var(--ink)">${esc(spec.y_label || "y")}</text>`;
  };
  draw();
  $$("input[data-p]", el).forEach(inp => inp.oninput = () => {
    const i = +inp.dataset.p;
    state[i] = Number(inp.value);
    const vEl = $(`[data-val="${i}"]`, el); if (vEl) vEl.textContent = state[i];
    draw();
  });
};

window.hydratePlots = function hydratePlots(root) {
  if (!root) return;
  $$("[data-plot-json]", root).forEach(el => {
    if (el.dataset.mounted) return;
    el.dataset.mounted = "1";
    try { mountInteractivePlot(el, JSON.parse(el.dataset.plotJson)); } catch {}
  });
};

/* Lightweight, safe, RTL-friendly Markdown + KaTeX + Interactive Plot renderer */
window.renderMd = function renderMd(src) {
  if (!src) return "";
  const blocks = [];
  let text = String(src).replace(/\r\n/g, "\n");
  // Normalize \[...\] and \(...\) to $$...$$ and $...$
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_, e) => `$$${e}$$`);
  text = text.replace(/\\\((.+?)\\\)/g, (_, e) => `$${e}$`);

  // Interactive plot fenced block ```plot ... ```
  text = text.replace(/```plot\s*\n([\s\S]*?)```/g, (_, rawJson) => {
    const idx = blocks.length;
    blocks.push(`<div class="md-plot" data-plot-json="${esc(rawJson.trim())}"></div>`);
    return `\n\n@@BLK${idx}@@\n\n`;
  });
  // Fenced code blocks
  text = text.replace(/```([a-zA-Z0-9_-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = blocks.length;
    blocks.push(`<pre class="md-pre" dir="ltr"><code>${esc(code.replace(/\n$/, ""))}</code></pre>`);
    return `\n\n@@BLK${idx}@@\n\n`;
  });
  // Display math $$...$$
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => {
    const idx = blocks.length;
    blocks.push(`<div class="md-katex-display" dir="ltr">${renderTex(expr, true)}</div>`);
    return `\n\n@@BLK${idx}@@\n\n`;
  });

  const inline = s => {
    const mathTokens = [];
    let tmp = String(s).replace(/\$([^$\n]+)\$/g, (_, expr) => {
      const idx = mathTokens.length;
      mathTokens.push(`<span class="md-katex-inline" dir="ltr">${renderTex(expr, false)}</span>`);
      return `@@M${idx}@@`;
    });
    let out = esc(tmp);
    out = out.replace(/`([^`\n]+)`/g, '<code class="md-code" dir="ltr">$1</code>');
    out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/(^|[\s(«])\*([^*\n]+)\*(?=[\s.,;:!?»)]|$)/g, "$1<em>$2</em>");
    out = out.replace(/@@M(\d+)@@/g, (_, i) => mathTokens[+i] || "");
    return out;
  };

  const lines = text.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const trim = raw.trim();
    if (!trim) { i++; continue; }

    const cm = trim.match(/^@@BLK(\d+)@@$/);
    if (cm) { out.push(blocks[+cm[1]]); i++; continue; }

    if (/^[-*_]{3,}$/.test(trim)) { out.push('<hr class="md-hr">'); i++; continue; }

    const hm = trim.match(/^(#{1,4})\s+(.+)$/);
    if (hm) {
      const lvl = Math.min(4, hm[1].length + 1);
      out.push(`<h${lvl} class="md-h">${inline(hm[2])}</h${lvl}>`);
      i++; continue;
    }

    if (trim.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1])) {
      const parseRow = ln => ln.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map(c => c.trim());
      const head = parseRow(raw);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().includes("|")) { rows.push(parseRow(lines[i])); i++; }
      out.push(`<div class="md-tbl-wrap"><table class="md-tbl"><thead><tr>${head.map(h => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
      continue;
    }

    if (trim.startsWith(">")) {
      const bq = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) { bq.push(inline(lines[i].trim().replace(/^>\s?/, ""))); i++; }
      out.push(`<blockquote class="md-bq">${bq.join("<br>")}</blockquote>`);
      continue;
    }

    if (/^[-*•]\s+/.test(trim)) {
      const items = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) { items.push(`<li>${inline(lines[i].trim().replace(/^[-*•]\s+/, ""))}</li>`); i++; }
      out.push(`<ul class="md-ul">${items.join("")}</ul>`);
      continue;
    }

    if (/^\d+[.)]\s+/.test(trim)) {
      const items = [];
      while (i < lines.length && /^\d+[.)]\s+/.test(lines[i].trim())) { items.push(`<li>${inline(lines[i].trim().replace(/^\d+[.)]\s+/, ""))}</li>`); i++; }
      out.push(`<ol class="md-ol">${items.join("")}</ol>`);
      continue;
    }

    const para = [];
    while (i < lines.length) {
      const t = lines[i].trim();
      if (!t || /^@@BLK\d+@@$/.test(t) || /^#{1,4}\s+/.test(t) || /^[-*•]\s+/.test(t) || /^\d+[.)]\s+/.test(t) || t.startsWith(">") || /^[-*_]{3,}$/.test(t)) break;
      para.push(inline(t)); i++;
    }
    if (para.length) out.push(`<p class="md-p">${para.join("<br>")}</p>`);
  }
  return `<div class="md">${out.join("")}</div>`;
};

window.Deep = (() => {
  /* ---------------- Add URL / Paste-Text modal (Library) ---------------- */
  function openAddModal(onDone) {
    if ($("#addmodal")) return;
    const m = document.createElement("div");
    m.id = "addmodal"; m.className = "modal-back";
    m.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="max-width:560px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2>افزودن مقاله، لینک یا متن</h2>
        <button class="btn icon ghost" id="am-x" aria-label="بستن">${ICON.close}</button>
      </div>
      <div class="seg" id="am-tabs" style="align-self:flex-start">
        <button data-v="url" class="on">از لینک وب / ArXiv</button>
        <button data-v="text">چسباندن متن / Markdown</button>
      </div>
      <div id="am-url-box">
        <div class="field"><label for="am-url">آدرس مقاله یا PDF آنلاین (مثل ArXiv یا وبلاگ)</label>
          <input id="am-url" type="url" class="ltr" placeholder="https://arxiv.org/abs/... یا هر لینک مقاله"></div>
      </div>
      <div id="am-txt-box" hidden style="display:flex;flex-direction:column;gap:8px">
        <div class="field"><label for="am-title">عنوان</label><input id="am-title" type="text" placeholder="عنوان یادداشت یا مقاله"></div>
        <div class="field"><label for="am-text">متن (انگلیسی یا فارسی، Markdown پشتیبانی می‌شود)</label>
          <textarea id="am-text" rows="7" placeholder="متن را اینجا بچسبان…"></textarea></div>
      </div>
      <div class="row-acts" style="justify-content:flex-end">
        <button class="btn ghost" id="am-cancel">انصراف</button>
        <button class="btn primary" id="am-go">افزودن به کتابخانه</button>
      </div></div>`;
    document.body.appendChild(m);
    let tab = "url";
    const close = () => m.remove();
    $("#am-x").onclick = close; $("#am-cancel").onclick = close;
    m.addEventListener("click", e => { if (e.target === m) close(); });
    $$("#am-tabs button").forEach(b => b.onclick = () => {
      tab = b.dataset.v;
      $$("#am-tabs button").forEach(x => x.classList.toggle("on", x.dataset.v === tab));
      $("#am-url-box").hidden = tab !== "url";
      $("#am-txt-box").hidden = tab !== "text";
    });
    $("#am-go").onclick = async () => {
      const btn = $("#am-go"); btn.disabled = true; btn.textContent = "در حال افزودن…";
      try {
        if (tab === "url") {
          await api("/api/books/from-url", { method: "POST", body: { url: $("#am-url").value.trim() } });
        } else {
          await api("/api/books/from-text", { method: "POST", body: { title: $("#am-title").value.trim(), text: $("#am-text").value } });
        }
        toast("به کتابخانه اضافه شد"); close(); onDone && onDone();
      } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = "افزودن به کتابخانه"; }
    };
    $("#am-url").focus();
  }

  /* ---------------- Conceptual & Cloze Cards modal ---------------- */
  async function openCardsModal(paraId, onAdded) {
    const m = document.createElement("div");
    m.id = "cgenmodal"; m.className = "modal-back";
    m.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="max-width:620px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <h2>ساخت کارت‌های یادآوری مفهومی (FSRS)</h2>
        <button class="btn icon ghost" id="cg-x" aria-label="بستن">${ICON.close}</button>
      </div>
      <div id="cg-body"><span class="pill busy">در حال طراحی ۳ کارت عمیق (چرا/چگونه، جای‌خالی Cloze و سناریو)…</span></div>
    </div>`;
    document.body.appendChild(m);
    const close = () => m.remove();
    $("#cg-x").onclick = close;
    m.addEventListener("click", e => { if (e.target === m) close(); });
    const TYPE_FA = { causal: "علت و مکانیزم", cloze: "جای‌خالی (Cloze)", scenario: "سناریوی کاربردی" };
    try {
      const d = await api(`/api/paragraphs/${paraId}/cards/generate`, { method: "POST" });
      $("#cg-body").innerHTML = `<div class="cg-list">${d.cards.map((c, i) => `
        <div class="cg-item" data-i="${i}">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
            <span class="pill cli2api">${TYPE_FA[c.type] || c.type}</span>
            <button class="btn sm primary" data-save="${i}">ذخیره در کارت‌ها</button>
          </div>
          <div class="cg-q">${esc(c.front)}</div>
          <div class="cg-a small muted">${esc(c.back)}</div>
        </div>`).join("")}</div>
        <div class="row-acts" style="justify-content:space-between;margin-top:10px">
          <span class="small muted">${providerPill(d.provider, d.model)}</span>
          <button class="btn primary" id="cg-all">ذخیره‌ی هر ${fa(d.cards.length)} کارت</button>
        </div>`;
      const saveOne = async (idx, btn) => {
        const c = d.cards[idx];
        const r = await api("/api/cards", { method: "POST", body: { book_id: d.book_id, page: d.page, front: c.front, back: c.back, context: "", card_type: c.type } });
        if (btn) { btn.disabled = true; btn.textContent = r.duplicate ? "تکراری" : "ذخیره شد ✓"; }
        onAdded && onAdded();
      };
      $$("[data-save]", m).forEach(b => b.onclick = () => saveOne(+b.dataset.save, b).catch(e => toast(e.message, true)));
      $("#cg-all").onclick = async () => {
        $("#cg-all").disabled = true;
        for (let i = 0; i < d.cards.length; i++) await saveOne(i, $(`[data-save="${i}"]`, m));
        toast("همه‌ی کارت‌ها به FSRS اضافه شدند"); close();
      };
    } catch (e) {
      $("#cg-body").innerHTML = `<div class="error-box">${esc(e.message)}</div>`;
    }
  }

  /* ---------------- Socratic Tutor Tab (Reader right panel) ---------------- */
  async function renderTutorTab(pane, ctx) {
    const { bookId, getPage, focusPara, clearFocusPara, refreshUsage } = ctx;
    const page = getPage();
    pane.innerHTML = `<div class="tutor-wrap">
      <div class="tab-intro"><b>گفت‌وگو با متن صفحه</b> — فقط تا صفحه‌ی ${fa(page)} را می‌بیند (بدون لو دادن ادامه). سؤالت را بپرس یا دکمه‌ی سنجش سقراطی را بزن.</div>
      <div class="tutor-chips">
        <button class="btn sm primary" data-tm="practice">🧪 توضیح ساده + نمودار + تمرین</button>
        <button class="btn sm" data-tm="grill">🎯 مرا سقراطی بسنج</button>
        <button class="btn sm ghost" data-tm="connect">🔗 ربط به قبل</button>
        <button class="btn sm ghost danger" id="t-clear" title="پاک کردن گفتگو">پاک</button>
      </div>
      ${focusPara ? `<div class="tutor-focus"><span>پاراگراف انتخاب‌شده:</span><p class="small" dir="ltr">${esc(focusPara.text.slice(0, 140))}…</p><button class="btn sm ghost" id="t-unfocus" aria-label="لغو انتخاب">×</button></div>` : ""}
      <div class="tutor-msgs" id="t-msgs"><span class="small muted">در حال بارگذاری…</span></div>
      <form class="tutor-form" id="t-form">
        <textarea id="t-in" rows="2" placeholder="سؤالت را از این صفحه بپرس یا استدلال نویسنده را به چالش بکش…"></textarea>
        <button class="btn primary sm" id="t-send">ارسال پیام</button>
      </form>
    </div>`;
    if ($("#t-unfocus")) $("#t-unfocus").onclick = () => { clearFocusPara(); renderTutorTab(pane, ctx); };
    const msgsEl = $("#t-msgs");
    const draw = list => {
      if (!list.length) {
        msgsEl.innerHTML = `<p class="small muted">گفت‌وگوی زنده با متن تا صفحه‌ی ${fa(page)} (بدون لو دادن ادامه). دکمه‌ی «مرا سقراطی بسنج» را بزن یا سؤالت را بنویس.</p>`;
        return;
      }
      msgsEl.innerHTML = list.map(m => `<div class="tmsg ${m.role}"><div class="tbub">${m.role === "assistant" ? renderMd(m.content) : esc(m.content)}</div></div>`).join("");
      hydratePlots(msgsEl);
      msgsEl.scrollTop = msgsEl.scrollHeight;
    };
    let hist = [];
    try { hist = (await api(`/api/books/${bookId}/tutor?page=${page}`)).messages || []; draw(hist); }
    catch (e) { msgsEl.innerHTML = `<div class="error-box">${esc(e.message)}</div>`; }

    async function send(text, mode = "ask") {
      const inp = $("#t-in"), btn = $("#t-send");
      btn.disabled = true;
      const shownUser = text || (mode === "grill" ? "🎯 مرا با سؤال‌های سقراطی بسنج" : "🔗 ربط این صفحه به صفحه‌های قبل");
      hist.push({ role: "user", content: shownUser });
      const liveMsg = { role: "assistant", content: "" };
      hist.push(liveMsg);
      draw(hist);
      const lastBub = $$(".tmsg.assistant .tbub", msgsEl).pop();
      try {
        const resp = await fetch(`/api/books/${bookId}/tutor`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ page, message: text, mode, para_id: focusPara?.id || null }),
        });
        if (!resp.ok) {
          let d = null; try { d = await resp.json(); } catch {}
          throw new Error((d && d.detail) || `خطای ${resp.status}`);
        }
        const reader = resp.body.getReader(), dec = new TextDecoder();
        let full = "";
        for (;;) {
          const { value, done } = await reader.read(); if (done) break;
          full += dec.decode(value, { stream: true });
          const ei = full.indexOf(ERR);
          if (ei !== -1) throw new Error(full.slice(ei + ERR.length));
          liveMsg.content = full;
          if (lastBub) { lastBub.innerHTML = renderMd(full) + '<span class="caret"></span>'; msgsEl.scrollTop = msgsEl.scrollHeight; }
        }
        if (lastBub) { lastBub.innerHTML = renderMd(full.trim()); hydratePlots(lastBub); }
        inp.value = "";
        refreshUsage && refreshUsage();
      } catch (e) {
        if (lastBub) lastBub.innerHTML = `<span style="color:var(--danger)">${esc(e.message)}</span>`;
      }
      btn.disabled = false;
    }

    $("#t-form").onsubmit = e => { e.preventDefault(); const v = $("#t-in").value.trim(); if (v) send(v, "ask"); };
    $("#t-in").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const v = $("#t-in").value.trim(); if (v) send(v, "ask"); } });
    $$("[data-tm]", pane).forEach(b => b.onclick = () => send("", b.dataset.tm));
    $("#t-clear").onclick = async () => { await api(`/api/books/${bookId}/tutor?page=${page}`, { method: "DELETE" }); hist = []; draw(hist); };
  }

  /* ---------------- Cross-Book Second Brain + Obsidian Tab ---------------- */
  async function renderBrainTab(pane, ctx) {
    const { bookId, getPage, refreshUsage } = ctx;
    const page = getPage();
    pane.innerHTML = `<div class="brain-wrap">
      <div class="tab-intro"><b>ارتباط بین کتاب‌ها و Obsidian</b> — ایده‌های این صفحه را به یادداشت‌ها و کتاب‌های قبلی‌ات وصل می‌کند و کل یادداشت‌های کتاب را برای Obsidian خروجی می‌گیرد.</div>
      <h4>خروجی Markdown برای Obsidian</h4>
      <div class="row-acts">
        <a class="btn sm primary" href="/api/books/${bookId}/export-obsidian">دانلود فایل .md</a>
        <button class="btn sm" id="ob-sync">ذخیره در پوشه‌ی Vault</button>
      </div>
      <hr class="sep">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <h4>ایده‌های مرتبط در کتاب‌های دیگر</h4>
        <button class="btn sm" id="cb-synth">ترکیب با مدل</button>
      </div>
      <div id="cb-synth-out"></div>
      <div id="cb-list"><span class="small muted">در حال جست‌وجو در کتابخانه…</span></div>
    </div>`;
    $("#ob-sync").onclick = async () => {
      try { const r = await api(`/api/books/${bookId}/sync-obsidian`, { method: "POST" }); toast(`در Obsidian ذخیره شد: ${r.filename}`); }
      catch (e) { toast(e.message, true); }
    };
    $("#cb-synth").onclick = async () => {
      const b = $("#cb-synth"); b.disabled = true; b.textContent = "در حال ترکیب…";
      try {
        const r = await api(`/api/books/${bookId}/pages/${page}/connections/synthesize`, { method: "POST" });
        $("#cb-synth-out").innerHTML = `<div class="deep-box">${renderMd(r.synthesis)}${providerPill(r.provider, r.model)}</div>`;
        refreshUsage && refreshUsage();
      } catch (e) { toast(e.message, true); }
      b.disabled = false; b.textContent = "ترکیب با مدل";
    };
    const KIND_FA = { journal: "دفترچه", card: "کارت", highlight: "هایلایت", passage: "متن" };
    try {
      const d = await api(`/api/books/${bookId}/pages/${page}/connections`);
      if (!d.matches.length) {
        $("#cb-list").innerHTML = `<p class="small muted">هنوز ارتباطی با کتاب‌های دیگر برای این صفحه پیدا نشد.</p>`;
      } else {
        $("#cb-list").innerHTML = d.matches.map(m => `
          <a class="cb-item" href="#/read/${m.book_id}/${m.page}">
            <div class="cb-head"><b dir="auto">${esc(m.book)}</b><span>ص ${fa(m.page)} · ${KIND_FA[m.kind] || m.kind}</span></div>
            <p class="small">${esc(m.snippet)}</p>
            ${m.shared?.length ? `<div class="cb-kw">${m.shared.map(w => `<span>${esc(w)}</span>`).join("")}</div>` : ""}
          </a>`).join("");
      }
    } catch (e) { $("#cb-list").innerHTML = `<div class="error-box">${esc(e.message)}</div>`; }
  }

  /* ---------------- Deep Learning Studio Overlay (X-Ray / Feynman / Critique / Concept Graph / Mindmap / Quiz) ---------------- */
  function openDeepOverlay(ov, ctx) {
    const { bookId, getPage, closeOverlay, goPage, refreshUsage, openOtherOverlay } = ctx;
    let tab = LS.get("deepTab", "xray");
    const renderShell = () => {
      ov.innerHTML = `<div class="ov-head"><b>🧠 مرکز یادگیری عمیق</b>
        <div class="seg" id="dp-tabs">
          <button data-v="xray" class="${tab === "xray" ? "on" : ""}">🩻 پیش‌خوانی فصل</button>
          <button data-v="feynman" class="${tab === "feynman" ? "on" : ""}">✍️ آزمون فاینمن</button>
          <button data-v="critique" class="${tab === "critique" ? "on" : ""}">⚖️ نقد کتاب</button>
          <button data-v="concepts" class="${tab === "concepts" ? "on" : ""}">🕸️ گراف مفاهیم</button>
          <button data-v="mind">🗺️ نقشه‌ی ذهنی</button>
          <button data-v="quiz">✅ سؤال‌های فصل</button>
        </div>
        <span class="grow"></span>
        <button class="btn sm ghost" data-close aria-label="بستن">× بستن (Esc)</button></div>
        <div class="ov-scroll" id="dp-body"><div class="ov-cta" style="position:static;min-height:40vh"><span class="pill busy">در حال بارگذاری…</span></div></div>`;
      $("[data-close]", ov).onclick = closeOverlay;
      $$("#dp-tabs button").forEach(b => b.onclick = () => {
        if (b.dataset.v === "mind" || b.dataset.v === "quiz") {
          openOtherOverlay && openOtherOverlay(b.dataset.v);
          return;
        }
        tab = b.dataset.v; LS.set("deepTab", tab); renderShell();
      });
      loadTab();
    };

    async function loadTab() {
      const body = $("#dp-body"), page = getPage();
      if (tab === "xray") await renderXray(body, page);
      else if (tab === "feynman") await renderFeynman(body, page);
      else if (tab === "critique") await renderCritique(body, page);
      else await renderConcepts(body, page);
    }

    async function renderXray(body, page) {
      const d = await api(`/api/books/${bookId}/xray?page=${page}`);
      if (!d.xray) {
        body.innerHTML = `<div class="ov-cta" style="position:static;min-height:50vh">
          <b>پیش‌خوانی X-Ray برای «${esc(d.label)}» (ص ${fa(d.start)} تا ${fa(d.end)})</b>
          <span class="small muted">در ۲۰ ثانیه نقشه‌ی ساختاری فصل را ببین: تز اصلی، ادعاهای کلیدی، سؤال‌ها، و کدام بخش‌ها را عمیق بخوانی و کدام‌ها را سریع رد شوی.</span>
          <button class="btn go" id="xr-go">🩻 ساخت پیش‌خوانی فصل</button></div>`;
        $("#xr-go").onclick = async () => {
          body.innerHTML = `<div class="ov-cta" style="position:static;min-height:50vh"><span class="pill busy">در حال اسکن ساختاری فصل…</span></div>`;
          try { await api(`/api/books/${bookId}/xray?page=${page}`, { method: "POST" }); refreshUsage(); renderXray(body, page); }
          catch (e) { body.innerHTML = `<div class="error-box" style="margin:20px">${esc(e.message)}</div>`; }
        };
        return;
      }
      const x = d.xray;
      body.innerHTML = `<div class="deep-page">
        <div class="dp-top"><div><span class="eyebrow-s">پیش‌خوانی X-Ray · ص ${fa(d.start)} تا ${fa(d.end)}</span><h2>${esc(d.label)}</h2></div>
          <div style="display:flex;gap:8px;align-items:center">${providerPill(x.provider, x.model)}<button class="btn sm ghost" id="xr-redo">ساخت دوباره</button></div></div>
        <div class="deep-hero"><span class="eyebrow-s">تز مرکزی فصل</span><p>${esc(x.thesis)}</p></div>
        <div class="dp-grid">
          <div class="card"><h3>ادعاهای کلیدی</h3><ul>${(x.core_claims || []).map(c => `<li>${esc(c.claim)} ${c.page ? `<button class="linkbtn" data-go="${c.page}">ص ${fa(c.page)}</button>` : ""}</li>`).join("")}</ul></div>
          <div class="card"><h3>سؤال‌هایی که این فصل جواب می‌دهد</h3><ul>${(x.key_questions || []).map(q => `<li>${esc(q)}</li>`).join("")}</ul></div>
          <div class="card"><h3>🟡 کجا عمیق مکث کنی</h3><ul>${(x.read_slow || []).map(s => `<li>${esc(s)}</li>`).join("")}</ul></div>
          <div class="card"><h3>⚪ کجا می‌توانی سریع رد شوی</h3><ul>${(x.can_skim || []).map(s => `<li>${esc(s)}</li>`).join("")}</ul></div>
        </div>
        ${x.takeaway ? `<div class="deep-box"><b>جمع‌بندی طلایی:</b> ${esc(x.takeaway)}</div>` : ""}
      </div>`;
      $$("[data-go]", body).forEach(b => b.onclick = () => { closeOverlay(); goPage(+b.dataset.go); });
      $("#xr-redo").onclick = async () => {
        body.innerHTML = `<div class="ov-cta" style="position:static;min-height:50vh"><span class="pill busy">در حال اسکن دوباره…</span></div>`;
        await api(`/api/books/${bookId}/xray?page=${page}`, { method: "POST" }); refreshUsage(); renderXray(body, page);
      };
    }

    async function renderFeynman(body, page) {
      const d = await api(`/api/books/${bookId}/feynman?page=${page}`);
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      body.innerHTML = `<div class="deep-page">
        <div class="dp-top"><div><span class="eyebrow-s">تکنیک فاینمن زنده · ص ${fa(d.start)} تا ${fa(d.end)}</span><h2>به زبان خودت تدریس کن</h2></div></div>
        <div class="card" style="display:flex;flex-direction:column;gap:10px">
          <input id="fn-topic" placeholder="مفهوم یا عنوان بخش (اختیاری، پیش‌فرض: ${esc(d.label)})">
          <textarea id="fn-exp" rows="5" placeholder="طوری توضیح بده که انگار داری برای یک دوست باهوش که این کتاب را نخوانده تعریف می‌کنی…"></textarea>
          <div class="row-acts" style="justify-content:space-between">
            ${SR ? `<button class="btn sm ghost" id="fn-mic">🎤 گفتار به متن (فارسی)</button>` : `<span></span>`}
            <button class="btn go" id="fn-go">بررسی شکاف‌های فهم من</button>
          </div>
          <div id="fn-res"></div>
        </div>
        ${d.items.length ? `<h3>تمرین‌های قبلی این فصل</h3><div class="fn-hist">${d.items.map(it => renderFeynmanCard(it)).join("")}</div>` : ""}
      </div>`;
      if (SR && $("#fn-mic")) {
        let rec = null;
        $("#fn-mic").onclick = () => {
          if (rec) { rec.stop(); rec = null; $("#fn-mic").textContent = "🎤 گفتار به متن (فارسی)"; return; }
          rec = new SR(); rec.lang = "fa-IR"; rec.continuous = true; rec.interimResults = false;
          rec.onresult = e => { const t = [...e.results].map(r => r[0].transcript).join(" "); $("#fn-exp").value += ($("#fn-exp").value ? " " : "") + t; };
          rec.onend = () => { rec = null; if ($("#fn-mic")) $("#fn-mic").textContent = "🎤 گفتار به متن (فارسی)"; };
          rec.start(); $("#fn-mic").textContent = "⏹ توقف ضبط";
        };
      }
      $("#fn-go").onclick = async () => {
        const b = $("#fn-go"); b.disabled = true; b.textContent = "در حال تحلیل دقیق توضیح تو…";
        try {
          const r = await api(`/api/books/${bookId}/feynman`, { method: "POST", body: { page, topic: $("#fn-topic").value, explanation: $("#fn-exp").value } });
          refreshUsage();
          renderFeynman(body, page);
        } catch (e) { toast(e.message, true); b.disabled = false; b.textContent = "بررسی شکاف‌های فهم من"; }
      };
      $$("[data-go]", body).forEach(b => b.onclick = () => { closeOverlay(); goPage(+b.dataset.go); });
    }

    function renderFeynmanCard(it) {
      const fb = it.feedback || {};
      const sc = fb.score ?? 0;
      return `<div class="card fn-card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <b>${esc(it.topic)}</b>
          <span class="pill ${sc >= 75 ? "ollama" : sc >= 50 ? "cli2api" : "err"}">امتیاز فهم: ${fa(sc)} / ۱۰۰</span>
        </div>
        <p class="small muted">${esc(it.explanation)}</p>
        ${(fb.clear_parts || []).length ? `<div><b class="small">✅ درست و شفاف گفتی:</b><ul>${fb.clear_parts.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
        ${(fb.gaps || []).length ? `<div><b class="small" style="color:var(--danger)">⚠️ شکاف‌ها و جاافتاده‌ها:</b><ul>${fb.gaps.map(g => `<li>${esc(g.missing)}${g.book_quote ? `<div class="small muted" dir="auto">«${esc(g.book_quote)}»</div>` : ""}${g.page ? ` <button class="linkbtn" data-go="${g.page}">ص ${fa(g.page)}</button>` : ""}</li>`).join("")}</ul></div>` : ""}
        ${(fb.hidden_assumptions || []).length ? `<div><b class="small">🔍 پیش‌فرض‌های پنهان:</b><ul>${fb.hidden_assumptions.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
        ${fb.simpler_analogy ? `<div class="deep-box"><b>قیاس طلایی:</b> ${esc(fb.simpler_analogy)}</div>` : ""}
        ${fb.next_step ? `<p class="small"><b>قدم بعدی:</b> ${esc(fb.next_step)}</p>` : ""}
      </div>`;
    }

    async function renderCritique(body, page) {
      const d = await api(`/api/books/${bookId}/critique?page=${page}`);
      if (!d.critique) {
        body.innerHTML = `<div class="ov-cta" style="position:static;min-height:50vh">
          <b>وکیل مدافع شیطان و نقد «${esc(d.label)}»</b>
          <span class="small muted">قوی‌ترین صورت استدلال نویسنده (Steelman) + محکم‌ترین نقدها، نقاط کور و دیدگاه‌های رقیب.</span>
          <button class="btn go" id="cr-go">⚖️ به چالش کشیدن این فصل</button></div>`;
        $("#cr-go").onclick = async () => {
          body.innerHTML = `<div class="ov-cta" style="position:static;min-height:50vh"><span class="pill busy">در حال بررسی نقاط کور و نقدها…</span></div>`;
          try { await api(`/api/books/${bookId}/critique?page=${page}`, { method: "POST" }); refreshUsage(); renderCritique(body, page); }
          catch (e) { body.innerHTML = `<div class="error-box" style="margin:20px">${esc(e.message)}</div>`; }
        };
        return;
      }
      const c = d.critique;
      body.innerHTML = `<div class="deep-page">
        <div class="dp-top"><div><span class="eyebrow-s">وکیل مدافع شیطان · ص ${fa(d.start)} تا ${fa(d.end)}</span><h2>${esc(d.label)}</h2></div>
          <div style="display:flex;gap:8px;align-items:center">${providerPill(c.provider, c.model)}<button class="btn sm ghost" id="cr-redo">نقد دوباره</button></div></div>
        <div class="deep-hero"><span class="eyebrow-s">قوی‌ترین صورت استدلال نویسنده (Steelman)</span><p>${esc(c.steelman)}</p></div>
        <div class="card"><h3>قوی‌ترین نقدها و دیدگاه‌های رقیب</h3>
          <div class="cr-list">${(c.counterarguments || []).map(a => `<div class="cr-item">
            <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><b>${esc(a.point)}</b><span class="pill openai">${esc(a.thinker || "دیدگاه رقیب")}</span></div>
            <p class="small">${esc(a.detail)}</p></div>`).join("")}</div></div>
        <div class="dp-grid">
          <div class="card"><h3>نقاط کور و پیش‌فرض‌ها</h3><ul>${(c.blind_spots || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>
          <div class="card"><h3>تعمیم‌های بیش از حد</h3><ul>${(c.overgeneralizations || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>
        </div>
        ${c.reflection_question ? `<div class="deep-box"><b>سؤال برای داوری خودت:</b> ${esc(c.reflection_question)}</div>` : ""}
      </div>`;
      $("#cr-redo").onclick = async () => {
        body.innerHTML = `<div class="ov-cta" style="position:static;min-height:50vh"><span class="pill busy">در حال نقد دوباره…</span></div>`;
        await api(`/api/books/${bookId}/critique?page=${page}`, { method: "POST" }); refreshUsage(); renderCritique(body, page);
      };
    }

    async function renderConcepts(body, page) {
      const d = await api(`/api/books/${bookId}/concepts?scope=chapter&page=${page}`);
      if (!d.graph) {
        body.innerHTML = `<div class="ov-cta" style="position:static;min-height:50vh">
          <b>گراف مفاهیم و استدلال‌های «${esc(d.label)}»</b>
          <span class="small muted">به‌جای اسم‌های خاص، مفاهیم، ادعاها، شواهد و رابطه‌های منطقی (حمایت، نقض، علیت، پیش‌نیاز) را استخراج می‌کند.</span>
          <button class="btn go" id="cg-go">🕸️ ساخت گراف مفاهیم</button></div>`;
        $("#cg-go").onclick = async () => {
          body.innerHTML = `<div class="ov-cta" style="position:static;min-height:50vh"><span class="pill busy">در حال استخراج مفاهیم و استدلال‌ها…</span></div>`;
          try { await api(`/api/books/${bookId}/concepts?scope=chapter&page=${page}`, { method: "POST" }); refreshUsage(); renderConcepts(body, page); }
          catch (e) { body.innerHTML = `<div class="error-box" style="margin:20px">${esc(e.message)}</div>`; }
        };
        return;
      }
      const g = d.graph;
      const KIND_META = {
        concept: ["مفهوم", "#2159A0"], claim: ["ادعا", "#B23A5B"], evidence: ["شاهد/مثال", "#2D7A57"], question: ["سؤال", "#C0841A"]
      };
      const REL_FA = { supports: "حمایت می‌کند", contradicts: "نقض می‌کند", depends_on: "وابسته است به", causes: "باعث می‌شود", example_of: "مثالی از" };
      const REL_CLR = { supports: "#2D7A57", contradicts: "#B3261E", depends_on: "#2159A0", causes: "#C0841A", example_of: "#6A4BA6" };

      // Circular layout SVG for instant clarity + interactive detail cards below
      const W = 820, H = 440, cx = W / 2, cy = H / 2, rx = 310, ry = 165;
      const pos = new Map();
      g.nodes.forEach((n, i) => {
        const a = (2 * Math.PI * i) / Math.max(1, g.nodes.length) - Math.PI / 2;
        pos.set(n.id, { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
      });
      const svg = `<svg viewBox="0 0 ${W} ${H}" class="cg-svg">
        <defs><marker id="arr" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" fill="currentColor"/></marker></defs>
        ${g.edges.map(e => {
          const a = pos.get(e.from), b = pos.get(e.to); if (!a || !b) return "";
          const clr = REL_CLR[e.relation] || "#888";
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          return `<g style="color:${clr}"><line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${clr}" stroke-width="1.8" stroke-opacity=".65" marker-end="url(#arr)"/>
            <text x="${mx}" y="${my - 4}" text-anchor="middle" font-size="10" fill="${clr}">${esc(e.label)}</text></g>`;
        }).join("")}
        ${g.nodes.map(n => {
          const p = pos.get(n.id), km = KIND_META[n.kind] || KIND_META.concept;
          return `<g class="cgn" data-nid="${esc(n.id)}" transform="translate(${p.x},${p.y})" style="cursor:pointer">
            <rect x="-74" y="-17" width="148" height="34" rx="10" fill="var(--paper)" stroke="${km[1]}" stroke-width="2"/>
            <text y="4" text-anchor="middle" font-size="11.5" font-weight="700" fill="var(--ink)">${esc(n.label.slice(0, 22))}</text></g>`;
        }).join("")}
      </svg>`;

      body.innerHTML = `<div class="deep-page">
        <div class="dp-top"><div><span class="eyebrow-s">گراف مفاهیم و استدلال‌ها · ص ${fa(d.start)} تا ${fa(d.end)}</span><h2>${esc(d.label)}</h2></div>
          <div style="display:flex;gap:8px;align-items:center">${providerPill(g.provider, g.model)}<button class="btn sm ghost" id="cg-redo">ساخت دوباره</button></div></div>
        <div class="card" style="padding:10px">${svg}<div id="cg-detail" class="deep-box" hidden></div></div>
        <div class="dp-grid">${g.nodes.map(n => {
          const km = KIND_META[n.kind] || KIND_META.concept;
          return `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
            <b>${esc(n.label)}</b><span class="pill" style="background:${km[1]}22;color:${km[1]}">${km[0]}</span></div>
            <p class="small muted">${esc(n.summary)}</p>
            ${n.page ? `<button class="linkbtn small" data-go="${n.page}">رفتن به ص ${fa(n.page)}</button>` : ""}</div>`;
        }).join("")}</div>
      </div>`;
      $$(".cgn", body).forEach(el => el.onclick = () => {
        const n = g.nodes.find(x => x.id === el.dataset.nid); if (!n) return;
        const rels = g.edges.filter(e => e.from === n.id || e.to === n.id).map(e => {
          const other = g.nodes.find(x => x.id === (e.from === n.id ? e.to : e.from));
          return `<li><b>${esc(REL_FA[e.relation] || e.relation)}</b> (${esc(e.label)}) ← ${esc(other?.label || "")}</li>`;
        }).join("");
        const det = $("#cg-detail"); det.hidden = false;
        det.innerHTML = `<b>${esc(n.label)}</b><p class="small">${esc(n.summary)}</p>${rels ? `<ul class="small">${rels}</ul>` : ""}`;
      });
      $$("[data-go]", body).forEach(b => b.onclick = () => { closeOverlay(); goPage(+b.dataset.go); });
      $("#cg-redo").onclick = async () => {
        body.innerHTML = `<div class="ov-cta" style="position:static;min-height:50vh"><span class="pill busy">در حال ساخت دوباره…</span></div>`;
        await api(`/api/books/${bookId}/concepts?scope=chapter&page=${page}`, { method: "POST" }); refreshUsage(); renderConcepts(body, page);
      };
    }

    renderShell();
  }

  /* ---------------- Visual Diagram / Formula Region Selector (Page Mode) ---------------- */
  function attachRegionAnalyzer(pane, bookId, page, refreshUsage) {
    const imgWrap = $(".img-wrap", pane);
    const btn = $("#img-analyze", pane);
    const out = $("#img-an-out", pane);
    if (!imgWrap || !btn) return;
    let active = false, start = null, box = null;
    btn.onclick = () => {
      active = !active;
      btn.classList.toggle("primary", active);
      imgWrap.classList.toggle("selecting", active);
      if (active) toast("روی نمودار یا فرمول در تصویر صفحه کادر بکش");
    };
    imgWrap.onpointerdown = e => {
      if (!active) return;
      e.preventDefault();
      const r = imgWrap.getBoundingClientRect();
      start = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
      box = $(".sel-box", imgWrap) || document.createElement("div");
      box.className = "sel-box"; imgWrap.appendChild(box);
      const move = ev => {
        const cx = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
        const cy = Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height));
        const x = Math.min(start.x, cx), y = Math.min(start.y, cy);
        const w = Math.abs(cx - start.x), h = Math.abs(cy - start.y);
        box.style.left = (x * 100) + "%"; box.style.top = (y * 100) + "%";
        box.style.width = (w * 100) + "%"; box.style.height = (h * 100) + "%";
        box.dataset.rect = JSON.stringify({ x, y, w, h });
      };
      const up = async () => {
        window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
        const rect = JSON.parse(box.dataset.rect || "{}");
        if (!rect.w || rect.w < 0.03 || rect.h < 0.03) { box.remove(); return; }
        active = false; btn.classList.remove("primary"); imgWrap.classList.remove("selecting");
        out.hidden = false; out.innerHTML = `<span class="pill busy">در حال تحلیل نمودار / فرمول…</span>`;
        try {
          const res = await api(`/api/books/${bookId}/pages/${page}/analyze-region`, { method: "POST", body: rect });
          renderInteractiveRegionCard(out, res);
          refreshUsage && refreshUsage();
        } catch (err) { out.innerHTML = `<div class="error-box">${esc(err.message)}</div>`; }
      };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    };
  }

  function renderInteractiveRegionCard(out, res) {
    const c = res.card;
    if (!c) {
      out.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <b>تحلیل بخش انتخاب‌شده</b>${providerPill(res.provider, res.model)}</div>${renderMd(res.text)}`;
      hydratePlots(out);
      return;
    }
    const syms = Array.isArray(c.symbols) ? c.symbols : [];
    const exs = Array.isArray(c.exercises) ? c.exercises : [];
    out.innerHTML = `<div class="ilab">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
        <b style="font-size:1rem">🧪 ${esc(c.title || "آزمایشگاه تعاملی فرمول")}</b>
        ${providerPill(res.provider, res.model)}
      </div>
      ${c.formula_latex ? `<div class="md-katex-display" dir="ltr">${renderTex(c.formula_latex, true)}</div>` : ""}
      <div class="ilab-simple">${renderMd(c.simple_explain || "")}</div>
      ${c.analogy ? `<div class="ilab-analogy"><b>💡 مثال روزمره:</b> ${renderMd(c.analogy)}</div>` : ""}
      ${syms.length ? `<div class="ilab-syms">
        <span class="small muted">روی هر نماد بزن تا نقشش را ببینی:</span>
        <div class="sym-chips">${syms.map((s, i) => `<button class="sym-chip ${i === 0 ? "on" : ""}" data-si="${i}"><span dir="ltr">${renderTex(s.sym, false)}</span> <small>${esc(s.name || "")}</small></button>`).join("")}</div>
        <div class="sym-desc" id="sym-desc"><b>${esc(syms[0].name || "")}:</b> ${renderMd(syms[0].meaning || "")}</div>
      </div>` : ""}
      ${c.interactive_plot ? `<div id="ilab-plot"></div>` : ""}
      ${exs.length ? `<div class="ilab-exs"><b>✏️ تمرین سریع (ببین واقعاً جا افتاد؟)</b>${exs.map((ex, ei) => `
        <div class="iex" data-ei="${ei}">
          <div class="iex-q">${fa(ei + 1)}. ${renderMd(ex.q || "")}</div>
          <div class="iex-opts">${(ex.options || []).map((opt, oi) => `<button class="iex-opt" data-oi="${oi}">${renderMd(opt)}</button>`).join("")}</div>
          <div class="row-acts"><button class="btn sm ghost" data-hint>💡 راهنمایی</button></div>
          <div class="iex-hint small muted" hidden>${renderMd(ex.hint || "")}</div>
          <div class="iex-fb" hidden></div>
        </div>`).join("")}</div>` : ""}
    </div>`;

    $$(".sym-chip", out).forEach(b => b.onclick = () => {
      const s = syms[+b.dataset.si];
      $$(".sym-chip", out).forEach(x => x.classList.toggle("on", x === b));
      $("#sym-desc", out).innerHTML = `<b>${esc(s.name || "")}:</b> ${renderMd(s.meaning || "")}`;
    });
    if (c.interactive_plot) mountInteractivePlot($("#ilab-plot", out), c.interactive_plot);
    $$(".iex", out).forEach(box => {
      const ex = exs[+box.dataset.ei];
      $("[data-hint]", box).onclick = () => { $(".iex-hint", box).hidden = !$(".iex-hint", box).hidden; };
      $$(".iex-opt", box).forEach(btn => btn.onclick = () => {
        const picked = +btn.dataset.oi, ok = picked === Number(ex.answer_idx);
        $$(".iex-opt", box).forEach(x => x.classList.remove("ok", "bad"));
        btn.classList.add(ok ? "ok" : "bad");
        const fb = $(".iex-fb", box); fb.hidden = false;
        fb.className = "iex-fb " + (ok ? "ok" : "bad");
        fb.innerHTML = `<b>${ok ? "✅ آفرین! دقیقاً درسته." : "❌ دوباره نگاه کن — جواب درست:"}</b> ${renderMd(ex.solution || "")}`;
      });
    });
  }

  return { openAddModal, openCardsModal, renderTutorTab, renderBrainTab, openDeepOverlay, attachRegionAnalyzer };
})();
