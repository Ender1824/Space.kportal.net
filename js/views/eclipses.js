// Eclipses: NASA's catalog (Fred Espenak, NASA GSFC) bundled for 2021–2050, the next eclipse with a
// countdown, and the surveyed path of totality or annularity drawn on a world map.
import { html, icon, mount, pageHead, openModal, loadScript, loadingState, errorState, fmtDate, fmtTime, countdownParts, downloadICS, raw } from "../lib.js";
import { getEclipses } from "../api.js";

const D3 = "https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js";
const TOPO = "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js";
const COUNTRIES = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json";

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const eclipseTitle = (e) => `${cap(e.type.toLowerCase())} ${e.kind} eclipse`;

const ABOUT = {
  "solar:Total": "The Moon covers the Sun completely. Along a narrow path the sky goes dark, stars come out and the corona appears.",
  "solar:Annular": "The Moon is near its farthest from Earth, too small to cover the Sun, leaving a ring of fire.",
  "solar:Hybrid": "A rare eclipse that shifts between annular and total along its path as Earth's curvature brings the Moon's shadow closer.",
  "solar:Partial": "The Moon covers only part of the Sun. Never look without certified eclipse glasses.",
  "lunar:Total": "The whole Moon passes into Earth's shadow and turns coppery red, lit only by sunsets and sunrises around the planet.",
  "lunar:Partial": "Part of the Moon dips into Earth's dark inner shadow, the umbra.",
  "lunar:Penumbral": "The Moon passes through Earth's faint outer shadow. The dimming is subtle and easy to miss.",
};

/** Small drawing of the eclipse, like the app's EclipseArt. */
export function eclipseArt(e, size = 56, cls = "mini") {
  const c = size / 2, r = size * 0.3, id = `g${Math.random().toString(36).slice(2, 8)}`;
  let body;
  if (e.kind === "solar") {
    if (e.type === "Total" || e.type === "Hybrid") {
      body = `<circle cx="${c}" cy="${c}" r="${r * 1.9}" fill="url(#${id})"/><circle cx="${c}" cy="${c}" r="${r}" fill="#05070b"/>`;
    } else if (e.type === "Annular") {
      body = `<circle cx="${c}" cy="${c}" r="${r * 1.45}" fill="url(#${id})"/><circle cx="${c}" cy="${c}" r="${r}" fill="#ffb347"/><circle cx="${c}" cy="${c}" r="${r * 0.86}" fill="#05070b"/>`;
    } else {
      body = `<circle cx="${c}" cy="${c}" r="${r * 1.4}" fill="url(#${id})"/><circle cx="${c}" cy="${c}" r="${r}" fill="#ffb347"/><circle cx="${c + r * 0.85}" cy="${c - r * 0.5}" r="${r}" fill="#05070b"/>`;
    }
    return raw(`<svg class="${cls}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><defs><radialGradient id="${id}"><stop offset=".45" stop-color="#fff6dd" stop-opacity=".95"/><stop offset=".65" stop-color="#ffcf7a" stop-opacity=".45"/><stop offset="1" stop-color="#ff9a3c" stop-opacity="0"/></radialGradient></defs>${body}</svg>`);
  }
  const tone = e.type === "Total" ? "#b5482c" : e.type === "Partial" ? "#d9d1c0" : "#cfc8b8";
  if (e.type === "Total") body = `<circle cx="${c}" cy="${c}" r="${r * 1.2}" fill="url(#${id})"/><circle cx="${c}" cy="${c}" r="${r}" fill="${tone}"/>`;
  else if (e.type === "Partial") body = `<circle cx="${c}" cy="${c}" r="${r}" fill="${tone}"/><circle cx="${c - r * 0.9}" cy="${c - r * 0.3}" r="${r * 1.15}" fill="#5a2418" opacity=".88"/>`;
  else body = `<circle cx="${c}" cy="${c}" r="${r}" fill="${tone}"/><circle cx="${c - r * 0.6}" cy="${c}" r="${r * 1.3}" fill="#1a1a22" opacity=".35"/>`;
  return raw(`<svg class="${cls}" viewBox="0 0 ${size} ${size}" aria-hidden="true"><defs><radialGradient id="${id}"><stop offset=".6" stop-color="#ff7a4d" stop-opacity=".5"/><stop offset="1" stop-color="#ff7a4d" stop-opacity="0"/></radialGradient></defs><clipPath id="${id}c"><circle cx="${c}" cy="${c}" r="${r}"/></clipPath><g clip-path="url(#${id}c)">${body}</g>${e.type === "Total" ? `<circle cx="${c}" cy="${c}" r="${r * 1.2}" fill="url(#${id})" opacity=".6"/>` : ""}</svg>`);
}

function whenText(e) {
  return `${fmtDate(e.greatest, { weekday: "long", month: "long", day: "numeric", year: "numeric" })} · greatest at ${fmtTime(e.greatest)}`;
}

function row(e) {
  return html`<button class="eclipse-row" data-id="${e.kind}:${e.date}">
    ${eclipseArt(e)}
    <span><span style="display:block;font-weight:650">${eclipseTitle(e)}</span>
      <span class="muted small" style="display:block">${e.pathRegion ? `Path: ${e.pathRegion}` : e.region}</span></span>
    <span class="muted small" style="text-align:right">${fmtDate(e.greatest, { month: "short", day: "numeric" })}<br>${e.duration && e.kind === "solar" ? e.duration : e.totalDuration || ""}</span>
  </button>`;
}

async function drawMap(el, e) {
  await loadScript(D3); await loadScript(TOPO);
  const d3 = window.d3;
  const topo = await fetch(COUNTRIES).then((r) => r.json());
  const land = window.topojson.feature(topo, topo.objects.countries);
  const W = 720, H = 380;
  const path = e.path || [];
  const center = path.map((p) => [p.c[1], p.c[0]]);
  const north = path.filter((p) => p.n).map((p) => [p.n[1], p.n[0]]);
  const south = path.filter((p) => p.s).map((p) => [p.s[1], p.s[0]]);
  const proj = d3.geoNaturalEarth1();
  if (center.length > 1) {
    // Fit a box around the path with ~15° of context on every side.
    const [[lo0, la0], [lo1, la1]] = d3.geoBounds({ type: "LineString", coordinates: center });
    const pad = 15;
    const box = { type: "MultiPoint", coordinates: [[lo0 - pad, Math.max(-85, la0 - pad)], [lo1 + pad, Math.min(85, la1 + pad)], [lo0 - pad, Math.min(85, la1 + pad)], [lo1 + pad, Math.max(-85, la0 - pad)]] };
    proj.fitExtent([[10, 10], [W - 10, H - 10]], box);
  } else proj.fitSize([W, H], { type: "Sphere" });
  const gp = d3.geoPath(proj);
  const band = north.length > 1 && south.length > 1 ? { type: "Polygon", coordinates: [[...north, ...south.reverse(), north[0]]] } : null;
  el.innerHTML = `<svg class="map-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Map of the eclipse path">
    <path d="${gp({ type: "Sphere" })}" fill="#082435"/>
    <path d="${gp(d3.geoGraticule10())}" fill="none" stroke="rgba(255,255,255,.06)"/>
    <path d="${gp(land)}" fill="#24514a" stroke="rgba(255,255,255,.22)" stroke-width=".6"/>
    ${band ? `<path d="${gp(band)}" fill="rgba(236,138,79,.35)" stroke="none"/>` : ""}
    ${center.length > 1 ? `<path d="${gp({ type: "LineString", coordinates: center })}" fill="none" stroke="#ec8a4f" stroke-width="2.5"/>` : ""}
  </svg>`;
}

function detail(e) {
  const facts = [
    ["Type", `${e.type} ${e.kind}`], ["Greatest eclipse", `${fmtTime(e.greatest)} your time`],
    ["Magnitude", e.magnitude != null ? e.magnitude.toFixed(3) : null], ["Saros series", e.saros],
    [e.kind === "solar" ? "Central duration" : "Partial phase", e.duration],
    ["Total phase", e.totalDuration],
  ].filter(([, v]) => v);
  return html`<div class="modal-body">
    <div class="eclipse-hero" style="grid-template-columns:140px 1fr;gap:20px">
      ${eclipseArt(e, 140, "eclipse-art")}
      <div><div class="eyebrow">${fmtDate(e.greatest, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</div>
        <h2>${eclipseTitle(e)}</h2><p class="muted" style="margin:6px 0 0">${ABOUT[`${e.kind}:${e.type}`] || ""}</p></div>
    </div>
    <div class="stat-grid">${facts.map(([k, v]) => html`<div class="stat"><div class="k">${k}</div><div class="v" style="font-size:16px">${v}</div></div>`)}</div>
    <h3>Where to see it</h3>
    <p class="muted">${e.region}${e.pathRegion ? html`<br><strong style="color:var(--ink)">${e.type === "Annular" ? "Annular" : "Total"} path:</strong> ${e.pathRegion}` : ""}</p>
    ${e.path ? html`<div id="emap" style="margin-top:12px"><div class="skeleton" style="height:240px"></div></div>
      <p class="faint small">Shaded band: path of ${e.type === "Annular" ? "annularity" : "totality"}. Line: central line. From NASA's path tables.</p>` : ""}
    <div class="row" style="margin-top:18px">
      ${e.greatest > Date.now() ? html`<button class="btn btn-primary" data-act="ics">${icon("calendar-plus")} Add to Calendar</button>` : ""}
      ${e.google ? html`<a class="btn" href="${e.google}" target="_blank" rel="noopener">${icon("map")} Interactive map</a>` : ""}
      ${e.globe ? html`<a class="btn" href="${e.globe}" target="_blank" rel="noopener">${icon("globe")} NASA visibility map</a>` : ""}
    </div>
    <p class="faint small" style="margin-top:14px">Eclipse predictions by Fred Espenak, NASA GSFC.${e.kind === "solar" ? " Never look at the Sun without certified eclipse glasses, except during totality." : " Lunar eclipses are safe to watch with your eyes."}</p>
  </div>`;
}

export async function render(root) {
  mount(root, html`
    ${pageHead({ back: { href: "#/explore", label: "Explore" }, eyebrow: html`${icon("circle-dot")} Sun · Earth · Moon`, title: "Eclipses",
      subtitle: "Every solar and lunar eclipse through 2050, with where to see them." })}
    <div id="content">${loadingState("Loading the eclipse catalog…")}</div>`);
  const content = root.querySelector("#content");
  let all;
  try { all = await getEclipses(); } catch {
    mount(content, errorState("Couldn't load eclipses", "The eclipse catalog didn't load.", null));
    return;
  }
  let kind = "all";
  let timer = null;

  function paint() {
    const now = Date.now();
    const filtered = all.filter((e) => kind === "all" || e.kind === kind);
    const upcoming = filtered.filter((e) => e.greatest.getTime() + 3 * 3600000 > now);
    const recent = filtered.filter((e) => e.greatest.getTime() + 3 * 3600000 <= now && e.greatest.getTime() > now - 400 * 86400000).reverse();
    const next = upcoming[0];
    const years = new Map();
    for (const e of upcoming.slice(1)) { const y = e.greatest.getFullYear(); if (!years.has(y)) years.set(y, []); years.get(y).push(e); }
    mount(content, html`
      <div class="seg" role="group" aria-label="Kind" style="margin-bottom:18px">
        ${[["all", "All"], ["solar", "Solar"], ["lunar", "Lunar"]].map(([k, l]) => html`<button data-kind="${k}" aria-pressed="${k === kind}">${l}</button>`)}
      </div>
      ${next ? html`<div class="card eclipse-hero">
        ${eclipseArt(next, 260, "eclipse-art")}
        <div>
          <div class="eyebrow">Next eclipse</div>
          <h2 class="serif" style="font-size:34px;margin:0 0 6px">${eclipseTitle(next)}</h2>
          <p class="muted" style="margin:0">${whenText(next)}</p>
          <div class="countdown" id="ecd"></div>
          <p class="muted" style="margin:10px 0 0">${next.pathRegion ? html`<strong style="color:var(--ink)">Path:</strong> ${next.pathRegion}<br>` : ""}Visible from ${next.region}.</p>
          <div class="row" style="margin-top:16px"><button class="btn btn-primary" data-id="${next.kind}:${next.date}">${icon("map")} Details & map</button></div>
        </div></div>` : ""}
      ${[...years].map(([y, list]) => html`<h2 class="section-title">${y}</h2>${list.map(row)}`)}
      ${recent.length ? html`<h2 class="section-title">Recent</h2>${recent.map(row)}` : ""}`);
    clearInterval(timer);
    if (next) {
      const tick = () => {
        const el = content.querySelector("#ecd");
        if (!el) return;
        const ms = next.greatest.getTime() - Date.now();
        if (ms <= 0) { el.innerHTML = `<span class="chip live"><span class="dot-live"></span> Happening now</span>`; return; }
        const c = countdownParts(ms);
        el.innerHTML = [["d", "Days"], ["h", "Hrs"], ["m", "Min"], ["s", "Sec"]].map(([k, l]) => `<div><b>${String(c[k]).padStart(2, "0")}</b><span>${l}</span></div>`).join("");
      };
      tick(); timer = setInterval(tick, 1000);
    }
  }

  content.addEventListener("click", (ev) => {
    const k = ev.target.closest("[data-kind]")?.dataset.kind;
    if (k) { kind = k; return paint(); }
    const id = ev.target.closest("[data-id]")?.dataset.id;
    if (!id) return;
    const e = all.find((x) => `${x.kind}:${x.date}` === id);
    if (!e) return;
    openModal(detail(e));
    const modal = document.querySelector(".modal");
    modal.querySelector('[data-act="ics"]')?.addEventListener("click", () => downloadICS({
      title: `${eclipse(e)}`, start: new Date(e.greatest.getTime() - 3600000), end: new Date(e.greatest.getTime() + 3600000),
      description: `${ABOUT[`${e.kind}:${e.type}`] || ""}\nVisible from: ${e.region}${e.pathRegion ? `\nPath: ${e.pathRegion}` : ""}`,
    }));
    const m = modal.querySelector("#emap");
    if (m) drawMap(m, e).catch(() => { m.innerHTML = '<p class="faint small">The map couldn\'t load.</p>'; });
  });
  const eclipse = (e) => `${e.kind === "solar" ? "☀️" : "🌕"} ${eclipseTitle(e)}`;

  paint();
  return () => clearInterval(timer);
}
