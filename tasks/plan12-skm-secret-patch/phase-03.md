# Phase 03. `skm secret patch`: 필드 하나 더하기, 바꾸기, 지우기와 반영 뒤 대조

**Execution profile**: deep

## 목표

값이 JSON 객체인 기밀 데이터의 최상위 필드 하나를 더하거나 바꾸거나 지우는 `skm secret patch <key-id> <field>` 를 더한다.
기본은 미리보기이고 `--yes` 일 때만 전체 값을 쓰며, 쓴 뒤 다시 조회해 대조한 결과를 종료 코드로 알린다.

**범위 외**: 중첩 필드 경로, JSON 값 입력 옵션, 반영 전 값 백업. `secret update` 와 `key create --type secret` 의 입력 한도와 출력은 바꾸지 않는다.

## 컨텍스트

- phase 02 가 만든 `src/commands/skm/secret-json.ts` 에 `SecretObject`, `tryParseSecretObject`, `parseSecretObject`, `assertNoLossyNumber`, `parseFieldName` 이 있다. 이 phase 는 같은 파일에 다시 쓰기, 동작 판정, 대조 함수를 더한다.
- 기존 `secret update` 는 `src/commands/skm/secret.ts` 의 `updateCommand` 다. `readSkmInput`, `decodeUtf8Input`(`src/commands/skm/input.ts`)으로 값을 읽고 `client.updateSecret(keyId, secretValue)` 로 `PUT /secrets/{keyid}` 를 보낸 뒤, 응답의 `secretValue` 를 지우고 `outputSkmWriteResult(opts, result, ids)` 로 출력한다.
- 공식 문서(API v1.3, 일반망과 공공망 같음): 수정 요청 본문은 `{ "secretValue": string }` 하나다. 응답 `body` 에 `keyId`, `name`, `description`, `secretValue`, `creationUser`, `creationDatetime`, `lastChangeUser`, `lastChangeDatetime` 이 온다. 기밀 데이터에는 버전이 없어 덮어쓴 값은 되돌릴 수 없다. 기밀 데이터는 32KB 이하 텍스트이며 이 상한은 서버가 판정한다. 승인 기능을 켠 키 저장소에서 API 수정이 어떻게 처리되는지는 문서에 없다.
- `readSkmInput(source, spec, stdin)` 은 `spec.textFlag` 가 필수이고, 입력이 없을 때 오류 문구에 그 이름을 쓴다. patch 는 `--value` 가 없으므로 `textFlag` 를 선택으로 바꾼다.
- `outputSkmWriteResult` 는 기본 출력에서 `field`·`value` 두 열의 테이블을, `--json` 에서 `raw`, `--quiet` 의 `ids` 를 낸다. `formatCell(null)` 은 `-` 다.
- 결과를 출력한 뒤 오류를 던지면 최상위 처리부가 stderr 에 오류를 쓰고 그 종료 코드로 끝난다. `src/commands/skm/asymmetric-key.ts` 의 검증 실패 처리가 같은 방식이다.
- 명령 테스트 방식은 `src/commands/skm/key-write.test.ts` 를 따른다. `resolveSkmClient` 를 `vi.mock` 으로 바꾸고 `vi.spyOn(client, "getSecret")`, `vi.spyOn(client, "updateSecret")` 으로 응답을 준다. 표준 입력은 `vi.spyOn(processStdin, "isTTY", "get")` 과 `vi.spyOn(processStdin, "read")` 로 준다.

**근거 문서**: `docs/adr/045-skm-secret-field-patch.md`, `docs/flow.md` 의 「기밀 데이터 필드 수정」 절, `docs/adr/040-skm-write-commands.md`

## 의도 메모

- `--yes` 없이 종료 코드 3으로 끝내지 않는다. 미리보기가 같은 판정을 하고 쓰지 않는다(ADR-045). 다만 `--replace` 누락은 미리보기에서도 종료 코드 3이다. 미리보기가 실제 실행 결과를 예고해야 하기 때문이다.
- 값과 해시는 stdout, stderr, 오류 문구 어디에도 내지 않는다. 짧은 비밀번호의 SHA-256 은 대입 공격이 가능하다.
- 같은 값으로 다시 실행하면 `unchanged` 라 쓰지 않는다. 결과를 모르는 실패 뒤 재실행 안내가 이 성질에 기댄다.
- 실패 상태를 셋으로 나눈다. 쓰기 요청 실패(반영 여부를 미리보기로 확인), 다시 조회 실패(반영했으나 검증 못함), 대조 불일치(덮어쓰기나 승인 대기). 사용자가 할 일이 다르다.
- 필드 객체 조작은 `Object.fromEntries`, `Object.entries` 로 한다. `obj[field] = value` 는 필드 이름이 `__proto__` 면 프로토타입을 바꾼다.

## 작업 항목

### 1. `src/commands/skm/input.ts`: `textFlag` 를 선택으로

- `SkmInputSpec.textFlag` 를 `textFlag?: string` 으로 바꾼다.
- `readSkmInput` 의 두 오류 문구를 `textFlag` 유무로 나눈다.
  - 함께 지정 검사는 `textFlag` 가 있을 때만 한다(없으면 `source.text` 도 없다).
  - 입력이 없을 때 `textFlag` 가 없으면 `` `${spec.label}가 필요합니다. ${fileFlag} <경로>나 표준 입력(파이프)으로 전달하세요.` `` 를 쓴다. 있으면 지금 문구 그대로다.

### 2. `src/commands/skm/input.test.ts`

`textFlag` 없이 입력도 없고 stdin 이 TTY 면 `--file <경로>나 표준 입력(파이프)으로 전달하세요.` 를 담은 `EXIT_PARAM_ERROR` 이고 문구에 `undefined` 가 없다는 테스트를 더한다.

### 3. `src/commands/skm/secret-json.ts`: 다시 쓰기, 판정, 대조

```ts
export type PatchAction = "added" | "replaced" | "deleted" | "unchanged";
export type PatchChange = { kind: "set"; value: string; replace: boolean } | { kind: "delete" };

/** 들여쓰기와 끝 줄바꿈을 원문에 맞춰 직렬화한다. */
export function serializeSecretObject(object: SecretObject, originalText: string): string;

export function sha256Hex(text: string): string;

/** 동작과 반영 뒤 객체를 정한다. 값이 다른 기존 필드에 replace 가 없으면 던진다. */
export function planSecretPatch(before: SecretObject, field: string, change: PatchChange): { action: PatchAction; after: SecretObject };

/** 다시 조회한 값을 대조한다. fetched 가 null 이면(JSON 객체가 아님) 둘 다 false. */
export function verifySecretPatch(
  before: SecretObject,
  fetched: SecretObject | null,
  field: string,
  change: PatchChange,
): { fieldVerified: boolean; othersVerified: boolean };
```

- `serializeSecretObject`: `originalText.trimEnd()` 에 `\n` 이 없으면 `JSON.stringify(object)` 다. 있으면 `/\n([ \t]+)\S/.exec(originalText)` 의 들여쓰기(없으면 두 칸 공백)로 `JSON.stringify(object, null, indent)` 다. 원문이 `\n` 으로 끝나면 결과 끝에 `\n` 을 붙인다.
- `sha256Hex`: `createHash("sha256").update(text, "utf8").digest("hex")`(`node:crypto`).
- `planSecretPatch`:
  - `delete`: 필드가 있으면 `deleted` 와 그 필드를 뺀 객체, 없으면 `unchanged` 와 `before` 다.
  - `set`: 필드가 없으면 `added` 와 끝에 필드를 붙인 객체다. 있고 기존 값이 `change.value` 와 같은 문자열이면 `unchanged` 와 `before` 다. 있고 다르면 `replace` 가 참일 때 `replaced` 와 같은 자리의 값만 바꾼 객체, 거짓이면 `` new NhnCloudCliError(`필드 ${JSON.stringify(field)}가 이미 있습니다. 값을 바꾸려면 --replace를 붙이세요.`, EXIT_PARAM_ERROR) `` 다.
  - 필드 존재는 `Object.hasOwn` 으로 본다.
- `verifySecretPatch`:
  - `fieldVerified`: `set` 이면 `fetched` 에 필드가 있고 문자열이며 `sha256Hex(fetched[field]) === sha256Hex(change.value)`. `delete` 면 `fetched` 에 필드가 없다.
  - `othersVerified`: `before` 와 `fetched` 에서 `field` 를 뺀 키 집합이 같고, 각 키의 값이 `isDeepStrictEqual`(`node:util`)로 같다.

### 4. `src/commands/skm/secret.ts`: `patchCommand`

```ts
const patchCommand = withSkmOptions(
  new Command("patch")
    .description("JSON 객체 기밀 데이터의 필드 하나를 더하거나 바꾸거나 지운다 (기본은 미리보기, --yes로 반영)")
    .argument("<key-id>", "키 ID")
    .argument("<field>", "필드 이름 (최상위 키)")
    .option("--file <path>", "필드에 넣을 값을 읽을 파일 (없으면 표준 입력)")
    .option("--replace", "이미 있는 필드의 값을 바꾼다")
    .option("--delete", "필드를 지운다")
    .option("--yes", "미리보기 대신 반영한다"),
)
```

`secretCommand` 에 `.addCommand(patchCommand)` 를 더하고 설명을 `"SKM 기밀 데이터 조회와 수정"` 그대로 둔다.

action 순서. 1~5는 `resolveSkmClient` 보다 앞이다.

1. `parsedKeyId = parseRequiredArgument(keyId, "key-id")`, `parsedField = parseFieldName(field, "<field>")`, `macAddress = parseMacAddressOption(opts.macAddress)`.
2. `opts.delete && opts.replace` 면 `"--delete와 --replace는 함께 지정할 수 없습니다."`, `opts.delete && opts.file !== undefined` 면 `"--delete와 --file은 함께 지정할 수 없습니다."` 를 `EXIT_PARAM_ERROR` 로 던진다.
3. `--delete` 가 아니면 `readSkmInput({ file: opts.file }, { label: "필드에 넣을 데이터", maxBytes: MAX_JSON_INPUT_BYTES })` 와 `decodeUtf8Input(input, "필드에 넣을 데이터", "바이너리는 base64로 인코딩해 전달하세요.")` 로 값을 읽는다. `--delete` 면 표준 입력을 읽지 않는다.
4. 값이 `\n` 으로 끝나면 stderr 에 `"경고: 필드에 넣을 데이터가 줄바꿈으로 끝납니다. 줄바꿈도 값에 들어갑니다. 빼려면 printf '%s'로 넘기세요.\n"` 를 쓴다.
5. `change` 를 만든다(`{ kind: "delete" }` 또는 `{ kind: "set", value, replace: opts.replace === true }`).
6. `resolveSkmClient`, `withSkmSpinner(\`SKM 기밀 데이터 ${formatCell(parsedKeyId)} 조회 중...\`, ...)` 로 현재 값을 읽는다.
7. `before = parseSecretObject(current, "secret patch")`, `assertNoLossyNumber(current, "secret patch")`, `planSecretPatch(before, parsedField, change)`.
8. 결과 객체의 키 이름은 정확히 `keyId`, `field`, `action`, `applied`, `fieldVerified`, `othersVerified` 다. 출력은 `outputSkmWriteResult(opts, result, [action])` 이다.
9. `--yes` 가 없거나 `action === "unchanged"` 면 `applied: false`, 두 대조 값 `null` 로 출력하고 끝낸다(종료 코드 0). `--yes` 가 없고 `unchanged` 가 아니면 출력 뒤 stderr 에 `"미리보기입니다. 반영하려면 --yes를 붙이세요.\n"` 를 쓴다.
10. `serializeSecretObject(after, current)` 를 `client.updateSecret` 로 보낸다(spinner 문구 `SKM 기밀 데이터 ${id} 수정 중...`). 응답은 쓰지 않는다. 실패하면 `toNhnCloudCliError(err)` 로 바꾼 오류의 종료 코드를 유지해 `` `기밀 데이터 수정 요청이 실패했습니다: ${e.message} 반영됐는지는 같은 명령을 --yes 없이 다시 실행해 action으로 확인하세요.` `` 를 던진다. 이 경우 stdout 에는 아무것도 쓰지 않는다.
11. 같은 키를 다시 조회한다(spinner 문구 `SKM 기밀 데이터 ${id} 다시 조회 중...`). 실패하면 `applied: true`, 두 대조 값 `null` 로 출력한 뒤 `` `기밀 데이터는 바꿨지만 다시 조회하지 못해 검증하지 못했습니다: ${e.message} skm secret get으로 현재 값을 확인하세요.` `` 를 `EXIT_API_ERROR` 로 던진다.
12. `verifySecretPatch(before, tryParseSecretObject(fetchedText), parsedField, change)` 결과로 `applied: true` 를 출력한다. 둘 중 하나라도 거짓이면 어긋난 항목(`` `필드 ${JSON.stringify(parsedField)}` ``, `다른 필드`)을 `, ` 로 이어 `` `반영 뒤 다시 조회한 기밀 데이터가 기대와 다릅니다 (${items}). 다른 쓰기가 끼어들었거나 승인 기능 때문에 변경이 대기 중일 수 있습니다. skm secret get으로 현재 값을 확인하세요.` `` 를 `EXIT_API_ERROR` 로 던진다.

### 5. `src/commands/skm/secret-json.test.ts`: 새 함수 테스트

- `serializeSecretObject`: 한 줄 원문은 한 줄로, `"{\n    \"a\": \"1\"\n}\n"` 원문은 네 칸 들여쓰기와 끝 줄바꿈으로, 탭 들여쓰기 원문은 탭으로 쓴다.
- `planSecretPatch`: 추가는 끝에 붙고, 교체는 자리를 지키며, 같은 값은 `replace` 없이 `unchanged`, 다른 값에 `replace` 가 없으면 `EXIT_PARAM_ERROR`, 없는 필드 삭제는 `unchanged` 다. `__proto__` 필드를 더하면 결과 객체의 자기 속성이 되고 프로토타입은 그대로다.
- `verifySecretPatch`: 정상 일치, 필드 값 불일치, 다른 필드 변경, 다른 필드 추가, `fetched` 가 `null`, 삭제 대조를 각각 확인한다.

### 6. `src/commands/skm/secret-patch.test.ts` 신규: 명령 테스트

`getSecret` 첫 응답을 `{"db":"old","port":5432}` 로 둔다. 표준 입력은 `isTTY` 를 `false` 로, `read` 를 `Buffer.from("new")` 로 준다.

- 미리보기: `--json secret patch k1 db --replace` 는 `updateSecret` 을 부르지 않고, stdout 을 `JSON.parse` 하면 `{ keyId: "k1", field: "db", action: "replaced", applied: false, fieldVerified: null, othersVerified: null }` 이며, stderr 에 `--yes를 붙이세요` 가 있다.
- `--replace` 누락: `secret patch k1 db` 는 `EXIT_PARAM_ERROR`, `updateSecret` 미호출.
- 반영 성공: `getSecret` 두 번째 응답을 `{"db":"new","port":5432}` 로 두고 `--json secret patch k1 db --replace --yes` 가 `updateSecret("k1", "{\"db\":\"new\",\"port\":5432}")` 를 부르며 결과가 `applied: true`, 두 대조 값 `true` 다. stdout 전체에 `new` 와 `old`, `sha` 가 없다(`updateSecret` 응답의 `secretValue` 도 나오지 않는다).
- 추가: 두 번째 `getSecret` 응답을 `{"db":"old","port":5432,"newkey":"new"}` 로 두고 `newkey` 필드를 `--yes` 로 더하면 `action: "added"`, 종료 코드 0.
- 같은 값: 표준 입력이 `old` 면 `--yes` 를 줘도 `updateSecret` 을 부르지 않고 `action: "unchanged"`, `applied: false`.
- 삭제: 두 번째 `getSecret` 응답을 `{"port":5432}` 로 두고 `secret patch k1 db --delete --yes` 는 표준 입력을 읽지 않고(`read` 미호출) `{"port":5432}` 를 보낸다. `--delete --replace`, `--delete --file x` 는 `resolveSkmClient` 전에 `EXIT_PARAM_ERROR`.
- 대조 불일치: 두 번째 응답이 `{"db":"other","port":5432}` 면 결과(`fieldVerified: false`, `othersVerified: true`)를 출력하고 `EXIT_API_ERROR` 로 거절되며 오류 문구에 `승인 기능` 이 있다. 두 번째 응답의 `port` 가 바뀌면 `othersVerified: false`.
- 다시 조회 실패: 두 번째 `getSecret` 이 `NhnCloudCliError("API 호출 실패 (500): boom", EXIT_API_ERROR)` 로 거절되면 `applied: true`, 대조 값 `null` 을 출력하고 `검증하지 못했습니다` 를 담은 `EXIT_API_ERROR` 다.
- 쓰기 실패: `updateSecret` 이 `NhnCloudCliError("API 호출 실패 (403): denied", EXIT_AUTH_ERROR)` 로 거절되면 stdout 이 비어 있고, 오류는 `EXIT_AUTH_ERROR` 이며 `--yes 없이 다시 실행` 을 담는다.
- 거절: 현재 값이 `plain` 이거나 `{"id":12345678901234567890}` 이면 `EXIT_PARAM_ERROR`, `updateSecret` 미호출, 오류 문구에 원문이 없다.
- 줄바꿈 경고: 표준 입력이 `new\n` 이면 stderr 에 `줄바꿈으로 끝납니다` 가 있다.
- `--quiet secret patch k1 db --replace` 의 stdout 은 `replaced\n` 이다.

### 7. 사용자 문서

- `skills/nhncloud-cli/references/skm.md` 「쓰기 명령」 에 patch 예시와 규칙을 더한다.

  ```bash
  printf '%s' "$NEW_PASSWORD" | nhncloud skm secret patch <key-id> db_password --replace          # 미리보기
  printf '%s' "$NEW_PASSWORD" | nhncloud skm secret patch <key-id> db_password --replace --yes    # 반영
  nhncloud skm secret patch <key-id> old_field --delete --yes
  ```

  규칙: 값이 JSON 객체인 기밀 데이터에만 쓴다. 값은 `--file` 이나 표준 입력으로만 받고 문자열로 들어간다. 기본은 미리보기다. 값이 다른 기존 필드는 `--replace` 가 필요하다. 반영 뒤 다시 조회해 대조하고, 어긋나면 종료 코드 1이다. 실패 문구별 할 일(쓰기 요청 실패는 `--yes` 없이 다시 실행해 `action` 확인, 다시 조회 실패와 대조 불일치는 `secret get` 으로 현재 값 확인)을 적는다. 같은 키를 동시에 고치면 앞의 변경을 덮어쓰고 되돌릴 수 없다는 것, 중복 키는 뒤의 것만 남는다는 것, 들여쓰기 밖의 공백은 다시 쓴다는 것을 적는다.
- 같은 파일 `--quiet` 목록에 `secret patch`: `action`(`added`, `replaced`, `deleted`, `unchanged`) 을 더한다. 「입력과 크기 한도」 에 기밀 데이터는 공식 문서 기준 32KB 이하 텍스트이고 서버가 판정한다는 것을 더한다. 「비밀값 출력」 에 `secret patch` 는 값과 해시를 출력하지 않는다는 줄을 더한다.
- `skills/nhncloud-cli/references/common.md` 「되돌릴 수 없는 명령」 표의 첫 행(`TTY 여부와 관계없이 --yes 필수`)에 `` `skm secret patch` (`--yes` 없으면 미리보기) `` 를 더한다.
- `README.md` 「에이전트 없이 직접 쓰기」 의 SKM 예시 아래에 `printf '%s' "$VALUE" | nhncloud skm secret patch <key-id> <field> --replace --yes   # JSON 기밀 데이터의 필드 하나만 바꾸기` 를 더한다(정렬은 주변 줄에 맞춘다).

## 검증

```bash
node_modules/.bin/vitest run src/commands/skm/secret-json.test.ts src/commands/skm/secret-patch.test.ts src/commands/skm/input.test.ts src/commands/skm/key-write.test.ts
pnpm tsc --noEmit
pnpm test
pnpm run build
node dist/index.js commands --json | grep -q '"skm secret patch"'
node dist/index.js skm secret patch k1 f --delete --replace; test $? -eq 3
node dist/index.js skm secret patch k1 "" --delete; test $? -eq 3
pnpm verify:package
node scripts/check-pii.mjs
git diff --check
```

`pnpm` 이 esbuild 승인 문제로 막히면 `node_modules/.bin/vitest run`, `node_modules/.bin/tsc --noEmit`, `node_modules/.bin/tsup` 으로 같은 검증을 한다.
실제 SKM 을 호출하는 검증은 이 phase 에서 하지 않는다. 테스트는 모두 `SkmClient` 메서드를 가짜로 둔다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/commands/skm/input.ts` | 수정 |
| `src/commands/skm/input.test.ts` | 수정 |
| `src/commands/skm/secret-json.ts` | 수정 |
| `src/commands/skm/secret-json.test.ts` | 수정 |
| `src/commands/skm/secret.ts` | 수정 |
| `src/commands/skm/secret-patch.test.ts` | 신규 |
| `skills/nhncloud-cli/references/skm.md` | 수정 |
| `skills/nhncloud-cli/references/common.md` | 수정 |
| `README.md` | 수정 |
