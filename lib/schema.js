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
    // 中身のない `type: object` は自由形式のオブジェクトで、モデルにはならない (7.26.0)
    if (s.allOf || s.properties) return 'model';
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
