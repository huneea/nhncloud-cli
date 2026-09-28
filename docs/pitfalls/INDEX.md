# Pitfalls: 사고/실수 회피 패턴 (파일-per-패턴 wiki)

skills 가 공유하는 회피 패턴 모음. **모놀리식 문서가 아니라 패턴 1개 = 파일 1개**다.
한 파일을 통째로 읽지 말고, 이 INDEX 로 **이 작업의 변경 유형에 해당하는 파일만** 골라 읽는다.

## 소비 방식 (중요: 전부 읽지 않는다)

1. 이 INDEX 의 **라우터 표**에서 지금 작업의 변경 유형 행을 찾는다.
2. 그 행이 가리키는 pattern 파일만 읽고 self-check 한다.
3. **애매하면** 해당 카테고리 디렉터리(`plan/` · `team/` · `code-review/`)를 통째로 읽는다 (과소선택보다 안전).

소비자별 카테고리:

| 카테고리 | 디렉터리 | 호출 시점 | 사용 스킬 |
|---|---|---|---|
| plan 작성 | `plan/` | task 파일 작성 직후 self-check | planning, build-with-teams |
| team 운영 | `team/` | 팀원 스폰·메시지 작성 시 | build-with-teams |
| code-review | `code-review/` | 코드 작성·리뷰 시 (diff 대상) | build-with-teams, review-fix |

## 축적 규칙 (무분별한 성장 방지)

새 패턴은 **아래 4조건을 모두 통과할 때만** 파일로 추가한다. 1회성 지적은 PR reply 로 끝낸다.

1. **재발성**: 2회 이상 재발했거나, 다른 코드에서도 발생할 구조적 가능성이 있다.
2. **심각도**: 데이터 손상·문서 전체 실패·보안 등 영향이 크다 (경미한 1회성은 제외).
3. **도구로 못 잡음**: `pnpm tsc --noEmit` / `pnpm test` (vitest) 가 이미 잡는 것은 추가하지 않는다 (도구가 단일 소스).
4. **추상화 가능**: 커널이 특정 인시던트(plan/PR) 너머로 일반화된다. 인시던트 종속 예시는 재사용 코드 예시로 교체.

**주기적 prune·automate 패스**: 분기마다 한 번 다음을 점검한다.

- **prune**: 가리키는 코드가 사라진 stale 파일 삭제 (`git rm`), 같은 커널 중복 파일 MERGE.
- **automate**: 도구로 승격 가능한 패턴은 `pnpm tsc` / vitest / ast-grep 으로 옮기고 파일 삭제.

원시 회고와 실행 통계는 별도 문서로 누적하지 않는다.
승격 조건을 통과한 패턴만 이 디렉터리에 패턴당 한 파일로 남긴다.

## 파일 형식

각 패턴 파일은 frontmatter와 본문(증상 / Good / 검출 / Self-check / Why)으로 구성한다.

```yaml
---
id: <kebab-slug = 파일명 stem>
category: plan | team | code-review
title: <한 줄 요약>
triggers: [<변경 유형 키워드>, ...]   # 라우터가 이 값으로 매칭
tool_catchable: <true|false>          # true 면 Why 에 그래도 유지하는 이유
source: [PR40, plan004, ...]          # 출처 PR#/plan###: 본문 Why 에서 backfill, 미상은 []
related: [<다른 패턴 slug>, ...]      # 백링크
---
```

본문 규칙: 사고 사례(plan###)는 1개로 충분, 복수 나열 금지. "왜 이 가드가 필요한지" 1줄 단서 필수.

**링크 규칙**:

- 패턴 간 cross-ref(관련 패턴)는 본문 끝에 `관련: [[slug]], [[slug]]` 로 적는다.
  `[[slug]]` 는 brain·메모리 관례의 백링크: **자동 로드하지 않는** 탐색·grep 토큰이다.
- `@경로` (import) 는 쓰지 않는다: 그 파일 내용을 통째로 자동 포함시켜 선택적 로드 목적을 깨뜨린다.
- INDEX 의 카테고리 목록만 마크다운 링크(`[text](path)`) 로 둔다 (GitHub 클릭 네비게이션 허브).
- `related:` frontmatter 는 같은 slug 를 기계 필드로 유지한다 (본문 `[[ ]]` 와 중복 OK).

## nhncloud-cli 컨텍스트

- 빌드 검증: `pnpm tsc --noEmit && pnpm run build && pnpm test`
- 스택: TypeScript, Commander.js, ky, tsup(CJS 번들), vitest
- 메인 브랜치: `main`
- 워크플로: 브랜치명 = `{category}/<NNN>-<slug>`이며 세부 규칙은 `.claude/planning-overlay.md`를 따른다.
- tsc/vitest 가 잡는다: exitCode 타입 오류 등 정적 타입 오류, vitest 가 커버하는 로직: "도구로 못 잡음" 조건에서 제외

## 라우터: 관련 패턴 고르는 법

전부 읽지 않는다. 두 가지 방법으로 이 작업에 해당하는 파일만 고른다.

1. **trigger grep** (1차): 각 파일 frontmatter 의 `triggers:` 에 변경 유형 키워드가 있다. 작업 키워드로 좁힌다:

   ```bash
   # 예: spinner 순서를 바꾸는 코드 작성
   grep -rl "triggers:.*spinner" docs/pitfalls/code-review/
   # 예: 팀원 스폰·메시지 plan
   grep -rl "triggers:.*\(팀원 스폰\|SendMessage\)" docs/pitfalls/team/
   ```

2. **자주 쓰는 변경 유형 → 파일** (큐레이션):

| 변경 유형 | 카테고리 | 핵심 파일 |
|---|---|---|
| spinner·UX 순서 (validation 전 시작) | code-review | [spinner-before-validation](code-review/spinner-before-validation.md), [spinner-no-try-catch](code-review/spinner-no-try-catch.md), [resolver-after-editor](code-review/resolver-after-editor.md) |
| 에러 처리 일관성 (exitCode·catch) | code-review | [exitcode-param-error-in-api-path](code-review/exitcode-param-error-in-api-path.md), [exitcode-missing](code-review/exitcode-missing.md), [credential-loader-reinvented-swallow](code-review/credential-loader-reinvented-swallow.md) |
| 타입 안전성 (Map.get()! / 이중 단언 / optional 응답 필드) | code-review | [map-get-nonnull-assertion](code-review/map-get-nonnull-assertion.md), [double-assertion-unknown](code-review/double-assertion-unknown.md), [double-assertion-union-type](code-review/double-assertion-union-type.md), [optional-response-field-guard](code-review/optional-response-field-guard.md), [shared-guard-foreign-schema](code-review/shared-guard-foreign-schema.md) |
| API/HTTP 패턴 (redirect·throwHttpErrors) | code-review | [redirect-manual-status-missing](code-review/redirect-manual-status-missing.md), [numeric-response-string-number-mixed](code-review/numeric-response-string-number-mixed.md) |
| 방어 가드와 회귀 테스트 | code-review | [guard-without-failing-test](code-review/guard-without-failing-test.md) |
| 봉투 검사 (200-고정 API·isSuccessful) | code-review | [write-method-envelope-unchecked](code-review/write-method-envelope-unchecked.md), [new-endpoint-envelope-assumed](plan/new-endpoint-envelope-assumed.md) |
| exitCode 누락·mismatch | code-review | [exitcode-missing](code-review/exitcode-missing.md), [mock-reject-value-mismatch](code-review/mock-reject-value-mismatch.md), [exit-code-literal-no-constant](code-review/exit-code-literal-no-constant.md) |
| path-traversal (fileName basename) | code-review | [path-traversal-filename](code-review/path-traversal-filename.md) |
| interactive 경고 vs 실제 동작 | code-review | [interactive-warning-mismatch](code-review/interactive-warning-mismatch.md), [noninteractive-trigger-dead-warning](plan/noninteractive-trigger-dead-warning.md) |
| CLI option parser/helper 적용 | plan | [option-parse-before-side-effects](plan/option-parse-before-side-effects.md), [numeric-param-range-unverified](plan/numeric-param-range-unverified.md), [positive-int-number-only](code-review/positive-int-number-only.md) |
| 공용 helper 배치·중복 (DRY) | code-review | [shared-helper-in-command-file](code-review/shared-helper-in-command-file.md), [duplicate-map-block-no-helper](code-review/duplicate-map-block-no-helper.md), [noninteractive-interactive-duplication](code-review/noninteractive-interactive-duplication.md) |
| ADR·이슈 본문에 외부 상태를 근거로 쓸 때 | plan | [stale-context-as-doc-evidence](plan/stale-context-as-doc-evidence.md), [external-state-gate-missing](plan/external-state-gate-missing.md) |
| 기존 동작을 반대로 뒤집는 변경 (실패 경로·보존 정책) | plan | [goal-reversed-logic-reuse](plan/goal-reversed-logic-reuse.md), [stale-code-in-reuse-claim](plan/stale-code-in-reuse-claim.md) |
| 결정·옵션·인수 폐지 후 문서 표면 정리 | plan | [decision-surface-sweep-incomplete](plan/decision-surface-sweep-incomplete.md), [path-migration-agents-missing](plan/path-migration-agents-missing.md) |
| 되돌릴 수 없는 쓰기 명령 (배포·삭제·전송) | plan | [safety-note-without-user-facing-text](plan/safety-note-without-user-facing-text.md), [write-command-executor-live-call](plan/write-command-executor-live-call.md) |
| plan 작성 (phase 항목·검증 명령·완료 조건) | plan | [numeric-estimation](plan/numeric-estimation.md), [manual-verification-criterion](plan/manual-verification-criterion.md), [last-phase-completed-marking](plan/last-phase-completed-marking.md) |
| 팀원 스폰·메시지 (build-with-teams) | team | [sendmessage-reply-missing](team/sendmessage-reply-missing.md), [member-premature-execution](team/member-premature-execution.md), [executor-premature-execution](plan/executor-premature-execution.md) |
| worktree·cwd 격리 | team | [executor-cwd-isolation](team/executor-cwd-isolation.md), [execution-context-ambiguous](plan/execution-context-ambiguous.md), [cwd-tracking-dual-status](team/cwd-tracking-dual-status.md) |

표에 없으면 trigger grep, 그래도 애매하면 카테고리 디렉터리 통째로 읽는다.

## 카테고리별 패턴 목록

### [plan/](plan/)

- [cache-bypass-in-verify-helper](plan/cache-bypass-in-verify-helper.md)
- [carve-out-conflicting-prohibition](plan/carve-out-conflicting-prohibition.md)
- [decision-docs-in-phase](plan/decision-docs-in-phase.md)
- [decision-surface-sweep-incomplete](plan/decision-surface-sweep-incomplete.md)
- [endpoint-version-double-prefix](plan/endpoint-version-double-prefix.md)
- [execution-context-ambiguous](plan/execution-context-ambiguous.md)
- [executor-premature-execution](plan/executor-premature-execution.md)
- [external-state-gate-missing](plan/external-state-gate-missing.md)
- [file-scope-inaccurate](plan/file-scope-inaccurate.md)
- [filter-type-narrowing-lost](plan/filter-type-narrowing-lost.md)
- [four-face-guard-missing](plan/four-face-guard-missing.md)
- [function-signature-unverified](plan/function-signature-unverified.md)
- [goal-reversed-logic-reuse](plan/goal-reversed-logic-reuse.md)
- [import-identifier-collision](plan/import-identifier-collision.md)
- [input-validation-policy-asymmetry](plan/input-validation-policy-asymmetry.md)
- [integrated-command-partial-surface](plan/integrated-command-partial-surface.md)
- [last-phase-completed-marking](plan/last-phase-completed-marking.md)
- [list-endpoint-pagination-missing](plan/list-endpoint-pagination-missing.md)
- [list-output-column-docs-mismatch](plan/list-output-column-docs-mismatch.md)
- [macos-bsd-sed-word-boundary](plan/macos-bsd-sed-word-boundary.md)
- [manual-verification-criterion](plan/manual-verification-criterion.md)
- [new-command-docs-required-skip](plan/new-command-docs-required-skip.md)
- [new-endpoint-envelope-assumed](plan/new-endpoint-envelope-assumed.md)
- [noninteractive-trigger-dead-warning](plan/noninteractive-trigger-dead-warning.md)
- [numeric-estimation](plan/numeric-estimation.md)
- [numeric-param-range-unverified](plan/numeric-param-range-unverified.md)
- [on-disk-schema-multiple-options](plan/on-disk-schema-multiple-options.md)
- [option-parse-before-side-effects](plan/option-parse-before-side-effects.md)
- [path-migration-agents-missing](plan/path-migration-agents-missing.md)
- [prev-plan-interaction-missing](plan/prev-plan-interaction-missing.md)
- [prose-migration-lossless-checklist](plan/prose-migration-lossless-checklist.md)
- [punt-orphan-deliverable](plan/punt-orphan-deliverable.md)
- [revise-string-change-cascade-missing](plan/revise-string-change-cascade-missing.md)
- [router-index-count-mismatch](plan/router-index-count-mismatch.md)
- [safety-note-without-user-facing-text](plan/safety-note-without-user-facing-text.md)
- [single-file-split-section-boundary-leak](plan/single-file-split-section-boundary-leak.md)
- [source-feeding-roundtrip-unverified](plan/source-feeding-roundtrip-unverified.md)
- [stale-code-in-reuse-claim](plan/stale-code-in-reuse-claim.md)
- [stale-context-as-doc-evidence](plan/stale-context-as-doc-evidence.md)
- [structure-migration-frontmatter-placeholder](plan/structure-migration-frontmatter-placeholder.md)
- [success-criterion-no-enforcement](plan/success-criterion-no-enforcement.md)
- [test-expected-value-guessed](plan/test-expected-value-guessed.md)
- [test-module-const-mock-timing](plan/test-module-const-mock-timing.md)
- [type-optional-cascade-grep-missing](plan/type-optional-cascade-grep-missing.md)
- [write-command-executor-live-call](plan/write-command-executor-live-call.md)

### [team/](team/)

- [branch-check-before-commit](team/branch-check-before-commit.md)
- [critic-stale-reread](team/critic-stale-reread.md)
- [cwd-tracking-dual-status](team/cwd-tracking-dual-status.md)
- [executor-cwd-isolation](team/executor-cwd-isolation.md)
- [executor-scope-creep](team/executor-scope-creep.md)
- [member-premature-execution](team/member-premature-execution.md)
- [reviewer-no-plan-context](team/reviewer-no-plan-context.md)
- [self-shutdown-pattern](team/self-shutdown-pattern.md)
- [sendmessage-reply-missing](team/sendmessage-reply-missing.md)
- [task-index-phase-count-mismatch](team/task-index-phase-count-mismatch.md)

### [code-review/](code-review/)

- [adjacent-command-pattern-missing](code-review/adjacent-command-pattern-missing.md)
- [ambiguous-option-positional-silent-fallback](code-review/ambiguous-option-positional-silent-fallback.md)
- [cache-consistency](code-review/cache-consistency.md)
- [cache-non-atomic-write](code-review/cache-non-atomic-write.md)
- [client-dep-in-utils](code-review/client-dep-in-utils.md)
- [commander-reserved-flag-conflict](code-review/commander-reserved-flag-conflict.md)
- [credential-loader-reinvented-swallow](code-review/credential-loader-reinvented-swallow.md)
- [dead-field-function-name-mismatch](code-review/dead-field-function-name-mismatch.md)
- [delimiter-concat-hash-collision](code-review/delimiter-concat-hash-collision.md)
- [docs-regex-digit-range-mismatch](code-review/docs-regex-digit-range-mismatch.md)
- [double-assertion-union-type](code-review/double-assertion-union-type.md)
- [double-assertion-unknown](code-review/double-assertion-unknown.md)
- [duplicate-map-block-no-helper](code-review/duplicate-map-block-no-helper.md)
- [early-return-quiet-mode-missing](code-review/early-return-quiet-mode-missing.md)
- [empty-result-stderr-wrong](code-review/empty-result-stderr-wrong.md)
- [enum-dual-definition-unsync](code-review/enum-dual-definition-unsync.md)
- [exit-code-literal-no-constant](code-review/exit-code-literal-no-constant.md)
- [exitcode-missing](code-review/exitcode-missing.md)
- [exitcode-param-error-in-api-path](code-review/exitcode-param-error-in-api-path.md)
- [external-string-unsanitized](code-review/external-string-unsanitized.md)
- [file-input-no-stat-guard](code-review/file-input-no-stat-guard.md)
- [guard-without-failing-test](code-review/guard-without-failing-test.md)
- [interactive-warning-mismatch](code-review/interactive-warning-mismatch.md)
- [io-throw-bundled-untestable](code-review/io-throw-bundled-untestable.md)
- [jsdoc-double-block-stale](code-review/jsdoc-double-block-stale.md)
- [json-parse-as-cast](code-review/json-parse-as-cast.md)
- [map-get-nonnull-assertion](code-review/map-get-nonnull-assertion.md)
- [mock-reject-value-mismatch](code-review/mock-reject-value-mismatch.md)
- [noninteractive-interactive-duplication](code-review/noninteractive-interactive-duplication.md)
- [nullable-field-string-only-guard](code-review/nullable-field-string-only-guard.md)
- [numeric-response-string-number-mixed](code-review/numeric-response-string-number-mixed.md)
- [one-time-secret-silent-loss](code-review/one-time-secret-silent-loss.md)
- [optional-credential-empty-fallback](code-review/optional-credential-empty-fallback.md)
- [optional-field-as-cast-return](code-review/optional-field-as-cast-return.md)
- [optional-response-field-guard](code-review/optional-response-field-guard.md)
- [path-traversal-filename](code-review/path-traversal-filename.md)
- [positive-int-number-only](code-review/positive-int-number-only.md)
- [quiet-mode-identifier-missing](code-review/quiet-mode-identifier-missing.md)
- [redirect-manual-status-missing](code-review/redirect-manual-status-missing.md)
- [required-option-redundant-guard](code-review/required-option-redundant-guard.md)
- [resolver-after-editor](code-review/resolver-after-editor.md)
- [resolver-boundary-empty-id](code-review/resolver-boundary-empty-id.md)
- [sensitive-file-mode-missing](code-review/sensitive-file-mode-missing.md)
- [sequential-endpoint-partial-failure](code-review/sequential-endpoint-partial-failure.md)
- [shared-guard-foreign-schema](code-review/shared-guard-foreign-schema.md)
- [shared-helper-in-command-file](code-review/shared-helper-in-command-file.md)
- [spinner-before-validation](code-review/spinner-before-validation.md)
- [spinner-no-try-catch](code-review/spinner-no-try-catch.md)
- [test-regex-dotall-missing](code-review/test-regex-dotall-missing.md)
- [test-self-mock](code-review/test-self-mock.md)
- [union-false-nullish-coalescing](code-review/union-false-nullish-coalescing.md)
- [union-overload-common-guard-only](code-review/union-overload-common-guard-only.md)
- [unknown-array-object-entries-no-guard](code-review/unknown-array-object-entries-no-guard.md)
- [write-method-envelope-unchecked](code-review/write-method-envelope-unchecked.md)
