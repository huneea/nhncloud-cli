# docs-audit 오버레이: nhncloud-cli

공용 `docs-audit` 스킬에 이 저장소의 문서 범위만 보탠다.

## 감사 대상

- 제품과 설계: `docs/prd.md`, `docs/flow.md`, `docs/code-architecture.md`, `docs/data-schema.md`, `docs/adr/`
- 사용자 가이드: `README.md`, `skills/nhncloud-cli/SKILL.md`, `skills/nhncloud-cli/references/`
- 반복 함정: `docs/pitfalls/INDEX.md`, `docs/pitfalls/*/*.md`
- 하네스: `AGENTS.md`, `.claude/*.md`, `.agents/skills/*/SKILL.md`, `.github/workflows/code-review-prompt.txt`

명령과 옵션 설명은 `node dist/index.js commands --json`과 실제 help를 기준으로 대조한다.
ADR 목록과 링크 무결성을 확인한다.
공개 정보 검사는 `AGENTS.md`의 명령을 그대로 사용한다.
