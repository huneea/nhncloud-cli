# Phase 03. 사용자 가이드 갱신과 task 완료 처리

**Execution profile**: fast

## 목표

새 조회 명령을 README와 공개 스킬 reference에 반영하고 task를 완료 상태로 바꾼다.

**범위 외**: `docs/prd.md`, `docs/flow.md`, `docs/code-architecture.md`는 planning 단계에서 이미 갱신했다. 구현이 그 문서와 다르면 문서를 고치지 말고 Blocked 조건을 따른다.
공유 그룹 분리 절차 예제는 쓰기 명령이 생기는 다음 task가 작성한다.

## 컨텍스트

- 명령 표면의 단일 소스는 `node dist/index.js commands --json`과 실제 `--help`다.
- 공개 스킬의 IaaS 가이드는 `skills/nhncloud-cli/references/iaas.md`의 `## Network` 절이다. 현재 `network list`와 `network subnet list` 예시만 있다.
- README의 「에이전트 없이 직접 쓰기」 절에 명령 한 줄 예시 목록이 있다.
- 출력 열을 문서에 적을 때는 `grep -n "headers:" src/commands/network/security-group*.ts` 결과를 그대로 옮긴다.

**근거 문서**: `docs/flow.md`의 「IaaS 흐름」 절, `docs/pitfalls/plan/new-command-docs-required-skip.md`, `docs/pitfalls/plan/list-output-column-docs-mismatch.md`

## Blocked 조건

- Phase 02 결과의 명령 경로나 출력 열이 `docs/flow.md`의 「IaaS 흐름」 절과 다르면 `PHASE_BLOCKED: 구현과 설계 문서 불일치`를 출력하고 종료한다.

## 작업 항목

### 1. `skills/nhncloud-cli/references/iaas.md`의 `## Network` 절에 보안그룹 조회를 추가

```bash
nhncloud network security-group list --json
nhncloud network security-group get <group> --json
nhncloud network security-group rule list <group> --json
nhncloud network security-group rule get <rule-id> --json
nhncloud network security-group ports <group> --json
nhncloud network security-group ports <group> --quiet   # 연결된 인스턴스 UUID
```

아래 내용을 문장으로 적는다.

- `<group>`은 이름 또는 UUID다. 이름이 중복되면 후보 UUID를 보여 주고 종료 코드 3으로 끝난다.
- 한 포트에 보안그룹이 여러 개면 모든 그룹의 허용 규칙이 함께 적용된다. 공유 그룹의 규칙을 바꾸면 그 그룹을 쓰는 모든 포트에 영향이 있으므로 먼저 `ports`로 연결 대상을 확인한다.
- `ports`의 `instance_name`은 Compute 인스턴스 목록으로 보강한 값이다. 조회에 실패하면 비어 있고 stderr에 경고가 남는다.

### 2. `README.md`의 「에이전트 없이 직접 쓰기」 목록에 한 줄 추가

`nhncloud network list` 줄 아래에 `nhncloud network security-group list` 와 설명 `# 보안그룹 목록`을 같은 열 정렬로 넣는다.

### 3. `tasks/plan1-network-security-group-read/index.json` 완료 처리

`status`를 `"completed"`, `current_phases`를 `3`으로 바꾼다.

## 검증

```bash
pnpm tsc --noEmit
pnpm test
pnpm run build
node dist/index.js commands --json > /tmp/nhncloud-commands.json
grep -n 'security-group' README.md skills/nhncloud-cli/references/iaas.md
jq -e '.status == "completed" and .current_phases == .total_phases and (.total_phases == (.phases | length))' tasks/plan1-network-security-group-read/index.json
git diff --check
```

AGENTS.md의 「공개 저장소 정보 보호」 절 grep 두 개가 모두 0건이어야 한다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `skills/nhncloud-cli/references/iaas.md` | 수정 |
| `README.md` | 수정 |
| `tasks/plan1-network-security-group-read/index.json` | 수정 |
