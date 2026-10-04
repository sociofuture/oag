// OpenAPI スキーマ -> TypeScript (fetch) のモデル/オペレーション変換 (テンプレートに渡すビューを作る)
import { resolveRef, refName } from '../../lib/spec.js';
import { createSchemaUtil } from '../../lib/schema.js';
import { hashSetOrder } from '../../lib/javacompat.js';
import { camelize, lowerFirstChar, upperFirstChar, words } from '../../lib/naming.js';

const RESERVED = new Set(('break case catch class const continue debugger default delete do else enum export extends false finally for ' +
  'function if import in instanceof new null return super switch this throw true try typeof var void while with implements interface ' +
  'let package private protected public static yield any boolean number string symbol abstract await async').split(' '));

const oneLine = (s) => String(s ?? '').replace(/\*\//g, '*\\/').trim();

export function paramName(name) {
  let n = camelize(name, true) || 'value';
  if (/^[0-9]/.test(n)) n = '_' + n;
  return RESERVED.has(n) ? '_' + n : n;
}

const JSON_FIRST = (keys) => keys.find((k) => /json/i.test(k)) ?? keys[0];
const isJsonMime = (m) => /^application\/([a-z0-9.+-]*\+)?json/i.test(m ?? '');
const isForm = (mt) => /x-www-form-urlencoded|multipart\/form-data/.test(mt ?? '');

export function createTs(spec) {
  const { kind, flatten } = createSchemaUtil(spec);
  const className = (schemaName) => camelize(schemaName);

  /** 変換の種類: 'model' | 'date' | 'date-only' | 'array' | 'map' | 'plain' (+ 変換に使うモデル名など) */
  function conv(schema) {
    if (!schema) return { k: 'plain' };
    if (schema.$ref) {
      const t = resolveRef(spec, schema);
      if (kind(t) !== 'alias') return { k: 'model', name: className(refName(schema.$ref)) };
      return conv(t);
    }
    if (schema.type === 'string' && schema.format === 'date-time') return { k: 'date' };
    if (schema.type === 'string' && schema.format === 'date') return { k: 'date-only' };
    if (schema.type === 'array') {
      const item = conv(schema.items);
      return item.k === 'plain' ? { k: 'plain' } : { k: 'array', item, set: !!schema.uniqueItems };
    }
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      const item = conv(schema.additionalProperties);
      return item.k === 'plain' ? { k: 'plain' } : { k: 'map', item };
    }
    return { k: 'plain' };
  }

  /** TypeScript の型。参照するモデル名を used に追加する。 */
  function typeOf(schema, used) {
    if (!schema) return 'any';
    if (schema.$ref) {
      const t = resolveRef(spec, schema);
      if (kind(t) !== 'alias') {
        const n = className(refName(schema.$ref));
        used.add(n);
        return n;
      }
      return typeOf(t, used);
    }
    switch (schema.type) {
      case 'string':
        if (schema.format === 'binary') return 'Blob';
        if (schema.format === 'date' || schema.format === 'date-time') return 'Date';
        return 'string';
      case 'integer': case 'number': return 'number';
      case 'boolean': return 'boolean';
      case 'array': {
        const inner = typeOf(schema.items, used) + (schema.items?.nullable ? ' | null' : '');
        return schema.uniqueItems ? `Set<${inner}>` : `Array<${inner}>`;
      }
      case 'object': default:
        if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          return `{ [key: string]: ${typeOf(schema.additionalProperties, used)}; }`;
        }
        if (schema.additionalProperties === true) return '{ [key: string]: any; }';
        return schema.type === 'object' ? 'object' : 'any';
    }
  }

  // ---- 変換式 -----------------------------------------------------------

  function fromExpr(c, ref) {
    switch (c.k) {
      case 'model': return `${c.name}FromJSON(${ref})`;
      case 'date': return `(new Date(${ref}))`;
      case 'date-only': return `(new Date(${ref}))`;
      case 'array': {
        const inner = c.item.k === 'model' ? `${c.item.name}FromJSON` : c.item.k === 'date' || c.item.k === 'date-only' ? '(item: any) => new Date(item)' : null;
        const arr = inner ? `((${ref} as Array<any>).map(${inner}))` : ref;
        return c.set ? `new Set(${arr})` : arr;
      }
      case 'map': return `(mapValues(${ref}, ${c.item.k === 'model' ? `${c.item.name}FromJSON` : '(item: any) => item'}))`;
      default: return ref;
    }
  }

  function toExpr(c, ref) {
    switch (c.k) {
      case 'model': return `${c.name}ToJSON(${ref})`;
      case 'date': return `((${ref}).toISOString())`;
      case 'date-only': return `((${ref}).toISOString().substring(0,10))`;
      case 'array': {
        const inner = c.item.k === 'model' ? `${c.item.name}ToJSON` : c.item.k === 'date' ? '(item: Date) => item.toISOString()' : c.item.k === 'date-only' ? '(item: Date) => item.toISOString().substring(0,10)' : null;
        const src = c.set ? `Array.from(${ref} as Set<any>)` : `${ref} as Array<any>`;
        return inner ? `((${src}).map(${inner}))` : (c.set ? `Array.from(${ref} as Set<any>)` : ref);
      }
      case 'map': return `(mapValues(${ref}, ${c.item.k === 'model' ? `${c.item.name}ToJSON` : '(item: any) => item'}))`;
      default: return ref;
    }
  }

  // ---- モデル -----------------------------------------------------------

  function enumEntries(values) {
    const used = new Set();
    return values.filter((v) => v !== null).map((v, i, arr) => {
      let key = typeof v === 'number' ? `Number${String(v).replace('-', 'Minus').replace('.', 'Dot')}` : (words(v).map(upperFirstChar).join('') || 'Empty');
      if (/^[0-9]/.test(key)) key = '_' + key;
      while (used.has(key)) key += '_';
      used.add(key);
      return { key, literal: typeof v === 'number' ? String(v) : `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`, sep: i === arr.length - 1 ? '' : ',' };
    });
  }

  function buildModels() {
    const models = [];
    for (const [schemaName, schema] of Object.entries(spec.components?.schemas ?? {})) {
      const k = kind(schema);
      const classname = className(schemaName);
      if (k === 'enum') {
        models.push({ isEnum: true, classname, schemaName, description: oneLine(schema.description), entries: enumEntries(schema.enum) });
        continue;
      }
      if (k !== 'model') continue;

      const flat = flatten(schema);
      const used = new Set();
      const innerEnums = [];
      const vars = [];
      for (const [pn, ps] of flat.props) {
        const required = flat.required.has(pn);
        const resolved = resolveRef(spec, ps);
        let type;
        let c;
        if (!ps.$ref && resolved.enum && resolved.type !== 'array') {
          const enumName = `${classname}${upperFirstChar(camelize(pn))}Enum`;
          innerEnums.push({ enumName, description: oneLine(resolved.description), entries: enumEntries(resolved.enum) });
          type = enumName;
          c = { k: 'plain' };
        } else {
          type = typeOf(ps, used) + (resolved.nullable ? ' | null' : '');
          c = conv(ps);
        }
        // TS 側のプロパティ名は lowerCamelCase、JSON のキーは元の名前 (本家の modelPropertyNaming=camelCase)
        const name = camelize(pn, true) || pn;
        const fromRaw = `json['${pn}']`;
        const toRaw = `value['${name}']`;
        const fromE = fromExpr(c, fromRaw);
        const toE = toExpr(c, toRaw);
        const fromJson = required ? fromE : `${fromRaw} == null ? undefined : ${fromE}`;
        // ToJSON は null 安全な変換 (モデル/プレーン) にはチェックを付けない
        const toJson = !required && ['date', 'date-only', 'array', 'map'].includes(c.k) && toE !== toRaw ? `${toRaw} == null ? undefined : ${toE}` : toE;
        vars.push({
          baseName: pn,
          name,
          type, required,
          optional: required ? '' : '?',
          description: oneLine(resolved.description),
          fromJson, toJson,
        });
      }
      used.delete(classname);
      // 本家は HashSet の反復順で出力する (名前順でも出現順でもない)
      const imports = hashSetOrder([...used]).map((n) => ({ name: n }));
      models.push({
        classname, schemaName, description: oneLine(flat.description),
        vars, imports, hasImports: imports.length > 0, innerEnums,
        requiredVars: vars.filter((v) => v.required),
      });
    }
    return models;
  }

  // ---- API ---------------------------------------------------------------

  function securityBlocks(op) {
    const schemes = spec.components?.securitySchemes ?? {};
    const reqs = op.security ?? [];
    const out = [];
    for (const req of reqs) {
      for (const [name, scopes] of Object.entries(req)) {
        const s = schemes[name];
        if (!s) continue;
        if (s.type === 'http' && /^basic$/i.test(s.scheme)) out.push({ isBasic: true });
        else if (s.type === 'http' || s.type === 'oauth2' || s.type === 'openIdConnect') {
          out.push({ isToken: true, name, scopes: `[${(scopes ?? []).map((x) => `"${x}"`).join(', ')}]`, bearer: s.type === 'http' ? true : true });
        } else if (s.type === 'apiKey') {
          out.push({ isApiKey: true, keyName: s.name, inHeader: s.in === 'header', inQuery: s.in === 'query', name });
        }
      }
    }
    return out;
  }

  function buildApis(operations, modelNames) {
    const byTag = new Map();
    for (const op of operations) {
      for (const tag of op.tags) {
        if (!byTag.has(tag)) byTag.set(tag, []);
        byTag.get(tag).push(op);
      }
    }
    const apis = [];
    for (const [tag, ops] of byTag) {
      const used = new Set();
      const sorted = [...ops].sort((a, b) => (paramName(a.operationId) < paramName(b.operationId) ? -1 : paramName(a.operationId) > paramName(b.operationId) ? 1 : 0));
      const built = sorted.map((op) => buildOperation(op, used, modelNames));
      const usedSorted = [...used].sort().map((name) => ({ name }));
      apis.push({
        classname: (tag === 'default' ? 'Default' : camelize(tag)) + 'Api',
        description: '',
        operations: built,
        requestInterfaces: built.filter((b) => b.hasParams),
        imports: usedSorted,
        hasImports: usedSorted.length > 0,
      });
    }
    return apis;
  }

  function buildOperation(op, used, modelNames) {
    const nickname = paramName(op.operationId);
    const Nick = upperFirstChar(nickname);
    // 本家: <Op>Request。同名モデルがあれば <Op>OperationRequest
    const requestName = modelNames.has(`${Nick}Request`) ? `${Nick}OperationRequest` : `${Nick}Request`;

    const params = []; // { name, key, type, required, in, rawName, schema }
    for (const p of op.parameters) {
      if (!['path', 'query', 'header'].includes(p.in)) continue;
      params.push({ ...p, key: paramName(p.name), type: typeOf(p.schema ?? { type: 'string' }, used), required: p.in === 'path' || !!p.required, schema: p.schema ?? { type: 'string' } });
    }

    let bodyExpr = null;
    let contentType = null;
    const consumes = Object.keys(op.requestBody?.content ?? {});
    if (op.requestBody) {
      const mt = JSON_FIRST(consumes);
      const schema = op.requestBody.content?.[mt]?.schema;
      contentType = mt;
      if (schema && isForm(mt)) {
        const flat = flatten(schema);
        for (const [pn, ps] of flat.props) {
          params.push({ name: pn, in: 'form', key: paramName(pn), type: typeOf(ps, used), required: flat.required.has(pn), schema: ps });
        }
      } else {
        const type = schema ? typeOf(schema, used) : 'any';
        const key = schema?.$ref ? lowerFirstChar(className(refName(schema.$ref))) : 'body';
        const c = conv(schema);
        params.push({ name: key, in: 'body', key, type, required: !!op.requestBody.required, schema });
        bodyExpr = toExpr(c, `requestParameters['${key}']`);
        if (c.k === 'plain' && schema?.type === 'array') bodyExpr = `requestParameters['${key}']`;
      }
    }

    // 戻り値: 最初の 2xx (なければ default)
    const code = Object.keys(op.responses).find((c) => /^2/.test(c)) ?? (op.responses.default ? 'default' : null);
    const resp = code ? op.responses[code] : null;
    const mime = resp?.content ? JSON_FIRST(Object.keys(resp.content)) : null;
    const rschema = mime ? resp.content[mime].schema : null;
    // 応答に現れるモデルは import 対象 (戻り値にならない default 応答も含む)
    for (const r of Object.values(op.responses)) {
      for (const m of Object.values(r.content ?? {})) if (m.schema) typeOf(m.schema, used);
    }
    let returnType = 'void';
    let responseKind = 'void';
    let responseExpr = '';
    if (rschema) {
      returnType = typeOf(rschema, used);
      const c = conv(rschema);
      if (rschema.type === 'string' && rschema.format === 'binary') { responseKind = 'blob'; }
      else if (c.k === 'model') { responseKind = 'json-conv'; responseExpr = `${c.name}FromJSON(jsonValue)`; }
      else if (c.k === 'array' && c.item.k === 'model') { responseKind = 'json-conv'; responseExpr = `jsonValue.map(${c.item.name}FromJSON)`; }
      else if (c.k === 'array' && !c.set && c.item.k === 'date') { responseKind = 'json-conv'; responseExpr = 'jsonValue.map((item: any) => new Date(item))'; }
      else if (c.k === 'date' || c.k === 'date-only') { responseKind = 'json-conv'; responseExpr = 'new Date(jsonValue)'; }
      else if (c.k === 'map' && c.item.k === 'model') { responseKind = 'json-conv'; responseExpr = `mapValues(jsonValue, ${c.item.name}FromJSON)`; }
      else if (!isJsonMime(mime) && rschema.type === 'string') { responseKind = 'text'; }
      else { responseKind = 'json-any'; }
    }

    const q = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const required = params.filter((p) => p.required).map((p) => ({ key: p.key, nickname }));
    const queryParams = params.filter((p) => p.in === 'query').map((p) => {
      const c = conv(p.schema);
      const s = p.schema.$ref ? resolveRef(spec, p.schema) : p.schema;
      let value = `requestParameters['${p.key}']`;
      if (c.k === 'date') value = `(${value} as any).toISOString()`;
      else if (c.k === 'date-only') value = `(${value} as any).toISOString().substring(0,10)`;
      else if (s.type === 'array' && p.explode === false) value = `${value}!.join(runtime.COLLECTION_FORMATS["csv"])`;
      else if (s.type === 'array' && p.style === 'spaceDelimited') value = `${value}!.join(runtime.COLLECTION_FORMATS["ssv"])`;
      return { key: p.key, rawName: q(p.name), value };
    });
    const headerParams = params.filter((p) => p.in === 'header').map((p) => ({ key: p.key, rawName: q(p.name) }));
    const pathParams = params.filter((p) => p.in === 'path');
    let path = op.path.replace(/`/g, '\\`');
    path = '`' + path + '`';
    for (const p of pathParams) {
      path += `.replace(\`{\${"${p.name}"}}\`, encodeURIComponent(String(requestParameters['${p.key}'])))`;
    }
    const formParams = params.filter((p) => p.in === 'form');

    return {
      nickname,
      summary: oneLine(op.summary),
      notes: oneLine(op.description),
      requestName,
      hasParams: params.length > 0,
      allOptional: !params.some((p) => p.required),
      requestFields: params.map((p) => ({ key: p.key, optional: p.required ? '' : '?', type: p.type })),
      requiredParams: required,
      queryParams,
      headerParams,
      contentType: contentType && !isForm(contentType) ? contentType : null,
      formParams: formParams.map((p) => ({ key: p.key, rawName: q(p.name) })),
      hasFormParams: formParams.length > 0,
      formContentType: contentType && isForm(contentType) ? contentType : null,
      isMultipart: /multipart/.test(contentType ?? ''),
      security: securityBlocks(op),
      hasSecurity: securityBlocks(op).length > 0,
      path,
      method: op.method.toUpperCase(),
      bodyExpr,
      returnType,
      isVoid: responseKind === 'void',
      resp: {
        isVoid: responseKind === 'void',
        isBlob: responseKind === 'blob',
        isText: responseKind === 'text',
        isJsonConv: responseKind === 'json-conv',
        isJsonAny: responseKind === 'json-any',
        expr: responseExpr,
        type: returnType,
      },
    };
  }

  return { buildModels, buildApis, className };
}
