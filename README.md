# oag

**English** | [日本語](README.ja.md)

A tool that generates server/client stubs from an OpenAPI (3.x) YAML file.
It is meant as a replacement for `openapi-generator-cli`. It needs no Java — Node.js is enough.

## Principles

1. **Generated files are never edited by hand.**
   To change something, fix the OpenAPI spec and regenerate. Hand-written code lives apart from the generated code (for example in `_impl`).
2. **Regeneration is easy.**
   Every run overwrites all target files. Nothing from a previous run is deleted (files for schemas removed from the spec stay; delete them by hand if needed).
3. **Java JAX-RS and TypeScript fetch produce the same output as openapi-generator 7.12.0.**
   The Python targets (FastAPI / Flask / Falcon) have their own design.
4. **Targets are easy to add and change.** Just put a directory under `server/<name>/` or `client/<name>/`.

## Installation

### Requirements

- Node.js 20 or later (tested on 24) and npm
- git
- The only dependencies are `yaml` and `mustache`. Java and Python are **not needed just to run oag** (you need them only to build/run the generated code).

### Steps

```bash
git clone https://github.com/sociofuture/oag.git
cd oag
npm install
node oag.js list        # success if the list of targets is printed
```

To update, run `git pull` and then `npm install` again.

```bash
cd oag
git pull
npm install
```

### Using it as the `oag` command (optional)

`package.json` defines `bin`, so you can call `oag` instead of `node oag.js`.

```bash
cd oag
npm link                # registers the cloned directory as the global `oag` command
oag list
oag generate -i openapi/api.yml -g client/typescript-fetch -o ./frontend/src/openapi
```

- `npm link` only creates a link to the cloned directory, so updates take effect with just `git pull` and `npm install`.
- To remove it, run `npm unlink -g oag`.
- You can also install directly from GitHub (this needs credentials that can access the repository). To update, run the same command again.

  ```bash
  npm install -g github:sociofuture/oag
  ```

The rest of this document writes commands as `node oag.js ...`; `oag ...` works the same way.

## Try it first

Generate each target from the bundled sample spec (`examples/petstore.yaml`). `out/` is in `.gitignore`.

```bash
node oag.js generate -i examples/petstore.yaml -g server/jax-rs         -o out/java
node oag.js generate -i examples/petstore.yaml -g client/typescript-fetch -o out/ts
node oag.js generate -i examples/petstore.yaml -g server/python-fastapi -o out/py
```

If `N file(s) generated -> <output dir>` is printed, it worked. Open the files in the output directory to check them.

## Using it from your own project

oag is not embedded in your project; you call the `oag.js` of the directory you cloned. Run it from your project's directory, giving the path to `oag.js`.

```bash
# Example: oag is cloned at ~/tools/oag
cd ~/work/my-project
node ~/tools/oag/oag.js generate -i openapi/api.yml -g client/typescript-fetch -o ./frontend/src/openapi
```

If you registered the `oag` command with `npm link`, no path is needed (`oag generate -i ...`).

To avoid typing the path every time, put the commands in your project's `makefile` or similar.

```makefile
OAG = node ../oag/oag.js

generate:
	$(OAG) generate -i openapi/api.yml -g server/jax-rs -o ./backend-java -p interfaceOnly=true,useJakartaEe=true,apiPackage=com.example.api,modelPackage=com.example.model
	$(OAG) generate -i openapi/api.yml -g client/typescript-fetch -o ./frontend/src/openapi
```

- Generated files are overwritten every time. Do not put hand-written code in the output directory (for Python, keep `_impl` outside it).
- After changing the spec, just run the same command again to regenerate.
- The output directory is created automatically if it does not exist.
- The command examples use bash syntax. In PowerShell, when splitting a command over several lines, replace the trailing `\` with `` ` `` (backtick).

### Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `Unknown target: ...` | `-g` takes `kind/name`, such as `server/jax-rs`. Check with `node oag.js list` |
| `Unknown option: ...` | The `-p` name is wrong. `node oag.js help <target>` lists the valid options |
| `only OpenAPI 3.x is supported` | Swagger 2.0 (`swagger: "2.0"`) is not supported. Convert it to OpenAPI 3 |
| `A $ref to an external file is not supported` | Put the spec in a single file (only `#/...` references are supported) |
| `Duplicate operationId` (Python targets) | Give each operation a unique `operationId` |
| Fails to start with `SyntaxError` etc. | Node.js may be too old. Check that `node -v` is 20 or later |

## Usage

```bash
node oag.js list                                # available targets
node oag.js help <target>                       # options of a target
node oag.js generate -i <spec.yaml> -g <target> -o <output dir> [-p k=v,k=v] [-t <template dir>]
```

| Argument | Meaning |
| --- | --- |
| `-i` | OpenAPI spec (YAML / JSON). OpenAPI 3.x only |
| `-g` | Target, given as the directory name, e.g. `server/jax-rs` |
| `-o` | Output directory |
| `-p` | Target-specific options (comma-separated `key=value`). Corresponds to `--additional-properties` of openapi-generator |
| `-t` | Template override directory. A `.mustache` file with the same name takes precedence |
| `--lang` | Language of the messages: `en` or `ja` (see below) |

### Language of the messages

The messages the command prints (usage, errors, warnings, the result line, and the descriptions shown by `help <target>`) are available in English (`en`) and Japanese (`ja`). The language is chosen in this order:

1. `--lang en` / `--lang ja`
2. The environment variable `OAG_LANG` (`en` or `ja`)
3. The locale: `LC_ALL`, `LC_MESSAGES`, `LANG`, and then the OS locale. A language other than `ja` gives `en`
4. `en`

```bash
node oag.js generate -i openapi/api.yml -g server/jax-rs -o ./backend-java --lang ja
OAG_LANG=ja node oag.js help server/jax-rs       # bash
$env:OAG_LANG = "ja"                             # PowerShell (for the current session)
```

The language only affects what the command prints. **The generated files are identical whichever language is selected.**

### Available targets

| Target | Description | Output reference |
| --- | --- | --- |
| `server/jax-rs` | Java JAX-RS server (jaxrs-spec compatible) | Identical to openapi-generator 7.12.0 |
| `client/typescript-fetch` | TypeScript fetch client | Identical to openapi-generator 7.12.0 |
| `server/python-fastapi` | Python FastAPI server | Own design |
| `server/python-flask` | Python Flask server | Own design |
| `server/python-falcon` | Python Falcon server | Own design |

### Command examples

```bash
# Java JAX-RS (same options as openapi-generator -g jaxrs-spec)
node oag.js generate -i openapi/api.yml -g server/jax-rs -o ./backend-java \
  -p dateLibrary=java8,interfaceOnly=true,useSwaggerAnnotations=false,useJakartaEe=true,generatePom=false,apiPackage=com.example.api,modelPackage=com.example.model

# TypeScript fetch (no options)
node oag.js generate -i openapi/api.yml -g client/typescript-fetch -o ./frontend/src/openapi

# Python FastAPI (output to app/generated, with a hand-written app/_impl next to it)
node oag.js generate -i openapi/api.yml -g server/python-fastapi -o ./backend-py/app/generated
```

## Directory layout

```
oag.js                     CLI. Resolves the target and writes the output
lib/                       Parts shared by all targets
  spec.js                    Loads the spec, resolves $ref
  operations.js              Flattens paths into operations
  inline.js                  Promotes inline object schemas to components
  schema.js                  Classifies schemas (enum/model/alias), flattens allOf
  template.js                mustache renderer
  naming.js                  camelize / snake, etc.
  i18n.js                    Messages of the CLI (en / ja) and language detection
  javacompat.js              Reproduces the iteration order of Java's HashSet (needed for TypeScript import order)
server/
  jax-rs/                    generate.js, java.js, templates/
  _python/                   Shared by the Python targets (py.js, common.js, templates/)
  python-fastapi/            generate.js, templates/router.mustache
  python-flask/              generate.js, templates/router.mustache
  python-falcon/             generate.js, templates/router.mustache
client/
  typescript-fetch/          generate.js, ts.js, templates/
tools/cmp.mjs              Comparison with openapi-generator output (for development)
examples/                  Sample spec (petstore.yaml)
```

A directory without `generate.js`, such as `server/_python/`, is not treated as a target.

## Common processing

Every target goes through the following before generation.

- **`$ref` resolution**: local references (`#/...`) only. References to external files are not supported and cause an error.
- **Promoting inline schemas** (equivalent to openapi-generator's InlineModelResolver): they are added to `components.schemas` under the names below and replaced with a `$ref`.

  | Where | Schema name | Example |
  | --- | --- | --- |
  | requestBody | `<operationId>_request` | `AddPet` → `AddPetRequest` |
  | response | `<operationId>_<code>_response` | |
  | property | `<parent schema>_<property>` | `Pet_owner` → `PetOwner` |
  | array item | `<parent schema>_<property>_inner` | |

  Form bodies (`x-www-form-urlencoded` / `multipart/form-data`) are not promoted; they are expanded into individual parameters.
- **`allOf`**: no inheritance; the properties are flattened into a single model. `required` is the union.
- **Missing `operationId`**: built from `<path>` + `<method>` (get on `/pet/{petId}` → `petPetIdGet`).

---

## server/jax-rs

A Java JAX-RS (jaxrs-spec) server stub. It has been confirmed that the output is **identical for every file** to openapi-generator 7.12.0 on a real business spec (not public); the comparison ignores only the `@Generated` timestamp. See [Verification](#verification-for-development) for the scope of that confirmation.

### Options (`-p`)

| Option | Default | Meaning |
| --- | --- | --- |
| `apiPackage` | `org.openapitools.api` | Package of the API classes |
| `modelPackage` | `org.openapitools.model` | Package of the model classes |
| `invokerPackage` | (parent of apiPackage) | Package of `RestApplication` / `RestResourceRoot` |
| `sourceFolder` | `src/gen/java` | Output folder of the Java sources |
| `dateLibrary` | `java8` | `java8` (`OffsetDateTime` / `LocalDate`) or `legacy` (`java.util.Date`) |
| `useJakartaEe` | `false` | Use `jakarta.*` instead of `javax.*` |
| `useSwaggerAnnotations` | `true` | Add `io.swagger.annotations` |
| `useTags` | `false` | Split API classes by tag. When `false`, split by the first path segment |
| `interfaceOnly` | `false` | Generate the API as an interface |
| `generatePom` | `true` | Write `pom.xml` |
| `groupId` / `artifactId` / `artifactVersion` | `org.openapitools` / `openapi-jaxrs-server` / `1.0.0` | Values in `pom.xml` |
| `hideGenerationTimestamp` | `false` | Omit the `date` in `@Generated` |

### Output

- By default one API class is created per first path segment (`/pet` → `PetApi`, `/health-check` → `HealthCheckApi`).
- The return type is the schema type (`void` if none). Only with `interfaceOnly=false` is a body that returns a `Response` (`"magic!"`) emitted.
- `RestApplication` and `RestResourceRoot` are written even with `interfaceOnly`. `@ApplicationPath` is the path of `servers[0].url`.
- `@Generated` contains `Generator version: 7.12.0` and the run time. This is a fixed string used to match openapi-generator exactly; it does not mean this tool is openapi-generator.

---

## client/typescript-fetch

A TypeScript fetch client. It has been confirmed that the output is **identical for every file** to `typescript-fetch` of openapi-generator 7.12.0 (no options) on a real business spec (not public). See [Verification](#verification-for-development) for the scope of that confirmation.

There are no options.

### Output

```
apis/<Tag>Api.ts        One API class per tag. Operations are in operationId order
apis/index.ts
models/<Model>.ts       Interface plus FromJSON / ToJSON functions
models/index.ts
runtime.ts              BASE_PATH is servers[0].url
index.ts
.openapi-generator-ignore
.openapi-generator/FILES      List of generated files
.openapi-generator/VERSION    Fixed to 7.12.0
```

- Property names are lowerCamelCase; JSON keys keep their original names (`PetName` → `petName`).
- Dates (`date` / `date-time`) are `Date`; `toJSON` of `date` is `toISOString().substring(0,10)`.
- A required, `nullable` property has the type `T | null` (not in the JSDoc `@type`). If an array item is `nullable`, it is `Array<T | null>`.
- The order of model imports reproduces the iteration order of Java's `HashSet` (neither alphabetical nor order of appearance).
- The three files in `.openapi-generator/` are written with the same content as openapi-generator, so regeneration does not show up as a git diff.

---

## Python servers (FastAPI / Flask / Falcon)

The three targets share **the same design**; only `router.py` (and `runtime.py` for Flask/Falcon) differ.
The Python servers of `openapi-generator` have you add the implementation to generated files, so they cannot be regenerated. This tool **separates generated code from hand-written code**.

### Layout

```
app/                      ← hand-written area (a Python package)
  __init__.py
  _impl/                  ← hand-written only. oag never generates, overwrites or deletes here
    __init__.py
    auth.py                 AuthInfo and verify_access_token (when some operations need authentication)
    add_pet.py              class AddPetApiImpl(AddPetApi)
  generated/              ← the -o output directory. Safe to delete entirely and regenerate
    __init__.py
    models.py               pydantic v2 models (including enums)
    router.py               Route definitions. Registers _impl
    runtime.py              (Flask / Falcon only) validation / conversion helpers
    apis/
      __init__.py
      add_pet_api.py        One ABC per operation
```

- Put `generated/` under `app/` so that it can be imported as `app.generated` (`router.py` refers to `from .._impl.xxx import ...`, i.e. the parent package).
- It cannot be run directly, e.g. `python generated/router.py`.
- Even if a `makefile` runs `rm -rf` on the output directory, `_impl` survives because it is outside it.

### Conventions (names are fixed)

| Item | Convention | Example |
| --- | --- | --- |
| ABC class | `<OperationId>Api` | `AddPetApi` |
| ABC file | `apis/<operationId in snake_case>_api.py` | `apis/add_pet_api.py` |
| Implementation class | `<ABC name>Impl` | `AddPetApiImpl` |
| Implementation file | `_impl/<operationId in snake_case>.py` | `_impl/add_pet.py` |
| Method name | operationId in snake_case | `add_pet` |
| Authentication | `AuthInfo` and `verify_access_token` in `_impl/auth.py` | see below |

Duplicate `operationId`s cause an error at generation time.

### Writing an implementation

The generated ABC (synchronous `def`):

```python
class AddPetApi(ABC):
    @abstractmethod
    def add_pet(self, auth: AuthInfo, pet: Pet) -> Pet: ...
```

The hand-written implementation (`_impl/add_pet.py`):

```python
from ..generated.apis.add_pet_api import AddPetApi
from ..generated.models import Pet
from .auth import AuthInfo


class AddPetApiImpl(AddPetApi):
    def add_pet(self, auth: AuthInfo, pet: Pet) -> Pet:
        ...
        return pet.model_copy(update={"id": 1})
```

- Method parameters are ordered **required → optional**, not path/query/header/cookie/form/body (a Python constraint on parameter order). Calls always use keyword arguments.
- If an operation is added to the spec but you forget to implement it, the import of `router.py` fails. Flask / Falcon report it clearly through `verify()`: "未実装のメソッドがあります: ..." (there are unimplemented methods).

### Authentication

Authentication information is passed only to operations that require `security` (`op.security`, otherwise the global `security`). An operation with `security: []`, or with an empty requirement `{}`, is treated as not requiring authentication.

Write `AuthInfo` and `verify_access_token` in `_impl/auth.py`.

FastAPI (it is used as a `Depends`, so `HTTPBearer` and the like work as they are):

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
    claims = decode_jwt(credentials.credentials)   # implement the verification yourself
    return AuthInfo(email=claims["email"])
```

The generated `router.py`:

```python
def add_pet(pet: models.Pet,
            auth: AuthInfo = Depends(verify_access_token),
            impl: AddPetApi = Depends(AddPetApiImpl)) -> models.Pet:
    return impl.add_pet(auth=auth, pet=pet)
```

Flask / Falcon have no `Depends`, so `verify_access_token(request)` (`req` for Falcon) is called first. To reject a request, raise `ApiError(401, "...")`.

```python
from ..generated.runtime import ApiError

def verify_access_token(request) -> AuthInfo:       # (req) for Falcon
    if request.headers.get("Authorization") != "Bearer ...":
        raise ApiError(401, "invalid token")
    return AuthInfo(...)
```

- If even one operation requires authentication, a missing `_impl/auth.py` makes the import fail.
- `security` schemes (Bearer / apiKey, etc.) are not distinguished; they all go through the single `verify_access_token`.
- A spec parameter named `auth` becomes `auth_` (the name is reserved).

### Models (`models.py`)

- pydantic v2 `BaseModel`. Field names are **the JSON names as they are** (not converted to snake_case).
- Non-required fields are `T | None = None` (or the default value if there is one).
- Constraints are reflected in `Field(...)`: `minLength` / `maxLength` / `pattern` / `minimum` / `maximum` (and `exclusive*`) / `minItems` / `maxItems`, `description`.
- A name that is not usable in Python (reserved words, etc.) or that collides with a model or import name (`datetime`, `Any`, ...) gets a trailing `_`, and an `alias` keeps the JSON name. In that case `populate_by_name=True` is added.
- An enum is `class Status(str, Enum)`. An enum inside a property is named `<Model><Property>Enum`.
- Type mapping: `string` → `str`, `date` → `datetime.date`, `date-time` → `datetime.datetime`, `uuid` → `uuid.UUID`, `byte` / `binary` → `bytes`, array → `list[T]` (`set[T]` for `uniqueItems`), `additionalProperties` → `dict[str, T]`, `nullable` → `T | None`.
- Forward and circular references are resolved by `model_rebuild()` at the end.

### Options (`-p`)

| Option | Default | Meaning |
| --- | --- | --- |
| `implPackage` | `.._impl` | Package of the implementation classes. `.._impl` is one level above the output directory, `._impl` is directly under it, and anything not starting with `.` is an absolute import (e.g. `myapp._impl`) |
| `basePath` | (path of `servers[0].url`) | Route prefix |

With `implPackage=._impl` (directly under the output directory), a guard refuses to write anything below it.

### FastAPI (`server/python-fastapi`)

- `router.py` has `router = APIRouter(prefix=...)` and one `@router.<method>(...)` per operation.
- The implementation is injected with `impl: <ABC> = Depends(<Impl>)`. The `__init__` arguments of `<Impl>` can also use `Depends(...)` (for a DB session, etc.).
- It sets `response_model`, `status_code`, `tags`, `summary`, `operation_id`, `deprecated`, and the non-success `responses`.
- Path/query/header/cookie/form parameters are `Annotated[T, Path()/Query()/Header()/Cookie()/Form()]`; files are `UploadFile`. Query `default` and constraints are reflected too.
- If any operation uses a form, `python-multipart` is required separately.
- Start-up: `app.include_router(router)`.

### Flask (`server/python-flask`)

- `router.py` has `router = Blueprint("api", ...)`. Start-up: `app.register_blueprint(router)`.
- Input is validated and converted by `parse()` in `runtime.py` (pydantic `TypeAdapter`). Invalid input raises `ApiError(422)` and returns `{"detail": [...]}`.
- Output is turned into JSON by `dump()`. Return model instances.
- The implementation class is created for every request **with no arguments** (no injection with `Depends`).
- A file parameter receives the value of `request.files` as it is.

### Falcon (`server/python-falcon`)

- `router.py` has `register_routes(app, prefix=...)`. Start-up: `register_routes(falcon.App())`.
- Operations on the same path are grouped into one resource class (`on_get` / `on_post`).
- Everything else is the same as Flask (`runtime.py`, argument-less creation of the implementation, the 422 format).
- Falcon 3 or later is required (`resp.status` is set to an int).
- **Receiving files via multipart is not supported.** File parameters receive `None`, and a warning is printed at generation time.

### Requirements

- Python 3.10 or later (the `X | None` and `list[str]` syntax).
- Verified by actually running: Python 3.14 / FastAPI 0.142 / pydantic 2.13 / Falcon 4.4 / Flask.

---

## Templates

The shape of the output is defined by the `templates/*.mustache` files of each target (mustache format).

- A `.mustache` file with the same name placed in the directory given with `-t <dir>` takes precedence over the one built into the target.
- Templates are optional. `generate.js` may build strings directly without using any template.
- Templates shared by several targets are declared in `meta.templateDirs` of `generate.js` (paths relative to the target). The Python targets share `server/_python/templates`.
- Escaping is disabled (this is code generation).
- Lines containing only whitespace are easily stripped by editors, so some places in the templates emit them with variables such as `{{{sp2}}}`.

## Adding a target

Create `server/<name>/generate.js` or `client/<name>/generate.js` and it shows up in `node oag.js list`.

```js
export const meta = {
  description: { en: 'Description', ja: '説明' },   // a string, or { en, ja } (shown by `help <target>`)
  templateDirs: [],                       // shared templates (optional)
  options: {                              // options accepted by -p; converted by the type of default
    foo: { default: 'bar', description: { en: '...', ja: '...' } },
    flag: { default: false, description: '...' },   // pass booleans as true/false
  },
};

export default async function generate({ spec, operations, options, render, write, log }) {
  // spec        : the loaded OpenAPI. Inline schemas are already promoted
  // operations  : array of { path, method, operationId, tags, summary, description, deprecated,
  //                          parameters, requestBody, responses, security, raw }
  //               ($ref is resolved; $ref inside schemas is kept so that model names survive)
  // options     : the values of -p (including defaults)
  // render(name, view) : renders a template (name without extension)
  // write(relPath, content) : writes to a path relative to the output directory. Cannot write outside it
  // log(message) : prints a warning
}
```

Messages that `generate.js` shows to the user should go through `t(key, params)` of `lib/i18n.js`, with the English and Japanese text added to its catalog (for example `log(t('servers_url_invalid', { server }))`). Do not let the language change the generated files.

## Verification (for development)

If you have the output of openapi-generator 7.12.0, you can compare it file by file. Only the `@Generated` timestamp is ignored.

```bash
node tools/cmp.mjs <openapi-generator output> <oag output> [number of diff files to show] [name filter]
```

For Java JAX-RS and TypeScript fetch, it was confirmed on a real business spec (not public) that **every file is identical** to the output of openapi-generator. That spec and its output are not public, so they are not in this repository. To check against your own spec, generate the same spec with openapi-generator and compare with `tools/cmp.mjs`.

The Python targets were checked with the same business spec and with petstore plus authentication.

- Write a hand-written `_impl` and send requests through FastAPI's `TestClient`, Flask's `test_client` and `falcon.testing`.
- Checked the normal cases (body → model → JSON, query arrays and defaults, path and header, forms, void) and the error cases (missing required value, wrong type and constraint violation give 422; no authentication gives 401).
- With the business spec, the registration of all routes and FastAPI's OpenAPI generation were checked.

With `examples/petstore.yaml`, included in this repository, you can generate each target and syntax-check the generated code.

## Known limitations

- `oneOf` / `anyOf` / `discriminator` are not supported (only the properties are generated, with a warning).
- `$ref` to an external file is not supported.
- The match with openapi-generator is confirmed only for the features used by the business spec above. Path/query/header parameters, enums, descriptions, `useSwaggerAnnotations=true`, `interfaceOnly=false` and so on are implemented, but their match with openapi-generator's output is unverified.
- Authentication (`security`) of the Python servers does not distinguish between schemes.
- The comments, docstrings and error messages written inside the generated Python files are in Japanese. `--lang` does not change them, so that the output stays the same on every machine.
- The `7.12.0` in the output of `server/jax-rs` and `client/typescript-fetch` is a fixed value used to match openapi-generator exactly.
