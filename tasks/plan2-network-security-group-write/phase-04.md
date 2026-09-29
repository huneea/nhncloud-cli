# Phase 04. 사용자 가이드, DB 분리 예제와 task 완료 처리

**Execution profile**: fast

## 목표

새 쓰기 명령과 개발 DB 전용 그룹 분리 절차·복구 방법을 사용자 가이드에 반영하고 task를 완료 처리한다.

**범위 외**: `docs/prd.md`, `docs/flow.md`, `docs/code-architecture.md`, ADR-038은 planning 단계에서 갱신했다. 구현이 다르면 Blocked 조건을 따른다. 실제 API를 호출하지 않는다.

## 컨텍스트

- 공개 스킬 IaaS 가이드: `skills/nhncloud-cli/references/iaas.md`의 `## Network` 절에 조회 명령이 있다.
- 위험 명령 표: `skills/nhncloud-cli/references/common.md`의 `## 되돌릴 수 없는 명령` 절. 「TTY 여부와 관계없이 `--yes` 필수」 행이 있다.
- README 「에이전트 없이 직접 쓰기」 목록.
- 명령 표면의 단일 소스는 `node dist/index.js commands --json`과 `--help`다.

**근거 문서**: `docs/adr/038-security-group-write-safety.md`, `docs/flow.md`의 「IaaS 흐름」 절

## Blocked 조건

- 명령 경로나 오류 동작이 `docs/flow.md` 「IaaS 흐름」 절과 다르면 `PHASE_BLOCKED: 구현과 설계 문서 불일치`를 출력하고 종료한다.

## 작업 항목

### 1. `skills/nhncloud-cli/references/iaas.md`에 「보안그룹 변경」 절 추가

아래를 문장과 예시로 적는다.

- 그룹 생성은 송신 기본 규칙(IPv4·IPv6)을 자동으로 포함한다.
- 규칙 생성 옵션과 조합 제약(포트에는 tcp·udp, CIDR과 원격 그룹 중 하나, IPv4만).
- 규칙 수정 API가 없다. 교체는 새 규칙을 먼저 만들고 옛 규칙을 지운다. 두 단계라 중간 실패 시 두 규칙이 함께 남거나 허용이 빠질 수 있다.
- 그룹 삭제는 연결 포트가 있으면 거부되고, 다른 그룹 규칙의 원격 참조는 경고로만 남는다.
- 인스턴스 연결 변경은 같은 이름의 그룹이 있으면 거부되므로 이름을 먼저 바꾼다.
- 인스턴스 연결 변경 뒤 `경고: 요청은 접수됐지만 ...` 가 나오면 요청은 접수된 것이므로 다시 실행하지 말고 `network security-group ports <group>`으로 반영을 확인한다.

「공유 그룹을 쓰는 개발 DB를 전용 그룹으로 분리」 예시를 순서대로 둔다. 값은 `<db-instance-id>`, `<shared-group>`, `<app-group>`, `<admin-cidr>` placeholder로 쓴다.

```bash
nhncloud network security-group ports <shared-group> --json          # 공유 그룹을 쓰는 인스턴스 확인
nhncloud network security-group rule list <shared-group> --json      # 옮길 규칙 확인
nhncloud network security-group create --name dev-db --description "개발 DB 전용" --quiet
nhncloud network security-group rule create dev-db --direction ingress --protocol tcp --port 22 --cidr <admin-cidr>
nhncloud network security-group rule create dev-db --direction ingress --protocol tcp --port 5432 --remote-group <app-group>
nhncloud instance security-group add <db-instance-id> dev-db --yes
nhncloud instance security-group remove <db-instance-id> <shared-group> --yes
nhncloud network security-group ports dev-db
```

- SSH 관리 경로를 새 그룹에 먼저 넣고, 새 그룹을 연결한 뒤에 공유 그룹을 해제하는 순서의 이유(해제 사이에 접근이 끊기지 않게)를 한 줄로 적는다.
- 송신 규칙은 생성 시 기본 규칙으로 보존된다는 점.
- 복구: `nhncloud instance security-group add <db-instance-id> <shared-group> --yes`로 공유 그룹을 다시 연결한다.

### 2. `skills/nhncloud-cli/references/common.md` 위험 명령 표 갱신

「TTY 여부와 관계없이 `--yes` 필수」 행에 `network security-group delete`, `network security-group rule delete`, `instance security-group add`, `instance security-group remove`를 추가한다.

### 3. `README.md` 「에이전트 없이 직접 쓰기」 목록

`network security-group list` 줄 아래에 `nhncloud instance security-group add <instance-id> <group> --yes`와 설명 `# 인스턴스에 보안그룹 연결`을 같은 열 정렬로 넣는다.

### 4. `tasks/plan2-network-security-group-write/index.json` 완료 처리

`status`를 `"completed"`, `current_phase`를 `4`로 바꾼다.

## 검증

```bash
pnpm tsc --noEmit
pnpm test
pnpm run build
node dist/index.js commands --json > /tmp/nhncloud-commands.json
grep -n 'security-group' README.md skills/nhncloud-cli/references/iaas.md skills/nhncloud-cli/references/common.md
jq -e '.status == "completed" and .current_phase == .total_phases and (.total_phases == (.phases | length))' tasks/plan2-network-security-group-write/index.json
git diff --check
```

AGENTS.md 「공개 저장소 정보 보호」 절의 grep 두 개가 모두 0건이어야 한다.

## 수동 QA (사람이 수행)

아래는 실제 리소스를 바꾸므로 worker가 실행하지 않는다. PR 리뷰 중 사용자가 개발 프로젝트에서 수행하고, 결과가 문서와 다르면 review-fix로 명령과 문서를 고친다.

- 임시 그룹을 인스턴스에 `add` → `ports`로 확인 → `remove`
- 같은 이름의 그룹 두 개가 있을 때 `add`가 요청 전에 거부되는지
- 연결된 그룹 `delete`가 거부되는지

## 변경 파일

| 파일 | 변경 |
|---|---|
| `skills/nhncloud-cli/references/iaas.md` | 수정 |
| `skills/nhncloud-cli/references/common.md` | 수정 |
| `README.md` | 수정 |
| `tasks/plan2-network-security-group-write/index.json` | 수정 |
