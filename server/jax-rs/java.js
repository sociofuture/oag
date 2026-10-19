// OpenAPI スキーマ -> Java の型/モデル/オペレーション変換 (テンプレートに渡すビューを作る)
import { resolveRef, refName } from '../../lib/spec.js';
import { t } from '../../lib/i18n.js';
import { createSchemaUtil } from '../../lib/schema.js';
import { camelize, lowerFirstChar, upperFirstChar, words } from '../../lib/naming.js';

const RESERVED = new Set(('abstract assert boolean break byte case catch char class const continue default do double else enum extends ' +
  'final finally float for goto if implements import instanceof int interface long native new package private protected public return ' +
  'short static strictfp super switch synchronized this throw throws transient try void volatile while null true false ' +
  'object string list map set response file').split(' '));

const JAVA_MODEL_RESERVED = new Set(['ApiResponse']);

export const escapeJava =(s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n');
// モデルの説明 (javadoc 用): 本家の escapeText (タブ・改行は空白 1 つ、\ と " をエスケープ) のあと、テンプレートの {{.}} が HTML エスケープする。末尾の改行も空白として残る
const HTML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#x60;', '=': '&#x3D;' };
const docText = (s) => String(s ?? '').replace(/[\t\n\r]/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  .replace(/[&<>"'`=]/g, (c) => HTML[c]).replace(/\*\//g, '*&#47;');
const oneLine = (s) => String(s ?? '').replace(/\s*\r?\n\s*/g, ' ').replace(/\*\//g, '*&#47;').trim();

export function varName(name) {
  // 本家: class (前後の _ も含む) は propertyClass、すべて大文字・数字・_ の名前はそのまま
  if (/^_*class$/i.test(name)) return 'propertyClass';
  if (/^[A-Z0-9_]+$/.test(name) && /[A-Z]/.test(name)) return name;
  let n = camelize(name, true) || 'value';
  if (/^[0-9]/.test(n)) n = '_' + n;
  return RESERVED.has(n) ? '_' + n : n;
}

export function enumConstName(value) {
  let n = words(String(value)).map((w) => w.toUpperCase()).join('_');
  if (String(value) === '') n = 'EMPTY';
  if (!n) n = 'VALUE';
  if (/^[0-9]/.test(n)) n = (typeof value === 'number' ? 'NUMBER_' : '_') + n;
  if (typeof value === 'number' && value < 0) n = 'NUMBER_MINUS_' + n.replace(/^NUMBER_/, '');
  return n;
}

const JSON_FIRST = (keys) => keys.find((k) => /json/.test(k)) ?? keys[0];
const isForm = (mt) => /x-www-form-urlencoded|multipart\/form-data/.test(mt ?? '');

export function createJava(spec, o) {
  // モデル名が予約語と衝突するときは Model を前に付ける (本家: ApiResponse → ModelApiResponse)。
  // Error など、他の名前は 7.26.0 で確認できたものだけをここに足す。
  const className = (schemaName) => {
    const c = camelize(schemaName);
    return JAVA_MODEL_RESERVED.has(c) ? `Model${c}` : c;
  };
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
          case 'uri': imports.add('java.net.URI'); return 'URI';
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
        if (schema.additionalProperties === true || schema.properties) { imports.add('java.util.Map'); return 'Map<String, Object>'; }
        return 'Object'; // 中身のない type: object は自由形式のオブジェクト (7.26.0)
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
    // 7.26.0: @Email が最初で、後ろにスペースが 1 つ付く (`@NotNull  @Email  @Size(max=40)`)
    if (s.type === 'string' && s.format === 'email') out += ' @Email ';
    if (s.type === 'string' && s.pattern) out += ` @Pattern(regexp="${escapeJava(s.pattern)}")`;
    const [lo, hi] = s.type === 'array' ? [s.minItems, s.maxItems] : [s.minLength, s.maxLength];
    if ((s.type === 'string' || s.type === 'array') && (lo !== undefined || hi !== undefined)) {
      if (lo !== undefined && hi !== undefined) out += ` @Size(min=${lo},max=${hi})`;
      else if (lo !== undefined) out += ` @Size(min=${lo})`;
      else out += ` @Size(max=${hi})`;
    }
    if (s.type === 'integer') {
      const L = s.format === 'int64' ? 'L' : '';
      if (s.minimum !== undefined) out += ` @Min(${s.minimum}${L})`;
      if (s.maximum !== undefined) out += ` @Max(${s.maximum}${L})`;
    } else if (s.type === 'number') {
      if (s.minimum !== undefined) out += s.exclusiveMinimum === true ? ` @DecimalMin(value="${s.minimum}",inclusive=false)` : ` @DecimalMin("${s.minimum}")`;
      if (s.maximum !== undefined) out += s.exclusiveMaximum === true ? ` @DecimalMax(value="${s.maximum}",inclusive=false)` : ` @DecimalMax("${s.maximum}")`;
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
    const vn = varName(propName);
    const Name = vn === 'propertyClass' ? 'PropertyClass' : upperFirstChar(camelize(propName) || 'Value');
    const isByteArray = resolved.type === 'string' && resolved.format === 'byte';
    const v = {
      baseName: propName,
      name: vn,
      eqFn: isByteArray ? 'Arrays' : 'Objects',
      hashExpr: isByteArray ? `Arrays.hashCode(${vn})` : vn,
      toStrExpr: resolved.type === 'string' && resolved.format === 'password' ? '"*"' : `toIndentedString(${vn})`,
      getter: 'get' + Name,
      setter: 'set' + Name,
      Name,
      required,
      description: docText(propSchema.description),
      descriptionJava: escapeJava(propSchema.description),
      minimum: !propSchema.$ref && ['integer', 'number'].includes(resolved.type) && resolved.minimum !== undefined ? String(resolved.minimum) : undefined,
      maximum: !propSchema.$ref && ['integer', 'number'].includes(resolved.type) && resolved.maximum !== undefined ? String(resolved.maximum) : undefined,
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
    // 7.26.0: フィールドには @Valid を付けない。getter はモデルそのものにだけ @Valid を付ける
    // (リスト/Map は要素の型 `List<@Valid Foo>` で示すので、コンテナ自体には付けない)
    v.fieldValid = false;
    // BigDecimal は組み込みの型として扱われず、getter に @Valid が付く
    const valid = !isContainer && (holdsModel(propSchema) || v.datatype === 'BigDecimal');
    v.getterPrefix = `${required ? '@NotNull ' : ''}${valid ? '@Valid ' : ''}${constraintsCore(propSchema)}`;
    v.deprecated = !!resolved.deprecated;
    // JsonNullable の import は、nullable かつ必須でないプロパティにだけ付く (7.26.0)
    if (resolved.nullable && !required && o.openApiNullable) imports.add('org.openapitools.jackson.nullable.JsonNullable');

    if (isContainer) {
      const isMap = v.datatype.startsWith('Map<');
      const impl = v.datatype.startsWith('Set<') ? 'LinkedHashSet' : isMap ? 'HashMap' : 'ArrayList';
      imports.add('java.util.' + impl);
      if (impl === 'ArrayList') imports.add('java.util.Arrays');
      v.defaultValue = `new ${impl}<>()`;
      v.isContainer = true;
      v.isMap = isMap;
      v.containerImpl = impl;
      if (impl === 'LinkedHashSet') {
        v.isSet = true;
        imports.add('com.fasterxml.jackson.databind.annotation.JsonDeserialize');
      }
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
    if (innerEnum) {
      const lit = (e) => (innerEnum.javaType === 'String' ? `String.valueOf(${e.literal})` : `${innerEnum.javaType}.valueOf(${e.literal})`);
      innerEnum.valuesLine = innerEnum.values.map((e) => `${e.name}(${lit(e)})`).join(', ') + ';';
      v.innerEnum = innerEnum;
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
        if (schema.oneOf || schema.anyOf) o.log(t('oneof_unsupported', { name: schemaName }));
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
          classname, schemaName, lcClassname: classname === camelize(schemaName) ? lowerFirstChar(classname) : '_' + lowerFirstChar(camelize(schemaName)),
          description: docText(schema.description), descriptionJava: escapeJava(schema.description), deprecated: !!schema.deprecated,
          vars, innerEnums, requiredVars, hasRequiredVars: requiredVars.length > 0,
          imports: [...imports].map((i) => (i.startsWith('model:') ? modelFq(i.slice(6)) : i)).sort(),
          hasVars: vars.length > 0,
        });
      }
    }
    return models;
  }

  // ---- オペレーション ----------------------------------------------------

  /**
   * 引数 1 つ分の宣言 (7.26.0 の書式)。
   *   フォーム以外: 注釈 + 型 + 名前 + 改行 (次の引数の前に "," が付く)
   *   フォーム    : 改行 + @FormParam(value = "名前")  型 名前 (末尾に改行なし)
   */
  function buildParam(p, ctx) {
    const imports = new Set();
    const schema = p.schema ?? { type: 'string' };
    const resolved = resolveRef(spec, schema);
    const isBinary = (s) => s?.type === 'string' && s.format === 'binary';
    // ファイル (または、ファイルの配列) は InputStream で受ける
    const isFile = isBinary(resolved) || (resolved.type === 'array' && isBinary(resolveRef(spec, resolved.items ?? {})));
    // 直接書かれた enum の型は、値の型 (整数なら Integer / Long)
    let type = resolved.enum && !schema.$ref ? typeOf({ ...resolved, enum: undefined }, imports) : typeOf(schema, imports);
    const required = p.in === 'path' || !!p.required;
    const name = varName(p.name);
    const base = { in: p.in, name, required, description: oneLine(p.description), imports };
    const dep = p.deprecated ? '@Deprecated ' : '';

    if (p.in === 'form') {
      if (isFile) {
        imports.add('java.io.InputStream');
        return { ...base, text: `\n${dep}@FormParam(value = "${escapeJava(p.name)}") InputStream ${name}InputStream` };
      }
      return { ...base, text: `\n${dep}@FormParam(value = "${escapeJava(p.name)}")  ${type} ${name}` };
    }
    if (p.in === 'path') {
      return { ...base, text: `${dep}@PathParam("${escapeJava(p.name)}") ${type} ${name}\n` };
    }
    // query / header / cookie: 注釈, 検証, 既定値, そして 3 つのスペースのあとに型と名前
    const anno = { query: 'QueryParam', header: 'HeaderParam', cookie: 'CookieParam' }[p.in];
    const validation = `${required ? ' @NotNull' : ''}${constraintsCore(schema)}`;
    const dv = resolved.default !== undefined && typeof resolved.default !== 'object' ? ` @DefaultValue("${escapeJava(resolved.default)}")` : '';
    return { ...base, text: `${dep}@${anno}("${escapeJava(p.name)}")${validation}${dv}   ${type} ${name}\n` };
  }

  function buildOperation(op) {
    const imports = new Set();
    // 引数の並び: パス / クエリ / ヘッダ / クッキー (仕様の順) → 本体 → フォーム。そのあと必須を先頭に寄せる (安定ソート)
    let params = [];
    for (const p of op.parameters) {
      if (!['path', 'query', 'header', 'cookie'].includes(p.in)) continue;
      params.push(buildParam(p));
    }

    const consumes = Object.keys(op.requestBody?.content ?? {});
    if (op.requestBody) {
      const mt = JSON_FIRST(consumes);
      const schema = op.requestBody.content?.[mt]?.schema;
      if (schema && isForm(mt)) {
        const flat = flatten(schema);
        for (const [pn, ps] of flat.props) {
          params.push(buildParam({ name: pn, in: 'form', schema: ps, required: flat.required.has(pn), description: resolveRef(spec, ps).description }));
        }
      } else if (schema) {
        const bImports = new Set();
        const t = typeOf(schema, bImports, false);
        const isContainer = isContainerSchema(schema);
        // 名前: x-codegen-request-body-name > モデルの $ref > 配列・Map は requestBody > それ以外は body
        const bodyName = op.raw['x-codegen-request-body-name']
          ?? (schema.$ref ? lowerFirstChar(className(refName(schema.$ref)))
            : schema.type === 'array' && schema.items?.$ref ? lowerFirstChar(className(refName(schema.items.$ref)))
              : isContainer ? 'requestBody' : 'body');
        const name = varName(bodyName);
        // コンテナ以外の本体は、型にかかわらず @Valid が付く (String や Object でも)
        const cons = [!isContainer ? '@Valid' : null, op.requestBody.required ? '@NotNull' : null].filter(Boolean);
        // 配列・Map の要素にあるモデルには、型の中で @Valid が付く
        const typeWithValid = isContainer ? typeOf(schema, bImports, true) : t;
        params.push({
          in: 'body', name, required: !!op.requestBody.required, description: oneLine(op.requestBody.description), imports: bImports,
          text: `${cons.length ? cons.join(' ') + ' ' : ''}${typeWithValid} ${name}\n`,
        });
      } else {
        const bImports = new Set(['java.io.InputStream']);
        params.push({ in: 'body', name: 'body', required: false, description: '', imports: bImports, text: 'InputStream body\n' });
      }
    }
    params = [...params.filter((p) => p.required), ...params.filter((p) => !p.required)];
    params.forEach((p) => p.imports.forEach((i) => imports.add(i)));

    // 戻り値: 最初の 2xx (なければ default) のスキーマの型。なければ void。interfaceOnly でなければ Response。
    const methodCode = Object.keys(op.responses).find((c) => /^2/.test(c)) ?? (op.responses.default ? 'default' : null);
    const mediaOf = (r) => r?.content?.[JSON_FIRST(Object.keys(r?.content ?? {}))];
    let returnType = 'void';
    const rs = mediaOf(methodCode && op.responses[methodCode])?.schema;
    if (rs) returnType = typeOf(rs, imports).replace(/@Valid /g, ''); // 戻り値の型には @Valid が付かない
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
      // 引数は "," でつなぐ。閉じ括弧の前の改行は、フォーム以外の引数が自分で持っている
      paramsDecl: params.map((p) => p.text).join(','),
      hasParams: params.length > 0,
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
      // 同じ API の中では operationId 順 (7.26.0)
      const built = [...ops].sort((x, y) => (varName(x.operationId) < varName(y.operationId) ? -1 : varName(x.operationId) > varName(y.operationId) ? 1 : 0)).map(buildOperation);
      // 共通のパス: すべてのオペレーションのパスに共通するセグメントの並び。1 つしかなければ、そのパス全体 (そのとき個別の @Path は付かない)
      let parts = built[0].path.split('/');
      for (const b of built.slice(1)) {
        const q = b.path.split('/');
        let i = 0;
        while (i < parts.length && i < q.length && parts[i] === q[i]) i++;
        parts = parts.slice(0, i);
      }
      const common = parts.join('/');
      built.forEach((b, i) => { b.subPath = b.path.slice(common.length) || null; b.notLast = i < built.length - 1; });
      const imports = new Set();
      built.forEach((b) => b.imports.forEach((i) => imports.add(i)));
      const baseName = key === 'default' ? 'Default' : camelize(key);
      return {
        classname: baseName + 'Api', baseName, commonPath: common || '/', operations: built,
        // 型の import とモデルの import は 1 つの並びで、クラス名 (パッケージを除いた名前) の順 (7.26.0)。
        // java.util.List は出さない (本家は除外する)。
        imports: [...imports]
          .map((i) => (i.startsWith('model:') ? modelFq(i.slice(6)) : i))
          .filter((i) => i !== 'java.util.List' && i !== 'java.io.InputStream')
          .sort((a, b) => {
            const sa = a.slice(a.lastIndexOf('.') + 1), sb = b.slice(b.lastIndexOf('.') + 1);
            return sa < sb ? -1 : sa > sb ? 1 : a < b ? -1 : a > b ? 1 : 0;
          }),
      };
    });
  }

  return { buildModels, buildApis };
}
