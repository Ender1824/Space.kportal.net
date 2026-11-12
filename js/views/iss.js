// ISS Tracker: a 3D globe with the ISS (wheretheiss.at) and Tiangong (CelesTrak TLE + SGP4), their
// ground tracks, and a plain-English "what's below" readout from the bundled Natural Earth data.
import { html, icon, mount, pageHead, loadScript, cached, fetchText, fmtNumber, fmtTime, reducedMotion } from "../lib.js";
import { getISS } from "../api.js";
import { loadGeography, describe, coordText } from "../geo.js";

const GLOBE_JS = "https://cdn.jsdelivr.net/npm/globe.gl@2.32.0/dist/globe.gl.min.js";
const SAT_JS = "https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/dist/satellite.min.js";
const IMG = "https://cdn.jsdelivr.net/npm/three-globe@2.31.0/example/img/";

const STATIONS = {
  iss: { name: "International Space Station", short: "ISS", norad: 25544, color: "#ec8a4f", marker: "assets/iss-marker.png" },
  tiangong: { name: "Tiangong Space Station", short: "Tiangong", norad: 48274, color: "#63adff", marker: "assets/tiangong-marker.png" },
};

const metric = () => !["en-US", "en-LR", "my-MM"].includes(navigator.language);

async function tle(norad) {
  return cached(`tle:${norad}`, 6 * 3600000, async () => {
    const text = await fetchText(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${norad}&FORMAT=TLE`);
    const lines = text.split(/\r?\n/).map((l) => l.trim());
    const l1 = lines.find((l) => l.startsWith("1 ")), l2 = lines.find((l) => l.startsWith("2 "));
    if (!l1 || !l2) throw new Error("No TLE");
    return [l1, l2];
  });
}

function propagate(sat, rec, date) {
  const pv = sat.propagate(rec, date);
  if (!pv.position || typeof pv.position === "boolean") return null;
  const gmst = sat.gstime(date);
  const g = sat.eciToGeodetic(pv.position, gmst);
  const v = pv.velocity;
  return {
    latitude: sat.degreesLat(g.latitude), longitude: sat.degreesLong(g.longitude), altitude: g.height,
    velocity: Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) * 3600,
  };
}

/** Ground track ±45 minutes around now, split where it crosses the antimeridian. */
function track(sat, rec, now) {
  const segs = [[]];
  for (let m = -45; m <= 50; m += 1) {
    const p = propagate(sat, rec, new Date(now + m * 60000));
    if (!p) continue;
    const cur = segs[segs.length - 1];
    const last = cur[cur.length - 1];
    if (last && Math.abs(last[1] - p.longitude) > 180) segs.push([]);
    segs[segs.length - 1].push([p.latitude, p.longitude, 0.012, m < 0]);
  }
  return segs.filter((s) => s.length > 1);
}

export async function render(root, { query }) {
  let following = query.get("s") === "tiangong" ? "tiangong" : "iss";
  let follow = true;
  const state = { iss: null, tiangong: null };
  const recs = {};
  let geo = null, globe = null, sat = null;
  const timers = [];
  let destroyed = false;

  mount(root, html`
    ${pageHead({ back: { href: "#/explore", label: "Explore" }, eyebrow: html`${icon("earth")} Live`, title: "ISS Tracker",
      subtitle: "Where the International Space Station and China's Tiangong are right now, with their paths over the next orbit." })}
    <div class="iss-layout">
      <div class="globe-wrap" id="globe-wrap">
        <div id="globe"></div>
        <div class="globe-overlay">
          <button class="btn btn-sm" data-act="follow" aria-pressed="true">${icon("locate-fixed")} <span>Following</span></button>
        </div>
        <div class="state" id="globe-loading" style="position:absolute;inset:0;display:grid;place-items:center"><div><div class="spinner"></div><p>Locating the ISS…</p></div></div>
      </div>
      <aside class="card" id="panel">
        <div class="sat-pick seg" role="group" aria-label="Station">
          <button data-sat="iss">ISS</button><button data-sat="tiangong">Tiangong</button>
        </div>
        <div id="readout"><div class="skeleton" style="height:28px;width:70%"></div><div class="skeleton" style="height:16px;width:50%;margin-top:10px"></div></div>
      </aside>
    </div>`);

  const wrap = root.querySelector("#globe-wrap");
  const readout = root.querySelector("#readout");

  function paintReadout() {
    root.querySelectorAll("[data-sat]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sat === following)));
    const s = state[following];
    const info = STATIONS[following];
    if (!s) { mount(readout, html`<p class="muted">Finding ${info.short}…</p>`); return; }
    const place = geo ? describe(geo, s.latitude, s.longitude) : { title: coordText(s.latitude, s.longitude), detail: null };
    const alt = metric() ? `${fmtNumber(s.altitude)} km` : `${fmtNumber(s.altitude * 0.621371)} mi`;
    const speed = metric() ? `${fmtNumber(s.velocity)} km/h` : `${fmtNumber(s.velocity * 0.621371)} mph`;
    mount(readout, html`
      <div class="eyebrow" style="color:${info.color}">${icon("satellite")} ${info.name}</div>
      <div class="place-title">${place.title}</div>
      ${place.detail ? html`<div class="muted">${place.detail}</div>` : ""}
      <div class="readout">
        <div class="stat"><div class="k">Altitude</div><div class="v">${alt}</div></div>
        <div class="stat"><div class="k">Speed</div><div class="v">${speed}</div></div>
        <div class="stat"><div class="k">Position</div><div class="v" style="font-size:15px">${coordText(s.latitude, s.longitude)}</div></div>
        <div class="stat"><div class="k">Sunlight</div><div class="v" style="font-size:15px">${s.visibility ? (s.visibility === "daylight" ? "In daylight" : "In Earth's shadow") : "—"}</div></div>
      </div>
      <p class="faint small" style="margin-top:14px">Updated ${fmtTime(s.at)} · ${following === "iss" ? "wheretheiss.at" : "CelesTrak orbit, computed in your browser"}. It circles Earth about every 92 minutes.</p>`);
  }

  function paintGlobe() {
    if (!globe) return;
    const markers = Object.entries(state).filter(([, s]) => s).map(([id, s]) => ({ id, lat: s.latitude, lng: s.longitude }));
    globe.htmlElementsData(markers);
    const paths = [];
    for (const id of Object.keys(STATIONS)) {
      if (!recs[id]) continue;
      for (const seg of track(sat, recs[id], Date.now())) paths.push({ id, pts: seg });
    }
    globe.pathsData(paths);
    if (follow && state[following]) {
      globe.pointOfView({ lat: state[following].latitude, lng: state[following].longitude, altitude: globe.pointOfView().altitude }, reducedMotion() ? 0 : 900);
    }
  }

  async function updateISS() {
    try {
      const p = await getISS();
      state.iss = { latitude: p.latitude, longitude: p.longitude, altitude: p.altitude, velocity: p.velocity, visibility: p.visibility, at: new Date(p.timestamp * 1000) };
    } catch {
      if (sat && recs.iss) { const p = propagate(sat, recs.iss, new Date()); if (p) state.iss = { ...p, at: new Date() }; }
    }
    if (destroyed) return;
    root.querySelector("#globe-loading")?.remove();
    paintReadout(); paintGlobe();
  }

  function updateTiangong() {
    if (!sat || !recs.tiangong) return;
    const p = propagate(sat, recs.tiangong, new Date());
    if (p) state.tiangong = { ...p, at: new Date() };
    if (following === "tiangong") paintReadout();
  }

  root.addEventListener("click", (e) => {
    const s = e.target.closest("[data-sat]")?.dataset.sat;
    if (s) { following = s; follow = true; setFollow(); paintReadout(); paintGlobe(); return; }
    if (e.target.closest('[data-act="follow"]')) { follow = !follow; setFollow(); paintGlobe(); }
  });
  function setFollow() {
    const b = root.querySelector('[data-act="follow"]');
    b.setAttribute("aria-pressed", String(follow));
    b.querySelector("span").textContent = follow ? `Following ${STATIONS[following].short}` : "Follow";
  }
  setFollow();

  // Data first (fast), then the globe library (≈1 MB) and orbit math.
  updateISS();
  loadGeography().then((g) => { geo = g; paintReadout(); }).catch(() => {});
  timers.push(setInterval(updateISS, 5000));

  try {
    await Promise.all([loadScript(GLOBE_JS), loadScript(SAT_JS)]);
    if (destroyed) return;
    sat = window.satellite;
    const el = root.querySelector("#globe");
    globe = window.Globe()(el)
      .width(wrap.clientWidth).height(wrap.clientHeight)
      .backgroundColor("rgba(0,0,0,0)")
      .globeImageUrl(IMG + "earth-blue-marble.jpg")
      .bumpImageUrl(IMG + "earth-topology.png")
      .showAtmosphere(true).atmosphereColor("#7fb8ff").atmosphereAltitude(0.18)
      .pathPoints("pts").pathPointLat((p) => p[0]).pathPointLng((p) => p[1]).pathPointAlt((p) => p[2])
      .pathColor((d) => [STATIONS[d.id].color + "33", STATIONS[d.id].color])
      .pathStroke(2).pathTransitionDuration(0)
      .htmlAltitude(0.05)
      .htmlElement((d) => {
        const div = document.createElement("div");
        const info = STATIONS[d.id];
        div.style.cssText = "transform:translate(-50%,-50%);pointer-events:auto;cursor:pointer;text-align:center";
        div.innerHTML = `<img src="${info.marker}" alt="${info.short}" style="width:${d.id === following ? 54 : 40}px;filter:drop-shadow(0 0 8px ${info.color})"/>
          <div style="font:600 12px Inter,sans-serif;color:#fff;text-shadow:0 1px 4px #000;margin-top:-4px">${info.short}</div>`;
        div.onclick = () => { following = d.id; follow = true; setFollow(); paintReadout(); paintGlobe(); };
        return div;
      });
    globe.controls().enableZoom = true;
    globe.controls().addEventListener("start", () => { if (follow) { follow = false; setFollow(); } });
    globe.pointOfView({ lat: state.iss?.latitude || 20, lng: state.iss?.longitude || 0, altitude: 2.2 }, 0);

    const ro = new ResizeObserver(() => globe && globe.width(wrap.clientWidth).height(wrap.clientHeight));
    ro.observe(wrap);
    timers.push({ disconnect: () => ro.disconnect() });

    const [issTLE, tgTLE] = await Promise.allSettled([tle(25544), tle(48274)]);
    if (issTLE.status === "fulfilled") recs.iss = sat.twoline2satrec(...issTLE.value);
    if (tgTLE.status === "fulfilled") recs.tiangong = sat.twoline2satrec(...tgTLE.value);
    updateTiangong();
    root.querySelector("#globe-loading")?.remove();
    paintGlobe();
    timers.push(setInterval(updateTiangong, 2000));
    timers.push(setInterval(paintGlobe, 5000));
  } catch {
    const l = root.querySelector("#globe-loading");
    if (l) mount(l, html`<p class="muted">The 3D globe couldn't load. The live readout still updates.</p>`);
  }

  return () => {
    destroyed = true;
    timers.forEach((t) => (t.disconnect ? t.disconnect() : clearInterval(t)));
    if (globe) { try { globe._destructor?.(); globe.pauseAnimation?.(); } catch { /* ignore */ } }
  };
}
