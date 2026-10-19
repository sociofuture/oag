#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadSpec } from './lib/spec.js';
import { collectOperations } from './lib/operations.js';
import { hoistInlineSchemas } from './lib/inline.js';
import { createRenderer } from './lib/template.js';
import { detectLang, setLang, t, tr } from './lib/i18n.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const KINDS = ['server', 'client'];

function listTargets() {
  const out = [];
  for (const kind of KINDS) {
    const dir = path.join(ROOT, kind);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (fs.existsSync(path.join(dir, name, 'generate.js'))) out.push(`${kind}/${name}`);
    }
  }
  return out;
}

async function loadTarget(id) {
  if (!listTargets().includes(id)) {
    throw new Error(t('unknown_target', { id, available: listTargets().join(', ') || t('none') }));
  }
  const dir = path.join(ROOT, ...id.split('/'));
  const mod = await import(pathToFileURL(path.join(dir, 'generate.js')).href);
  return { dir, generate: mod.default, meta: mod.meta ?? {} };
}

// "a=1,b=true" -> {a:'1', b:'true'} を meta.options の既定値の型に合わせて変換
function parseOptions(str, defs = {}) {
  const raw = {};
  for (const kv of (str ?? '').split(',').filter(Boolean)) {
    const i = kv.indexOf('=');
    if (i < 0) raw[kv] = 'true';
    else raw[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  }
  const opts = {};
  for (const [k, d] of Object.entries(defs)) opts[k] = d.default;
  for (const [k, v] of Object.entries(raw)) {
    if (!(k in defs)) throw new Error(t('unknown_option', { name: k, valid: Object.keys(defs).join(', ') }));
    opts[k] = typeof defs[k].default === 'boolean' ? v === 'true' : v;
  }
  return opts;
}

// --global-property (-D): 生成する種類を絞る。openapi-generator と同じ書き方。
//   -D models                 モデルだけ
//   -D models=Pet:Tag         指定したモデルだけ (名前は : 区切り)
//   -D apis,models=Pet        API 全部と、モデル Pet だけ
//   -D supportingFiles        API・モデル以外 (runtime、router、pom.xml など) だけ
// 1 つも指定しなければ、すべて生成する。
const GLOBAL_KEYS = { models: 'models', apis: 'apis', supportingFiles: 'supporting' };
// 本家のオプションだが、このツールはドキュメントもテストも出さないので、指定されても何もしない
const GLOBAL_IGNORED = new Set(['modelTests', 'modelDocs', 'apiTests', 'apiDocs']);

function parseGlobalProperties(list) {
  const selection = {}; // 種類 -> true (全部) | Set (名前で絞る)
  for (const item of list ?? []) {
    for (const kv of item.split(',').filter(Boolean)) {
      const i = kv.indexOf('=');
      const key = (i < 0 ? kv : kv.slice(0, i)).trim();
      const value = i < 0 ? '' : kv.slice(i + 1).trim();
      if (GLOBAL_IGNORED.has(key)) continue;
      const kind = GLOBAL_KEYS[key];
      if (!kind) throw new Error(t('unknown_global_property', { name: key, valid: Object.keys(GLOBAL_KEYS).join(', ') }));
      if (value === 'false') continue;
      selection[kind] = value === '' || value === 'true' ? true : new Set(value.split(':').filter(Boolean));
    }
  }
  return Object.keys(selection).length ? selection : null;
}

/** want(種類, 名前?): その種類 (と名前) を生成するか。名前は文字列か、別名を含む配列 */
function createWant(selection) {
  const matched = new Set(); // 名前で絞ったうち、実際に一致したもの
  const want = (kind, names) => {
    if (!selection) return true;
    const sel = selection[kind];
    if (!sel) return false;
    if (names === undefined || sel === true) return true;
    const hit = [].concat(names).find((n) => sel.has(n));
    if (hit === undefined) return false;
    matched.add(`${kind}:${hit}`);
    return true;
  };
  const unmatched = () => Object.entries(selection ?? {}).flatMap(([kind, sel]) =>
    (sel === true ? [] : [...sel].filter((n) => !matched.has(`${kind}:${n}`)).map((n) => ({ kind, name: n }))));
  return { want, unmatched };
}

function createWriter(outDir, want) {
  const written = new Set();
  const root = path.resolve(outDir);
  // kind: 'models' | 'apis' | 'supporting' (既定)。選ばれていない種類は書かず、false を返す
  const write = (rel, content, kind = 'supporting') => {
    if (!want(kind)) return false;
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) throw new Error(t('outside_output', { path: rel }));
    const text = content.replace(/\r\n/g, '\n');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    written.add(rel.split(path.sep).join('/'));
    return true;
  };
  return { write, written, root };
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      input: { type: 'string', short: 'i' },
      generator: { type: 'string', short: 'g' },
      output: { type: 'string', short: 'o' },
      props: { type: 'string', short: 'p' },
      'template-dir': { type: 'string', short: 't' },
      'global-property': { type: 'string', short: 'D', multiple: true },
      lang: { type: 'string' },
    },
  });
  // 言語: --lang > 環境 (OAG_LANG、ロケール) > en。生成物の内容には影響しない
  setLang(detectLang());
  if (values.lang) setLang(values.lang);
  const usage = t('usage');
  const [cmd = 'help', arg] = positionals;

  if (cmd === 'list') { console.log(listTargets().join('\n')); return; }
  if (cmd === 'help') {
    console.log(usage);
    if (arg) {
      const { meta } = await loadTarget(arg);
      const opts = Object.entries(meta.options ?? {});
      console.log(`${arg}: ${tr(meta.description)}\n${opts.length ? t('help_options') : t('help_no_options')}`);
      for (const [k, d] of opts) {
        console.log(`  ${k} (${t('help_default')}: ${JSON.stringify(d.default)}) ${tr(d.description)}`);
      }
    }
    return;
  }
  if (cmd !== 'generate') throw new Error(t('unknown_command', { cmd, usage }));
  const flags = { input: 'i', generator: 'g', output: 'o' };
  for (const [k, short] of Object.entries(flags)) {
    if (!values[k]) throw new Error(t('missing_arg', { name: short, usage }));
  }

  const target = await loadTarget(values.generator);
  const options = parseOptions(values.props, target.meta.options);
  const spec = loadSpec(values.input);
  const operations = collectOperations(spec);
  hoistInlineSchemas(spec, operations);

  const dirs = [];
  if (values['template-dir']) dirs.push(path.resolve(values['template-dir']));
  dirs.push(path.join(target.dir, 'templates'));
  // 複数ターゲットで共有するテンプレート (meta.templateDirs: ターゲットからの相対パス)
  for (const d of target.meta.templateDirs ?? []) dirs.push(path.resolve(target.dir, d));
  const render = createRenderer(dirs);

  const { want, unmatched } = createWant(parseGlobalProperties(values['global-property']));
  const writer = createWriter(values.output, want);
  const log = (m) => console.warn(`[${values.generator}] ${m}`);
  await target.generate({ spec, operations, options, render, write: writer.write, want, log });
  for (const u of unmatched()) log(t('global_property_no_match', { kind: u.kind, name: u.name }));
  console.log(t('generated', { count: writer.written.size, dir: writer.root }));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
