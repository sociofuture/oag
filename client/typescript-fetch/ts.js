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

// モデル名が TS の組み込み型などと衝突するときは Model を前に付ける (本家: Error → ModelError、ApiResponse → ModelApiResponse)
const PRIMITIVE_NAMES = new Set(['string', 'String', 'boolean', 'Boolean', 'Double', 'Integer', 'Long', 'Float', 'Object', 'Array', 'Date', 'number', 'any', 'File', 'Error', 'Map', 'Set']);
const MODEL_RESERVED = new Set([...PRIMITIVE_NAMES, 'ApiResponse']);

// JSDoc の本文: 改行はそのまま次の行 (先頭に pad + ' * ' が付く)。末尾の改行も残り、空の行になる (7.26.0)
const starDesc = (s, pad) => String(s ?? '').replace(/\r\n/g, '\n').replace(/\*\//g, '*\\/').replace(/\n/g, `\n${pad} * `);
// docs 用: " と \ をエスケープし、改行は空白にする
const docText = (s) => String(s ?? '').replace(/\r\n/g, '\n').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');

const esc = (s) => String(s).replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function createTs(spec) {
  const { kind, flatten } = createSchemaUtil(spec);
  const className = (schemaName) => {
    const c = camelize(schemaName);
    return MODEL_RESERVED.has(c) ? `Model${c}` : c;
  };

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
    // 7.26.0: 日付の配列・Map は変換しない (型は Array<Date> だが、値はそのまま通す)
    const keep = (item) => item.k === 'model' || item.k === 'array' || item.k === 'map';
    if (schema.type === 'array') {
      const item = conv(schema.items);
      if (schema.uniqueItems && item.k !== 'model') return { k: 'array', item, set: true };
      return keep(item) ? { k: 'array', item, set: !!schema.uniqueItems } : { k: 'plain' };
    }
    if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
      const item = conv(schema.additionalProperties);
      return keep(item) ? { k: 'map', item } : { k: 'plain' };
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
        // 組み込み名 (Error など) と同名だったモデルは、リネームされても import の対象にならない (本家の挙動)
        if (!PRIMITIVE_NAMES.has(camelize(refName(schema.$ref)))) used.add(n);
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
      // 7.26.0: 日付は runtime.ts の parseDateTime / parseDate を通す
      case 'date': return `(parseDateTime(${ref}))`;
      case 'date-only': return `(parseDate(${ref}))`;
      case 'array': {
        const inner = c.item.k === 'model' ? `${c.item.name}FromJSON` : c.item.k === 'date' ? 'parseDateTime' : c.item.k === 'date-only' ? 'parseDate' : null;
        const arr = inner ? `((${ref} as Array<any>).map(${inner}))` : ref;
        if (c.set && inner) return `(new Set((${ref} as Array<any>).map(${inner})))`;
        return c.set ? `new Set(${arr})` : arr;
      }
      case 'map': return `(mapValues(${ref}, ${c.item.k === 'model' ? `${c.item.name}FromJSON` : '(item: any) => item'}))`;
      default: return ref;
    }
  }

  function toExpr(c, ref) {
    switch (c.k) {
      case 'model': return `${c.name}ToJSON(${ref})`;
      case 'date': return `serializeDateTime(${ref})`;
      case 'date-only': return `serializeDate(${ref})`;
      case 'array': {
        const inner = c.item.k === 'model' ? `${c.item.name}ToJSON` : c.item.k === 'date' ? 'serializeDateTime' : c.item.k === 'date-only' ? 'serializeDate' : null;
        const src = c.set ? `Array.from(${ref} as Set<any>)` : `${ref} as Array<any>`;
        if (c.set && inner) return `(Array.from(${ref} as Set<any>).map(${inner}))`;
        return inner ? `((${src}).map(${inner}))` : (c.set ? `Array.from(${ref} as Set<any>)` : ref);
      }
      case 'map': return `(mapValues(${ref}, ${c.item.k === 'model' ? `${c.item.name}ToJSON` : '(item: any) => item'}))`;
      default: return ref;
    }
  }

  // ---- モデル -----------------------------------------------------------

  // 本家の underscore: 大文字の連なりと小文字→大文字の境目に _ を入れる (LIGHT_GRAY -> light_gray, someValue -> some_value)
  const underscore = (str) => str.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2').replace(/([a-z\d])([A-Z])/g, '$1_$2');

  function enumEntries(values) {
    const used = new Set();
    return values.filter((v) => v !== null).map((v, i, arr) => {
      // 数値の enum は NUMBER_1、NUMBER_MINUS_1 のようになる (7.26.0)
      let key = typeof v === 'number' ? `NUMBER_${String(v).replace('-', 'MINUS_').replace('.', '_')}` : (words(underscore(String(v)).toLowerCase()).map(upperFirstChar).join('') || 'Empty');
      if (/^[0-9]/.test(key)) key = '_' + key;
      while (used.has(key)) key += '_';
      used.add(key);
      return { key, literal: typeof v === 'number' ? String(v) : `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`, sep: ',' };
    });
  }

  function buildModels() {
    const models = [];
    for (const [schemaName, schema] of Object.entries(spec.components?.schemas ?? {})) {
      const k = kind(schema);
      const classname = className(schemaName);
      if (k === 'enum') {
        models.push({ isEnum: true, classname, schemaName, description: oneLine(schema.description), docDescription: docText(schema.description), entries: enumEntries(schema.enum) });
        continue;
      }
      if (k !== 'model') continue;

      const flat = flatten(schema);
      const used = new Set();
      const innerEnums = [];
      const vars = [];
      let hasDate = false; // 日付を使うモデルは、runtime から parseDate などを import する
      for (const [pn, ps] of flat.props) {
        const required = flat.required.has(pn);
        const resolved = resolveRef(spec, ps);
        const nullable = !!(resolved.nullable || ps.nullable); // $ref のとなりに書かれた nullable も有効
        let type;
        let c;
        const itemsEnum = !ps.$ref && resolved.type === 'array' && resolved.items?.enum && !resolved.items.$ref ? resolved.items.enum : null;
        if (!ps.$ref && resolved.enum && resolved.type !== 'array') {
          const enumName = `${classname}${upperFirstChar(camelize(pn))}Enum`;
          innerEnums.push({ enumName, description: oneLine(resolved.description), entries: enumEntries(resolved.enum) });
          type = enumName;
          c = { k: 'plain' };
        } else if (itemsEnum) {
          // 配列の要素が enum のとき: 要素の enum がモデル内に定義され、型は Array<...> (一意なら Set<...>)
          const enumName = `${classname}${upperFirstChar(camelize(pn))}Enum`;
          innerEnums.push({ enumName, description: oneLine(resolved.items.description), entries: enumEntries(itemsEnum) });
          type = `${resolved.uniqueItems ? 'Set' : 'Array'}<${enumName}>` + (nullable ? ' | null' : '');
          c = conv(ps);
        } else {
          type = typeOf(ps, used) + (nullable ? ' | null' : '');
          c = conv(ps);
        }
        // TS 側のプロパティ名は lowerCamelCase、JSON のキーは元の名前 (本家の modelPropertyNaming=camelCase)
        const name = paramName(pn); // 予約語と数字始まりは先頭に _ が付く
        const fromRaw = `json['${pn}']`;
        const toRaw = `value['${name}']`;
        const fromE = fromExpr(c, fromRaw);
        const toE = toExpr(c, toRaw);
        const isDate = c.k === 'date' || c.k === 'date-only';
        if (isDate || (c.k === 'array' && (c.item.k === 'date' || c.item.k === 'date-only'))) hasDate = true;
        // 7.26.0: 必須の日付は null を素通しする形 `(x == null ? x : parse(x))`、任意は従来どおり `x == null ? undefined : (parse(x))`
        // 任意で nullable なプロパティは、undefined と null を区別して通す
        const nullableOptional = !required && nullable;
        const fromJson = nullableOptional ? `${fromRaw} === undefined ? undefined : ${fromRaw} === null ? null : ${fromE}`
          : required ? (isDate ? `(${fromRaw} == null ? ${fromRaw} : ${fromE.slice(1, -1)})` : fromE) : `${fromRaw} == null ? undefined : ${fromE}`;
        // ToJSON は null 安全な変換 (モデル/プレーン) にはチェックを付けない。日付は必須でも任意でも `x == null ? x : serialize(x)`
        const toJson = isDate ? `${toRaw} == null ? ${toRaw} : ${toE}`
          : !required && ['array', 'map'].includes(c.k) && toE !== toRaw ? `${toRaw} == null ? undefined : ${toE}` : toE;
        // instanceOf の必須チェック。TS 側の名前と JSON のキーが違うときは、どちらでも良い形になる (7.26.0)
        const R = '(value as Record<string, any>)';
        const instanceCheck = name === pn
          ? `if (!('${name}' in value) || value['${name}'] === undefined) return false;`
          : `if ((!('${name}' in ${R}) && !('${pn}' in ${R})) || (${R}['${name}'] === undefined && ${R}['${pn}'] === undefined)) return false;`;
        // docs: 型のセル (モデルへのリンク付き) とサンプル値
        const docBase = !ps.$ref && resolved.enum && resolved.type !== 'array' ? (['integer', 'number'].includes(resolved.type) ? 'number' : 'string')
          : itemsEnum ? `Array<${resolved.items.type === 'integer' || resolved.items.type === 'number' ? 'number' : 'string'}>` : type.replace(/ \| null$/, '');
        const docType = c.k === 'model' ? `[${c.name}](${c.name}.md)`
          : (c.k === 'array' || c.k === 'map') && c.item.k === 'model' ? `[${esc(docBase)}](${c.item.name}.md)` : esc(docBase);
        const ex = resolved.example;
        const exampleValue = ex !== undefined && ex !== null && typeof ex !== 'object' ? String(ex) : 'null';
        vars.push({
          docType, exampleValue,
          baseName: pn,
          instanceCheck,
          name,
          type, required,
          optional: required ? '' : '?',
          description: starDesc(ps.description, '    '),
          readOnly: !!resolved.readOnly, deprecated: !!resolved.deprecated,
          fromJson, toJson,
        });
      }
      used.delete(classname);
      // 本家の imports は TreeSet (名前順) で、それを HashSet に入れ直して出力する。つまり HashSet の反復順で、同じバケットの名前は名前順
      const imports = hashSetOrder([...used].sort()).map((n) => ({ name: n }));
      models.push({
        classname, schemaName, description: starDesc(schema.description, ''), docDescription: docText(schema.description),
        vars, imports, hasImports: imports.length > 0, hasDate,
        // 最初の enum の前は空行 2 つ、以降は 1 つ (lead の改行 + テンプレートの改行)
        innerEnums: innerEnums.map((e, i) => ({ ...e, lead: i === 0 ? '\n' : '' })), hasInnerEnums: innerEnums.length > 0,
        requiredVars: vars.filter((v) => v.required),
        toJsonVars: vars.filter((v) => !v.readOnly), // readOnly は送らない
        hasReadOnly: vars.some((v) => v.readOnly),
        readOnlyOmit: vars.filter((v) => v.readOnly).map((v) => `'${v.baseName}'`).join('|'),
      });
    }
    return models;
  }

  // ---- API ---------------------------------------------------------------

  /** 操作の security を、テンプレート用のブロックにする。bearer / basic の後ろには空行を足さず、oauth / apiKey には足す (7.26.0) */
  function securityBlocks(op) {
    const schemes = spec.components?.securitySchemes ?? {};
    const out = [];
    for (const req of op.security ?? []) {
      for (const [name, scopes] of Object.entries(req)) {
        const s = schemes[name];
        if (!s) continue;
        if (s.type === 'http' && /^basic$/i.test(s.scheme)) out.push({ isBasic: true, name });
        else if (s.type === 'http') out.push({ isBearer: true, name, scopes: `[${(scopes ?? []).map((x) => `"${x}"`).join(', ')}]` });
        else if (s.type === 'oauth2' || s.type === 'openIdConnect') out.push({ isOAuth: true, name, scopes: `[${(scopes ?? []).map((x) => `"${x}"`).join(', ')}]` });
        else if (s.type === 'apiKey') out.push({ isApiKey: true, keyName: s.name, inHeader: s.in === 'header', inQuery: s.in === 'query', name });
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
      const enumDefs = []; // パラメータの enum (ファイル末尾に定義する)
      const sorted = [...ops].sort((a, b) => (paramName(a.operationId) < paramName(b.operationId) ? -1 : paramName(a.operationId) > paramName(b.operationId) ? 1 : 0));
      const built = sorted.map((op) => buildOperation(op, used, modelNames, enumDefs));
      enumDefs.forEach((e, i) => { e.lead = i === 0 ? '\n' : ''; }); // 最初の enum の前だけ空行
      const usedSorted = [...used].sort().map((name) => ({ name }));
      apis.push({
        classname: (tag === 'default' ? 'Default' : camelize(tag)) + 'Api',
        description: '',
        operations: built,
        requestInterfaces: built.filter((b) => b.hasParams),
        imports: usedSorted,
        hasImports: usedSorted.length > 0,
        enumDefs, hasEnumDefs: enumDefs.length > 0,
      });
    }
    return apis;
  }

  /** 本体の名前 (リクエストの引数名): $ref のモデル名、配列ならその要素のモデル名の lowerCamelCase。なければ body */
  function bodyKey(schema, fallback = 'body') {
    if (schema?.$ref) return lowerFirstChar(className(refName(schema.$ref)));
    if (schema?.type === 'array' && schema.items?.$ref) return lowerFirstChar(className(refName(schema.items.$ref)));
    return fallback;
  }

  function buildOperation(op, used, modelNames, enumDefs) {
    const nickname = paramName(op.operationId);
    const Nick = upperFirstChar(nickname);
    // 本家: <Op>Request。同名モデルがあれば <Op>OperationRequest
    const requestName = modelNames.has(`${Nick}Request`) ? `${Nick}OperationRequest` : `${Nick}Request`;

    const localEnums = new Map(); // 必須を先頭に寄せた順でファイル末尾に並べるため、いったんここに溜める
    // パラメータの型。enum は <Op><Param>Enum になり、ファイル末尾で定義する
    const paramType = (p) => {
      const schema = p.schema ?? { type: 'string' };
      const r = resolveRef(spec, schema);
      const mk = (values, desc) => {
        const enumName = `${Nick}${upperFirstChar(camelize(p.name))}Enum`;
        localEnums.set(p, { enumName, entries: enumEntries(values) });
        return enumName;
      };
      if (!schema.$ref && r.enum && r.type !== 'array') return mk(r.enum);
      if (!schema.$ref && r.type === 'array' && r.items?.enum && !r.items.$ref) return `Array<${mk(r.items.enum)}>`;
      return typeOf(schema, used);
    };

    // 引数の並び: パス / クエリ / ヘッダ / クッキー (仕様の順) → 本体 → フォーム。そのあと必須を先頭に寄せる (安定ソート)
    const params = [];
    for (const p of op.parameters) {
      if (!['path', 'query', 'header', 'cookie'].includes(p.in)) continue;
      params.push({ ...p, src: p, key: paramName(p.name), type: paramType(p), required: p.in === 'path' || !!p.required, schema: p.schema ?? { type: 'string' } });
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
          params.push({ name: pn, in: 'form', key: paramName(pn), type: typeOf(ps, used), required: flat.required.has(pn), schema: ps, description: resolveRef(spec, ps).description });
        }
      } else {
        const type = schema ? typeOf(schema, used) : 'any';
        // 配列・Map の本体 (モデルを指さないもの) の既定名は requestBody、それ以外 (自由形式のオブジェクトなど) は body
        const isContainerBody = schema && !schema.$ref
          && (schema.type === 'array' || (schema.type === 'object' && schema.additionalProperties && typeof schema.additionalProperties === 'object'));
        const key = paramName(op.raw?.['x-codegen-request-body-name'] ?? bodyKey(schema, isContainerBody ? 'requestBody' : 'body'));
        const c = conv(schema);
        params.push({ name: key, in: 'body', key, type, required: !!op.requestBody.required, schema, description: op.requestBody.description });
        // コンテナはそのまま (配列のモデル要素だけ変換)、プリミティブは `as any`、モデルは ToJSON
        const isContainerType = c.k === 'array' || c.k === 'map' || resolveRef(spec, schema ?? {}).type === 'array';
        if (c.k === 'array' && c.item.k === 'model') bodyExpr = `requestParameters['${key}']!.map(${c.item.name}ToJSON)`;
        else if (isContainerType) bodyExpr = `requestParameters['${key}']`;
        else if (c.k === 'plain') bodyExpr = `requestParameters['${key}'] as any`;
        else bodyExpr = toExpr(c, `requestParameters['${key}']`);
      }
    }
    const ordered = [...params.filter((p) => p.required), ...params.filter((p) => !p.required)];
    for (const p of ordered) {
      const def = localEnums.get(p.src);
      if (def && !enumDefs.some((e) => e.enumName === def.enumName)) enumDefs.push(def);
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
      if (rschema.type === 'string' && rschema.format === 'binary') { responseKind = 'blob'; returnType = 'runtime.HttpFile'; }
      else if (c.k === 'model') { responseKind = 'json-conv'; responseExpr = `${c.name}FromJSON(jsonValue)`; }
      else if (c.k === 'array' && c.item.k === 'model') { responseKind = 'json-conv'; responseExpr = `jsonValue.map(${c.item.name}FromJSON)`; }
      else if (c.k === 'date' || c.k === 'date-only') { responseKind = 'text'; } // 日付も単純な型 (JSON か本文そのまま)
      else if (c.k === 'map' && c.item.k === 'model') { responseKind = 'json-conv'; responseExpr = `runtime.mapValues(jsonValue, ${c.item.name}FromJSON)`; }
      else if (!rschema.$ref && ['string', 'integer', 'number', 'boolean'].includes(rschema.type)) { responseKind = 'text'; } // 単純な型は JSON か本文そのまま
      else { responseKind = 'json-any'; }
    }

    const q = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const required = ordered.filter((p) => p.required).map((p) => ({ key: p.key, nickname }));
    // クエリ・ヘッダ・フォームは宣言順 (必須を先頭に寄せるのは、引数のインターフェースと必須チェックだけ)
    const joinFormat = (p, s, dflt) => {
      if (p.style === 'pipeDelimited') return 'pipes';
      if (p.style === 'spaceDelimited') return 'ssv';
      if (p.explode === false) return 'csv';
      return dflt;
    };
    const joined = (key, s, format) => `${s.uniqueItems ? `Array.from(requestParameters['${key}'])` : `requestParameters['${key}']`}!.join(runtime.COLLECTION_FORMATS["${format}"])`;
    const queryParams = params.filter((p) => p.in === 'query').map((p) => {
      const c = conv(p.schema);
      const s = resolveRef(spec, p.schema);
      let value = `requestParameters['${p.key}']`;
      if (c.k === 'date') value = `runtime.serializeDateTime(${value} as any)`;
      else if (c.k === 'date-only') value = `runtime.serializeDate(${value} as any)`;
      const format = s.type === 'array' ? joinFormat(p, s, 'multi') : null;
      // 配列で multi 以外: join する。form + explode の Map は 1 エントリ 1 パラメータにばらす
      if (s.type === 'array' && format !== 'multi') value = joined(p.key, s, format);
      const explodeMap = s.type === 'object' && !s.properties && p.style !== 'deepObject' && p.explode !== false
        && (p.explode === true || p.style === undefined || p.style === 'form');
      return { key: p.key, rawName: q(p.name), value, isExplodeMap: explodeMap, notExplodeMap: !explodeMap };
    });
    const headerParams = params.filter((p) => p.in === 'header').map((p) => {
      const s = resolveRef(spec, p.schema);
      const value = s.type === 'array' ? joined(p.key, s, 'csv') : `String(requestParameters['${p.key}'])`;
      return { key: p.key, rawName: q(p.name), value };
    });
    const pathParams = ordered.filter((p) => p.in === 'path');
    const urlPath = '`' + op.path.replace(/`/g, '\\`') + '`';
    // 本家の入力順 (宣言順) で出す。必須を先頭に寄せるのは、引数 (インターフェース、必須チェック) だけ
    const isFileSchema = (s) => s?.type === 'string' && s.format === 'binary';
    const formParams = params.filter((p) => p.in === 'form').map((p) => {
      const c = conv(p.schema);
      const r = resolveRef(spec, p.schema);
      const f = { key: p.key, rawName: q(p.name), isFile: isFileSchema(r) || (r.type === 'array' && isFileSchema(resolveRef(spec, r.items ?? {}))) };
      if (r.type === 'array') {
        f.isArray = true;
        f.isMulti = true;
      } else if (c.k === 'date') f.dateTime = true;
      else if (c.k === 'date-only') f.dateOnly = true;
      else if (c.k === 'plain') f.plain = true;
      else f.blob = c.k === 'model' ? `${c.name}ToJSON(requestParameters['${p.key}'])` : `requestParameters['${p.key}']`;
      // Blob で送る値の後ろは、上流テンプレートの空白の都合で閉じ括弧が深くインデントされる (7.26.0)
      f.closing = f.blob ? ' '.repeat(20) + '}' : '        }';
      return f;
    });
    const security = securityBlocks(op);

    // ---- docs (docs/<Api>.md) ----
    const enumOf = (p) => {
      const r = resolveRef(spec, p.schema ?? {});
      if (!p.schema?.$ref && r.enum && r.type !== 'array') return r.enum;
      if (r.type === 'array' && r.items?.enum && !r.items.$ref) return r.items.enum;
      return null;
    };
    const literalUnion = (values) => values.map((v) => (typeof v === 'number' ? String(v) : `'${v}'`)).join(' | ');
    // multipart でファイルの配列を送る操作だけ、フォームの引数のサンプルが特別になる (Blob、引用符付きの文字列)
    const fileArrayOp = /multipart/.test(contentType ?? '') && formParams.some((fp) => fp.isFile && fp.isArray);
    const blobExample ="new Blob(['example file content'], { type: 'application/octet-stream' })";
    // サンプル値 (x-typescriptFetchApiExample 相当)。enum かどうかは見ず、型だけで決まる。モデル・コンテナは `...`
    const exampleValue = (p) => {
      if (p.schema?.$ref) return '...';
      const r = resolveRef(spec, p.schema ?? {});
      if (r.type === 'array') return isFileSchema(resolveRef(spec, r.items ?? {})) ? `[${blobExample}]` : '...';
      if (r.type === 'integer') return r.format === 'int64' ? '789' : '56';
      if (r.type === 'number') return r.format === 'float' ? '3.4' : r.format === 'double' ? '1.2' : '8.14';
      if (r.type === 'boolean') return 'true';
      if (r.type === 'object') return r.properties || (r.additionalProperties && typeof r.additionalProperties === 'object') ? '...' : 'Object';
      if (r.type === 'string') {
        if (r.format === 'date-time') return '2013-10-20T19:20:30+01:00';
        if (r.format === 'date') return '2013-10-20';
        if (r.format === 'uuid') return '38400000-8cf0-11bd-b23e-10b96e4ef00d';
        if (r.format === 'byte') return 'BYTE_ARRAY_DATA_HERE';
        if (r.format === 'binary') return fileArrayOp && p.in === 'form' ? blobExample : 'BINARY_DATA_HERE';
        return fileArrayOp && p.in === 'form' ? `'${p.key}_example'` : `${p.key}_example`;
      }
      return '...';
    };
    const docParams = ordered.map((p) => {
      const ev = enumOf(p);
      const r = resolveRef(spec, p.schema ?? {});
      const isModel = conv(p.schema).k === 'model' || (conv(p.schema).k === 'array' && conv(p.schema).item.k === 'model');
      const typeForComment = ev ? (r.type === 'array' ? `Array<${literalUnion(ev)}>` : literalUnion(ev)) : p.type;
      const desc = p.in === 'body' ? oneLine(op.requestBody?.description) : oneLine(p.description);
      // 既定値の表示: コンテナと本体には出さない。文字列の既定値は引用符付きで、HTML エスケープされる
      const isContainer = r.type === 'array' || (r.type === 'object' && r.additionalProperties && typeof r.additionalProperties === 'object');
      const defaultText = r.default !== undefined && typeof r.default !== 'object'
        ? esc(r.type === 'string' ? `'${r.default}'` : String(r.default)).replace(/'/g, '&#39;') : 'undefined';
      // 備考セルは `| ${notes}|` の形で、各項目の後ろにスペースが付く (空なら `| |`)
      const notes = [
        p.required ? null : '[Optional]',
        isContainer || p.in === 'body' ? null : `[Defaults to \`${defaultText}\`]`,
        ev ? `[Enum: ${ev.join(', ')}]` : null,
      ].filter(Boolean).map((x) => `${x} `).join('');
      const c = conv(p.schema);
      const typeCell = c.k === 'model' ? `[${c.name}](${c.name}.md)` : ev ? ev.map((v) => `\`${v}\``).join(', ') : `\`${p.type}\``;
      return {
        key: p.key,
        comment: `${typeForComment}${desc ? ` | ${desc}` : ''}${p.required ? '' : ' (optional)'}`,
        value: exampleValue(p),
        typeCell, desc, notes,
      };
    });
    const authDocs = security.map((b) => {
      if (b.isBearer) return { config: [`// Configure HTTP bearer authorization: ${b.name}`, 'accessToken: "YOUR BEARER TOKEN",'], link: `[${b.name}](../README.md#${b.name})` };
      if (b.isBasic) return { config: [`// To configure HTTP basic authorization: ${b.name}`, 'username: "YOUR USERNAME",', 'password: "YOUR PASSWORD",'], link: `[${b.name}](../README.md#${b.name})` };
      if (b.isApiKey) return { config: [`// To configure API key authorization: ${b.name}`, 'apiKey: "YOUR API KEY",'], link: `[${b.name}](../README.md#${b.name})` };
      const scheme = (spec.components?.securitySchemes ?? {})[b.name];
      const flowKey = Object.keys(scheme?.flows ?? {})[0] ?? 'implicit';
      const flow = { clientCredentials: 'application', authorizationCode: 'accessCode' }[flowKey] ?? flowKey;
      return { config: [`// To configure OAuth2 access token for authorization: ${b.name} ${flow}`, 'accessToken: "YOUR ACCESS TOKEN",'], link: `[${b.name} ${flow}](../README.md#${b.name}-${flow})` };
    });
    const mimeList = (list) => (list.length ? list.map((m) => `\`${m}\``).join(', ') : 'Not defined');
    const accept = [...new Set(Object.values(op.responses).flatMap((r) => Object.keys(r.content ?? {})))];
    const retDoc = esc(returnType === 'runtime.HttpFile' ? 'Blob' : returnType);
    const rc = rschema ? conv(rschema) : null;
    // モデルを含む型はリンク (型名はエスケープされる)、それ以外は型名そのまま
    const rawReturn = returnType === 'runtime.HttpFile' ? 'Blob' : returnType;
    const returnDoc = responseKind === 'void' ? '`void` (Empty response body)'
      : rc?.k === 'model' ? `[**${retDoc}**](${rc.name}.md)`
        : (rc?.k === 'array' || rc?.k === 'map') && rc.item.k === 'model' ? `[**${retDoc}**](${rc.item.name}.md)` : `**${rawReturn}**`;
    const doc = {
      anchor: nickname.toLowerCase() + (requestName.includes('OperationRequest') && modelNames.has(`${Nick}Request`) ? 'operation' : ''),
      signature: `${responseKind === 'void' ? '' : retDoc + ' '}${nickname}(${ordered.map((p) => p.key).join(', ')})`,
      requestName,
      hasConfig: authDocs.length > 0,
      configLines: authDocs.flatMap((a) => a.config).map((line) => ({ line })),
      example: docParams,
      hasExample: docParams.length > 0,
      params: docParams,
      hasParamsDoc: docParams.length > 0,
      returnDoc,
      authorization: authDocs.length ? authDocs.map((a) => a.link).join('\n') : 'No authorization required',
      contentType: mimeList(Object.keys(op.requestBody?.content ?? {})),
      accept: mimeList(accept),
      responses: Object.entries(op.responses).map(([rcode, r]) => ({
        code: rcode === 'default' ? '0' : rcode,
        description: oneLine(r.description),
        headers: Object.entries(r.headers ?? {}).length
          ? Object.entries(r.headers).map(([hn, h]) => `* ${hn} - ${oneLine(resolveRef(spec, h).description)} <br>`).join(' ')
          : '-',
      })),
    };

    return {
      doc,
      rawPath: op.path,
      nickname,
      summary: oneLine(op.summary),
      notes: oneLine(op.description),
      requestName,
      hasParams: params.length > 0,
      allOptional: !params.some((p) => p.required),
      requestFields: ordered.map((p) => ({ key: p.key, optional: p.required ? '' : '?', type: p.type, description: p.in === 'body' ? '' : oneLine(p.description) })),
      requiredParams: required,
      queryParams,
      headerParams,
      contentType: contentType && !isForm(contentType) ? contentType : null,
      deprecated: !!op.deprecated,
      formParams,
      fileParams: formParams.filter((p) => p.isFile).map(() => ({})),
      hasFormParams: formParams.length > 0,
      formContentType: contentType && isForm(contentType) ? contentType : null,
      security,
      hasSecurity: security.length > 0,
      urlPath,
      pathReplacements: pathParams.map((p) => ({ token: '{' + p.name + '}', key: p.key })),
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
