import fs from 'node:fs';
import path from 'node:path';
import Mustache from 'mustache';
import { t } from './i18n.js';

Mustache.escape = (s) => s; // コード生成なので HTML エスケープしない

/**
 * テンプレート描画器。dirs の先頭ほど優先 (--template-dir による上書きのため)。
 * テンプレートは任意機能で、generate.js が使わなければ読み込まれない。
 */
export function createRenderer(dirs) {
  const cache = new Map();
  const find = (name) => {
    if (cache.has(name)) return cache.get(name);
    let text = null;
    for (const d of dirs) {
      const f = path.join(d, `${name}.mustache`);
      if (fs.existsSync(f)) { text = fs.readFileSync(f, 'utf8').replace(/^﻿/, ''); break; }
    }
    cache.set(name, text);
    return text;
  };
  const render = (name, view) => {
    const tpl = find(name);
    if (tpl === null) throw new Error(t('template_not_found', { name, dirs: dirs.join(', ') }));
    return Mustache.render(tpl, view, (p) => find(p) ?? '');
  };
  render.has = (name) => find(name) !== null;
  return render;
}
