// CLI の表示言語 (en / ja)。
// 生成物の内容は言語に依存させない (同じ仕様から、誰が実行しても同じファイルができるようにする)。
// ここで切り替わるのは、コマンドが画面に出すメッセージだけ。

export const SUPPORTED = ['en', 'ja'];

const MESSAGES = {
  usage: {
    en: `Usage:
  oag list
  oag help [<target>]
  oag generate -i <spec.yaml> -g <kind/name> -o <outDir> [-p key=value,key=value] [-t <templateDir>] [--lang en|ja]

  -i      OpenAPI spec (YAML / JSON, OpenAPI 3.x)
  -g      Target (e.g. server/jax-rs)
  -o      Output directory
  -p      Target-specific options (comma-separated). 'oag help <target>' lists them
  -t      Template override directory (a .mustache file with the same name takes precedence)
  --lang  Language of messages: en or ja (default: OAG_LANG, then the OS locale, then en)
`,
    ja: `使い方:
  oag list
  oag help [<ターゲット>]
  oag generate -i <spec.yaml> -g <種類/名前> -o <出力先> [-p key=value,key=value] [-t <テンプレートdir>] [--lang en|ja]

  -i      OpenAPI 仕様 (YAML / JSON、OpenAPI 3.x)
  -g      ターゲット (例: server/jax-rs)
  -o      出力先ディレクトリ
  -p      ターゲット固有のオプション (カンマ区切り)。'oag help <ターゲット>' で一覧
  -t      テンプレート上書きディレクトリ (同名の .mustache を優先して使う)
  --lang  メッセージの言語: en または ja (既定: 環境変数 OAG_LANG、OS のロケール、en の順)
`,
  },
  unknown_target: { en: 'Unknown target: {id}\nAvailable: {available}', ja: '未知のターゲット: {id}\n利用可能: {available}' },
  none: { en: '(none)', ja: '(なし)' },
  unknown_option: { en: 'Unknown option: {name} (valid: {valid})', ja: '未知のオプション: {name} (有効: {valid})' },
  unknown_command: { en: 'Unknown command: {cmd}\n{usage}', ja: '未知のコマンド: {cmd}\n{usage}' },
  missing_arg: { en: '--{name} is required\n{usage}', ja: '--{name} が必要です\n{usage}' },
  unsupported_lang: { en: 'Unsupported language: {lang} (supported: {supported})', ja: '未対応の言語です: {lang} (対応: {supported})' },
  outside_output: { en: 'Cannot write outside the output directory: {path}', ja: '出力先の外には書けません: {path}' },
  help_options: { en: 'Options:', ja: 'オプション:' },
  help_default: { en: 'default', ja: '既定' },
  help_no_options: { en: '(no options)', ja: '(オプションなし)' },
  generated: { en: '{count} file(s) generated -> {dir}', ja: '{count} ファイルを生成しました -> {dir}' },
  template_not_found: { en: 'Template not found: {name}.mustache (searched: {dirs})', ja: 'テンプレートが見つかりません: {name}.mustache (検索先: {dirs})' },
  spec_unreadable: { en: '{file}: cannot read the spec', ja: '{file}: 仕様を読み込めません' },
  spec_version: { en: '{file}: only OpenAPI 3.x is supported (openapi: {version})', ja: '{file}: OpenAPI 3.x のみ対応しています (openapi: {version})' },
  not_specified: { en: 'not specified', ja: '未指定' },
  external_ref: { en: 'A $ref to an external file is not supported: {ref}', ja: '外部ファイルへの $ref は未対応です: {ref}' },
  ref_unresolved: { en: 'Cannot resolve $ref: {ref}', ja: '$ref を解決できません: {ref}' },
  ref_circular: { en: '$ref is circular: {ref}', ja: '$ref が循環しています: {ref}' },
  servers_url_invalid: { en: 'Cannot parse servers[0].url: {server}', ja: 'servers[0].url を解釈できません: {server}' },
  duplicate_operation_id: { en: 'Duplicate operationId: {id}', ja: 'operationId が重複しています: {id}' },
  unknown_model_type: { en: 'Unknown modelType: {value} (valid: {valid})', ja: '未知の modelType: {value} (有効: {valid})' },
  impl_dir_guard: { en: '{path}: {dir}/ is for hand-written code only, so nothing is generated there', ja: '{path}: {dir}/ は手書き専用なので生成しません' },
  file_param_unsupported: { en: 'File parameter {name} is not supported (None is passed)', ja: 'ファイルパラメータ {name} は未対応です (None が渡されます)' },
  oneof_unsupported: { en: '{name}: oneOf/anyOf is not supported, so only the properties are generated', ja: '{name}: oneOf/anyOf は未対応のためプロパティのみ生成します' },
};

let lang = 'en';

/** 環境から言語を決める: OAG_LANG > LC_ALL > LC_MESSAGES > LANG > OS のロケール > en */
export function detectLang(env = process.env) {
  for (const key of ['OAG_LANG', 'LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const v = env[key];
    if (!v || v === 'C' || v === 'POSIX') continue;
    const code = v.slice(0, 2).toLowerCase();
    return SUPPORTED.includes(code) ? code : 'en';
  }
  try {
    const code = Intl.DateTimeFormat().resolvedOptions().locale.slice(0, 2).toLowerCase();
    return SUPPORTED.includes(code) ? code : 'en';
  } catch {
    return 'en';
  }
}

export function setLang(value) {
  const code = String(value).slice(0, 2).toLowerCase();
  if (!SUPPORTED.includes(code) || String(value).length > 5) {
    lang = 'en';
    throw new Error(t('unsupported_lang', { lang: value, supported: SUPPORTED.join(', ') }));
  }
  lang = code;
}

export const getLang = () => lang;

/** メッセージを取り出して {name} を置き換える */
export function t(key, params = {}) {
  const m = MESSAGES[key];
  if (!m) return key;
  return (m[lang] ?? m.en).replace(/\{(\w+)\}/g, (_, k) => (params[k] === undefined ? `{${k}}` : String(params[k])));
}

/** meta の説明文など: 文字列ならそのまま、{ en, ja } なら現在の言語のものを返す */
export function tr(value) {
  if (value == null || typeof value === 'string') return value ?? '';
  return value[lang] ?? value.en ?? '';
}
