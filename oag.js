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

function createWriter(outDir) {
  const written = new Set();
  const root = path.resolve(outDir);
  const write = (rel, content) => {
    const file = path.resolve(root, rel);
    if (!file.startsWith(root + path.sep)) throw new Error(t('outside_output', { path: rel }));
    const text = content.replace(/\r\n/g, '\n');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    written.add(rel.split(path.sep).join('/'));
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

  const writer = createWriter(values.output);
  await target.generate({
    spec, operations, options, render,
    write: writer.write,
    log: (m) => console.warn(`[${values.generator}] ${m}`),
  });
  console.log(t('generated', { count: writer.written.size, dir: writer.root }));
}

main().catch((e) => { console.error(e.message); process.exit(1); });
