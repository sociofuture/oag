import { resolveRef } from './spec.js';
import { camelize } from './naming.js';

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

/**
 * paths から operation を平坦化して返す。parameters / requestBody / responses は
 * $ref を解決済み (スキーマ内の $ref はモデル名を保つため残す)。
 */
export function collectOperations(spec) {
  const ops = [];
  for (const [path, rawItem] of Object.entries(spec.paths ?? {})) {
    const item = resolveRef(spec, rawItem);
    for (const method of METHODS) {
      const op = item[method];
      if (!op) continue;
      const params = new Map();
      for (const p of [...(item.parameters ?? []), ...(op.parameters ?? [])]) {
        const r = resolveRef(spec, p); // operation 側が path 側を上書き
        params.set(`${r.in}:${r.name}`, r);
      }
      const responses = {};
      for (const [code, r] of Object.entries(op.responses ?? {})) responses[code] = resolveRef(spec, r);
      ops.push({
        path,
        method,
        operationId: op.operationId ?? defaultOperationId(method, path),
        tags: op.tags?.length ? op.tags : ['default'],
        summary: op.summary,
        description: op.description,
        deprecated: !!op.deprecated,
        parameters: [...params.values()],
        requestBody: op.requestBody ? resolveRef(spec, op.requestBody) : undefined,
        responses,
        security: op.security ?? spec.security,
        raw: op,
      });
    }
  }
  return ops;
}

// openapi-generator と同じ: /pet/{petId} + get => petPetIdGet
function defaultOperationId(method, path) {
  const base = camelize(path.replace(/[{}]/g, ''), true) || 'root';
  return base + camelize(method);
}
