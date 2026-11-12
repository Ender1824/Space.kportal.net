// Night Sky Conditions: light pollution map, NOAA aurora forecast and the Moon — the app's three sections.
import { html, icon, mount, pageHead, fetchJSON, cached, loadScript, store, errorState, loadingState, fmtDate, fmtTime, relTime, raw, toast } from "../lib.js";
import { moonPhase, moonDistance, nextPhase, litPath, moonIcon, SYNODIC } from "../astro.js";

const NOAA = "https://services.swpc.noaa.gov/";
const D3 = "https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js";
const TOPO = "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js";
const LAND = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/land-110m.json";

export const KP = {
  name: (k) => (k < 3 ? "Quiet" : k < 4 ? "Unsettled" : k < 5 ? "Active" : k < 6 ? "Minor storm · G1" : k < 7 ? "Moderate storm · G2" : k < 8 ? "Strong storm · G3" : k < 9 ? "Severe storm · G4" : "Extreme storm · G5"),
  color: (k) => (k < 4 ? "#59f299" : k < 5 ? "#d9f259" : k < 6 ? "#ffbf4d" : k < 7 ? "#ff8540" : "#ff4d59"),
  reach: (k) => (k < 3 ? "High Arctic: northern Alaska and Canada, Iceland, northern Scandinavia"
    : k < 5 ? "Alaska, northern Canada, Iceland, Scandinavia, and on the horizon in the far northern US"
    : k < 6 ? "Scotland, southern Scandinavia, and the northern US border states"
    : k < 7 ? "Northern England, Germany, and US states like Washington, Michigan and New York"
    : k < 8 ? "Central Europe and the US as far south as Oregon, Illinois and Pennsylvania"
    : "Unusually far south: southern Europe and much of the US"),
};

const SECTIONS = { light: ["Light Pollution", "lightbulb"], aurora: ["Aurora", "sparkles"], moon: ["Moon", "moon"] };

export async function render(root, { rest }) {
  let section = SECTIONS[rest[0]] ? rest[0] : store.get("nightSky.section", "light");
  if (!SECTIONS[section]) section = "light";
  let cleanupSection = null;

  mount(root, html`
    ${pageHead({ back: { href: "#/explore", label: "Explore" }, eyebrow: html`${icon("moon-star")} Tonight`, title: "Night Sky Conditions",
      subtitle: "How dark your sky is, whether the aurora is out, and what the Moon is doing." })}
    <div class="seg" role="group" aria-label="Section" style="margin-bottom:20px">
      ${Object.entries(SECTIONS).map(([k, [label, ic]]) => html`<button data-sec="${k}">${icon(ic)} ${label}</button>`)}
    </div>
    <div id="sec"></div>`);
  const host = root.querySelector("#sec");

  function show() {
    cleanupSection?.();
    cleanupSection = null;
    store.set("nightSky.section", section);
    root.querySelectorAll("[data-sec]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sec === section)));
    history.replaceState(null, "", `#/explore/night-sky/${section}`);
    cleanupSection = { light: lightSection, aurora: auroraSection, moon: moonSection }[section](host);
  }
  root.addEventListener("click", (e) => {
    const s = e.target.closest("[data-sec]")?.dataset.sec;
    if (s && s !== section) { section = s; show(); }
  });
  show();
  return () => cleanupSection?.();
}

// ───────── Light pollution ─────────
function lightURL(lat, lon) {
  const state = btoa(JSON.stringify({ basemap: "LayerBingHybrid" }));
  const pos = lat != null ? `zoom=6&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&` : "";
  return `https://www.lightpollutionmap.info/#${pos}state=${state}`;
}

function lightSection(host) {
  const saved = store.get("nightSky.where");
  mount(host, html`
    <div class="row" style="margin-bottom:12px">
      <button class="btn btn-sm" data-act="locate">${icon("locate")} Center on my area</button>
      <a class="btn btn-sm" href="${lightURL(saved?.lat, saved?.lon)}" target="_blank" rel="noopener" id="lp-open">${icon("external-link")} Open full map</a>
    </div>
    <div class="frame-wrap"><iframe class="frame" id="lp" title="Light pollution map" src="${lightURL(saved?.lat, saved?.lon)}" loading="lazy"></iframe></div>
    <div class="three-col" style="margin-top:16px">
      <div class="card"><h3>${icon("eye")} Reading the map</h3><p class="muted small">Brighter colors mean more artificial skyglow. Dark blue and gray areas are where the Milky Way is easy to see.</p></div>
      <div class="card"><h3>${icon("gauge")} The Bortle scale</h3><p class="muted small">Class 1 is a pristine dark site; class 9 is an inner-city sky where only the Moon, planets and brightest stars show.</p></div>
      <div class="card"><h3>${icon("mountain")} Find dark sky</h3><p class="muted small">Even an hour's drive from a city can take you from Bortle 8 to 4. Check the Moon section too: a bright Moon washes out faint stars.</p></div>
    </div>`);
  const onClick = (e) => {
    if (!e.target.closest('[data-act="locate"]')) return;
    if (!navigator.geolocation) return toast("Location isn't available in this browser");
    navigator.geolocation.getCurrentPosition((p) => {
      const where = { lat: p.coords.latitude, lon: p.coords.longitude };
      store.set("nightSky.where", where);
      const url = lightURL(where.lat, where.lon);
      host.querySelector("#lp").src = url;
      host.querySelector("#lp-open").href = url;
    }, () => toast("Couldn't get your location"), { maximumAge: 3600000, timeout: 10000 });
  };
  host.addEventListener("click", onClick);
  return () => host.removeEventListener("click", onClick);
}

// ───────── Aurora ─────────
export async function auroraData(force) {
  return cached("aurora", 5 * 60 * 1000, async () => {
    const [k1, fc, sp, mag] = await Promise.all([
      fetchJSON(NOAA + "json/planetary_k_index_1m.json"),
      fetchJSON(NOAA + "products/noaa-planetary-k-index-forecast.json"),
      fetchJSON(NOAA + "products/summary/solar-wind-speed.json").catch(() => null),
      fetchJSON(NOAA + "products/summary/solar-wind-mag-field.json").catch(() => null),
    ]);
    const last = k1[k1.length - 1];
    const rows = Array.isArray(fc[0]) ? fc.slice(1).map((r) => ({ time_tag: r[0], kp: Number(r[1]), observed: r[2], noaa_scale: r[3] })) : fc;
    return {
      kp: last?.estimated_kp ?? last?.kp_index, kpTime: last?.time_tag + "Z",
      forecast: rows.map((r) => ({ t: r.time_tag + "Z", kp: Number(r.kp), kind: r.observed, scale: r.noaa_scale })),
      speed: sp?.[0]?.proton_speed ?? null, bt: mag?.[0]?.bt ?? null, bz: mag?.[0]?.bz_gsm ?? null,
    };
  }, { force });
}

async function ovation() {
  const d = await fetchJSON(NOAA + "json/ovation_aurora_latest.json", { timeout: 25000 });
  const grid = new Uint8Array(360 * 181);
  for (const [lon, lat, v] of d.coordinates) grid[lon * 181 + (lat + 90)] = v;
  return { grid, observed: d["Observation Time"], forecast: d["Forecast Time"] };
}

function chanceAt(grid, lat, lon) {
  lon = ((lon % 360) + 360) % 360; const la = Math.min(Math.max(lat, -90), 90) + 90;
  const x0 = Math.floor(lon) % 360, x1 = (x0 + 1) % 360, y0 = Math.min(Math.floor(la), 180), y1 = Math.min(y0 + 1, 180);
  const fx = lon - Math.floor(lon), fy = la - Math.floor(la);
  const v = (x, y) => grid[x * 181 + y];
  return (v(x0, y0) * (1 - fx) + v(x1, y0) * fx) * (1 - fy) + (v(x0, y1) * (1 - fx) + v(x1, y1) * fx) * fy;
}

/** Subsolar point (low precision), for shading the night side of the polar map. */
function subsolar(date = new Date()) {
  const d = date.getTime() / 86400000 - 10957.5;
  const g = (357.529 + 0.98560028 * d) * Math.PI / 180;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * Math.PI / 180;
  const e = (23.439 - 0.00000036 * d) * Math.PI / 180;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  let lon = (ra * 180 / Math.PI) - gmst * 15;
  lon = ((lon + 540) % 360) - 180;
  return [lon, dec * 180 / Math.PI];
}

function gauge(kp) {
  const frac = Math.min(kp / 9, 1);
  const a0 = Math.PI * 0.75, a1 = a0 + Math.PI * 1.5 * frac;
  const pt = (a) => [100 + 80 * Math.cos(a), 100 + 80 * Math.sin(a)];
  const [x0, y0] = pt(a0), [x1, y1] = pt(a1), [xe, ye] = pt(Math.PI * 2.25);
  return html`<div class="gauge"><svg viewBox="0 0 200 200" aria-hidden="true">
      <path d="M ${x0} ${y0} A 80 80 0 1 1 ${xe} ${ye}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="14" stroke-linecap="round"/>
      ${frac > 0.005 ? html`<path d="M ${x0} ${y0} A 80 80 0 ${frac > 2 / 3 ? 1 : 0} 1 ${x1} ${y1}" fill="none" stroke="${KP.color(kp)}" stroke-width="14" stroke-linecap="round"/>` : ""}
    </svg><div class="val"><div><b>${kp.toFixed(1)}</b><span>Kp index</span></div></div></div>`;
}

function auroraSection(host) {
  let destroyed = false;
  let hemisphere = store.get("aurora.north", true);
  let oval = null, land = null;
  const where = store.get("nightSky.where");

  async function load(force = false) {
    mount(host, loadingState("Checking space weather…"));
    let d;
    try { d = await auroraData(force); } catch {
      if (!destroyed) mount(host, errorState("Couldn't reach NOAA", "The Space Weather Prediction Center didn't answer. Try again in a moment."));
      return;
    }
    if (destroyed) return;
    const now = Date.now();
    const fc = d.forecast.filter((p) => new Date(p.t).getTime() > now - 24 * 3600000).slice(0, 28);
    const nowIdx = fc.findIndex((p, i) => new Date(p.t).getTime() <= now && (i === fc.length - 1 || new Date(fc[i + 1].t).getTime() > now));
    const peak = fc.filter((p) => p.kind === "predicted").reduce((m, p) => Math.max(m, p.kp), 0);
    mount(host, html`
      <div class="card"><div class="kp-row">
        ${gauge(d.kp ?? 0)}
        <div>
          <div class="eyebrow">Aurora now</div>
          <h2 class="serif" style="font-size:30px;margin:0 0 6px;color:${KP.color(d.kp ?? 0)}">${KP.name(d.kp ?? 0)}</h2>
          <p class="muted" style="margin:0">${icon("map")} <strong style="color:var(--ink)">Visible in:</strong> ${KP.reach(d.kp ?? 0)}</p>
          <p id="local" class="muted small" style="margin:10px 0 0">${where ? "" : html`<button class="btn btn-sm" data-act="locate">${icon("locate")} Chance where I am</button>`}</p>
          <p class="faint small" style="margin-top:10px">Updated ${relTime(d.kpTime)} · NOAA Space Weather Prediction Center</p>
        </div>
      </div></div>

      <div class="two-col" style="margin-top:16px">
        <div class="card">
          <div class="row" style="margin-bottom:8px"><h3 style="margin:0">Aurora forecast</h3><span class="spacer"></span>
            <div class="seg" role="group" aria-label="Hemisphere"><button data-hemi="n" aria-pressed="${hemisphere}">North</button><button data-hemi="s" aria-pressed="${!hemisphere}">South</button></div></div>
          <canvas class="oval-canvas" id="oval" width="1040" height="1040" aria-label="Map of the aurora forecast around the pole"></canvas>
          <div class="row small faint" style="justify-content:space-between;margin-top:8px"><span>Chance overhead: low → high</span><span id="oval-time"></span></div>
          <div style="height:8px;border-radius:4px;margin-top:6px;background:linear-gradient(90deg,rgba(40,255,140,.2),#28ff8c,#e6ff4d,#ff5a3c)"></div>
        </div>
        <div class="stack">
          <div class="card">
            <h3>Kp forecast</h3>
            <p class="muted small" style="margin-top:-4px">Planetary geomagnetic activity in 3-hour blocks. 5 and up is a storm.${peak ? ` Peak predicted: ${peak.toFixed(1)}.` : ""}</p>
            <div class="bars" role="img" aria-label="Kp forecast chart">
              ${fc.map((p, i) => html`<div class="bar ${i === nowIdx ? "now" : ""}" title="${fmtDate(p.t, { weekday: "short", hour: "numeric" })}: Kp ${p.kp.toFixed(2)} (${p.kind})"
                style="height:${Math.max(3, (p.kp / 9) * 100)}%;background:${KP.color(p.kp)};opacity:${p.kind === "predicted" ? 0.6 : 1}"></div>`)}
            </div>
            <div class="bar-axis"><span>${fc[0] ? fmtDate(fc[0].t, { weekday: "short" }) : ""}</span><span>Now</span><span>${fc.length ? fmtDate(fc[fc.length - 1].t, { weekday: "short" }) : ""}</span></div>
          </div>
          <div class="card">
            <h3>Solar wind</h3>
            <div class="readout" style="grid-template-columns:repeat(3,1fr);margin-top:6px">
              <div class="stat"><div class="k">Speed</div><div class="v">${d.speed ?? "—"}<span class="small faint"> km/s</span></div></div>
              <div class="stat"><div class="k">Field Bt</div><div class="v">${d.bt ?? "—"}<span class="small faint"> nT</span></div></div>
              <div class="stat"><div class="k">Bz</div><div class="v" style="color:${d.bz != null && d.bz < -5 ? "var(--good)" : "inherit"}">${d.bz ?? "—"}<span class="small faint"> nT</span></div></div>
            </div>
            <p class="muted small" style="margin:10px 0 0">Fast wind and a strongly southward (negative) Bz feed the aurora.</p>
          </div>
        </div>
      </div>`);
    drawOval();
    try {
      [oval] = await Promise.all([ovation(), loadScript(D3).then(() => loadScript(TOPO))]);
      if (!land) land = await fetch(LAND).then((r) => r.json()).then((t) => window.topojson.feature(t, t.objects.land));
    } catch { /* map stays as a placeholder */ }
    if (destroyed) return;
    drawOval();
    paintLocal();
  }

  function paintLocal() {
    const w = store.get("nightSky.where");
    const el = host.querySelector("#local");
    if (!el || !w || !oval) return;
    const c = chanceAt(oval.grid, w.lat, w.lon);
    mount(el, html`${icon("map-pin")} Chance of aurora overhead where you are: <strong style="color:var(--ink)">${Math.round(c)}%</strong>`);
  }

  function drawOval() {
    const canvas = host.querySelector("#oval");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = canvas.width, R = W / 2 - 10;
    ctx.clearRect(0, 0, W, W);
    ctx.fillStyle = "#04121c"; ctx.beginPath(); ctx.arc(W / 2, W / 2, R, 0, Math.PI * 2); ctx.fill();
    const d3 = window.d3;
    if (!d3 || !land || !oval) {
      ctx.fillStyle = "rgba(241,236,224,.5)"; ctx.font = "28px Inter, sans-serif"; ctx.textAlign = "center";
      ctx.fillText("Loading the aurora map…", W / 2, W / 2);
      return;
    }
    const proj = d3.geoAzimuthalEquidistant().rotate([0, hemisphere ? -90 : 90]).clipAngle(62).translate([W / 2, W / 2]).scale(R / (62 * Math.PI / 180));
    const path = d3.geoPath(proj, ctx);
    ctx.save();
    ctx.beginPath(); ctx.arc(W / 2, W / 2, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = "#0e3446"; ctx.beginPath(); path({ type: "Sphere" }); ctx.fill();
    ctx.fillStyle = "#2c5a4f"; ctx.beginPath(); path(land); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.25)"; ctx.lineWidth = 1.5; ctx.beginPath(); path(land); ctx.stroke();
    // Night side.
    const [slon, slat] = subsolar();
    const night = d3.geoCircle().center([slon + 180, -slat]).radius(90)();
    ctx.fillStyle = "rgba(0,4,12,.45)"; ctx.beginPath(); path(night); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.08)"; ctx.beginPath(); path(d3.geoGraticule().step([30, 15])()); ctx.stroke();
    // Aurora cells.
    ctx.globalCompositeOperation = "lighter";
    for (let lon = 0; lon < 360; lon++) {
      for (let la = 0; la <= 180; la++) {
        const v = oval.grid[lon * 181 + la];
        if (v < 4) continue;
        const lat = la - 90;
        if (hemisphere ? lat < 25 : lat > -25) continue;
        const p = proj([lon > 180 ? lon - 360 : lon, lat]);
        if (!p) continue;
        const a = Math.min(1, v / 60);
        const hue = v > 50 ? 10 : v > 25 ? 70 : 145;
        ctx.fillStyle = `hsla(${hue}, 100%, 58%, ${0.12 + a * 0.55})`;
        ctx.beginPath(); ctx.arc(p[0], p[1], 7, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalCompositeOperation = "source-over";
    const w = store.get("nightSky.where");
    if (w) { const p = proj([w.lon, w.lat]); if (p) { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(p[0], p[1], 9, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = "#ec8a4f"; ctx.lineWidth = 4; ctx.stroke(); } }
    ctx.restore();
    const t = host.querySelector("#oval-time");
    if (t) t.textContent = `Forecast for ${fmtTime(oval.forecast)}`;
  }

  const onClick = (e) => {
    const hemi = e.target.closest("[data-hemi]")?.dataset.hemi;
    if (hemi) { hemisphere = hemi === "n"; store.set("aurora.north", hemisphere); host.querySelectorAll("[data-hemi]").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.hemi === "n") === hemisphere))); drawOval(); return; }
    if (e.target.closest('[data-act="retry"]')) return load(true);
    if (e.target.closest('[data-act="locate"]')) {
      navigator.geolocation?.getCurrentPosition((p) => {
        store.set("nightSky.where", { lat: p.coords.latitude, lon: p.coords.longitude });
        if (p.coords.latitude < 0) { hemisphere = false; store.set("aurora.north", false); }
        paintLocal(); drawOval();
      }, () => toast("Couldn't get your location"), { maximumAge: 3600000, timeout: 10000 });
    }
  };
  host.addEventListener("click", onClick);
  load();
  return () => { destroyed = true; host.removeEventListener("click", onClick); };
}

// ───────── Moon ─────────
const MARIA = [
  [32.8, -15.6, 560], [18.4, -57.4, 1250], [28, 17.5, 350], [8.5, 31.4, 435], [17, 59.1, 280], [-21.3, -16.6, 360],
  [-7.8, 51.3, 450], [-15.2, 35.5, 170], [-24.4, -38.6, 195], [56, 1.4, 600], [-20.6, -60, 160], [42, -60, 400],
];

function moonSVG(phase, size = 400) {
  const c = size / 2, r = size / 2 - 6, R = 1737.4;
  const proj = (lat, lon) => [c + r * Math.cos(lat * Math.PI / 180) * Math.sin(lon * Math.PI / 180), c - r * Math.sin(lat * Math.PI / 180)];
  const maria = MARIA.map(([lat, lon, km]) => {
    const [x, y] = proj(lat, lon);
    const rad = (km / R) * r;
    const squash = Math.cos(lon * Math.PI / 180) * Math.cos(lat * Math.PI / 180);
    return `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${(rad * Math.max(0.35, Math.abs(Math.cos(lon * Math.PI / 180)))).toFixed(1)}" ry="${(rad * Math.max(0.35, Math.abs(Math.cos(lat * Math.PI / 180)))).toFixed(1)}" fill="#8a857c" opacity="${(0.5 + 0.2 * squash).toFixed(2)}"/>`;
  }).join("");
  const [tx, ty] = proj(-43.3, -11.2), [cx2, cy2] = proj(9.6, -20.1);
  const lit = litPath(phase, c, c, r);
  return raw(`<svg class="moon-disk" viewBox="0 0 ${size} ${size}" role="img" aria-label="The Moon, ${Math.round(phase.illumination * 100)} percent lit">
    <defs>
      <radialGradient id="mg" cx="45%" cy="40%" r="65%"><stop offset="0" stop-color="#f4efe3"/><stop offset=".7" stop-color="#d9d3c4"/><stop offset="1" stop-color="#a8a293"/></radialGradient>
      <filter id="mblur"><feGaussianBlur stdDeviation="${(size / 90).toFixed(1)}"/></filter>
      <clipPath id="mclip"><circle cx="${c}" cy="${c}" r="${r}"/></clipPath>
      <mask id="mdark"><rect width="${size}" height="${size}" fill="white"/><path d="${lit}" fill="black"/></mask>
    </defs>
    <circle cx="${c}" cy="${c}" r="${r}" fill="url(#mg)"/>
    <g clip-path="url(#mclip)" filter="url(#mblur)">${maria}
      <circle cx="${tx}" cy="${ty}" r="${size / 70}" fill="#fffaf0"/><circle cx="${cx2}" cy="${cy2}" r="${size / 90}" fill="#f6f1e6"/></g>
    <circle cx="${c}" cy="${c}" r="${r}" fill="#03080d" opacity=".94" mask="url(#mdark)"/>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(241,236,224,.12)"/>
  </svg>`);
}

function moonSection(host) {
  let offset = 0; // days from now
  let playing = null;
  const upcoming = [[0, "New Moon"], [90, "First Quarter"], [180, "Full Moon"], [270, "Last Quarter"]]
    .map(([deg, name]) => ({ name, date: nextPhase(deg) })).filter((x) => x.date).sort((a, b) => a.date - b.date);
  const strip = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(); d.setHours(21, 0, 0, 0); d.setDate(d.getDate() + i - 2);
    return { d, i: i - 2, p: moonPhase(d) };
  });

  mount(host, html`
    <div class="card"><div class="moon-layout">
      <div id="moon-art"></div>
      <div>
        <div id="moon-info"></div>
        <label class="small faint" for="moon-slider" style="display:block;margin-top:16px">Run the Moon through its month</label>
        <div class="row" style="flex-wrap:nowrap">
          <button class="btn btn-icon" data-act="play" aria-label="Play">${icon("play")}</button>
          <input type="range" id="moon-slider" min="-15" max="15" step="0.05" value="0" />
          <button class="btn btn-sm" data-act="now" disabled>Now</button>
        </div>
      </div>
    </div></div>
    <div class="two-col" style="margin-top:16px">
      <div class="card"><h3>Coming up</h3>
        ${upcoming.map((u) => html`<div class="row" style="justify-content:space-between;padding:8px 0;border-top:1px solid var(--line)">
          <span class="row" style="gap:10px">${raw(moonIcon(moonPhase(u.date), 26))} ${u.name}</span>
          <span class="muted">${fmtDate(u.date, { weekday: "short", month: "short", day: "numeric" })}, ${fmtTime(u.date)}</span></div>`)}
      </div>
      <div class="card"><h3>Where the phase comes from</h3>
        <p class="muted small">Sunlight always lights half the Moon. The phase is how much of that sunlit half faces Earth: none at new Moon, all of it at full. One cycle takes ${SYNODIC.toFixed(2)} days, a little longer than one orbit (27.3 days) because Earth moves along its own orbit meanwhile.</p>
        <p class="muted small">A bright Moon washes out faint stars and the Milky Way, so the best stargazing nights are within a few days of new Moon.</p>
      </div>
    </div>
    <h2 class="section-title">${icon("calendar-days")} Next 4 weeks</h2>
    <div class="moon-strip">${strip.map((s) => html`<button data-day="${s.i}" title="${s.p.name}, ${Math.round(s.p.illumination * 100)}%">
      ${raw(moonIcon(s.p, 34))}<span>${s.i === 0 ? "Tonight" : fmtDate(s.d, { month: "short", day: "numeric" })}</span></button>`)}</div>`);

  const art = host.querySelector("#moon-art"), info = host.querySelector("#moon-info");
  const slider = host.querySelector("#moon-slider"), nowBtn = host.querySelector('[data-act="now"]'), playBtn = host.querySelector('[data-act="play"]');

  function update() {
    const date = new Date(Date.now() + offset * 86400000);
    const p = moonPhase(date);
    const dist = moonDistance(date);
    const size = 2 * Math.asin(1737.4 / dist) * 180 / Math.PI;
    const closer = (384400 - dist) / 384400 * 100;
    art.innerHTML = moonSVG(p).s;
    mount(info, html`
      <div class="eyebrow">${Math.abs(offset) < 0.01 ? "The Moon right now" : fmtDate(date, { weekday: "long", month: "long", day: "numeric" })}</div>
      <h2 class="serif" style="font-size:36px;margin:0">${p.name}</h2>
      <p class="muted" style="font-size:18px;margin:6px 0 0">${Math.round(p.illumination * 100)}% illuminated · ${p.waxing ? "waxing" : "waning"} · day ${p.age.toFixed(1)} of ${SYNODIC.toFixed(1)}</p>
      <div class="readout" style="margin-top:18px">
        <div class="stat"><div class="k">Distance</div><div class="v">${Math.round(dist).toLocaleString()} km</div></div>
        <div class="stat"><div class="k">Apparent size</div><div class="v">${size.toFixed(2)}°</div></div>
      </div>
      <p class="muted small" style="margin-top:10px">${Math.abs(closer) < 1 ? "About its average distance." : `${Math.abs(closer).toFixed(0)}% ${closer > 0 ? "closer" : "farther"} than average.`}</p>`);
    slider.value = offset;
    nowBtn.disabled = Math.abs(offset) < 0.01;
    host.querySelectorAll("[data-day]").forEach((b) => b.setAttribute("aria-pressed", String(Math.round(offset) === Number(b.dataset.day))));
  }
  function setPlaying(on) {
    clearInterval(playing); playing = null;
    if (on) playing = setInterval(() => { offset += 0.25; if (offset > 15) offset = -15; update(); }, 60);
    playBtn.setAttribute("aria-label", on ? "Pause" : "Play");
    playBtn.innerHTML = `<i data-lucide="${on ? "pause" : "play"}"></i>`;
    window.lucide?.createIcons();
  }

  const onInput = (e) => { if (e.target === slider) { offset = Number(slider.value); setPlaying(false); update(); } };
  const onClick = (e) => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    const day = e.target.closest("[data-day]")?.dataset.day;
    if (act === "now") { offset = 0; setPlaying(false); update(); }
    else if (act === "play") setPlaying(!playing);
    else if (day != null) { offset = Number(day); setPlaying(false); update(); }
  };
  host.addEventListener("input", onInput);
  host.addEventListener("click", onClick);
  update();
  return () => { clearInterval(playing); host.removeEventListener("input", onInput); host.removeEventListener("click", onClick); };
}
