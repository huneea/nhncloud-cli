# nhncloud-cli 저장소 지침

`CLAUDE.md`는 이 파일을 가리키는 심볼릭 링크다.
공통 지침은 `AGENTS.md`만 수정하고 링크를 유지한다.

## 저장소 역할

NHN Cloud 서비스를 AWS CLI 방식으로 호출하는 TypeScript 와 Commander.js 기반 통합 CLI다.
이 파일에는 저장소에서 코드를 변경할 때 항상 필요한 규칙만 둔다.
사용자용 명령 설명은 `README.md`와 `skills/nhncloud-cli/`에서 관리한다.

## 단일 소스

- 실제 명령 경로·인수·옵션은 Commander 트리에서 생성하는 `nhncloud commands --json`을 기준으로 삼는다.
- 제품 요구사항과 흐름은 `docs/prd.md`와 `docs/flow.md`에서 관리한다.
- 코드 경계와 디렉터리 책임은 `docs/code-architecture.md`에서 관리한다.
- 자격증명과 설정 스키마는 `docs/data-schema.md`에서 관리한다.
- 직관에 반하는 기술 결정은 `docs/adr/INDEX.md`에서 필요한 ADR만 찾아 읽는다.
- 구현·명령 목록·인증 표를 이 파일에 복제하지 않는다.

## API 근거 확인

- 새 엔드포인트와 요청·응답 구조는 NHN Cloud 공식 문서(<https://docs.nhncloud.com>)로 먼저 확인한다.
- 타입 가드와 요청 본문은 공식 예제 JSON과 일치시킨다.
- 공식 문서로 필드 타입이나 실제 동작을 확정할 수 없으면 실제 호출로 검증하고, 검증 전에는 추측해 구현하지 않는다.
- 새 HTTP 요청은 ADR-002와 ADR-006을, 엔드포인트·OpenStack 인증 변경은 ADR-005·ADR-010·ADR-013을 먼저 확인한다.
- 서비스 고유 인증·응답·안전 규칙은 `docs/adr/INDEX.md`에서 해당 서비스 ADR을 찾아 확인한다.

## 코드 경계와 규칙

- HTTP 클라이언트는 `ky`만 사용한다.
- 서비스 API와 타입은 `src/services/<service>/`, Commander 명령은 `src/commands/<service>/`에 둔다.
- 공통 엔드포인트·응답 봉투·HTTP 오류 처리는 `src/api/`, 자격증명과 profile 해석은 `src/config/`의 기존 경계를 재사용한다.
- 사용자 오류는 `NhnCloudCliError(message, exitCode)`와 `src/utils/exit-codes.ts`의 종료 코드를 사용한다.
- Commander의 필수 옵션 누락은 `EXIT_PARAM_ERROR`로 정규화한다.
  각 명령을 수동 검증으로 바꾸지 않고 `src/commands/commander-errors.ts`에서 명령 트리 전체에 적용한다.
- 데이터는 stdout, 진행 상황·경고·오류는 stderr로 분리한다.
- 파일 export는 API 수집 완료와 파일 형식 완결을 구분한다.
  전체 결과를 최종 경로 교체 실패 때문에 삭제하지 않으며 Log & Crash 세부 정책은 ADR-034를 따른다.
- 자동화 가능한 명령은 대화형 입력을 기다리지 않게 설계한다.
- 위험한 변경은 API 호출 전에 `--yes`를 검증하고, `--json`·`--quiet` 출력과 종료 코드를 결정적으로 유지한다.
- profile 해석 순서는 `docs/data-schema.md`가 소유한다.
- 자격증명은 `~/.nhncloud/credentials.json`, 일반 설정은 `~/.nhncloud/config.json`에 두며 자격증명 파일 권한은 `0600`으로 유지한다.
- 새 의존성을 추가하기보다 기존 유틸리티와 패턴을 우선한다.

## 빌드와 검증

```bash
pnpm install
pnpm run build
pnpm tsc --noEmit
pnpm test
node dist/index.js commands --json
git diff --check
```

worktree에서 `pnpm install`이 esbuild 실행을 차단하면 설치를 반복하지 않는다.
이미 설치된 `node_modules/.bin/tsup`, `tsc`, `vitest`를 직접 실행해 같은 검증을 수행한다.

- 변경 동작을 고정하는 대상 테스트를 먼저 실행하고, 완료 전 타입 검사·전체 테스트·빌드를 실행한다.
- 명령이나 옵션을 바꾸면 생성된 명령 카탈로그와 `README.md`, `skills/nhncloud-cli/references/`를 함께 대조한다.
- 출력 계약을 바꾸면 기본 출력·`--json`·`--quiet`·stdout/stderr·종료 코드를 모두 검증한다.

## 문서와 스킬

- `skills/nhncloud-cli/SKILL.md`는 공개 CLI 사용 흐름의 라우터로 유지하고, 서비스 상세는 `references/*.md`에 둔다.
- `nhncloud skills`를 바꿀 때는 ADR-025와 `docs/flow.md`의 「공개 스킬 수명주기」 절이 정한 보존·거부 규칙을 유지한다.
- `.agents/skills/`는 내부 개발 워크플로우의 단일 원본이며 `.claude/skills` 심볼릭 링크를 유지한다.
- `docs/pitfalls/`는 계획·팀 실행·코드 검토에서 반복해서 발견된 회피 패턴의 단일 원본이다. `INDEX.md`에서 변경 유형에 맞는 항목만 골라 읽는다.
- 새 반복 함정은 `docs/pitfalls/INDEX.md`의 「축적 규칙」을 통과할 때만 남긴다.
- 새 기능은 `planning`으로 설계 문서와 task를 먼저 만들고, 승인된 계획은 `build-with-teams`로 구현한다.
- 설계 문서는 task보다 먼저 커밋한다.
- 문서·스킬·외부 공개 프로젝트 설명은 한국어로 작성한다.
- 명령, 경로, 코드 식별자, API 필드, `agent_type`, `$workflow` 같은 기계 계약은 원문을 유지한다.

## 공개 저장소 정보 보호

이 저장소와 npm 패키지는 공개된다.
문서, 코드, 테스트 fixture, 오류 예시, 이슈와 PR 본문에 실제 자격증명·사내 식별자·사용자 리소스 ID·실명을 남기지 않는다.

| 실제 값 | 사용할 표기 |
|---|---|
| UAK | `<uak-id>`, `<uak-secret>` |
| Log & Crash 자격증명 | `<appkey>`, `<secret>` |
| Instance 자격증명 | `<tenant-id>`, `<username>`, `<password>` |
| 이메일·비공개 도메인 | `user@example.com`, `example.com` |
| 리소스 식별자 | `<instance-id>`, `<network-uuid>` 등 의미가 드러나는 placeholder |
| 사람 이름 | `홍길동` 같은 가상 이름 |

커밋, 이슈 작성, 릴리스 전에 다음 검사가 모두 0건인지 확인한다.

```bash
grep -rnoE "(https?://|@)[A-Za-z0-9.-]+\.(com|co\.kr|net)" README.md skills/ docs/ AGENTS.md CLAUDE.md src/ tasks/ .agents/ .claude/ .codex/ .github/ 2>/dev/null \
  | grep -vE "nhncloud\.com|nhncloudservice\.com|github\.com|npmjs\.com|example\.com|openai\.com|anthropic\.com"

grep -rnE "(secret|password|appkey)['\"]?[[:space:]]*[:=][[:space:]]*['\"][A-Za-z0-9]{16,}" README.md skills/ docs/ AGENTS.md CLAUDE.md src/ tasks/ .agents/ .claude/ .codex/ .github/ 2>/dev/null
```

내부용 실제 값을 넣어야 한다면 사용자의 명시적 동의가 있어야 한다.
