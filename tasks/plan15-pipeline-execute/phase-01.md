# Phase 01. Pipeline endpoint 와 client

**Execution profile**: standard

## 목표

Pipeline v1.1 수동 실행 API 를 호출하는 `PipelineClient.execute()` 와 region·망별 host 해석을 만든다.
명령과 문서가 이 경계만 쓰도록 HTTP·응답 검증을 한 곳에 둔다.

**범위 외**: Commander 명령, `--yes`, 출력 형식, appkey 해석은 phase 02. 문서는 phase 03.

## 컨텍스트

이 phase 가 맡는 요구사항: `docs/features/pipeline-execute/spec.md` 의 R1(요청 형태), R4(host·`X-NHN-REGION`), R6(오류와 응답 형식).

- API 근거와 요청·응답 표는 스펙의 「API 근거」 절에 있다. 요청은 `POST /api/anchor/v1.1/pipelines/{pipeline-name}/execute`, 본문 없음이다.
- host 맵은 `src/api/endpoints.ts` 의 `apigatewayHost(region, environment)` 와 같은 모양으로 만든다. 공공망은 `kr1` 만, 일반망은 `kr1`·`kr3` 만 등록한다.
- client 는 `src/services/apigateway/client.ts` 의 패턴을 따른다: `ky` 에 `headers`·`retry: 0`·`timeout: DEFAULT_TIMEOUT_MS`, 응답 헤더는 `unwrapHeader()`(`src/api/envelope.ts`), HTTP 오류는 `toNhnCloudCliError`(`src/api/httpError.js`) 로 바꾼다.
- 토큰은 생성자로 받는다. 토큰 발급은 phase 02 의 명령 helper 가 `getAccessToken` 으로 한다.

**근거 문서**: `docs/features/pipeline-execute/spec.md`, `docs/adr/002-ky-http-client.md`, `docs/adr/005-endpoint-hardcoded-map.md`, `docs/adr/006-nhn-response-envelope.md`, `docs/adr/037-gov-profile-endpoints.md`

## 의도 메모

- v1.0(UAK ID·secret 정적 헤더) 은 쓰지 않는다. 스펙이 v1.1 만 범위로 정했다.
- `body.reason` 은 공식 예제에서 `null` 이고 타입이 문서에 없다. 타입 가드는 `lastExecutionId` 문자열만 필수로 보고 나머지 필드는 있으면 통과시킨다. 추측한 타입을 강제하지 않는다.
- pipeline 이름은 `encodeURIComponent` 로 한 경로 조각에 넣는다. `/` 가 들어간 이름이 다른 경로로 바뀌지 않게 한다.
- `X-NHN-REGION` 은 region 을 대문자로 바꾼 값(`KR1`·`KR3`)이다. kr3 값은 v1.0 표가 근거이며 실호출로 확인하지 않았다.

## 작업 항목

### 1. `src/api/endpoints.ts` 에 `pipelineHost` 추가

- `const PIPELINE_HOST: Record<string, string> = { kr1: "kr1-pipeline.api.nhncloudservice.com", kr3: "kr3-pipeline.api.nhncloudservice.com" }`.
- `export function pipelineHost(region: string, environment: CloudEnvironment = "real"): string`.
  - 공공망: `kr1` 이면 `"kr1-pipeline.api.gov-nhncloudservice.com"`, 아니면 `NhnCloudCliError("지원하지 않는 공공망 Pipeline region 입니다: \"<region>\". 사용 가능한 region: kr1", EXIT_PARAM_ERROR)`.
  - 일반망: 맵에 없으면 사용 가능한 region 목록(`kr1, kr3`)을 안내하는 `EXIT_PARAM_ERROR`.

### 2. `src/services/pipeline/types.ts` 신규

- `export interface PipelineExecuteResult { appkey?: string; region?: string; pipelineName?: string; reason?: unknown; lastExecutionId: string }`.
- `export function isPipelineExecuteResult(value: unknown): value is PipelineExecuteResult` — 객체이고 `lastExecutionId` 가 비어 있지 않은 문자열이면 true.

### 3. `src/services/pipeline/client.ts` 신규

- `export class PipelineClient { constructor(accessToken: string, appKey: string, region: string, environment: CloudEnvironment = "real") }`.
  생성자에서 `pipelineHost(region, environment)` 를 불러 잘못된 region 은 생성 시점에 던진다.
- `buildExecuteRequest(pipelineName: string): { method: "POST"; url: string; region: string }` — phase 02 의 `--dry-run` 이 쓴다. appkey·토큰을 담지 않는다. `region` 은 `X-NHN-REGION` 값(`KR1`)이다.
- `async execute(pipelineName: string): Promise<PipelineExecuteResult>`
  - `ky.post(url, { headers: { "Content-Type": "application/json", "X-NHN-REGION": ..., "X-NHN-APPKEY": appKey, "X-NHN-Authorization": \`Bearer ${token}\` }, retry: 0, timeout: DEFAULT_TIMEOUT_MS })` 로 본문 없이 보낸다. 실행은 쓰기이므로 재시도하지 않는다.
  - `.json<NhnEnvelope<unknown>>()` 결과에 `unwrap()` 대신 `unwrapHeader(res)` 를 부른다. 봉투 실패(`isSuccessful=false`)는 `unwrapHeader` 가 던지는 오류를 그대로 둔다. 그 뒤 `res.body` 를 `isPipelineExecuteResult` 하나로 판정한다. `body` 가 아예 없는 성공 응답도 아래 결과 불확정 오류가 되게 하려는 것이다(`unwrap` 은 body 없음을 문구 없이 던진다).
  - 결과 불확정 문구 상수를 export 한다: `export const PIPELINE_UNKNOWN_OUTCOME_HINT = "실행이 접수됐을 수 있습니다. 콘솔 실행 이력을 확인하기 전에 다시 실행하지 마세요."`.
  - `isPipelineExecuteResult` 가 false 면 `NhnCloudCliError(\`Pipeline 실행 응답에 lastExecutionId 가 없습니다. ${PIPELINE_UNKNOWN_OUTCOME_HINT}\`, EXIT_API_ERROR)`.
  - catch 순서: `NhnCloudCliError` 는 그대로 던진다. `HTTPError` 는 서버가 상태 코드로 답했으므로 `toNhnCloudCliError(err)` 를 던진다.
    그 밖(`TimeoutError`, `fetch failed` 같은 연결 오류)은 `toNhnCloudCliError(err)` 의 메시지 뒤에 ` ${PIPELINE_UNKNOWN_OUTCOME_HINT}` 를 붙여 `EXIT_API_ERROR` 로 던진다.

### 4. 이 phase 를 검증하는 테스트

- `src/services/pipeline/client.test.ts` 신규. `src/services/dnsplus/client.test.ts:7-10` 처럼 `ky` 를 partial mock 한다: `vi.mock("ky", async (importOriginal) => { const actual = await importOriginal<typeof import("ky")>(); return { ...actual, default: { ...actual.default, post: vi.fn() } }; })`. `HTTPError`·`TimeoutError` 는 실제 클래스로 남겨 catch 분기를 검증한다.
  - 정상: `execute("my pipeline/a")` 가 `https://kr1-pipeline.api.nhncloudservice.com/api/anchor/v1.1/pipelines/my%20pipeline%2Fa/execute` 로 `ky.post` 를 한 번 부르고, 옵션에 네 헤더(`Content-Type`, `X-NHN-REGION: KR1`, `X-NHN-APPKEY`, `X-NHN-Authorization: Bearer <token>`)와 `retry: 0` 이 있으며 `json`·`body` 옵션이 없다. 공식 예제 JSON 응답에서 `lastExecutionId` 를 돌려준다.
  - kr3: URL host 가 `kr3-pipeline...`, `X-NHN-REGION: KR3`.
  - 봉투 실패: `header.isSuccessful=false` → `unwrapHeader` 가 던지는 `NhnCloudCliError` 의 종료 코드(`src/api/envelope.ts` 의 규칙). 메시지에 재실행 금지 문구가 없다.
  - HTTP 404: 실제 `new HTTPError(new Response("{}", { status: 404 }), new Request(url), {})` 로 reject → `toNhnCloudCliError` 와 같은 종료 코드, 재실행 금지 문구 없음.
  - timeout: 실제 `TimeoutError` 로 reject → `EXIT_API_ERROR`, 메시지에 `PIPELINE_UNKNOWN_OUTCOME_HINT`.
  - `body` 에 `lastExecutionId` 없음 → `EXIT_API_ERROR`, 메시지에 `PIPELINE_UNKNOWN_OUTCOME_HINT`.
  - `header` 성공인데 `body` 키 자체가 없음 → `EXIT_API_ERROR`, 메시지에 `PIPELINE_UNKNOWN_OUTCOME_HINT`.
  - HTTPError·TimeoutError 생성자 인자는 설치된 ky 버전 시그니처를 `node_modules/ky` 타입에서 확인해 맞춘다.
  - `buildExecuteRequest` 결과에 appkey·토큰 문자열이 없다.
- `src/services/pipeline/types.test.ts` 는 만들지 않고 가드는 client 테스트로 덮는다.
- `src/api/gov-endpoints.test.ts` 수정: `pipelineHost("kr1")`, `pipelineHost("kr3")`, `pipelineHost("kr1","gov")` 기대 host, `pipelineHost("kr2")`·`pipelineHost("kr3","gov")` 는 `EXIT_PARAM_ERROR`.

## 검증

```bash
pnpm vitest run src/services/pipeline/client.test.ts src/api/gov-endpoints.test.ts
pnpm tsc --noEmit
```

기대값: 두 테스트 파일 모두 통과, 타입 오류 0.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/api/endpoints.ts` | 수정 |
| `src/api/gov-endpoints.test.ts` | 수정 |
| `src/services/pipeline/types.ts` | 신규 |
| `src/services/pipeline/client.ts` | 신규 |
| `src/services/pipeline/client.test.ts` | 신규 |
