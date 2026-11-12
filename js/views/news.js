// News: the latest space stories from NASA, ESA, SpaceNews, Spaceflight Now, Phys.org and more,
// through the Spaceflight News API (the RSS feeds the app reads don't allow browser requests).
import { html, icon, mount, cached, fetchJSON, errorState, relTime, raw } from "../lib.js";

const API = "https://api.spaceflightnewsapi.net/v4/articles/";
const SOURCES = [
  ["All", null], ["NASA", "NASA"], ["ESA", "ESA"], ["SpaceNews", "SpaceNews"], ["Spaceflight Now", "Spaceflight Now"],
  ["Phys.org", "Phys"], ["Space.com", "Space.com"], ["NASASpaceflight", "NASASpaceflight"], ["Planetary Society", "Planetary Society"],
];

export function loadNews(site, offset = 0, force = false) {
  return cached(`news:${site || "all"}:${offset}`, 10 * 60 * 1000, async () => {
    const p = new URLSearchParams({ limit: "30", offset: String(offset), ordering: "-published_at" });
    if (site) p.set("news_site", site);
    const d = await fetchJSON(`${API}?${p}`);
    return { next: d.next, results: d.results.map((a) => ({ id: a.id, title: a.title, url: a.url, image: a.image_url, site: a.news_site, summary: a.summary, at: a.published_at })) };
  }, { force });
}

const img = (a, cls = "") => (a.image
  ? html`<img class="${cls}" src="${a.image}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'ph'}))" />`
  : html`<div class="ph"></div>`);

export async function render(root, { query }) {
  let site = SOURCES.find(([, v]) => v === query.get("source"))?.[1] ?? null;
  let items = [], next = null, offset = 0, loading = false;

  mount(root, html`
    <div class="page-head"><div>
      <div class="eyebrow">${icon("newspaper")} News</div>
      <h1>Space news</h1>
      <p>The latest from NASA, ESA, SpaceNews, Spaceflight Now, Phys.org and other newsrooms.</p>
    </div><button class="btn btn-sm" data-act="refresh">${icon("rotate-cw")} Refresh</button></div>
    <div class="filters" role="group" aria-label="Source" style="margin-bottom:20px">${SOURCES.map(([label, v]) => html`<button data-src="${v ?? ""}">${label}</button>`)}</div>
    <div id="news"></div>`);
  const host = root.querySelector("#news");

  function skeleton() {
    mount(host, html`<div class="card news-hero"><div class="skeleton" style="min-height:300px;border-radius:0"></div><div class="body"><div class="skeleton" style="height:16px;width:30%"></div><div class="skeleton" style="height:60px;margin-top:14px"></div></div></div>
      <div class="news-grid">${Array.from({ length: 6 }, () => html`<div class="news-card"><div class="skeleton" style="aspect-ratio:16/9;border-radius:0"></div><div class="body"><div class="skeleton" style="height:40px"></div><div class="skeleton" style="height:14px;width:40%"></div></div></div>`)}</div>`);
  }

  function paint() {
    root.querySelectorAll("[data-src]").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.src || null) === site)));
    if (!items.length) { mount(host, html`<div class="state">${icon("newspaper")}<h3>No stories</h3><p>Nothing from this source lately.</p></div>`); return; }
    const [hero, ...rest] = items;
    mount(host, html`
      <a class="card news-hero" href="${hero.url}" target="_blank" rel="noopener">
        ${img(hero)}
        <div class="body">
          <div class="news-meta"><span class="chip">${icon("zap")} Latest</span><span class="src">${hero.site}</span><span>${relTime(hero.at)}</span></div>
          <h2>${hero.title}</h2>
          <p class="muted" style="margin:0">${hero.summary}</p>
        </div>
      </a>
      <div class="news-grid">${rest.map((a) => html`<a class="news-card" href="${a.url}" target="_blank" rel="noopener">
        ${img(a)}
        <div class="body"><h3>${a.title}</h3><p>${a.summary}</p>
          <div class="news-meta"><span class="src">${a.site}</span><span>·</span><span>${relTime(a.at)}</span></div></div></a>`)}</div>
      <div class="row" style="justify-content:center;margin-top:22px">${next ? html`<button class="btn" data-act="more" ${loading ? raw("disabled") : ""}>${loading ? "Loading…" : "Load more stories"}</button>` : ""}</div>
      <p class="faint small center" style="margin-top:12px">Headlines via the Spaceflight News API. Stories open on the publisher's site.</p>`);
  }

  async function reload(force = false) {
    skeleton();
    offset = 0;
    try { const d = await loadNews(site, 0, force); items = d.results; next = d.next; paint(); }
    catch { mount(host, errorState("Couldn't load the news", "The news feeds couldn't be reached. Check your connection and try again.")); }
  }

  root.addEventListener("click", async (e) => {
    const src = e.target.closest("[data-src]");
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (src) { site = src.dataset.src || null; history.replaceState(null, "", site ? `#/news?source=${encodeURIComponent(site)}` : "#/news"); return reload(); }
    if (act === "refresh" || act === "retry") return reload(true);
    if (act === "more" && !loading) {
      loading = true; paint();
      try {
        offset += 30;
        const d = await loadNews(site, offset);
        const seen = new Set(items.map((a) => a.id));
        items = items.concat(d.results.filter((a) => !seen.has(a.id)));
        next = d.next;
      } catch { offset -= 30; }
      loading = false; paint();
    }
  });

  reload();
}
