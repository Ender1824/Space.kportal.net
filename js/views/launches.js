// Upcoming Launches: Launch Library 2's calendar with the app's provider and program filters,
// a live countdown to the next launch, and .ics "Add to Calendar".
import { html, icon, mount, pageHead, openModal, errorState, loadingState, fmtDate, fmtTime, countdownParts, downloadICS, relTime, cachedAge, wikiURL, raw } from "../lib.js";
import { getLaunches, hasExactDay, hasExactTime, isUpcoming } from "../api.js";

const PROVIDERS = {
  All: [], SpaceX: ["SpaceX"], "Rocket Lab": ["Rocket Lab"], ULA: ["United Launch Alliance", "ULA"],
  ESA: ["European Space Agency", "Arianespace", "ESA"], Roscosmos: ["Roscosmos", "Russian Federal Space Agency", "Progress Rocket Space Center", "Khrunichev", "RFSA"],
  ISRO: ["Indian Space Research", "ISRO", "NewSpace India"],
};
const PROGRAMS = ["All", "ISS", "Artemis", "Commercial Crew", "Starlink"];

const word = (name, w) => new RegExp(`(^|[^A-Za-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z0-9]|$)`, "i").test(name);

function providerMatches(p, l) {
  if (p === "All") return true;
  const fields = [l.provider, l.providerAbbrev || ""].map((f) => f.toLowerCase());
  return PROVIDERS[p].some((alias) => fields.some((f) => f === alias.toLowerCase() || (alias.length > 4 && f.includes(alias.toLowerCase()))));
}
function programMatches(p, l) {
  const progs = l.programs.map((x) => x.toLowerCase());
  switch (p) {
    case "ISS": return progs.some((x) => x.includes("international space station")) || ["ISS", "CRS", "Progress MS", "Soyuz MS", "Cygnus"].some((w) => word(l.name, w));
    case "Artemis": return progs.some((x) => x.includes("artemis")) || word(l.name, "Artemis");
    case "Commercial Crew": return progs.some((x) => x.includes("commercial crew")) || /\bCrew-\d+|\bAx-\d+|Starliner|Crew Flight Test/i.test(l.name);
    case "Starlink": return word(l.name, "Starlink");
    default: return true;
  }
}

function statusClass(l) {
  const a = (l.statusAbbrev || "").toLowerCase();
  if (a === "go" || a.includes("flight")) return "go";
  if (a === "success") return "done";
  if (a.includes("fail")) return "fail";
  if (a === "hold") return "hold";
  return "tbd";
}
const statusPill = (l) => (l.status ? html`<span class="status ${statusClass(l)}">${l.status}</span>` : "");

function periodLabel(l) {
  const d = new Date(l.net);
  const p = l.precision || "";
  if (/Quarter/i.test(p)) return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
  if (/Half/i.test(p)) return `${d.getUTCMonth() < 6 ? "First" : "Second"} half of ${d.getUTCFullYear()}`;
  if (/Year|Decade/i.test(p)) return String(d.getUTCFullYear());
  if (/Week/i.test(p)) return `Week of ${fmtDate(d, { month: "long", day: "numeric", timeZone: "UTC" })}`;
  return fmtDate(d, { month: "long", year: "numeric", timeZone: "UTC" });
}

function timeLabel(l) {
  if (!hasExactDay(l)) return html`<b>${periodLabel(l)}</b>No earlier than`;
  if (!hasExactTime(l)) return html`<b>${fmtDate(l.net, { month: "short", day: "numeric" })}</b>Time not set`;
  return html`<b>${fmtTime(l.net)}</b>${fmtDate(l.net, { month: "short", day: "numeric" })}`;
}

function row(l) {
  return html`<button class="launch-row" data-id="${l.id}">
    ${l.thumb ? html`<img src="${l.thumb}" alt="" loading="lazy" />` : html`<span class="ph">${icon("rocket")}</span>`}
    <span><div class="t">${l.mission || l.name}</div><div class="s">${l.rocket || ""} · ${l.providerAbbrev || l.provider}</div>
      <div class="s faint">${l.location}</div>${statusPill(l)}</span>
    <span class="time">${timeLabel(l)}</span></button>`;
}

function detail(l) {
  const exact = hasExactDay(l);
  const windowText = l.windowStart && l.windowEnd
    ? (l.windowStart === l.windowEnd ? "Instantaneous launch window" : `Window ${fmtTime(l.windowStart)} – ${fmtTime(l.windowEnd)}`) : "";
  return html`
    ${l.image ? html`<img class="modal-hero" src="${l.image}" alt="" />` : ""}
    <div class="modal-body">
      <div class="row">${statusPill(l)}${l.webcastLive ? html`<span class="chip live"><span class="dot-live"></span> Webcast live</span>` : ""}</div>
      <h2 style="margin-top:10px">${l.mission || l.name}</h2>
      <div class="muted">${l.rocket || ""} · ${l.provider}</div>
      <div class="stat-grid">
        <div class="stat"><div class="k">Launch</div><div class="v" style="font-size:15px">${exact ? (hasExactTime(l) ? `${fmtDate(l.net, { weekday: "short", month: "short", day: "numeric" })}, ${fmtTime(l.net)}` : fmtDate(l.net, { weekday: "short", month: "short", day: "numeric", year: "numeric" })) : `NET ${periodLabel(l)}`}</div></div>
        ${l.orbit ? html`<div class="stat"><div class="k">Orbit</div><div class="v" style="font-size:15px">${l.orbit}</div></div>` : ""}
        ${l.missionType ? html`<div class="stat"><div class="k">Mission type</div><div class="v" style="font-size:15px">${l.missionType}</div></div>` : ""}
        ${l.probability != null ? html`<div class="stat"><div class="k">Weather go</div><div class="v">${l.probability}%</div></div>` : ""}
      </div>
      <p class="muted small">${icon("map-pin")} ${l.pad ? `${l.pad}, ` : ""}${l.location}${windowText ? html`<br>${icon("clock")} ${windowText}` : ""}</p>
      ${!exact ? html`<p class="muted small">The launch day hasn't been set yet.</p>` : ""}
      ${l.missionDescription ? html`<h3 style="margin-top:18px">Mission</h3><p class="muted" style="line-height:1.7;white-space:pre-line">${l.missionDescription}</p>` : ""}
      <div class="row" style="margin-top:18px">
        ${exact ? html`<button class="btn btn-primary" data-act="ics" data-id="${l.id}">${icon("calendar-plus")} Add to Calendar</button>` : ""}
        ${l.vid ? html`<a class="btn" href="${l.vid}" target="_blank" rel="noopener">${icon("play")} Watch</a>` : ""}
        ${l.rocket ? html`<a class="btn" href="${l.rocketWiki || wikiURL(l.rocket)}" target="_blank" rel="noopener">${icon("book-open")} About the ${l.rocket}</a>` : ""}
      </div>
    </div>`;
}

export async function render(root, { query }) {
  let provider = query.get("provider") || "All";
  let program = query.get("program") || "All";
  let launches = null;
  let timer = null;

  mount(root, html`
    ${pageHead({ back: { href: "#/explore", label: "Explore" }, eyebrow: html`${icon("rocket")} Launch calendar`, title: "Upcoming Launches",
      subtitle: "Every orbital launch on the books worldwide, with live countdowns.",
      actions: html`<button class="btn btn-sm" data-act="refresh">${icon("rotate-cw")} Refresh</button>` })}
    <div class="filter-label">Provider</div>
    <div class="filters" id="prov" role="group" aria-label="Provider">${Object.keys(PROVIDERS).map((p) => html`<button data-prov="${p}">${p}</button>`)}</div>
    <div class="filter-label" style="margin-top:12px">Program</div>
    <div class="filters" id="prog" role="group" aria-label="Program">${PROGRAMS.map((p) => html`<button data-prog="${p}">${p}</button>`)}</div>
    <div id="content" style="margin-top:22px">${loadingState("Loading upcoming launches…")}</div>`);
  const content = root.querySelector("#content");

  function paint() {
    root.querySelectorAll("[data-prov]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.prov === provider)));
    root.querySelectorAll("[data-prog]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.prog === program)));
    if (!launches) return;
    const visible = launches.filter((l) => isUpcoming(l) && providerMatches(provider, l) && programMatches(program, l));
    const next = visible.find((l) => hasExactDay(l) && new Date(l.net).getTime() > Date.now() - 2 * 3600000);
    const dated = visible.filter((l) => hasExactDay(l) && l !== next);
    const undated = visible.filter((l) => !hasExactDay(l));
    if (!visible.length) {
      mount(content, html`<div class="state">${icon("list-filter")}<h3>No matching launches</h3><p>Nothing upcoming matches these filters.</p>
        <div class="row"><button class="btn" data-act="clear">Clear filters</button></div></div>`);
      return;
    }
    const days = new Map();
    for (const l of dated) {
      const key = new Date(l.net).toDateString();
      if (!days.has(key)) days.set(key, []);
      days.get(key).push(l);
    }
    const periods = new Map();
    for (const l of undated) { const k = periodLabel(l); if (!periods.has(k)) periods.set(k, []); periods.get(k).push(l); }
    const dayTitle = (d) => {
      const date = new Date(d), today = new Date();
      const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
      if (date.toDateString() === today.toDateString()) return "Today";
      if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";
      return fmtDate(date, { weekday: "long", month: "long", day: "numeric" });
    };
    const age = cachedAge("launches");
    mount(content, html`
      ${next ? html`<div class="card hero-launch">
        ${next.image ? html`<img src="${next.image}" alt="" />` : html`<div style="background:linear-gradient(160deg,#0b3346,#061822);min-height:240px"></div>`}
        <div class="body">
          <div class="row"><span class="eyebrow" style="margin:0">${icon("flame")} Next launch</span>${next.webcastLive ? html`<span class="chip live"><span class="dot-live"></span> Live</span>` : ""}</div>
          <h2>${next.mission || next.name}</h2>
          <div class="muted">${next.rocket || ""} · ${next.providerAbbrev || next.provider}</div>
          <div class="faint small" style="margin-top:4px">${icon("map-pin")} ${next.location}</div>
          <div class="countdown" id="countdown"></div>
          <div class="muted small">${hasExactTime(next) ? `${fmtDate(next.net, { weekday: "long", month: "long", day: "numeric" })} at ${fmtTime(next.net)}` : `${fmtDate(next.net, { weekday: "long", month: "long", day: "numeric" })} · time not set`}</div>
          <div class="row" style="margin-top:16px">${statusPill(next)}<span class="spacer"></span><button class="btn btn-sm" data-id="${next.id}">Details ${icon("chevron-right")}</button></div>
        </div></div>` : ""}
      ${[...days].map(([d, ls]) => html`<div class="day-head">${dayTitle(d)}</div>${ls.map(row)}`)}
      ${periods.size ? html`<h2 class="section-title">${icon("calendar-clock")} Date not set yet</h2>
        ${[...periods].map(([p, ls]) => html`<div class="day-head">No earlier than ${p}</div>${ls.map(row)}`)}` : ""}
      <p class="faint small center" style="margin-top:28px">Data from The Space Devs' Launch Library 2${age ? ` · updated ${relTime(age)}` : ""}.</p>`);

    clearInterval(timer);
    if (next) {
      const tick = () => {
        const el = root.querySelector("#countdown");
        if (!el) return;
        const ms = new Date(next.net).getTime() - Date.now();
        if (ms <= 0) { el.innerHTML = `<span class="chip live"><span class="dot-live"></span> Liftoff window open</span>`; return; }
        const c = countdownParts(ms);
        el.innerHTML = [["d", "Days"], ["h", "Hrs"], ["m", "Min"], ["s", "Sec"]].map(([k, label]) => `<div><b>${String(c[k]).padStart(2, "0")}</b><span>${label}</span></div>`).join("");
      };
      tick();
      timer = setInterval(tick, 1000);
    }
  }

  async function load(force = false) {
    try {
      launches = await getLaunches({ force });
      paint();
    } catch {
      if (!launches) mount(content, errorState("Couldn't load launches", "Launch Library didn't answer. It allows a limited number of requests an hour, so try again in a few minutes."));
    }
  }

  root.addEventListener("click", (e) => {
    const t = e.target;
    const prov = t.closest("[data-prov]")?.dataset.prov;
    const prog = t.closest("[data-prog]")?.dataset.prog;
    const act = t.closest("[data-act]")?.dataset.act;
    if (prov) { provider = prov; return paint(); }
    if (prog) { program = prog; return paint(); }
    if (act === "clear") { provider = "All"; program = "All"; return paint(); }
    if (act === "refresh" || act === "retry") { mount(content, loadingState("Refreshing…")); return load(true); }
    const id = t.closest("[data-id]")?.dataset.id;
    if (id && launches) {
      const l = launches.find((x) => x.id === id);
      if (l) {
        openModal(detail(l));
        document.querySelector('.modal [data-act="ics"]')?.addEventListener("click", () => downloadICS({
          title: `🚀 ${l.mission || l.name} launch`, start: l.net, allDay: !hasExactTime(l),
          end: hasExactTime(l) ? new Date(new Date(l.net).getTime() + 30 * 60000) : null,
          description: `${l.rocket || ""} · ${l.provider}\n${l.missionDescription || ""}`, location: l.location,
        }));
      }
    }
  });

  paint();
  load();
  return () => clearInterval(timer);
}
