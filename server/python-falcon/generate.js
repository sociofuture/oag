// server/python-falcon: OpenAPI -> Falcon サーバー (ABC + router.py の register_routes)
// models.py / ABC / 方針は server/_python/common.js を参照。ここは router.py と runtime.py。
// 対応: Falcon 3 以降 (resp.status に int を使う)。multipart のファイル受信は未対応。
import { TEMPLATE_DIRS, commonOptions, guardWrite, pathWithPyNames, routerPrefix, writeBase } from '../_python/common.js';

export const meta = {
  description: 'Python Falcon server (操作ごとの ABC + router.py の register_routes。実装は手書きの _impl に置く)',
  templateDirs: TEMPLATE_DIRS,
  options: { ...commonOptions },
};

const q = (s) => JSON.stringify(s);

function extractLine(p, log) {
  const n = q(p.rawName);
  const opt = p.required ? '' : `, required=False, default=${p.defaultValue}`;
  let src;
  switch (p.in) {
    case 'path': return `${p.pyName} = parse(${p.rtype}, ${p.pyName}, ${n}, "path")`;
    case 'query': src = p.isList ? `req.get_param_as_list(${n})` : `req.get_param(${n})`; break;
    case 'header': src = `req.get_header(${n})`; break;
    case 'cookie': src = `req.cookies.get(${n})`; break;
    case 'form': src = `(req.get_media(default_when_empty=None) or {}).get(${n})`; break;
    case 'file':
      log(`ファイルパラメータ ${p.rawName} は未対応です (None が渡されます)`);
      return `${p.pyName} = None  # multipart のファイル受信は未対応`;
    default: return `${p.pyName} = parse(${p.rtype}, req.get_media(default_when_empty=None), ${n}, "body"${opt})`;
  }
  return `${p.pyName} = parse(${p.rtype}, ${src}, ${n}, "${p.in}"${opt})`;
}

export default async function generate({ spec, operations, options, render, write: rawWrite, log }) {
  const write = guardWrite(rawWrite, options.implPackage);
  const base = writeBase({ spec, operations, options, render, write, fileType: 'Any' });

  // Falcon は 1 つのパスに 1 つのリソースクラス (HTTP メソッドごとに on_xxx)。同じパスの操作をまとめる。
  const byPath = new Map();
  for (const op of base.ops) {
    const key = pathWithPyNames(op);
    if (!byPath.has(key)) byPath.set(key, []);
    byPath.get(key).push(op);
  }

  const resources = [...byPath].map(([path, ops]) => ({
    className: `${ops[0].abcName.replace(/Api$/, '')}Resource`,
    path: q(path),
    handlers: ops.map((op) => {
      const returnLines = [`resp.status = ${op.statusCode}`];
      if (op.responseClass === 'PlainTextResponse') returnLines.push('resp.content_type = "text/plain"', 'resp.text = result');
      else if (op.responseClass === 'Response') returnLines.push('resp.data = result');
      else if (op.returnR !== 'None') returnLines.push(`resp.media = dump(${op.returnR}, result)`);
      return {
        handler: `on_${op.httpMethod}`,
        implName: op.implName, methodName: op.methodName,
        pathArgs: op.params.filter((p) => p.in === 'path').map((p) => p.pyName),
        // 認証が必要な操作は、最初に手書きの verify_access_token(req) を呼ぶ (失敗は ApiError(401) などを raise)
        extract: [...(op.secured ? [{ line: 'auth = verify_access_token(req)' }] : []), ...op.params.map((p) => ({ line: extractLine(p, log) }))],
        call: [...(op.secured ? ['auth=auth'] : []), ...op.params.map((p) => `${p.pyName}=${p.pyName}`)].join(', '),
        returnLines,
      };
    }),
  }));

  write('runtime.py', render('runtime', base.common));
  write('router.py', render('router', {
    ...base.common,
    prefix: q(routerPrefix(spec, options, log)),
    abcImports: base.abcImports,
    implImports: base.implImports,
    anySecured: base.anySecured,
    authFrom: base.authImport.from,
    resources,
  }));
}
