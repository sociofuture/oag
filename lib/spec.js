import fs from 'node:fs';
import YAML from 'yaml';
import { t } from './i18n.js';

export function loadSpec(file) {
  const doc = YAML.parse(fs.readFileSync(file, 'utf8'));
  if (!doc || typeof doc !== 'object') throw new Error(t('spec_unreadable', { file }));
  if (!String(doc.openapi ?? '').startsWith('3.')) {
    throw new Error(t('spec_version', { file, version: doc.openapi ?? t('not_specified') }));
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
      throw new Error(t('external_ref', { ref }));
    }
    let cur = spec;
    for (const seg of ref.slice(2).split('/')) {
      const key = decodeURIComponent(seg).replace(/~1/g, '/').replace(/~0/g, '~');
      cur = cur?.[key];
    }
    if (cur === undefined) throw new Error(t('ref_unresolved', { ref }));
    node = cur;
    if (++hops > 50) throw new Error(t('ref_circular', { ref }));
  }
  return node;
}
