// Support: contact, FAQ and app information (the page App Store reviewers and users land on).
import { html, icon, mount } from "../lib.js";

const FAQ = [
  ["Does Universe Daily collect my data?", "No. Universe Daily does not collect, store or sell personal information. The app and this website only connect to the internet to fetch space and science content. Settings on the web are saved in your own browser, never on our servers. See the Privacy Policy for details."],
  ["Today's picture isn't showing. Why?", "NASA publishes each Astronomy Picture of the Day shortly after midnight US Eastern time, and occasionally later. Until then you'll see yesterday's picture or a note to try again. Some days are videos rather than images."],
  ["Why do launches or astronauts sometimes look a few minutes out of date?", "Launch and astronaut data come from The Space Devs' Launch Library, which limits how often each visitor can ask for updates. Universe Daily keeps a recent copy so pages stay fast, and refreshes it every 15 minutes."],
  ["How accurate is the ISS Tracker?", "The ISS position comes from wheretheiss.at and updates every few seconds. Tiangong's position is computed from its latest published orbit (CelesTrak), accurate to within a few kilometers."],
  ["Where does the data come from?", "NASA (APOD, Eyes on the Solar System, DSN Now, eclipse predictions by Fred Espenak), NOAA's Space Weather Prediction Center, The Space Devs, the Spaceflight News API, CelesTrak, wheretheiss.at, lightpollutionmap.info and Natural Earth. Universe Daily is not affiliated with NASA."],
];

export function render(root) {
  mount(root, html`
    <div class="page-head"><div>
      <div class="eyebrow">${icon("life-buoy")} Support</div>
      <h1>How can we help?</h1>
      <p>Questions, bug reports and feature ideas are always welcome.</p>
    </div></div>
    <div class="support-grid">
      <div class="stack">
        <div class="card">
          <h2>${icon("mail")} Contact support</h2>
          <p class="muted">Email us and we'll get back to you, usually within a couple of days. Include your device and iOS version if something isn't working.</p>
          <div class="row" style="margin-top:14px">
            <a class="btn btn-primary" href="mailto:universe@kportal.net?subject=Universe%20Daily%20Support">${icon("mail")} universe@kportal.net</a>
            <a class="btn" href="privacy.html">${icon("shield-check")} Privacy Policy</a>
          </div>
        </div>
        <div class="card">
          <h2>Frequently asked questions</h2>
          ${FAQ.map(([q, a], i) => html`<details ${i === 0 ? html`open` : ""}><summary>${q}</summary><p>${a}</p></details>`)}
        </div>
      </div>
      <div class="stack">
        <div class="card" style="text-align:center">
          <img src="assets/icon-512.png" alt="Universe Daily app icon" width="112" height="112" style="border-radius:26px;box-shadow:0 12px 30px rgba(0,0,0,.4)" />
          <h2 style="margin-top:14px">Universe Daily for iPhone</h2>
          <p class="muted">Everything here, plus a home-screen widget, a 3D Moon and eclipse scenes, daily space games, and offline caching.</p>
          <a class="btn btn-download" href="https://apps.apple.com/us/app/universe-daily/id6751823874" target="_blank" rel="noopener" style="margin-top:6px">Download the app</a>
        </div>
        <div class="card">
          <h2>App information</h2>
          <div class="readout" style="margin-top:6px">
            <div class="stat"><div class="k">Platform</div><div class="v" style="font-size:15px">iOS & web</div></div>
            <div class="stat"><div class="k">Developer</div><div class="v" style="font-size:15px">Kportal</div></div>
            <div class="stat"><div class="k">Price</div><div class="v" style="font-size:15px">Free</div></div>
            <div class="stat"><div class="k">Tracking</div><div class="v" style="font-size:15px">None</div></div>
          </div>
        </div>
      </div>
    </div>`);
}
