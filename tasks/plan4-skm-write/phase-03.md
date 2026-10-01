# Phase 03. skm keystore create|update|delete와 auth add|delete|purge

**Execution profile**: deep

## 목표

키 저장소 생성·부분 수정·삭제(비활성화)와 인증 정보 추가·삭제 예약·즉시 삭제 명령을 추가한다.
키 저장소 수정은 현재 값을 읽어 주지 않은 항목을 채우고, 모든 삭제는 `--yes` 없이 API를 호출하지 않는다.

**범위 외**: 키 쓰기 명령은 Phase 02다. 문서는 Phase 04다. 실제 API를 호출하지 않는다.

## 컨텍스트

- Phase 01 client 메서드(`src/services/skm/client.ts`): `createKeyStore(input: SkmKeyStoreInput): Promise<SkmCreatedKeyStore>`, `updateKeyStore(keyStoreId, input): Promise<void>`, `deleteKeyStore(keyStoreId): Promise<void>`, `addAuth(type: "ipv4" | "mac", keyStoreName, value, description)`, `addCertificate(keyStoreName, name, password, lifeTime, description)`, `scheduleAuthDeletion(type, keyStoreName, value)`, `deleteAuthNow(type, keyStoreName, value)`. 타입 `SkmKeyStoreInput`, `SkmAuthMode`, `SkmAuthAdded`, `SkmAuthDeletion`은 `src/services/skm/types.ts`. 실제 시그니처는 파일을 읽어 확인한다.
- 기존 client 메서드 `getKeyStore(keyStoreId): Promise<SkmKeyStore>`. `SkmKeyStore`는 `name`, `description?`, `ip4AuthUse`, `macAuthUse`, `certificateAuthUse`(`"Y"`/`"N"` 문자열)를 갖고 `authMode`는 없다.
- Phase 02가 `src/commands/skm/helpers.ts`에 추가한 `resolveKeyStoreName(client, keyStoreId)`, `outputSkmWriteResult(opts, result, ids)`. 기존 helper `withSkmOptions`, `parseKeyStoreId`, `parseAuthTypeOption`, `parseKeyNameOption`, `parseMacAddressOption`, `resolveSkmClient`, `withSkmSpinner`, `formatCell`.
- `src/commands/skm/keystore.ts`: `listCommand`, `getCommand`, 로컬 `withTypeOption(command)`(`--type` 필수 옵션), `authListCommand`, `authGetCommand`, `authCommand`, `keystoreCommand`.
- 입력: `src/commands/skm/input.ts`의 `readSkmInput`, `decodeUtf8Input`, `SkmInputSpec`(`textFlag`, `label`, `maxBytes`). 오류 문구에 `--file`이 고정돼 있다.
- `--yes` 확인: `src/commands/resource-resolver.ts`의 `requireYes(yes, operation)`.
- 정수 옵션: `src/commands/parse-options.ts`의 `parsePositiveIntegerOption(value, flag)`. IPv4 검증은 `node:net`의 `isIP(value) === 4`.
- 테스트 선례: Phase 02의 `src/commands/skm/key-write.test.ts`.

**근거 문서**: `docs/adr/040-skm-write-commands.md`, `docs/flow.md`의 「Secure Key Manager 쓰기」 절

## 의도 메모

- 키 저장소 수정은 읽은 뒤 쓴다. 그 사이 다른 변경은 덮인다(ADR-040이 감수한 비용). 조회가 실패하면 수정 요청을 보내지 않는다.
- 인증서 비밀번호만 끝 줄바꿈 하나를 지운다. 기밀 데이터 값과 다른 규칙이며 `docs/flow.md`에 적혀 있다.
- MAC 값은 조회 옵션과 같이 콜론 형식만 받고 소문자로 바꿔 보낸다. CLI가 헤더로 보내는 값과 등록 값이 같은 형태가 된다.
- 인증 정보 삭제와 키 저장소 인증 설정 변경은 실행 위치를 잠글 수 있다. 명령 설명 끝에 `(실행 위치가 키를 쓰지 못하게 될 수 있음, 먼저 skm confirm으로 확인)`을 넣는다.

## 작업 항목

### 1. `src/commands/skm/input.ts`

`SkmInputSpec`에 `fileFlag?: string`(기본 `"--file"`)을 추가한다. 두 오류 문구의 `--file`을 이 값으로 바꾼다. 기존 호출부는 바꾸지 않는다.

### 2. `src/commands/skm/helpers.ts`에 파서 추가

```ts
/** "ipv4,mac,certificate" 중 하나 이상을 받아 Y/N 세 값으로 바꾼다. */
export function parseAuthListOption(value: string): Pick<SkmKeyStoreInput, "ip4AuthUse" | "macAuthUse" | "certificateAuthUse">;
/** "and" | "or" (대소문자 무시) → "AND" | "OR" */
export function parseAuthModeOption(value: string): SkmAuthMode;
/** --description: trim 후 비면 undefined, 1000자 초과면 오류 */
export function parseDescriptionOption(value: string | undefined, maxLength: number): string | undefined;
/** 인증 정보 값: ipv4 는 IPv4 형식, mac 은 콜론 형식을 소문자로, certificate 는 trim 한 이름 */
export function parseAuthValue(type: SkmAuthType, value: string): string;
```

오류는 모두 `EXIT_PARAM_ERROR`다.

| 함수 | 조건 | 문구 |
|---|---|---|
| `parseAuthListOption` | 빈 항목, 알 수 없는 값 | `` `--auth는 ipv4, mac, certificate를 쉼표로 나열해야 합니다 (입력: ${JSON.stringify(value)}).` `` |
| `parseAuthModeOption` | `and`·`or` 외 | `` `--auth-mode는 and 또는 or여야 합니다 (입력: ${JSON.stringify(value)}).` `` |
| `parseDescriptionOption` | 길이 초과 | `` `--description은 ${maxLength}자 이하여야 합니다.` `` |
| `parseAuthValue` ipv4 | `isIP` ≠ 4 | `` `IPv4 주소 형식이 아닙니다 (입력: ${JSON.stringify(value)}).` `` |
| `parseAuthValue` mac | `/^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/` 불일치 | `` `MAC 주소는 aa:bb:cc:dd:ee:ff 형식이어야 합니다 (입력: ${JSON.stringify(value)}).` `` |
| `parseAuthValue` certificate | trim 후 빈 값 | `인증서 이름이 비어 있습니다.` |

### 3. `src/commands/skm/keystore-manage.ts` 신규

`createCommand`, `updateCommand`, `deleteCommand`, `authAddCommand`, `authDeleteCommand`, `authPurgeCommand`를 export한다.
`keystore.ts`가 앞 셋을 `keystoreCommand`에, 뒤 셋을 `authCommand`에 붙인다. `keystore.ts`의 로컬 `withTypeOption`을 `src/commands/skm/helpers.ts`로 옮겨 export하고, `keystore.ts`와 `keystore-manage.ts`가 둘 다 helpers에서 import한다. `keystore-manage.ts`는 `keystore.ts`를 import하지 않는다(명령 파일끼리 import하면 순환과 초기화 순서 오류가 생긴다).
설명을 `keystoreCommand`는 `SKM 키 저장소와 인증 정보 조회·관리`, `authCommand`는 `키 저장소 IPv4·MAC·인증서 인증 정보 조회·관리`로 바꾼다. 모든 말단 명령에 `withSkmOptions`를 쓰고, `parseMacAddressOption(opts.macAddress)` 결과를 `resolveSkmClient({ profile: opts.profile, macAddress })`에 넘긴다.

| 명령 | 인수·옵션 | 동작 | 출력 |
|---|---|---|---|
| `create` | `--name <name>` 필수, `--auth <list>` 필수, `--auth-mode <mode>`(기본 `and`), `--description <text>` | `parseKeyNameOption`, `parseAuthListOption`, `parseAuthModeOption`, `parseDescriptionOption(…, 1000)` → `createKeyStore` | 응답 body, ids `[String(keyStoreId)]` |
| `update <keystore-id>` | `--auth-mode <mode>` 필수, `--name`, `--description`, `--auth <list>` | 아래 | `{ operation: "keystore-update", status: "succeeded", keyStoreId, ...보낸 input }`, ids `[String(keyStoreId)]` |
| `delete <keystore-id>` | `--yes` | `requireYes(opts.yes, "키 저장소 삭제")` → `deleteKeyStore` | `{ operation: "keystore-delete", status: "succeeded", keyStoreId }`, ids `[String(keyStoreId)]` |
| `auth add <keystore-id> <value>` | `--type` 필수, `--description`, `--life-time <days>`, `--password <pw>`, `--password-file <path>` | 아래 | `{ operation: "auth-add", type, keyStoreId, ...응답 }`, ids `[parseAuthValue 결과]` (응답 값은 null일 수 있어 쓰지 않는다) |
| `auth delete <keystore-id> <value>` | `--type` 필수, `--yes` | `requireYes(opts.yes, "인증 정보 삭제 예약")` → `parseAuthValue` → 이름 조회 → `scheduleAuthDeletion` | `{ operation: "auth-delete-scheduled", type, keyStoreId, ...응답 }`, ids `[parseAuthValue 결과]` |
| `auth purge <keystore-id> <value>` | `--type` 필수, `--yes` | `requireYes(opts.yes, "인증 정보 즉시 삭제")` → 같음 → `deleteAuthNow` | `{ operation: "auth-purge", type, keyStoreId, ...응답 }`, ids `[parseAuthValue 결과]` |

모든 쓰기 결과는 `outputSkmWriteResult`로 출력한다.

`update` 순서:

1. `parseKeyStoreId`, `parseAuthModeOption`, 있으면 `parseKeyNameOption`·`parseDescriptionOption(…, 1000)`·`parseAuthListOption`.
2. `resolveSkmClient` → spinner 안에서 `getKeyStore(id)`.
3. `SkmKeyStoreInput`을 만든다. `name`은 옵션 값 또는 현재 `name`, `description`은 옵션 값 또는 현재 값(문자열일 때만), 인증 세 값은 `--auth`가 있으면 그 값 아니면 현재 값(`"Y"`가 아니면 `"N"`), `authMode`는 옵션 값.
4. 세 인증 값이 모두 `"N"`이면 `키 저장소 인증은 하나 이상 켜야 합니다.`를 `EXIT_PARAM_ERROR`로 던지고 수정 요청을 보내지 않는다.
5. `updateKeyStore(id, input)`.

`auth add` 순서:

1. `parseKeyStoreId`, `parseAuthTypeOption`, `parseAuthValue`, `parseDescriptionOption(…, 1000)`.
2. 타입이 `certificate`면 `--life-time`이 필수다(`parsePositiveIntegerOption(opts.lifeTime, "--life-time")`, 없으면 `인증서 추가에는 --life-time이 필요합니다.`). 비밀번호는 `readSkmInput({ text: opts.password, file: opts.passwordFile }, { textFlag: "--password", fileFlag: "--password-file", label: "인증서 비밀번호", maxBytes: 1024 })` → `decodeUtf8Input` → 끝의 `\r\n` 또는 `\n` 하나를 지운다. 지운 뒤 비면 `인증서 비밀번호가 비어 있습니다.`.
3. 타입이 `ipv4`·`mac`인데 `--life-time`, `--password`, `--password-file` 중 하나라도 있으면 `--life-time과 --password는 --type certificate에서만 씁니다.`. 이때 stdin은 읽지 않는다.
4. `resolveSkmClient` → spinner 안에서 `resolveKeyStoreName` → `addAuth` 또는 `addCertificate`.

`update`와 `auth delete`·`auth purge`의 설명 끝에 「의도 메모」의 잠금 경고 문구를 넣는다.

### 4. 테스트

`src/commands/skm/helpers.test.ts`에 추가: 작업 항목 2 표의 오류 행마다 한 건과 정상값(`"ipv4,mac"` → `{ ip4AuthUse: "Y", macAuthUse: "Y", certificateAuthUse: "N" }`, `"OR"` → `"OR"`, `parseAuthValue("mac", "AA:BB:CC:DD:EE:FF")` → 소문자).

`src/commands/skm/input.test.ts`에 추가: `fileFlag: "--password-file"`이면 함께 지정 오류와 입력 없음 오류 문구에 `--password-file`이 나온다.

`src/commands/skm/keystore-write.test.ts` 신규. `key-write.test.ts`와 같은 방식으로 `keystoreCommand`를 실행한다.

- `keystore create --name s --auth ipv4`: `createKeyStore({ name: "s", ip4AuthUse: "Y", macAuthUse: "N", certificateAuthUse: "N", authMode: "AND" })`(description 키 없음).
- `keystore update 5 --auth-mode or --description d`: `getKeyStore(5)` 뒤 `updateKeyStore(5, …)`에 현재 `name`과 현재 인증 값, `description: "d"`, `authMode: "OR"`가 담긴다.
- `keystore update 5 --name n`(`--auth-mode` 누락): 종료 코드 3, `getKeyStore`를 부르지 않는다.
- 현재 값이 `ip4AuthUse: "Y"`만 켜진 저장소에 `keystore update 5 --auth-mode and --auth certificate`는 통과하고, 현재 값이 모두 `"N"`인 응답을 흉내 내면 `EXIT_PARAM_ERROR`이고 `updateKeyStore`를 부르지 않는다.
- `keystore delete 5`(`--yes` 없음): `resolveSkmClient`를 부르지 않고 `EXIT_PARAM_ERROR`. `--yes`면 `deleteKeyStore(5)`.
- `keystore auth add 5 10.0.0.1 --type ipv4`: 이름 조회 뒤 `addAuth("ipv4", "store-name", "10.0.0.1", undefined)`.
- `keystore auth add 5 AA:BB:CC:DD:EE:FF --type mac`: `addAuth("mac", "store-name", "aa:bb:cc:dd:ee:ff", undefined)`.
- `keystore auth add 5 cert1 --type certificate --life-time 365 --password "pw\n"`: `addCertificate("store-name", "cert1", "pw", 365, undefined)`.
- `keystore auth add 5 cert1 --type certificate --password pw`(`--life-time` 없음), `keystore auth add 5 10.0.0.1 --type ipv4 --life-time 1`, `keystore auth add 5 999.0.0.1 --type ipv4`: 모두 `resolveSkmClient`를 부르지 않고 `EXIT_PARAM_ERROR`.
- `keystore auth delete 5 cert1 --type certificate --yes`: `scheduleAuthDeletion("certificate", "store-name", "cert1")`. `auth purge … --yes`는 `deleteAuthNow`. 둘 다 `--yes`가 없으면 `EXIT_PARAM_ERROR`.
- `--json` 출력 어디에도 인증서 비밀번호 문자열이 없다.

## 검증

```bash
node_modules/.bin/vitest run src/commands/skm/keystore-write.test.ts src/commands/skm/helpers.test.ts src/commands/skm/input.test.ts src/commands/skm/key-write.test.ts src/commands/skm/inventory.test.ts src/commands/skm/data.test.ts
pnpm tsc --noEmit
pnpm test
pnpm run build
node dist/index.js commands --json | grep -c '"path": "skm'   # 33
node dist/index.js skm keystore delete 5; echo "exit=$?"   # exit=3
git diff --check
```

카탈로그 33은 Phase 02의 27에 `skm keystore create`, `skm keystore update`, `skm keystore delete`, `skm keystore auth add`, `skm keystore auth delete`, `skm keystore auth purge`를 더한 값이다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/commands/skm/input.ts` | 수정 |
| `src/commands/skm/input.test.ts` | 수정 |
| `src/commands/skm/helpers.ts` | 수정 |
| `src/commands/skm/helpers.test.ts` | 수정 |
| `src/commands/skm/keystore-manage.ts` | 신규 |
| `src/commands/skm/keystore.ts` | 수정 |
| `src/commands/skm/keystore-write.test.ts` | 신규 |
