# Phase 02. `skm secret get --field` 와 기밀 데이터 JSON 해석 모듈

**Execution profile**: standard

## 목표

값이 JSON 객체인 기밀 데이터에서 최상위 필드 하나의 값만 stdout 에 내는 `skm secret get <key-id> --field <name>` 을 더한다.
JSON 객체 판정과 정밀도를 잃는 숫자 검사는 새 모듈 `src/commands/skm/secret-json.ts` 에 두고 phase 03 의 `secret patch` 가 이어서 쓴다.

**범위 외**: `secret patch` 와 다시 쓰기, 해시 대조(phase 03). 프록시(phase 01). `--field` 없는 `secret get` 의 출력은 바꾸지 않는다.

## 컨텍스트

- 기존 명령은 `src/commands/skm/secret.ts` 의 `getCommand` 다. `parseRequiredArgument`(`src/commands/parse-options.ts`), `parseMacAddressOption`, `resolveSkmClient`, `withSkmSpinner`, `formatCell`, `printSkmValue`(`src/commands/skm/helpers.ts`)를 쓴다.
- `printSkmValue(opts, value, raw)` 는 `--json` 이면 `raw` 를, `--quiet` 이면 `value + "\n"` 을, 기본 출력이면 터미널 제어 문자를 바꾼 `value` 와 줄바꿈을 쓴다(ADR-039).
- `client.getSecret(keyId)` 는 `GET /secrets/{keyid}` 응답의 `body.secret` 문자열을 돌려준다. 공식 문서(일반망, 공공망 API v1.3)에 쿼리 파라미터가 없고, 삭제 예약된 키는 조회할 수 없다.
- 기존 `secret get` 테스트는 `src/commands/skm/data.test.ts` 에 있다. `resolveSkmClient` 를 `vi.mock` 으로 바꾸고 `vi.spyOn(client, "getSecret")` 으로 응답을 준다. 새 테스트도 이 파일에 더한다.
- `JSON.parse` 의 오류 문구는 입력 일부를 담는다. 오류에 실으면 비밀값이 stderr 로 나간다.

**근거 문서**: `docs/adr/045-skm-secret-field-patch.md`, `docs/flow.md` 의 「기밀 데이터 필드 수정」 절, `docs/adr/039-skm-client-auth-and-secret-output.md`

## 의도 메모

- 점 표기 경로(`a.b`)를 해석하지 않는다. 필드 이름은 최상위 키 그대로다. 앞뒤 공백도 지우지 않는다.
- 필드 존재는 `Object.hasOwn` 으로 본다. `in` 이나 `obj[field] !== undefined` 는 `__proto__`, `toString` 같은 이름에서 틀린다.
- 문자열이 아닌 필드는 `JSON.stringify` 로 출력한다. 이때 원문에 정밀도를 잃는 숫자가 있으면 틀린 숫자를 낼 수 있어 거절한다. 문자열 필드는 원문 그대로라 이 검사를 하지 않는다.
- 필드가 없거나 값이 JSON 객체가 아니면 `EXIT_PARAM_ERROR`(3)다. API 오류(1)와 섞지 않는다.

## 작업 항목

### 1. `src/commands/skm/secret-json.ts` 신규

```ts
export type SecretObject = Record<string, unknown>;

/** JSON 객체(배열·null 제외)면 그 객체를, 아니면 null 을 돌려준다. 던지지 않는다. */
export function tryParseSecretObject(text: string): SecretObject | null;

/** tryParseSecretObject 가 null 이면 오류를 던진다. usage 는 "--field" 나 "secret patch" 다. */
export function parseSecretObject(text: string, usage: string): SecretObject;

/** 원문의 숫자 리터럴 가운데 JSON.parse 뒤 다시 쓰면 값이 바뀌는 것이 있는가. */
export function hasLossyNumber(text: string): boolean;

/** 정밀도를 잃는 숫자가 있으면 오류를 던진다. */
export function assertNoLossyNumber(text: string, usage: string): void;

/** 문자열이면 그대로, 그 밖의 값은 JSON.stringify 결과를 돌려준다. */
export function formatFieldValue(value: unknown): string;

/** 빈 문자열이면 오류를 던지고, 아니면 그대로 돌려준다. label 은 "--field" 나 "<field>" 다. */
export function parseFieldName(value: string, label: string): string;
```

오류 문구(모두 `EXIT_PARAM_ERROR`):

- `parseSecretObject`: `` `기밀 데이터 값이 JSON 객체가 아니어서 ${usage}를 쓸 수 없습니다.` `` — `JSON.parse` 의 오류 문구와 원문을 싣지 않는다.
- `assertNoLossyNumber`: `` `기밀 데이터에 다시 쓰면 값이 바뀌는 숫자가 있어 ${usage}를 쓸 수 없습니다. 전체 값은 secret get과 secret update로 다루세요.` ``
- `parseFieldName`: `` `${label}는 비어 있을 수 없습니다.` ``

`tryParseSecretObject` 는 `JSON.parse` 를 `try` 로 감싸고, 결과가 `typeof === "object"` 이고 `null` 도 배열도 아닐 때만 돌려준다.

`hasLossyNumber` 는 원문을 앞에서부터 훑는다. `"` 를 만나면 백슬래시 이스케이프를 건너뛰며 닫는 `"` 까지 문자열로 넘긴다. 문자열 밖에서 `-` 나 숫자로 시작하는 곳은 `/-?\d+(\.\d+)?([eE][+-]?\d+)?/y` 로 리터럴을 잘라 다음 중 하나면 `true` 다.

- `Number(lit)` 가 유한하지 않다.
- `Object.is(Number(lit), -0)` 이다(`-0` 은 다시 쓰면 `0` 이 된다).
- 소수점과 지수가 없는 정수인데 `Number.isSafeInteger(Number(lit))` 가 거짓이다.
- 그 밖의 리터럴에서 부호와 지수부를 떼고 소수점을 지운 숫자열의 앞쪽 0 과 뒤쪽 0 을 지운 길이가 15를 넘는다.

### 2. `src/commands/skm/secret.ts`: `getCommand` 에 `--field`

- `.option("--field <name>", "JSON 객체 값에서 이 필드의 값만 출력한다")` 를 더한다. 설명 문자열을 `"기밀 데이터를 조회한다 (원문을 stdout에 출력, --field로 JSON 객체의 필드 하나만)"` 로 바꾼다.
- opts 타입에 `field?: string` 을 더한다. `parsedKeyId`, `macAddress` 와 함께 `const field = opts.field === undefined ? undefined : parseFieldName(opts.field, "--field");` 를 `resolveSkmClient` 보다 앞에서 계산한다.
- `field` 가 없으면 지금과 같다.
- 있으면 조회한 `secret` 으로 `const object = parseSecretObject(secret, "--field");` 를 만들고, `!Object.hasOwn(object, field)` 면 `` new NhnCloudCliError(`기밀 데이터에 필드 ${JSON.stringify(field)}가 없습니다.`, EXIT_PARAM_ERROR) `` 를 던진다. 값이 문자열이 아니면 `assertNoLossyNumber(secret, "--field")` 를 부른다. 마지막으로 `printSkmValue(opts, formatFieldValue(value), { keyId: parsedKeyId, field, value })` 로 출력한다.

### 3. `src/commands/skm/secret-json.test.ts` 신규

- `tryParseSecretObject`: `{"a":"1"}` 은 객체, `[]`·`null`·`"s"`·`1`·`not json` 은 `null`.
- `parseSecretObject`: `{"pw":"p@ss` 처럼 깨진 원문의 오류 문구에 `p@ss` 가 없고 `usage` 가 있으며 `exitCode` 가 `EXIT_PARAM_ERROR` 다.
- `hasLossyNumber`: `{"a":1,"b":-2.5,"c":9007199254740991,"d":"12345678901234567890"}` 은 `false`(문자열 안의 긴 숫자는 무시). `{"id":12345678901234567890}`, `{"x":0.12345678901234567}`, `{"x":1e400}`, `{"x":-0}` 은 각각 `true`. 문자열 안의 이스케이프된 따옴표(`{"s":"a\"1e400\"","n":1}`)를 숫자로 읽지 않는다.
- `formatFieldValue`: `"v"` → `v`, `{"k":1}` → `{"k":1}`, `true` → `true`, `null` → `null`.
- `parseFieldName`: `""` 는 거절, `" a "` 는 그대로.

### 4. `src/commands/skm/data.test.ts`: `--field` 명령 테스트

`getSecret` 이 `{"db":"p1\n","port":5432,"nested":{"k":"v"}}` 를 돌려주게 한 테스트를 더한다.

- `--quiet secret get k1 --field db` 의 stdout 이 `p1\n\n` 이다.
- `--json secret get k1 --field port` 의 stdout 을 `JSON.parse` 하면 `{ keyId: "k1", field: "port", value: 5432 }` 다.
- `secret get k1 --field nested` 의 stdout 이 `{"k":"v"}\n` 이다.
- `secret get k1 --field missing` 은 `EXIT_PARAM_ERROR` 로 거절되고 stdout 이 비어 있다.
- `getSecret` 이 `plain-text-secret` 이면 `--field db` 가 `EXIT_PARAM_ERROR` 로 거절되고 오류 문구에 `plain-text-secret` 이 없다.
- `getSecret` 이 `{"id":12345678901234567890,"db":"p1"}` 이면 `--field db` 는 `p1` 을 내고 `--field id` 는 `EXIT_PARAM_ERROR` 다.
- `--field ""` 는 `resolveSkmClient` 를 부르기 전에 `EXIT_PARAM_ERROR` 다.

### 5. 사용자 문서

- `skills/nhncloud-cli/references/skm.md` 「명령 탐색」 의 예시에 `nhncloud skm secret get <key-id> --field <name> --quiet` 를 더하고, `--quiet` 목록에 `secret get --field`: 필드 값(문자열이면 원문, 그 밖은 JSON 표기) 을 더한다. 「비밀값 출력」 절에 `--field` 의 `--json` 출력이 `{ keyId, field, value }` 라는 것과, 필드가 없거나 값이 JSON 객체가 아니면 종료 코드 3이라는 것을 적는다.
- `README.md` 「에이전트 없이 직접 쓰기」 의 SKM 예시 아래에 `nhncloud skm secret get <key-id> --field <name> --quiet   # JSON 기밀 데이터의 필드 하나` 를 더한다(정렬은 주변 줄에 맞춘다).

## 검증

```bash
node_modules/.bin/vitest run src/commands/skm/secret-json.test.ts src/commands/skm/data.test.ts
pnpm tsc --noEmit
pnpm test
pnpm run build
node dist/index.js commands --json | grep -q -- '--field'
node dist/index.js skm secret get k1 --field ""; test $? -eq 3
node scripts/check-pii.mjs
git diff --check
```

`pnpm` 이 esbuild 승인 문제로 막히면 `node_modules/.bin/vitest run`, `node_modules/.bin/tsc --noEmit`, `node_modules/.bin/tsup` 으로 같은 검증을 한다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/commands/skm/secret-json.ts` | 신규 |
| `src/commands/skm/secret-json.test.ts` | 신규 |
| `src/commands/skm/secret.ts` | 수정 |
| `src/commands/skm/data.test.ts` | 수정 |
| `skills/nhncloud-cli/references/skm.md` | 수정 |
| `README.md` | 수정 |
