document.documentElement.classList.add('js');

const live = document.getElementById('live'), stage = live.parentElement;
const DESK = 620;                                          // the narrowest page width the stage's frame renders at
let scale = 1, cursor = null, queued = false;
function fit() {
  scale = Math.min(1, stage.clientWidth / DESK);
  stage.style.setProperty('--s', scale.toFixed(4));
}
fit();
new ResizeObserver(fit).observe(stage);

// The close-up renders the wallpaper at a desktop size and is moved and scaled so the top of the bot, with its eyes,
// fills the tile. Where the bot is comes from the wallpaper itself (its .bot), so a new design still lands right.
// The scale comes from the height: the box always shows the top of the ball down past both eyes (0.38 of the ball's
// width), whole, however wide the tile is. A wide tile shows more sky beside the ball, so the frame is made wide
// enough to fill it (the ball's size is capped by the frame's height, so a wider frame does not grow the ball).
// There are two close-ups (the eyes tile and the support tile); each keeps its own frame width and scale.
const VH = 900;
const closeups = [...document.querySelectorAll('iframe[data-closeup]')].map((el) => ({ el, vw: 1440, s: 1 }));
function crop(c) {
  const box = c.el.parentElement, bw0 = box.clientWidth, bh0 = box.clientHeight;
  if (!bw0 || !bh0) return;
  let bot = null, bw = 986;
  for (let i = 0; i < 4; i++) {
    c.el.style.width = c.vw + 'px';
    c.el.style.height = VH + 'px';
    try { bot = c.el.contentDocument.querySelector('.bot')?.getBoundingClientRect() || null; } catch { bot = null; }
    bw = bot?.width || Math.min(c.vw * 0.6845, VH * 1.217);
    c.s = bh0 / (bw * 0.38);
    const need = Math.max(1440, Math.ceil(bw0 / c.s) + 2);
    if (need === c.vw) break;
    c.vw = need;
  }
  const cx = bot ? bot.left + bot.width / 2 : c.vw / 2, top = bot ? bot.top : VH - bw * 0.45;
  const x = cx - bw0 / c.s / 2, y = top - bw * 0.03;
  c.el.style.transform = `translate(${-x * c.s}px, ${-y * c.s}px) scale(${c.s})`;
}
for (const c of closeups) {
  c.el.addEventListener('load', () => { crop(c); setTimeout(() => crop(c), 600); });
  new ResizeObserver(() => crop(c)).observe(c.el.parentElement);
}

// Light or dark words over the stage: take the first colour of the wallpaper's own background (its top) and check
// how bright it is. If anything about it can't be read, the words stay dark.
function tone() {
  try {
    const d = live.contentDocument, cs = d && d.body && getComputedStyle(d.body);
    if (!cs) return;
    const css = cs.backgroundImage !== 'none' ? cs.backgroundImage : cs.backgroundColor;
    const m = css.match(/rgba?\(([^)]+)\)/);
    if (!m) return;
    const [r, g, b] = m[1].split(',').map(parseFloat);
    live.closest('.hero').classList.toggle('on-dark', (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5);
  } catch {}
}
live.addEventListener('load', tone);
tone();

// The bot looks at the cursor anywhere on this page, not only over its frame: moves outside a frame are passed in
// (same origin) in the frame's own coordinates, so the stage and every close-up turn their eyes to it.
function pass() {
  queued = false;
  if (!cursor) return;
  for (const [frame, s] of [[live, scale], ...closeups.map((c) => [c.el, c.s])]) {
    const w = frame.contentWindow;
    if (!w || !w.PointerEvent) continue;
    const r = frame.getBoundingClientRect();
    if (r.bottom < -200 || r.top > innerHeight + 200) continue;      // out of sight: nothing to look at
    w.dispatchEvent(new w.PointerEvent('pointermove', { clientX: (cursor.x - r.left) / s, clientY: (cursor.y - r.top) / s, pointerType: 'mouse' }));
  }
}
function queue() { if (!queued) { queued = true; requestAnimationFrame(pass); } }
addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') { cursor = { x: e.clientX, y: e.clientY }; queue(); } }, { passive: true });
addEventListener('scroll', () => { if (cursor) queue(); }, { passive: true });

// "Try it full screen": the live frame itself goes full screen (Esc comes back); where it can't, open the page.
document.querySelectorAll('[data-fullscreen]').forEach((a) => a.addEventListener('click', (e) => {
  if (!document.fullscreenEnabled || !live.requestFullscreen) return;
  e.preventDefault();
  live.requestFullscreen().catch(() => { location.href = a.href; });
}));

// Copy link: the label blurs into "Copied" and back, so the change reads as one button changing its mind.
const LINK = new URL('face/', location.href).href;
document.getElementById('wall-base').textContent = LINK;
const calm = matchMedia('(prefers-reduced-motion: reduce)');
function relabel(label, text) {
  if (calm.matches || !label.animate) { label.textContent = text; return; }
  label.animate([{ opacity: 1, filter: 'blur(0)' }, { opacity: 0, filter: 'blur(2px)' }], { duration: 110, easing: 'ease-out' })
    .finished.then(() => {
      label.textContent = text;
      label.animate([{ opacity: 0, filter: 'blur(2px)' }, { opacity: 1, filter: 'blur(0)' }], { duration: 180, easing: 'ease-out' });
    });
}
// Copies text, falling back to selecting the element it shows in; the button says Copied for a moment.
async function copyFrom(btn, text, shownIn) {
  try { await navigator.clipboard.writeText(text); }
  catch { getSelection().selectAllChildren(shownIn); document.execCommand('copy'); }
  const label = btn.firstElementChild, back = btn.dataset.label || (btn.dataset.label = label.textContent);
  relabel(label, 'Copied');
  clearTimeout(btn.t); btn.t = setTimeout(() => relabel(label, back), 1800);
}
const copy = document.getElementById('copy');
copy.addEventListener('click', () => copyFrom(copy, currentLink(), document.getElementById('wall-url')));

// White or black Grok Bot: the visitor's pick. The wallpaper itself remembers it (gbw.bot, this site's storage), so the
// bots on this page, full screen and a new tab all follow; the frames already open change at once through the
// wallpaper's own grokBot.setBot, behind a short blur so the swap reads as one ball changing. Lively runs the
// wallpaper from another site, so its links carry the pick as ?bot=black.
const picks = [...document.querySelectorAll('.pick')];
// A shared link can pick it too: ?bot=black or ?bot=white.
let botColor = (() => {
  const asked = new URLSearchParams(location.search).get('bot');
  if (asked === 'black' || asked === 'white') return asked;
  try { return localStorage.getItem('gbw.bot') === 'black' ? 'black' : 'white'; } catch { return 'white'; }
})();
function currentLink() { return LINK + (botColor === 'black' ? '?bot=black' : ''); }
function showBot(color, animate) {
  botColor = color;
  live.closest('.hero').dataset.bot = color;
  for (const p of picks) {
    p.dataset.bot = color;
    p.querySelectorAll('[data-pick]').forEach((b) => { const on = b.dataset.pick === color; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
  }
  document.querySelectorAll('[data-suffix]').forEach((el) => { el.textContent = color === 'black' ? `${el.dataset.suffix}bot=black` : ''; });
  try { localStorage.setItem('gbw.bot', color); } catch {}
  document.dispatchEvent(new Event('bot-color'));
  for (const f of [live, ...closeups.map((c) => c.el)]) {
    const swap = () => { try { f.contentWindow?.grokBot?.setBot(color); } catch {} };
    if (!animate || calm.matches || !f.animate) { swap(); continue; }
    f.animate([{ filter: 'blur(0px)', opacity: 1 }, { filter: 'blur(8px)', opacity: 0.6 }], { duration: 140, easing: 'ease-out' }).finished.then(() => {
      swap();
      f.animate([{ filter: 'blur(8px)', opacity: 0.6 }, { filter: 'blur(0px)', opacity: 1 }], { duration: 280, easing: 'cubic-bezier(.23, 1, .32, 1)' });
    });
  }
}
showBot(botColor, false);
for (const p of picks) {
  p.addEventListener('click', (e) => { const b = e.target.closest('[data-pick]'); if (b && b.dataset.pick !== botColor) showBot(b.dataset.pick, true); });
  p.addEventListener('keydown', (e) => {                  // a radio group: the arrows move the pick
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    showBot(botColor === 'white' ? 'black' : 'white', true);
    p.querySelector(`[data-pick="${botColor}"]`).focus();
  });
}

// Connect your Grok Bot. The setup prompt is PROMPT.md, the repo's own file, shown as it is (its first fenced block, if
// it has one, is the prompt itself). Grok Bot makes the topic and replies with the links; the visitor pastes the topic or
// either link into Open my dashboard, which counts the bots seen on the topic in the last 12 hours (status lines and the
// roster line) and opens their office and wallpaper (both take the topic after #). The topic is kept in this browser only.
const promptBox = document.getElementById('prompt');
fetch('PROMPT.md', { cache: 'no-cache' }).then((r) => (r.ok ? r.text() : Promise.reject(r.status))).then((md) => {
  const fenced = md.match(/```[^\n]*\n([\s\S]*?)```/);
  promptBox.textContent = (fenced ? fenced[1] : md).trim();
  document.querySelector('[data-copy="prompt"]').disabled = false;
}).catch(() => {
  promptBox.textContent = 'The prompt did not load. It is PROMPT.md next to this page.';
});
document.querySelectorAll('#own [data-copy]').forEach((btn) => btn.addEventListener('click', () => {
  const box = document.getElementById(btn.dataset.copy);
  copyFrom(btn, box.textContent, box);
}));

const KEY = 'gbw.landing-feed';
const dash = document.getElementById('dash'), topicIn = document.getElementById('topic'), seen = document.getElementById('seen');
const openOffice = document.getElementById('open-office'), openWall = document.getElementById('open-wall');
const wallLink = document.getElementById('wall-link'), copyWall = document.querySelector('[data-copy="wall-link"]');
let topic = null, ntfy = null, auth = '', polling = null;
const findTopic = (text) => (String(text).match(/gbw-[A-Za-z0-9_-]{6,}/) || [])[0] || null;
// A self-hosted ntfy rides along as &ntfy=<https server> after the topic. The access token is &auth= in the fragment.
function hashOf(text) {
  const s = String(text);
  const i = s.indexOf('#');
  if (i !== -1) return s.slice(i);
  const topic = findTopic(s);
  if (!topic) return '';
  const ntfy = s.match(/(?:^|[#&?])ntfy=([^&\s#]+)/);
  const token = s.match(/(?:^|[#&?])auth=([^&\s#]+)/);
  if (!ntfy && !token) return `#${topic}`;
  return `#${topic}${ntfy ? `&ntfy=${ntfy[1]}` : ''}${token ? `&auth=${token[1]}` : ''}`;
}
// The topic goes after # (a hash never reaches the site's server); the bot colour is no secret and stays ?bot=black.
function links() {
  let extra = '';
  if (ntfy) extra += `&ntfy=${encodeURIComponent(ntfy)}`;
  if (auth) extra += `&auth=${encodeURIComponent(auth)}`;
  const bot = botColor === 'black' ? '?bot=black' : '';
  openOffice.href = `office/#${topic}${extra}`;
  openWall.href = `face/${bot}#${topic}${extra}`;
  wallLink.textContent = `${LINK}${bot}#${topic}${extra}`;
}
async function count(started) {
  try {
    let url = `${ntfy || 'https://ntfy.sh'}/${encodeURIComponent(topic)}/json?poll=1&since=12h`;
    if (auth) {
      const { ntfyAuthUrl } = await import('./lib/feed-url.js');
      url = ntfyAuthUrl(url, auth);
    }
    const res = await fetch(url, { cache: 'no-store', referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error(res.status);
    const bots = new Set();
    for (const line of (await res.text()).split('\n')) {
      try {
        const m = JSON.parse(line);
        if (m.event !== 'message') continue;
        const b = JSON.parse(m.message);                     // a status line names one bot, a roster line all of them
        if (b && b.bot) bots.add(String(b.bot).slice(0, 40));
        if (b && Array.isArray(b.roster)) b.roster.forEach((n) => n && bots.add(String(n).slice(0, 40)));
      } catch {}
    }
    if (bots.size) {
      seen.dataset.ok = '';
      seen.textContent = `Bots seen: ${bots.size} (${[...bots].slice(0, 4).join(', ')}${bots.size > 4 ? '…' : ''}).`;
    } else {
      delete seen.dataset.ok;
      seen.textContent = 'Bots seen: 0 so far. Once Grok Bot has set them up, they show here within seconds.';
    }
  } catch {
    delete seen.dataset.ok;
    seen.textContent = `Could not reach ${ntfy ? new URL(ntfy).host : 'ntfy.sh'}. Check your internet connection.`;
  }
  if (Date.now() - started > 300000) { clearInterval(polling); polling = null; }   // five minutes, then quiet
}
function useTopic(next, server = null, token = '') {
  if (next === topic && server === ntfy && token === auth) return;
  topic = next;
  ntfy = next ? server : null;
  auth = next ? (token || '') : '';
  clearInterval(polling); polling = null;
  const on = Boolean(topic);
  dash.dataset.state = on ? 'ready' : 'empty';
  [openOffice, openWall].forEach((a) => a.setAttribute('aria-disabled', String(!on)));
  copyWall.disabled = !on;
  wallLink.hidden = !on;
  delete seen.dataset.ok;
  if (!on) { seen.textContent = topicIn.value.trim() ? 'That has no topic in it: look for the part that starts with gbw-.' : ''; return; }
  try {
    localStorage.setItem(KEY, topic);
    if (ntfy) localStorage.setItem(KEY + '.ntfy', ntfy); else localStorage.removeItem(KEY + '.ntfy');
    if (auth) localStorage.setItem(KEY + '.auth', auth); else localStorage.removeItem(KEY + '.auth');
  } catch {}
  links();
  seen.textContent = 'Looking for your bots…';
  const started = Date.now();
  count(started);
  polling = setInterval(() => count(started), 5000);
}
topicIn.addEventListener('input', async () => {
  const text = topicIn.value;
  const hash = hashOf(text);
  if (hash) {
    try {
      const { parseFeedHash } = await import('./lib/feed-url.js');
      const spec = parseFeedHash(hash);
      if (spec) { useTopic(spec.topic, spec.explicitServer ? spec.server : null, spec.auth); return; }
    } catch { /* the checker still accepts a bare topic */ }
    if (/(?:ntfy|auth)=/.test(hash)) {
      useTopic(null);
      seen.textContent = 'That link names a server or a token this page will not use. Check both and try again.';
      return;
    }
  }
  useTopic(findTopic(text), null, '');
});
document.addEventListener('bot-color', () => { if (topic) links(); });
try {
  const kept = localStorage.getItem(KEY), server = localStorage.getItem(KEY + '.ntfy'), token = localStorage.getItem(KEY + '.auth');
  if (kept && findTopic(kept) === kept) {
    topicIn.value = kept + (server ? `&ntfy=${encodeURIComponent(server)}` : '') + (token ? `&auth=${encodeURIComponent(token)}` : '');
    useTopic(kept, server, token || '');
  }
} catch {}

// The desktop recording plays while it is on screen and pauses off it. With reduced motion it waits with its controls.
const desk = document.getElementById('desk');
if (calm.matches) desk.controls = true;
else if ('IntersectionObserver' in window) {
  new IntersectionObserver(([e]) => (e.isIntersecting ? desk.play().catch(() => { desk.controls = true; }) : desk.pause()), { threshold: 0.25 }).observe(desk);
}

// Step 2, shown in a small Lively window, once as it comes into view: the cursor presses Add Wallpaper, the link is
// typed under Enter URL, the arrow sends it, Grok Bot lands in the library and is set. Its targets are measured, not
// placed by hand. Without script or with reduced motion the window shows only that last frame.
const lv = document.getElementById('lv');
if (!calm.matches) {
  lv.dataset.ready = '';
  const cur = document.getElementById('lv-cursor'), text = document.getElementById('lv-text'), out = text.firstElementChild;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const to = (el, fx = 0.5, fy = 0.5) => {
    const w = lv.getBoundingClientRect(), b = el.getBoundingClientRect();
    cur.style.transform = `translate(${b.left - w.left + b.width * fx}px, ${b.top - w.top + b.height * fy}px)`;
    return wait(700);
  };
  const press = async (el) => { cur.dataset.down = el.dataset.down = ''; await wait(140); delete cur.dataset.down; delete el.dataset.down; };
  const play = async () => {
    const w = lv.getBoundingClientRect();
    cur.style.transition = 'none';
    cur.style.transform = `translate(${w.width * 0.62}px, ${w.height * 0.82}px)`;
    cur.offsetWidth;
    cur.style.transition = '';
    await wait(500);
    const add = document.getElementById('lv-add'), field = document.getElementById('lv-field'), go = document.getElementById('lv-go');
    await to(add, 0.3, 0.6); await press(add);
    lv.dataset.open = ''; await wait(450);
    await to(field, 0.3, 0.55); await press(field);
    lv.dataset.focus = '';
    for (const ch of currentLink()) {
      out.textContent += ch;
      if (text.scrollWidth > text.clientWidth) text.dataset.long = '';
      await wait(26);
    }
    await wait(250);
    await to(go); await press(go);
    delete lv.dataset.focus; delete lv.dataset.open;
    await wait(300);
    lv.dataset.added = ''; await wait(550);
    lv.dataset.set = '';
    await to(lv.querySelector('.lv__new .lv__thumb'), 0.7, 0.75);
  };
  const seen = 'IntersectionObserver' in window && new IntersectionObserver(([e]) => {
    if (e.isIntersecting) { seen.disconnect(); setTimeout(play, 500); }
  }, { threshold: 0.5 });
  seen ? seen.observe(lv) : play();
}

// Tiles arrive once as they come into view; without script or with reduced motion they are simply there.
const io = 'IntersectionObserver' in window && new IntersectionObserver((list) => list.forEach((e) => {
  if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
}), { rootMargin: '0px 0px -10% 0px' });
document.querySelectorAll('.rise').forEach((el) => (io ? io.observe(el) : el.classList.add('is-in')));
