# planning 오버레이: nhncloud-cli

공용 `planning` 스킬에 이 저장소의 TypeScript CLI 규칙만 보탠다.
공통 절차와 질문 규칙은 스킬이, 상시 코드 규칙과 검증 명령은 `AGENTS.md`가 소유한다.

## 단계별 도메인 점검

- 호출 흐름에서는 인수와 옵션, `--json`·`--quiet`, stdout·stderr, 대화형 진입 여부를 정한다.
- API 설계에서는 기존 `src/services/`, `src/api/`, `src/config/` 경계를 먼저 재사용한다.
- 새 endpoint와 필드 타입은 NHN Cloud 공식 문서로 확인한다. 문서만으로 확정할 수 없으면 실호출 검증을 별도 조건으로 남긴다.
- 쓰기 명령은 `--yes`, 부분 실패, 재시도와 중복 실행의 영향을 명시한다.
- 서비스 인증과 응답 봉투는 `docs/adr/INDEX.md`에서 관련 ADR을 찾아 확인한다.

규모가 작으면 공용 8단계를 `1+2`, `3+4`, `5+6`, `7+8`로 묶을 수 있다.
문서 영향 판정과 task 검증은 생략하지 않는다.

## 문서 영향 판정

변경 전에 다음 단일 소스를 대조하고 실제 영향이 있는 파일만 고친다.

| 변경 | 반드시 대조할 단일 소스 |
|---|---|
| 명령·인수·옵션 | `nhncloud commands --json`, `README.md`, `skills/nhncloud-cli/references/` |
| 제품 범위·사용자 흐름 | `docs/prd.md`, `docs/flow.md` |
| 디렉터리 책임·의존 방향 | `docs/code-architecture.md` |
| 자격증명·설정·캐시 | `docs/data-schema.md` |
| 직관에 반하는 장기 결정 | `docs/adr/INDEX.md`에서 고른 ADR |
| 계획·실행·검토 반복 함정 | `docs/pitfalls/INDEX.md`에서 고른 패턴 |
| 내부 스킬·역할 정의 | `.agents/skills/`, `.claude/agents/`, `.codex/agents/` |

사용자 가이드 변경은 구현과 같은 PR에 두되, 명령 카탈로그와 실제 help를 근거로 작성한다.

## ADR 작성 기준

다음 질문에 모두 아니오일 때만 ADR을 만든다.

1. 코드, 설정이나 디렉터리 구조만 보면 같은 결론을 얻을 수 있는가?
2. 선택 이유가 한두 문장으로 끝나는 일반 관례인가?
3. 되돌리기 쉽고 다른 구현에 장기 제약을 만들지 않는가?

ADR 제목은 `# ADR-NNN: 제목`으로 시작한다.
결정, 맥락, 기각한 대안과 트레이드오프를 담고 구현 목록과 긴 코드 예시는 넣지 않는다.
새 ADR은 `docs/adr/INDEX.md`에 연결하고, 기존 결정을 일부 뒤집으면 양쪽 ADR에 대체 범위를 남긴다.

## 반복 함정 승격

task 작성 뒤 `docs/pitfalls/INDEX.md`의 trigger와 라우터로 관련 파일만 골라 대조한다.
새 패턴은 같은 파일의 「축적 규칙」을 통과할 때만 추가한다.

## task 스키마

실행 surface가 `execution_profile`을 설치된 model과 role에 매핑하므로 provider별 `model`이나 `allowedTools`를 `index.json`에 저장하지 않는다.

## 브랜치와 핸드오프

- 브랜치: `{category}/plan{N}-{slug}`
- PR 제목: `type(scope): description`
- planning은 설계 문서와 task를 plan 브랜치에 커밋하고 push한다.
- 구현은 `orchestration`으로 worker에 넘기고, worker가 `/build-with-teams tasks/plan{N}-{slug}`를 실행한다.
- phase 구현과 커밋은 worker 안의 `build-with-teams`가 소유한다.

## 검증

task 제출 전 `AGENTS.md`의 빌드·검증과 공개 저장소 정보 보호 검사를 실행한다.
문서나 내부 스킬을 바꿨으면 삭제한 경로, 낡은 절 제목과 하드코딩한 카운트가 남았는지 `rg`로 확인한다.
