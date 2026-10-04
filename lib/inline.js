import { resolveRef } from './spec.js';
import { camelize } from './naming.js';

const isInlineObject = (s) => s && !s.$ref && (s.properties || s.allOf) && (!s.type || s.type === 'object');
const isForm = (mt) => /x-www-form-urlencoded|multipart\/form-data/.test(mt);

/**
 * インライン定義されたオブジェクトスキーマを components.schemas に昇格させ $ref に置き換える
 * (openapi-generator の InlineModelResolver 相当)。命名:
 *   requestBody     -> <operationId>_request
 *   response        -> <operationId>_<code>_response
 *   プロパティ      -> <親スキーマ名>_<プロパティ名>
 *   配列要素        -> <親スキーマ名>_<プロパティ名>_inner
 * spec と ops は破壊的に更新される。
 */
export function hoistInlineSchemas(spec, ops) {
  spec.components ??= {};
  spec.components.schemas ??= {};
  const schemas = spec.components.schemas;

  const register = (schema, name) => {
    let unique = name;
    for (let i = 1; schemas[unique]; i++) unique = `${name}_${i}`;
    schemas[unique] = schema;
    hoistProperties(schema, unique); // 入れ子も昇格
    return { $ref: `#/components/schemas/${unique}` };
  };

  // schema.properties のインラインオブジェクト / 配列要素を昇格
  function hoistProperties(schema, ownerName) {
    const targets = [schema, ...(schema.allOf ?? []).filter((p) => !p.$ref)];
    for (const t of targets) {
      for (const [prop, ps] of Object.entries(t.properties ?? {})) {
        if (isInlineObject(ps)) {
          t.properties[prop] = register(ps, `${ownerName}_${prop}`);
        } else if (ps && ps.type === 'array' && isInlineObject(ps.items)) {
          ps.items = register(ps.items, `${ownerName}_${prop}_inner`);
        }
      }
    }
  }

  const hoistMedia = (media, name) => {
    if (media && isInlineObject(media.schema)) media.schema = register(media.schema, name);
  };

  // 先に既存の components.schemas のプロパティを処理 (登録順を安定させる)
  for (const [name, schema] of Object.entries({ ...schemas })) {
    if (schema && typeof schema === 'object' && !schema.$ref) hoistProperties(schema, name);
  }

  for (const op of ops) {
    const id = camelize(op.operationId);
    for (const [mt, media] of Object.entries(op.requestBody?.content ?? {})) {
      if (isForm(mt)) continue; // フォームは個別パラメータに展開される
      hoistMedia(media, `${id}_request`);
    }
    for (const [code, resp] of Object.entries(op.responses)) {
      for (const media of Object.values(resp.content ?? {})) hoistMedia(media, `${id}_${code}_response`);
    }
  }
  return spec;
}

export { resolveRef };
