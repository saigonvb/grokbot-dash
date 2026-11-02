// The bytes under web/vendor/three were copied from the official npm tarball three@0.170.0
// (registry.npmjs.org/three/-/three-0.170.0.tgz). Its sha512 is recorded in INTEGRITY.json and was
// checked against `npm view three@0.170.0 dist.integrity` when the files were vendored. This test
// re-hashes those files so a later edit cannot drift from that package.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), 'three');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'INTEGRITY.json'), 'utf8'));

test('vendored three@0.170.0 matches the recorded npm package hashes', () => {
  assert.equal(manifest.name, 'three');
  assert.equal(manifest.version, '0.170.0');
  assert.equal(manifest.integrity, 'sha512-FQK+LEpYc0fBD+J8g6oSEyyNzjp+Q7Ks1C568WWaoMRLW+TkNNWmenWeGgJjV105Gd+p/2ql1ZcjYvNiPZBhuQ==');
  assert.equal(manifest.shasum, '6087f97aab79e9e9312f9c89fcef6808642dfbb7');
  assert.ok(fs.existsSync(path.join(root, 'LICENSE')));
  for (const [rel, digest] of Object.entries(manifest.files)) {
    const data = fs.readFileSync(path.join(root, rel));
    const got = 'sha256-' + crypto.createHash('sha256').update(data).digest('hex');
    assert.equal(got, digest, rel);
  }
});
