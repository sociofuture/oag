// 本家の出力 (ref) と oag の出力 (mine) をファイル単位で比較する開発用スクリプト。
// 使い方: node tools/cmp.mjs <ref> <mine> [表示する差分ファイル数=3] [名前フィルタ]
import fs from 'node:fs';
import path from 'node:path';

const [ref, mine, limitArg, filter] = process.argv.slice(2);
const limit = Number(limitArg ?? 3);
const norm = (s) => s.replace(/\r\n/g, '\n').replace(/date = "[^"]*"/g, 'date = "X"');

const walk = (d) => fs.readdirSync(d, { withFileTypes: true, recursive: true })
  .filter((e) => e.isFile()).map((e) => path.relative(d, path.join(e.parentPath, e.name)).replace(/\\/g, '/'));

const r = new Set(walk(ref));
const m = new Set(walk(mine));
const onlyRef = [...r].filter((f) => !m.has(f));
const onlyMine = [...m].filter((f) => !r.has(f));
const both = [...r].filter((f) => m.has(f));
const diff = both.filter((f) => norm(fs.readFileSync(path.join(ref, f), 'utf8')) !== norm(fs.readFileSync(path.join(mine, f), 'utf8')));

console.log(`ref=${r.size} mine=${m.size} 同一=${both.length - diff.length} 相違=${diff.length} refのみ=${onlyRef.length} mineのみ=${onlyMine.length}`);
if (onlyRef.length) console.log('refのみ:', onlyRef.slice(0, 15).join('\n  '));
if (onlyMine.length) console.log('mineのみ:', onlyMine.slice(0, 15).join('\n  '));

let shown = 0;
for (const f of diff) {
  if (filter && !f.includes(filter)) continue;
  if (shown++ >= limit) break;
  const a = norm(fs.readFileSync(path.join(ref, f), 'utf8')).split('\n');
  const b = norm(fs.readFileSync(path.join(mine, f), 'utf8')).split('\n');
  console.log(`\n=== ${f}`);
  let n = 0;
  for (let i = 0; i < Math.max(a.length, b.length) && n < 12; i++) {
    if (a[i] !== b[i]) { console.log(`L${i + 1}\n  ref : ${JSON.stringify(a[i])}\n  mine: ${JSON.stringify(b[i])}`); n++; }
  }
}
