import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRoutineMessage, routineRows } from './feed.js';

test('routine messages merge per bot and keep schedule-only items', () => {
  const map = new Map();
  assert.equal(applyRoutineMessage(map, { routines: { bot: 'Alpha', items: [
    { name: 'Morning', schedule: 'daily 09:00', next_run: '2026-11-03T09:00:00Z' },
    { name: 'No time', schedule: 'when mail arrives' },
  ] } }), true);
  assert.equal(applyRoutineMessage(map, { routines: { bot: 'Beta', items: [
    { name: 'Watch', schedule: '~15 runs/week', next_run: '2026-11-04T09:00:00Z' },
  ] } }), true);
  assert.equal(applyRoutineMessage(map, { routines: { bot: 'Gamma', items: [
    { name: 'Inbox', schedule: 'when mail arrives' },
  ] } }), true);
  // A later list from Alpha replaces Alpha only.
  assert.equal(applyRoutineMessage(map, { routines: { bot: 'Alpha', items: [
    { name: 'Morning', schedule: 'daily 08:00' },
  ] } }), true);

  const rows = routineRows(map);
  assert.deepEqual(rows.map((r) => `${r.name}:${r.routine}`), [
    'Beta:Watch',
    'Alpha:Morning',
    'Gamma:Inbox',
  ]);
  assert.equal(rows.find((r) => r.routine === 'Inbox').next_run, null);
  assert.equal(rows.find((r) => r.routine === 'Inbox').schedule, 'when mail arrives');
  assert.equal(rows.find((r) => r.routine === 'Morning').schedule, 'daily 08:00');
  assert.equal(map.size, 3);
});
