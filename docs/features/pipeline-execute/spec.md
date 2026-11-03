# Pipeline 수동 실행

확인: 2026-11-03

## 목표

사용자가 CI 스크립트나 터미널에서 `nhncloud pipeline execute <pipeline-name>` 으로 NHN Cloud Pipeline 을 수동 실행하고,
응답의 실행 ID(`lastExecutionId`)를 받아 후속 작업에 쓸 수 있다.

## 범위

이번 범위:

- `nhncloud pipeline execute <pipeline-name>` 명령 하나.
- profile 의 `pipeline.appkey` 저장과 `nhncloud configure --pipeline-appkey` 비대화형 flag.
  대화형 마법사에는 넣지 않는다. 최근 서비스(`apigateway`·`skm`·`rds-mysql`·`dnsplus`)도 비대화형 flag 만 제공한다.
- 일반망 `kr1`·`kr3`, 공공망 `kr1` endpoint.
- README, `skills/nhncloud-cli/SKILL.md` 라우팅 표, 새 `skills/nhncloud-cli/references/pipeline.md`,
  서비스를 나열하는 `docs/prd.md`·`docs/flow.md`·`docs/code-architecture.md`·`docs/data-schema.md` 의 해당 줄.

범위 밖:

- 실행 상태·이력 조회와 `--wait`. 공개 API 가 없다(콘솔의 실행 이력은 UI 전용).
- Pipeline API v1.0(UAK ID·secret 정적 헤더). v1.1 만 호출한다.
- `configure` 의 Pipeline 연결 테스트. 부작용 없는 조회 API 가 없어 실행 외에는 검증할 방법이 없다.

## API 근거

- [Pipeline API v1.1 가이드](https://docs.nhncloud.com/ko/Dev%20Tools/Pipeline/ko/api-guide-v1-1/)
- [공공기관용 Pipeline API v1.1 가이드](https://docs.gov-nhncloud.com/ko/Dev%20Tools/Pipeline/ko/api-guide-gov-v1-1/)
- [Pipeline API v1.0 가이드](https://docs.nhncloud.com/ko/Dev%20Tools/Pipeline/ko/api-guide-v1-0/): `X-NHN-REGION` 값 `KR1, KR3` 근거로만 참조한다.

| 항목 | 값 |
| --- | --- |
| 요청 | `POST /api/anchor/v1.1/pipelines/{pipeline-name}/execute`, 본문 없음 |
| 일반망 host | `kr1-pipeline.api.nhncloudservice.com`, `kr3-pipeline.api.nhncloudservice.com` |
| 공공망 host | `kr1-pipeline.api.gov-nhncloudservice.com` (kr1 만) |
| 헤더 | `X-NHN-REGION: KR1` 또는 `KR3`, `X-NHN-APPKEY: <appkey>`, `X-NHN-Authorization: Bearer <token>` |
| 응답 | 공통 봉투(`header`·`paging`·`body`), `body` 는 `appkey`·`region`·`pipelineName`·`reason`·`lastExecutionId` |

## 요구사항과 인수 조건

| ID | 요구사항 | 관측할 인수 조건 |
| --- | --- | --- |
| R1 | `pipeline execute <pipeline-name>` 은 v1.1 실행 API 를 한 번 호출한다 | `--yes` 로 실행하면 선택한 region host 의 `/api/anchor/v1.1/pipelines/<인코딩한 이름>/execute` 에 POST 가 정확히 한 번 가고 세 헤더가 실린다. 이름의 `/`·공백은 경로에서 인코딩된다 |
| R2 | 실행은 `--yes` 나 `--dry-run` 을 요구한다 | 둘 다 없으면 토큰 발급과 API 호출 없이 `EXIT_PARAM_ERROR` 로 끝나고 stderr 에 두 flag 를 안내한다. `--dry-run` 은 API 를 호출하지 않고 보낼 method·URL·region·pipeline 이름을 출력하며 종료 코드 0 이다. appkey·토큰은 dry-run 출력에 나오지 않는다 |
| R3 | 출력이 기본·`--json`·`--quiet` 에서 결정적이다 | 기본은 pipeline 이름·region·`lastExecutionId` 를 stdout 에 표로 쓴다. `--json` 은 응답 `body` 를 그대로 JSON 으로 쓴다. `--quiet` 는 `lastExecutionId` 한 줄만 쓴다. 진행·경고는 stderr 에만 간다 |
| R4 | region 은 `--region` 으로 고르고 지원하지 않는 값은 호출 전에 거부한다 | 기본값 `kr1`. 일반망은 `kr1`·`kr3`, 공공망 profile 은 `kr1` 만 허용한다. 그 밖의 값은 토큰 발급 전에 `EXIT_PARAM_ERROR` 다. `X-NHN-REGION` 은 대문자(`KR1`·`KR3`)로 보낸다 |
| R5 | appkey 는 profile 의 `pipeline.appkey` 로만 정한다 | `--app-key` 옵션은 없다([ADR-029](../../adr/029-appkey-profile-only.md)). 값이 없으면 토큰 발급 전에 `EXIT_CONFIG_ERROR` 로 끝나고 `nhncloud configure --pipeline-appkey` 를 안내한다. `configure --pipeline-appkey <key>` 는 credentials 에 저장하고 빈 값은 `EXIT_PARAM_ERROR` 다 |
| R6 | API 실패는 기존 봉투·HTTP 오류 규칙으로 보고하고, 실행 여부를 모르는 실패는 재실행하지 말라고 안내한다 | `header.isSuccessful=false` 또는 HTTP 4xx·5xx 는 기존 규칙의 0 이 아닌 종료 코드와 stderr 메시지가 되고 stdout 은 비어 있다. 요청을 보낸 뒤 timeout·연결 끊김, 또는 성공 응답인데 `body.lastExecutionId` 문자열이 없으면 `EXIT_API_ERROR` 이고 메시지는 「실행이 접수됐을 수 있으니 콘솔 실행 이력을 확인하기 전에 다시 실행하지 마세요」를 담는다 |
| R7 | 문서와 명령 카탈로그가 구현과 맞다 | `nhncloud commands --json` 에 `pipeline execute` 와 그 옵션이 있고 README·스킬 reference·data-schema 가 같은 이름과 옵션을 적는다 |

## 설계

### 인증과 endpoint (R1, R4)

- 토큰은 기존 공통 UAK OAuth `getAccessToken` 을 그대로 쓴다([ADR-007](../../adr/007-deploy-oauth-token-cache.md), [ADR-021](../../adr/021-token-cache-credential-fingerprint.md)). `apigateway`·`skm` 과 같은 `X-NHN-Authorization` 헤더다.
- host 는 `src/api/endpoints.ts` 의 정적 맵에 `pipelineHost(region, environment)` 로 더한다([ADR-005](../../adr/005-endpoint-hardcoded-map.md), [ADR-037](../../adr/037-gov-profile-endpoints.md)). 공공망 kr3 은 문서에 없으므로 거부한다. ADR-037 조사 표에 Pipeline 행을 더한다.
- HTTP 는 `ky`, 응답은 `src/api/envelope.ts` 의 `unwrap`, 오류는 `toNhnCloudCliError` 를 쓴다([ADR-002](../../adr/002-ky-http-client.md), [ADR-006](../../adr/006-nhn-response-envelope.md)).
- 요청 본문은 보내지 않고 공식 cURL 예제와 같게 `Content-Type: application/json` 헤더를 보낸다.
- 실행은 재시도하지 않는다. 중복 실행은 곧 중복 배포라 결과를 모르는 실패는 사용자에게 콘솔 확인을 맡긴다(R6).

### 안전 확인 (R2)

- 실행은 실제 배포를 일으키므로 [ADR-048](../../adr/048-loadbalancer-listener-write-and-certificate.md)·[ADR-049](../../adr/049-dnsplus-appkey-path-and-write-safety.md) 의 `--yes`/`--dry-run` 규칙을 따른다. 검증 순서는 인수 파싱 → region·`--yes` 검증 → appkey 확인 → 토큰 발급 → 호출이다.
- 기존 `dnsplus` helper 의 문구·종료 코드와 같게 만든다. 공통 helper 로 옮길지는 구현자가 정하되 기존 동작을 바꾸지 않는다.

### 코드 배치

- `src/services/pipeline/client.ts`, `types.ts`(응답 타입 가드), `src/commands/pipeline/` 에 명령을 둔다.
- `configure` 의 서비스 블록 저장과 검증은 기존 `dnsplus`·`apigateway` 패턴을 따른다. 연결 테스트는 하지 않고 저장만 한다.
- 공공망 지원 여부는 이 기능의 서비스 ADR 을 새로 쓰지 않고 ADR-037 표 갱신으로 남긴다. 다른 직관에 반하는 결정이 없어 새 ADR 은 만들지 않는다.

### 테스트 방법

| ID | 자동 테스트 | 실호출 |
| --- | --- | --- |
| R1 | client 단위 테스트: URL·헤더·이름 인코딩·POST 횟수 | kr1 테스트 파이프라인을 `--yes` 로 실행해 HTTP 200 과 `lastExecutionId` 를 확인한다 |
| R2 | 명령 테스트: 플래그 없음은 토큰·HTTP mock 미호출과 종료 코드, `--dry-run` 출력에 비밀값 없음 | 없음 |
| R3 | 명령 테스트: 기본·`--json`·`--quiet` 의 stdout/stderr 분리 | R1 실호출에서 세 출력 형식을 확인한다 |
| R4 | 명령 테스트: `kr2`·공공망 `kr3` 거부와 토큰 미발급, `X-NHN-REGION` 대문자 | kr3 은 미검증으로 PR 에 남긴다 |
| R5 | 명령·configure 테스트: appkey 없음 종료 코드, `--pipeline-appkey` 저장과 빈 값 거부 | 없음 |
| R6 | client 테스트: 봉투 실패·HTTP 404·timeout·`lastExecutionId` 누락과 재실행 금지 문구 | 없는 파이프라인 이름으로 실행해 실제 오류 응답(HTTP 상태와 `resultCode`)을 기록하고 메시지를 확인한다 |
| R7 | `commands --json` 스냅샷 또는 카탈로그 테스트 | `node dist/index.js commands --json` 대조 |

실호출에는 사용자가 제공한 kr1 Pipeline appkey 와 실행해도 되는 테스트 파이프라인을 쓴다. 실제 appkey·파이프라인 이름·실행 ID 는 커밋·PR 본문에 남기지 않는다.

## 결정

| ID | 결정 | 답 | 누가 | 근거 |
| --- | --- | --- | --- | --- |
| DECISION1 | 범위 | `execute` 하나. 상태 조회·`--wait` 는 제외 | 사용자 2026-11-03 | 공개 API 가 수동 실행 하나뿐이다 |
| DECISION2 | 실행 안전 확인 | `--yes` 또는 `--dry-run` 필수 | 사용자 2026-11-03 | 실행이 실제 배포를 일으킨다. ADR-048·049 와 같은 규칙 |
| DECISION3 | 실호출 검증 범위 | kr1 만 실호출. kr3 `X-NHN-REGION: KR3` 은 v1.0 표 근거로 두고 미검증 | 사용자 2026-11-03 | 사용자가 kr1 appkey 와 테스트 파이프라인만 갖고 있다 |
| DECISION4 | `--quiet` 의 한 줄 값 | `lastExecutionId` | 작성자 | 후속 자동화가 쓰는 유일한 식별자다 |
| DECISION5 | configure 대화형 마법사 | 넣지 않고 `--pipeline-appkey` 비대화형 flag 만 | 작성자 | 최근 서비스(`apigateway`·`skm`·`rds-mysql`·`dnsplus`)와 같은 관례 |
| DECISION6 | 결과 불확정 실패 | 재시도 없이 `EXIT_API_ERROR` 와 재실행 금지 안내 | 작성자 | 재실행은 중복 배포다(R6) |
