# Phase 03. skm secret, symmetric-key, asymmetric-key 데이터 명령

**Execution profile**: standard

## 목표

SKM에 저장한 키로 기밀 데이터 조회, 암복호화, 서명과 검증, 키 원문 조회를 하는 명령을 추가한다.
비밀값은 그 값을 받으려고 부른 명령에서만 원문으로 출력하고, 서명 검증 실패는 종료 코드 1로 끝낸다.

**범위 외**: 조회 명령과 공통 helper의 기존 함수는 Phase 02가 만들었다. 사용자 가이드는 Phase 04다.
실제 API를 호출하지 않는다. 기밀 데이터 수정(PUT) 명령은 만들지 않는다.

## 컨텍스트

- Phase 01이 추가한 `SkmClient`(`src/services/skm/client.ts`) 메서드: `getSecret`, `encrypt`, `decrypt`, `createLocalKey`, `getSymmetricKey(keyId, keyVersion?)`, `sign`, `verify`, `signStandard(keyId, plaintextBase64)`, `verifyStandard(keyId, plaintextBase64, signature, keyVersion)`, `getPrivateKey(keyId, keyVersion?)`, `getPublicKey(keyId, keyVersion?)`. 반환 타입은 `src/services/skm/types.ts`.
- Phase 02가 추가한 `src/commands/skm/helpers.ts`: `SkmCommandOptions`, `withSkmOptions(command)`(`--mac-address`, `--profile`), `parseMacAddressOption`, `resolveSkmClient({ profile, macAddress })`, `formatCell`. 명령 등록은 `src/index.ts`의 `skmCommand`.
- 파일·stdin 입력 선례: `src/commands/logncrash/send.ts`의 `resolveBody`(`statSync` 실패와 일반 파일 아님, 크기 한도를 `EXIT_PARAM_ERROR`로, stdin은 `!process.stdin.isTTY`일 때 `readFileSync(0)`).
- 정수 옵션: `src/commands/parse-options.ts`의 `parseNonNegativeIntegerOption(value, flag)`. SKM 예제의 `keyVersion`은 0부터다.
- 출력: `src/formatters/table.ts`의 `output`, `printJson`. 터미널 정제: `src/utils/terminal.ts`의 `sanitizeMultilineForTerminal`.
- 명령 테스트 방식: `src/commands/skm/inventory.test.ts`(Phase 02)와 `src/commands/network/security-group.test.ts`.
- 종료 코드: `src/utils/exit-codes.ts`의 `EXIT_API_ERROR = 1`, `EXIT_PARAM_ERROR = 3`.

**근거 문서**: `docs/adr/039-skm-client-auth-and-secret-output.md`, `docs/flow.md`의 「Secure Key Manager」 절

## 의도 메모

- 입력은 받은 바이트를 그대로 쓴다. 평문의 끝 줄바꿈도 지우지 않는다. 암호문과 서명값은 base64라 앞뒤 공백만 지운다.
- 일반 암호화와 일반 서명 API는 문자열을 받는다. UTF-8로 디코딩할 수 없는 입력은 깨지므로 요청 전에 거부하고, 바이너리는 `--standard` 서명을 쓰라고 안내한다.
- 크기 한도는 공식 문서 값이다. 암호화 32KB(32768바이트), 일반 서명 245바이트, 표준 스킴 서명 디코딩 전 64KB(65536바이트).
- 모든 입력 읽기와 옵션 파싱은 `resolveSkmClient`와 spinner보다 먼저 끝낸다.
- 기본 출력은 사람이 읽으므로 `sanitizeMultilineForTerminal`을 거친다. `--quiet`은 파이프로 넘기는 용도라 원문을 그대로 쓴다.

## 작업 항목

### 1. `src/commands/skm/input.ts` 신규

```ts
export interface StdinSource { isTTY: boolean | undefined; read: () => Buffer; }
export const processStdin: StdinSource; // { isTTY: process.stdin.isTTY, read: () => readFileSync(0) }

export interface SkmInputSpec {
  textFlag: string;   // 예: "--plaintext"
  label: string;      // 오류 문구에 쓰는 이름. 예: "암호화할 데이터"
  maxBytes: number;
}

/** textFlag 값 > --file > stdin 순으로 읽어 Buffer 로 돌려준다. */
export function readSkmInput(source: { text?: string; file?: string }, spec: SkmInputSpec, stdin?: StdinSource): Buffer;

/** UTF-8 로 엄격 디코딩한다. 실패하면 EXIT_PARAM_ERROR. */
export function decodeUtf8Input(input: Buffer, label: string, hint: string): string;
```

`readSkmInput` 규칙(모두 `EXIT_PARAM_ERROR`):

| 조건 | 오류 문구 |
|---|---|
| `text`와 `file`을 함께 지정 | `` `${spec.textFlag}와 --file은 함께 지정할 수 없습니다.` `` |
| 파일 `statSync` 실패 | `` `${spec.label} 파일을 읽을 수 없습니다: ${file} (${code 또는 message})` `` |
| 일반 파일 아님 | `` `${spec.label} 파일이 일반 파일이 아닙니다: ${file}` `` |
| 크기 초과(파일은 `stat.size`, 그 외는 읽은 길이) | `` `${spec.label}가 너무 큽니다: ${n}바이트 (한도 ${spec.maxBytes}바이트).` `` |
| 셋 다 없고 stdin이 TTY | `` `${spec.label}가 필요합니다. ${spec.textFlag} <값>, --file <경로>, 표준 입력(파이프) 중 하나로 전달하세요.` `` |
| 읽은 길이가 0 | `` `${spec.label}가 비어 있습니다.` `` |

`text`는 `Buffer.from(text, "utf-8")`이다. 기본 `stdin` 인수는 `processStdin`이다.

`decodeUtf8Input`은 `new TextDecoder("utf-8", { fatal: true })`로 디코딩하고, 실패하면 `` `${label}는 UTF-8 텍스트여야 합니다. ${hint}` ``를 던진다.

### 2. `src/commands/skm/helpers.ts`에 추가

```ts
/** --json 은 raw 를 printJson, --quiet 은 value 원문 + "\n", 기본은 sanitizeMultilineForTerminal(value) + "\n" 을 stdout 에 쓴다. */
export function printSkmValue(opts: OutputOptions, value: string, raw: unknown): void;

/** --key-version 을 0 이상의 정수로 파싱한다. */
export function parseKeyVersionOption(value: string | undefined): number | undefined;
```

`parseKeyVersionOption`은 `parseNonNegativeIntegerOption(value, "--key-version")`이다.

### 3. `src/commands/skm/secret.ts` 신규

`secretCommand = new Command("secret").description("SKM 기밀 데이터 조회")`.

| 명령 | 인수·옵션 | 호출 | 출력 |
|---|---|---|---|
| `get <key-id>` | | `getSecret(keyId)` | `printSkmValue(opts, secret, { secret })` |

### 4. `src/commands/skm/symmetric-key.ts` 신규

`symmetricKeyCommand = new Command("symmetric-key").description("SKM 대칭키 암복호화와 키 조회")`.

| 명령 | 인수·옵션 | 입력과 검증 | 호출 | 출력 |
|---|---|---|---|---|
| `encrypt <key-id>` | `--plaintext <text>`, `--file <path>` | `readSkmInput` (`textFlag: "--plaintext"`, `label: "암호화할 데이터"`, `maxBytes: 32768`) → `decodeUtf8Input(..., "바이너리는 base64로 인코딩해 전달하세요.")` | `encrypt` | `printSkmValue(opts, ciphertext, body)` |
| `decrypt <key-id>` | `--ciphertext <text>`, `--file <path>` | `readSkmInput` (`textFlag: "--ciphertext"`, `label: "복호화할 암호문"`, `maxBytes: MAX_JSON_INPUT_BYTES`) → UTF-8 디코딩 후 `trim()`. 비면 `복호화할 암호문이 비어 있습니다.` | `decrypt` | `printSkmValue(opts, plaintext, body)` |
| `get <key-id>` | `--key-version <n>` | `parseKeyVersionOption` | `getSymmetricKey` | `printSkmValue(opts, symmetricKey, body)` |
| `create-local-key <key-id>` | | | `createLocalKey` | `output(opts, { headers: ["field", "value"], rows: [["localKeyPlaintext", …], ["localKeyCiphertext", …], ["keyVersion", …]], raw: body, ids: [localKeyPlaintext, localKeyCiphertext] })` |

`MAX_JSON_INPUT_BYTES`는 `src/utils/limits.ts`에 있다. `create-local-key` 설명 끝에 `(평문 키는 이 응답에서만 받을 수 있다)`를 넣는다.

### 5. `src/commands/skm/asymmetric-key.ts` 신규

`asymmetricKeyCommand = new Command("asymmetric-key").description("SKM 비대칭키 서명·검증과 키 조회")`.

| 명령 | 인수·옵션 | 입력과 검증 | 호출 | 출력 |
|---|---|---|---|---|
| `sign <key-id>` | `--plaintext`, `--file`, `--standard` | `--standard`가 없으면 `maxBytes: 245`, UTF-8 디코딩(hint `바이너리는 --standard로 서명하세요.`). 있으면 `maxBytes: 65536`, `toString("base64")` | `sign` 또는 `signStandard` | `printSkmValue(opts, signature, body)` |
| `verify <key-id>` | `--plaintext`, `--file`, `--signature <sig>` 필수(`requiredOption`), `--standard`, `--key-version <n>` | 입력은 `sign`과 같다. `--signature`는 trim 후 비면 `--signature가 비어 있습니다.`. `--standard`인데 `--key-version`이 없으면 `--standard 검증에는 --key-version이 필요합니다.`, `--standard` 없이 `--key-version`을 주면 `--key-version은 --standard와 함께 지정합니다.` | `verify` 또는 `verifyStandard` | 아래 |
| `public-key <key-id>` | `--key-version <n>` | | `getPublicKey` | `printSkmValue(opts, standardEncodedKey, body)` |
| `private-key <key-id>` | `--key-version <n>` | | `getPrivateKey` | `printSkmValue(opts, standardEncodedKey, body)` |

입력 label은 `sign`이 `서명할 데이터`, `verify`가 `검증할 데이터`다.

`verify` 출력:

- `--json`이면 `printJson(body)`, `--quiet`이면 아무것도 쓰지 않는다. 기본은 `` `검증 성공 (keyVersion ${keyVersion})\n` `` 또는 `` `검증 실패 (keyVersion ${keyVersion})\n` ``를 stdout에 쓴다.
- 출력 뒤 `result`가 `false`면 `new NhnCloudCliError("서명 검증에 실패했습니다.", EXIT_API_ERROR)`를 던진다. 최상위 처리부가 stderr에 출력하고 종료 코드 1로 끝낸다.

### 6. 공통 적용

- 모든 말단 명령에 Phase 02의 `withSkmOptions`를 적용한다. `<key-id>`는 `parseRequiredArgument(value, "key-id")`로 정제한다.
- 실행 순서: `optsWithGlobals<...>()` → 인수·옵션·`--mac-address` 파싱 → 입력 읽기 → `resolveSkmClient` → spinner → client 호출 → spinner 종료 → 출력.
- `src/index.ts`의 `skmCommand`에 `secretCommand`, `symmetricKeyCommand`, `asymmetricKeyCommand`를 `skm` 접두사 import 이름으로 붙인다.

### 7. 테스트

`src/commands/skm/input.test.ts` 신규. 실제 파일은 `os.tmpdir()` 아래 `mkdtempSync`로 만들고 지운다. stdin은 `StdinSource` 객체를 넘긴다.

- `text`가 `"a\n"`이면 끝 줄바꿈을 지우지 않은 2바이트 Buffer.
- `text`와 `file` 동시 지정, 디렉터리 경로, 한도 초과(`maxBytes: 3`에 4바이트), TTY stdin과 입력 없음, 빈 stdin이 각각 위 표의 문구로 `EXIT_PARAM_ERROR`.
- 파일이 한도 이하이면 내용 그대로, `isTTY: false`인 stdin은 `read()` 결과 그대로.
- `decodeUtf8Input(Buffer.from([0xff]), ...)`은 `EXIT_PARAM_ERROR`, `Buffer.from("한글")`은 `"한글"`.

`src/commands/skm/data.test.ts` 신규. `inventory.test.ts`처럼 `resolveSkmClient`만 mock하고 `SkmClient` 메서드를 `vi.spyOn`한다. 이 파일은 `formatters/table.js`를 mock하지 않는다. `printSkmValue`, `printJson`, `output`은 실제 구현을 쓰고 `process.stdout.write`를 spy해 출력을 확인한다. spinner는 mock한다.

- `secret get k1 --quiet`: stdout이 정확히 `"line1\nline2\u001b[31m\n"`(원문 + 개행). 기본 출력은 `\u001b`가 `?`로 바뀐다.
- `symmetric-key encrypt k1 --plaintext "a\n"`: `encrypt`가 `("k1", "a\n")`로 호출된다.
- `symmetric-key encrypt k1 --plaintext <32769바이트>`: `resolveSkmClient`를 부르지 않고 `EXIT_PARAM_ERROR`.
- `symmetric-key decrypt k1 --ciphertext "  abc=\n"`: `decrypt`가 `("k1", "abc=")`로 호출된다.
- `asymmetric-key sign k1 --standard --plaintext "hi"`: `signStandard`가 `("k1", "aGk=")`로 호출된다.
- `asymmetric-key sign k1 --plaintext <246바이트>`: `EXIT_PARAM_ERROR`이고 `sign`을 부르지 않는다.
- `asymmetric-key verify k1 --plaintext x --signature s`에 `result: false`: stdout에 `검증 실패 (keyVersion 1)`을 쓴 뒤 `exitCode`가 `EXIT_API_ERROR`인 오류로 reject한다. `result: true`면 resolve한다.
- `asymmetric-key verify k1 --plaintext x --signature s --standard`(`--key-version` 없음)와 `--key-version 0`만 준 경우(`--standard` 없음)는 `resolveSkmClient`를 부르지 않고 `EXIT_PARAM_ERROR`.
- `asymmetric-key verify k1 --plaintext x --signature s --standard --key-version 0`: `verifyStandard`가 `("k1", "eA==", "s", 0)`로 호출된다.
- `asymmetric-key private-key k1 --key-version 2 --quiet`: `getPrivateKey("k1", 2)`이고 stdout은 `standardEncodedKey` + `"\n"`.
- `symmetric-key create-local-key k1 --quiet`: stdout은 `<localKeyPlaintext>\n<localKeyCiphertext>\n`.

## 검증

```bash
node_modules/.bin/vitest run src/commands/skm/input.test.ts src/commands/skm/data.test.ts src/commands/skm/helpers.test.ts src/commands/skm/inventory.test.ts
pnpm tsc --noEmit
pnpm test
pnpm run build
node dist/index.js commands --json | grep -c '"path": "skm'   # 23
printf 'x' | node dist/index.js skm asymmetric-key verify k1 --signature s --standard; echo "exit=$?"   # 자격증명 전 입력 오류: exit=3
git diff --check
```

카탈로그 개수 23은 Phase 02의 11에 그룹 3개(`skm secret`, `skm symmetric-key`, `skm asymmetric-key`)와 말단 9개(`secret get`, `symmetric-key encrypt|decrypt|get|create-local-key`, `asymmetric-key sign|verify|public-key|private-key`)를 더한 값이다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/commands/skm/input.ts` | 신규 |
| `src/commands/skm/input.test.ts` | 신규 |
| `src/commands/skm/helpers.ts` | 수정 |
| `src/commands/skm/secret.ts` | 신규 |
| `src/commands/skm/symmetric-key.ts` | 신규 |
| `src/commands/skm/asymmetric-key.ts` | 신규 |
| `src/commands/skm/data.test.ts` | 신규 |
| `src/index.ts` | 수정 |
