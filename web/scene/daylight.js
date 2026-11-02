// Time of day (CONTRACT v2.2): phases, smooth light interpolation, night crossfade of the baked lightmaps (shared
// uniform `uNight`), emissive ramps and warm lamp lights. Publishes <html data-daylight="day|golden|dusk|night|dawn">
// and --night (0..1), at most once a second.
// The studio look (white backdrop, studio.js) is the same at every hour, so the live clock no longer drives it: the
// building stays in clean day light. The phases still exist for tests: ?time=22:15 or window.bothq.setTime('22:15').
import * as THREE from 'three';
import { smoothstep, lerp, clamp } from './spring.js';

const rgb = (hex) => { const c = new THREE.Color(hex); c.convertLinearToSRGB(); return [c.r, c.g, c.b]; };

const P = (o) => o;
const DAY = P({
  night: 0, lamps: 0, windows: 0,
  sunI: 2.1, sunEl: 58, sunAz: 217, sunC: rgb('#FFE3BF'),
  hemiI: 1.25, hemiSky: rgb('#FFF3E3'), hemiGnd: rgb('#D8C7B0'),
  fillI: 0.45, fillC: rgb('#E6EEFF'), envI: 0.55, exposure: 1.05,
  shadow: 0.34,
});
const GOLDEN = P({
  night: 0, lamps: 0.25, windows: 0.12,
  sunI: 1.9, sunEl: 20, sunAz: 212, sunC: rgb('#FFAE62'),
  hemiI: 1.0, hemiSky: rgb('#FFDDBC'), hemiGnd: rgb('#C79F7B'),
  fillI: 0.3, fillC: rgb('#FFD2A8'), envI: 0.45, exposure: 1.05,
  shadow: 0.36,
});
const DAWN = P({
  night: 0.55, lamps: 0.6, windows: 0.35,
  sunI: 0.9, sunEl: 10, sunAz: 205, sunC: rgb('#FFC4A0'),
  hemiI: 0.8, hemiSky: rgb('#E8D3D8'), hemiGnd: rgb('#9A8F9C'),
  fillI: 0.25, fillC: rgb('#BFC8F0'), envI: 0.3, exposure: 1.05,
  shadow: 0.32,
});
const DUSK = P({
  night: 0.6, lamps: 0.9, windows: 0.8,
  sunI: 0.9, sunEl: 8, sunAz: 212, sunC: rgb('#FF9A70'),
  hemiI: 0.8, hemiSky: rgb('#6A5F86'), hemiGnd: rgb('#2A2438'),
  fillI: 0.2, fillC: rgb('#6A70B0'), envI: 0.28, exposure: 1.03,
  shadow: 0.34,
});
const NIGHT = P({
  night: 1, lamps: 1, windows: 1,
  sunI: 0.32, sunEl: 40, sunAz: 217, sunC: rgb('#8CA6FF'),
  hemiI: 0.55, hemiSky: rgb('#31406E'), hemiGnd: rgb('#121629'),
  fillI: 0.18, fillC: rgb('#5568A8'), envI: 0.16, exposure: 1.0,
  shadow: 0.4,
});

const KEYS = [
  [0, NIGHT], [330, NIGHT], [390, DAWN], [450, DAY], [1050, DAY],
  [1080, GOLDEN], [1170, GOLDEN], [1230, DUSK], [1290, NIGHT], [1440, NIGHT],
];

function mixParams(a, b, t) {
  const out = {};
  for (const k in a) {
    out[k] = Array.isArray(a[k]) ? a[k].map((v, i) => lerp(v, b[k][i], t)) : lerp(a[k], b[k], t);
  }
  return out;
}

export function paramsAt(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  for (let i = 0; i < KEYS.length - 1; i++) {
    const [m0, p0] = KEYS[i], [m1, p1] = KEYS[i + 1];
    if (m >= m0 && m <= m1) return mixParams(p0, p1, smoothstep(0, 1, (m - m0) / (m1 - m0)));
  }
  return mixParams(NIGHT, NIGHT, 0);
}

export function phaseAt(minutes) {
  const m = ((minutes % 1440) + 1440) % 1440;
  if (m >= 330 && m < 450) return 'dawn';
  if (m >= 450 && m < 1050) return 'day';
  if (m >= 1050 && m < 1170) return 'golden';
  if (m >= 1170 && m < 1290) return 'dusk';
  return 'night';
}

function parseClock(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
  if (!m) return null;
  return clamp(Number(m[1]), 0, 24) * 60 + clamp(Number(m[2]), 0, 59);
}

const STUDIO_MINUTES = 12 * 60;                 // the studio is always lit like noon
const LAMP_COUNT = 6;
const LAMP_INTENSITY = 16;

export function createDaylight({ scene, renderer, eco = false }) {
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  const fill = new THREE.DirectionalLight(0xffffff, 0.4);
  fill.position.set(6, 5, 8);
  scene.add(sun, hemi, fill);

  const lamps = [];
  // Eco uses the sun, hemisphere and fill only. Six point lights stay out of the shader.
  if (!eco) {
    for (let i = 0; i < LAMP_COUNT; i++) {
      const l = new THREE.PointLight(0xffc98a, 0, 8.5, 2);
      l.castShadow = false;
      l.position.set(0, -99, 0);
      scene.add(l);
      lamps.push(l);
    }
  }

  const tracked = new Map();                      // material -> kind ('lamp' | 'windows')
  const uNight = { value: 0 };
  const state = { night: 0, lampsK: 0, windowsK: 0, phase: 'day', minutes: 720, params: null };
  let override = null;                            // minutes (?time= / setTime), or null = the fixed studio noon
  let cur = null;
  let lampSource = null;                          // () => { positions: Vector3[], k: number }
  let lastHtml = -1e9;
  let clockMs = 0;

  const tmp = new THREE.Color();
  const dir = new THREE.Vector3();

  const urlTime = new URLSearchParams(location.search).get('time');
  if (urlTime && urlTime !== 'auto') override = parseClock(urlTime);

  function nowMinutes() {
    return override !== null ? override : STUDIO_MINUTES;
  }

  function setTime(value) {
    override = value && value !== 'auto' ? parseClock(value) : null;
    lastHtml = -1e9;
  }

  function apply(p, dt) {
    sun.color.setRGB(...p.sunC, THREE.SRGBColorSpace);
    sun.intensity = p.sunI;
    const el = THREE.MathUtils.degToRad(p.sunEl), az = THREE.MathUtils.degToRad(p.sunAz);
    dir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).multiplyScalar(14);
    sun.position.copy(dir);
    hemi.color.setRGB(...p.hemiSky, THREE.SRGBColorSpace);
    hemi.groundColor.setRGB(...p.hemiGnd, THREE.SRGBColorSpace);
    hemi.intensity = p.hemiI;
    fill.color.setRGB(...p.fillC, THREE.SRGBColorSpace);
    fill.intensity = p.fillI;
    scene.environmentIntensity = p.envI;
    renderer.toneMappingExposure = p.exposure;
    uNight.value = p.night;
    state.night = p.night;
    state.lampsK = p.lamps;
    state.windowsK = p.windows;
    for (const [mat, kind] of tracked) {
      if (kind === 'lamp') mat.emissiveIntensity = p.lamps * 2.4;
      else if (kind === 'windows') mat.emissiveIntensity = p.windows * 1.7;
    }
  }

  function updateLamps() {
    if (!lamps.length) return;
    const src = lampSource ? lampSource() : null;
    const k = src ? src.k * state.lampsK : 0;
    for (let i = 0; i < LAMP_COUNT; i++) {
      const l = lamps[i];
      const pos = src && src.positions[i];
      // lights stay in the scene (intensity 0 by day) so the lit materials never recompile
      if (pos) { l.position.copy(pos); l.intensity = LAMP_INTENSITY * k; } else l.intensity = 0;
    }
  }

  function update(dt, nowMs) {
    clockMs = nowMs;
    const minutes = nowMinutes();
    const target = paramsAt(minutes);
    // Eco snaps. The exponential mix never quite lands, which would keep a demand-render loop awake.
    if (eco || !cur) cur = target;
    else {
      const k = 1 - Math.exp(-dt / 0.45);        // never jump: follow the clock with a soft lag
      cur = mixParams(cur, target, k);
    }
    state.minutes = minutes;
    state.phase = phaseAt(minutes);
    state.params = cur;
    apply(cur, dt);
    updateLamps();

    if (nowMs - lastHtml > 1000) {
      lastHtml = nowMs;
      const root = document.documentElement;
      if (root.dataset.daylight !== state.phase) root.dataset.daylight = state.phase;
      root.style.setProperty('--night', cur.night.toFixed(3));
    }
  }

  const api = {
    uNight, state, update, setTime,
    track(mat, kind) { tracked.set(mat, kind); },
    untrack(mat) { tracked.delete(mat); },
    setLampSource(fn) { lampSource = fn; },
    get shadowOpacity() { return cur ? cur.shadow : 0.3; },
    get night() { return state.night; },
  };
  window.bothq = Object.assign(window.bothq || {}, { setTime, daylight: state });
  return api;
}
