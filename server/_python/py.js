// OpenAPI スキーマ -> Python (pydantic v2 / FastAPI) のモデルとオペレーション変換
import { resolveRef, refName } from '../../lib/spec.js';
import { createSchemaUtil } from '../../lib/schema.js';
import { camelize, lowerFirstChar, snake, words } from '../../lib/naming.js';

const KEYWORDS = new Set(('False None True and as assert async await break class continue def del elif else except finally for from ' +
  'global if import in is lambda nonlocal not or pass raise return try while with yield self impl models').split(' '));

const str = (s) => JSON.stringify(String(s ?? '')); // Python の文字列リテラルとしても有効
const oneLine = (s) => String(s ?? '').replace(/\s*\r?\n\s*/g, ' ').trim();

/** Python の識別子にする (予約語・数字始まりは _ を付ける) */
export function pyIdent(name) {
  let n = String(name).replace(/[^A-Za-z0-9_]/g, '_');
  if (/^[0-9]/.test(n)) n = '_' + n;
  return KEYWORDS.has(n) ? n + '_' : n;
}

// 生成した router.py / runtime.py の中で使っている名前とぶつからないようにする (モデルのフィールドには適用しない)
const PARAM_RESERVED = new Set(['auth', 'result', 'request', 'req', 'resp', 'parse', 'dump', 'verify', 'jsonify', 'falcon', 'router', 'prefix', 'app']);

export function pyParamName(name) {
  const n = pyIdent(snake(name) || 'value');
  return PARAM_RESERVED.has(n) ? n + '_' : n;
}

const JSON_FIRST = (keys) => keys.find((k) => /json/i.test(k)) ?? keys[0];
const isForm = (mt) => /x-www-form-urlencoded|multipart\/form-data/.test(mt ?? '');

export function createPy(spec, { fileType = 'UploadFile' } = {}) {
  const { kind, flatten } = createSchemaUtil(spec);
  const className = (schemaName) => camelize(schemaName);

  /**
   * スキーマ -> Python の型注釈。ctx.models に参照したモデル名、ctx.mods に必要な標準モジュールを集める。
   * prefix: モデル名の前に付ける修飾 (router.py なら 'models.')
   */
  function typeOf(schema, ctx, prefix = '') {
    if (!schema) return 'Any';
    let t;
    if (schema.$ref) {
      const target = resolveRef(spec, schema);
      if (kind(target) !== 'alias') {
        const n = className(refName(schema.$ref));
        ctx.models.add(n);
        return prefix + n;
      }
      return typeOf(target, ctx, prefix);
    }
    switch (schema.type) {
      case 'string':
        if (schema.format === 'date') { ctx.mods.add('datetime'); t = 'datetime.date'; }
        else if (schema.format === 'date-time') { ctx.mods.add('datetime'); t = 'datetime.datetime'; }
        else if (schema.format === 'uuid') { ctx.mods.add('uuid'); t = 'uuid.UUID'; }
        else if (schema.format === 'byte' || schema.format === 'binary') t = 'bytes';
        else t = 'str';
        break;
      case 'integer': t = 'int'; break;
      case 'number': t = 'float'; break;
      case 'boolean': t = 'bool'; break;
      case 'array': t = `${schema.uniqueItems ? 'set' : 'list'}[${typeOf(schema.items, ctx, prefix)}]`; break;
      default:
        if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          t = `dict[str, ${typeOf(schema.additionalProperties, ctx, prefix)}]`;
        } else if (schema.type === 'object' || schema.properties) {
          ctx.typing.add('Any'); t = 'dict[str, Any]';
        } else { ctx.typing.add('Any'); t = 'Any'; }
    }
    return schema.nullable ? `${t} | None` : t;
  }

  // ---- enum --------------------------------------------------------------

  function enumMembers(values) {
    const used = new Set();
    return values.filter((v) => v !== null).map((v) => {
      let name = typeof v === 'number' ? `NUMBER_${String(v).replace('-', 'MINUS_').replace('.', '_')}` : words(v).map((w) => w.toUpperCase()).join('_');
      if (!name) name = 'EMPTY';
      if (/^[0-9]/.test(name)) name = '_' + name;
      name = pyIdent(name);
      while (used.has(name)) name += '_';
      used.add(name);
      return { name, literal: typeof v === 'number' ? String(v) : str(v) };
    });
  }
  const enumBase = (s) => (s.type === 'integer' ? 'int' : s.type === 'number' ? 'float' : 'str');

  // ---- モデル ------------------------------------------------------------

  /** Field(...) の引数 (制約・説明・alias) */
  function fieldArgs(schema, { alias, description }) {
    const s = schema.$ref ? resolveRef(spec, schema) : schema;
    const a = [];
    if (alias) a.push(`alias=${str(alias)}`);
    if (description) a.push(`description=${str(description)}`);
    if (s.type === 'string') {
      if (s.minLength !== undefined) a.push(`min_length=${s.minLength}`);
      if (s.maxLength !== undefined) a.push(`max_length=${s.maxLength}`);
      if (s.pattern) a.push(`pattern=${str(s.pattern)}`);
    } else if (s.type === 'array') {
      if (s.minItems !== undefined) a.push(`min_length=${s.minItems}`);
      if (s.maxItems !== undefined) a.push(`max_length=${s.maxItems}`);
    } else if (s.type === 'integer' || s.type === 'number') {
      if (s.minimum !== undefined) a.push(`${s.exclusiveMinimum === true ? 'gt' : 'ge'}=${s.minimum}`);
      if (s.maximum !== undefined) a.push(`${s.exclusiveMaximum === true ? 'lt' : 'le'}=${s.maximum}`);
    }
    return a;
  }

  function literalDefault(v, enumRef) {
    if (enumRef) return `${enumRef}.${enumMembers([v])[0].name}`;
    if (typeof v === 'string') return str(v);
    if (typeof v === 'boolean') return v ? 'True' : 'False';
    if (typeof v === 'number') return String(v);
    return null;
  }

  function buildModels() {
    const enums = [];
    const models = [];
    const ctx = { models: new Set(), mods: new Set(), typing: new Set() };
    // クラス本体では「フィールド名 = 既定値」が同名のモジュールレベルの名前 (モデル名・import 名) を隠し、
    // 型注釈の評価に失敗する。衝突するフィールド名には _ を付け、JSON 名は alias で保つ。
    const taken = new Set([
      ...Object.keys(spec.components?.schemas ?? {}).map(className),
      'datetime', 'uuid', 'Any', 'Field', 'BaseModel', 'ConfigDict', 'Enum',
    ]);

    for (const [schemaName, schema] of Object.entries(spec.components?.schemas ?? {})) {
      const k = kind(schema);
      const classname = className(schemaName);
      if (k === 'enum') {
        enums.push({ classname, base: enumBase(schema), description: oneLine(schema.description), members: enumMembers(schema.enum) });
      } else if (k === 'model') {
        const flat = flatten(schema);
        const fields = [];
        let needsAlias = false;
        for (const [pn, ps] of flat.props) {
          const required = flat.required.has(pn);
          const resolved = resolveRef(spec, ps);
          let name = pyIdent(pn.replace(/^_+/, '') || 'field');
          if (taken.has(name)) name += '_';
          const alias = name !== pn ? pn : null;
          if (alias) needsAlias = true;
          let type;
          let enumRef = null;
          if (!ps.$ref && resolved.enum && resolved.type !== 'array') {
            enumRef = `${classname}${camelize(pn)}Enum`;
            enums.push({ classname: enumRef, base: enumBase(resolved), description: oneLine(resolved.description), members: enumMembers(resolved.enum) });
            type = resolved.nullable ? `${enumRef} | None` : enumRef;
          } else {
            type = typeOf(ps, ctx);
          }
          if (!required && !type.endsWith('| None')) type += ' | None';
          const def = resolved.default !== undefined && typeof resolved.default !== 'object' ? literalDefault(resolved.default, enumRef) : null;
          const args = fieldArgs(ps, { alias, description: oneLine(resolved.description) });
          let line;
          if (required) {
            line = args.length ? `${name}: ${type} = Field(${args.join(', ')})` : `${name}: ${type}`;
          } else {
            const dv = def ?? 'None';
            line = args.length ? `${name}: ${type} = Field(default=${dv}, ${args.join(', ')})` : `${name}: ${type} = ${dv}`;
          }
          fields.push({ line });
        }
        models.push({
          classname, schemaName, description: oneLine(flat.description), fields, hasFields: fields.length > 0,
          needsAlias, // alias を使うモデルは Python 名でも値を受け取れるようにする
        });
      }
    }
    return { enums, models, ctx };
  }

  // ---- オペレーション ----------------------------------------------------

  function buildOperations(operations) {
    return operations.map((op) => {
      const rctx = { models: new Set(), mods: new Set(), typing: new Set() }; // router.py 用 (models. 付き)
      const actx = { models: new Set(), mods: new Set(), typing: new Set() }; // ABC 用 (素の名前)
      const params = [];

      const add = (p, schema) => {
        const required = p.in === 'path' || !!p.required;
        const r = resolveRef(spec, schema);
        // 既定値のあるパラメータは省略可能で、None にはしない
        const dv = r.default !== undefined && typeof r.default !== 'object' ? literalDefault(r.default, null) : null;
        params.push({
          pyName: pyParamName(p.name), rawName: p.name, in: p.in, required: required && dv === null, defaultValue: dv,
          rtype: typeOf(schema, rctx, 'models.'), atype: typeOf(schema, actx),
          description: oneLine(p.description),
          constraints: fieldArgs(schema, { alias: null, description: oneLine(p.description) }),
        });
      };
      for (const p of op.parameters) {
        if (['path', 'query', 'header', 'cookie'].includes(p.in)) add(p, p.schema ?? { type: 'string' });
      }

      let bodyMedia = null;
      const consumes = Object.keys(op.requestBody?.content ?? {});
      if (op.requestBody) {
        const mt = JSON_FIRST(consumes);
        const schema = op.requestBody.content?.[mt]?.schema;
        if (schema && isForm(mt)) {
          const f = flatten(schema);
          for (const [pn, ps] of f.props) {
            const r = resolveRef(spec, ps);
            const isFile = r.type === 'string' && r.format === 'binary';
            if (isFile) {
              // ファイル型はフレームワークごとに違う (FastAPI: UploadFile、それ以外は Any)
              const t = fileType === 'Any' ? 'Any' : fileType;
              rctx.typing.add(t); actx.typing.add(t);
            }
            params.push({
              pyName: pyParamName(pn), rawName: pn, in: isFile ? 'file' : 'form', required: f.required.has(pn),
              rtype: isFile ? fileType : typeOf(ps, rctx, 'models.'), atype: isFile ? fileType : typeOf(ps, actx),
              description: oneLine(r.description),
            });
          }
        } else {
          const name = schema?.$ref ? pyParamName(lowerFirstChar(className(refName(schema.$ref)))) : 'body';
          params.push({
            pyName: name, rawName: name, in: 'body', required: !!op.requestBody.required,
            rtype: schema ? typeOf(schema, rctx, 'models.') : 'Any', atype: schema ? typeOf(schema, actx) : 'Any',
            description: oneLine(op.requestBody.description),
          });
          bodyMedia = mt;
        }
      }

      // 必須 (既定値なし) を先に、任意を後ろに (Python の引数順の制約)
      const sorted = [...params.filter((p) => p.required), ...params.filter((p) => !p.required)];
      sorted.forEach((p) => {
        if (!p.required && p.defaultValue == null) {
          if (!/\| None$/.test(p.rtype)) p.rtype += ' | None';
          if (!/\| None$/.test(p.atype)) p.atype += ' | None';
        }
        p.defaultValue ??= p.required ? null : 'None';
        p.isList = /^(list|set)\[/.test(p.rtype.replace('models.', ''));
      });

      // 応答
      const successCode = Object.keys(op.responses).find((c) => /^2/.test(c)) ?? (op.responses.default ? 'default' : null);
      const resp = successCode ? op.responses[successCode] : null;
      const mime = resp?.content ? JSON_FIRST(Object.keys(resp.content)) : null;
      const rschema = mime ? resp.content[mime].schema : null;
      let returnR = 'None';
      let returnA = 'None';
      let responseClass = null;
      if (rschema) {
        if (rschema.type === 'string' && rschema.format === 'binary') {
          returnR = returnA = 'Response'; responseClass = 'Response';
        } else {
          returnR = typeOf(rschema, rctx, 'models.');
          returnA = typeOf(rschema, actx);
          if (!/json/i.test(mime) && rschema.type === 'string') responseClass = 'PlainTextResponse';
        }
      }
      // 成功以外の応答は OpenAPI の responses に載せる
      const extra = [];
      for (const [code, r] of Object.entries(op.responses)) {
        if (code === successCode || !/^\d+$/.test(code)) continue;
        const m = r.content?.[JSON_FIRST(Object.keys(r.content ?? {}))];
        const model = m?.schema ? typeOf(m.schema, rctx, 'models.') : null;
        extra.push(`${code}: {"description": ${str(oneLine(r.description))}${model && !model.includes('[') ? `, "model": ${model}` : ''}}`);
      }

      const opPascal = camelize(op.operationId);
      const methodName = pyIdent(snake(op.operationId));
      const abcName = `${opPascal}Api`;
      const modName = snake(op.operationId);
      const statusCode = successCode && /^\d+$/.test(successCode) ? Number(successCode) : 200;

      // 認証が必要か: op.security (なければ全体の security)。[] や、空の要求 ({}) を含む場合は認証任意なので不要。
      const sec = op.security;
      const secured = Array.isArray(sec) && sec.length > 0 && sec.every((r) => r && Object.keys(r).length > 0);

      return {
        operationId: op.operationId, methodName, abcName, implName: `${abcName}Impl`, modName, secured,
        httpMethod: op.method, path: op.path, tags: op.tags,
        summary: oneLine(op.summary), description: oneLine(op.description), deprecated: op.deprecated,
        params: sorted, bodyMedia,
        returnR, returnA, responseClass, statusCode, extraResponses: extra,
        rctx, actx,
      };
    });
  }

  return { buildModels, buildOperations, className };
}
