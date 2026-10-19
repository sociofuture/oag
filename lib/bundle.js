// 外部ファイルへの $ref を解決して、ルート仕様の components に取り込む (バンドル)。
//
// 変換後は、外部ファイルへの参照がすべて「ルート仕様の #/components/... へのローカル参照」になる。
// そのため、後続の処理 (resolveRef / インライン昇格 / 各ターゲット) は外部参照を意識しなくてよい。
//
//   - スキーマ・パラメータ・requestBody・応答・ヘッダ: components の同じ種類の場所に取り込む。
//     名前は参照先の末尾 (…/schemas/Pet → Pet、ファイル全体への参照 ./Pet.yaml → Pet)。
//     既にある名前と衝突したら _1, _2 … を付ける。
//   - パスアイテム (paths の値が別ファイルへの $ref): その場に展開する。
//   - 外部ファイルの中の $ref は、そのファイルを基準にして解決する (#/... もそのファイルの中)。
//   - 循環参照は、取り込み済みの名前を使うので無限ループにならない。
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { t } from './i18n.js';

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const REMOTE = /^[a-zA-Z][a-zA-Z0-9+.-]+:\/\//; // http://, https://, file:// など (Windows のドライブ文字は含まない)
const COMPONENT = /^\/components\/(schemas|parameters|requestBodies|responses|headers)\/([^/]+)$/;

const unescapePtr = (s) => decodeURIComponent(s).replace(/~1/g, '/').replace(/~0/g, '~');
const escapePtr = (s) => s.replace(/~/g, '~0').replace(/\//g, '~1');

function splitRef(ref) {
  const i = ref.indexOf('#');
  return i < 0 ? { filePart: ref, frag: '' } : { filePart: ref.slice(0, i), frag: ref.slice(i + 1) };
}

function getPointer(doc, frag) {
  let cur = doc;
  for (const seg of frag.split('/').filter(Boolean)) {
    cur = cur?.[unescapePtr(seg)];
    if (cur === undefined) return undefined;
  }
  return cur;
}

export function bundleSpec(root, rootFile) {
  const rootAbs = path.resolve(rootFile);
  const docs = new Map(); // 絶対パス -> 読み込み済みの文書
  const imported = new Map(); // "<絶対パス>#<ポインタ>" -> { section, name }
  const taken = {}; // section -> 使用済みの名前

  const takenOf = (section) => (taken[section] ??= new Set(Object.keys(root.components?.[section] ?? {})));

  function loadDoc(abs, ref) {
    if (docs.has(abs)) return docs.get(abs);
    if (!/\.(ya?ml|json)$/i.test(abs)) throw new Error(t('ref_file_unsupported', { file: abs, ref }));
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      throw new Error(t('ref_file_not_found', { file: abs, ref }));
    }
    const doc = YAML.parse(text);
    docs.set(abs, doc);
    return doc;
  }

  /** ref が指すファイル (絶対パス) とポインタを求める */
  function locate(ref, fromAbs) {
    const { filePart, frag } = splitRef(ref);
    if (REMOTE.test(filePart)) throw new Error(t('ref_remote_unsupported', { ref }));
    const abs = filePart ? path.resolve(path.dirname(fromAbs), decodeURI(filePart)) : fromAbs;
    return { abs, frag, filePart };
  }

  const localRef = ({ section, name }) => `#/components/${section}/${escapePtr(name)}`;

  const nameFor = (frag, abs) => {
    const segs = frag.split('/').filter(Boolean).map(unescapePtr);
    return segs.length ? segs[segs.length - 1] : path.basename(abs).replace(/\.(ya?ml|json)$/i, '');
  };

  /** $ref を取り込んで、ルート仕様から見たローカル参照を返す。書き換え不要なら null */
  function importRef(ref, fromAbs, hint) {
    if (typeof ref !== 'string') return null;
    const { abs, frag, filePart } = locate(ref, fromAbs);
    if (abs === rootAbs) return filePart ? `#${frag}` : null; // ルート自身への参照はローカル参照にする

    const key = `${abs}#${frag}`;
    if (imported.has(key)) return localRef(imported.get(key));

    const doc = loadDoc(abs, ref);
    const target = getPointer(doc, frag);
    if (target === undefined || target === null) throw new Error(t('ref_unresolved', { ref }));

    const m = COMPONENT.exec(frag);
    const section = m ? m[1] : hint;
    const base = m ? unescapePtr(m[2]) : nameFor(frag, abs);
    const names = takenOf(section);
    let name = base;
    for (let i = 1; names.has(name); i++) name = `${base}_${i}`;
    names.add(name);

    const entry = { section, name };
    imported.set(key, entry); // 先に登録しておく (循環参照で同じものを二重に取り込まないため)
    root.components ??= {};
    (root.components[section] ??= {})[name] = null; // 場所だけ先に確保して、登録順を保つ

    // 取り込み元の文書は他の参照からも使われるので、複製に対して書き換える
    const copy = structuredClone(target);
    walkBySection(section, copy, abs);
    root.components[section][name] = copy;
    return localRef(entry);
  }

  const fix = (node, hint, file) => {
    const r = importRef(node.$ref, file, hint);
    if (r) node.$ref = r;
  };

  // ---- OpenAPI の構造をたどって $ref を書き換える ----------------------

  function walkSchema(s, file) {
    if (!s || typeof s !== 'object') return;
    if (typeof s.$ref === 'string') { fix(s, 'schemas', file); return; }
    for (const p of Object.values(s.properties ?? {})) walkSchema(p, file);
    walkSchema(s.items, file);
    if (s.additionalProperties && typeof s.additionalProperties === 'object') walkSchema(s.additionalProperties, file);
    for (const k of ['allOf', 'oneOf', 'anyOf']) for (const p of s[k] ?? []) walkSchema(p, file);
    walkSchema(s.not, file);
  }

  const walkContent = (content, file) => {
    for (const media of Object.values(content ?? {})) walkSchema(media?.schema, file);
  };

  function walkHeader(h, file) {
    if (!h || typeof h !== 'object') return;
    if (typeof h.$ref === 'string') { fix(h, 'headers', file); return; }
    walkSchema(h.schema, file);
    walkContent(h.content, file);
  }

  function walkParam(p, file) {
    if (!p || typeof p !== 'object') return;
    if (typeof p.$ref === 'string') { fix(p, 'parameters', file); return; }
    walkSchema(p.schema, file);
    walkContent(p.content, file);
  }

  function walkBody(b, file) {
    if (!b || typeof b !== 'object') return;
    if (typeof b.$ref === 'string') { fix(b, 'requestBodies', file); return; }
    walkContent(b.content, file);
  }

  function walkResponse(r, file) {
    if (!r || typeof r !== 'object') return;
    if (typeof r.$ref === 'string') { fix(r, 'responses', file); return; }
    walkContent(r.content, file);
    for (const h of Object.values(r.headers ?? {})) walkHeader(h, file);
  }

  function walkOperation(op, file) {
    if (!op || typeof op !== 'object') return;
    for (const p of op.parameters ?? []) walkParam(p, file);
    walkBody(op.requestBody, file);
    for (const r of Object.values(op.responses ?? {})) walkResponse(r, file);
  }

  function walkPathItem(item, file) {
    if (!item || typeof item !== 'object') return;
    for (const p of item.parameters ?? []) walkParam(p, file);
    for (const m of METHODS) walkOperation(item[m], file);
  }

  const WALKERS = { schemas: walkSchema, parameters: walkParam, requestBodies: walkBody, responses: walkResponse, headers: walkHeader };
  function walkBySection(section, node, file) { WALKERS[section](node, file); }

  // ---- ルート仕様 --------------------------------------------------------

  // 取り込みで components が増えるので、元からあったものだけを先に控えておく
  const originals = Object.entries(WALKERS).map(([section]) => [section, Object.entries(root.components?.[section] ?? {})]);

  for (const [p, item] of Object.entries(root.paths ?? {})) {
    if (item && typeof item.$ref === 'string' && !item.$ref.startsWith('#')) {
      // 別ファイルのパスアイテムは、その場に展開する
      const { abs, frag, filePart } = locate(item.$ref, rootAbs);
      if (abs === rootAbs) { item.$ref = `#${frag}`; continue; }
      const target = getPointer(loadDoc(abs, item.$ref), frag);
      if (target === undefined || target === null) throw new Error(t('ref_unresolved', { ref: item.$ref }));
      const copy = structuredClone(target);
      walkPathItem(copy, abs);
      root.paths[p] = copy;
    } else {
      walkPathItem(item, rootAbs);
    }
  }
  for (const [section, entries] of originals) {
    for (const [, node] of entries) walkBySection(section, node, rootAbs);
  }
  return root;
}
