// Shared helpers: safe HTML templating, cached fetching, formatting, modals and small UI bits.

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

function renderValue(v) {
  if (v == null || v === false) return "";
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(renderValue).join("");
  return esc(v);
}

/** Tagged template: interpolations are escaped unless wrapped in raw() or produced by html``. */
export function html(strings, ...values) {
  let out = "";
  strings.forEach((s, i) => { out += s; if (i < values.length) out += renderValue(values[i]); });
  return new Raw(out);
}

export function icon(name, cls = "") {
  return raw(`<i data-lucide="${name}"${cls ? ` class="${cls}"` : ""}></i>`);
}

export function hydrateIcons() {
  if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 2 } });
  else window.addEventListener("load", () => window.lucide?.createIcons(), { once: true });
}

/** Replace an element's contents with a template and turn icon placeholders into SVGs. */
export function mount(el, tpl) {
  if (!el) return;
  el.innerHTML = tpl instanceof Raw ? tpl.s : String(tpl);
  hydrateIcons();
}

// ───────── Storage (wrapped: private windows and blocked storage can throw) ─────────
export const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem("ud:" + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("ud:" + key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
  },
  remove(key) { try { localStorage.removeItem("ud:" + key); } catch { /* ignore */ } },
};

// ───────── Fetching ─────────
const inflight = new Map();

export async function fetchJSON(url, { timeout = 15000, headers } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json", ...headers } });
    if (!res.ok) { const err = new Error(`HTTP ${res.status}`); err.status = res.status; throw err; }
    return await res.json();
  } finally { clearTimeout(timer); }
}

export async function fetchText(url, { timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) { const err = new Error(`HTTP ${res.status}`); err.status = res.status; throw err; }
    return await res.text();
  } finally { clearTimeout(timer); }
}

/**
 * Fetch through a saved copy: fresh copies are returned without a request, and a stale copy is
 * returned when the network fails (Launch Library allows only ~15 requests an hour per visitor).
 */
export async function cached(key, ttlMs, loader, { force = false } = {}) {
  const saved = store.get("c:" + key);
  if (!force && saved && Date.now() - saved.t < ttlMs) return saved.v;
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    try {
      const v = await loader();
      store.set("c:" + key, { t: Date.now(), v });
      return v;
    } catch (err) {
      if (saved) return saved.v;
      throw err;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

export function cachedAge(key) {
  const saved = store.get("c:" + key);
  return saved ? saved.t : null;
}

const dataCache = new Map();
/** Bundled data in /data, loaded once per visit. */
export function loadData(file, type = "json") {
  if (!dataCache.has(file)) {
    const p = fetch(`data/${file}`).then((r) => { if (!r.ok) throw new Error(`Missing ${file}`); return type === "json" ? r.json() : r.text(); });
    p.catch(() => dataCache.delete(file));
    dataCache.set(file, p);
  }
  return dataCache.get(file);
}

const scripts = new Map();
export function loadScript(src) {
  if (!scripts.has(src)) {
    scripts.set(src, new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src; s.async = true; s.crossOrigin = "anonymous";
      s.onload = resolve; s.onerror = () => { scripts.delete(src); reject(new Error("Couldn't load " + src)); };
      document.head.appendChild(s);
    }));
  }
  return scripts.get(src);
}

// ───────── Formatting ─────────
export const fmtNumber = (n, digits = 0) => Number(n).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });

export function fmtDate(d, opts = { month: "long", day: "numeric", year: "numeric" }) {
  return new Date(d).toLocaleDateString(undefined, opts);
}
export function fmtTime(d) {
  return new Date(d).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export function relTime(date) {
  const d = new Date(date).getTime();
  if (!isFinite(d)) return "";
  const diff = (Date.now() - d) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const abs = Math.abs(diff);
  if (abs < 60) return "just now";
  if (abs < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  if (abs < 7 * 86400) return rtf.format(-Math.round(diff / 86400), "day");
  return fmtDate(d, { month: "short", day: "numeric", year: new Date(d).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

/** "P430DT6H57M4S" → days as a number. */
export function isoDurationDays(s) {
  if (!s) return 0;
  const m = /P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?)?/.exec(s);
  if (!m) return 0;
  const [, y, mo, d, h, mi, se] = m.map((x) => (x ? Number(x) : 0));
  return y * 365.25 + mo * 30.44 + d + h / 24 + mi / 1440 + se / 86400;
}

export function durationWords(days) {
  if (days >= 365) { const y = days / 365.25; return `${y.toFixed(y >= 10 ? 0 : 1)} years`; }
  if (days >= 1) return `${Math.round(days)} day${Math.round(days) === 1 ? "" : "s"}`;
  const hours = days * 24;
  if (hours >= 1) return `${Math.round(hours)} hours`;
  return `${Math.round(hours * 60)} min`;
}

/** Local calendar day as "YYYY-MM-DD". */
export function ymd(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function countdownParts(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(t / 86400), h: Math.floor((t % 86400) / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
}

export const wikiURL = (title, section) =>
  `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}${section ? "#" + encodeURIComponent(section.replace(/ /g, "_")) : ""}`;

// ───────── UI ─────────
let toastTimer;
export function toast(message, ms = 1800) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), ms);
}

/** Opens a dialog; returns a close function. `content` is a template. */
export function openModal(content, { onClose } = {}) {
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
    <button class="btn btn-icon modal-close" aria-label="Close"><i data-lucide="x"></i></button>
    <div class="modal-content">${content instanceof Raw ? content.s : content}</div></div>`;
  const previous = document.activeElement;
  const close = () => {
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
    document.body.style.overflow = "";
    previous?.focus?.();
    onClose?.();
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  backdrop.addEventListener("click", (e) => { if (e.target === backdrop || e.target.closest(".modal-close")) close(); });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(backdrop);
  document.body.style.overflow = "hidden";
  hydrateIcons();
  backdrop.querySelector(".modal-close").focus();
  activeModalClose = close;
  return close;
}
let activeModalClose = null;
export function closeActiveModal() { activeModalClose?.(); activeModalClose = null; }

export function lightbox(src, alt = "") {
  const el = document.createElement("div");
  el.className = "lightbox";
  el.innerHTML = `<img src="${esc(src)}" alt="${esc(alt)}" /><button class="btn btn-icon" aria-label="Close"><i data-lucide="x"></i></button>`;
  const close = () => { el.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  el.addEventListener("click", close);
  document.addEventListener("keydown", onKey);
  document.body.appendChild(el);
  hydrateIcons();
}

export async function share({ title, text, url }) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return; } catch (e) { if (e.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { toast("Couldn't copy the link"); }
}

/** Downloads a single-event .ics file (the web's "Add to Calendar"). */
export function downloadICS({ title, start, end, description = "", location = "", url = "", allDay = false }) {
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = (d) => { d = new Date(d); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`; };
  const day = (d) => { d = new Date(d); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`; };
  const clean = (s) => String(s).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (c) => "\\" + c);
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Kportal//Universe Daily//EN", "BEGIN:VEVENT",
    `UID:${Date.now()}-${Math.random().toString(36).slice(2)}@universe-daily`,
    `DTSTAMP:${stamp(new Date())}`,
    allDay ? `DTSTART;VALUE=DATE:${day(start)}` : `DTSTART:${stamp(start)}`,
    allDay ? `DTEND;VALUE=DATE:${day(new Date(new Date(start).getTime() + 86400000))}` : `DTEND:${stamp(end || new Date(new Date(start).getTime() + 3600000))}`,
    `SUMMARY:${clean(title)}`,
    description && `DESCRIPTION:${clean(description)}`,
    location && `LOCATION:${clean(location)}`,
    url && `URL:${url}`,
    "END:VEVENT", "END:VCALENDAR",
  ].filter(Boolean);
  const blob = new Blob([lines.join("\r\n")], { type: "text/calendar" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = title.replace(/[^\w\- ]+/g, "").trim().slice(0, 60) + ".ics";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

export function errorState(title, message, retryLabel = "Try again") {
  return html`<div class="state">${icon("cloud-off")}<h3>${title}</h3><p>${message}</p>
    ${retryLabel ? html`<div class="row"><button class="btn" data-act="retry">${icon("rotate-cw")} ${retryLabel}</button></div>` : ""}</div>`;
}

export const loadingState = (label = "Loading…") =>
  html`<div class="state"><div class="spinner"></div><p>${label}</p></div>`;

export const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Seeded PRNG (mulberry32) so drawn decorations stay put between frames and visits. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Page header used by every sub-page. */
export function pageHead({ back, eyebrow, title, subtitle, actions }) {
  return html`
    ${back ? html`<a class="back" href="${back.href}">${icon("chevron-left")} ${back.label}</a>` : ""}
    <div class="page-head">
      <div>
        ${eyebrow ? html`<div class="eyebrow">${eyebrow}</div>` : ""}
        <h1>${title}</h1>
        ${subtitle ? html`<p>${subtitle}</p>` : ""}
      </div>
      ${actions ? html`<div class="row">${actions}</div>` : ""}
    </div>`;
}
