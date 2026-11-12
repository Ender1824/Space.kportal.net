// Today: a landing page built around NASA's Astronomy Picture of the Day (the same science.nasa.gov
// APOD Basic API the app uses), with live sky data, the latest news and a quote underneath.
import { html, icon, mount, cached, fetchJSON, store, share, lightbox, openModal, fmtDate, relTime, countdownParts, wikiURL, loadData, reducedMotion, raw } from "../lib.js";
import { getAstronauts, getISS, getLaunches, hasExactDay, isUpcoming } from "../api.js";
import { loadGeography, describe } from "../geo.js";
import { moonPhase, moonIcon } from "../astro.js";
import { loadNews } from "./news.js";
import { auroraData, KP } from "./nightsky.js";

const API = "https://science.nasa.gov/wp-json/wp/v2/apod-basic/";
const FIRST_DAY = "1995-06-16";
const PLACEHOLDER = "/images/misc/news-thumbnail.png";

/** Today's date in US/Eastern, where APOD days begin. */
function easternToday() {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t) => p.find((x) => x.type === t).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function addDays(date, n) {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const longDate = (date) => fmtDate(date + "T12:00:00Z", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

// ───────── Markup helpers (ported from APODHTML) ─────────
function decodeEntities(s) {
  if (!s || !s.includes("&")) return s || "";
  const t = document.createElement("textarea");
  t.innerHTML = s;
  return t.value;
}
function plainText(h) {
  let s = (h || "").replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "");
  return decodeEntities(s).replace(/\s+/g, " ").trim();
}
function explanationText(h) {
  let body = h || "";
  const cut = body.search(/<br\s*\/?>\s*<strong>/i);
  if (cut >= 0) body = body.slice(0, cut);
  return plainText(body).replace(/^\s*Explanation:\s*/i, "");
}
function creditText(h) {
  const t = plainText(h).replace(/^\s*(Image|Video|Illustration)?\s*Credits?[^:]*:\s*/i, "").trim();
  return t || null;
}
function resolve(link) {
  try {
    let abs = new URL(decodeEntities(link).trim(), "https://apod.nasa.gov/apod/").href;
    return abs.replace(/^http:\/\//i, "https://");
  } catch { return null; }
}
function videoURL(h) {
  for (const p of [/<source[^>]*\ssrc\s*=\s*["']([^"']+)["']/i, /<video[^>]*\ssrc\s*=\s*["']([^"']+)["']/i, /<iframe[^>]*\ssrc\s*=\s*["']([^"']+)["']/i]) {
    const m = p.exec(h || "");
    if (m) { let s = decodeEntities(m[1]); if (s.startsWith("//")) s = "https:" + s; return s.replace(/^http:\/\//i, "https://"); }
  }
  return null;
}
function imageURL(h) {
  const isImage = (s) => /\.(jpe?g|png|gif|webp)(\?|$)/i.test(s || "");
  const linked = /<a\b[^>]*\bhref\s*=\s*["']?([^"'\s>]+)[^>]*>\s*<img\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/i.exec(h || "");
  if (linked) { const href = resolve(linked[1]); return isImage(href) ? href : resolve(linked[2]); }
  const img = /<img\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/i.exec(h || "");
  return img ? resolve(img[1]) : null;
}
/** The two images of a "hover to compare" day, read from the onMouseOver/onMouseOut swap. */
function rollover(h) {
  if (!h) return null;
  const handler = (name) => {
    const m = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(h);
    const v = m && (m[1] ?? m[2]);
    const src = v && /src\s*=\s*['"]([^'"]+)['"]/i.exec(v);
    return src ? resolve(src[1]) : null;
  };
  const alternate = handler("onmouseover");
  if (!alternate) return null;
  const tags = h.match(/<img\b[^>]*>/gi) || [];
  const srcOf = (tag) => { const m = /\bsrc\s*=\s*['"]?([^'"\s>]+)/i.exec(tag); return m && m[1]; };
  const named = tags.find((t) => t.toLowerCase().includes("imagename1"));
  const primary = handler("onmouseout") || (named && resolve(srcOf(named))) || resolve(tags.map(srcOf).find((s) => s && !/\.gif$/i.test(s)) || "");
  return primary && primary !== alternate ? { primary, alternate } : null;
}

function normalize(b) {
  const featured = b.hdurl && !b.hdurl.includes(PLACEHOLDER) ? b.hdurl : null;
  const isVideo = ["video", "iframe"].includes((b.media_type || "").toLowerCase());
  let url = featured, hd = featured, thumb = null;
  if (isVideo) { url = videoURL(b.basic_html); hd = null; thumb = featured; }
  else if (!featured) { const pic = imageURL(b.basic_html); url = pic; hd = pic; }
  return {
    date: b.date, title: plainText(b.title), explanation: explanationText(b.explanation),
    media: isVideo ? "video" : "image", url, hd, thumb,
    credit: creditText(b.copyright || b.credit || ""), permalink: b.permalink, alt: b.alt || "",
    rollover: isVideo ? null : rollover(b.basic_html),
  };
}

async function fetchAPOD(date, { force = false } = {}) {
  const code = date.slice(2).replace(/-/g, "");
  const isToday = date === easternToday();
  return cached("apod:" + date, isToday ? 20 * 60 * 1000 : 365 * 86400000, async () => {
    const raw = await fetchJSON(API + code + (isToday ? `?t=${Date.now() >> 16}` : ""));
    const apod = normalize(raw);
    if (apod.media === "image" && !apod.url) {
      try {
        const q = await fetchJSON(`https://images-api.nasa.gov/search?media_type=image&q=${encodeURIComponent(apod.title)}`);
        const item = q.collection?.items?.find((i) => i.links?.[0]?.href);
        if (item) apod.related = { url: item.links[0].href, title: item.data?.[0]?.title };
      } catch { /* no related picture */ }
    }
    return apod;
  }, { force });
}

/** Display-sized copy of a science.nasa.gov asset (the originals can be 30+ MB). */
function displaySrc(url, width = 2000) {
  try {
    const u = new URL(url);
    if (u.hostname === "assets.science.nasa.gov") { u.searchParams.set("w", width); u.searchParams.delete("h"); return u.href; }
  } catch { /* not a URL */ }
  return url;
}

function embed(url) {
  const yt = /(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([\w-]{6,})/i.exec(url);
  if (yt) return `https://www.youtube-nocookie.com/embed/${yt[1]}?rel=0&modestbranding=1`;
  const vimeo = /vimeo\.com\/(?:video\/)?(\d+)/i.exec(url);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return null;
}

function randomDate() {
  const start = new Date(FIRST_DAY + "T12:00:00Z").getTime();
  const end = new Date(easternToday() + "T12:00:00Z").getTime();
  return new Date(start + Math.random() * (end - start)).toISOString().slice(0, 10);
}

/** The first sentence or two, for the hero. */
function teaser(text, max = 190) {
  if (!text) return "";
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)/g) || [text];
  let out = "";
  for (const s of sentences) { if ((out + s).length > max && out) break; out += s; }
  return out.trim().length > max + 60 ? out.slice(0, max).replace(/\s+\S*$/, "") + "…" : out.trim();
}

const APP_STORE = "https://apps.apple.com/us/app/universe-daily/id6751823874";

export async function render(root, { query }) {
  const today = easternToday();
  let date = query.get("date") || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = today;
  let showingAlternate = false;
  let current = null;
  let token = 0;
  const timers = [];

  mount(root, html`
    <section class="hero" id="hero"></section>
    <div id="story-wrap"></div>
    <section class="section">
      <div class="section-head"><div>
        <div class="eyebrow">${icon("radar")} Live</div>
        <h2>Right now, above you</h2>
        <p>Who's up there, where the space station is, what's launching next, and what tonight's sky holds.</p>
      </div><a class="link-arrow" href="#/explore">Explore everything ${icon("arrow-right")}</a></div>
      <div class="pulse-grid">
        <a class="pulse" href="#/explore/people" style="--tint:var(--t-indigo)"><span class="k">${icon("users")} In orbit</span>${icon("arrow-up-right", "go")}<span class="v" data-p="people">—</span><span class="d" data-pd="people">people in space right now</span></a>
        <a class="pulse" href="#/explore/iss" style="--tint:var(--t-blue)"><span class="k">${icon("satellite")} The ISS is</span>${icon("arrow-up-right", "go")}<span class="v sm" data-p="iss">Finding it…</span><span class="d" data-pd="iss"></span></a>
        <a class="pulse" href="#/explore/launches" style="--tint:var(--t-red)"><span class="k">${icon("rocket")} Next launch</span>${icon("arrow-up-right", "go")}<span class="v" data-p="launch">—</span><span class="d" data-pd="launch"></span></a>
        <a class="pulse" href="#/explore/night-sky/moon" style="--tint:var(--t-night)"><span class="k">${icon("moon")} Tonight's Moon</span>${icon("arrow-up-right", "go")}<span class="v sm" data-p="moon"></span><span class="d" data-pd="moon"></span></a>
        <a class="pulse" href="#/explore/night-sky/aurora" style="--tint:var(--t-mint)"><span class="k">${icon("sparkles")} Aurora</span>${icon("arrow-up-right", "go")}<span class="v" data-p="aurora">—</span><span class="d" data-pd="aurora"></span></a>
      </div>
    </section>
    <section class="section">
      <div class="section-head"><div>
        <div class="eyebrow">${icon("newspaper")} News</div>
        <h2>From the newsroom</h2>
      </div><a class="link-arrow" href="#/news">All space news ${icon("arrow-right")}</a></div>
      <div class="news-grid" id="home-news" style="margin-top:0">${Array.from({ length: 3 }, () => html`<div class="news-card"><div class="skeleton" style="aspect-ratio:16/9;border-radius:0"></div><div class="body"><div class="skeleton" style="height:44px"></div></div></div>`)}</div>
    </section>
    <div class="manifesto" id="quote"></div>
    <section class="cta">
      <img src="assets/icon-512.png" alt="" />
      <div><h2>Take the universe with you.</h2>
        <p>Universe Daily for iPhone puts today's picture on your home screen, and brings the 3D Moon, eclipse scenes, a daily space word puzzle and more to your pocket. Free, with no ads and no tracking.</p></div>
      <a class="btn btn-download" href="${APP_STORE}" target="_blank" rel="noopener">Download the app</a>
    </section>`);

  const hero = root.querySelector("#hero");
  const storyWrap = root.querySelector("#story-wrap");

  // ───────── Hero ─────────
  function dayNav() {
    return html`<div class="day-nav">
      <input type="date" id="apod-date" min="${FIRST_DAY}" max="${today}" value="${date}" aria-label="Choose a day" />
      <div class="row">
        <button class="btn btn-icon" data-go="prev" title="Previous day (←)" aria-label="Previous day" ${date <= FIRST_DAY ? raw("disabled") : ""}>${icon("arrow-left")}</button>
        <button class="btn" data-go="random" title="Random day (R)">${icon("shuffle")} Surprise me</button>
        <button class="btn btn-icon" data-go="next" title="Next day (→)" aria-label="Next day" ${date >= today ? raw("disabled") : ""}>${icon("arrow-right")}</button>
      </div>
      ${date !== today ? html`<button class="btn btn-sm" data-go="today">${icon("calendar-check")} Back to today <kbd>T</kbd></button>`
        : html`<span class="kbd-hint">Travel through 30 years of pictures with <kbd>←</kbd> <kbd>→</kbd></span>`}
    </div>`;
  }

  function kicker(d) {
    return d === today ? "Today's Astronomy Picture of the Day" : `Astronomy Picture of the Day · ${longDate(d)}`;
  }

  function heroMessage(title, text, buttons) {
    mount(hero, html`
      <div class="hero-state"><div class="glow-star"></div></div>
      <div class="hero-inner">
        <div><div class="hero-kicker">${kicker(date)}</div><h1>${title}</h1><p class="hero-sub">${text}</p>
          <div class="hero-actions">${buttons}</div></div>
        ${dayNav()}
      </div>`);
    storyWrap.innerHTML = "";
  }

  function showHero(a) {
    const bgSrc = a.media === "video" ? a.thumb : (a.url || a.related?.url || (a.rollover && a.rollover.primary));
    mount(hero, html`
      <div class="hero-bg">${bgSrc ? html`<img id="hero-img" src="${displaySrc(bgSrc, 2400)}" alt="" />` : ""}</div>
      ${a.credit ? html`<div class="hero-credit">${a.media === "video" ? "Video" : "Image"}: ${a.credit}</div>` : ""}
      <div class="hero-inner">
        <div>
          <div class="hero-kicker">${kicker(a.date)}</div>
          <h1>${a.title}</h1>
          <p class="hero-sub">${teaser(a.explanation)}</p>
          <div class="hero-actions">
            <a class="btn btn-primary" href="#story" data-act="story">${icon("book-open")} Read the story</a>
            ${a.media === "video"
              ? html`<button class="btn" data-act="watch">${icon("play")} Watch video</button>`
              : (a.url || a.related) ? html`<button class="btn" data-act="full" title="View full image (F)">${icon("maximize-2")} Full image</button>` : ""}
            <button class="btn" data-act="share">${icon("share")} Share</button>
          </div>
        </div>
        ${dayNav()}
      </div>
      <a class="hero-scroll" href="#story" data-act="story" aria-label="Scroll to the story">${icon("chevrons-down")}</a>`);
    const img = hero.querySelector("#hero-img");
    if (img) {
      const ready = () => img.classList.add("ready");
      if (img.complete && img.naturalWidth) ready(); else img.addEventListener("load", ready, { once: true });
      img.addEventListener("error", () => img.remove(), { once: true });
    }
  }

  function showStory(a) {
    const full = a.rollover && showingAlternate ? a.rollover.alternate : (a.hd || a.url || a.related?.url);
    const thumb = a.media === "video" ? a.thumb : (a.rollover && showingAlternate ? a.rollover.alternate : (a.url || a.related?.url));
    mount(storyWrap, html`
      <section class="section" id="story">
        <div class="story">
          <div>
            <div class="eyebrow">${icon("telescope")} ${longDate(a.date)}</div>
            <h2 class="serif" style="font:500 clamp(30px,3.4vw,44px)/1.1 var(--serif);letter-spacing:-.02em;margin:6px 0 26px">${a.title}</h2>
            <p class="story-text">${a.explanation}</p>
          </div>
          <aside class="story-aside card">
            ${thumb ? html`<img class="story-thumb" id="story-img" src="${displaySrc(thumb, 900)}" alt="${a.alt || a.title}" data-full="${full || thumb}" />` : ""}
            ${!a.url && a.related ? html`<p class="faint small" style="margin:8px 0 0">Related image from NASA's library: ${a.related.title || ""}</p>` : ""}
            <dl class="meta-list">
              <div><dt>Date</dt><dd>${longDate(a.date)}</dd></div>
              ${a.credit ? html`<div><dt>${a.media === "video" ? "Video" : "Image"}</dt><dd>${a.credit}</dd></div>` : ""}
              <div><dt>Type</dt><dd>${a.media === "video" ? "Video" : a.rollover ? "Image · two versions to compare" : "Image"}</dd></div>
            </dl>
            <div class="row">
              ${a.rollover ? html`<button class="btn btn-sm" data-act="compare">${icon("arrow-left-right")} ${showingAlternate ? "Show original" : "Compare"}</button>` : ""}
              ${a.hd ? html`<a class="btn btn-sm" href="${a.hd}" target="_blank" rel="noopener">${icon("download")} HD</a>` : ""}
              ${a.permalink ? html`<a class="btn btn-sm" href="${a.permalink}" target="_blank" rel="noopener">${icon("external-link")} NASA</a>` : ""}
            </div>
          </aside>
        </div>
      </section>`);
  }

  function show(a) {
    current = a;
    showHero(a);
    showStory(a);
    store.set("lastAPOD", { date: a.date, title: a.title });
  }

  async function load({ force = false } = {}) {
    const my = ++token;
    if (date > today) {
      heroMessage("We can't predict the future—yet.", "“Patience is bitter, but its fruit is sweet.” — Jean-Jacques Rousseau. Pick today or any past day.",
        html`<button class="btn btn-primary" data-go="today">${icon("calendar-check")} Go to today</button>`);
      return;
    }
    if (date < FIRST_DAY) {
      heroMessage("It all began on June 16, 1995", "That's the first Astronomy Picture of the Day. Pick a day from then onward.",
        html`<button class="btn btn-primary" data-go="first">See the very first one</button>`);
      return;
    }
    mount(hero, html`<div class="hero-state"><div><div class="glow-star" style="margin:0 auto 16px"></div><p>Loading NASA's picture of the day…</p></div></div>`);
    try {
      const a = await fetchAPOD(date, { force });
      if (my === token) show(a);
    } catch (err) {
      if (my !== token) return;
      if (err.status === 404 && date === today) {
        heroMessage("Today's picture is on its way", "NASA publishes the new picture shortly after midnight US Eastern time. Look back at yesterday's while you wait.",
          html`<button class="btn btn-primary" data-go="prev">${icon("history")} Yesterday's picture</button>
               <button class="btn" data-act="refresh">${icon("rotate-cw")} Check again</button>`);
      } else if (err.status === 404) {
        heroMessage(`No picture on ${longDate(date)}`, "NASA didn't post one that day. Try a day on either side.",
          html`<button class="btn" data-go="prev">${icon("arrow-left")} Day before</button><button class="btn" data-go="next">Day after ${icon("arrow-right")}</button>`);
      } else {
        heroMessage("Couldn't reach NASA", "Check your connection and try again.",
          html`<button class="btn btn-primary" data-act="refresh">${icon("rotate-cw")} Try again</button>`);
      }
    }
  }

  function goTo(d) {
    if (d === date) return;
    date = d;
    showingAlternate = false;
    history.replaceState(null, "", d === today ? "#/" : `#/?date=${d}`);
    window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
    load();
  }

  function watch(a) {
    const e = a.url && embed(a.url);
    const player = e ? `<iframe src="${e}" title="${a.title.replace(/"/g, "&quot;")}" style="width:100%;aspect-ratio:16/9;border:0;display:block" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`
      : a.url && /\.(mp4|webm|mov)(\?|$)/i.test(a.url) ? `<video src="${a.url}" controls autoplay playsinline style="width:100%;display:block"></video>` : null;
    if (player) openModal(player); else window.open(a.url || a.permalink, "_blank", "noopener");
  }

  const onClick = (e) => {
    const go = e.target.closest("[data-go]")?.dataset.go;
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (go) {
      e.preventDefault();
      ({ prev: () => goTo(addDays(date, -1)), next: () => goTo(addDays(date, 1)), today: () => goTo(today), random: () => goTo(randomDate()), first: () => goTo(FIRST_DAY) })[go]?.();
    } else if (act === "story") {
      e.preventDefault();
      root.querySelector("#story")?.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth" });
    } else if (act === "refresh") load({ force: true });
    else if (act === "compare" && current) { showingAlternate = !showingAlternate; showStory(current); }
    else if (act === "full" && current) lightbox(current.hd || current.url || current.related?.url, current.title);
    else if (act === "watch" && current) watch(current);
    else if (act === "share" && current) share({ title: current.title, text: `${current.title} — NASA Astronomy Picture of the Day`, url: current.permalink || location.href });
    else if (e.target.id === "story-img") lightbox(e.target.dataset.full, e.target.alt);
  };
  const onChange = (e) => { if (e.target.id === "apod-date" && e.target.value) goTo(e.target.value); };
  const onKey = (e) => {
    if (e.target.matches("input, textarea, select") || e.metaKey || e.ctrlKey || e.altKey || document.querySelector(".modal-backdrop, .lightbox")) return;
    const k = e.key.toLowerCase();
    if (e.key === "ArrowLeft" && date > FIRST_DAY) goTo(addDays(date, -1));
    else if (e.key === "ArrowRight" && date < today) goTo(addDays(date, 1));
    else if (k === "r") goTo(randomDate());
    else if (k === "t") goTo(today);
    else if (k === "f" && current) current.media === "video" ? watch(current) : lightbox(current.hd || current.url || current.related?.url, current.title);
  };
  root.addEventListener("click", onClick);
  root.addEventListener("change", onChange);
  document.addEventListener("keydown", onKey);
  load();

  // ───────── Live strip ─────────
  const set = (k, v, d) => {
    const el = root.querySelector(`[data-p="${k}"]`), dl = root.querySelector(`[data-pd="${k}"]`);
    if (el && v != null) mount(el, v);
    if (dl && d != null) mount(dl, d);
  };
  getAstronauts("inSpace").then((d) => set("people", html`${d.count}`, html`people in space right now`)).catch(() => set("people", "—", "Crew list unavailable"));
  async function iss() {
    try {
      const [p, g] = await Promise.all([getISS(), loadGeography()]);
      const place = describe(g, p.latitude, p.longitude);
      set("iss", html`${place.title}`, html`${place.detail || ""}${place.detail ? " · " : ""}${Math.round(p.velocity).toLocaleString()} km/h`);
    } catch { set("iss", "Out of reach", "Location unavailable"); }
  }
  iss(); timers.push(setInterval(iss, 15000));
  let next = null;
  const tick = () => {
    if (!next) return;
    const ms = new Date(next.net).getTime() - Date.now();
    const c = countdownParts(ms);
    set("launch", ms <= 0 ? html`Liftoff` : c.d > 0 ? html`${c.d}d ${c.h}h` : html`${String(c.h).padStart(2, "0")}:${String(c.m).padStart(2, "0")}:${String(c.s).padStart(2, "0")}`,
      html`${next.mission || next.name}<br><span class="faint">${next.rocket || ""}</span>`);
  };
  getLaunches().then((all) => {
    next = all.find((l) => isUpcoming(l) && hasExactDay(l) && new Date(l.net) > Date.now()) || null;
    if (next) { tick(); timers.push(setInterval(tick, 1000)); } else set("launch", "—", "Nothing scheduled");
  }).catch(() => set("launch", "—", "Launch data unavailable"));
  const ph = moonPhase();
  set("moon", html`<span class="row" style="gap:10px;flex-wrap:nowrap">${raw(moonIcon(ph, 34))} ${ph.name}</span>`, html`${Math.round(ph.illumination * 100)}% lit · ${ph.waxing ? "waxing" : "waning"}`);
  auroraData().then((d) => {
    const kp = d.kp ?? 0;
    set("aurora", html`<span style="color:${KP.color(kp)}">Kp ${kp.toFixed(1)}</span>`, html`${KP.name(kp)}`);
  }).catch(() => set("aurora", "—", "Space weather unavailable"));

  loadNews(null).then((d) => {
    mount(root.querySelector("#home-news"), html`${d.results.filter((a) => !/^APOD\b/i.test(a.title)).slice(0, 3).map((a) => html`<a class="news-card" href="${a.url}" target="_blank" rel="noopener">
      ${a.image ? html`<img src="${a.image}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : html`<div class="ph"></div>`}
      <div class="body"><h3>${a.title}</h3><p>${a.summary}</p>
        <div class="news-meta"><span class="src">${a.site}</span><span>·</span><span>${relTime(a.at)}</span></div></div></a>`)}`);
  }).catch(() => mount(root.querySelector("#home-news"), html`<p class="muted">The news couldn't load right now. <a href="#/news">Try the News page</a>.</p>`));

  loadData("quotes.json").then((quotes) => {
    const [text, author] = quotes[Math.floor(Math.random() * quotes.length)];
    mount(root.querySelector("#quote"), html`<blockquote>“${text}”</blockquote><cite><a href="${wikiURL(author)}" target="_blank" rel="noopener">${author}</a></cite>`);
  }).catch(() => {});

  return () => { document.removeEventListener("keydown", onKey); timers.forEach(clearInterval); };
}
