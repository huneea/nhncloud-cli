# Phase 04. 쓰기 명령: 미리보기, 사전 검사, `--wait`

**Execution profile**: deep

## 목표

`rds-mysql schema create`, `user create`, `user update`, `user delete` 를 만든다.
`--yes` 가 없으면 미리보기, `--yes` 면 요청, `--wait` 면 작업이 끝날 때까지 기다린다.
결과를 아는 실패와 모르는 실패를 다른 문구로 안내한다.

**범위 외**: 사용자 문서(phase-05). 비밀번호 변경, 스키마 삭제, `CUSTOM` 권한 지정.

## 컨텍스트

- 규칙의 단일 소스는 `docs/adr/047-rds-mysql-write-preview-and-job-wait.md` 와 `docs/flow.md` 의 「RDS for MySQL 쓰기」 절(흐름도 포함)이다. 두 문서와 다르게 구현하지 않는다.
- phase-02 의 `RdsMysqlClient`(`getDbInstance`, `listDbSchemas`, `listDbUsers`, `createDbSchema`, `createDbUser`, `updateDbUser`, `deleteDbUser`, `waitForJob`)와 `RdsMysqlApiError`(`src/services/rds-mysql/errors.ts`), phase-03 의 `src/commands/rds-mysql/helpers.ts`(`withRdsMysqlOptions`, `parseUuidArgument`, `resolveRdsMysqlClient`, `formatCell`, `withRdsMysqlSpinner`)를 쓴다.
- 비밀번호 입력은 phase-01 의 `src/commands/input-source.ts` 의 `readInputSource(source, spec, stdin?)` 와 `decodeUtf8Input(input, label, hint)` 다. `spec.textFlag` 를 주지 않으면 파일과 표준 입력만 받고, TTY 에서 입력이 없으면 `${label}가 필요합니다. ${fileFlag} <경로>나 표준 입력(파이프)으로 전달하세요.` 로 EXIT_PARAM_ERROR 다.
  끝 줄바꿈 하나를 지우는 선례는 `src/commands/skm/keystore-manage.ts` 의 `.replace(/\r?\n$/, "")`.
- 미리보기 기본의 선례는 `src/commands/skm/secret.ts` 의 `secret patch`(결과를 출력한 뒤 종료 코드 1로 끝내는 방식 포함)다. 요청 접수 뒤 결과 불명 안내의 선례는 `src/commands/apigateway/deploy.ts` 의 "주의: 배포 요청은 이미 접수됐습니다" 분기다.
- 정수 옵션은 `src/commands/parse-options.ts` 의 `parseIntegerOption(value, flag, { min, max })` 를 쓴다.

**근거 문서**: `docs/adr/047-rds-mysql-write-preview-and-job-wait.md`, `docs/flow.md` 의 「RDS for MySQL 쓰기」 절, `docs/code-architecture.md` 의 「명령 실행 경계」 절.

## 의도 메모

- `--yes` 없을 때 종료 코드 3으로 막는 방식은 기각했다. 미리보기가 같은 검사를 하면서 쓰지 않는다.
- 사전 검사는 미리보기와 반영에서 똑같이 돈다. 결과 불명 뒤 재실행을 안전하게 하는 장치다.
- `user update` 는 생략 필드 동작이 문서에 없어 현재 `authenticationPlugin`, `tlsOption` 을 함께 보낸다. 비밀번호는 보내지 않는다.
- 비밀번호는 stdout, stderr, 오류 메시지, `--json` 어디에도 나가지 않는다. 결과 객체에 비밀번호 필드를 두지 않는다.
- `docs/pitfalls/plan/safety-note-without-user-facing-text.md`: 실패 경로 문구는 아래에 따옴표로 고정했다. 서버가 알린 실패와 결과를 모르는 실패의 문구를 섞지 않는다.
- `docs/pitfalls/plan/write-command-executor-live-call.md`: 실제 RDS 를 호출하지 않는다. 동작은 문서로 확정하고 실호출 검증은 `remote-verification.md` 의 수동 QA 로 남긴다.

## 작업 항목

### 1. `src/commands/rds-mysql/helpers.ts` 에 쓰기 공통 부분을 더한다

```ts
export interface RdsMysqlWriteOptions extends RdsMysqlCommandOptions { yes?: boolean; wait?: boolean; timeout?: string }
export function withRdsMysqlWriteOptions(command: Command): Command
export function parseWaitOptions(opts: { wait?: boolean; timeout?: string }): { wait: boolean; timeoutMs: number }
export interface RdsMysqlWriteResult {
  operation: "schema-create" | "user-create" | "user-update" | "user-delete";
  dbInstanceId: string;
  target: string;
  dbUserId: string | null;
  authorityType: string | null;
  previousAuthorityType: string | null;
  authenticationPlugin: string | null;
  tlsOption: string | null;
  action: "create" | "update" | "delete" | "unchanged";
  applied: boolean;
  jobId: string | null;
  jobStatus: string | null;
}
export function outputRdsMysqlWriteResult(opts: OutputOptions, result: RdsMysqlWriteResult): void
export async function checkInstanceForWrite(client: RdsMysqlClient, dbInstanceId: string, needsAuthPlugin: boolean): Promise<RdsMysqlDbInstanceDetail>
export async function applyRdsMysqlWrite(opts: RdsMysqlWriteOptions, wait: { wait: boolean; timeoutMs: number }, client: RdsMysqlClient, result: RdsMysqlWriteResult, request: () => Promise<string>, listHint: string): Promise<void>
```

- `withRdsMysqlWriteOptions`: `withRdsMysqlOptions` 에 `--yes`(`"요청을 보낸다. 없으면 미리보기만 한다"`), `--wait`(`"작업이 끝날 때까지 기다린다"`), `--timeout <sec>`(`"--wait 대기 상한 (초, 기본 300)"`, Commander 기본값 없음)을 더한다.
- `parseWaitOptions`: `timeout` 이 있는데 `wait` 가 아니면 `--timeout은 --wait와 함께 씁니다.`(EXIT_PARAM_ERROR). `timeout` 은 `parseIntegerOption(value, "--timeout", { min: 1, max: 3600 })`, 없으면 300초.
- `outputRdsMysqlWriteResult`: `--json` 은 객체 그대로, `--quiet` 은 `jobId` 가 있을 때만 그 한 줄, table 은 키 순서대로 `field`/`value`(`formatCell`).
- `checkInstanceForWrite`: `getDbInstance`. `needsAuthPlugin` 이고 `supportAuthenticationPlugin === false` 면 `이 DB 인스턴스는 인증 플러그인과 TLS 옵션을 지원하지 않습니다 (MySQL 5.7.33 이상). --auth-plugin과 --tls를 빼고 다시 실행하세요.`(EXIT_PARAM_ERROR). `progressStatus` 가 string 이고 `NONE` 이 아니면 stderr `경고: DB 인스턴스에서 다른 작업이 진행 중입니다 (progressStatus=${값}). 요청이 거절되거나 늦게 반영될 수 있습니다.\n` 를 쓰고 계속한다.
- `applyRdsMysqlWrite` 는 대기 여부와 상한을 다시 계산하지 않고, 명령이 파싱 단계에서 `parseWaitOptions` 로 얻은 값을 `wait` 인자로 받는다. 순서(문구는 그대로 쓴다. `${listHint}` 는 호출부가 넘기는 `nhncloud rds-mysql user list <id>` 같은 문자열):
  1. `opts.yes` 가 아니면 결과(`applied: false`)를 출력하고 stderr `미리보기입니다. 요청하지 않았습니다. 반영하려면 --yes를 붙입니다.\n` 를 쓰고 끝낸다(종료 코드 0).
  2. spinner 안에서 `request()`. 실패하면 spinner 를 실패로 끝내고, 오류가 `RdsMysqlApiError` 가 아니면 stderr `주의: 요청이 접수됐는지 알 수 없습니다. 다시 실행하기 전에 ${listHint}로 반영 여부를 확인하세요.\n` 를 쓴 뒤 원래 오류를 다시 던진다. `RdsMysqlApiError` 면 안내 없이 다시 던진다.
  3. `applied = true`, `jobId` 를 채운다. `wait.wait` 가 아니면 결과를 출력하고 stderr `안내: 작업을 요청했습니다. 결과는 nhncloud rds-mysql job get ${jobId}로 확인합니다.\n` 를 쓰고 끝낸다.
  4. `wait.wait` 면 spinner 안에서 `client.waitForJob(jobId, { timeoutMs: wait.timeoutMs })`. 이 호출이 던지면 결과를 출력한 뒤 `NhnCloudCliError(\`작업 상태를 확인하지 못했습니다 (jobId=${jobId}): ${원래 메시지}. 다시 실행하지 말고 nhncloud rds-mysql job get ${jobId}와 ${listHint}로 확인하세요.\`, EXIT_API_ERROR)` 를 던진다.
  5. `jobStatus` 를 채워 결과를 출력한 뒤 outcome 에 따라 끝낸다. 모두 EXIT_API_ERROR 다.
     - `completed`: 종료 코드 0.
     - `failed`: `RDS for MySQL 작업이 실패했습니다 (jobId=${jobId}, jobStatus=${jobStatus}). 원인을 확인해 고친 뒤 다시 실행하세요.`
     - `uncertain`: `RDS for MySQL 작업 결과를 확정하지 못했습니다 (jobId=${jobId}, jobStatus=${jobStatus}). 다시 실행하지 말고 nhncloud rds-mysql job get ${jobId}와 ${listHint}로 확인하세요.`
     - `timeout`: `RDS for MySQL 작업이 대기 상한(${초}초) 안에 끝나지 않았습니다 (jobId=${jobId}, 마지막 jobStatus=${jobStatus ?? "없음"}). 작업은 계속 진행될 수 있습니다. 다시 실행하지 말고 nhncloud rds-mysql job get ${jobId}로 확인하세요.`
- 값 파서도 이 파일에 둔다. 모두 실패하면 EXIT_PARAM_ERROR 이고 문구에 `(입력: ${JSON.stringify(value)})` 를 붙인다.
  - `parseAuthorityOption(value): RdsMysqlAuthorityType` — 대소문자 무시 `read|crud|ddl|all`. 문구 `--authority는 read, crud, ddl, all 중 하나여야 합니다`.
  - `parseAuthPluginOption(value | undefined)` — `native` → `NATIVE`, `caching-sha2` → `CACHING_SHA2`, `sha256` → `SHA256`. 문구 `--auth-plugin은 native, caching-sha2, sha256 중 하나여야 합니다`.
  - `parseTlsOption(value | undefined)` — `none|ssl|x509` → 대문자. 문구 `--tls는 none, ssl, x509 중 하나여야 합니다`.
  - `parseSchemaName(value)` — `/^[A-Za-z][A-Za-z0-9_]{0,63}$/` 이고, 소문자로 바꾼 값이 `information_schema`, `performance_schema`, `db_helper`, `sys`, `mysql`, `rds_maintenance` 가 아니어야 한다. 문구 `--name은 영문으로 시작하고 영문, 숫자, _ 로 된 64자 이하여야 합니다` 와 `${name}은 DB 스키마 이름으로 쓸 수 없습니다`.
  - `parseDbUserName(value)` — 1자 이상 32자 이하, 제어 문자 없음, `mysql.session`, `mysql.sys`, `mysql.infoschema`, `sqlgw`, `admin`, `etladm`, `alertman`, `prom`, `rds_admin`, `rds_mha`, `rds_repl` 이 아니어야 한다. 문구 `--name은 1자 이상 32자 이하여야 합니다`, `${name}은 DB 사용자 이름으로 쓸 수 없습니다`.
  - `parseDbUserHost(value)` — 1자 이상 45자 이하, 공백과 제어 문자 없음. 문구 `--host는 공백 없는 45자 이하 값이어야 합니다 (예: 10.0.0.%)`.
  - `readDbUserPassword(file: string | undefined, stdin?: StdinSource): string` — `readInputSource({ file }, { fileFlag: "--password-file", label: "DB 사용자 비밀번호", maxBytes: 1024 }, stdin)` → `decodeUtf8Input(input, "DB 사용자 비밀번호", "파일 인코딩을 확인하세요.")` → 끝 줄바꿈 하나 제거 → 코드 포인트 수(`[...password].length`)가 4 이상 256 이하가 아니면 `DB 사용자 비밀번호는 4자 이상 256자 이하여야 합니다.`(값을 문구에 넣지 않는다).

### 2. `src/commands/rds-mysql/schema.ts` 에 `schema create <db-instance-id>` 를 더한다

- `withRdsMysqlWriteOptions`, `.requiredOption("--name <schema>", "만들 DB 스키마 이름")`. 설명 `"DB 스키마를 만든다. --yes가 없으면 미리보기만 한다"`.
- 순서: 인수·옵션 파싱(`parseUuidArgument`, `parseSchemaName`, `parseWaitOptions`) → `resolveRdsMysqlClient` → `checkInstanceForWrite(client, id, false)` → `listDbSchemas` 에 같은 `dbSchemaName`(대소문자 구분)이 있으면 `이미 있는 DB 스키마입니다: ${name}`(EXIT_PARAM_ERROR) → `applyRdsMysqlWrite(..., () => client.createDbSchema(id, name), \`nhncloud rds-mysql schema list ${id}\`)`.
- 결과: `operation: "schema-create"`, `target: name`, `action: "create"`, 사용자 필드는 null.

### 3. `src/commands/rds-mysql/user.ts` 에 `user create|update|delete` 를 더한다

- `user create <db-instance-id>`: 설명 `"DB 사용자를 만든다. 비밀번호는 --password-file이나 표준 입력으로 받고, 권한은 인스턴스의 모든 스키마에 적용된다. --yes가 없으면 미리보기만 한다"`.
  옵션 `--name <user>`(required), `--host <host>`(required, 설명 `"접속 허용 host (% 로 범위 지정, 예: 10.0.0.%)"`), `--authority <type>`(required, 설명 `"권한 (read|crud|ddl|all), 인스턴스의 모든 스키마에 적용"`), `--auth-plugin <plugin>`(`"인증 플러그인 (native|caching-sha2|sha256)"`), `--tls <option>`(`"TLS 옵션 (none|ssl|x509)"`), `--password-file <path>`(`"비밀번호를 읽을 파일. 없으면 표준 입력에서 읽는다"`). `--password` 옵션은 만들지 않는다.
  순서: 인수·옵션 파싱 → `readDbUserPassword` → `resolveRdsMysqlClient` → `checkInstanceForWrite(client, id, authPlugin !== undefined || tls !== undefined)` → `listDbUsers` 에 같은 `dbUserName` 과 `host` 가 있으면 `이미 있는 DB 사용자입니다: '${name}'@'${host}'`(EXIT_PARAM_ERROR) → `applyRdsMysqlWrite(..., () => client.createDbUser(id, { dbUserName, dbPassword, host, authorityType, authenticationPlugin?, tlsOption? }), \`nhncloud rds-mysql user list ${id}\`)`. 주지 않은 선택 값은 본문에서 뺀다.
  결과: `operation: "user-create"`, `target: \`'${name}'@'${host}'\``, `authorityType`, `authenticationPlugin`, `tlsOption`(주지 않았으면 null), `action: "create"`.
- `user update <db-instance-id> <db-user-id>`: 설명 `"DB 사용자 권한을 바꾼다. --yes가 없으면 미리보기만 한다"`, `--authority <type>`(required).
  순서: 파싱 → client → `checkInstanceForWrite(client, id, false)` → `listDbUsers` 에서 `dbUserId` 를 찾는다. 없으면 `DB 사용자를 찾을 수 없습니다: ${dbUserId}. nhncloud rds-mysql user list ${id}로 dbUserId를 확인하세요.`(EXIT_PARAM_ERROR).
  현재 `authorityType` 이 새 값과 같으면 `action: "unchanged"`, `applied: false` 로 결과를 출력하고 stderr `권한이 이미 ${값}라 요청하지 않았습니다.\n` 를 쓰고 종료 코드 0(`--yes` 여도 요청하지 않는다).
  현재 값이 `CUSTOM` 이면 stderr `경고: 현재 권한이 CUSTOM입니다. 바꾸면 다시 CUSTOM으로 되돌릴 수 없습니다.\n`.
  요청 본문은 `{ authorityType, authenticationPlugin: 현재 값(string 일 때만), tlsOption: 현재 값(string 일 때만) }`. 다만 `checkInstanceForWrite` 가 돌려준 상세의 `supportAuthenticationPlugin` 이 `false` 면 두 값을 보내지 않는다(지원하지 않는 인스턴스에 그 필드를 보내면 서버가 거절할 수 있다). 결과의 `previousAuthorityType` 은 현재 값, `authenticationPlugin`·`tlsOption` 은 보낸 값, `target` 은 `'${dbUserName}'@'${host}'`, `action: "update"`.
- `user delete <db-instance-id> <db-user-id>`: 설명 `"DB 사용자를 지운다. --yes가 없으면 미리보기만 한다"`.
  사용자를 찾는 단계와 문구는 update 와 같다. 결과는 `operation: "user-delete"`, `target: \`'${dbUserName}'@'${host}'\``, `dbUserId`, `authorityType` 은 현재 값, `previousAuthorityType`·`authenticationPlugin`·`tlsOption` 은 null, `action: "delete"`.

### 4. 이 phase 를 검증하는 `src/commands/rds-mysql/write.test.ts` 신규

phase-03 의 `read.test.ts` 와 같은 mock 구성에 `processStdin`(`src/commands/input-source.ts`)을 `vi.spyOn` 으로 바꿔 표준 입력을 넣는다. 비밀번호 fixture 는 `"s3cret-pass"` 처럼 지어낸 값이다.

- `user create` 를 `--yes` 없이: `createDbUser` 를 부르지 않고, `--json` 출력의 `applied` 가 false, stdout 과 stderr 어디에도 비밀번호 문자열이 없다.
- `user create --yes --wait --quiet`: 표준 입력 `"s3cret-pass\n"` → `createDbUser` 본문의 `dbPassword` 가 `"s3cret-pass"`, `waitForJob` 이 `completed` 면 stdout 이 `jobId` 한 줄이고 성공.
- TTY 에서 비밀번호 없이 실행하면 EXIT_PARAM_ERROR 이고 `resolveRdsMysqlClient` 를 부르지 않는다. 3자 비밀번호도 EXIT_PARAM_ERROR.
- 같은 `이름@host` 사용자가 있으면 EXIT_PARAM_ERROR 이고 `createDbUser` 를 부르지 않는다(`--yes` 여도).
- `--auth-plugin native` 인데 `supportAuthenticationPlugin: false` 면 EXIT_PARAM_ERROR.
- `user update` 가 같은 권한이면 `--yes` 여도 `updateDbUser` 를 부르지 않고 `action` 이 `unchanged`. 다른 권한이면 본문에 현재 `authenticationPlugin`·`tlsOption` 이 들어간다. 현재 `CUSTOM` 이면 stderr 에 `다시 CUSTOM으로 되돌릴 수 없습니다` 가 나온다.
- `user delete` 의 `dbUserId` 가 목록에 없으면 EXIT_PARAM_ERROR.
- `--wait` 결과 `failed` → EXIT_API_ERROR, 오류 문구에 `원인을 확인해 고친 뒤 다시 실행하세요`. `uncertain` → `다시 실행하지 말고`. 두 경우 모두 stdout 에 결과가 먼저 나온다.
- `createDbUser` 가 `new Error("fetch failed")` 로 실패하면 stderr 에 `요청이 접수됐는지 알 수 없습니다` 가 나오고, `RdsMysqlApiError` 로 실패하면 나오지 않는다.
- `--wait` 에서 `waitForJob` 이 `{ outcome: "timeout", job: null }` 을 돌려주면 EXIT_API_ERROR 이고 오류 문구에 `대기 상한(` 과 `마지막 jobStatus=없음`, `다시 실행하지 말고` 가 있다.
- `--wait` 에서 `waitForJob` 이 reject 하면 EXIT_API_ERROR 이고 오류 문구에 `작업 상태를 확인하지 못했습니다` 와 `다시 실행하지 말고` 가 있다. stdout 에 결과(`applied: true`)가 먼저 나온다.
- `--yes` 없이 실행하면 stderr 에 `미리보기입니다. 요청하지 않았습니다. 반영하려면 --yes를 붙입니다.` 가 나온다.
- `--yes` 만 주고 `--wait` 를 주지 않으면 stderr 에 `nhncloud rds-mysql job get <jobId>로 확인합니다` 가 나오고 성공한다.
- `supportAuthenticationPlugin: false` 인 인스턴스의 `user update` 는 본문에 `authenticationPlugin`, `tlsOption` 이 없다.
- `--timeout 10` 을 `--wait` 없이 주면 EXIT_PARAM_ERROR.
- `schema create --name 1abc`, `--name mysql` 은 EXIT_PARAM_ERROR 이고 client 를 만들지 않는다. 이미 있는 이름이면 EXIT_PARAM_ERROR.
- `progressStatus: "CREATING_USER"` 면 stderr 에 `다른 작업이 진행 중입니다` 가 나오고 미리보기는 성공한다.

## 검증

```bash
node_modules/.bin/vitest run src/commands/rds-mysql/write.test.ts src/commands/rds-mysql/read.test.ts src/commands/reserved-flags.test.ts
node_modules/.bin/tsc --noEmit
node_modules/.bin/tsup && node dist/index.js rds-mysql user create --help | grep -c -- "--password-file"
! node dist/index.js rds-mysql user create --help | grep -q -- "--password <"
```

기대값: 테스트 통과, 타입 오류 0, help 에 `--password-file` 이 있고 `--password <` 옵션은 없다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/commands/rds-mysql/helpers.ts` | 수정 |
| `src/commands/rds-mysql/schema.ts` | 수정 |
| `src/commands/rds-mysql/user.ts` | 수정 |
| `src/commands/rds-mysql/write.test.ts` | 신규 |
