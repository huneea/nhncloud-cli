# Phase 02. network security-group 조회 명령 구현

**Execution profile**: standard

## 목표

`network security-group` 아래에 조회 명령 5개를 추가한다.
공유 보안그룹을 바꾸기 전에 규칙과 연결된 인스턴스를 CLI로 확인할 수 있게 한다.

**범위 외**: 쓰기 명령(`create`, `update`, `delete`, `rule create`, `rule delete`, `instance security-group add|remove`)은 다음 task가 만든다.
README와 공개 스킬 reference는 Phase 03이 갱신한다.

## 컨텍스트

- Phase 01이 추가한 것: `src/commands/resource-resolver.ts`의 `requireResourceInput`, `resolveFromList`와 `NetworkClient`의 `listSecurityGroups`, `getSecurityGroup`, `listSecurityGroupRules`, `getSecurityGroupRule`, `listSecurityGroupPorts`, 그리고 `src/services/network/types.ts`의 `SecurityGroup`, `SecurityGroupRule`, `SecurityGroupPort`.
- 명령 형태는 `src/commands/network/subnet.ts`를 따른다. `--region`, `--profile` 옵션과 `cmd.optsWithGlobals<…>()`, client 해석 → `startSpinner` → try/catch에서 `stopSpinner(false)` → `output(opts, { headers, rows, raw, ids })` 순서다.
- 단건 조회 출력은 `src/commands/instance/get.ts`처럼 `headers: ["field", "value"]`를 쓴다.
- client 해석은 `src/commands/network/helpers.ts`의 `resolveNetworkClient(opts)`다. 내부에서 `resolveIaasTokenContext(opts)`(`src/commands/iaas.ts`)를 부르며, 반환값에 `tokenId`, `computeEndpoint`, `imageEndpoint`, `networkEndpoint`가 있다.
  공공망 host 선택과 미지원 region 거부는 이 경로가 이미 한다.
- 인스턴스 이름은 `InstanceClient(tokenId, computeEndpoint, imageEndpoint).list()`(`GET /servers/detail`, `src/services/instance/client.ts`)로 얻는다. 반환 `Server`의 `id`, `name`을 쓴다.
- 명령 등록은 `src/index.ts`의 `networkCommand`(현재 `networkListCommand`, `subnetCommand`)다.

**근거 문서**: `docs/flow.md`의 「IaaS 흐름」과 「조회와 페이지 이동」 절, `docs/prd.md`의 `nhncloud network` 항목, `docs/code-architecture.md`의 「명령 실행 경계」 절

## 의도 메모

- `ports --quiet`만 첫 열이 아닌 인스턴스 UUID(`device_id`)를 낸다. 다음 task의 `instance security-group add|remove <id>`에 바로 넘기기 위해서다. help 설명에 이 사실을 적는다.
- 인스턴스 이름 보강이 실패해도 명령은 성공한다. 연결 정보가 이 명령의 본래 목적이고 이름은 보조 정보다.
- 인스턴스 목록은 포트마다 부르지 않고 한 번만 부른다. compute 포트가 하나도 없으면 부르지 않는다.
- `get <group>`은 규칙 표를 기본 출력에 넣지 않는다. 규칙은 `rule list <group>`이 소유하고, `--json`에는 `security_group_rules`가 그대로 들어간다.

## 작업 항목

### 1. `src/commands/network/helpers.ts`에 공용 helper 추가

```ts
export async function resolveSecurityGroupClients(
  opts: IaasResolverOpts,
): Promise<{ network: NetworkClient; instance: InstanceClient; profileName: string }>;

export async function resolveSecurityGroupId(
  client: Pick<NetworkClient, "listSecurityGroups">,
  value: string,
): Promise<string>;   // requireResourceInput(value, "보안그룹") → listSecurityGroups() → resolveFromList(…, "보안그룹")

export function formatRulePorts(rule: SecurityGroupRule): string;
// min·max 둘 다 null → "any", 같으면 "22", 다르면 "1000-2000"

export function formatRuleRemote(rule: SecurityGroupRule): string;
// remote_ip_prefix가 있으면 그 값, remote_group_id가 있으면 "sg:<id>", 둘 다 null이면 "any"
```

`resolveSecurityGroupClients`는 `resolveIaasTokenContext`를 한 번만 불러 두 client를 만든다. 토큰을 두 번 발급하지 않는다.
protocol이 `null`이면 표에서 `"any"`, description이 `null`이면 `""`로 쓴다.

### 2. `src/commands/network/security-group.ts` 신규

`securityGroupCommand = new Command("security-group").description("보안그룹 조회")`에 `list`, `get`, `ports`, 그리고 작업 항목 3의 `rule`을 붙인다.

| 명령 | 동작 | headers | raw | ids |
|---|---|---|---|---|
| `list` | `listSecurityGroups()` | `["id", "name", "description", "rules"]` (rules는 규칙 개수) | `SecurityGroup[]` | 그룹 id |
| `get <group>` | 해석 후 `getSecurityGroup(id)` | `["field", "value"]`: id, name, description, tenant_id, rules(개수) | `SecurityGroup` | `[id]` |
| `ports <group>` | 해석 후 `listSecurityGroupPorts(id)`와 인스턴스 이름 보강 | `["port_id", "device_id", "instance_name", "device_owner", "fixed_ips", "security_groups"]` | 포트 배열. 각 원소에 `instance_name: string \| null` 추가 | compute 포트의 `device_id`를 중복 제거한 목록 |

`ports` 세부 규칙:

- `device_owner.startsWith("compute:")`인 포트가 있을 때만 `instance.list()`를 한 번 부른다.
- 목록 호출이 실패하면 `process.stderr.write("경고: 인스턴스 이름을 조회하지 못했습니다: <message>\n")`를 남기고 모든 `instance_name`을 `null`로 둔다. 종료 코드는 0이다.
- 경고 문구에 토큰이나 자격증명을 넣지 않는다. `NhnCloudCliError`의 `message`만 쓴다.
- 표에서 `instance_name`이 `null`이면 `""`, `fixed_ips`는 `ip_address`를 `,`로, `security_groups`는 id를 `,`로 잇는다.
- 설명: `"보안그룹에 연결된 포트와 인스턴스를 조회한다 (--quiet는 인스턴스 UUID)"`.

`<group>` 해석은 spinner 안에서 한다(API 호출이므로). 빈 인수 검사(`requireResourceInput`)는 client 해석보다 먼저 한다.

### 3. `src/commands/network/security-group-rule.ts` 신규

`ruleCommand = new Command("rule").description("보안 규칙 조회")`를 export하고 작업 항목 2가 `securityGroupCommand`에 붙인다.

| 명령 | 동작 | headers | raw | ids |
|---|---|---|---|---|
| `rule list <group>` | 해석 후 `listSecurityGroupRules(id)` | `["id", "direction", "ethertype", "protocol", "ports", "remote", "description"]` | `SecurityGroupRule[]` | 규칙 id |
| `rule get <rule-id>` | `getSecurityGroupRule(ruleId)` | `["field", "value"]`: id, security_group_id, direction, ethertype, protocol, ports, remote, description | `SecurityGroupRule` | `[id]` |

`rule get`은 규칙 UUID만 받는다. 규칙에는 이름이 없다.

### 4. `src/index.ts` 수정

- `securityGroupCommand`를 import해 `networkCommand.addCommand(securityGroupCommand)`로 등록한다.
- `networkCommand` 설명을 `"VPC·서브넷·보안그룹 조회"`로 바꾼다.
- `networkAgentWorkflow`에 `3. nhncloud network security-group list --json`과 `4. nhncloud network security-group ports <group> --json`을 더한다.

### 5. 테스트 `src/commands/network/security-group.test.ts` 신규

`src/commands/loadbalancer/commands.test.ts`처럼 `./helpers.js`의 client 해석 함수, `../../formatters/table.js`의 `output`, `../../utils/spinner.js`를 mock한다. `formatRulePorts`, `formatRuleRemote`, `resolveSecurityGroupId`는 실제 구현을 쓴다.

- `list`: 규칙 2개인 그룹의 rows가 `[id, name, description, "2"]`이고 ids가 그룹 id다.
- `get default`: 이름으로 해석한 UUID로 `getSecurityGroup`을 부른다. 이름이 중복되면 `EXIT_PARAM_ERROR`이고 `getSecurityGroup`을 부르지 않는다.
- `rule list`: 포트·원격 표기(`any`, `22`, `1000-2000`, CIDR, `sg:<id>`)와 null protocol·description 표기.
- `ports`: compute 포트 2개(같은 `device_id`)와 `trunk:subport` 포트 1개가 있을 때 ids는 `device_id` 하나이고 trunk 포트의 `instance_name`은 `null`이다.
- `ports`: `instance.list()`가 reject되면 stderr 경고 한 줄이 남고 `output`은 호출되며 `instance_name`이 모두 `null`이다.
- `ports`: compute 포트가 없으면 `instance.list()`를 부르지 않는다.
- 빈 문자열 `<group>`은 client 해석 전에 `EXIT_PARAM_ERROR`로 끝난다.

## 검증

```bash
node_modules/.bin/vitest run src/commands/network/security-group.test.ts
pnpm tsc --noEmit
pnpm test
pnpm run build
node dist/index.js commands --json | jq -r '.commands[].path' | grep '^network security-group'
# network security-group, get, list, ports, rule, rule get, rule list 가 모두 나온다
node dist/index.js network security-group ports --help | grep -- '--quiet는 인스턴스 UUID'
```

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/commands/network/helpers.ts` | 수정 |
| `src/commands/network/security-group.ts` | 신규 |
| `src/commands/network/security-group-rule.ts` | 신규 |
| `src/commands/network/security-group.test.ts` | 신규 |
| `src/index.ts` | 수정 |
