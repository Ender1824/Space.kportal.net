// App shell: hash router (works on any static host), tab highlighting and the starfield backdrop.
import { mount, html, icon, closeActiveModal, openModal, reducedMotion, rng } from "./lib.js";

const routes = [
  ["explore/people", "people"],
  ["explore/iss", "iss"],
  ["explore/spacecraft", "spacecraft"],
  ["explore/launches", "launches"],
  ["explore/night-sky", "nightsky"],
  ["explore/eclipses", "eclipses"],
  ["explore", "explore"],
  ["news", "news"],
  ["support", "support"],
  ["", "home"],
];

const titles = {
  home: "Astronomy Picture of the Day", explore: "Explore", people: "People in Space", iss: "ISS Tracker",
  spacecraft: "Spacecraft", launches: "Upcoming Launches", nightsky: "Night Sky Conditions", eclipses: "Eclipses",
  news: "News", support: "Support",
};

const main = document.getElementById("main");
let cleanup = null;
let renderToken = 0;

function parse() {
  const hash = decodeURIComponent(location.hash.replace(/^#\/?/, "")).replace(/\/+$/, "");
  const [path, query = ""] = hash.split("?");
  for (const [prefix, view] of routes) {
    if (path === prefix || (prefix && path.startsWith(prefix + "/")) || (!prefix && !path)) {
      const rest = prefix ? path.slice(prefix.length).split("/").filter(Boolean) : [];
      return { view, rest, query: new URLSearchParams(query), path };
    }
  }
  return { view: "home", rest: [], query: new URLSearchParams(), path: "" };
}

async function route() {
  const token = ++renderToken;
  const r = parse();
  closeActiveModal();
  if (typeof cleanup === "function") { try { cleanup(); } catch { /* ignore */ } }
  cleanup = null;

  const tab = r.path.split("/")[0] || "home";
  document.body.dataset.view = r.view;
  closeMenus();
  document.querySelectorAll("[data-tab]").forEach((a) => {
    const on = a.dataset.tab === tab;
    a.classList.toggle("active", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  document.title = r.view === "home" ? "Universe Daily — The universe, daily" : `${titles[r.view]} · Universe Daily`;

  const view = document.createElement("div");
  view.className = "view";
  try {
    const mod = await import(`./views/${r.view}.js`);
    if (token !== renderToken) return;
    main.replaceChildren(view);
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    onScroll();
    cleanup = await mod.render(view, r);
  } catch (err) {
    console.error(err);
    if (token !== renderToken) return;
    main.replaceChildren(view);
    mount(view, html`<div class="state">${icon("triangle-alert")}<h3>Something went wrong</h3><p>This page couldn't load. Check your connection and try again.</p>
      <div class="row"><button class="btn" onclick="location.reload()">${icon("rotate-cw")} Reload</button></div></div>`);
  }
}

window.addEventListener("hashchange", route);

// ───────── Header behavior ─────────
const topbar = document.querySelector(".topbar");
const menuToggle = document.querySelector(".menu-toggle");
const mobileMenu = document.getElementById("mobile-menu");
function onScroll() { topbar.classList.toggle("scrolled", window.scrollY > 24); }
window.addEventListener("scroll", onScroll, { passive: true });
function closeMenus() {
  // The Explore dropdown opens on hover and focus; drop focus so it closes after a choice.
  if (document.activeElement?.closest?.(".has-menu")) document.activeElement.blur();
  mobileMenu.classList.remove("open");
  menuToggle.setAttribute("aria-expanded", "false");
}
menuToggle.addEventListener("click", () => {
  const open = mobileMenu.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", String(open));
});
document.querySelector("[data-shortcuts]").addEventListener("click", showShortcuts);

// ───────── Keyboard shortcuts ─────────
const GO = { h: "#/", e: "#/explore", n: "#/news", s: "#/support", p: "#/explore/people", i: "#/explore/iss",
  l: "#/explore/launches", k: "#/explore/night-sky", c: "#/explore/spacecraft", x: "#/explore/eclipses" };
let pendingG = 0;
const keys = (...k) => k.map((x) => `<kbd>${x}</kbd>`).join(" ");
function showShortcuts() {
  const row = (label, k) => `<dt>${label}</dt><dd>${k}</dd>`;
  openModal(`<div class="modal-body"><h2>Keyboard shortcuts</h2><dl class="shortcuts">
    <h3>Go to</h3>
    ${row("Today", keys("G", "H"))}${row("Explore", keys("G", "E"))}${row("News", keys("G", "N"))}${row("Support", keys("G", "S"))}
    ${row("People in Space", keys("G", "P"))}${row("ISS Tracker", keys("G", "I"))}${row("Upcoming Launches", keys("G", "L"))}
    ${row("Night Sky Conditions", keys("G", "K"))}${row("Spacecraft", keys("G", "C"))}${row("Eclipses", keys("G", "X"))}
    <h3>Today's picture</h3>
    ${row("Previous / next day", keys("←", "→"))}${row("Random day", keys("R"))}${row("Back to today", keys("T"))}${row("View full image", keys("F"))}
    <h3>Anywhere</h3>
    ${row("Search (on pages that have it)", keys("/"))}${row("Close a dialog", keys("Esc"))}${row("Show this list", keys("?"))}
  </dl></div>`);
}
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.matches?.("input, textarea, select, [contenteditable]")) return;
  const k = e.key.toLowerCase();
  if (e.key === "?") { e.preventDefault(); showShortcuts(); return; }
  if (e.key === "/") {
    const search = main.querySelector('input[type="search"]');
    if (search && search.offsetParent) { e.preventDefault(); search.focus(); }
    return;
  }
  if (pendingG && Date.now() - pendingG < 1200 && GO[k]) { e.preventDefault(); pendingG = 0; location.hash = GO[k]; return; }
  pendingG = k === "g" ? Date.now() : 0;
});
document.getElementById("year").textContent = new Date().getFullYear();
route();

// ───────── Starfield ─────────
(function starfield() {
  const canvas = document.getElementById("sky");
  const ctx = canvas.getContext("2d");
  let stars = [], w = 0, h = 0, dpr = 1, raf = 0;

  function build() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth; h = window.innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rand = rng(7);
    const count = Math.round((w * h) / 4200);
    stars = Array.from({ length: count }, () => ({
      x: rand() * w, y: rand() * h,
      r: rand() < 0.92 ? 0.4 + rand() * 0.7 : 1.1 + rand() * 0.8,
      a: 0.25 + rand() * 0.6, tw: rand() * Math.PI * 2, sp: 0.4 + rand() * 1.4,
      warm: rand() < 0.18,
    }));
  }

  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      const a = s.a * (0.65 + 0.35 * Math.sin(s.tw + t * 0.001 * s.sp));
      ctx.fillStyle = s.warm ? `rgba(255,214,170,${a})` : `rgba(235,240,255,${a})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
  }

  function loop(t) { draw(t); raf = requestAnimationFrame(loop); }
  function start() {
    cancelAnimationFrame(raf);
    if (reducedMotion() || document.hidden) draw(0); else raf = requestAnimationFrame(loop);
  }

  build(); start();
  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { build(); start(); }, 150); });
  document.addEventListener("visibilitychange", start);
})();
