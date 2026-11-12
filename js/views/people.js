// People in Space: who's in orbit right now, plus every astronaut ranked by total time in space (Launch Library 2).
import { html, icon, mount, pageHead, openModal, errorState, loadingState, isoDurationDays, durationWords, fmtDate, fmtNumber, raw } from "../lib.js";
import { getAstronauts, searchAstronauts } from "../api.js";

const flag = (code) => (code && code.length === 2 ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1a5 + c.charCodeAt(0))) : "");

function portrait(a, cls = "portrait") {
  const src = a.image?.thumbnail_url || a.image?.image_url;
  return src
    ? html`<img class="${cls}" src="${src}" alt="" loading="lazy" onerror="this.outerHTML='<div class=&quot;ph&quot;><i data-lucide=&quot;user-round&quot;></i></div>';window.lucide&&lucide.createIcons()" />`
    : html`<div class="ph">${icon("user-round")}</div>`;
}

function nationality(a) {
  const n = a.nationality?.[0];
  return n ? `${flag(n.alpha_2_code)} ${n.nationality_name || n.name || ""}`.trim() : "";
}

function crewCard(a) {
  const days = isoDurationDays(a.time_in_space);
  return html`<button class="person" data-id="${a.id}">
    ${portrait(a)}
    <div class="person-body">
      <div class="person-name">${a.name}</div>
      <div class="person-sub">${a.agency?.abbrev || a.agency?.name || ""} ${nationality(a) ? html`· ${nationality(a)}` : ""}</div>
      <div class="person-stats">
        <span class="chip">${icon("clock")} ${durationWords(days)} in space</span>
        ${a.spacewalks_count ? html`<span class="chip">${icon("footprints")} ${a.spacewalks_count} EVA${a.spacewalks_count === 1 ? "" : "s"}</span>` : ""}
      </div>
    </div></button>`;
}

function rosterRow(a, rank) {
  const days = isoDurationDays(a.time_in_space);
  return html`<button class="person" data-id="${a.id}">
    ${rank ? html`<span class="rank">${rank}</span>` : ""}
    ${portrait(a)}
    <div class="person-body">
      <div class="person-name">${a.name} ${a.in_space ? html`<span class="chip live" style="padding:2px 8px;margin-left:4px"><span class="dot-live"></span> In space</span>` : ""}</div>
      <div class="person-sub">${durationWords(days)} · ${a.flights_count || 0} flight${a.flights_count === 1 ? "" : "s"} · ${a.agency?.abbrev || a.agency?.name || ""}</div>
    </div></button>`;
}

function detail(a) {
  const days = isoDurationDays(a.time_in_space);
  const eva = isoDurationDays(a.eva_time);
  const status = a.date_of_death ? "Deceased" : a.status?.name || "";
  const stat = (k, v) => (v || v === 0 ? html`<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>` : "");
  return html`
    ${a.image?.image_url ? html`<img class="modal-hero" src="${a.image.image_url}" alt="${a.name}" style="object-position:center 20%" />` : ""}
    <div class="modal-body">
      <div class="row">${a.in_space ? html`<span class="chip live"><span class="dot-live"></span> In space now</span>` : ""}${status ? html`<span class="chip">${status}</span>` : ""}</div>
      <h2 style="margin-top:10px">${a.name}</h2>
      <div class="muted">${a.agency?.name || ""}${nationality(a) ? ` · ${nationality(a)}` : ""}</div>
      <div class="stat-grid">
        ${stat("Time in space", durationWords(days))}
        ${stat("Spacewalk time", eva > 0 ? durationWords(eva) : null)}
        ${stat("Flights", a.flights_count)}
        ${stat("Spacewalks", a.spacewalks_count)}
        ${stat("Age", a.age)}
        ${stat("First flight", a.first_flight ? fmtDate(a.first_flight, { month: "short", year: "numeric" }) : null)}
      </div>
      ${a.bio ? html`<h3>About</h3><p class="muted" style="line-height:1.7">${a.bio}</p>` : ""}
      <div class="row" style="margin-top:16px">
        ${a.wiki ? html`<a class="btn btn-primary" href="${a.wiki}" target="_blank" rel="noopener">${icon("book-open")} Read on Wikipedia</a>` : ""}
      </div>
    </div>`;
}

export async function render(root, { query }) {
  let scope = query.get("all") ? "all" : "inSpace";
  const data = { inSpace: null, all: null };
  let allList = [];
  let next = null;
  let q = "";
  let remote = null;
  let loadingMore = false;

  mount(root, html`
    ${pageHead({ back: { href: "#/explore", label: "Explore" }, eyebrow: html`${icon("users")} People in Space`, title: "People in Space",
      subtitle: "Everyone off the planet right now, and every astronaut ranked by total time in space." })}
    <div class="row" style="margin-bottom:20px">
      <div class="seg" role="group" aria-label="Who to show">
        <button data-scope="inSpace">${icon("orbit")} In space now</button>
        <button data-scope="all">${icon("list-ordered")} All astronauts</button>
      </div>
      <div class="search hidden" id="search-wrap">${icon("search")}<input type="search" id="q" placeholder="Search astronauts" autocomplete="off" /></div>
    </div>
    <div id="list"></div>`);
  const list = root.querySelector("#list");

  function paint() {
    root.querySelectorAll("[data-scope]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.scope === scope)));
    root.querySelector("#search-wrap").classList.toggle("hidden", scope !== "all");
    if (scope === "inSpace") {
      const d = data.inSpace;
      if (!d) return mount(list, loadingState("Counting heads in orbit…"));
      mount(list, html`<h2 class="section-title"><span class="dot-live"></span> ${d.count} people in space right now</h2>
        <p class="muted" style="margin-top:-6px;margin-bottom:18px">Ordered by total time in space.</p>
        <div class="crew-grid">${d.results.map(crewCard)}</div>`);
      return;
    }
    if (!data.all) return mount(list, loadingState("Loading the astronaut roster…"));
    const term = q.trim().toLowerCase();
    let shown = remote ?? (term ? allList.filter((a) => a.name.toLowerCase().includes(term) || (a.agency?.name || "").toLowerCase().includes(term) || nationality(a).toLowerCase().includes(term)) : allList);
    mount(list, html`
      <p class="muted" style="margin-bottom:14px">${fmtNumber(data.all.count)} astronauts · ordered by total time in space</p>
      ${shown.length ? html`<div class="roster">${shown.map((a) => rosterRow(a, term ? null : allList.indexOf(a) + 1))}</div>` : html`<div class="state"><p>No one on this page matches “${q}”.</p></div>`}
      <div class="row" style="justify-content:center;margin-top:18px">
        ${term && !remote && q.trim().length >= 2 ? html`<button class="btn btn-primary" data-act="search-all">${icon("search")} Search all ${fmtNumber(data.all.count)} astronauts</button>` : ""}
        ${!term && next ? html`<button class="btn" data-act="more" ${loadingMore ? raw("disabled") : ""}>${loadingMore ? "Loading…" : "Load more"}</button>` : ""}
        ${!term && !next && allList.length ? html`<span class="faint small">That's everyone.</span>` : ""}
      </div>`);
  }

  async function load(s, force = false) {
    try {
      const d = await getAstronauts(s, { force });
      data[s] = d;
      if (s === "all") { allList = d.results; next = d.next; }
    } catch {
      if (!data[s]) { mount(list, errorState("Couldn't load astronauts", "Launch Library didn't answer. It allows a limited number of requests an hour, so try again in a few minutes.")); return; }
    }
    if (s === scope) paint();
  }

  async function loadMore() {
    if (!next || loadingMore) return;
    loadingMore = true; paint();
    try {
      const offset = Number(new URL(next).searchParams.get("offset")) || allList.length;
      const d = await getAstronauts("all", { offset });
      const seen = new Set(allList.map((a) => a.id));
      allList = allList.concat(d.results.filter((a) => !seen.has(a.id)));
      next = d.next;
    } catch { /* keep what we have */ }
    loadingMore = false; paint();
  }

  root.addEventListener("click", async (e) => {
    const s = e.target.closest("[data-scope]")?.dataset.scope;
    if (s && s !== scope) { scope = s; history.replaceState(null, "", s === "all" ? "#/explore/people?all=1" : "#/explore/people"); paint(); if (!data[s]) load(s); return; }
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "retry") return load(scope, true);
    if (act === "more") return loadMore();
    if (act === "search-all") {
      try { remote = await searchAstronauts(q.trim()); } catch { remote = []; }
      return paint();
    }
    const id = e.target.closest(".person")?.dataset.id;
    if (id) {
      const a = [...(data.inSpace?.results || []), ...allList, ...(remote || [])].find((x) => String(x.id) === id);
      if (a) openModal(detail(a));
    }
  });
  root.querySelector("#q").addEventListener("input", (e) => { q = e.target.value; remote = null; paint(); });

  paint();
  load(scope);
  if (scope === "inSpace") load("all");
}
