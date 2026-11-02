import test from 'node:test';
import assert from 'node:assert/strict';
import { StateStore } from './lib/state.js';
import { createFeedCatalog, routineRows } from './feed.js';

function office() {
  const store = new StateStore({ now: () => Date.parse('2026-11-02T12:00:00Z') });
  const routines = new Map();
  const catalog = createFeedCatalog(store, routines);
  const feed = (rec, time) => {
    const kind = catalog.ingest(rec, { time, iso: new Date(time * 1000).toISOString(), replay: true });
    if (kind === 'activity') store.apply({ ...rec, t: new Date(time * 1000).toISOString() }, { replay: true });
    return kind;
  };
  const snap = () => { store.commit(); return store.snapshot(); };
  return { store, routines, catalog, feed, snap };
}

test('the newest roster drops bots missing from it, and their empty floor', () => {
  const { feed, snap, catalog, routines } = office();
  feed({ bot: 'Mario Motta', status: 'working', step: 'sim run' }, 1_000);
  feed({ bot: 'Ada', status: 'working', step: 'writing' }, 1_001);
  feed({ bot: 'Mario Motta', status: 'done', step: 'sim sent' }, 1_002);
  feed({ groups: { 'Mario Motta': 'SIMULADORES', Ada: 'Ops' } }, 1_010);
  feed({ looks: { 'Mario Motta': { shape: 'pill', color: '#112233', accessory: 'stem' }, Ada: { shape: 'sphere', color: '#445566', accessory: 'none' } } }, 1_010);
  feed({ chat: { 'Mario Motta': 'grokbot://app/v1/agent?id=aaa', Ada: 'https://example.com/ada' } }, 1_010);
  feed({ routines: { bot: 'Mario Motta', items: [{ name: 'Nightly', schedule: 'daily' }] } }, 1_011);
  feed({ routines: { bot: 'Ada', items: [{ name: 'Standup', schedule: 'daily 09:00' }] } }, 1_011);

  let st = snap();
  assert.equal(st.bots['mario-motta'].status, 'done');
  assert.ok(st.floors.some((f) => f.name === 'SIMULADORES' && f.bots.length === 1));

  // A later roster no longer lists Mario. His status, look, chat, routine and floor go with him.
  feed({ roster: ['Ada'] }, 2_000);
  st = snap();
  assert.equal(st.bots['mario-motta'], undefined);
  assert.equal(st.bots.ada.status, 'working');
  assert.equal(st.bots.ada.step, 'writing');
  assert.equal(st.bots.ada.look.color, '#445566');
  assert.equal(st.bots.ada.chat_url, 'https://example.com/ada');
  assert.ok(st.floors.every((f) => f.bots.length > 0));
  assert.equal(st.floors.some((f) => f.name === 'SIMULADORES'), false);
  assert.deepEqual(routineRows(routines).map((r) => r.name), ['Ada']);
  assert.equal(catalog.blocks('Mario Motta'), true);
  assert.equal(catalog.blocks('Ada'), false);

  // A status line from the removed bot does not bring him or the floor back.
  assert.equal(feed({ bot: 'Mario Motta', status: 'working', step: 'still here' }, 2_010), 'drop');
  st = snap();
  assert.equal(st.bots['mario-motta'], undefined);
  assert.equal(st.floors.some((f) => f.name === 'SIMULADORES'), false);
  assert.equal(st.feed.some((f) => f.name === 'Mario Motta'), false);
});

test('a new groups burst replaces the floor map; parts of one burst combine', () => {
  const { feed, snap } = office();
  feed({ roster: ['Ada', 'Bea', 'Cam'] }, 1_000);
  feed({ groups: { Ada: 'SIMULADORES' } }, 1_000);
  feed({ groups: { Bea: 'Ops', Cam: 'Ops' } }, 1_001);
  let st = snap();
  assert.deepEqual(st.floors.map((f) => f.name).sort(), ['Ops', 'SIMULADORES']);
  assert.equal(st.bots.ada.floor, st.floors.find((f) => f.name === 'SIMULADORES').id);

  // A later publish, still split the way looks and chat are, names a different map.
  feed({ groups: { Ada: 'Tools' } }, 5_000);
  feed({ groups: { Bea: 'Tools', Cam: 'Lab' } }, 5_001);
  st = snap();
  assert.deepEqual(st.floors.map((f) => f.name).sort(), ['Lab', 'Tools']);
  assert.equal(st.floors.find((f) => f.name === 'Tools').bots.length, 2);
  assert.equal(st.floors.some((f) => f.name === 'SIMULADORES'), false);
  assert.ok(st.floors.every((f) => f.bots.length > 0));
});

test('bots left off the new groups map leave their old floor', () => {
  const { feed, snap } = office();
  feed({ roster: ['Ada', 'Mario Motta'] }, 1_000);
  feed({ bot: 'Mario Motta', status: 'idle', step: '' }, 1_000);
  feed({ groups: { 'Mario Motta': 'SIMULADORES', Ada: 'Ops' } }, 1_000);
  feed({ groups: { Ada: 'Ops' } }, 8_000);
  const st = snap();
  assert.ok(st.bots['mario-motta']);
  assert.equal(st.floors.some((f) => f.name === 'SIMULADORES'), false);
  assert.equal(st.floors.find((f) => f.bots.includes('mario-motta')).name, 'Main floor');
  assert.equal(st.floors.find((f) => f.bots.includes('ada')).name, 'Ops');
});
