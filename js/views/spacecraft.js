// Spacecraft: NASA's Eyes on the Solar System (3D map of every mission) and DSN Now (live antenna links).
import { html, icon, mount, pageHead } from "../lib.js";

const PAGES = {
  map: { label: "3D Solar System", icon: "orbit", url: "https://eyes.nasa.gov/apps/solar-system/#/home",
    note: "NASA's Eyes on the Solar System: every planet, moon and active spacecraft, in real time. Drag to orbit, scroll to zoom, and search for a mission." },
  dsn: { label: "Deep Space Network", icon: "radio-tower", url: "https://eyes.nasa.gov/apps/dsn-now/dsn.html",
    note: "DSN Now: which spacecraft NASA's giant dishes in California, Spain and Australia are talking to right now." },
};

export function render(root, { query }) {
  let tab = query.get("tab") === "dsn" ? "dsn" : "map";
  mount(root, html`
    ${pageHead({ back: { href: "#/explore", label: "Explore" }, eyebrow: html`${icon("radio-tower")} Live from NASA`, title: "Spacecraft",
      subtitle: "Follow the missions exploring the solar system, and listen in on the Deep Space Network." })}
    <div class="row" style="margin-bottom:14px">
      <div class="seg" role="group" aria-label="View">
        ${Object.entries(PAGES).map(([k, p]) => html`<button data-pane="${k}">${icon(p.icon)} ${p.label}</button>`)}
      </div>
      <span class="spacer"></span>
      <a class="btn btn-sm" id="open" target="_blank" rel="noopener">${icon("external-link")} Open full screen</a>
    </div>
    <p class="muted small" id="note" style="margin:0 0 14px"></p>
    <div class="frame-wrap"><iframe class="frame" id="frame" title="NASA Eyes" allow="fullscreen; xr-spatial-tracking" allowfullscreen></iframe></div>`);

  const frame = root.querySelector("#frame");
  function show() {
    const p = PAGES[tab];
    root.querySelectorAll("[data-pane]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.pane === tab)));
    root.querySelector("#note").textContent = p.note;
    root.querySelector("#open").href = p.url;
    frame.src = p.url;
    frame.title = p.label;
  }
  root.addEventListener("click", (e) => {
    const t = e.target.closest("button[data-pane]")?.dataset.pane;
    if (t && t !== tab) { tab = t; history.replaceState(null, "", `#/explore/spacecraft${t === "dsn" ? "?tab=dsn" : ""}`); show(); }
  });
  show();
}
