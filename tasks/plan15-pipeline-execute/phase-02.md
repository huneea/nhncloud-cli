# Phase 02. `pipeline execute` 명령과 `configure --pipeline-appkey`

**Execution profile**: standard

## 목표

`nhncloud pipeline execute <pipeline-name>` 명령과 profile 의 `pipeline.appkey` 저장 경로를 만든다.
안전 확인, region 검증, 출력 계약을 API 호출 전후로 결정적으로 고정한다.

**범위 외**: client·host 는 phase 01 이 만들었다. README·스킬·전역 docs 는 phase 03.

## 컨텍스트

이 phase 가 맡는 요구사항: `docs/features/pipeline-execute/spec.md` 의 R1(명령에서 호출 한 번), R2(`--yes`/`--dry-run`), R3(출력), R4(region 검증 시점), R5(appkey).

- phase 01 산출물: `src/services/pipeline/client.ts` 의 `PipelineClient(accessToken, appKey, region, environment)`, `execute(name)`, `buildExecuteRequest(name)`, `src/api/endpoints.ts` 의 `pipelineHost(region, environment)`.
- 쓰기 안전 문구는 `src/commands/dnsplus/helpers.ts` 의 `requireWriteMode` 와 같게 한다. dnsplus 파일은 고치지 않는다.
- 토큰 발급은 `src/commands/apigateway/helpers.ts:137` 의 흐름을 따른다: `getUserAccessKey(profileName)` → `getAccessToken(profileName, uak.id, uak.secret, false, environment)`.
- appkey 는 `src/commands/service-appkey.ts` 의 `resolveServiceAppKey("pipeline", profileName, message)` 로 읽는다. `--app-key` 옵션은 만들지 않는다(ADR-029).
- 빈 인수는 `src/commands/parse-options.ts` 의 `parseRequiredArgument(value, "pipeline-name")` 로 막는다(`EXIT_PARAM_ERROR`).
- 출력은 `src/formatters/table.ts` 의 `output(opts, { headers, rows, raw, ids })`. `--json`·`--quiet` 는 root 전역 옵션이므로 `command.optsWithGlobals()` 로 읽는다(`src/commands/dnsplus/recordset.ts:167`).
- spinner 는 `src/commands/dnsplus/helpers.ts` 의 `withDnsplusSpinner` 처럼 try/catch 로 실패 시 `stopSpinner(false)` 후 다시 던진다. 검증이 모두 끝난 뒤, 토큰 발급 직전에 시작한다.
- 명령 등록은 `src/index.ts` 의 다른 서비스 그룹과 같은 방식이다.
- configure 는 `src/commands/configure.ts` 의 dnsplus 경로를 따르되 연결 테스트는 하지 않는다. 대화형 마법사에는 넣지 않는다.

**근거 문서**: `docs/features/pipeline-execute/spec.md`, `docs/adr/029-appkey-profile-only.md`, `docs/adr/049-dnsplus-appkey-path-and-write-safety.md`, `docs/adr/007-deploy-oauth-token-cache.md`

## 의도 메모

- 검증 순서(고정): 인수 검증(`parseRequiredArgument`) → `requireWriteMode` → `resolvePipelineProfile`(profileName, environment) → region 검증(`pipelineHost(opts.region, environment)`) → `resolvePipelineAppKey(profileName)` → (`--dry-run` 이면 출력하고 끝) → spinner → `issuePipelineToken` → `execute`.
- 명령 테스트가 실제 `~/.nhncloud` 를 읽지 않도록 profile·appkey·토큰 해석을 helpers 모듈의 세 함수로 나누고 테스트는 이 세 함수만 mock 한다. `pipelineHost` 는 순수 함수라 mock 하지 않는다.
- `--dry-run` 은 토큰을 발급하지 않고 API 를 부르지 않는다. appkey 존재는 확인해 실제 실행과 같은 설정 오류를 미리 알린다.
- 실행은 재시도하지 않는다. 결과 불확정 문구는 client 가 붙인다(phase 01).
- `--quiet` 의 한 줄 값은 `lastExecutionId` 다. 외부 문자열이므로 표와 quiet 출력에서 `sanitizeForTerminal` 을 거친다. `--json` 은 원본 body 를 그대로 쓴다.

## 작업 항목

### 1. `src/commands/pipeline/helpers.ts` 신규

- `export interface PipelineExecuteOptions extends OutputOptions { profile?: string; region: string; yes?: boolean; dryRun?: boolean }`.
- `export function requireWriteMode(opts: { yes?: boolean; dryRun?: boolean }, operation: string): boolean` — `--dry-run` 이면 true. 둘 다 없으면 `` `${operation}에는 --yes 플래그가 필요합니다. 보낼 요청만 보려면 --dry-run 을 쓰세요.` `` 와 `EXIT_PARAM_ERROR`.
- `export async function resolvePipelineProfile(opts: { profile?: string }): Promise<{ profileName: string; environment: CloudEnvironment }>` — `resolveProfileName` → `getProfileEnvironment`.
- `export async function resolvePipelineAppKey(profileName: string): Promise<string>` — `resolveServiceAppKey("pipeline", profileName, "Pipeline appkey가 없습니다. nhncloud configure --pipeline-appkey <key>로 설정하세요.")`(`EXIT_CONFIG_ERROR`).
- `export async function issuePipelineToken(profileName: string, environment: CloudEnvironment): Promise<string>` — UAK 가 없을 때는 기존 `getUserAccessKey` 오류를 그대로 쓴다.

### 2. `src/commands/pipeline/execute.ts` 신규

- `export const executeCommand = new Command("execute")`
  - `.description("Pipeline 을 수동 실행한다")`, `.argument("<pipeline-name>", "실행할 Pipeline 이름")`
  - `.option("--region <region>", "Pipeline region (kr1, kr3. 공공망은 kr1)", "kr1")`, `.option("--profile <name>", "사용할 profile 이름")`, `.option("--yes", "확인 없이 실행한다")`, `.option("--dry-run", "실행 없이 보낼 요청을 출력한다")`
- `--dry-run`: `new PipelineClient("", appKey, region, environment).buildExecuteRequest(name)` 로 요청을 만들고
  `output(opts, { headers: ["method","url","region","pipeline"], rows: [[method, url, region, sanitizeForTerminal(name)]], raw: { operation: "pipeline-execute", dry_run: true, requests: [{ ...request, pipelineName: name }] }, ids: [] })`.
- 실행: `output(opts, { headers: ["pipeline","region","lastExecutionId"], rows: [[sanitizeForTerminal(name), region, sanitizeForTerminal(id)]], raw: result, ids: [sanitizeForTerminal(id)] })`.

### 3. `src/index.ts` 수정

- `import { executeCommand as pipelineExecuteCommand } from "./commands/pipeline/execute.js";`
- `const pipelineCommand = new Command("pipeline").description("Pipeline 수동 실행")`, `pipelineCommand.addCommand(pipelineExecuteCommand)`, `program.addCommand(pipelineCommand)`.

### 4. `src/commands/configure.ts` 수정

- `ConfigureOptions` 에 `pipelineAppkey?: string`.
- `saveAndVerify` 에 마지막 인자 `pipeline: ServiceCredential | undefined = undefined` 를 더한다. 연결 테스트 블록에는 넣지 않고 저장 블록에서 `setServiceCredential(profileName, "pipeline", pipeline)` 만 한다. 비대화형 호출부에서 넘긴다. 대화형 호출부는 바꾸지 않는다.
- `--pipeline-appkey <key>` 옵션 "Pipeline appkey (비대화형)". 비대화형 진입 조건(`opts.dnsplusAppkey !== undefined || ...`)에 더한다.
- 빈 값은 `"--pipeline-appkey 값은 비어 있을 수 없습니다."` `EXIT_PARAM_ERROR`. trim 한 값을 `{ appkey }` 로 만든다.
- 아무 flag 도 없을 때의 조건(`!uak && ... && !deploy`)과 안내 문구에 `--pipeline-appkey` 를 더한다.

### 5. 이 phase 를 검증하는 테스트

- `src/commands/pipeline/commands.test.ts` 신규. `src/commands/dnsplus/commands.test.ts` 처럼 root 에 `--json`·`--quiet` 를 두고 `configureCommanderExitCodes` 를 건다.
  `vi.mock("./helpers.js", …)` 로 `resolvePipelineProfile`·`resolvePipelineAppKey`·`issuePipelineToken` 만 mock 하고(`requireWriteMode` 는 실제), `vi.spyOn(PipelineClient.prototype, "execute")`, spinner 모듈은 mock 한다.
  기본 mock: profile `{ profileName: "default", environment: "real" }`, appkey `"test-appkey"`, token `"test-token"`.
  오류는 `run(...)` 의 reject 로 확인한다: `await expect(run(...)).rejects.toMatchObject({ exitCode: <코드>, message: expect.stringContaining(<문구>) })`.
  - `execute demo`(플래그 없음) → `EXIT_PARAM_ERROR`, 메시지에 `--yes` 와 `--dry-run`, `issuePipelineToken`·`execute` 미호출.
  - `execute "  "` → `EXIT_PARAM_ERROR`, `resolvePipelineProfile` 미호출.
  - `execute demo --dry-run` → resolve, stdout 에 `KR1`·`demo`·`/api/anchor/v1.1/pipelines/demo/execute`, `test-appkey`·`test-token` 없음, `issuePipelineToken`·`execute` 미호출. `--dry-run --json` 은 `dry_run: true` 와 `pipelineName: "demo"`.
  - `execute demo --yes --region kr2` → `EXIT_PARAM_ERROR`, 메시지에 `kr2`, `resolvePipelineAppKey`·`issuePipelineToken` 미호출.
  - environment `"gov"` mock 에서 `execute demo --yes --region kr3` → `EXIT_PARAM_ERROR`, 메시지에 `kr1`, 토큰 미발급.
  - `resolvePipelineAppKey` 가 `NhnCloudCliError(..., EXIT_CONFIG_ERROR)` 로 reject → `execute demo --yes` 가 `EXIT_CONFIG_ERROR`, 토큰 미발급.
  - `execute demo --yes` 기본 출력: stdout 표에 `demo`·`kr1`·`executionId`, `execute` 한 번 호출. `issuePipelineToken` 이 `("default","real")` 로 호출.
  - `--yes --json`: stdout 을 `JSON.parse` 한 값이 공식 예제 `body` 와 같다. `--yes --quiet`: stdout 이 정확히 `"executionId\n"`.
  - `execute` 가 `NhnCloudCliError(…, EXIT_API_ERROR)` 로 reject → 같은 종료 코드로 reject, stdout 비어 있음.
- `src/commands/pipeline/helpers.test.ts` 신규: `resolveServiceAppKey` 를 쓰는 `resolvePipelineAppKey` 가 credentials 에 pipeline 블록이 없을 때 `EXIT_CONFIG_ERROR` 와 `--pipeline-appkey` 안내를 낸다. `src/commands/service-appkey.test.ts:9` 의 `vi.mock("../config/credentials.js", …)` 방식을 따른다(경로는 `../../config/credentials.js`). `requireWriteMode` 의 세 분기(`dryRun`→true, `yes`→false, 둘 다 없음→throw)도 단언한다.
- `src/commands/configure.test.ts` 수정: 기존 `--dnsplus-appkey` 테스트(372행 부근)를 참고해 `--pipeline-appkey " key "` 가 `setServiceCredential` 을 `("<profile>", "pipeline", { appkey: "key" })` 로 부르고 어떤 연결 검증 mock 도 pipeline 값으로 불리지 않음. 공백 값은 `EXIT_PARAM_ERROR`.

## 검증

```bash
pnpm vitest run src/commands/pipeline/commands.test.ts src/commands/pipeline/helpers.test.ts src/commands/configure.test.ts src/commands/commands.test.ts
pnpm tsc --noEmit
pnpm run build
node dist/index.js pipeline execute demo; echo "exit=$?"
```

기대값: 테스트 통과, 타입 오류 0, 빌드 성공. 마지막 줄은 profile 과 무관하게 API 호출 없이 `EXIT_PARAM_ERROR` 종료 코드(`src/utils/exit-codes.ts` 의 값)를 낸다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/commands/pipeline/helpers.ts` | 신규 |
| `src/commands/pipeline/helpers.test.ts` | 신규 |
| `src/commands/pipeline/execute.ts` | 신규 |
| `src/commands/pipeline/commands.test.ts` | 신규 |
| `src/index.ts` | 수정 |
| `src/commands/configure.ts` | 수정 |
| `src/commands/configure.test.ts` | 수정 |
