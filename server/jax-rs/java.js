// OpenAPI スキーマ -> Java の型/モデル/オペレーション変換 (テンプレートに渡すビューを作る)
import { resolveRef, refName } from '../../lib/spec.js';
import { createSchemaUtil } from '../../lib/schema.js';
import { camelize, lowerFirstChar, upperFirstChar, words } from '../../lib/naming.js';

const RESERVED = new Set(('abstract assert boolean break byte case catch char class const continue default do double else enum extends ' +
  'final finally float for goto if implements import instanceof int interface long native new package private protected public return ' +
  'short static strictfp super switch synchronized this throw throws transient try void volatile while null true false ' +
  'object string list map set response').split(' '));

export const escapeJava = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n');
const oneLine = (s) => String(s ?? '').replace(/\s*\r?\n\s*/g, ' ').replace(/\*\//g, '*&#47;').trim();

export function varName(name) {
  let n = camelize(name, true) || 'value';
  if (/^[0-9]/.test(n)) n = '_' + n;
  return RESERVED.has(n) ? '_' + n : n;
}

export function enumConstName(value) {
  let n = words(String(value)).map((w) => w.toUpperCase()).join('_');
  if (String(value) === '') n = 'EMPTY';
  if (!n) n = 'VALUE';
  if (/^[0-9]/.test(n)) n = (typeof value === 'number' ? 'NUMBER_' : '_') + n;
  if (typeof value === 'number' && value < 0) n = 'MINUS_' + n.replace(/^NUMBER_/, '');
  return n;
}

const JSON_FIRST = (keys) => keys.find((k) => /json/.test(k)) ?? keys[0];
const isForm = (mt) => /x-www-form-urlencoded|multipart\/form-data/.test(mt ?? '');

export function createJava(spec, o) {
  const className = (schemaName) => camelize(schemaName);
  const modelFq = (n) => `${o.modelPackage}.${n}`;

  const { kind, flatten } = createSchemaUtil(spec);

  /**
   * スキーマ -> Java 型名。必要な import を imports に追加する。
   * validItems: コンテナ要素のモデルに @Valid を付ける (本家の `List<@Valid Foo>`)
   */
  function typeOf(schema, imports, validItems = false) {
    if (!schema) return 'Object';
    if (schema.$ref) {
      const target = resolveRef(spec, schema);
      if (kind(target) !== 'alias') {
        const n = className(refName(schema.$ref));
        imports.add(`model:${n}`);
        return validItems && kind(target) === 'model' ? `@Valid ${n}` : n;
      }
      return typeOf(target, imports, validItems);
    }
    switch (schema.type) {
      case 'string':
        switch (schema.format) {
          case 'date': return o.dateLibrary === 'legacy' ? (imports.add('java.util.Date'), 'Date') : (imports.add('java.time.LocalDate'), 'LocalDate');
          case 'date-time': return o.dateLibrary === 'legacy' ? (imports.add('java.util.Date'), 'Date') : (imports.add('java.time.OffsetDateTime'), 'OffsetDateTime');
          case 'uuid': imports.add('java.util.UUID'); return 'UUID';
          case 'byte': return 'byte[]';
          case 'binary': imports.add('java.io.File'); return 'File';
          default: return 'String';
        }
      case 'integer': return schema.format === 'int64' ? 'Long' : 'Integer';
      case 'number':
        if (schema.format === 'float') return 'Float';
        if (schema.format === 'double') return 'Double';
        imports.add('java.math.BigDecimal'); return 'BigDecimal';
      case 'boolean': return 'Boolean';
      case 'array': {
        const set = schema.uniqueItems;
        imports.add(set ? 'java.util.Set' : 'java.util.List');
        return `${set ? 'Set' : 'List'}<${typeOf(schema.items, imports, true)}>`;
      }
      case 'object':
      default: {
        if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          imports.add('java.util.Map');
          return `Map<String, ${typeOf(schema.additionalProperties, imports, true)}>`;
        }
        if (schema.type === 'object' || schema.properties) { imports.add('java.util.Map'); return 'Map<String, Object>'; }
        return 'Object';
      }
    }
  }

  const isModelRef = (schema) => !!schema && !!schema.$ref && kind(resolveRef(spec, schema)) === 'model';
  // モデルそのもの、またはモデルを要素に持つコンテナか (getter / パラメータの @Valid 判定)
  const holdsModel = (schema) => {
    if (!schema) return false;
    if (isModelRef(schema)) return true;
    const s = schema.$ref ? resolveRef(spec, schema) : schema;
    if (s.type === 'array') return holdsModel(s.items);
    if (s.additionalProperties && typeof s.additionalProperties === 'object') return holdsModel(s.additionalProperties);
    return false;
  };
  const isContainerSchema = (schema) => {
    const s = schema?.$ref ? resolveRef(spec, schema) : schema;
    return !!s && (s.type === 'array' || (!!s.additionalProperties && typeof s.additionalProperties === 'object'));
  };

  /**
   * Bean Validation の core 部分 (本家 beanValidationCore 相当)。
   * 各注釈は先頭にスペースを持つ文字列で、そのまま連結される。
   */
  function constraintsCore(schema) {
    const s = schema.$ref ? resolveRef(spec, schema) : schema;
    let out = '';
    if (s.type === 'string' && s.pattern) out += ` @Pattern(regexp="${escapeJava(s.pattern)}")`;
    const [lo, hi] = s.type === 'array' ? [s.minItems, s.maxItems] : [s.minLength, s.maxLength];
    if ((s.type === 'string' || s.type === 'array') && (lo !== undefined || hi !== undefined)) {
      if (lo !== undefined && hi !== undefined) out += ` @Size(min=${lo},max=${hi})`;
      else if (lo !== undefined) out += ` @Size(min=${lo})`;
      else out += ` @Size(max=${hi})`;
    }
    if (s.type === 'integer') {
      if (s.minimum !== undefined) out += ` @Min(${s.minimum})`;
      if (s.maximum !== undefined) out += ` @Max(${s.maximum})`;
    } else if (s.type === 'number') {
      if (s.minimum !== undefined) out += ` @DecimalMin(value = "${s.minimum}"${s.exclusiveMinimum === true ? ', inclusive = false' : ''})`;
      if (s.maximum !== undefined) out += ` @DecimalMax(value = "${s.maximum}"${s.exclusiveMaximum === true ? ', inclusive = false' : ''})`;
    }
    return out;
  }

  function enumValues(values, javaType) {
    const used = new Set();
    return values.filter((v) => v !== null).map((v, i, arr) => {
      let name = enumConstName(v);
      while (used.has(name)) name += '_';
      used.add(name);
      const literal = javaType === 'String' ? `"${escapeJava(v)}"` : javaType === 'Long' ? `${v}l` : String(v);
      return { name, literal, raw: String(v), sep: i === arr.length - 1 ? ';' : ',' };
    });
  }

  const enumJavaType = (s) => (s.type === 'integer' ? (s.format === 'int64' ? 'Long' : 'Integer') : s.type === 'number' ? 'BigDecimal' : 'String');

  // ---- モデル ------------------------------------------------------------

  function buildVar(propName, propSchema, required) {
    const imports = new Set();
    const resolved = resolveRef(spec, propSchema);
    const Name = upperFirstChar(camelize(propName) || 'Value');
    const v = {
      baseName: propName,
      name: varName(propName),
      getter: 'get' + Name,
      setter: 'set' + Name,
      Name,
      required,
      description: oneLine(resolved.description),
      descriptionJava: escapeJava(resolved.description),
    };
    let innerEnum = null;
    if (!propSchema.$ref && resolved.enum && resolved.type !== 'array') {
      const jt = enumJavaType(resolved);
      innerEnum = { enumName: Name + 'Enum', javaType: jt, values: enumValues(resolved.enum, jt), description: oneLine(resolved.description) };
      v.datatype = innerEnum.enumName;
      v.isEnum = true;
    } else if (resolved.type === 'array' && !propSchema.$ref && resolved.items?.enum && !resolved.items.$ref) {
      const jt = enumJavaType(resolved.items);
      innerEnum = { enumName: Name + 'Enum', javaType: jt, values: enumValues(resolved.items.enum, jt), description: oneLine(resolved.description) };
      imports.add(resolved.uniqueItems ? 'java.util.Set' : 'java.util.List');
      v.datatype = `${resolved.uniqueItems ? 'Set' : 'List'}<${innerEnum.enumName}>`;
    } else {
      v.datatype = typeOf(propSchema, imports);
    }

    const isContainer = isContainerSchema(propSchema) || /^(List|Set|Map)</.test(v.datatype);
    // フィールドはコンテナなら @Valid、getter はモデル/コンテナなら @Valid (本家の pojo/beanValidation の挙動)
    v.fieldValid = isContainer;
    const valid = holdsModel(propSchema);
    v.getterPrefix = `${required ? '@NotNull ' : ''}${valid ? '@Valid ' : ''}${constraintsCore(propSchema)}`;
    v.deprecated = !!resolved.deprecated;

    if (isContainer) {
      const isMap = v.datatype.startsWith('Map<');
      const impl = v.datatype.startsWith('Set<') ? 'LinkedHashSet' : isMap ? 'HashMap' : 'ArrayList';
      imports.add('java.util.' + impl);
      if (impl === 'ArrayList') imports.add('java.util.Arrays');
      v.defaultValue = `new ${impl}<>()`;
      v.isContainer = true;
      v.isMap = isMap;
      v.containerImpl = impl;
      const inner = v.datatype.slice(v.datatype.indexOf('<') + 1, -1);
      v.itemType = (isMap ? inner.replace(/^String, /, '') : inner).replace(/^@Valid /, '');
    } else if (resolved.default !== undefined && typeof resolved.default !== 'object') {
      const d = resolved.default;
      if (innerEnum) v.defaultValue = `${innerEnum.enumName}.${enumConstName(d)}`;
      else if (v.datatype === 'String') v.defaultValue = `"${escapeJava(d)}"`;
      else if (v.datatype === 'Long') v.defaultValue = `${d}l`;
      else if (v.datatype === 'Float') v.defaultValue = `${d}f`;
      else if (v.datatype === 'Double') v.defaultValue = `${d}d`;
      else if (v.datatype === 'BigDecimal') v.defaultValue = `new BigDecimal("${d}")`;
      else if (['Integer', 'Boolean'].includes(v.datatype)) v.defaultValue = String(d);
    }
    return { v, innerEnum, imports };
  }

  function buildModels() {
    const models = [];
    for (const [schemaName, schema] of Object.entries(spec.components?.schemas ?? {})) {
      const k = kind(schema);
      const classname = className(schemaName);
      if (k === 'enum') {
        const jt = enumJavaType(schema);
        models.push({ isEnum: true, classname, schemaName, javaType: jt, values: enumValues(schema.enum, jt), description: oneLine(schema.description), imports: [] });
      } else if (k === 'model') {
        if (schema.oneOf || schema.anyOf) console.warn(`[jax-rs] ${schemaName}: oneOf/anyOf は未対応のためプロパティのみ生成します`);
        const flat = flatten(schema);
        const imports = new Set();
        const vars = [];
        const innerEnums = [];
        for (const [pn, ps] of flat.props) {
          const { v, innerEnum, imports: im } = buildVar(pn, ps, flat.required.has(pn));
          im.forEach((i) => imports.add(i));
          vars.push(v);
          if (innerEnum) innerEnums.push(innerEnum);
        }
        if (schemaName !== classname) imports.add('com.fasterxml.jackson.annotation.JsonTypeName');
        vars.forEach((v, i) => {
          const last = i === vars.length - 1;
          v.eqSep = last ? ';' : ' &&\n        ';
          v.hashSep = last ? '' : ', ';
          v.endBlank = last && !v.isContainer; // 本家は最後の非コンテナ変数の後に空行が 1 つ多い
        });
        const requiredVars = vars.filter((v) => v.required).map((v, i, a) => ({
          ...v, ctorSep: i === a.length - 1 ? '' : ',',
        }));
        models.push({
          classname, schemaName, lcClassname: lowerFirstChar(classname),
          description: oneLine(flat.description), descriptionJava: escapeJava(flat.description),
          vars, innerEnums, requiredVars, hasRequiredVars: requiredVars.length > 0,
          imports: [...imports].map((i) => (i.startsWith('model:') ? modelFq(i.slice(6)) : i)).sort(),
          hasVars: vars.length > 0,
        });
      }
    }
    return models;
  }

  // ---- オペレーション ----------------------------------------------------

  function buildParam(p) {
    const imports = new Set();
    const schema = p.schema ?? { type: 'string' };
    const resolved = resolveRef(spec, schema);
    const isFile = resolved.type === 'string' && resolved.format === 'binary';
    let type = resolved.enum && !schema.$ref ? 'String' : typeOf(schema, imports);
    if (p.in === 'form' && isFile) { imports.add('java.io.InputStream'); type = 'InputStream'; }
    const anno = { path: 'PathParam', query: 'QueryParam', header: 'HeaderParam', cookie: 'CookieParam', form: 'FormParam' }[p.in];
    const required = p.in === 'path' || !!p.required;
    const parts = [`@${anno}("${escapeJava(p.name)}")`];
    if (resolved.default !== undefined && typeof resolved.default !== 'object' && p.in !== 'path') {
      parts.push(`@DefaultValue("${escapeJava(resolved.default)}")`);
    }
    if (o.useSwaggerAnnotations && p.description) parts.push(`@ApiParam("${escapeJava(oneLine(p.description))}")`);
    if (holdsModel(schema)) parts.push('@Valid');
    if (required && resolved.default === undefined) parts.push('@NotNull');
    const core = constraintsCore(schema).trim();
    if (core) parts.push(core);
    const name = varName(p.name);
    return { decl: [...parts, `${type} ${name}`].join(' '), imports, name, description: oneLine(p.description) };
  }

  function buildOperation(op) {
    const imports = new Set();
    const params = [];
    for (const p of op.parameters) {
      if (!['path', 'query', 'header', 'cookie'].includes(p.in)) continue;
      const bp = buildParam(p);
      bp.imports.forEach((i) => imports.add(i));
      params.push(bp);
    }

    const consumes = Object.keys(op.requestBody?.content ?? {});
    if (op.requestBody) {
      const mt = JSON_FIRST(consumes);
      const schema = op.requestBody.content?.[mt]?.schema;
      if (schema && isForm(mt)) {
        const flat = flatten(schema);
        for (const [pn, ps] of flat.props) {
          const bp = buildParam({ name: pn, in: 'form', schema: ps, required: flat.required.has(pn), description: resolveRef(spec, ps).description });
          bp.imports.forEach((i) => imports.add(i));
          params.push(bp);
        }
      } else if (schema) {
        const t = typeOf(schema, imports);
        const name = varName(op.raw['x-codegen-request-body-name'] ?? (schema.$ref ? lowerFirstChar(className(refName(schema.$ref))) : 'body'));
        const cons = ['@Valid', op.requestBody.required ? '@NotNull' : null].filter(Boolean);
        const doc = o.useSwaggerAnnotations && op.requestBody.description ? [`@ApiParam(value = "${escapeJava(oneLine(op.requestBody.description))}")`] : [];
        params.push({ decl: [...doc, ...cons, `${t} ${name}`].join(' '), imports: new Set(), name, description: oneLine(op.requestBody.description) });
      } else {
        imports.add('java.io.InputStream');
        params.push({ decl: 'InputStream body', imports: new Set(), name: 'body', description: '' });
      }
    }

    // 戻り値: 最初の 2xx (なければ default) のスキーマの型。なければ void。interfaceOnly でなければ Response。
    const methodCode = Object.keys(op.responses).find((c) => /^2/.test(c)) ?? (op.responses.default ? 'default' : null);
    const mediaOf = (r) => r?.content?.[JSON_FIRST(Object.keys(r?.content ?? {}))];
    let returnType = 'void';
    const rs = mediaOf(methodCode && op.responses[methodCode])?.schema;
    if (rs) returnType = typeOf(rs, imports);
    if (!o.interfaceOnly) returnType = 'Response';

    const produces = [...new Set(Object.values(op.responses).flatMap((r) => Object.keys(r.content ?? {})))];
    const responses = Object.entries(op.responses).map(([code, r]) => {
      const ri = new Set();
      const media = mediaOf(r);
      let responseType = null;
      let container = null;
      if (media?.schema) {
        const s = media.schema;
        const target = s.type === 'array' ? s.items : s;
        responseType = typeOf(target, ri);
        container = s.type === 'array' ? (s.uniqueItems ? 'Set' : 'List') : (s.additionalProperties && !s.$ref ? 'Map' : null);
        if (container === 'Map') responseType = typeOf(s.additionalProperties, ri);
        responseType = responseType.replace(/<.*$/, ''); // class リテラルなのでジェネリクスは落とす
        ri.forEach((i) => imports.add(i)); // 戻り値でなくても、応答に出てくるモデルは import される
      }
      const extra = [
        responseType ? `response = ${responseType}.class` : null,
        container ? `responseContainer = "${container}"` : null,
      ].filter(Boolean);
      return {
        message: oneLine(r.description),
        annotation: `@ApiResponse(code = ${code === 'default' ? 0 : Number(code) || 0}, message = "${escapeJava(oneLine(r.description))}"${extra.length ? ', ' + extra.join(', ') : ''})`,
      };
    });
    responses.forEach((r, i) => { r.sep = i === responses.length - 1 ? '' : ','; });

    return {
      operationId: varName(op.operationId),
      httpMethod: op.method.toUpperCase(),
      path: op.path,
      notes: oneLine(op.description),
      summary: escapeJava(oneLine(op.summary)),
      notesJava: escapeJava(oneLine(op.description)),
      tagsList: op.tags.map((t) => `"${escapeJava(t)}"`).join(', '),
      deprecated: op.deprecated,
      consumes: consumes.length ? consumes.map((c) => `"${c}"`).join(', ') : null,
      produces: produces.length ? produces.map((c) => `"${c}"`).join(', ') : null,
      returnType,
      params: params.map((p) => ({ name: p.name, description: p.description })),
      paramsDecl: params.map((p) => p.decl).join(', '),
      responses,
      hasResponses: responses.length > 0,
      imports,
    };
  }

  /** API クラスへの振り分け: 既定はパスの先頭セグメント (本家の useTags=false)、useTags=true ならタグ */
  function buildApis(operations) {
    const groups = new Map();
    const add = (key, op) => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(op); };
    for (const op of operations) {
      if (o.useTags) for (const tag of op.tags) add(tag, op);
      else add(op.path.replace(/^\//, '').split('/')[0] || 'default', op);
    }
    return [...groups].map(([key, ops]) => {
      const built = ops.map(buildOperation);
      const common = o.useTags
        ? (() => {
          const first = (p) => p.split('/').filter(Boolean)[0];
          const seg = first(built[0].path);
          return seg && !seg.includes('{') && built.every((b) => first(b.path) === seg) ? '/' + seg : '';
        })()
        : (key === 'default' ? '' : '/' + key);
      built.forEach((b) => { b.subPath = b.path.slice(common.length) || null; });
      const imports = new Set();
      built.forEach((b) => b.imports.forEach((i) => imports.add(i)));
      const baseName = key === 'default' ? 'Default' : camelize(key);
      return {
        classname: baseName + 'Api', baseName, commonPath: common || '/', operations: built,
        // 本家のテンプレートは java.util.* などをファイル側で固定 import するため、モデル型だけを出力する
        imports: [...imports].filter((i) => i.startsWith('model:')).map((i) => modelFq(i.slice(6))).sort(),
        extraImports: [...imports].filter((i) => !i.startsWith('model:') && !['java.util.List', 'java.util.Map', 'java.io.InputStream'].includes(i)).sort(),
      };
    });
  }

  return { buildModels, buildApis };
}
