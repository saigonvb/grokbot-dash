// Isometric 3D building (CONTRACT §6, v2): renderer, camera on springs, floor stack, actors, picking, post.
// Public API (unchanged): initScene, renderScene, zoom, focusBot.
import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadOfficeAssets } from './office.js';
import { Building } from './building.js';
import { createDaylight } from './daylight.js';
import { createPost } from './post.js';
import { studioCss } from './studio.js';
import { Actor, flattenMaterials } from './actor.js';
import { generateBlob } from './blobgen.js';
import { Spring, clamp } from './spring.js';
import { sofiaHour, fontsPromise } from './walls.js';

// Relative to the page (not the site root), so the office also works when it is published in a sub-folder
// (…/office/ -> ../assets). Locally the page is at `/`, where this is /assets.
const ASSETS = '../assets';
const ISO_DIR = new THREE.Vector3(1, 1, 1).normalize();
const HOME = { x: -0.4, y: -0.3, z: 0.3 };             // camera target relative to the active floor's surface
const VIEW_SPAN = { w: 35, h: 22 };                 // meters visible at zoom 1 (the stack + the white air around it)
const PHONE_SPAN_W = 29.5;                          // m across a phone's scene box: the floor + shaft fill ~90 % of the screen
const ZOOM = { min: 0.75, max: 3, focus: 2 };
const UI_LEFT = 230, UI_RIGHT = 360;                   // glass panels the building must not hide behind
const SIN_E = Math.sin(Math.atan(1 / Math.SQRT2));      // sin(35.264°) = ground foreshortening
// Server desk numbers fill 1..20 in arrival order; seat them on the far side of the tables first (odd desks face
// the camera), neighbours alternating so tags never collide.
const DESK_ORDER = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20];

let renderer, labels, camera, scene, container, callbacks, daylight, building, post;
let assets = null;
let lastState = null, lastView = { currentFloor: null, selectedBot: null };
const actors = new Map();
const retiring = new Set();
const pickables = new Set();
const models = new Map();            // avatar id -> Promise<Object3D|null>
const effects = [];
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const cursor = { active: false, x: 0, z: 0 };
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const tmp = new THREE.Vector3();
const clock = new THREE.Clock();
const cam = {
  x: new Spring(HOME.x, 0.45), y: new Spring(HOME.y, 0.55), z: new Spring(HOME.z, 0.45), zoom: new Spring(0, 0.4),   // zoom is ln(zoom)
};
let hoveredId = null, pointerDirty = false, drag = null;
const touches = new Map();
let pinch = null;
let introDone = false, switchedAt = 0, nowSec = 0, settledOnce = false;
let loadingEl = null;
// Debug/test switches: ?floor=<id> forces the active floor, ?from=<id> starts there first, ?intro=0 skips the load
// animation, ?hold=<s> fast-forwards that long after the (last) switch and freezes time, ?cam=x,z,zoom snaps the camera.
// Wallpaper mode (?mode=wallpaper, for Lively): no panel offset, hover only (no pan / zoom / select), <= 30 fps, no
// in-scene tags unless &tags=1. app.js owns ?floor= there (pin / cycle), so the scene's own debug switch is off.
const WALLPAPER = new URLSearchParams(location.search).get('mode') === 'wallpaper';
const WALLPAPER_TAGS = new URLSearchParams(location.search).get('tags') === '1';
const WALLPAPER_FRAME_MS = 1000 / 30;
const OFFICE_FRAME_MS = 1000 / 30;   // camera, floor changes, bots that are actually doing something
const IDLE_FRAME_MS = 1000 / 12;     // resting office: breathing and blinks do not need a display refresh
const ECO_PIXEL = 0.75;              // internal resolution vs device pixels; CSS stretches the canvas
const ECO_MAX_EDGE = 1280;           // longest drawing-buffer edge in Eco
const WALLPAPER_FRAMING = 0.9;                        // < 1 = closer: the side panels' space is not needed, so the tower fills more
const TEST = (() => {
  const q = new URLSearchParams(location.search);
  return { floor: WALLPAPER ? null : q.get('floor'), from: q.get('from'), intro: q.get('intro'), hold: q.has('hold') ? Number(q.get('hold')) : null, cam: q.get('cam'), cursor: q.get('cursor') };
})();
let frozen = false, pinCursor = false;
let lowPower = readLowPower();
if (lowPower) document.documentElement.classList.add('bhq-eco');
let wake = true;
let busy = true;
let ecoPending = false;
const powerStats = { presented: 0, renderMs: 0, auraBuilds: 0, ticks: 0, skipped: 0, since: performance.now() };

function readLowPower() {
  const q = new URLSearchParams(location.search);
  if (q.has('lowpower')) return q.get('lowpower') !== '0';
  const body = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  const amp = body.indexOf('&');
  const params = new URLSearchParams(amp === -1 ? '' : body.slice(amp + 1));
  if (params.has('lowpower')) return params.get('lowpower') !== '0';
  try { return localStorage.getItem('bothq.lowpower') === '1'; } catch { return false; }
}

function pixelRatioFor(w, h) {
  const dpr = devicePixelRatio || 1;
  if (!lowPower) return Math.min(dpr, 1.5);
  let pr = Math.min(dpr, ECO_PIXEL);
  const edge = Math.max(w || 1, h || 1) * pr;
  if (edge > ECO_MAX_EDGE) pr *= ECO_MAX_EDGE / edge;
  return Math.max(0.25, pr);
}

// The office GLB is the biggest download: start it the moment this module runs (index.html may have preloaded it
// already; the loader then reuses that response), not after the renderer and the UI are set up.
const officeAssets = loadOfficeAssets(`${ASSETS}/office`);

export function initScene(el, cbs = {}) {
  container = el;
  callbacks = cbs;
  container.classList.add('hq-scene');
  ensureAssets();

  // Loader: index.html may already carry it (visible from the first paint). It stays until the first floor drops in,
  // so nobody sees a half-built office (the elevator shaft alone) while the bots are still on their way.
  loadingEl = container.querySelector('.hq-loading');
  if (!loadingEl) {
    loadingEl = document.createElement('div');
    loadingEl.className = 'hq-loading';
    loadingEl.setAttribute('role', 'status');
    loadingEl.innerHTML = '<span class="hq-loading-label">Building the office</span><span class="hq-loading-track"><i></i></span>';
    container.append(loadingEl);
  }

  // 'high-performance' pins a dual-GPU laptop to the discrete chip. Default lets Chrome pick.
  // Eco (&lowpower=1, ?lowpower=1, or localStorage bothq.lowpower) asks for the integrated GPU,
  // no MSAA, and a smaller drawing buffer. The preference is fixed for the life of the context,
  // so the button reloads after writing the flag.
  renderer = new THREE.WebGLRenderer({
    antialias: !lowPower,
    alpha: true,
    powerPreference: lowPower ? 'low-power' : 'default',
  });
  renderer.setPixelRatio(pixelRatioFor(container.clientWidth, container.clientHeight));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = lowPower ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.className = 'hq-canvas';
  container.append(renderer.domElement);

  labels = new CSS2DRenderer();
  labels.domElement.className = 'hq-labels';
  container.append(labels.domElement);

  scene = new THREE.Scene();
  if (!lowPower) {
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
  }

  daylight = createDaylight({ scene, renderer, eco: lowPower });
  document.documentElement.dataset.sky = 'studio';        // white backdrop at every hour: the UI stays on light glass (web/styles.css)
  container.style.background = studioCss();               // the same backdrop as the post pass draws, for the first moments

  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 240);
  camera.position.copy(ISO_DIR).multiplyScalar(80);
  camera.lookAt(0, 0, 0);

  officeAssets.then((a) => {
    assets = a;
    if (lowPower) for (const t of Object.values(a.templates)) flattenMaterials(t);
    building = new Building({ scene, daylight, assets: a, baseUrl: `${ASSETS}/office`, renderer, eco: lowPower });
    a.spots.lounges.forEach((s) => { if (s) s.lounge = true; });
    window.bothq = Object.assign(window.bothq || {}, { source: a.source });
    resize();
    const go = () => { if (lastState) sync(); };
    Promise.race([fontsPromise, new Promise((r) => setTimeout(r, 1500))]).then(go, go);
  });

  // Eco skips the composer entirely: no MSAA, tilt-shift, contact shadow, penumbra, or ambient blur.
  post = lowPower ? null : createPost(renderer, scene, camera, { samples: 2, tilt: true, cheapAura: false });

  addPointerHandlers();
  new ResizeObserver(resize).observe(container);
  resize();
  if (lowPower) {
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting)) requestDraw();
      }).observe(container);
    }
    fontsPromise.then(() => requestDraw());
    requestDraw();
  } else {
    renderer.setAnimationLoop(frame);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) requestDraw(); });

  window.bothq = Object.assign(window.bothq || {}, {
    setLowPower,
    power: {
      get low() { return lowPower; },
      get presented() { return powerStats.presented; },
      get renderMs() { return powerStats.renderMs; },
      get auraBuilds() { return powerStats.auraBuilds; },
      get elapsed() { return (performance.now() - powerStats.since) / 1000; },
      reset() { powerStats.presented = 0; powerStats.renderMs = 0; powerStats.auraBuilds = 0; powerStats.ticks = 0; powerStats.skipped = 0; powerStats.since = performance.now(); },
      get ticks() { return powerStats.ticks; },
      get skipped() { return powerStats.skipped; },
      // Eco: false once the demand loop has stopped. The paced loop is always running.
      get running() { return lowPower ? ecoPending : true; },
    },
    scene: { get camera() { return camera; }, get building() { return building; }, cam, actors, get daylight() { return daylight; }, switchFloor: (id) => building && switchFloor(id, false), settle },
  });
}

// The page may not load scene.css itself (older index.html): make sure it is there.
// Type falls back to the system fonts named in scene.css. No remote font stylesheet.
function ensureAssets() {
  if (!document.querySelector('link[href*="scene.css"]')) {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = new URL('./scene.css', import.meta.url).href;
    document.head.append(l);
  }
}

export function setLowPower(on) {
  const next = !!on;
  try { localStorage.setItem('bothq.lowpower', next ? '1' : '0'); } catch { /* private mode */ }
  const body = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  if (/^[A-Za-z0-9_-]{6,64}(?:&|$)/.test(body)) {
    const amp = body.indexOf('&');
    const topic = amp === -1 ? body : body.slice(0, amp);
    const params = new URLSearchParams(amp === -1 ? '' : body.slice(amp + 1));
    if (next) params.set('lowpower', '1'); else params.delete('lowpower');
    const rest = params.toString();
    const hash = '#' + topic + (rest ? '&' + rest : '');
    if (hash !== location.hash) { location.hash = hash; return; }   // app.js reloads on a feed hash change
  }
  location.reload();
}

export function renderScene(state, view) {
  requestDraw();
  lastState = state;
  lastView = { ...view };
  if (building) sync();
}

function sync() {
  requestDraw();
  const state = lastState, view = lastView;
  const floors = [...state.floors].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  building.setFloors(floors);
  let want = view.currentFloor && floors.some((f) => f.id === view.currentFloor) ? view.currentFloor : (floors[0]?.id ?? '_');
  if (TEST.floor && floors.some((f) => f.id === TEST.floor)) want = TEST.from && !introDone && floors.some((f) => f.id === TEST.from) ? TEST.from : TEST.floor;
  if (building.activeId !== want) switchFloor(want, !introDone);
  introDone = true;

  const inst = building.activeOpen();
  if (!inst) return;
  const floorBots = Object.values(state.bots).filter((b) => b.floor === building.activeId);
  const ids = new Set(floorBots.map((b) => b.id));

  for (const [id, actor] of actors) if (!ids.has(id)) { actor.retire(); retiring.add(actor); actors.delete(id); }

  const maxShare = Math.max(0.0001, ...floorBots.map((b) => b.usage_share || 0));
  const lounge = assignLounge(floorBots);
  const flags = new Array(20).fill(0);
  const delay = Math.max(0, switchedAt + 0.55 - nowSec);
  for (const bot of floorBots) {
    let actor = actors.get(bot.id);
    if (!actor) {
      actor = new Actor(bot, { parent: inst.root, inst, pickables, confetti, cursor, dropDelay: delay, lowPower });
      actors.set(bot.id, actor);
      attachModel(actor, bot);
    }
    const deskIdx = (DESK_ORDER[(bot.desk || 1) - 1] || 1) - 1;
    const desk = assets.spots.desks[deskIdx] || assets.spots.desks[0];
    if ((bot.effective_status || bot.status) === 'working' && !lounge.has(bot.id)) flags[deskIdx] = 1;
    actor.update(bot, lounge.get(bot.id) || desk, { maxShare, selectedBot: view.selectedBot });
  }
  building.setScreens(flags);
  const floor = floors.find((f) => f.id === building.activeId);
  building.setDisplayData({ floorName: floor ? floor.name : '', bots: floorBots, hour: sofiaHour(state.now) });
  if (hoveredId && !actors.has(hoveredId)) hoveredId = null;
  if (!settledOnce) {
    settledOnce = true;
    if (TEST.intro === '0') settle(3.5);
    if (TEST.from && TEST.floor) sync();                 // second pass: ride from `from` to `floor`
    if (TEST.hold !== null) { settle(TEST.hold); frozen = true; }
    if (TEST.cursor) {                                   // debug: ?cursor=x,z pins the cursor ground point
      const [x, z] = TEST.cursor.split(',').map(Number);
      cursor.active = true; cursor.x = x; cursor.z = z; pinCursor = true;
      settle(1.2);
    }
    if (TEST.cam) {
      const [x, z, zm] = TEST.cam.split(',').map(Number);
      cam.x.snap(x); cam.z.snap(z); cam.zoom.snap(Math.log(zm || 1));
    }
  }
}

// Fast-forward all springs/animations (used by ?intro=0 and window.bothq.settle() for tests and screenshots).
function settle(seconds = 3) {
  const step = 1 / 30;
  for (let t = 0; t < seconds; t += step) {
    nowSec += step;
    stepCamera(step);
    building.update(step, performance.now());
    for (const a of actors.values()) { a.hostAlpha = building.activeOpen()?.alpha ?? 1; a.tick(step, nowSec); }
    for (const a of retiring) { a.tick(step, nowSec); if (a.dead) retiring.delete(a); }
  }
}

// Idle bots go to the lounge while seats last; the rest nap at their desks.
function assignLounge(bots) {
  const map = new Map();
  const seats = assets.spots.lounges.filter(Boolean);
  const idle = bots.filter((b) => (b.effective_status || b.status) === 'idle').sort((a, b) => (a.desk || 0) - (b.desk || 0));
  idle.slice(0, seats.length).forEach((b, i) => map.set(b.id, seats[i]));
  return map;
}

// Avatar chain (docs/AVATARS.md): 1. hand-made GLB assets/blobs/<avatar>.glb, 2. generated blob from bot.look
// (shape / colour / accessory written by Grok Bot from a screenshot), 3. generated blob from a hash of the id.
// A look that changes later (data/bots.json is hot-reloaded) re-dresses the actor on the next state poll.
function attachModel(actor, bot) {
  let current = null;
  const apply = (b) => {
    const key = `${b.avatar || b.id}|${b.color || ''}|${JSON.stringify(b.look || null)}`;
    if (key === current) return;
    current = key;
    (b.has_glb === false ? Promise.resolve(null) : loadModel(b.avatar || b.id)).then((m) => {   // has_glb: server knows the file is missing, no probe
      if (actor.dead || current !== key) return;
      if (m) return actor.setModel(m.clone(true));
      const look = b.look || {};
      actor.setModel(generateBlob({ shape: look.shape, color: look.color || b.color, accessory: look.accessory, seed: b.id }));
    });
  };
  apply(bot);
  const update = actor.update.bind(actor);
  actor.update = (b, spot, view) => { apply(b); return update(b, spot, view); };
}

function loadModel(id) {
  if (!models.has(id)) {
    models.set(id, new GLTFLoader().loadAsync(`${ASSETS}/blobs/${encodeURIComponent(id)}.glb`)
      .then((g) => g.scene)
      .catch(() => null));
  }
  return models.get(id);
}

// ---------- floor switch = elevator ride ----------

function switchFloor(id, first) {
  for (const a of actors.values()) { a.retire(); retiring.add(a); }
  actors.clear();
  hoveredId = null;
  building.setActive(id, { intro: first });
  const y = building.activeY + HOME.y;
  cam.x.to(HOME.x); cam.z.to(HOME.z); cam.y.to(y); cam.zoom.to(0);
  if (first) {
    cam.x.snap(HOME.x); cam.z.snap(HOME.z);
    cam.y.snap(y - 2.6); cam.zoom.snap(Math.log(0.86));
    cam.y.to(y, 0.1); cam.zoom.to(0, 0.1);
  }
  switchedAt = nowSec;
  if (first) { building.prewarm(camera); hideLoader(); }
}

function hideLoader() {
  const el = loadingEl;
  if (!el) return;
  loadingEl = null;
  el.classList.add('is-done');
  setTimeout(() => el.remove(), 450);
}

// ---------- camera (all on springs) ----------

export function zoom(dir) {
  requestDraw();
  if (!building) return;
  if (dir === 'reset') {
    cam.x.to(HOME.x); cam.z.to(HOME.z); cam.y.to(building.activeY + HOME.y); cam.zoom.to(0);
    return;
  }
  const z = clamp(Math.exp(cam.zoom.target) * (dir === 'in' ? 1.3 : 1 / 1.3), ZOOM.min, ZOOM.max);
  cam.zoom.to(Math.log(z));
}

export function focusBot(id) {
  requestDraw();
  const a = actors.get(id);
  if (!a || !building) return;
  cam.x.to(a.root.position.x);
  cam.z.to(a.root.position.z);
  cam.y.to(building.activeY + 0.6);
  cam.zoom.to(Math.log(Math.max(Math.exp(cam.zoom.target), ZOOM.focus)));
}

function stepCamera(dt) {
  clampTarget();
  cam.x.step(dt); cam.y.step(dt); cam.z.step(dt); cam.zoom.step(dt);
  const z = clamp(Math.exp(cam.zoom.x), ZOOM.min * 0.85, ZOOM.max * 1.1);
  if (Math.abs(z - camera.zoom) > 1e-5) { camera.zoom = z; camera.updateProjectionMatrix(); }
  tmp.set(cam.x.x, cam.y.x, cam.z.x);
  camera.position.copy(tmp).addScaledVector(ISO_DIR, 80);
}

function clampTarget() {
  cam.x.target = clamp(cam.x.target, -9.5, 9.5);
  cam.z.target = clamp(cam.z.target, -7.5, 7.5);
  cam.zoom.target = clamp(cam.zoom.target, Math.log(ZOOM.min), Math.log(ZOOM.max));
}

function resize() {
  requestDraw();
  if (!renderer) return;
  const w = container.clientWidth || 1, h = container.clientHeight || 1;
  renderer.setPixelRatio(pixelRatioFor(w, h));
  renderer.setSize(w, h, false);
  labels.setSize(w, h);
  post?.setSize(w, h);
  const aspect = w / h;
  // phones (the UI's <= 900 px layout) have no side panels to keep clear: the floor fills the width, bots read bigger
  const spanW = WALLPAPER ? VIEW_SPAN.w : VIEW_SPAN.w + (PHONE_SPAN_W - VIEW_SPAN.w) * (1 - clamp((w - 560) / 340, 0, 1));
  const halfH = Math.max(VIEW_SPAN.h, spanW / aspect) / 2 * (WALLPAPER ? WALLPAPER_FRAMING : 1);
  camera.left = -halfH * aspect; camera.right = halfH * aspect;
  camera.top = halfH; camera.bottom = -halfH;
  // keep the building clear of the glass panels: shift the view so its centre is the free space between them
  const shift = WALLPAPER ? 0 : clamp((w - 900) / 600, 0, 1) * (UI_RIGHT - UI_LEFT) / 2;   // wallpaper: no panels, centred
  if (shift > 0.5) camera.setViewOffset(w, h, shift, 0, w, h); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}

const pxPerMeter = () => renderer.domElement.clientHeight / ((camera.top - camera.bottom) / camera.zoom);

// ---------- pointer: pan, zoom, hover, click ----------

function addPointerHandlers() {
  const el = renderer.domElement;
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerleave', () => { cursor.active = false; setHover(null); requestDraw(); });
  if (WALLPAPER) return;                              // a desktop background: bots follow the cursor, nothing else
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', onUp);
  el.addEventListener('pointercancel', (e) => { touches.delete(e.pointerId); drag = null; pinch = null; requestDraw(); });
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

function setPointer(e) {
  const r = renderer.domElement.getBoundingClientRect();
  pointer.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
}

function onDown(e) {
  renderer.domElement.setPointerCapture?.(e.pointerId);
  setPointer(e);
  touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (touches.size === 2) {
    const [a, b] = [...touches.values()];
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: cam.zoom.target };
    drag = null;
    return;
  }
  drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, lt: performance.now(), panning: false, vx: 0, vz: 0 };
}

function onMove(e) {
  setPointer(e);
  cursor.active = true;
  pointerDirty = true;
  requestDraw();
  if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && touches.size === 2) {
    const [a, b] = [...touches.values()];
    cam.zoom.to(pinch.z + Math.log(Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
    return;
  }
  if (!drag || drag.id !== e.pointerId) return;
  if (!drag.panning && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 5) drag.panning = true;
  if (!drag.panning) return;
  const now = performance.now();
  const dx = e.clientX - drag.lx, dy = e.clientY - drag.ly;
  const dtS = Math.max(0.001, (now - drag.lt) / 1000);
  drag.lx = e.clientX; drag.ly = e.clientY; drag.lt = now;
  // screen-space drag -> ground-plane move of the camera target (content follows the pointer 1:1)
  const ppm = pxPerMeter();
  const mx = -dx / ppm, mz = dy / ppm / SIN_E;
  const wx = (mx - mz) / Math.SQRT2, wz = (-mx - mz) / Math.SQRT2;
  cam.x.snap(clamp(cam.x.x + wx, -9.5, 9.5));
  cam.z.snap(clamp(cam.z.x + wz, -7.5, 7.5));
  drag.vx = drag.vx * 0.6 + (wx / dtS) * 0.4;
  drag.vz = drag.vz * 0.6 + (wz / dtS) * 0.4;
}

function onUp(e) {
  touches.delete(e.pointerId);
  if (pinch) {
    if (touches.size < 2) { pinch = null; requestDraw(); }
    drag = null;
    return;
  }
  if (!drag || drag.id !== e.pointerId) return;
  const d = drag;
  drag = null;
  if (d.panning) {                                   // let it glide a little, then settle
    const vx = clamp(d.vx, -30, 30), vz = clamp(d.vz, -30, 30);
    cam.x.v = vx; cam.z.v = vz;
    cam.x.to(cam.x.x + vx * 0.12); cam.z.to(cam.z.x + vz * 0.12);
    requestDraw();
    return;
  }
  setPointer(e);
  callbacks.onSelectBot?.(pick());
  requestDraw();
}

function onWheel(e) {
  e.preventDefault();
  setPointer(e);
  const z0 = Math.exp(cam.zoom.target);
  const z1 = clamp(z0 * Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0016)), ZOOM.min, ZOOM.max);
  if (z1 === z0) return;
  // keep the ground point under the cursor in place while zooming
  const shift = camera.view?.enabled ? (camera.view.offsetX / camera.view.fullWidth) * 2 : 0;
  const nx = pointer.x + shift, ny = pointer.y;
  const k = 1 / z0 - 1 / z1;
  const mx = nx * camera.right * k, my = ny * camera.top * k / SIN_E;
  cam.x.to(cam.x.target + (mx - my) / Math.SQRT2);
  cam.z.to(cam.z.target + (-mx - my) / Math.SQRT2);
  cam.zoom.to(Math.log(z1));
  requestDraw();
}

function pick() {
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObjects([...pickables], false)[0];
  return hit ? hit.object.userData.actorId : null;
}

function setHover(id) {
  if (id === hoveredId) return;
  if (hoveredId) actors.get(hoveredId)?.setHovered(false);
  hoveredId = id;
  if (id) actors.get(id)?.setHovered(true);
  container.classList.toggle('is-hovering', !!id);
  callbacks.onHoverBot?.(id);
}

// ---------- effects ----------

const CONFETTI_COLORS = [0x34C759, 0x0A84FF, 0xFF9F0A, 0xFF4FA0, 0xFF6A13, 0x14B8A6];
const confettiGeo = new THREE.PlaneGeometry(0.07, 0.035);

function confetti(at) {
  const group = new THREE.Group();
  group.position.copy(at);
  const parts = [];
  for (let i = 0; i < 36; i++) {
    const m = new THREE.Mesh(confettiGeo, new THREE.MeshBasicMaterial({ color: CONFETTI_COLORS[i % CONFETTI_COLORS.length], side: THREE.DoubleSide, transparent: true }));
    const a = Math.random() * Math.PI * 2, up = 2.2 + Math.random() * 1.6, out = 0.8 + Math.random() * 1.2;
    parts.push({ m, v: new THREE.Vector3(Math.cos(a) * out, up, Math.sin(a) * out), spin: new THREE.Vector3(Math.random() * 9, Math.random() * 9, 0) });
    group.add(m);
  }
  scene.add(group);
  effects.push({ group, parts, t: 0, life: 1.6 });
}

function stepEffects(dt) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const fx = effects[i];
    fx.t += dt;
    for (const p of fx.parts) {
      p.v.y -= 6.5 * dt;
      p.v.multiplyScalar(1 - 1.4 * dt);
      p.m.position.addScaledVector(p.v, dt);
      p.m.rotation.x += p.spin.x * dt; p.m.rotation.y += p.spin.y * dt;
      p.m.material.opacity = Math.max(0, 1 - fx.t / fx.life);
    }
    if (fx.t >= fx.life) {
      fx.group.removeFromParent();
      fx.parts.forEach((p) => p.m.material.dispose());
      effects.splice(i, 1);
    }
  }
}

// ---------- share image (web/share/share.js) ----------

// One still of the current floor for the share card, framed like a product shot: the floor, the stack under it and the
// elevator fitted into `box` (fractions of the frame, y down: the caption gets the rest), on the same white studio
// through the same post chain, at width x height, supersampled by `scale` when the GPU allows it.
// Nothing private gets in: the in-scene tags are DOM and are never drawn into the canvas; the wall screen and the task
// board are redrawn for this one frame without the floor's name, bot names or tasks; selection / hover rings, bots on
// their way out and confetti are hidden. The live canvas is resized, drawn, copied out and restored inside this one
// task, then the live view is drawn again before the browser paints, so nothing flickers.
// Returns a <canvas> of width x height, or null while the office is still loading.
export function captureScene({ width = 1600, height = 900, scale = 1, box = { x: 0.06, y: 0.06, w: 0.88, h: 0.76 } } = {}) {
  const inst = building?.activeOpen();
  if (!inst || !renderer) return null;
  const pr = renderer.getPixelRatio();
  const maxPx = Math.min(renderer.capabilities.maxTextureSize, renderer.capabilities.maxRenderbufferSize || Infinity);
  const ss = Math.max(1, Math.min(scale, maxPx / width, maxPx / height));
  const zoom0 = camera.zoom, pos0 = camera.position.clone();
  const hidden = [];
  const hide = (o) => { if (o?.visible) { o.visible = false; hidden.push(o); } };
  for (const a of actors.values()) hide(a.ring);
  for (const a of retiring) hide(a.root);
  for (const fx of effects) hide(fx.group);
  const walls = inst.walls, live = walls?.data;
  try {
    if (live) {
      const anon = { ...live, floorName: `Floor ${building.activeIndex + 1}`, bots: live.bots.map((b) => ({ ...b, name: '', task: '', step: '' })) };
      if (walls.screen) walls.drawScreen(anon);
      if (walls.board) walls.drawBoard(anon);
    }
    renderer.setPixelRatio(ss);
    renderer.setSize(width, height, false);
    post?.setSize(width, height);
    frameShot(width / height, box);
    focusV.set(0, building.cabinY.x + 0.7, 0).project(camera);
    if (post) post.render(clamp(focusV.y * 0.5 + 0.5, 0, 1), 0, 1);
    else renderer.render(scene, camera);
    const out = document.createElement('canvas');
    out.width = width; out.height = height;
    const g = out.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(renderer.domElement, 0, 0, width, height);
    return out;
  } finally {
    hidden.forEach((o) => { o.visible = true; });
    if (live) {
      if (walls.screen) walls.drawScreen(live);
      if (walls.board) walls.drawBoard(live);
    }
    renderer.setPixelRatio(pr);
    resize();
    camera.zoom = zoom0;
    camera.position.copy(pos0);
    camera.updateProjectionMatrix();
    focusV.set(0, building.cabinY.x + 0.7, 0).project(camera);
    if (post) post.render(clamp(focusV.y * 0.5 + 0.5, 0, 1), 0, clamp(1.5 / camera.zoom, 0.25, 1));
    else renderer.render(scene, camera);
  }
}

// The camera at its home spot over the active floor, the frustum fitted to every visible building mesh (in view space,
// so the iso silhouette is measured, not a world box) and placed so that silhouette is centred in `box`.
const shotBox = new THREE.Box3();
const shotCorner = new THREE.Vector3();
function frameShot(aspect, box) {
  camera.clearViewOffset();
  camera.zoom = 1;
  camera.position.set(HOME.x, building.activeY + HOME.y, HOME.z).addScaledVector(ISO_DIR, 80);
  camera.updateMatrixWorld(true);
  building.group.updateMatrixWorld(true);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const walk = (o) => {
    if (!o.visible) return;
    if (o.isMesh && o.geometry) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      shotBox.copy(o.geometry.boundingBox);
      for (let i = 0; i < 8; i++) {
        shotCorner.set(i & 1 ? shotBox.max.x : shotBox.min.x, i & 2 ? shotBox.max.y : shotBox.min.y, i & 4 ? shotBox.max.z : shotBox.min.z)
          .applyMatrix4(o.matrixWorld).applyMatrix4(camera.matrixWorldInverse);
        x0 = Math.min(x0, shotCorner.x); x1 = Math.max(x1, shotCorner.x);
        y0 = Math.min(y0, shotCorner.y); y1 = Math.max(y1, shotCorner.y);
      }
    }
    for (const c of o.children) walk(c);
  };
  walk(building.group);
  if (!Number.isFinite(x0)) { x0 = -VIEW_SPAN.w / 2; x1 = VIEW_SPAN.w / 2; y0 = -VIEW_SPAN.h / 2; y1 = VIEW_SPAN.h / 2; }
  const fh = Math.max((y1 - y0) / box.h, (x1 - x0) / (box.w * aspect)), fw = fh * aspect;
  camera.left = (x0 + x1) / 2 - (box.x + box.w / 2) * fw;
  camera.right = camera.left + fw;
  camera.top = (y0 + y1) / 2 + (box.y + box.h / 2) * fh;
  camera.bottom = camera.top - fh;
  camera.updateProjectionMatrix();
}

// ---------- loop ----------

function updateCursorGround() {
  if (pinCursor || !cursor.active || !building) return;
  raycaster.setFromCamera(pointer, camera);
  groundPlane.constant = -building.activeY;
  if (raycaster.ray.intersectPlane(groundPlane, tmp)) { cursor.x = tmp.x; cursor.z = tmp.z; } else cursor.active = false;
}

const focusV = new THREE.Vector3();

let lastDraw = 0;

function frameBudget() {
  if (WALLPAPER) return WALLPAPER_FRAME_MS;
  return busy ? OFFICE_FRAME_MS : IDLE_FRAME_MS;
}

// Ask for one frame. The paced loop is already spinning; Eco arms a single rAF and
// re-arms it only while something on screen is still moving.
function requestDraw() {
  wake = true;
  if (!lowPower || ecoPending || !renderer) return;
  ecoPending = true;
  requestAnimationFrame(ecoFrame);
}

function ecoFrame(t) {
  ecoPending = false;
  frame(t);
  if (document.hidden || canvasOffscreen()) return;
  if (ecoBusy()) requestDraw();
}

// True only while a spring, floor change, retire, or a pending wall redraw still needs pixels.
// A resting cursor, a working bot, and a pulsing ring do not count: those loops are off in Eco.
function ecoBusy() {
  if (effects.length) return true;
  if (!cam.x.settled || !cam.y.settled || !cam.z.settled || !cam.zoom.settled) return true;
  if (building) {
    if (building.pulseT >= 0 || building.introDrop) return true;
    if (!building.cabinY.settled || !building.shaftTop.settled || !building.roofLift.settled) return true;
    for (const s of building.slots) if (!s.lift.settled) return true;
    const walls = building.activeOpen()?.walls;
    if (walls?.dirty) return true;
  }
  for (const a of actors.values()) {
    if (a.anim || a.fx) return true;
    if (!a.yawS.settled || !a.scaleS.settled || !a.eyeX.settled || !a.eyeY.settled) return true;
  }
  for (const a of retiring) if (!a.dead && !a.scaleS.settled) return true;
  return false;
}

function motionActive() {
  if (!cam.x.settled || !cam.y.settled || !cam.z.settled || !cam.zoom.settled) return true;
  if (cursor.active || drag) return true;
  if (building) {
    if (building.pulseT >= 0 || building.introDrop) return true;
    if (!building.cabinY.settled || !building.shaftTop.settled || !building.roofLift.settled) return true;
    for (const s of building.slots) if (!s.lift.settled) return true;
  }
  for (const a of actors.values()) {
    if (a.anim || a.fx) return true;
    if (!a.yawS.settled || !a.scaleS.settled || !a.eyeX.settled || !a.eyeY.settled) return true;
  }
  return retiring.size > 0;
}

function livelyActors() {
  for (const a of actors.values()) {
    const s = a.status;
    if (s === 'working' || s === 'error' || s === 'stuck' || s === 'waiting_user') return true;
  }
  return false;
}

function canvasOffscreen() {
  if (!container) return false;
  const r = container.getBoundingClientRect();
  return r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= innerHeight;
}

function frame(t) {
  powerStats.ticks++;
  if (document.hidden || canvasOffscreen()) { powerStats.skipped++; clock.getDelta(); return; }   // hidden tab, or the canvas is not on screen
  const budget = frameBudget();
  if (!wake && t - lastDraw < budget - 2) { powerStats.skipped++; return; }
  lastDraw = t;
  wake = false;
  const dt = frozen ? 0 : Math.min(clock.getDelta(), 0.05);
  if (frozen) clock.getDelta();
  nowSec = clock.elapsedTime;
  const nowMs = performance.now();

  daylight.update(dt, nowMs);
  stepCamera(dt);
  if (building) building.update(dt, nowMs);
  if (pointerDirty && !drag?.panning) { pointerDirty = false; setHover(pick()); }
  updateCursorGround();

  const hostAlpha = building?.activeOpen()?.alpha ?? 1;
  for (const a of actors.values()) { a.hostAlpha = hostAlpha; a.tick(dt, nowSec); }
  for (const a of retiring) {
    a.hostAlpha = a.ctx.inst.alpha;
    a.tick(dt, nowSec);
    if (a.dead) retiring.delete(a);
  }
  stepEffects(dt);

  const moving = motionActive();
  busy = moving || livelyActors();
  const t0 = performance.now();
  if (post) {
    post.setHoldAura(!moving);
    focusV.set(0, (building ? building.cabinY.x : 0) + 0.7, 0).project(camera);
    post.render(clamp(focusV.y * 0.5 + 0.5, 0, 1), dt, clamp(1.5 / camera.zoom, 0.25, 1));
    if (post.rebuiltAura) powerStats.auraBuilds++;
  } else renderer.render(scene, camera);
  powerStats.renderMs += performance.now() - t0;
  powerStats.presented++;
  if (!WALLPAPER || WALLPAPER_TAGS) labels.render(scene, camera);
}
