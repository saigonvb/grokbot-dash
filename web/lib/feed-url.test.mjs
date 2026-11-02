import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseFeedHash, ntfyAuthUrl, DEFAULT_FEED_SERVER } from './feed-url.js';

const TOPIC = 'gbw-abc123xyz';

test('a plain topic reads only the default feed server and carries no token', () => {
  const spec = parseFeedHash(`#${TOPIC}`);
  assert.deepEqual(spec, { topic: TOPIC, server: DEFAULT_FEED_SERVER, auth: '', explicitServer: false });
  assert.equal(spec.server, 'https://ntfy.sh');
});

test('&ntfy= and &auth= stay on the named server', () => {
  const spec = parseFeedHash(`#${TOPIC}&auth=tk_abcDEF123&ntfy=${encodeURIComponent('https://ntfy.example.com/base/')}`);
  assert.equal(spec.topic, TOPIC);
  assert.equal(spec.server, 'https://ntfy.example.com/base');
  assert.equal(spec.auth, 'tk_abcDEF123');
  assert.equal(spec.explicitServer, true);
  const url = new URL(ntfyAuthUrl(`${spec.server}/${spec.topic}/json?poll=1&since=12h`, spec.auth));
  assert.equal(url.origin, 'https://ntfy.example.com');
  assert.equal(url.pathname, `/base/${TOPIC}/json`);
  assert.equal(Buffer.from(url.searchParams.get('auth'), 'base64').toString(), 'Bearer tk_abcDEF123');
  assert.equal(url.searchParams.get('poll'), '1');
});

test('http is only localhost, and a bad server or token does not fall through', () => {
  assert.equal(parseFeedHash(`#${TOPIC}&ntfy=${encodeURIComponent('http://evil.example')}`), null);
  assert.equal(parseFeedHash(`#${TOPIC}&ntfy=${encodeURIComponent('javascript:alert(1)')}`), null);
  assert.equal(parseFeedHash(`#${TOPIC}&auth=tk_bad token`), null);
  assert.equal(parseFeedHash(`#${TOPIC}&ntfy=${encodeURIComponent('https://user:secret@ntfy.example')}`), null);
  const local = parseFeedHash(`#${TOPIC}&ntfy=${encodeURIComponent('http://127.0.0.1:8787/ntfy/')}`);
  assert.equal(local.server, 'http://127.0.0.1:8787/ntfy');
  assert.equal(ntfyAuthUrl('https://ntfy.sh/t/sse', ''), 'https://ntfy.sh/t/sse');
});

test('the office feed client does not phone home', () => {
  const src = fs.readFileSync(new URL('../feed.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /0xcodila|sendBeacon|relay\.0xcodila|bodila51/);
});
