# build-with-teams 오버레이: nhncloud-cli

공용 `build-with-teams` 스킬에 이 저장소의 역할, worktree와 검증 경로만 보탠다.

## 역할

- executor: `nhncloud-cli-executor`
- docs-verifier: `nhncloud-cli-docs-verifier`

Claude Code 정의는 `.claude/agents/`, Codex 정의는 `.codex/agents/`에 있다.
spawn 프롬프트에는 task 절대경로와 직전 phase에서 확인한 사실만 넘긴다.

## worktree

worktree는 `.agents/worktrees/{task-name}`에 둔다.

```bash
git worktree add .agents/worktrees/{task-name} -b {category}/{NNN}-{task-name} origin/main
```

task 경로, `index.json` 스키마, 브랜치와 PR 이름은 `.claude/planning-overlay.md`가 소유한다.

## 검증

통합 검증은 `AGENTS.md`의 명령을 따른다.
worktree에서 설치가 차단되면 `AGENTS.md`의 직접 바이너리 fallback을 적용한다.

## 반복 함정

critic, executor와 reviewer는 `docs/pitfalls/INDEX.md`에서 현재 변경에 맞는 파일만 고른다.
새 패턴은 저장소의 승격 조건을 통과할 때만 `docs/pitfalls/`에 패턴당 한 파일로 남긴다.
원시 회고와 실행 통계는 파일로 만들지 않는다.
