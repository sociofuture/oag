import { resolveRef } from './spec.js';

/**
 * スキーマに関する言語非依存のヘルパ。
 *   kind:    'enum' (トップレベル enum) | 'model' (クラス/インターフェースを生成するもの) | 'alias' (プリミティブ/配列/Map など)
 *   flatten: allOf を平坦化して { props: Map, required: Set, description } を返す
 */
export function createSchemaUtil(spec) {
  function kind(s) {
    if (!s) return 'alias';
    if (s.enum && s.type !== 'array' && s.type !== 'object') return 'enum';
    if (s.allOf || s.properties || (s.type === 'object' && !s.additionalProperties)) return 'model';
    return 'alias';
  }

  function flatten(schema, acc = { props: new Map(), required: new Set(), description: undefined }) {
    const s = resolveRef(spec, schema);
    acc.description ??= s.description;
    for (const part of s.allOf ?? []) flatten(part, acc);
    for (const [k, v] of Object.entries(s.properties ?? {})) acc.props.set(k, v);
    for (const r of s.required ?? []) acc.required.add(r);
    return acc;
  }

  return { kind, flatten };
}
