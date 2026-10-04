import fs from 'node:fs';
import YAML from 'yaml';

export function loadSpec(file) {
  const doc = YAML.parse(fs.readFileSync(file, 'utf8'));
  if (!doc || typeof doc !== 'object') throw new Error(`${file}: 仕様を読み込めません`);
  if (!String(doc.openapi ?? '').startsWith('3.')) {
    throw new Error(`${file}: OpenAPI 3.x のみ対応しています (openapi: ${doc.openapi ?? '未指定'})`);
  }
  return doc;
}

export function refName(ref) {
  return decodeURIComponent(ref.split('/').pop());
}

/** ローカル $ref (#/...) を辿って実体を返す。$ref でなければそのまま返す。 */
export function resolveRef(spec, node) {
  let hops = 0;
  while (node && typeof node === 'object' && node.$ref) {
    const ref = node.$ref;
    if (!ref.startsWith('#/')) {
      throw new Error(`外部ファイルへの $ref は未対応です: ${ref}`);
    }
    let cur = spec;
    for (const seg of ref.slice(2).split('/')) {
      const key = decodeURIComponent(seg).replace(/~1/g, '/').replace(/~0/g, '~');
      cur = cur?.[key];
    }
    if (cur === undefined) throw new Error(`$ref を解決できません: ${ref}`);
    node = cur;
    if (++hops > 50) throw new Error(`$ref が循環しています: ${ref}`);
  }
  return node;
}
