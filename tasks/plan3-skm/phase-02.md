# Phase 02. skm confirm, keystore, key 조회 명령

**Execution profile**: standard

## 목표

`nhncloud skm` 명령군을 등록하고 조회 명령 `confirm`, `keystore list|get`, `keystore auth list|get`, `key list|get`을 추가한다.
공통 client 해석, MAC 주소 검증, 인증서 비밀번호 가리기를 `src/commands/skm/helpers.ts`에 둔다.

**범위 외**: 데이터 명령(`secret`, `symmetric-key`, `asymmetric-key`)은 Phase 03이다. 사용자 가이드는 Phase 04다. 실제 API를 호출하지 않는다.

## 컨텍스트

- Phase 01이 추가한 것: `src/services/skm/client.ts`의 `SkmClient`(생성자 `(accessToken, environment, appKey, macAddress?)`와 `confirm`, `listKeyStores`, `getKeyStore`, `listKeys`, `getKey`, `listAuths`, `getAuth`), `src/services/skm/types.ts`의 `SkmKeyType`, `SkmKeyStatusFilter`, `SkmAuthType`, `SkmKeyStore`, `SkmKey`, `SkmAuthDetail`, `SkmClientInfo`. `endpointFor("skm", environment)`.
- 자격증명 해석 선례: `src/commands/deploy/helpers.ts`의 `createDeployClient`(`resolveProfileName` → `getUserAccessKey` → `getProfileEnvironment` → `getAccessToken(profileName, uak.id, uak.secret, false, environment)`). 함수들은 `src/config/credentials.ts`와 `src/api/oauth.ts`에 있다.
- appkey 해석: `src/commands/service-appkey.ts`의 `resolveServiceAppKey(service, profileName, missingMessage)`. 없으면 `EXIT_CONFIG_ERROR`.
- 명령 파일 선례: `src/commands/apigateway/service.ts`(`optsWithGlobals`, `startSpinner`/`stopSpinner`, `output(opts, { headers, rows, raw, ids })`, `sanitizeForTerminal`).
- 인수 정제: `src/commands/parse-options.ts`의 `parseRequiredArgument(value, label)`, `parseNonNegativeIntegerOption(value, flag)`.
- 출력: `src/formatters/table.ts`의 `output`, `OutputOptions`. 빈 목록은 table에서 `결과 없음`, quiet에서 빈 출력이다.
- 명령 등록: `src/index.ts`가 서비스별 `new Command("<service>")`를 만들고 하위 명령을 `addCommand`한 뒤 `program.addCommand`한다(API Gateway 블록 참고). `configureCommanderExitCodes(program)`보다 앞에 둔다.

**근거 문서**: `docs/flow.md`의 「Secure Key Manager」 절, `docs/adr/039-skm-client-auth-and-secret-output.md`

## 의도 메모

- 모든 옵션과 인수 파싱은 `resolveSkmClient`와 spinner보다 먼저 끝낸다. 파싱 결과를 `parsedX` 변수에 담아 아래에서만 쓴다.
- 키 저장소 관리 API가 클라이언트 인증을 요구하는지 문서에 없다. 그래서 모든 `skm` 명령에 `--mac-address`를 둔다.
- 인증서 상세 조회의 `password`는 table, `--json`, `--quiet` 어디에도 원문을 내지 않는다(ADR-039).
- 서버 문자열은 table 셀과 quiet 값에 넣기 전에 `sanitizeForTerminal`을 거친다. `--json`은 원문 객체를 그대로 낸다(단, 인증서 password는 가린 객체).

## 작업 항목

### 1. `src/commands/skm/helpers.ts` 신규

```ts
export interface SkmCommandOptions extends OutputOptions { profile?: string; macAddress?: string; }

/** --profile, --mac-address 를 붙인다. */
export function withSkmOptions(command: Command): Command;

/** 형식이 틀리면 EXIT_PARAM_ERROR. undefined 는 그대로 돌려준다. */
export function parseMacAddressOption(value: string | undefined): string | undefined;

/** <keystore-id> 인수를 0 이상의 정수로 파싱한다. */
export function parseKeyStoreId(value: string): number;

/** profile → skm appkey → 공통 UAK → environment → OAuth token → SkmClient */
export async function resolveSkmClient(opts: { profile?: string; macAddress?: string }): Promise<{ client: SkmClient; profileName: string }>;

/** password 가 문자열이면 "***" 로 바꾼 사본을 돌려준다. */
export function maskAuthDetail(detail: SkmAuthDetail): SkmAuthDetail;

/** null·undefined 는 "-", 나머지는 String 후 sanitizeForTerminal */
export function formatCell(value: unknown): string;
```

- `withSkmOptions`: `.option("--mac-address <mac>", "키 저장소 MAC 인증에 쓸 클라이언트 MAC 주소 (X-TOAST-CLIENT-MAC-ADDR)")`, `.option("--profile <name>", "사용할 profile 이름")`.
- `parseMacAddressOption`: 공식 문서 예시 형식(콜론 구분)만 받는다. `/^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/`에 맞으면 소문자로 바꿔 반환한다. 하이픈 구분은 서버가 같은 값으로 보는지 문서에 없어 받지 않는다. 아니면 `` `--mac-address는 aa:bb:cc:dd:ee:ff 형식이어야 합니다 (입력: ${JSON.stringify(value)}).` ``를 `EXIT_PARAM_ERROR`로 던진다.
- `parseKeyStoreId`: `parseNonNegativeIntegerOption(parseRequiredArgument(value, "keystore-id"), "<keystore-id>")`.
- `resolveSkmClient` 순서: `resolveProfileName(opts.profile)` → `resolveServiceAppKey("skm", profileName, "Secure Key Manager appkey가 없습니다. nhncloud configure --skm-appkey <key>로 설정하세요.")` → `getUserAccessKey(profileName)` → `getProfileEnvironment(profileName)` → `getAccessToken(profileName, uak.id, uak.secret, false, environment)` → `new SkmClient(accessToken, environment, appKey, opts.macAddress)`.
  appkey를 토큰 발급보다 먼저 확인해, appkey가 없으면 네트워크 요청 없이 끝낸다.

### 2. `src/commands/skm/confirm.ts` 신규

`confirmCommand = withSkmOptions(new Command("confirm").description("SKM 서버가 본 클라이언트 IP, MAC 헤더와 인증서 사용 여부를 조회한다"))`.

출력: `headers: ["field", "value"]`, 행 `clientIp`, `clientMacHeader`, `clientSentCertificate`(`formatCell`), `raw`는 body, `ids: [clientIp]`.

### 3. `src/commands/skm/keystore.ts` 신규

`keystoreCommand = new Command("keystore").description("SKM 키 저장소와 인증 정보 조회")`.

| 명령 | 인수·옵션 | client 호출 | 출력 |
|---|---|---|---|
| `list` | | `listKeyStores()` | headers `keyStoreId`, `name`, `ip4AuthUse`, `macAuthUse`, `certificateAuthUse`, `lastChangeDatetime`. `raw` 배열, `ids`는 `String(keyStoreId)` |
| `get <keystore-id>` | | `getKeyStore(id)` | `field`/`value` 행으로 `SkmKeyStore`의 모든 필드, `raw` body, `ids: [String(keyStoreId)]` |
| `auth list <keystore-id>` | `--type <type>` 필수(`requiredOption`, `ipv4\|mac\|certificate`) | `listAuths(id, type)` | headers `value`, 행은 값 하나씩. `raw` 배열, `ids` 값 목록 |
| `auth get <keystore-id> <value>` | `--type <type>` 필수 | `getAuth(id, type, value)` 결과에 `maskAuthDetail` 적용 | headers `value`, `description`, `expirationDate`, `lastAccessDatetime`, `deletionDatetime`, `lastChangeDatetime`. `value` 칸은 `detail.value ?? detail.name`. `raw` 가린 배열, `ids` 같은 값 |

`--type`이 셋 중 하나가 아니면 `` `--type은 ipv4, mac, certificate 중 하나여야 합니다 (입력: ${JSON.stringify(value)}).` ``를 `EXIT_PARAM_ERROR`로 던진다. 이 검증은 `helpers.ts`의 `parseAuthTypeOption(value: string): SkmAuthType`로 export한다.
`auth`는 `keystoreCommand` 아래 `new Command("auth").description("키 저장소 IPv4·MAC·인증서 인증 정보 조회")` 그룹이다. 모든 말단 명령에 `withSkmOptions`를 적용한다.

### 4. `src/commands/skm/key.ts` 신규

`keyCommand = new Command("key").description("SKM 키 목록과 상세 조회")`.

| 명령 | 인수·옵션 | client 호출 | 출력 |
|---|---|---|---|
| `list <keystore-id>` | `--type <type>`(`secret\|symmetric-key\|asymmetric-key`), `--name <name>`, `--status <status>`(`active\|inactive`) | `listKeys(id, filter)` | headers `keyId`, `name`, `keyType`, `currentKeyValueVersion`, `lastAccessDatetime`, `deletionDatetime`. `raw` 배열, `ids` keyId |
| `get <keystore-id> <key-id>` | | `getKey(id, keyId)` | `field`/`value` 행으로 `SkmKey`의 모든 필드, `raw` body, `ids: [keyId]` |

`helpers.ts`에 파서를 export한다.

- `parseKeyTypeOption(value: string | undefined): SkmKeyType | undefined`: `secret → SECRET`, `symmetric-key → SYMMETRIC_KEY`, `asymmetric-key → ASYMMETRIC_KEY`. 그 외는 `` `--type은 secret, symmetric-key, asymmetric-key 중 하나여야 합니다 (입력: ...).` ``
- `parseKeyStatusOption(value: string | undefined): SkmKeyStatusFilter | undefined`: `active`, `inactive` 외는 `` `--status는 active 또는 inactive여야 합니다 (입력: ...).` ``
- `--name`은 trim 후 비면 `--name은 비어 있을 수 없습니다.`, 100자를 넘으면 `--name은 100자 이하여야 합니다.` 둘 다 `EXIT_PARAM_ERROR`. 이 검증은 `parseKeyNameOption(value: string | undefined): string | undefined`로 export한다.

### 5. `src/index.ts`에 `skm` 등록

API Gateway 블록 다음에 추가한다.

```ts
const skmCommand = new Command("skm")
  .description("NHN Secure Key Manager 조회와 데이터 명령");
skmCommand.addCommand(skmConfirmCommand);
skmCommand.addCommand(skmKeystoreCommand);
skmCommand.addCommand(skmKeyCommand);
program.addCommand(skmCommand);
```

import 이름은 `confirmCommand as skmConfirmCommand`처럼 `skm` 접두사를 붙여 기존 import와 겹치지 않게 한다.

### 6. 테스트

`src/commands/skm/helpers.test.ts` 신규:

- `parseMacAddressOption`: `aa:bb:cc:dd:ee:ff`는 그대로, `AA:BB:CC:DD:EE:FF`는 소문자로 반환. `AA-BB-CC-DD-EE-FF`, `aa:bb-cc:dd:ee:ff`, `aabbccddeeff`, `""`는 `EXIT_PARAM_ERROR`.
- `parseKeyStoreId("1")`은 1, `"-1"`과 `"a"`는 `EXIT_PARAM_ERROR`.
- `parseKeyTypeOption`, `parseKeyStatusOption`, `parseAuthTypeOption`, `parseKeyNameOption`의 정상값과 오류 한 건씩. `parseKeyNameOption("a".repeat(101))`은 오류.
- `maskAuthDetail({ name: "c", password: "p" })`의 `password`는 `***`이고 원본 객체는 바뀌지 않는다. `password`가 없거나 `null`이면 그대로다.
- `resolveSkmClient`: `vi.mock`으로 `../../config/credentials.js`, `../../api/oauth.js`, `../service-appkey.js`, `../../services/skm/client.js`(생성자 `SkmClient: vi.fn()`)를 대체한다. appkey가 없으면 `getAccessToken`을 부르지 않고 `EXIT_CONFIG_ERROR`로 끝난다. `getProfileEnvironment`가 `"gov"`를 돌려주면 `SkmClient`가 `("token", "gov", "appkey", "aa:bb:cc:dd:ee:ff")`로 생성된다. 이 테스트는 `inventory.test.ts`와 mock 범위가 달라 `helpers.test.ts`에 둔다.

`src/commands/skm/inventory.test.ts` 신규. 실행 방식은 `src/commands/network/security-group.test.ts`를 따른다.
`vi.mock("./helpers.js", ...)`로 `resolveSkmClient`만 `vi.fn()`으로 바꾸고 나머지 helper는 실제 구현을 쓴다.
`formatters/table.js`의 `output`과 `utils/spinner.js`를 mock한다.
`new Command("nhncloud").exitOverride().option("--json").option("--quiet")`에 `confirmCommand`, `keystoreCommand`, `keyCommand`를 붙여 `parseAsync`로 실행한다.
`SkmClient` 인스턴스 메서드는 `vi.spyOn`으로 대체한다.

- `keystore list`: `output`이 `ids: ["1", "2"]`와 위 headers로 호출된다.
- `keystore auth get 1 cert1 --type certificate`: `output`에 넘긴 `raw[0].password`가 `***`이고, `rows`와 `raw` 어디에도 원래 비밀번호 문자열이 없다(`JSON.stringify`로 검사).
- `key list 1 --type unknown`: `resolveSkmClient`를 부르지 않고 `EXIT_PARAM_ERROR`로 reject한다.
- `key list 1 --type symmetric-key --status active`: `listKeys`가 `(1, { type: "SYMMETRIC_KEY", status: "active" })`로 호출된다. `name`은 키 자체가 없다.
- `confirm --mac-address bad`: `resolveSkmClient`를 부르지 않고 `EXIT_PARAM_ERROR`로 reject한다.
- `confirm --mac-address aa:bb:cc:dd:ee:ff`: `resolveSkmClient`가 `macAddress: "aa:bb:cc:dd:ee:ff"`를 담은 인수로 호출된다.
- `keystore auth list 1`(`--type` 누락): `src/commands/commander-errors.test.ts`처럼 root에 `configureCommanderExitCodes(root)`를 적용하면 `exitCode`가 `EXIT_PARAM_ERROR`인 오류로 reject한다.

## 검증

```bash
node_modules/.bin/vitest run src/commands/skm/helpers.test.ts src/commands/skm/inventory.test.ts
pnpm tsc --noEmit
pnpm test
pnpm run build
node dist/index.js commands --json | grep -c '"path": "skm'   # 11
node dist/index.js skm key list --help | grep -c -- "--mac-address"   # 1
git diff --check
```

카탈로그 개수 기대값은 `skm`, `skm confirm`, `skm keystore`, `skm keystore list`, `skm keystore get`, `skm keystore auth`, `skm keystore auth list`, `skm keystore auth get`, `skm key`, `skm key list`, `skm key get`의 11이다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/commands/skm/helpers.ts` | 신규 |
| `src/commands/skm/helpers.test.ts` | 신규 |
| `src/commands/skm/confirm.ts` | 신규 |
| `src/commands/skm/keystore.ts` | 신규 |
| `src/commands/skm/key.ts` | 신규 |
| `src/commands/skm/inventory.test.ts` | 신규 |
| `src/index.ts` | 수정 |
