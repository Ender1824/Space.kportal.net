// Moon phase on the device, ported from the app (Meeus, Astronomical Algorithms ch. 47–48).

const RAD = Math.PI / 180;
const norm = (x) => ((x % 360) + 360) % 360;
export const SYNODIC = 29.530588853;

const NAMES = [
  ["new", "New Moon"], ["waxingCrescent", "Waxing Crescent"], ["firstQuarter", "First Quarter"], ["waxingGibbous", "Waxing Gibbous"],
  ["full", "Full Moon"], ["waningGibbous", "Waning Gibbous"], ["lastQuarter", "Last Quarter"], ["waningCrescent", "Waning Crescent"],
];

function args(date) {
  const jd = new Date(date).getTime() / 86400000 + 2440587.5;
  const t = (jd - 2451545.0) / 36525;
  return {
    t,
    d: norm(297.8501921 + 445267.1114034 * t - 0.0018819 * t * t),
    m: norm(357.5291092 + 35999.0502909 * t - 0.0001536 * t * t),
    mp: norm(134.9633964 + 477198.8675055 * t + 0.0087414 * t * t),
    f: norm(93.272095 + 483202.0175233 * t - 0.0036539 * t * t),
  };
}

export function moonPhase(date = new Date()) {
  const { d, m, mp } = args(date);
  const i = 180 - d
    - 6.289 * Math.sin(mp * RAD) + 2.1 * Math.sin(m * RAD)
    - 1.274 * Math.sin((2 * d - mp) * RAD) - 0.658 * Math.sin(2 * d * RAD)
    - 0.214 * Math.sin(2 * mp * RAD) - 0.11 * Math.sin(d * RAD);
  const illumination = (1 + Math.cos(i * RAD)) / 2;
  const elongation = norm(180 - i);
  let key;
  if (illumination < 0.02) key = "new";
  else if (illumination > 0.98) key = "full";
  else if (Math.abs(elongation - 90) < 6) key = "firstQuarter";
  else if (Math.abs(elongation - 270) < 6) key = "lastQuarter";
  else key = elongation < 90 ? "waxingCrescent" : elongation < 180 ? "waxingGibbous" : elongation < 270 ? "waningGibbous" : "waningCrescent";
  const name = NAMES.find((n) => n[0] === key)[1];
  return { elongation, illumination, waxing: elongation < 180, key, name, age: (elongation / 360) * SYNODIC };
}

/** Earth–Moon distance in km (main terms of Meeus 47.A). */
export function moonDistance(date = new Date()) {
  const { d, m, mp, f } = args(date);
  const c = (x) => Math.cos(x * RAD);
  const sum = -20905355 * c(mp) - 3699111 * c(2 * d - mp) - 2955968 * c(2 * d) - 569925 * c(2 * mp)
    + 48888 * c(m) - 3149 * c(2 * f) + 246158 * c(2 * d - 2 * mp) - 152138 * c(2 * d - m - mp)
    - 170733 * c(2 * d + mp) - 204586 * c(2 * d - m) - 129620 * c(m - mp) + 108743 * c(d) + 104755 * c(m + mp);
  return 385000.56 + sum / 1000;
}

/** Next time the elongation reaches `target` degrees (0 new, 90 first quarter, 180 full, 270 last quarter). */
export function nextPhase(target, from = new Date()) {
  const start = new Date(from).getTime();
  const gap = (t) => norm(target - moonPhase(new Date(t)).elongation);
  let t = start, g = gap(t);
  // Step forward in 6-hour hops until we pass the target, then bisect.
  for (let i = 0; i < 140; i++) {
    const t2 = t + 6 * 3600000, g2 = gap(t2);
    if (g2 > g && g < 10) {
      let lo = t, hi = t2;
      for (let k = 0; k < 30; k++) { const mid = (lo + hi) / 2; if (gap(mid) > 180) hi = mid; else lo = mid; }
      return new Date((lo + hi) / 2);
    }
    t = t2; g = g2;
  }
  return null;
}

/** SVG path for the lit part of a moon disk of radius r centred at (cx, cy). */
export function litPath(phase, cx, cy, r) {
  const k = phase.illumination;
  const waxing = phase.waxing;
  // Terminator is an ellipse with semi-major r and semi-minor |1-2k| r.
  const rx = Math.abs(1 - 2 * k) * r;
  const sweepOuter = waxing ? 1 : 0;
  const sweepInner = (k > 0.5) === waxing ? 1 : 0;
  return `M ${cx} ${cy - r} A ${r} ${r} 0 0 ${sweepOuter} ${cx} ${cy + r} A ${rx} ${r} 0 0 ${sweepInner} ${cx} ${cy - r} Z`;
}

/** A small moon icon as an SVG string. */
export function moonIcon(phase, size = 40, id = "m") {
  const r = size / 2 - 1, c = size / 2;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true">
    <circle cx="${c}" cy="${c}" r="${r}" fill="#1d2a33"/>
    <path d="${litPath(phase, c, c, r)}" fill="#efe6cf"/>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(241,236,224,.25)" stroke-width="1"/></svg>`;
}
