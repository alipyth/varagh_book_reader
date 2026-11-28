/* Varagh — UI language. English is the default; Persian is available from Settings.
   Loaded first; every UI string goes through tr(persian, english).
   Book translations and model output stay in Persian regardless of this setting. */
"use strict";

const LANG = (() => {
  try { return JSON.parse(localStorage.getItem("varagh.lang")) === "fa" ? "fa" : "en"; } catch { return "en"; }
})();
const IS_FA = LANG === "fa";
const LOCALE = IS_FA ? "fa-IR" : "en-US";
const PCT = IS_FA ? "٪" : "%";
const tr = (fa, en) => (IS_FA ? fa : en);

function setLang(lang) {
  try { localStorage.setItem("varagh.lang", JSON.stringify(lang === "fa" ? "fa" : "en")); } catch {}
  location.reload();
}

/* Labels that come from the server in Persian (task names, palace rooms, range labels). */
const SERVER_EN = {
  "ترجمه‌ی پاراگرافی": "Paragraph translation",
  "ترجمه‌ی صفحه‌ای": "Page translation",
  "ترجمه‌ی بهتر (دستی)": "Better translation (manual)",
  "ساخت واژه‌نامه": "Glossary building",
  "معنی کلمه": "Word lookup",
  "توضیح رابطه‌ها در گراف": "Graph relationship explanations",
  "نقشه‌ی ذهنی": "Mind map",
  "پرامپت تصویرسازی": "Image prompt",
  "خلاصه‌ی «قبلاً در این کتاب»": "“Previously in this book” recap",
  "سؤال‌های مرور فصل": "Chapter review questions",
  "توضیح پاراگراف مبهم": "Unclear-paragraph explanation",
  "قصر حافظه": "Memory palace",
  "اسکلت و بازخورد پست آموزشی": "Teaching post outline & feedback",
  "ورودی": "Entrance", "هال": "Hall", "کتابخانه": "Library", "آشپزخانه": "Kitchen", "اتاق کار": "Study",
  "اتاق خواب": "Bedroom", "حیاط": "Yard", "زیرزمین": "Basement", "بالکن": "Balcony", "راه‌پله": "Staircase",
  "اتاق موسیقی": "Music room", "انباری": "Storeroom", "گلخانه": "Greenhouse", "اتاق زیر شیروانی": "Attic",
  "کنار در": "by the door", "روی میز": "on the table", "لب پنجره": "on the windowsill", "روی قفسه": "on the shelf",
  "روی صندلی": "on the chair", "کنار شومینه": "by the fireplace", "پشت پرده": "behind the curtain", "وسط فرش": "in the middle of the rug",
  "پیش از فصل اول": "Before chapter 1",
  "یادداشت / مقاله": "Note / article",
};
const SERVER_EN_N = Object.fromEntries(Object.entries(SERVER_EN).map(([k, v]) => [k.replace(/\u200c/g, ""), v]));
function trS(s) {
  if (IS_FA || s == null) return s;
  const str = String(s);
  const hit = SERVER_EN_N[str.replace(/\u200c/g, "")];
  if (hit) return hit;
  let m;
  if ((m = str.match(/^صفحه\u200c?ی\s*(\d+)\s*تا\s*(\d+)$/))) return `Pages ${m[1]}–${m[2]}`;
  if ((m = str.match(/^از صفحه\u200c?ی\s*(\d+)$/))) return `From page ${m[1]}`;
  if ((m = str.match(/^صفحه\u200c?ی\s*(\d+)$/))) return `Page ${m[1]}`;
  return str;
}

(() => {
  const root = document.documentElement;
  root.lang = LANG;
  root.dir = IS_FA ? "rtl" : "ltr";
  if (!IS_FA) return;
  /* index.html is authored in English; swap in the Persian strings kept on data-fa attributes. */
  document.querySelectorAll("[data-fa]").forEach(el => { el.textContent = el.dataset.fa; });
  document.querySelectorAll("[data-fa-aria]").forEach(el => el.setAttribute("aria-label", el.dataset.faAria));
  document.title = "ورق";
})();
