# Phase 03. instance security-group add·remove 명령

**Execution profile**: standard

## 목표

인스턴스에 보안그룹 연결을 추가하거나 해제하는 명령을 추가한다. 다른 연결은 보존하고, 대상 그룹이 모호하면 요청하지 않는다.

**범위 외**: 사용자 가이드는 Phase 04다. 실제 API를 호출하지 않는다.

## 컨텍스트

- Phase 01: `InstanceClient.addSecurityGroup(id, groupName)`, `removeSecurityGroup(id, groupName)`.
- Phase 02: `requireYes`가 `src/commands/resource-resolver.ts`에 있다.
- 공용 helper(`src/commands/network/helpers.ts`): `resolveSecurityGroupClients(opts)`가 같은 Keystone 토큰으로 `{ network, instance }`를 만든다. `resolveSecurityGroupId`, `withOptions`.
- 연결 판정은 `NetworkClient.listSecurityGroupPorts(groupId)` 결과에서 `device_id === <instance-id>`인 포트가 있는지로 한다.
- 인스턴스 명령 등록은 `src/index.ts`의 `instanceCommand.addCommand(...)`다. 하위 그룹 선례는 `instanceVolumeCommand`(`src/commands/instance/volume.ts`)다.

**근거 문서**: `docs/adr/038-security-group-write-safety.md`, `docs/flow.md`의 「IaaS 흐름」 절

## 의도 메모

- 서버 액션은 그룹 이름을 받는다. 같은 이름의 그룹이 둘 이상이면 어느 그룹에 적용될지 CLI가 보장할 수 없어 요청하지 않는다.
- 사후 확인이 어긋나도 실패로 끝내지 않는다. 서버가 202로 받았고, 반영 시점이 늦을 수 있다.

## 작업 항목

### 1. `src/commands/network/helpers.ts`에 이름 중복 판정 추가

```ts
export function requireUniqueGroupName(groups: SecurityGroup[], groupId: string): SecurityGroup;
```

`groupId`에 해당하는 그룹을 찾고, 같은 `name`을 가진 그룹이 둘 이상이면 `이름이 같은 보안그룹이 <n>개 있어 인스턴스 연결을 변경할 수 없습니다: <이름> (후보 UUID: <정렬된 목록>). network security-group update로 이름을 먼저 바꾸세요.`를 `EXIT_PARAM_ERROR`로 던진다.

### 2. `src/commands/instance/security-group.ts` 신규

`securityGroupCommand = new Command("security-group").description("인스턴스의 보안그룹 연결 변경")`에 `add`, `remove`를 붙여 export한다.
둘 다 `.argument("<instance-id>", "인스턴스 UUID").argument("<group>", "보안그룹 이름 또는 UUID").option("--yes", ...)`과 `withOptions`를 쓴다.

공통 순서:

1. `requireYes(opts.yes, "보안그룹 연결 추가" | "보안그룹 연결 해제")`, `requireResourceInput(instanceId, "인스턴스")`, `requireResourceInput(group, "보안그룹")`
2. `resolveSecurityGroupClients(opts)` → spinner 시작
3. `network.listSecurityGroups()`로 그룹 목록을 한 번 받아 `resolveFromList`로 UUID를 정하고 `requireUniqueGroupName`
4. `network.listSecurityGroupPorts(groupId)`로 현재 연결 여부 판정

| 명령 | 이미 연결됨 | 연결 안 됨 |
|---|---|---|
| `add` | 요청하지 않고 `status: "unchanged"` | `instance.addSecurityGroup(id, name)` 후 `status: "succeeded"` |
| `remove` | `instance.removeSecurityGroup(id, name)` 후 `status: "succeeded"` | spinner를 닫고 `인스턴스 <id>에 보안그룹 <name>이 연결되어 있지 않습니다.`를 `EXIT_PARAM_ERROR` |

5. 요청했으면 `listSecurityGroupPorts(groupId)`를 다시 조회해 기대 상태와 다르면 spinner를 닫은 뒤 `경고: 요청은 접수됐지만 연결 조회에 아직 반영되지 않았습니다. network security-group ports <groupId>로 다시 확인하세요.`를 stderr에 쓴다.
6. 출력: `{ operation: "instance-security-group-add" | "instance-security-group-remove", status, instance_id, security_group_id, security_group_name }`를 field/value와 `raw`로, `ids: [instance_id]`.

### 3. `src/index.ts`에 등록

`instanceCommand.addCommand(instanceSecurityGroupCommand)`로 붙인다. import 이름은 network의 `securityGroupCommand`와 겹치지 않게 `securityGroupCommand as instanceSecurityGroupCommand`로 한다.

### 4. 테스트 `src/commands/instance/security-group.test.ts` 신규

`resolveSecurityGroupClients`를 mock하고 `output`, spinner를 mock한다.

- `--yes`가 없으면 client 해석 전에 `EXIT_PARAM_ERROR`.
- 같은 이름의 그룹이 둘이면 `addSecurityGroup`을 부르지 않고 `EXIT_PARAM_ERROR`, 메시지에 후보 UUID 두 개가 있다.
- `add`에서 이미 연결돼 있으면 `addSecurityGroup`을 부르지 않고 `status: "unchanged"`.
- `add` 정상: `addSecurityGroup(instanceId, groupName)` 호출, 사후 조회에 반영되면 경고 없음.
- `add` 후 사후 조회에 반영되지 않으면 stderr 경고가 한 줄 나오고 종료 코드는 0.
- `remove`에서 연결돼 있지 않으면 `removeSecurityGroup`을 부르지 않고 `EXIT_PARAM_ERROR`.
- `addSecurityGroup`이 `EXIT_API_ERROR`로 reject되면 그대로 전파된다.

## 검증

```bash
node_modules/.bin/vitest run src/commands/instance/security-group.test.ts src/commands/network
pnpm tsc --noEmit
pnpm test
pnpm run build
node dist/index.js commands --json | jq -r '.commands[].path' | grep '^instance security-group'
# instance security-group, add, remove 가 나온다
node dist/index.js instance security-group add --help | grep -- '--yes'
```

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/commands/network/helpers.ts` | 수정 |
| `src/commands/network/helpers.test.ts` | 수정 |
| `src/commands/instance/security-group.ts` | 신규 |
| `src/commands/instance/security-group.test.ts` | 신규 |
| `src/index.ts` | 수정 |
