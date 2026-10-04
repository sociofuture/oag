# oag

OpenAPI (3.x) の YAML から、サーバー/クライアントのスタブを生成するツールです。
`openapi-generator-cli` の置き換えを目的にしています。Java は不要で、Node.js だけで動きます。

## 基本方針

1. **生成したファイルは、人間が絶対に変更しない。**
   変更したいときは OpenAPI 仕様を直して再生成します。手書きのコードは生成物とは別の場所 (`_impl` など) に置きます。
2. **再生成が簡単に行える。**
   生成は毎回、対象ファイルをすべて上書きします。前回の生成物を消す処理はありません (仕様から消えたスキーマのファイルは残ります。必要なら手で消してください)。
3. **Java JAX-RS と TypeScript fetch は、openapi-generator 7.12.0 と同じ出力。**
   Python 系 (FastAPI / Flask / Falcon) は独自設計です。
4. **ターゲットの追加・変更が簡単。** `server/<名前>/` や `client/<名前>/` にディレクトリを置くだけです。

## インストール

### 必要なもの

- Node.js 20 以降 (動作確認は 24) と npm
- git
- 依存パッケージは `yaml` と `mustache` のみです。Java や Python は **oag を動かすだけなら不要** です (生成したコードをビルド・実行するときに、それぞれ必要になります)。

### 手順

```bash
git clone https://github.com/sociofuture/oag.git
cd oag
npm install
node oag.js list        # ターゲットの一覧が出れば成功
```

更新するときは、`git pull` のあとに `npm install` をやり直します。

```bash
cd oag
git pull
npm install
```

### `oag` コマンドとして使う (任意)

`package.json` に `bin` を定義してあるので、`node oag.js` の代わりに `oag` というコマンドで呼べるようにできます。

```bash
cd oag
npm link                # clone したディレクトリを、グローバルの oag コマンドとして登録する
oag list
oag generate -i openapi/api.yml -g client/typescript-fetch -o ./frontend/src/openapi
```

- `npm link` は clone したディレクトリへのリンクを張るだけなので、更新は `git pull` と `npm install` だけで反映されます。
- 解除は `npm unlink -g oag` です。
- GitHub から直接インストールすることもできます (リポジトリにアクセスできる認証が必要です)。この場合の更新は、同じコマンドをもう一度実行します。

  ```bash
  npm install -g github:sociofuture/oag
  ```

以降の説明は `node oag.js ...` の書き方ですが、`oag ...` と書き換えても同じです。

## 最初に試す

同梱のサンプル仕様 (`examples/petstore.yaml`) で、各ターゲットを生成してみます。`out/` は `.gitignore` に入っています。

```bash
node oag.js generate -i examples/petstore.yaml -g server/jax-rs         -o out/java
node oag.js generate -i examples/petstore.yaml -g client/typescript-fetch -o out/ts
node oag.js generate -i examples/petstore.yaml -g server/python-fastapi -o out/py
```

`N ファイルを生成しました -> <出力先>` と表示されれば成功です。出力先のファイルを開いて、内容を確認してください。

## 自分のプロジェクトから使う

oag は、プロジェクトに組み込むのではなく、clone した場所の `oag.js` を呼び出して使います。プロジェクト側のディレクトリで、`oag.js` のパスを指定して実行します。

```bash
# 例: oag を ~/tools/oag に clone してある場合
cd ~/work/my-project
node ~/tools/oag/oag.js generate -i openapi/api.yml -g client/typescript-fetch -o ./frontend/src/openapi
```

`npm link` で `oag` コマンドを登録してあれば、パスの指定は要りません (`oag generate -i ...`)。

毎回パスを書くのが面倒なら、プロジェクトの `makefile` などにまとめます。

```makefile
OAG = node ../oag/oag.js

generate:
	$(OAG) generate -i openapi/api.yml -g server/jax-rs -o ./backend-java -p interfaceOnly=true,useJakartaEe=true,apiPackage=com.example.api,modelPackage=com.example.model
	$(OAG) generate -i openapi/api.yml -g client/typescript-fetch -o ./frontend/src/openapi
```

- 生成物は毎回すべて上書きされます。生成先に手で書いたコードを置かないでください (Python の `_impl` は、生成先の外に置きます)。
- 仕様を直したら、同じコマンドをもう一度実行するだけで再生成できます。
- `-o` の出力先が存在しなくても、自動で作られます。
- 本書のコマンド例は bash の書き方です。PowerShell で複数行に分けるときは、行末の `\` を `` ` `` (バッククォート) にしてください。

### うまくいかないとき

| 症状 | 原因と対処 |
| --- | --- |
| `未知のターゲット: ...` と出る | `-g` は `server/jax-rs` のように `種類/名前` で指定します。`node oag.js list` で確認してください |
| `未知のオプション: ...` と出る | `-p` の名前が違います。`node oag.js help <ターゲット>` で有効なオプションが分かります |
| `OpenAPI 3.x のみ対応しています` | Swagger 2.0 (`swagger: "2.0"`) は未対応です。OpenAPI 3 に変換してください |
| `外部ファイルへの $ref は未対応です` | 仕様を 1 ファイルにまとめてください (`$ref` は `#/...` のみ) |
| `operationId が重複しています` (Python) | 操作ごとに一意の `operationId` を付けてください |
| `SyntaxError` などで起動しない | Node.js が古い可能性があります。`node -v` で 20 以降か確認してください |

## 使い方

```bash
node oag.js list                                # 利用できるターゲット
node oag.js help <ターゲット>                    # ターゲットのオプション一覧
node oag.js generate -i <spec.yaml> -g <ターゲット> -o <出力先> [-p k=v,k=v] [-t <テンプレートdir>]
```

| 引数 | 内容 |
| --- | --- |
| `-i` | OpenAPI 仕様 (YAML / JSON)。OpenAPI 3.x のみ対応 |
| `-g` | ターゲット。`server/jax-rs` のようにディレクトリ名で指定 |
| `-o` | 出力先ディレクトリ |
| `-p` | ターゲット固有のオプション (カンマ区切りの `キー=値`)。openapi-generator の `--additional-properties` に相当 |
| `-t` | テンプレートの上書きディレクトリ。同名の `.mustache` があればそちらを優先して使う |

### 利用できるターゲット

| ターゲット | 内容 | 出力の基準 |
| --- | --- | --- |
| `server/jax-rs` | Java JAX-RS サーバー (jaxrs-spec 互換) | openapi-generator 7.12.0 と同一 |
| `client/typescript-fetch` | TypeScript fetch クライアント | openapi-generator 7.12.0 と同一 |
| `server/python-fastapi` | Python FastAPI サーバー | 独自設計 |
| `server/python-flask` | Python Flask サーバー | 独自設計 |
| `server/python-falcon` | Python Falcon サーバー | 独自設計 |

### 生成コマンドの例

```bash
# Java JAX-RS (openapi-generator -g jaxrs-spec と同じオプション)
node oag.js generate -i openapi/api.yml -g server/jax-rs -o ./backend-java \
  -p dateLibrary=java8,interfaceOnly=true,useSwaggerAnnotations=false,useJakartaEe=true,generatePom=false,apiPackage=com.example.api,modelPackage=com.example.model

# TypeScript fetch (オプションなし)
node oag.js generate -i openapi/api.yml -g client/typescript-fetch -o ./frontend/src/openapi

# Python FastAPI (生成物は app/generated に出し、手書きの app/_impl を隣に置く)
node oag.js generate -i openapi/api.yml -g server/python-fastapi -o ./backend-py/app/generated
```

## ディレクトリ構成

```
oag.js                    CLI。ターゲットの解決・出力の書き込み
lib/                       ターゲットに依存しない共通部分
  spec.js                    仕様の読み込み、$ref の解決
  operations.js              paths から operation を平坦化
  inline.js                  インラインのオブジェクトスキーマを components に昇格
  schema.js                  スキーマの種類判定 (enum/model/alias)、allOf の平坦化
  template.js                mustache の描画器
  naming.js                  camelize / snake など
  javacompat.js              Java の HashSet の反復順を再現 (TypeScript の import 順に必要)
server/
  jax-rs/                    generate.js, java.js, templates/
  _python/                   Python 3 ターゲット共通 (py.js, common.js, templates/)
  python-fastapi/            generate.js, templates/router.mustache
  python-flask/              generate.js, templates/router.mustache
  python-falcon/             generate.js, templates/router.mustache
client/
  typescript-fetch/          generate.js, ts.js, templates/
tools/cmp.mjs              本家の出力との比較 (開発用)
examples/                  サンプル仕様 (petstore.yaml)
```

`server/_python/` のように `generate.js` を持たないディレクトリは、ターゲットとして扱われません。

## 共通の処理

どのターゲットも、生成の前に次の処理を通ります。

- **`$ref` の解決**: ローカル参照 (`#/...`) のみ。外部ファイルへの参照は未対応で、エラーになります。
- **インラインスキーマの昇格** (openapi-generator の InlineModelResolver 相当): 次の名前で `components.schemas` に追加し、`$ref` に置き換えます。

  | 場所 | スキーマ名 | 例 |
  | --- | --- | --- |
  | requestBody | `<operationId>_request` | `AddPet` → `AddPetRequest` |
  | response | `<operationId>_<code>_response` | |
  | プロパティ | `<親スキーマ名>_<プロパティ名>` | `Pet_owner` → `PetOwner` |
  | 配列の要素 | `<親スキーマ名>_<プロパティ名>_inner` | |

  フォーム (`x-www-form-urlencoded` / `multipart/form-data`) のボディは昇格せず、個別のパラメータに展開します。
- **`allOf`**: 継承にせず、プロパティを平坦化して 1 つのモデルにします。`required` は和集合です。
- **`operationId` が無い場合**: `<パス>` + `<メソッド>` から作ります (`/pet/{petId}` の get → `petPetIdGet`)。

---

## server/jax-rs

Java JAX-RS (jaxrs-spec) のサーバースタブです。openapi-generator 7.12.0 の出力と、実際の業務仕様 (非公開) で **全ファイルが一致** することを確認しています (比較は `@Generated` の日時のみ無視)。確認の範囲は [動作確認](#動作確認-開発用) を参照してください。

### オプション (`-p`)

| オプション | 既定値 | 内容 |
| --- | --- | --- |
| `apiPackage` | `org.openapitools.api` | API クラスのパッケージ |
| `modelPackage` | `org.openapitools.model` | モデルクラスのパッケージ |
| `invokerPackage` | (apiPackage の親) | `RestApplication` / `RestResourceRoot` のパッケージ |
| `sourceFolder` | `src/gen/java` | Java ソースの出力先 |
| `dateLibrary` | `java8` | `java8` (`OffsetDateTime` / `LocalDate`) または `legacy` (`java.util.Date`) |
| `useJakartaEe` | `false` | `javax.*` の代わりに `jakarta.*` を使う |
| `useSwaggerAnnotations` | `true` | `io.swagger.annotations` を付ける |
| `useTags` | `false` | API クラスをタグで分ける。`false` ならパスの先頭セグメントで分ける |
| `interfaceOnly` | `false` | API を interface として生成する |
| `generatePom` | `true` | `pom.xml` を出力する |
| `groupId` / `artifactId` / `artifactVersion` | `org.openapitools` / `openapi-jaxrs-server` / `1.0.0` | `pom.xml` の値 |
| `hideGenerationTimestamp` | `false` | `@Generated` の `date` を出力しない |

### 出力

- 既定ではパスの先頭セグメントごとに API クラスができます (`/pet` → `PetApi`、`/health-check` → `HealthCheckApi`)。
- 戻り値はスキーマの型です (なければ `void`)。`interfaceOnly=false` のときだけ `Response` を返す本体 (`"magic!"`) が出ます。
- `RestApplication` と `RestResourceRoot` は `interfaceOnly` でも出力します。`@ApplicationPath` は `servers[0].url` のパスです。
- `@Generated` には `Generator version: 7.12.0` と実行時刻が入ります。本家と同一にするための固定文字列で、このツールが本家であることを意味しません。

---

## client/typescript-fetch

TypeScript の fetch クライアントです。openapi-generator 7.12.0 の `typescript-fetch` (オプションなし) の出力と、実際の業務仕様 (非公開) で **全ファイルが一致** することを確認しています。確認の範囲は [動作確認](#動作確認-開発用) を参照してください。

オプションはありません。

### 出力

```
apis/<タグ>Api.ts       タグごとの API クラス。操作は operationId 順
apis/index.ts
models/<モデル>.ts       interface と FromJSON / ToJSON 関数
models/index.ts
runtime.ts              BASE_PATH は servers[0].url
index.ts
.openapi-generator-ignore
.openapi-generator/FILES      生成したファイルの一覧
.openapi-generator/VERSION    7.12.0 固定
```

- プロパティ名は lowerCamelCase、JSON のキーは元の名前のままです (`PetName` → `petName`)。
- 日付 (`date` / `date-time`) は `Date` 型で、`date` の `toJSON` は `toISOString().substring(0,10)` です。
- 必須で `nullable` のプロパティの型は `T | null` になります (JSDoc の `@type` には付きません)。配列の要素が `nullable` なら `Array<T | null>` です。
- モデルの import の並びは、本家の Java `HashSet` の反復順 (名前順でも出現順でもない) を再現しています。
- `.openapi-generator/` の 3 ファイルは、再生成で git の差分にならないよう、本家と同じ内容を出力します。

---

## Python サーバー (FastAPI / Flask / Falcon)

3 つのターゲットは **同じ設計** で、違うのは `router.py` (と Flask/Falcon の `runtime.py`) だけです。
`openapi-generator` の Python サーバーは、生成されたファイルに実装を書き足す方式のため再生成できません。このツールは **生成物と手書きを分離** します。

### 構成

```
app/                      ← 手書きの領域 (Python パッケージ)
  __init__.py
  _impl/                  ← 手書き専用。oag は生成しない・上書きしない・削除しない
    __init__.py
    auth.py                 AuthInfo と verify_access_token (認証が必要な操作がある場合)
    add_pet.py              class AddPetApiImpl(AddPetApi)
  generated/              ← -o の出力先。丸ごと消して再生成してよい
    __init__.py
    models.py               pydantic v2 のモデル (enum を含む)
    router.py               ルート定義。_impl を登録する
    runtime.py              (Flask / Falcon のみ) 検証・変換のヘルパ
    apis/
      __init__.py
      add_pet_api.py        操作ごとの ABC
```

- `generated/` は `app/` の下に置き、`app.generated` として import できる形にしてください (`router.py` が `from .._impl.xxx import ...` と親パッケージを参照します)。
- `python generated/router.py` のような直接実行はできません。
- `makefile` で出力先を `rm -rf` しても、`_impl` は出力先の外なので消えません。

### 規約 (名前は固定)

| 項目 | 規約 | 例 |
| --- | --- | --- |
| ABC のクラス | `<OperationId>Api` | `AddPetApi` |
| ABC のファイル | `apis/<operationId の snake_case>_api.py` | `apis/add_pet_api.py` |
| 実装のクラス | `<ABC 名>Impl` | `AddPetApiImpl` |
| 実装のファイル | `_impl/<operationId の snake_case>.py` | `_impl/add_pet.py` |
| メソッド名 | operationId の snake_case | `add_pet` |
| 認証 | `_impl/auth.py` の `AuthInfo` と `verify_access_token` | 下記 |

`operationId` が重複していると、生成時にエラーになります。

### 実装の書き方

生成される ABC (同期の `def`):

```python
class AddPetApi(ABC):
    @abstractmethod
    def add_pet(self, auth: AuthInfo, pet: Pet) -> Pet: ...
```

手書きの実装 (`_impl/add_pet.py`):

```python
from ..generated.apis.add_pet_api import AddPetApi
from ..generated.models import Pet
from .auth import AuthInfo


class AddPetApiImpl(AddPetApi):
    def add_pet(self, auth: AuthInfo, pet: Pet) -> Pet:
        ...
        return pet.model_copy(update={"id": 1})
```

- メソッドの引数は、パス・クエリ・ヘッダ・クッキー・フォーム・ボディの順ではなく、**必須 → 任意** の順です (Python の引数順の制約)。呼び出しはすべてキーワード引数です。
- 新しい操作が仕様に増えたのに実装を書き忘れた場合、`router.py` の import でエラーになります。Flask / Falcon は `verify()` で「未実装のメソッドがあります: ○○」と分かりやすく報告します。

### 認証

`security` が必須の操作 (`op.security`、無ければ全体の `security`) にだけ、認証情報が渡されます。`security: []` や、空の要求 `{}` を含む操作は認証不要として扱います。

`_impl/auth.py` に `AuthInfo` と `verify_access_token` を書きます。

FastAPI (`Depends` として使われるので、`HTTPBearer` などをそのまま使えます):

```python
from dataclasses import dataclass
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer


@dataclass
class AuthInfo:
    email: str


_bearer = HTTPBearer(auto_error=False)


def verify_access_token(credentials: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> AuthInfo:
    if credentials is None:
        raise HTTPException(status_code=401, detail="missing token")
    claims = decode_jwt(credentials.credentials)   # 検証は自分で実装する
    return AuthInfo(email=claims["email"])
```

生成される `router.py`:

```python
def add_pet(pet: models.Pet,
            auth: AuthInfo = Depends(verify_access_token),
            impl: AddPetApi = Depends(AddPetApiImpl)) -> models.Pet:
    return impl.add_pet(auth=auth, pet=pet)
```

Flask / Falcon は `Depends` が無いので、最初に `verify_access_token(request)` (Falcon は `req`) を呼びます。失敗させるときは `ApiError(401, "...")` を raise します。

```python
from ..generated.runtime import ApiError

def verify_access_token(request) -> AuthInfo:       # Falcon は (req)
    if request.headers.get("Authorization") != "Bearer ...":
        raise ApiError(401, "invalid token")
    return AuthInfo(...)
```

- 認証が必要な操作が 1 つでもあると、`_impl/auth.py` が無い場合は import でエラーになります。
- `security` のスキーマ (Bearer / apiKey など) は区別せず、`verify_access_token` 1 本に集約します。
- 仕様のパラメータ名が `auth` だと `auth_` になります (予約のため)。

### モデル (`models.py`)

- pydantic v2 の `BaseModel`。フィールド名は **JSON の名前のまま** です (snake_case にはしません)。
- 必須でないフィールドは `T | None = None` (既定値があれば、その値)。
- 制約を `Field(...)` に反映します: `minLength` / `maxLength` / `pattern` / `minimum` / `maximum` (`exclusive*` も) / `minItems` / `maxItems`、`description`。
- Python として使えない名前 (予約語など) や、モデル名・import 名 (`datetime`、`Any` など) と衝突する名前には `_` を付け、`alias` で JSON の名前を保ちます。この場合 `populate_by_name=True` を付けます。
- enum は `class Status(str, Enum)` です。プロパティ内の enum は `<モデル名><プロパティ名>Enum` になります。
- 型の対応: `string` → `str`、`date` → `datetime.date`、`date-time` → `datetime.datetime`、`uuid` → `uuid.UUID`、`byte` / `binary` → `bytes`、配列 → `list[T]` (`uniqueItems` なら `set[T]`)、`additionalProperties` → `dict[str, T]`、`nullable` → `T | None`。
- 前方参照・循環参照は、末尾の `model_rebuild()` で解決します。

### オプション (`-p`)

| オプション | 既定値 | 内容 |
| --- | --- | --- |
| `implPackage` | `.._impl` | 実装クラスのパッケージ。`.._impl` は出力先の 1 つ上、`._impl` は出力先の直下、`.` で始まらなければ絶対 import (例: `myapp._impl`) |
| `basePath` | (`servers[0].url` のパス) | ルートの prefix |

`implPackage=._impl` (出力先の直下) にした場合は、その下への書き込みを拒否するガードが働きます。

### FastAPI (`server/python-fastapi`)

- `router.py` に `router = APIRouter(prefix=...)` と、操作ごとの `@router.<method>(...)` があります。
- 実装は `impl: <ABC> = Depends(<Impl>)` で差し込まれます。`<Impl>.__init__` の引数にも `Depends(...)` が使えます (DB セッションなど)。
- `response_model`、`status_code`、`tags`、`summary`、`operation_id`、`deprecated`、成功以外の `responses` を設定します。
- パス・クエリ・ヘッダ・クッキー・フォームは `Annotated[T, Path()/Query()/Header()/Cookie()/Form()]`、ファイルは `UploadFile` です。クエリの `default` と制約も反映します。
- フォームを使う操作がある場合は、別途 `python-multipart` が必要です。
- 起動: `app.include_router(router)`。

### Flask (`server/python-flask`)

- `router.py` に `router = Blueprint("api", ...)`。起動: `app.register_blueprint(router)`。
- 入力の検証・変換は `runtime.py` の `parse()` (pydantic の `TypeAdapter`)。不正なら `ApiError(422)` で、`{"detail": [...]}` を返します。
- 出力は `dump()` で JSON にします。モデルのインスタンスを返してください。
- 実装クラスはリクエストごとに **引数なしで** 生成されます (`Depends` による注入はありません)。
- ファイルパラメータは `request.files` の値がそのまま渡されます。

### Falcon (`server/python-falcon`)

- `router.py` に `register_routes(app, prefix=...)`。起動: `register_routes(falcon.App())`。
- 同じパスの操作は 1 つのリソースクラスにまとまります (`on_get` / `on_post`)。
- そのほかは Flask と同じです (`runtime.py`、引数なしの実装生成、422 の形式)。
- Falcon 3 以降が前提です (`resp.status` に int を使う)。
- **multipart のファイル受信は未対応** です。ファイルパラメータには `None` が渡され、生成時に警告が出ます。

### 動作要件

- Python 3.10 以上 (`X | None`、`list[str]` の記法)。
- 実際に動かして確認済み: Python 3.14 / FastAPI 0.142 / pydantic 2.13 / Falcon 4.4 / Flask。

---

## テンプレート

各ターゲットの `templates/*.mustache` (mustache 形式) で出力の形を決めます。

- `-t <dir>` に同名の `.mustache` を置くと、ターゲット内蔵のものより優先されます。
- テンプレートは任意です。`generate.js` がテンプレートを使わず、文字列を直接組み立ててもかまいません。
- 複数ターゲットで共有するテンプレートは、`generate.js` の `meta.templateDirs` (ターゲットからの相対パス) で宣言します。Python 系が `server/_python/templates` を共有しています。
- エスケープは無効です (コード生成のため)。
- 空白だけの行はエディタに削られやすいので、テンプレートでは `{{{sp2}}}` のような変数で出力している箇所があります。

## ターゲットの追加

`server/<名前>/generate.js` または `client/<名前>/generate.js` を作ると、`node oag.js list` に現れます。

```js
export const meta = {
  description: '説明',
  templateDirs: [],                       // 共有テンプレート (任意)
  options: {                              // -p で渡せるオプション。default の型で変換される
    foo: { default: 'bar', description: '...' },
    flag: { default: false, description: '...' },   // boolean は true/false で渡す
  },
};

export default async function generate({ spec, operations, options, render, write, log }) {
  // spec        : 読み込み済みの OpenAPI。インラインスキーマは昇格済み
  // operations  : { path, method, operationId, tags, summary, description, deprecated,
  //                 parameters, requestBody, responses, security, raw } の配列
  //               ($ref は解決済み。スキーマ内の $ref はモデル名を保つため残る)
  // options     : -p の値 (既定値を含む)
  // render(name, view) : テンプレートを描画する (name は拡張子なし)
  // write(relPath, content) : 出力先からの相対パスに書く。出力先の外には書けない
  // log(message) : 警告の表示
}
```

## 動作確認 (開発用)

本家 (openapi-generator 7.12.0) の出力が手元にあれば、ファイル単位で比較できます。`@Generated` の日時だけは無視します。

```bash
node tools/cmp.mjs <本家の出力> <oag の出力> [表示する差分ファイル数] [名前フィルタ]
```

Java JAX-RS と TypeScript fetch は、実際の業務仕様 (140 操作・約 300 モデル規模) で、本家の出力と **全ファイルが一致** することを確認しました。この仕様と本家の出力は非公開のため、リポジトリには含めていません。自分の仕様で確認するときは、同じ仕様を本家で生成し、`tools/cmp.mjs` で比較してください。

Python 系は、同じ業務仕様と、petstore に認証を足した仕様で動作確認をしました。

- 手書きの `_impl` を書き、FastAPI の `TestClient` / Flask の `test_client` / `falcon.testing` でリクエストを通す。
- 正常系 (ボディ → モデル → JSON、クエリの配列・既定値、パス・ヘッダ、フォーム、void) と、異常系 (必須欠落・型違い・制約違反は 422、認証なしは 401) を確認。
- 業務仕様では、全ルートの登録と、FastAPI の OpenAPI 生成を確認。

リポジトリに含まれる `examples/petstore.yaml` で、各ターゲットの生成と、生成物の構文チェックができます。

## 既知の制限

- `oneOf` / `anyOf` / `discriminator` は未対応です (プロパティのみ生成し、警告します)。
- 外部ファイルへの `$ref` は未対応です。
- 本家との一致を確認できているのは、上記の業務仕様が使う機能の範囲です。パスパラメータ・クエリ・ヘッダ・enum・description・`useSwaggerAnnotations=true`・`interfaceOnly=false` などは実装済みですが、本家の出力との一致は未確認です。
- Python サーバーの認証 (`security`) は、スキーマごとの区別をしません。
- `server/jax-rs` と `client/typescript-fetch` の出力に含まれる `7.12.0` は、本家と同一にするための固定値です。
