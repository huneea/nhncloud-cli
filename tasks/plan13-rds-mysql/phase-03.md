# Phase 03. `rds-mysql` 조회 명령과 명령 트리 등록

**Execution profile**: standard

## 목표

`nhncloud rds-mysql` 명령군을 등록하고 조회 명령 다섯 개를 만든다.
`instance list`, `instance get <db-instance-id>`, `schema list <db-instance-id>`, `user list <db-instance-id>`, `job get <job-id>`.

**범위 외**: 쓰기 명령과 미리보기(phase-04), 사용자 문서(phase-05).

## 컨텍스트

- 서비스 client 는 phase-02 가 만든 `src/services/rds-mysql/client.ts` 의 `RdsMysqlClient` 다. 생성자는 `(appKey, uakId, uakSecret, region, environment)` 이고, 생성자가 `rdsMysqlHost` 로 region 을 검사한다.
- 명령 헬퍼의 선례는 `src/commands/skm/helpers.ts` 다(`withSkmOptions`, `resolveSkmClient`, `formatCell`, `withSkmSpinner`). 명령 파일 구조는 `src/commands/skm/keystore.ts`, `src/commands/skm/confirm.ts` 를 따른다.
  NCR 의 `--region <region>` 기본값 `kr1` 선례는 `src/commands/ncr/list.ts`.
- appkey 해석은 `src/commands/service-appkey.ts` 의 `resolveServiceAppKey(service, profileName, missingMessage)`, UAK 와 망은 `src/config/credentials.ts` 의 `getUserAccessKey`, `getProfileEnvironment` 다.
- 출력은 `src/formatters/table.ts` 의 `output(opts, { headers, rows, raw, ids })` 다. 빈 rows 는 table 모드에서 `결과 없음` 을 출력한다.
- `src/commands/reserved-flags.test.ts` 는 `src/commands/` 아래 모든 명령 모듈을 훑어 루트 플래그(`--json`, `--quiet`, `--request-timeout`, `--proxy` 등)와 겹치는 옵션을 막는다. 새 파일을 이 테스트에 등록할 필요는 없다.

**근거 문서**: `docs/flow.md` 의 「RDS for MySQL」 절, `docs/adr/046-rds-mysql-v3-static-auth.md`, `docs/data-schema.md` 의 「profile 해석 순서」 절.

## 의도 메모

- `<db-instance-id>`, `<db-user-id>`, `<job-id>` 는 UUID 만 받는다. 이름 해석은 하지 않는다(같은 이름 사용자가 host 별로 여럿일 수 있다).
- UUID 검사는 자격증명을 읽기 전에 한다(`docs/pitfalls/plan/option-parse-before-side-effects.md`). spinner 는 client 를 만든 뒤에 시작한다(`docs/pitfalls/code-review/spinner-before-validation.md`).
- 응답 문자열은 table 출력에서 `sanitizeForTerminal` 을 거친다(`docs/pitfalls/code-review/external-string-unsanitized.md`).

## 작업 항목

### 1. `src/commands/rds-mysql/helpers.ts` 신규

```ts
export interface RdsMysqlCommandOptions extends OutputOptions { profile?: string; region?: string }
export function withRdsMysqlOptions(command: Command): Command
export function parseUuidArgument(value: string, label: string): string
export async function resolveRdsMysqlClient(opts: { profile?: string; region?: string }): Promise<{ client: RdsMysqlClient; profileName: string }>
export function formatCell(value: unknown): string
export async function withRdsMysqlSpinner<T>(text: string, call: () => Promise<T>): Promise<T>
```

- `withRdsMysqlOptions`: `.option("--region <region>", "RDS for MySQL region (kr1|kr2|jp1, 공공망은 kr1)", "kr1")` 와 `.option("--profile <name>", "사용할 profile 이름")`.
- `parseUuidArgument`: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` 가 아니면 `NhnCloudCliError(\`${label}는 UUID 형식이어야 합니다 (입력: ${JSON.stringify(value)}).\`, EXIT_PARAM_ERROR)`. 앞뒤 공백은 지우지 않고 그대로 거른다.
- `resolveRdsMysqlClient`: `resolveProfileName` → `resolveServiceAppKey("rds-mysql", profileName, "RDS for MySQL appkey가 없습니다. nhncloud configure --rds-mysql-appkey <key>로 설정하세요.")` → `getUserAccessKey` → `getProfileEnvironment` → `new RdsMysqlClient(appKey, uak.id, uak.secret, opts.region ?? "kr1", environment)`.
- `formatCell`: null·undefined 는 `-`, 배열은 각 원소를 문자열로 바꿔 `,` 로 잇고, 그 밖은 `String(value)`. 결과는 `sanitizeForTerminal` 을 거친다.
- `withRdsMysqlSpinner`: `src/commands/skm/helpers.ts` 의 `withSkmSpinner` 와 같은 구조.

### 2. `src/commands/rds-mysql/instance.ts` 신규: `instanceCommand` 을 export 한다

- `instance list`: 설명 `"DB 인스턴스 목록을 조회한다"`. headers `dbInstanceId`, `dbInstanceName`, `dbVersion`, `dbInstanceType`, `dbInstanceStatus`, `progressStatus`. `--json` 은 `dbInstances` 배열 그대로, `--quiet` 은 `dbInstanceId` 를 줄마다.
- `instance get <db-instance-id>`: 설명 `"DB 인스턴스 상세를 조회한다"`. 응답 객체의 키를 순서대로 `field`/`value` 두 열로. `--json` 은 객체 그대로, `--quiet` 은 `dbInstanceId`.

### 3. `src/commands/rds-mysql/schema.ts` 신규: `schemaCommand` 을 export 한다

- `schema list <db-instance-id>`: 설명 `"DB 스키마 목록을 조회한다"`. headers `dbSchemaId`, `dbSchemaName`, `dbSchemaStatus`, `createdYmdt`. `--json` 은 배열 그대로, `--quiet` 은 `dbSchemaName` 을 줄마다(스키마 ID 를 받는 명령이 없어 이름이 다음 명령에 쓸모 있다).

### 4. `src/commands/rds-mysql/user.ts` 신규: `userCommand` 을 export 한다

- `user list <db-instance-id>`: 설명 `"DB 사용자 목록을 조회한다. 권한은 인스턴스의 모든 스키마에 적용된다"`. headers `dbUserId`, `dbUserName`, `host`, `authorityType`, `dbUserStatus`, `authenticationPlugin`, `tlsOption`. `--json` 은 배열 그대로, `--quiet` 은 `dbUserId` 를 줄마다.

### 5. `src/commands/rds-mysql/job.ts` 신규: `jobCommand` 을 export 한다

- `job get <job-id>`: 설명 `"비동기 작업 상태를 조회한다"`. `field`/`value` 두 열에 `jobId`, `jobStatus`, `resourceRelations`(각 항목을 `resourceType:resourceId` 로, 여러 개면 `,`), `createdYmdt`, `updatedYmdt`. `--json` 은 객체 그대로, `--quiet` 은 `jobStatus`.

### 6. `src/index.ts` 에 명령군을 등록한다

SKM 그룹 등록 바로 뒤, `program.addCommand(skillsCommand)` 앞에 둔다.

```ts
const rdsMysqlCommand = new Command("rds-mysql")
  .description("NHN Cloud RDS for MySQL DB 인스턴스·스키마·사용자 명령");
rdsMysqlCommand.addCommand(rdsMysqlInstanceCommand);
rdsMysqlCommand.addCommand(rdsMysqlSchemaCommand);
rdsMysqlCommand.addCommand(rdsMysqlUserCommand);
rdsMysqlCommand.addCommand(rdsMysqlJobCommand);
program.addCommand(rdsMysqlCommand);
```

import 는 `instanceCommand as rdsMysqlInstanceCommand` 처럼 별칭을 붙인다(`instance` 그룹과 이름이 겹친다).

### 7. 이 phase 를 검증하는 `src/commands/rds-mysql/read.test.ts` 신규

`src/commands/skm/key-write.test.ts` 처럼 `vi.mock("./helpers.js", ...)` 로 `resolveRdsMysqlClient` 만 바꾸고, `new RdsMysqlClient("appkey", "uak-id", "uak-secret", "kr1", "real")` 의 메서드를 `vi.spyOn` 한다. spinner 는 `vi.mock("../../utils/spinner.js", ...)` 로 막는다.

- `user list <uuid> --quiet` 가 `dbUserId` 두 줄을 출력한다.
- `user list <uuid> --json` 이 배열을 그대로 출력한다.
- `instance get not-a-uuid` 가 EXIT_PARAM_ERROR 로 끝나고 `resolveRdsMysqlClient` 를 부르지 않는다.
- `job get <uuid> --quiet` 이 `jobStatus` 를 출력한다.
- `schema list <uuid>` 의 빈 배열이 table 모드에서 `결과 없음` 을 출력하고 성공한다.
- `formatCell` 이 null 을 `-` 로, 배열을 `a,b` 로, 제어 문자를 치환해 출력한다.

## 검증

```bash
node_modules/.bin/vitest run src/commands/rds-mysql/read.test.ts src/commands/reserved-flags.test.ts src/commands/commands.test.ts
node_modules/.bin/tsc --noEmit
node_modules/.bin/tsup && node dist/index.js commands --json | node -e 'const c=JSON.parse(require("fs").readFileSync(0,"utf8")); const p=(c.commands||c).map(x=>x.path).filter(x=>x.startsWith("rds-mysql")); console.log(p.join("\n")); if(p.length<5) process.exit(1)'
```

기대값: 테스트 통과, 타입 오류 0, 카탈로그에 `rds-mysql instance list`, `rds-mysql instance get`, `rds-mysql schema list`, `rds-mysql user list`, `rds-mysql job get` 이 있다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/commands/rds-mysql/helpers.ts` | 신규 |
| `src/commands/rds-mysql/instance.ts` | 신규 |
| `src/commands/rds-mysql/schema.ts` | 신규 |
| `src/commands/rds-mysql/user.ts` | 신규 |
| `src/commands/rds-mysql/job.ts` | 신규 |
| `src/commands/rds-mysql/read.test.ts` | 신규 |
| `src/index.ts` | 수정 |
