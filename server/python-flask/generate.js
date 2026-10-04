// server/python-flask: OpenAPI -> Flask サーバー (ABC + router.py の Blueprint)
// models.py / ABC / 方針は server/_python/common.js を参照。ここは router.py と runtime.py。
import { TEMPLATE_DIRS, commonOptions, guardWrite, pathWithPyNames, routerPrefix, writeBase } from '../_python/common.js';

export const meta = {
  description: {
    en: 'Python Flask server (one ABC per operation + a Blueprint in router.py; implementations go in a hand-written _impl)',
    ja: 'Python Flask サーバー (操作ごとの ABC + router.py の Blueprint。実装は手書きの _impl に置く)',
  },
  templateDirs: TEMPLATE_DIRS,
  options: { ...commonOptions },
};

const q = (s) => JSON.stringify(s);

// リクエストから値を取り出して検証する Python の 1 行
function extractLine(p) {
  const n = q(p.rawName);
  const opt = p.required ? '' : `, required=False, default=${p.defaultValue}`;
  let src;
  switch (p.in) {
    case 'path': return `${p.pyName} = parse(${p.rtype}, ${p.pyName}, ${n}, "path")`;
    case 'query': src = p.isList ? `request.args.getlist(${n}) or None` : `request.args.get(${n})`; break;
    case 'header': src = `request.headers.get(${n})`; break;
    case 'cookie': src = `request.cookies.get(${n})`; break;
    case 'form': src = p.isList ? `request.form.getlist(${n}) or None` : `request.form.get(${n})`; break;
    case 'file': return `${p.pyName} = request.files.get(${n})`;
    default: return `${p.pyName} = parse(${p.rtype}, request.get_json(silent=True), ${n}, "body"${opt})`;
  }
  return `${p.pyName} = parse(${p.rtype}, ${src}, ${n}, "${p.in === 'form' ? 'form' : p.in}"${opt})`;
}

export default async function generate({ spec, operations, options, render, write: rawWrite, log }) {
  const write = guardWrite(rawWrite, options.implPackage);
  const base = writeBase({ spec, operations, options, render, write, fileType: 'Any' });

  const routes = base.ops.map((op) => {
    let returnLine;
    if (op.responseClass === 'PlainTextResponse') returnLine = `return Response(result, status=${op.statusCode}, mimetype="text/plain")`;
    else if (op.responseClass === 'Response') returnLine = `return Response(result, status=${op.statusCode})`;
    else if (op.returnR === 'None') returnLine = `return "", ${op.statusCode}`;
    else returnLine = `return jsonify(dump(${op.returnR}, result)), ${op.statusCode}`;
    return {
      method: op.httpMethod.toUpperCase(),
      path: q(pathWithPyNames(op).replace(/\{([^}]+)\}/g, '<$1>')),
      methodName: op.methodName, implName: op.implName,
      viewArgs: op.params.filter((p) => p.in === 'path').map((p) => p.pyName).join(', '),
      // 認証が必要な操作は、最初に手書きの verify_access_token(request) を呼ぶ (失敗は ApiError(401) などを raise)
      extract: [...(op.secured ? [{ line: 'auth = verify_access_token(request)' }] : []), ...op.params.map((p) => ({ line: extractLine(p) }))],
      call: [...(op.secured ? ['auth=auth'] : []), ...op.params.map((p) => `${p.pyName}=${p.pyName}`)].join(', '),
      returnLine,
    };
  });

  write('runtime.py', render('runtime', base.common));
  write('router.py', render('router', {
    ...base.common,
    prefix: q(routerPrefix(spec, options, log)),
    abcImports: base.abcImports,
    implImports: base.implImports,
    anySecured: base.anySecured,
    authFrom: base.authImport.from,
    routes,
  }));
}
