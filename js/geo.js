// What's below a point on Earth ("Over Texas · near Houston", "180 mi off Louisiana"), ported from the
// app's GroundGeography: point-in-polygon lookups against the bundled Natural Earth outlines.
import { loadData } from "./lib.js";

const EARTH_KM = 6371;
const COAST_BY_STATE = new Set(["US", "CA", "AU", "BR", "IN", "ZA"]);
let geoPromise = null;

function decodeRings(list, scale) {
  return (list || []).filter((f) => f.length >= 2).map((flat) => {
    let x = flat[0], y = flat[1];
    const ring = [[x / scale, y / scale]];
    for (let i = 2; i + 1 < flat.length; i += 2) { x += flat[i]; y += flat[i + 1]; ring.push([x / scale, y / scale]); }
    return ring;
  });
}

function makeShape(name, code, usesThe, rings) {
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (const r of rings) for (const [x, y] of r) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, y); d = Math.max(d, y); }
  return { name, code, usesThe, rings, minLon: a, maxLon: b, minLat: c, maxLat: d };
}

function contains(s, lon, lat) {
  if (lon < s.minLon || lon > s.maxLon || lat < s.minLat || lat > s.maxLat) return false;
  let inside = false;
  for (const ring of s.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function vertices(list, include = () => true) {
  const out = [];
  list.forEach((s, idx) => {
    if (!include(s)) return;
    for (const ring of s.rings) for (const [x, y] of ring) {
      const lat = y * Math.PI / 180;
      out.push([x * Math.PI / 180, Math.sin(lat), Math.cos(lat), idx]);
    }
  });
  return out;
}

export function loadGeography() {
  if (!geoPromise) {
    geoPromise = loadData("iss-geography.json").then((root) => {
      const scale = root.scale || 100;
      const shapes = (key, hasArticle) => (root[key] || []).map((it) => makeShape(it[0], it[1], hasArticle && it[2] === "the", decodeRings(it[it.length - 1], scale)));
      const g = {
        countries: shapes("countries", true), states: shapes("states"), water: shapes("water"), regions: shapes("regions"),
        cities: (root.cities || []).map((c) => ({ name: c[0], lat: c[1], lon: c[2] })),
      };
      g.coast = vertices(g.countries);
      g.stateV = vertices(g.states, (s) => COAST_BY_STATE.has(s.code));
      g.seaV = vertices(g.water, (s) => s.code !== "lake");
      return g;
    });
    geoPromise.catch(() => { geoPromise = null; });
  }
  return geoPromise;
}

function nearest(verts, lat, lon) {
  const p = lat * Math.PI / 180, l = lon * Math.PI / 180, s = Math.sin(p), c = Math.cos(p);
  let best = -2, owner = -1;
  for (const v of verts) {
    const ca = s * v[1] + c * v[2] * Math.cos(l - v[0]);
    if (ca > best) { best = ca; owner = v[3]; }
  }
  return owner < 0 ? null : { index: owner, km: Math.acos(Math.min(1, Math.max(-1, best))) * EARTH_KM };
}

function nearestCity(g, lat, lon, limit) {
  const p = lat * Math.PI / 180, l = lon * Math.PI / 180;
  let best = null, bestKm = Infinity;
  for (const city of g.cities) {
    const p2 = city.lat * Math.PI / 180, l2 = city.lon * Math.PI / 180;
    const km = Math.acos(Math.min(1, Math.max(-1, Math.sin(p) * Math.sin(p2) + Math.cos(p) * Math.cos(p2) * Math.cos(l - l2)))) * EARTH_KM;
    if (km <= limit && km < bestKm) { best = city; bestKm = km; }
  }
  return best;
}

const withArticle = (s) => (s.usesThe ? `the ${s.name}` : s.name);
const stateName = (n) => (n.endsWith("Territory") || n.endsWith("Territories") || n.startsWith("District of") ? `the ${n}` : n);
function waterName(s) {
  if (s.code === "lake") return s.name;
  const lead = ["Gulf of ", "Bay of ", "Sea of ", "Strait of ", "Straits of ", "Bight of "];
  const tail = [" Sea", " Ocean", " Channel", " Strait", " Passage", " Bight", " Basin", " Gulf", " Reef", " Sound"];
  const bare = ["Kattegat", "Skagerrak", "Øresund", "Bosporus", "Dardanelles", "Bab-el-Mandeb", "Río de la Plata"];
  if (["sea", "ocean", "channel", "reef"].includes(s.code) || lead.some((x) => s.name.startsWith(x)) || tail.some((x) => s.name.endsWith(x)) || bare.includes(s.name)) return `the ${s.name}`;
  return s.name;
}
const metric = () => !["en-US", "en-LR", "my-MM"].includes(navigator.language);
function distance(km) {
  const v = metric() ? km : km * 0.621371;
  const unit = metric() ? "km" : "mi";
  const rounded = Number(v.toPrecision(2));
  return `${rounded.toLocaleString()} ${unit}`;
}
const join = (parts) => parts.filter(Boolean).join(" · ") || null;

export function describe(g, lat, rawLon) {
  const lon = (((rawLon + 540) % 360) + 360) % 360 - 180;
  const country = g.countries.find((s) => contains(s, lon, lat));
  if (country) {
    const state = g.states.find((s) => s.code === country.code && contains(s, lon, lat));
    const inland = g.water.find((s) => s.code !== "ocean" && contains(s, lon, lat));
    if (inland) return { title: `Over ${waterName(inland)}`, detail: state ? `${state.name}, ${country.name}` : country.name, water: true };
    const title = `Over ${state ? stateName(state.name) : withArticle(country)}`;
    const parts = state ? [country.name] : [];
    const named = [country.name, state?.name].filter(Boolean).map((n) => n.toLowerCase());
    const city = nearestCity(g, lat, lon, 90);
    if (city) parts.push(`near ${city.name}`);
    else {
      const lm = g.regions.find((s) => contains(s, lon, lat) && !named.some((n) => s.name.toLowerCase().includes(n) || n.includes(s.name.toLowerCase())));
      if (lm) parts.push(lm.name);
    }
    return { title, detail: join(parts), water: false };
  }
  const body = g.water.find((s) => s.code !== "lake" && contains(s, lon, lat)) || (() => { const n = nearest(g.seaV, lat, lon); return n ? g.water[n.index] : null; })();
  const title = body ? `Over ${waterName(body)}` : "Over the ocean";
  let detail = null;
  const hit = nearest(g.coast, lat, lon);
  if (hit) {
    const c = g.countries[hit.index];
    let name = withArticle(c);
    if (COAST_BY_STATE.has(c.code)) {
      const sh = nearest(g.stateV, lat, lon);
      if (sh && g.states[sh.index].code === c.code && sh.km - hit.km < 40) name = g.states[sh.index].name;
    }
    detail = hit.km < 25 ? `Just off ${name}` : hit.km < 400 ? `${distance(hit.km)} off ${name}` : `${distance(hit.km)} from ${name}`;
  }
  return { title, detail, water: true };
}

export function coordText(lat, lon) {
  return `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
}
