// Live data shared between the hub tiles and their pages, so each source is asked once.
import { cached, fetchJSON, loadData } from "./lib.js";

const LL2 = "https://ll.thespacedevs.com/2.3.0/";
// Launch Library's free tier allows ~15 requests/hour per visitor, so its answers are kept a while.
const LL2_TTL = 15 * 60 * 1000;

// ───────── Launches ─────────
function launchItem(l) {
  const cfg = l.rocket?.configuration || {};
  const trim = (s) => (s && String(s).trim()) || null;
  return {
    id: l.id, name: l.name, net: l.net, precision: l.net_precision?.name || null,
    provider: trim(l.launch_service_provider?.name) || "—", providerAbbrev: l.launch_service_provider?.abbrev || null,
    location: trim(l.pad?.location?.name) || trim(l.pad?.name) || "—", pad: trim(l.pad?.name),
    image: l.image?.image_url || null, thumb: l.image?.thumbnail_url || l.image?.image_url || null,
    status: l.status?.name || null, statusAbbrev: l.status?.abbrev || null, statusDescription: l.status?.description || null,
    programs: (l.program || []).map((p) => p.name).filter(Boolean),
    rocket: trim(cfg.full_name) || trim(cfg.name), rocketWiki: cfg.wiki_url || null,
    mission: trim(l.mission?.name), missionDescription: trim(l.mission?.description), missionType: trim(l.mission?.type),
    orbit: trim(l.mission?.orbit?.name), windowStart: l.window_start, windowEnd: l.window_end,
    probability: l.probability, webcastLive: !!l.webcast_live,
    vid: (l.vid_urls || l.mission?.vid_urls || []).map((v) => v.url).filter(Boolean)[0] || null,
  };
}

export function getLaunches({ force = false } = {}) {
  return cached("launches", LL2_TTL, async () => {
    const data = await fetchJSON(`${LL2}launches/upcoming/?limit=60&mode=normal&ordering=net`);
    return data.results.map(launchItem);
  }, { force });
}

/** True when the launch is pinned to a day (not just "NET November" or "Q3 2027"). */
export function hasExactDay(l) {
  return !l.precision || !/Week|Month|Quarter|Half|Year|Decade/i.test(l.precision);
}
export function hasExactTime(l) {
  return !l.precision || /Second|Minute/i.test(l.precision);
}

/** Recently finished launches drop off a few hours after liftoff. */
export function isUpcoming(l, now = Date.now()) {
  const t = new Date(l.net).getTime();
  const done = /Success|Failure|Partial/i.test(l.status || "");
  return done ? now - t < 3 * 3600000 : now - t < 12 * 3600000;
}

// ───────── Astronauts ─────────
export function getAstronauts(scope = "inSpace", { force = false, offset = 0 } = {}) {
  const key = `astronauts:${scope}:${offset}`;
  return cached(key, LL2_TTL, async () => {
    const params = new URLSearchParams({ format: "json", mode: "normal", limit: "100", offset: String(offset), ordering: "-time_in_space", is_human: "true" });
    if (scope === "inSpace") params.set("in_space", "true");
    const data = await fetchJSON(`${LL2}astronauts/?${params}`);
    return { count: data.count, next: data.next, results: data.results };
  }, { force });
}

export async function searchAstronauts(q) {
  const params = new URLSearchParams({ format: "json", mode: "normal", limit: "40", ordering: "-time_in_space", is_human: "true", search: q });
  const data = await fetchJSON(`${LL2}astronauts/?${params}`);
  return data.results;
}

// ───────── ISS ─────────
export async function getISS() {
  return fetchJSON("https://api.wheretheiss.at/v1/satellites/25544", { timeout: 8000 });
}

// ───────── Eclipses (bundled NASA catalog) ─────────
export async function getEclipses() {
  const list = await loadData("eclipses.json");
  return list.map((e) => ({ ...e, greatest: greatestTime(e) }));
}
/** NASA lists greatest eclipse in Terrestrial Dynamical Time, about 69 s ahead of UTC these years. */
function greatestTime(e) {
  const [h, m, s] = (e.td || "12:00:00").split(":").map(Number);
  const d = new Date(`${e.date}T00:00:00Z`);
  return new Date(d.getTime() + ((h * 60 + m) * 60 + (s || 0) - 69) * 1000);
}
