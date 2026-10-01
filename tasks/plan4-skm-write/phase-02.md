# Phase 02. skm key create|delete|purge와 secret update

**Execution profile**: deep

## 목표

`skm key create`, `skm key delete`(삭제 예약), `skm key purge`(즉시 삭제), `skm secret update`를 추가한다.
키 저장소 ID로 이름을 얻는 helper를 만들고, 삭제 명령은 `--yes` 없이 API를 호출하지 않게 한다.

**범위 외**: 키 저장소와 인증 정보 쓰기는 Phase 03이다. 문서는 Phase 04다. 실제 API를 호출하지 않는다.

## 컨텍스트

- Phase 01이 `src/services/skm/client.ts`에 추가한 메서드: `createSecret(keyStoreName, name, description, secretValue)`, `createSymmetricKey(keyStoreName, name, description)`, `createAsymmetricKey(keyStoreName, name, description)`, `updateSecret(keyId, secretValue)`, `scheduleKeyDeletion(keyId)`, `deleteKeyNow(keyId)`. 반환 타입 `SkmCreatedKey`, `SkmUpdatedSecret`, `SkmDeletion`(`src/services/skm/types.ts`). 실제 시그니처는 파일을 읽어 확인한다.
- 기존 client 메서드 `getKeyStore(keyStoreId: number): Promise<SkmKeyStore>`(`name` 필드).
- 공통 helper `src/commands/skm/helpers.ts`: `SkmCommandOptions`, `withSkmOptions(command)`(`--mac-address`, `--profile`), `parseMacAddressOption`, `parseKeyStoreId`, `parseKeyTypeOption`(`secret|symmetric-key|asymmetric-key` → `SkmKeyType`), `parseKeyNameOption`(trim, 1~100자), `resolveSkmClient`, `formatCell`, `withSkmSpinner(text, call)`.
- 입력: `src/commands/skm/input.ts`의 `readSkmInput(source: { text?, file? }, spec: { textFlag, label, maxBytes }, stdin?)`, `decodeUtf8Input(buffer, label, hint)`. 크기 상수 `MAX_JSON_INPUT_BYTES`는 `src/utils/limits.ts`.
- `--yes` 확인: `src/commands/resource-resolver.ts`의 `requireYes(yes, operation)`. `"<operation>에는 --yes 플래그가 필요합니다."`를 `EXIT_PARAM_ERROR`로 던진다.
- 출력: `src/formatters/table.ts`의 `output(opts, { headers, rows, raw, ids })`. 쓰기 결과 선례는 `src/commands/network/security-group-manage.ts`의 `deleteCommand`(`{ operation, status, <id> }`를 `field`/`value`로 출력).
- 기존 명령 파일: `src/commands/skm/key.ts`(`keyCommand`에 `list`, `get`), `src/commands/skm/secret.ts`(`secretCommand`에 `get`).
- 테스트 선례: `src/commands/skm/data.test.ts`(`resolveSkmClient`만 mock, `SkmClient` 메서드 `vi.spyOn`, spinner mock, `process.stdout.write` spy, `configureCommanderExitCodes`).

**근거 문서**: `docs/adr/040-skm-write-commands.md`, `docs/flow.md`의 「Secure Key Manager 쓰기」 절

## 의도 메모

- 실행 순서: 인수·옵션 파싱과 `requireYes` → 값 입력 읽기 → `resolveSkmClient` → spinner → 키 저장소 이름 조회 → 쓰기 요청 → 출력.
- 키 저장소 이름 조회가 실패하면 쓰기 요청을 보내지 않는다.
- 기밀 데이터 값은 끝 줄바꿈을 지우지 않는다(조회·암호화 입력과 같은 규칙).
- `secret update` 응답의 `secretValue`는 table, `--json`, `--quiet` 어디에도 내지 않는다.

## 작업 항목

### 1. `src/commands/skm/helpers.ts`에 추가

```ts
/** 키 저장소 ID 로 이름을 조회한다. 키 생성·인증 정보 API 는 이름을 받는다 (ADR-040). */
export async function resolveKeyStoreName(client: SkmClient, keyStoreId: number): Promise<string>;

/** 쓰기 결과를 field/value 로 출력한다. ids 는 --quiet 출력이다. */
export function outputSkmWriteResult(opts: OutputOptions, result: Record<string, unknown>, ids: string[]): void;
```

`outputSkmWriteResult`는 `output(opts, { headers: ["field", "value"], rows: Object.entries(result).map(([k, v]) => [k, formatCell(v)]), raw: result, ids })`다.

### 2. `src/commands/skm/key-manage.ts` 신규

`createCommand`, `deleteCommand`, `purgeCommand`를 export하고 `key.ts`의 `keyCommand`에 붙인다. `keyCommand` 설명을 `SKM 키 조회와 관리`로 바꾼다. 모두 `withSkmOptions`를 쓴다.

| 명령 | 인수·옵션 | 동작 | 출력 |
|---|---|---|---|
| `create <keystore-id>` | `--type <type>` 필수(`requiredOption`), `--name <name>` 필수, `--description <text>`, `--value <value>`, `--file <path>` | 아래 | `outputSkmWriteResult(opts, { keyId, keyStatus, keyStoreId, name }, [keyId])` |
| `delete <key-id>` | `--yes` | `requireYes(opts.yes, "키 삭제 예약")` → `scheduleKeyDeletion` | `{ operation: "key-delete-scheduled", status: "succeeded", keyId, deletionDateTime }`, ids `[keyId]` |
| `purge <key-id>` | `--yes` | `requireYes(opts.yes, "키 즉시 삭제")` → `deleteKeyNow` | `{ operation: "key-purge", status: "succeeded", keyId, deletionDateTime }`, ids `[keyId]` |

`create` 순서:

1. `parseKeyStoreId`, `parseKeyTypeOption`, `parseKeyNameOption`(필수 옵션이라 `undefined`가 아니다). `--description`은 trim 후 비면 `undefined`.
2. 타입이 `SECRET`이면 `readSkmInput({ text: opts.value, file: opts.file }, { textFlag: "--value", label: "기밀 데이터", maxBytes: MAX_JSON_INPUT_BYTES })` → `decodeUtf8Input(..., "기밀 데이터", "바이너리는 base64로 인코딩해 전달하세요.")`.
   타입이 `SECRET`이 아닌데 `--value`나 `--file`이 있으면 `--value와 --file은 --type secret에서만 씁니다.`를 `EXIT_PARAM_ERROR`로 던진다. 이때 stdin은 읽지 않는다.
3. `resolveSkmClient` → spinner 안에서 `resolveKeyStoreName` → 타입별 생성 메서드.

`delete`와 `purge`의 `<key-id>`는 `parseRequiredArgument(value, "key-id")`. 설명 끝에 각각 `(7일 뒤 삭제, 그 전에는 콘솔에서 취소 가능)`, `(삭제 예약된 키만, 되돌릴 수 없음)`을 넣는다.

### 3. `src/commands/skm/secret.ts`에 `update` 추가

| 명령 | 인수·옵션 | 동작 | 출력 |
|---|---|---|---|
| `update <key-id>` | `--value <value>`, `--file <path>` | `readSkmInput`(`textFlag: "--value"`, `label: "기밀 데이터"`, `maxBytes: MAX_JSON_INPUT_BYTES`) → `decodeUtf8Input` → `updateSecret` | 응답에서 `secretValue`를 뺀 객체를 `outputSkmWriteResult`, ids `[keyId]` |

`secretCommand` 설명을 `SKM 기밀 데이터 조회와 수정`으로 바꾼다.

### 4. 테스트

`src/commands/skm/helpers.test.ts`에 추가: `resolveKeyStoreName`이 `getKeyStore(3)`의 `name`을 돌려주고, `getKeyStore`가 reject하면 같은 오류로 reject한다.

`src/commands/skm/key-write.test.ts` 신규. `data.test.ts`와 같은 방식(`resolveSkmClient` mock, `SkmClient` 메서드 spy, spinner mock, stdout spy)으로 `keyCommand`와 `secretCommand`를 실행한다.

- `key create 3 --type secret --name app --value "pw\n"`: `getKeyStore(3)` 뒤 `createSecret("store-name", "app", undefined, "pw\n")`. `--quiet` 출력은 `<keyId>\n`.
- `key create 3 --type symmetric-key --name k`: `createSymmetricKey("store-name", "k", undefined)`이고 `createSecret`은 부르지 않는다.
- `key create 3 --type asymmetric-key --name k --value x`: `resolveSkmClient`를 부르지 않고 `EXIT_PARAM_ERROR`.
- `key create 3 --type secret --name app`에 TTY stdin(입력 없음): `EXIT_PARAM_ERROR`. stdin은 `import { processStdin } from "./input.js"` 뒤 `vi.spyOn(processStdin, "isTTY", "get").mockReturnValue(true)`로 고정한다(`processStdin.isTTY`는 getter다).
- `getKeyStore`가 reject하면 `createSecret`을 부르지 않는다.
- `key delete k1`(`--yes` 없음): `resolveSkmClient`를 부르지 않고 `EXIT_PARAM_ERROR`, 메시지에 `--yes`. `key delete k1 --yes`: `scheduleKeyDeletion("k1")`이고 `--json` 출력의 `operation`이 `key-delete-scheduled`.
- `key purge k1 --yes`: `deleteKeyNow("k1")`, `scheduleKeyDeletion`은 부르지 않는다.
- `secret update k1 --value new --json`: `updateSecret("k1", "new")`이고 stdout에 `secretValue`와 응답의 비밀값 문자열이 없다.

## 검증

```bash
node_modules/.bin/vitest run src/commands/skm/key-write.test.ts src/commands/skm/helpers.test.ts src/commands/skm/data.test.ts src/commands/skm/inventory.test.ts
pnpm tsc --noEmit
pnpm test
pnpm run build
node dist/index.js commands --json | grep -c '"path": "skm'   # 27
node dist/index.js skm key delete k1; echo "exit=$?"   # --yes 누락, 자격증명 전 종료: exit=3
git diff --check
```

카탈로그 27은 기존 23에 `skm key create`, `skm key delete`, `skm key purge`, `skm secret update`를 더한 값이다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/commands/skm/helpers.ts` | 수정 |
| `src/commands/skm/helpers.test.ts` | 수정 |
| `src/commands/skm/key-manage.ts` | 신규 |
| `src/commands/skm/key.ts` | 수정 |
| `src/commands/skm/secret.ts` | 수정 |
| `src/commands/skm/key-write.test.ts` | 신규 |
