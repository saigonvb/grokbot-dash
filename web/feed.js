// Bots-only mode: the office reads the user's bots from one feed server. No server of ours, no tunnel.
// The link is …/#<topic>, optionally &ntfy=<https server> and &auth=<ntfy access token>. Both extra
// values live in the fragment, so the site that served this page never receives them. The token is
// sent only on requests to that feed server. The same reducer the local server uses (lib/state.js)
// turns the lines into the office's state. The server keeps 12 hours, so the newest lines are cached
// per topic in localStorage and replayed first: after a quiet night the office is not empty.
//
// Lines on the channel (one JSON object per message, at most 4 KB, anything else is dropped):
//   {"bot":"…","status":"working|idle|waiting_user|error|done","step":"…"}     a status change
//   {"roster":["Bot A","Bot B"]}                                                the newest roster is the whole cast
//   {"looks":{"Bot A":{"shape":"sphere","color":"#RRGGBB","accessory":"none"}}} how each bot's blob looks
//   {"type":"usage","total_used_pct":37,"resets_at":"…","bots":{"Bot A":4.1}}  the weekly limit meter
//   {"groups":{"Bot A":"Content"}}                                            teams, one floor each; the newest batch wins
//   {"chat":{"Bot A":"grokbot://app/v1/agent?id=…"}}                         each bot's chat, for «Open chat»
//   {"routines":{"bot":"Bot A","items":[{"name":"…","schedule":"…","next_run":"ISO"}]}}   a bot's routines
// The publisher posts roster, then looks, groups and chat as one burst (parts 0–1 s apart). Looks and chat
// are split into several messages when one would pass ~4000 characters; groups are one message until they
// need the same split. A roster replaces the cast. A groups burst replaces the floor map. Later parts of
// the same burst are merged with it, not treated as a new map.
// On top of the server's state the office gets state.finished (done lines of the last 24 h, newest first) and
// state.routines (every bot's routines, soonest first), for the «Finished» and «Routines» panels.
import { StateStore, botIdFor, safeChatUrl } from './lib/state.js';
import { parseFeedHash, ntfyAuthUrl, DEFAULT_FEED_SERVER } from './lib/feed-url.js';

const MAX_LINE = 4096, KEEP = 600, TICK_MS = 30e3, DAY_MS = 24 * 3600e3;
const HANDMADE = new Set(['grok-bot', 'jevopus', 'x-writer', 'banner-visuals', 'analytics-analyst', 'competitor-watch', 'qt-scout',
  'ideas-sparring', 'bookmarks-brain', 'codila-x-researcher', 'trendy-x', 'substack', 'x-ads-manager', 'warren-buffett', 'finance-team']);   // assets/blobs/<id>.glb

/** `#<topic>` and the optional `&ntfy=` / `&auth=` fragment params. Null if the link is not a feed. */
export function feedFromHash(hash) {
  return parseFeedHash(hash);
}

/** Rebuild from cache + the server's last 12 h, then follow it live. Calls onState(state) on every change. */
export async function connectFeed({ topic, server, auth }, onState) {
  const base = `${server}/${encodeURIComponent(topic)}`;
  const cacheKey = `bothq.feed.${server}.${topic}`;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Sofia';
  const store = new StateStore({ tz, hasAvatar: (id) => HANDMADE.has(id) });   // others get a generated blob, no 404 probe
  const routines = new Map();                            // bot id -> { name, items }
  const catalog = createFeedCatalog(store, routines);
  let lines = [], saveTimer = 0, lastId = null;
  const seen = new Set();

  lines = cached(cacheKey);
  if (!lines.length && server === DEFAULT_FEED_SERVER) {
    // local cache from older builds. Read here only; nothing is fetched from anywhere but `server`.
    lines = cached(`bothq.feed.${DEFAULT_FEED_SERVER}.${topic}`);
    if (!lines.length) lines = cached(`bothq.feed.${topic}`);
  }
  try {
    const text = await (await pull(`${base}/json?poll=1&since=12h`)).text();
    for (const row of text.split('\n')) if (row) keep(JSON.parse(row));
  } catch { /* offline or down: the cache still shows the office */ }
  lines = lines.filter(fresh).sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : 1));
  for (const l of lines) ingest(l, true);
  lastId = lines.length ? lines[lines.length - 1].id : null;
  save();
  publish();

  follow();
  setInterval(() => { const v = store.version, s = store.snapshot(); if (store.version !== v) onState(extras(s)); }, TICK_MS);

  function pull(url) {
    return fetch(ntfyAuthUrl(url, auth), { cache: 'no-store', referrerPolicy: 'no-referrer' });
  }
  function cached(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
  }
  function fresh(l) {
    const a = `${l.id}`, b = `${l.time} ${l.message}`;
    if (seen.has(a) || seen.has(b)) return false;
    seen.add(a);
    seen.add(b);
    return true;
  }
  function keep(m) {                                     // a message of a history request, into `lines`
    if (m?.event === 'message' && typeof m.id === 'string') lines.push({ id: m.id, time: Number(m.time) || 0, message: m.message });
  }
  function take(m) {                                     // a live message: new -> ingest; true if the office changed
    if (m?.event !== 'message' || typeof m.id !== 'string') return false;
    lastId = m.id;
    const l = { id: m.id, time: Number(m.time) || Date.now() / 1000, message: m.message };
    if (!fresh(l)) return false;
    lines.push(l);
    if (lines.length > KEEP * 1.5) lines = lines.slice(-KEEP);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 2000);
    return ingest(l, false);
  }
  function follow() {
    const live = new EventSource(ntfyAuthUrl(`${base}/sse`, auth));
    live.onopen = () => catchUp();                       // also after a reconnect: fetch what was missed
    live.onmessage = (e) => { try { if (take(JSON.parse(e.data))) publish(); } catch { /* keepalive or junk */ } };
  }
  async function catchUp() {
    try {
      const text = await (await pull(`${base}/json?poll=1&since=${lastId ?? '12h'}`)).text();
      let changed = false;
      for (const row of text.split('\n')) if (row && take(JSON.parse(row))) changed = true;
      if (changed) publish();
    } catch { /* the stream retries by itself */ }
  }
  function ingest({ message, time }, replay) {
    if (typeof message !== 'string' || message.length > MAX_LINE) return false;
    let rec;
    try { rec = JSON.parse(message); } catch { return false; }
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return false;
    const t = typeof rec.t === 'string' ? rec.t : new Date(time * 1000).toISOString();
    const kind = catalog.ingest(rec, { time: Number(time) || 0, iso: t, replay });
    if (kind === 'drop') return false;
    if (kind === 'catalog') return true;
    store.apply({ ...rec, t }, { replay });
    return true;
  }
  function extras(s) {                                   // the panels' data on top of the server-shaped state
    const since = Date.now() - DAY_MS, finished = [];
    for (let i = lines.length - 1; i >= 0 && finished.length < 100; i--) {
      const l = lines[i];
      if (l.time * 1000 < since) break;
      if (typeof l.message !== 'string' || l.message.length > MAX_LINE || !l.message.includes('"done"')) continue;
      let rec;
      try { rec = JSON.parse(l.message); } catch { continue; }
      if (rec?.status !== 'done' || typeof rec.bot !== 'string' || catalog.blocks(rec.bot)) continue;
      finished.push({ t: typeof rec.t === 'string' ? rec.t : new Date(l.time * 1000).toISOString(), bot: botIdFor(rec.bot), name: rec.bot.slice(0, 80), step: String(rec.step ?? '').slice(0, 80) });
    }
    s.finished = finished;
    s.routines = routineRows(routines);
    return s;
  }
  function publish() { store.commit(); onState(extras(store.snapshot())); }
  function save() { try { localStorage.setItem(cacheKey, JSON.stringify(lines.slice(-KEEP))); } catch { /* private mode: not cached */ } }
}

function isMap(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

// Parts of one publish burst land 0 or 1 second apart (looks/chat split near 4000 characters).
// A groups message more than this many seconds after the burst started is a new map, not another part.
const GROUP_BATCH_SEC = 2;

/**
 * Roster, looks, groups, chat and routines. The newest roster is the whole cast: bots left off it
 * lose their status, look, chat, floor and routines. The newest groups burst replaces every floor
 * assignment; messages inside the burst are combined first, so a map split across posts is kept whole.
 * Looks and chat keep merging per bot (a later value wins) and are dropped with the bot.
 */
export function createFeedCatalog(store, routines) {
  const cfg = {};
  let rosterIds = null;
  let groupsStart = -Infinity;

  function inRoster(name) {
    return rosterIds === null || rosterIds.has(botIdFor(name));
  }

  function pushConfig() {
    store.setBotsConfig(cfg);
    store.pruneEmptyFloors();
  }

  function applyRoster(rec, iso, replay) {
    const names = [];
    const ids = new Set();
    for (const name of rec.roster) {
      if (names.length >= 400) break;
      if (typeof name !== 'string' || !name.trim()) continue;
      const trimmed = name.trim();
      names.push(trimmed);
      ids.add(botIdFor(trimmed));
    }
    rosterIds = ids;
    for (const name of names) {
      if (!store.bots.has(botIdFor(name))) store.apply({ t: iso, bot: name, status: 'idle', step: '' }, { replay });
    }
    for (const id of [...store.bots.keys()]) if (!ids.has(id)) store.removeBot(id);
    for (const name of Object.keys(cfg)) if (!ids.has(botIdFor(name))) delete cfg[name];
    for (const id of [...routines.keys()]) if (!ids.has(id)) routines.delete(id);
    pushConfig();
  }

  function applyGroups(rec, timeSec) {
    const inBatch = Number.isFinite(groupsStart) && timeSec >= groupsStart && timeSec - groupsStart <= GROUP_BATCH_SEC;
    if (!inBatch) {
      for (const entry of Object.values(cfg)) delete entry.floor;
      for (const bot of store.bots.values()) bot.group = null;
      groupsStart = timeSec;
    }
    for (const [name, team] of Object.entries(rec.groups).slice(0, 400)) {
      if (!inRoster(name) || typeof team !== 'string' || !team.trim()) continue;
      const floor = team.trim().slice(0, 40);
      (cfg[name] ||= {}).floor = floor;
      const bot = store.bots.get(botIdFor(name));
      if (bot) bot.group = floor;
    }
    pushConfig();
  }

  return {
    /** A bot left off the newest roster. Before any roster, nothing is blocked. */
    blocks(name) {
      return rosterIds !== null && !rosterIds.has(botIdFor(name));
    },
    /**
     * @returns {'catalog'|'activity'|'drop'}
     */
    ingest(rec, { time = 0, iso, replay = false } = {}) {
      if (Array.isArray(rec.roster)) { applyRoster(rec, iso, replay); return 'catalog'; }
      if (isMap(rec.looks)) {
        for (const [name, look] of Object.entries(rec.looks).slice(0, 400)) {
          if (inRoster(name)) (cfg[name] ||= {}).look = look;
        }
        pushConfig();
        return 'catalog';
      }
      if (isMap(rec.groups)) { applyGroups(rec, time); return 'catalog'; }
      if (isMap(rec.chat)) {
        for (const [name, url] of Object.entries(rec.chat).slice(0, 400)) {
          if (!inRoster(name)) continue;
          const safe = safeChatUrl(url);
          if (safe) (cfg[name] ||= {}).chat_url = safe;
        }
        pushConfig();
        return 'catalog';
      }
      if (applyRoutineMessage(routines, rec)) {
        if (rosterIds) for (const id of [...routines.keys()]) if (!rosterIds.has(id)) routines.delete(id);
        return 'catalog';
      }
      if (typeof rec.type === 'string' && rec.type.toLowerCase() === 'usage') return 'activity';
      if (typeof rec.bot === 'string' && this.blocks(rec.bot)) return 'drop';
      return 'activity';
    },
  };
}

/** One bot's latest list replaces that bot only. Other bots' messages stay. Items may have a schedule and no next_run. */
export function applyRoutineMessage(routines, rec) {
  if (!isMap(rec) || !isMap(rec.routines)) return false;
  const name = typeof rec.routines.bot === 'string' ? rec.routines.bot.trim().slice(0, 80) : '';
  if (!name || !Array.isArray(rec.routines.items)) return false;
  const items = rec.routines.items.slice(0, 50).filter(isMap).map((r) => ({
    routine: String(r.name ?? '').slice(0, 80), schedule: String(r.schedule ?? '').slice(0, 80),
    next_run: Number.isFinite(Date.parse(r.next_run)) ? new Date(r.next_run).toISOString() : null,
  })).filter((r) => r.routine);
  routines.set(botIdFor(name), { name, items });
  return true;
}

export function routineRows(routines) {
  return [...routines].flatMap(([bot, { name, items }]) => items.map((r) => ({ bot, name, ...r })))
    .sort((a, b) => (a.next_run ? Date.parse(a.next_run) : Infinity) - (b.next_run ? Date.parse(b.next_run) : Infinity));
}
