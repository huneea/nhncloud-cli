# Phase 02. RDS for MySQL endpoint, 서비스 client 와 configure 플래그

**Execution profile**: standard

## 목표

RDS for MySQL API v3 를 부르는 `RdsMysqlClient` 와 region host 함수, 응답 타입 가드, 오류 변환을 만들고
`nhncloud configure --rds-mysql-appkey` 로 appkey 를 저장할 수 있게 한다.

**범위 외**: Commander 명령(phase-03, phase-04), 사용자 문서(phase-05).

## 컨텍스트

- 인증, host, 봉투 규칙은 `docs/adr/046-rds-mysql-v3-static-auth.md` 가 정한다. 작업 상태 해석은 `docs/adr/047-rds-mysql-write-preview-and-job-wait.md` 다.
- 같은 정적 헤더 방식의 선례는 `src/services/ncr/client.ts`(`X-TC-AUTHENTICATION-ID`/`SECRET`, 이름 있는 응답 필드, `unwrapHeader`)다.
  요청 공통 함수(`send`, `request`), 봉투 판정(`isEnvelope`), HTTP 오류 본문 해석(`toSkmError`)의 구조는 `src/services/skm/client.ts` 를 따른다.
- 대기 루프의 선례는 `src/services/apigateway/client.ts` 의 `waitForDeploy`(deadline, `Math.min(intervalMs, remaining)` sleep)다.
- region host 함수의 선례는 `src/api/endpoints.ts` 의 `ncrHost(region, environment)` 다. 테스트 선례는 `src/api/gov-endpoints.test.ts`.
- configure 선례는 `--skm-appkey` 다(`src/commands/configure.ts` 의 `skmAppkey`, `saveAndVerify(...)` 의 `skm` 인자, `setServiceCredential(profileName, "skm", skm)`, 테스트 `src/commands/configure.test.ts` 의 "--skm-appkey 단독 호출" 사례). 대화형 마법사는 SKM 을 묻지 않으며 RDS 도 묻지 않는다. 연결 테스트도 하지 않는다.

공식 문서 응답 예(v3, header 제외 필드):

```json
{"dbInstances":[{"dbInstanceId":"550e8400-e29b-41d4-a716-446655440000","dbInstanceGroupId":"550e8400-e29b-41d4-a716-446655440000","dbInstanceName":"dbInstanceName-example","description":"description-example","dbVersion":"MYSQL_V8411","dbPort":13306,"dbInstanceType":"MASTER","dbInstanceStatus":"AVAILABLE","progressStatus":"NONE","createdYmdt":"2023-12-31T15:00:00+09:00","updatedYmdt":"2023-12-31T15:00:00+09:00"}]}
{"dbSchemas":[{"dbSchemaId":"550e8400-e29b-41d4-a716-446655440000","dbSchemaName":"dbSchemaName-example","dbSchemaStatus":"STABLE","createdYmdt":"2023-12-31T15:00:00+09:00"}]}
{"dbUsers":[{"dbUserId":"550e8400-e29b-41d4-a716-446655440000","dbUserName":"dbUserName-example","host":"192.168.0.1","authorityType":"CUSTOM","dbUserStatus":"STABLE","createdYmdt":"2023-12-31T15:00:00+09:00","updatedYmdt":"2023-12-31T15:00:00+09:00","authenticationPlugin":"NATIVE","tlsOption":"NONE"}]}
{"jobId":"550e8400-e29b-41d4-a716-446655440000"}
{"jobId":"550e8400-e29b-41d4-a716-446655440000","jobStatus":"DELETED","resourceRelations":[{"resourceType":"resourceType-example","resourceId":"resourceId-example"}],"createdYmdt":"2023-12-31T15:00:00+09:00","updatedYmdt":"2023-12-31T15:00:00+09:00"}
```

DB 인스턴스 상세(`GET /v3.0/db-instances/{dbInstanceId}`)는 목록 항목 필드를 최상위에 두고 `dbFlavorId`, `parameterGroupId`, `dbSecurityGroupIds`, `notificationGroupIds`, `useDeletionProtection`, `supportAuthenticationPlugin`(boolean), `needToApplyParameterGroup`, `needMigration`, `supportDbVersionUpgrade` 를 더한다.
실패 봉투는 `{"header":{"resultCode":-1,"resultMessage":"FAIL","isSuccessful":false}}` 이고, 인증 실패는 `resultCode` 80401, 권한 없음은 80403 이다.

**근거 문서**: `docs/adr/046-rds-mysql-v3-static-auth.md`, `docs/adr/047-rds-mysql-write-preview-and-job-wait.md`, `docs/data-schema.md` 의 「credentials.json」 절.

## 의도 메모

- v4(OAuth)는 쓰지 않는다. 헤더 값 형식이 문서로 확정되지 않았다(ADR-046).
- 가드는 공식 예제의 필드 중 명령이 쓰는 것만 필수로 둔다. 명령이 표시만 하는 선택 필드는 `string | null` 을 받고, 명령이 쓰지 않는 필드는 검사하지 않는다(`docs/pitfalls/code-review/optional-response-field-guard.md`, `docs/pitfalls/code-review/nullable-field-string-only-guard.md`). 문서가 nullable 여부를 밝히지 않아, 표시용 필드 하나가 null 로 와서 목록 전체가 형식 오류로 끝나는 일을 막는다. 공공망 가이드와 필드가 같다는 것은 문서 대조 결과지만, 필수 필드를 넓히지 않아 차이가 생겨도 깨지지 않게 한다.
- 성공 판정은 `header.isSuccessful` 로만 한다. `resultCode` 는 number 나 string 일 수 있다고 보고 `Number(resultCode)` 로 80401·80403 을 비교한다.
- 쓰기 요청은 재시도하지 않는다(`retry: 0`). 중복 생성을 막기 위해서다.
- 응답과 오류 메시지에 비밀번호가 실리지 않게, 요청 본문을 오류 메시지에 넣지 않는다.

## 작업 항목

### 1. `src/api/endpoints.ts` 에 `rdsMysqlHost(region, environment)` 를 더한다

```ts
export function rdsMysqlHost(region: string, environment: CloudEnvironment = "real"): string
```

- 일반망 맵 `RDS_MYSQL_HOST`: `kr1` → `kr1-rds-mysql.api.nhncloudservice.com`, `kr2` → `kr2-rds-mysql.api.nhncloudservice.com`, `jp1` → `jp1-rds-mysql.api.nhncloudservice.com`.
- 공공망은 `kr1` 만 `kr1-rds-mysql.api.gov-nhncloudservice.com`.
- 그 밖의 region 은 `NhnCloudCliError(..., EXIT_PARAM_ERROR)`. 문구: 일반망 `지원하지 않는 RDS for MySQL region 입니다: "${region}". 사용 가능한 region: kr1, kr2, jp1`, 공공망 `지원하지 않는 공공망 RDS for MySQL region 입니다: "${region}". 사용 가능한 region: kr1`.
- `src/api/gov-endpoints.test.ts` 에 공공망 `kr1` 주소, 공공망 `kr2` 거부(EXIT_PARAM_ERROR), 일반망 `jp1` 주소 단언을 더한다.

### 2. `src/services/rds-mysql/types.ts` 신규

타입과 가드를 둔다. 가드 이름은 `is<타입명>` 이다.

- `RdsMysqlDbInstance`: 필수 string `dbInstanceId`, `dbInstanceName`, `dbInstanceStatus`. 표시용 선택 필드 `dbVersion`, `dbInstanceType`, `progressStatus` 는 있으면 string 또는 null 이어야 한다. 그 밖의 키(`dbInstanceGroupId`, `description`, `dbPort`, `createdYmdt` 등)는 검사하지 않고 `[key: string]: unknown` 으로 남긴다.
- `RdsMysqlDbInstanceDetail extends RdsMysqlDbInstance`: 선택 `supportAuthenticationPlugin` 은 있으면 boolean 이어야 한다. boolean 이 아니면(null 포함) 가드는 통과시키되 타입은 `boolean | null | undefined` 로 두고, 쓰는 쪽은 `=== false` 일 때만 미지원으로 본다.
- `RdsMysqlDbSchema`: 필수 string `dbSchemaId`, `dbSchemaName`, `dbSchemaStatus`. 표시용 선택 `createdYmdt`(string 또는 null).
- `RdsMysqlDbUser`: 필수 string `dbUserId`, `dbUserName`, `host`, `authorityType`, `dbUserStatus`. 표시용 선택 필드 `authenticationPlugin` 과 `tlsOption` 은 둘 다 string 또는 null 이다. 그 밖의 키는 검사하지 않는다.
- `RdsMysqlJob`: 필수 string `jobId`, `jobStatus`. 표시용 선택 `resourceRelations` 는 있으면 배열이어야 하고, 각 원소의 `resourceType`, `resourceId` 는 string 또는 null 이다. `createdYmdt`, `updatedYmdt` 는 string 또는 null.
- 요청 값 타입: `RdsMysqlAuthorityType = "READ" | "CRUD" | "DDL" | "ALL"`, `RdsMysqlAuthPlugin = "NATIVE" | "CACHING_SHA2" | "SHA256"`, `RdsMysqlTlsOption = "NONE" | "SSL" | "X509"`.
- `RdsMysqlDbUserCreateInput { dbUserName: string; dbPassword: string; host: string; authorityType: RdsMysqlAuthorityType; authenticationPlugin?: RdsMysqlAuthPlugin; tlsOption?: RdsMysqlTlsOption }`.
- `RdsMysqlDbUserUpdateInput { authorityType: RdsMysqlAuthorityType; authenticationPlugin?: string; tlsOption?: string }`(현재 값을 서버 문자열 그대로 되돌려 보내므로 string).
- 작업 상태 해석: `export type RdsMysqlJobOutcome = "completed" | "failed" | "uncertain" | "running";` 와 `export function classifyJobStatus(status: string): RdsMysqlJobOutcome`.
  - `COMPLETED` → `completed`
  - `FAILED`, `ERROR`, `CANCELED`, `INTERRUPTED`, `CANNOT_PROGRESS`, `FAIL_TO_READY`, `FAIL_TO_REGISTER` → `failed`
  - `COMPLETED_WITH_ERROR`, `DELETED` → `uncertain`
  - 그 밖의 모든 값(문서에 없는 값 포함) → `running`

### 3. `src/services/rds-mysql/errors.ts` 신규

```ts
export class RdsMysqlApiError extends NhnCloudCliError {
  readonly resultCode: number | string;
  constructor(resultCode: number | string, resultMessage: string, httpStatus?: number)
}
```

- 서버가 봉투로 결과를 알린 실패다. 메시지는 `RDS for MySQL API 오류 (${resultCode}): ${sanitizeForTerminal(resultMessage)}`.
- 종료 코드는 `Number(resultCode)` 가 80401·80403 이거나 `httpStatus` 가 401·403 이면 `EXIT_AUTH_ERROR`, 아니면 `EXIT_API_ERROR`.

### 4. `src/services/rds-mysql/client.ts` 신규

```ts
export class RdsMysqlClient {
  constructor(appKey: string, uakId: string, uakSecret: string, region: string, environment: CloudEnvironment)
  listDbInstances(): Promise<RdsMysqlDbInstance[]>                 // GET /v3.0/db-instances → dbInstances
  getDbInstance(dbInstanceId: string): Promise<RdsMysqlDbInstanceDetail> // GET /v3.0/db-instances/{id} → header 를 뺀 최상위 객체
  listDbSchemas(dbInstanceId: string): Promise<RdsMysqlDbSchema[]> // GET .../db-schemas → dbSchemas
  createDbSchema(dbInstanceId: string, dbSchemaName: string): Promise<string> // POST .../db-schemas {dbSchemaName} → jobId
  listDbUsers(dbInstanceId: string): Promise<RdsMysqlDbUser[]>     // GET .../db-users → dbUsers
  createDbUser(dbInstanceId: string, input: RdsMysqlDbUserCreateInput): Promise<string> // POST .../db-users → jobId
  updateDbUser(dbInstanceId: string, dbUserId: string, input: RdsMysqlDbUserUpdateInput): Promise<string> // PUT .../db-users/{dbUserId} → jobId
  deleteDbUser(dbInstanceId: string, dbUserId: string): Promise<string> // DELETE .../db-users/{dbUserId} → jobId
  getJob(jobId: string): Promise<RdsMysqlJob>                      // GET /v3.0/jobs/{jobId} → header 를 뺀 최상위 객체
  waitForJob(jobId: string, opts: { timeoutMs: number; intervalMs?: number }): Promise<{ outcome: "completed" | "failed" | "uncertain" | "timeout"; job: RdsMysqlJob | null }>
}
```

- base URL 은 `https://${rdsMysqlHost(region, environment)}/v3.0`. 헤더는 `X-TC-APP-KEY`, `X-TC-AUTHENTICATION-ID`, `X-TC-AUTHENTICATION-SECRET`. 경로의 ID 는 `encodeURIComponent` 한다.
- 모든 요청은 `retry: 0`, `timeout: DEFAULT_TIMEOUT_MS`(`src/api/timeout.ts`).
- 응답이 `header.isSuccessful`(boolean)을 가진 객체가 아니면 `NhnCloudCliError("RDS for MySQL 응답 형식 오류: header", EXIT_API_ERROR)`. `isSuccessful` 이 false 면 `RdsMysqlApiError(header.resultCode, header.resultMessage)`.
- ky `HTTPError` 는 `readHttpErrorBody` 로 본문을 읽어 봉투면 `RdsMysqlApiError(resultCode, resultMessage, status)`, 아니면 `toNhnCloudCliError(err)`. 그 밖의 오류도 `toNhnCloudCliError` 를 거친다(이미 `NhnCloudCliError` 면 그대로).
- 최상위 객체를 돌려주는 `getDbInstance`, `getJob` 은 응답에서 `header` 키를 뺀 나머지 키를 원래 순서대로 담은 새 객체를 돌려준다. 출력 단계가 봉투를 다시 보지 않게 하기 위해서다.
- 필드 가드 실패는 `NhnCloudCliError("RDS for MySQL 응답 형식 오류: <필드 이름>", EXIT_API_ERROR)`. 목록 필드가 배열이 아니면 같은 오류다(빈 배열로 숨기지 않는다).
- 쓰기 응답의 `jobId` 가 string 이 아니면 `RDS for MySQL 응답 형식 오류: jobId`.
- `waitForJob`: deadline 까지 `getJob` 을 부르고 `classifyJobStatus` 가 `running` 이 아니면 그 결과와 job 을 돌려준다. deadline 을 넘기면 `{ outcome: "timeout", job: 마지막 job 또는 null }`. 기본 `intervalMs` 는 3000. `getJob` 의 오류는 잡지 않고 그대로 던진다.
- `updateDbUser` 는 input 의 값이 undefined 인 키를 본문에서 뺀다.

### 5. `src/commands/configure.ts` 에 `--rds-mysql-appkey <key>` 를 더한다

`--skm-appkey` 가 거치는 자리를 모두 따라간다(`docs/pitfalls/plan/integrated-command-partial-surface.md`). 아래 일곱 곳을 모두 고친다.

1. Commander 옵션 `.option("--rds-mysql-appkey <key>", "RDS for MySQL appkey (비대화형)")` 를 `--skm-appkey` 다음에 두고 `ConfigureOptions.rdsMysqlAppkey?: string` 을 더한다.
2. 빈 값 검사: `--skm-appkey` 검사 바로 뒤에 `--rds-mysql-appkey 값은 비어 있을 수 없습니다.`(EXIT_PARAM_ERROR).
3. `runNonInteractive` 에서 `skm` 변환 다음에 `const rdsMysql: ServiceCredential | undefined = opts.rdsMysqlAppkey?.trim() ? { appkey: opts.rdsMysqlAppkey.trim() } : undefined;`.
4. 빈 가드 `if (!uak && !logncrash && ... && !deploy)` 에 `&& !rdsMysql` 을 더하고, 같은 오류 문구의 플래그 나열에 `--rds-mysql-appkey` 를 더한다.
5. `hasFlag` 계산에 `opts.rdsMysqlAppkey !== undefined` 를 더한다.
6. `saveAndVerify(...)` 시그니처에 `skm` 다음 인자 `rdsMysql: ServiceCredential | undefined` 를 더하고, 저장부에 `if (rdsMysql) await setServiceCredential(profileName, "rds-mysql", rdsMysql);` 를 더한다. 연결 테스트는 하지 않는다.
7. `saveAndVerify(...)` 호출부 전부: `runNonInteractive` 의 호출은 `rdsMysql` 을, `runInteractive` 의 호출은 모두 `undefined` 를 그 자리에 넘긴다. 호출부는 `git grep -n "saveAndVerify(" -- src/commands/configure.ts` 로 센다.

### 6. 이 phase 를 검증하는 테스트

- `src/services/rds-mysql/types.test.ts` 신규: `classifyJobStatus` 의 네 갈래(`COMPLETED`, `FAILED`, `DELETED`, `RUNNING`과 문서에 없는 `SOMETHING_NEW`), `isRdsMysqlDbUser` 가 `authenticationPlugin: null` 을 받고 `dbUserId` 없는 값을 거르는 것.
- `src/services/rds-mysql/client.test.ts` 신규: `src/services/skm/client.test.ts` 처음 부분처럼 `vi.mock("ky", async (importOriginal) => ...)` 로 `HTTPError` 클래스를 보존하고 요청 함수만 바꾼다. 전체 자동 mock(`vi.mock("ky")`)은 `HTTPError` 까지 바꿔 오류 분기를 테스트할 수 없다.
  - 목록: 위 공식 예제 응답으로 `listDbUsers` 결과와 요청 URL(`https://kr1-rds-mysql.api.nhncloudservice.com/v3.0/db-instances/<id>/db-users`), 세 헤더를 단언한다. 공공망 profile 로 만든 client 의 URL 이 `kr1-rds-mysql.api.gov-nhncloudservice.com` 인지도 본다.
  - `dbUsers` 가 객체면 형식 오류(EXIT_API_ERROR).
  - 봉투 실패 `resultCode: 80401` → `RdsMysqlApiError`, EXIT_AUTH_ERROR. `resultCode: -1` → EXIT_API_ERROR.
  - 실제 `new HTTPError(...)`(401 상태, 본문은 `resultCode: 80401` 봉투)가 `RdsMysqlApiError` 와 EXIT_AUTH_ERROR 가 된다. 봉투가 아닌 본문의 500 `HTTPError` 는 `RdsMysqlApiError` 가 아니고 EXIT_API_ERROR 다.
  - `getDbInstance` 와 `getJob` 의 결과에 `header` 키가 없다.
  - `createDbUser` 가 `ky.post` 에 `json` 으로 입력을 그대로 넘기고 `jobId` 를 돌려준다. `updateDbUser` 가 undefined 키를 빼고 보낸다.
  - `waitForJob`: `intervalMs: 0` 으로 `RUNNING` 다음 `COMPLETED` 면 `completed`, `FAILED` 면 `failed`, `timeoutMs: 0` 이면 `timeout` 과 `job: null`.
- `src/commands/configure.test.ts`: `--rds-mysql-appkey` 단독 호출이 `"rds-mysql"` 서비스 자격증명으로 저장되는 사례, 빈 값이 EXIT_PARAM_ERROR 인 사례를 기존 `--skm-appkey` 사례 옆에 더한다.

## 검증

```bash
node_modules/.bin/vitest run src/services/rds-mysql/types.test.ts src/services/rds-mysql/client.test.ts src/api/gov-endpoints.test.ts src/commands/configure.test.ts
node_modules/.bin/tsc --noEmit
git grep -n "X-TC-AUTHENTICATION-SECRET" -- src/services/rds-mysql/client.ts
```

기대값: 테스트 통과, 타입 오류 0, 마지막 grep 이 한 줄 이상.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/api/endpoints.ts` | 수정 |
| `src/api/gov-endpoints.test.ts` | 수정 |
| `src/services/rds-mysql/types.ts` | 신규 |
| `src/services/rds-mysql/types.test.ts` | 신규 |
| `src/services/rds-mysql/errors.ts` | 신규 |
| `src/services/rds-mysql/client.ts` | 신규 |
| `src/services/rds-mysql/client.test.ts` | 신규 |
| `src/commands/configure.ts` | 수정 |
| `src/commands/configure.test.ts` | 수정 |
