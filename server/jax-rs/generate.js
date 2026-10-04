// server/jax-rs: OpenAPI -> Java JAX-RS (jaxrs-spec 相当) サーバースタブ
import { createJava } from './java.js';
import { t } from '../../lib/i18n.js';

// description は文字列か { en, ja }。`oag help <target>` で現在の言語のものが表示される。
export const meta = {
  description: {
    en: 'Java JAX-RS server (same output as the jaxrs-spec of openapi-generator 7.12.0)',
    ja: 'Java JAX-RS サーバー (openapi-generator 7.12.0 の jaxrs-spec と同じ出力)',
  },
  options: {
    apiPackage: { default: 'org.openapitools.api', description: { en: 'Package of the API classes', ja: 'API クラスのパッケージ' } },
    modelPackage: { default: 'org.openapitools.model', description: { en: 'Package of the model classes', ja: 'モデルクラスのパッケージ' } },
    invokerPackage: { default: '', description: { en: 'Package of RestApplication (default: parent of apiPackage)', ja: 'RestApplication のパッケージ (未指定なら apiPackage の親)' } },
    sourceFolder: { default: 'src/gen/java', description: { en: 'Output folder of the Java sources', ja: 'Java ソースの出力先' } },
    groupId: { default: 'org.openapitools', description: { en: 'groupId in pom.xml', ja: 'pom.xml の groupId' } },
    artifactId: { default: 'openapi-jaxrs-server', description: { en: 'artifactId in pom.xml', ja: 'pom.xml の artifactId' } },
    artifactVersion: { default: '1.0.0', description: { en: 'version in pom.xml', ja: 'pom.xml の version' } },
    dateLibrary: { default: 'java8', description: 'java8 (OffsetDateTime/LocalDate) | legacy (java.util.Date)' },
    useJakartaEe: { default: false, description: { en: 'Use jakarta.* instead of javax.*', ja: 'javax.* の代わりに jakarta.* を使う' } },
    useSwaggerAnnotations: { default: true, description: { en: 'Add io.swagger.annotations (@Api etc.)', ja: 'io.swagger.annotations (@Api 等) を付ける' } },
    useTags: { default: false, description: { en: 'Split API classes by tag (when false, by the first path segment)', ja: 'API クラスをタグで分ける (false ならパスの先頭セグメントで分ける)' } },
    interfaceOnly: { default: false, description: { en: 'Generate the API as an interface', ja: 'API を interface として生成する' } },
    generatePom: { default: true, description: { en: 'Write pom.xml', ja: 'pom.xml を出力する' } },
    hideGenerationTimestamp: { default: false, description: { en: 'Omit the date in @Generated', ja: '@Generated の date を出力しない' } },
  },
};

// ZonedDateTime.toString() 相当: 2026-10-04T11:18:14.749507200+09:00[Asia/Tokyo]
function zonedNow() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  const sign = off < 0 ? '-' : '+';
  const tz = `${sign}${p(Math.floor(Math.abs(off) / 60))}:${p(Math.abs(off) % 60)}`;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}000000${tz}[${zone}]`;
}

export default async function generate({ spec, operations, options, render, write, log }) {
  const o = {
    ...options,
    ws: options.useJakartaEe ? 'jakarta' : 'javax',
    invokerPackage: options.invokerPackage || options.apiPackage.replace(/\.[^.]*$/, ''),
    log,
  };
  const java = createJava(spec, o);
  const srcDir = (pkg) => `${o.sourceFolder}/${pkg.replace(/\./g, '/')}`;

  const stamp = o.hideGenerationTimestamp ? '' : `date = "${zonedNow()}", `;
  const common = {
    ws: o.ws,
    jakarta: o.useJakartaEe,
    swagger: o.useSwaggerAnnotations,
    interfaceOnly: o.interfaceOnly,
    // 空白だけの行はエディタに削られやすいので、テンプレートでは変数で出力する
    sp2: '  ',
    sp4: '    ',
    generatedAnnotation: `@${o.ws}.annotation.Generated(value = "org.openapitools.codegen.languages.JavaJAXRSSpecServerCodegen", ${stamp}comments = "Generator version: 7.12.0")`,
  };

  for (const m of java.buildModels()) {
    const view = { ...common, modelPackage: o.modelPackage, ...m };
    const tpl = m.isEnum ? 'enumClass' : 'model';
    write(`${srcDir(o.modelPackage)}/${m.classname}.java`, render(tpl, view));
  }

  for (const api of java.buildApis(operations)) {
    write(`${srcDir(o.apiPackage)}/${api.classname}.java`, render('api', { ...common, apiPackage: o.apiPackage, ...api }));
  }

  // 本家は interfaceOnly でも RestApplication / RestResourceRoot を出力する
  let basePath = '/';
  const server = spec.servers?.[0]?.url ?? '/';
  try {
    basePath = new URL(server, 'http://localhost').pathname.replace(/\/$/, '') || '/';
  } catch {
    log(t('servers_url_invalid', { server }));
  }
  const rest = { ...common, invokerPackage: o.invokerPackage, basePath };
  write(`${srcDir(o.invokerPackage)}/RestApplication.java`, render('restApplication', rest));
  write(`${srcDir(o.invokerPackage)}/RestResourceRoot.java`, render('restResourceRoot', rest));

  if (o.generatePom) {
    write('pom.xml', render('pom', {
      ...common,
      groupId: o.groupId, artifactId: o.artifactId, artifactVersion: o.artifactVersion,
      sourceFolder: o.sourceFolder, title: spec.info?.title ?? o.artifactId,
    }));
  }
}
