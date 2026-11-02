// Assembles the public Grok Bot Wallpaper site into one folder: the landing page at its root, the live wallpaper at
// face/ and the 3D office at office/, with their demo data and the assets both load from ../assets/. The same tree
// goes to GitHub Pages (.github/workflows/pages.yml).
// (rea-home/scripts/deploy.mjs). Only these files go out: no journal, keys, source art, test pages or preview renders.
// A new file the site needs is added here, once, for both sites.
//   node landing/assemble.mjs <out-dir>
import fs from 'node:fs';
import path from 'node:path';

const repo = path.resolve(import.meta.dirname, '..');
const out = path.resolve(process.argv[2] || '_site');
const parts = [
  // [from, to, which files, { deep: also its subfolders, optional: may not exist yet }]
  ['landing', '.', /^(index\.html|icon\.png|og\.png|boot\.js|landing\.js|landing\.css)$/],
  ['landing/fonts', 'fonts', /\.woff2$/],
  ['landing/media', 'media', /\.(mp4|jpg)$/],
  ['.', '.', /^PROMPT\.md$/, { optional: true }],          // the one setup prompt, shown on the landing as it is
  ['web/face', 'face', /^(index\.html|face\.css|face\.js)$/],
  ['web/data', 'data', /^demo-(state|looks)\.json$/],
  // the 3D office: its page and modules (no *.html test pages), its demo data
  ['web', 'office', /^(index\.html|app\.js|styles\.css|wallpaper\.js|feed\.js)$/],
  ['web/lib', 'office/lib', /\.(js|css|json)$/, { deep: true, optional: true }],
  // the wallpaper (face/) resolves ../lib/feed-url.js; the office copy lands in office/lib with the rest of web/lib
  ['web/lib', 'lib', /^feed-url\.js$/],
  ['web/scene', 'office/scene', /\.(js|css)$/],
  // three@0.170.0, the modules the office imports, plus its MIT license. Same tree the import map names.
  ['web/vendor/three', 'office/vendor/three', /\.js$|^LICENSE$|^INTEGRITY\.json$/, { deep: true }],
  ['web/ui', 'office/ui', /\.(js|css)$/],
  ['web/audio', 'office/audio', /\.(js|m4a)$/],
  ['web/share', 'office/share', /\.(js|css)$/],
  ['web/data', 'office/data', /^demo-(state|looks)\.json$/],
  // assets, shared by the wallpaper and the office (no preview renders, no office-v1.glb)
  ['assets/face', 'assets/face', /^(sphere(-black)?\.png|eye-.+\.png|eyes\.json|grain\.png)$/],
  ['assets/blobs', 'assets/blobs', /\.glb$/],
  ['assets/blobs/thumbs', 'assets/blobs/thumbs', /\.png$/],
  ['assets/blobs/lib', 'assets/blobs/lib', /\.(png|json)$/, { optional: true }],
  ['assets/office', 'assets/office', /^office\.glb$/],
  ['assets/office/night', 'assets/office/night', /\.jpg$/],
  ['assets/brand', 'assets/brand', /\.(png|svg)$/],
  ['assets/earth', 'assets/earth', /^(day|night)\.jpg$/],
];

function copy(src, dst, keep, deep) {
  let n = 0;
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.isDirectory()) { if (deep) n += copy(path.join(src, e.name), path.join(dst, e.name), keep, deep); continue; }
    if (!keep.test(e.name)) continue;
    fs.mkdirSync(dst, { recursive: true });
    fs.copyFileSync(path.join(src, e.name), path.join(dst, e.name));
    n++;
  }
  return n;
}

let total = 0;
for (const [from, to, keep, { deep = false, optional = false } = {}] of parts) {
  const src = path.join(repo, from);
  const n = fs.existsSync(src) ? copy(src, path.join(out, to), keep, deep) : 0;
  if (!n && !optional) throw new Error(`nothing to copy from ${from}/ (expected ${keep})`);
  total += n;
}
console.log(`assembled ${total} files into ${out}`);
