# Code Architecture: nhncloud-cli

## 기술 스택

- Node.js와 TypeScript
- Commander.js 명령 트리
- `ky` HTTP 클라이언트
- tsup 번들과 vitest 테스트
- pnpm 패키지 관리

## 최상위 경계

| 경로 | 책임 |
|---|---|
| `src/index.ts` | 루트 옵션과 서비스별 Commander 명령 등록 |
| `src/commands/` | 인수·옵션 해석, 안전 확인, 출력과 서비스 호출 조합 |
| `src/services/` | 서비스별 endpoint 호출, 요청·응답 타입과 가드 |
| `src/api/` | OAuth·Keystone, endpoint 맵, 공통 봉투와 HTTP 오류 |
| `src/config/` | profile 선택, 자격증명과 일반 설정 읽기·쓰기 |
| `src/cache/` | OAuth·IaaS 토큰의 안전한 파일 캐시 |
| `src/formatters/` | table, JSON과 quiet 출력 |
| `src/skill/` | 공개 스킬 매니페스트, 상태 판정과 설치 수명주기 |
| `src/utils/` | 종료 코드, 오류, spinner, 입력 크기와 시간 처리 |

명령의 실제 경로, 인수와 옵션 목록은 코드에서 생성하는 `nhncloud commands --json`이 소유한다.
이 문서에는 파일별 명령 목록을 복제하지 않는다.

## 서비스 모듈

`src/services/`와 `src/commands/`는 가능한 한 같은 서비스 이름으로 짝을 이룬다.

- `logncrash`, `deploy`, `ncr`, `ncs`, `apigateway`
- `instance`, `network`, `blockstorage`, `loadbalancer`, `nks`

`floatingip`과 `volume` 명령은 각각 network와 blockstorage 서비스 경계를 재사용한다.
서비스가 늘면 먼저 기존 인증과 endpoint 조합으로 표현할 수 있는지 확인한다.
공공망 profile의 명시적 선택은 [ADR-037](adr/037-gov-profile-endpoints.md)을 따른다.

## 의존 방향

```text
commands ──> services ──> api
   ├──────────────────> api
   ├──────────────────> config
   └──────────────────> formatters, utils

services ──> utils
api ──> cache, config, utils
skill ──> config와 독립된 사용자 데이터 경계
```

- `services`는 `commands`를 import하지 않는다.
- 명령 파일은 서비스 client를 거치며 새 `ky` 인스턴스를 직접 만들지 않는다.
- 공통 인증, endpoint와 응답 봉투를 서비스마다 다시 구현하지 않는다.
- 출력 형식은 서비스 client가 아니라 명령과 formatter가 결정한다.

## 인증과 endpoint 조합

| 서비스군 | 인증 경계 | endpoint 경계 |
|---|---|---|
| deploy, ncs, Log & Crash 검색, API Gateway | `api/oauth.ts`, `cache/token-store.ts` | `api/endpoints.ts`와 서비스 client |
| instance, network, blockstorage, loadbalancer, nks | `api/keystone.ts`, `cache/token-store.ts` | region별 IaaS endpoint |
| NCR Management API | profile 공통 UAK 정적 헤더 | region별 NCR host |
| NCR Harbor data plane | UAK Basic Auth | registry 응답에서 검증한 host |
| Log & Crash collector | 서비스 규약에 맞춘 body | collector endpoint |

자격증명 필드와 캐시 파일 구조는 [data-schema.md](data-schema.md)가 소유한다.
서비스별 헤더, 봉투와 예외는 [ADR Index](adr/INDEX.md)에서 관련 결정을 골라 확인한다.

## 명령 실행 경계

일반 명령은 다음 순서로 동작한다.

1. Commander가 인수와 옵션을 파싱한다.
2. 명령이 값의 범위와 위험 작업 확인을 검사한다.
3. profile과 자격증명을 해석한다.
4. 서비스 client가 인증과 HTTP 요청을 수행한다.
5. 응답 가드와 공통 봉투가 실패를 사용자 오류로 바꾼다.
6. formatter가 데이터를 stdout에 쓰고, 진행 상황과 오류는 stderr에 쓴다.

검증과 자격증명 해석 전에 spinner나 외부 요청을 시작하지 않는다.
자동화 가능한 명령은 대화형 입력을 기다리지 않는다.
여러 서비스가 공유하는 appkey 필수값 검증은 `commands`의 공통 경계에서 처리한다.
이름 또는 UUID로 리소스를 고르는 규칙은 `src/commands/resource-resolver.ts`가 소유하고 Load Balancer와 보안그룹 명령이 함께 쓴다.
Network 쓰기 요청의 400·409 응답은 `src/services/network/errors.ts`가 서버의 `NeutronError.message`를 덧붙여 사용자 오류로 바꾼다.
`config`는 파일과 profile 오류를 보존하면서 서비스 블록 부재를 구분해 반환하고,
공통 명령 경계는 블록이나 appkey가 없을 때만 서비스별 설정 안내로 바꾼다.
Log & Crash export는 API 수집 상태와 로컬 파일 완결 상태를 분리하고, 완료 결과를 최종 경로 교체 실패 때문에 삭제하지 않는다(ADR-034).
Log & Crash service client는 공식 `available-token` 응답의 정수 필드를 검증한다.
명령 계층은 검색과 scroll 요청 직전에 이 값을 확인하고, 0 이하이면 검색 호출을 차단한다(ADR-036).
명령 트리를 모두 만든 뒤 `src/commands/commander-errors.ts`가 Commander 오류를 가로챈다.
필수 옵션 누락만 `EXIT_PARAM_ERROR`로 바꾸고, 이미 stderr에 출력한 오류는 최상위 처리부가 다시 출력하지 않는다(ADR-035).

## 공개 스킬 관리

`skills/nhncloud-cli/`는 npm 패키지에 포함되는 사용자 가이드다.
`src/skill/manifest.ts`가 매니페스트와 콘텐츠 해시를 검증하고, `src/skill/manager.ts`가 관리 저장소와 활성 링크 전환을 담당한다.
`commands/skills.ts`와 `commands/doctor.ts`는 이 판정을 재구현하지 않고 공용 경계를 호출한다.

내부 개발 워크플로우는 `.agents/skills/`에 둔다.
반복 함정은 `docs/pitfalls/`에 패턴당 한 파일로 저장하고 `INDEX.md`를 라우터로 쓴다.
원시 회고와 실행 통계는 저장소 문서로 누적하지 않는다.

## 테스트와 빌드

테스트는 대상 코드 옆 `*.test.ts`에 둔다.
순수 함수, 타입 가드, 응답 봉투, 안전 분기와 출력 계약을 우선 검증한다.
HTTP 테스트는 `ky`를 mock하고 실제 응답 형태에 맞는 fixture를 사용한다.

완료 검증 명령은 `AGENTS.md`가 소유한다.
tsup와 vitest가 타입 검사를 대신하지 않으므로 `tsc --noEmit`을 별도로 실행한다.
