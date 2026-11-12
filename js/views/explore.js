// Explore: the app's six sections as cards, each with a live line, plus number-key shortcuts (1–6).
import { html, icon, mount, raw, loadData, wikiURL, countdownParts, fmtDate } from "../lib.js";
import { getAstronauts, getISS, getLaunches, getEclipses, hasExactDay, isUpcoming } from "../api.js";
import { loadGeography, describe } from "../geo.js";
import { moonPhase, moonIcon } from "../astro.js";
import { eclipseTitle } from "./eclipses.js";

const tiles = [
  { id: "people", title: "People in Space", icon: "users", tint: "--t-indigo", href: "#/explore/people", desc: "Meet the crew in orbit right now, and every astronaut ranked by time in space." },
  { id: "iss", title: "ISS Tracker", icon: "earth", tint: "--t-blue", href: "#/explore/iss", desc: "Follow the space station and China's Tiangong around a live 3D Earth." },
  { id: "launches", title: "Upcoming Launches", icon: "rocket", tint: "--t-red", href: "#/explore/launches", desc: "Every rocket on the books worldwide, with countdowns and calendar alerts." },
  { id: "night", title: "Night Sky Conditions", icon: "moon-star", tint: "--t-night", href: "#/explore/night-sky", desc: "Find dark skies, check the aurora forecast and see what the Moon is doing." },
  { id: "spacecraft", title: "Spacecraft", icon: "radio-tower", tint: "--t-orange", href: "#/explore/spacecraft", desc: "Fly through NASA's 3D solar system and listen in on the Deep Space Network." },
  { id: "eclipses", title: "Eclipses", icon: "circle-dot", tint: "--t-eclipse", href: "#/explore/eclipses", desc: "Every solar and lunar eclipse through 2050, with maps of the path." },
];

export function tileGrid(list, cls = "") {
  return html`<div class="tile-grid ${cls}">${list.map((t, i) => html`
    <a class="tile" href="${t.href}" style="--tint: var(${t.tint})">
      <div class="tile-meta"><div class="tile-icon">${icon(t.icon)}</div><kbd class="tile-key" title="Press ${i + 1}">${i + 1}</kbd></div>
      <div>
        <div class="tile-title">${t.title} ${icon("arrow-right")}</div>
        ${t.desc ? html`<div class="tile-desc">${t.desc}</div>` : ""}
        <div class="tile-live" data-live="${t.id}">${t.initial ? raw(t.initial) : raw('<span class="skeleton" style="display:inline-block;width:60%;height:14px"></span>')}</div>
      </div>
    </a>`)}</div>`;
}

export async function render(root) {
  const phase = moonPhase();
  const list = tiles.map((t) => ({ ...t }));
  list.find((t) => t.id === "spacecraft").initial = "<strong>Live</strong> from NASA's Jet Propulsion Laboratory";
  list.find((t) => t.id === "night").initial = `<span class="row" style="gap:8px">${moonIcon(phase, 22)} ${phase.name} · ${Math.round(phase.illumination * 100)}% full</span>`;

  mount(root, html`
    <div class="explore-hero">
      <div class="eyebrow">${icon("compass")} Explore</div>
      <h1>What's happening up there</h1>
      <p>Live crew, the space station overhead, every upcoming launch, tonight's sky and the next eclipse. Press <kbd>1</kbd>–<kbd>6</kbd> to jump straight in.</p>
    </div>
    ${tileGrid(list, "explore")}
    <div class="manifesto" id="quote" style="margin-top:80px"></div>`);

  const set = (id, tpl) => { const el = root.querySelector(`[data-live="${id}"]`); if (el) mount(el, tpl); };
  const fail = (id, text) => set(id, html`<span class="faint">${text}</span>`);
  const timers = [];

  getAstronauts("inSpace").then((d) => set("people", html`<span class="tile-big">${d.count}</span> <span>people in orbit now</span>`))
    .catch(() => fail("people", "Crew list unavailable"));

  async function iss() {
    try {
      const [p, g] = await Promise.all([getISS(), loadGeography()]);
      const place = describe(g, p.latitude, p.longitude);
      set("iss", html`<strong>${place.title}</strong>${place.detail ? html`<br><span class="small">${place.detail}</span>` : ""}`);
    } catch { fail("iss", "Location unavailable"); }
  }
  iss();
  timers.push(setInterval(iss, 15000));

  let next = null;
  const tick = () => {
    if (!next) return;
    const ms = new Date(next.net).getTime() - Date.now();
    const c = countdownParts(ms);
    const when = ms > 0 ? (c.d > 0 ? `T−${c.d}d ${c.h}h` : `T−${String(c.h).padStart(2, "0")}:${String(c.m).padStart(2, "0")}:${String(c.s).padStart(2, "0")}`) : "Launching now";
    set("launches", html`<strong>${next.mission || next.name}</strong><br><span class="small">${next.rocket || ""} · ${when}</span>`);
  };
  getLaunches().then((all) => {
    next = all.find((l) => isUpcoming(l) && hasExactDay(l) && new Date(l.net) > Date.now() - 3600000) || null;
    if (next) { tick(); timers.push(setInterval(tick, 1000)); } else fail("launches", "No upcoming launches found");
  }).catch(() => fail("launches", "Launch data unavailable"));

  getEclipses().then((all) => {
    const e = all.find((x) => x.greatest.getTime() + 3 * 3600000 > Date.now());
    if (e) set("eclipses", html`<strong>${eclipseTitle(e)}</strong><br><span class="small">${fmtDate(e.greatest, { month: "long", day: "numeric", year: "numeric" })}</span>`);
  }).catch(() => fail("eclipses", "Catalog unavailable"));

  loadData("quotes.json").then((quotes) => {
    const [text, author] = quotes[Math.floor(Math.random() * quotes.length)];
    mount(root.querySelector("#quote"), html`<blockquote>“${text}”</blockquote><cite><a href="${wikiURL(author)}" target="_blank" rel="noopener">${author}</a></cite>`);
  }).catch(() => {});

  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.matches("input, textarea, select") || document.querySelector(".modal-backdrop")) return;
    const n = Number(e.key);
    if (n >= 1 && n <= list.length) location.hash = list[n - 1].href;
  };
  document.addEventListener("keydown", onKey);
  return () => { timers.forEach(clearInterval); document.removeEventListener("keydown", onKey); };
}
