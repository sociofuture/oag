# TODO

[English](TODO.md) | **日本語**

既知の不足と、今後やることです。おおむね優先順に並べています。[README](README.ja.md#既知の制限) の「既知の制限」も参照してください。

## 1. `oneOf` / `anyOf` / `discriminator`

### 現状の動き (確認済み)

| 仕様 | Java (`server/jax-rs`) | TypeScript (`client/typescript-fetch`) | Python (`server/python-*`) |
| --- | --- | --- | --- |
| `oneOf` / `anyOf` だけのスキーマ (`properties` なし) | モデルは生成されない。使われる箇所はすべて `Object` | モデルは生成されない。すべて `any` | モデルは生成されない。すべて `Any` |
| プロパティの中にインラインで書かれた `oneOf` / `anyOf` | `Object` | `any` | `Any` |
| `properties` と `oneOf` / `anyOf` の併用 | プロパティだけ生成する。**警告が出る** | プロパティだけ生成する。警告なし | プロパティだけ生成する。警告なし |
| `discriminator` | 無視する | 無視する | 無視する |

失敗はしませんが、型の情報が **黙って失われます**。現状でいちばん良くない点です。

### やること

1. **手軽な改善: すべてのターゲットで警告する。** 既存の `oneof_unsupported` の警告を、TypeScript と Python でも出す。あわせて、`oneOf` / `anyOf` だけのスキーマでも出す (今は Java だけで、しかも「プロパティと `oneOf` の併用」のときだけ)。
2. **基準となる本家の出力を用意する。** Java と TypeScript は openapi-generator 7.12.0 と完全に一致させる必要がありますが、本家が `oneOf` / `anyOf` / `discriminator` をどう出力するかは、ここでは分かっていません。小さな仕様 (discriminator ありとなしの `oneOf`、`anyOf`、`oneOf` のプロパティ、`mapping` つきの discriminator) を作り、本家で生成して `tools/cmp.mjs` で比較できるようにします。Java と TypeScript の実装より先にやります。
3. **Python** (独自設計なので、基準の出力は不要)。pydantic v2 での対応案:
   - `oneOf` / `anyOf` → モデル、リクエストボディ、レスポンス、プロパティのどこでも union 型 (`A | B`)。
   - `discriminator` あり → `Annotated[A | B, Field(discriminator="kind")]`。`mapping` があれば反映する。
   - discriminator なし → pydantic 既定の smart モード。`oneOf` (ちょうど 1 つに一致) は、一致した数の確認が必要になるかもしれない。
   - ABC の型注釈と `router.py` も同じ union 型にする。
4. **TypeScript** (基準の出力が分かってから)。想定する形: `export type Animal = Cat | Dog;`。`AnimalFromJSON` / `AnimalToJSON` が、discriminator または `instanceOf...` で型を選ぶ。
5. **Java** (基準の出力が分かってから)。想定する形: `oneOf` のスキーマを interface または抽象クラスにする。discriminator には `@JsonTypeInfo` / `@JsonSubTypes` を使い、メンバーがそれを実装する。
6. **`discriminator` つきの `allOf`。** 今の `allOf` は常に平坦化しています。本家は discriminator があると継承 (`extends`) を使うので、基準の出力で確認する。

完了の目安: 対応する範囲のサンプル仕様で警告が出なくなり、Java と TypeScript の出力が本家と一致し、Python の各ターゲットで union の各メンバーをリクエストテストで受け付けて返せること。

## 2. 本家との一致を、ほかの機能にも広げる

本家との一致を確認できているのは、業務仕様が使う機能 (JSON ボディの POST、パラメータなし、enum なし) の範囲だけです。次は実装済みですが **未確認** で、確認には基準の出力が必要です。

- パス・クエリ・ヘッダ・クッキーのパラメータ (Java と TypeScript)
- enum (トップレベルとインライン) とその命名
- Javadoc / JSDoc に出る `description` / `summary` / `notes`
- `useSwaggerAnnotations=true`、`interfaceOnly=false`、`useTags=true`、`dateLibrary=legacy`、`useJakartaEe=false`
- `typescript-fetch` の `apiKey` / `basic` 認証
- フォームのボディとファイルアップロード (`multipart/form-data`)
- `readOnly` / `writeOnly`、`format: password`、`uniqueItems` (Set)、自由形式のオブジェクト、`additionalProperties`

これらを網羅した petstore 風の仕様を 1 つ作り、本家で生成した出力をリポジトリに置けば、大半をカバーでき、そのまま回帰テストにもなります (4 を参照)。

## 3. 入力の扱い

- 外部ファイルへの `$ref` (`other.yaml#/components/...`)。1 ファイルにまとめる処理、または仕様からの相対でファイルを読む処理が必要。
- Swagger 2.0 の入力 (OpenAPI 3 に変換する、または分かりやすい案内を出す)。
- ベンダー拡張 (`x-...`) は、Java の `x-codegen-request-body-name` 以外は無視している。

## 4. テストと CI

- `npm test` はまだ仮のままです。全ターゲットでサンプル仕様を生成し、コミットした期待出力と比べる回帰テストを足す (公開できる仕様と基準の出力が必要。業務仕様はコミットできない)。
- Python のリクエストテスト (手書きの `_impl` を書いて FastAPI / Flask / Falcon を動かすもの) は、いまリポジトリの外にあります。テスト用の requirements ファイルとあわせて、リポジトリに入れる。
- `--check` モード: 一時ディレクトリに生成し、コミット済みのファイルと違えば失敗にする。「生成物は人間が絶対に変更しない」を CI で守れる。

## 5. Python サーバー

- 生成されるファイルの中のコメント、docstring、エラーメッセージは日本語で、`--lang` には連動しません (どのマシンでも同じ出力にするため)。英語を既定にし、`-p comments=ja` のような明示的なオプションで日本語を選べるようにする。
- 認証は `security` のスキーマを区別しません。案: スキーマごとの検証関数 (`verify_<スキーマ名>`) を、操作の `security` から選んで呼ぶ。要求の OR / AND にも対応する。
- Falcon: `multipart/form-data` のファイルアップロードは未対応 (パラメータには `None` が渡る)。
- Flask: ファイルパラメータは `request.files` の値そのままで、型付きではない。
- モデルのフィールド名を、JSON の名前ではなく snake_case にするオプション (alias つき)。
- 足りない `_impl` の雛形を 1 回だけ作る別コマンド (上書きは決してしない)。「生成物は変更しない」を守るため、`generate` とは分ける。

## 6. その他

- `Generator version: 7.12.0` と `.openapi-generator/VERSION` を、設定で変えられるようにする (例: `-p generatorVersionLabel=...`)。本家の出力に合わせるためだけに出している値なので。
- Java: `nullable` なプロパティは無視している (`JsonNullable` は生成しない)。
- `tools/cmp.mjs` のメッセージは日本語のみ。
