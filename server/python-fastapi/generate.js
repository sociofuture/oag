// server/python-fastapi: OpenAPI -> FastAPI サーバー (ABC + router.py)
// models.py / ABC / 方針は server/_python/common.js を参照。ここは router.py だけ。
import { TEMPLATE_DIRS, commonOptions, guardWrite, pathWithPyNames, routerPrefix, writeBase } from '../_python/common.js';

export const meta = {
  description: {
    en: 'Python FastAPI server (one ABC per operation + router.py; implementations go in a hand-written _impl)',
    ja: 'Python FastAPI サーバー (操作ごとの ABC + router.py。実装は手書きの _impl に置く)',
  },
  templateDirs: TEMPLATE_DIRS,
  options: { ...commonOptions },
};

export default async function generate({ spec, operations, options, render, write: rawWrite, log }) {
  const write = guardWrite(rawWrite, options.implPackage);
  const base = writeBase({ spec, operations, options, render, write, fileType: 'UploadFile', pydanticAlias: true });

  const routes = base.ops.map((op) => {
    const modelResp = op.returnR !== 'None' && !op.responseClass;
    const dec = [
      JSON.stringify(pathWithPyNames(op)),
      `response_model=${modelResp ? op.returnR : 'None'}`,
      `status_code=${op.statusCode}`,
      `tags=${JSON.stringify([op.tags[0]])}`,
      ...(op.summary ? [`summary=${JSON.stringify(op.summary)}`] : []),
      ...(op.description ? [`description=${JSON.stringify(op.description)}`] : []),
      `operation_id=${JSON.stringify(op.operationId)}`,
      ...(op.deprecated ? ['deprecated=True'] : []),
      ...(op.responseClass ? [`response_class=${op.responseClass}`] : []),
      ...(op.extraResponses.length ? [`responses={${op.extraResponses.join(', ')}}`] : []),
    ];
    const argDecl = op.params.map((p) => {
      const alias = `alias=${JSON.stringify(p.rawName)}`;
      const cons = (p.constraints ?? []).join(', ');
      const args = (...a) => a.concat(cons ? [cons] : []).join(', ');
      const loc = {
        path: `Path(${args()})`, query: `Query(${args(alias)})`, header: `Header(${args(alias)})`,
        cookie: `Cookie(${args(alias)})`, form: `Form(${args(alias)})`, file: 'File()',
      }[p.in];
      const ann = loc ? `Annotated[${p.rtype}, ${loc}]` : p.rtype;
      return `${p.pyName}: ${ann}${p.required ? '' : ` = ${p.defaultValue}`}`;
    });
    // 認証が必要な操作だけ、手書きの verify_access_token を Depends で呼び、結果を実装に渡す
    if (op.secured) argDecl.push('auth: AuthInfo = Depends(verify_access_token)');
    argDecl.push(`impl: ${op.abcName} = Depends(${op.implName})`);
    return {
      method: op.httpMethod, decorator: dec.map((d) => ({ d })), args: argDecl.map((d) => ({ d })),
      methodName: op.methodName, returnType: op.returnR,
      call: [...(op.secured ? ['auth=auth'] : []), ...op.params.map((p) => `${p.pyName}=${p.pyName}`)].join(', '),
    };
  });

  write('router.py', render('router', {
    ...base.common,
    prefix: routerPrefix(spec, options, log),
    abcImports: base.abcImports,
    implImports: base.implImports,
    anySecured: base.anySecured,
    authFrom: base.authImport.from,
    routes,
  }));
}
