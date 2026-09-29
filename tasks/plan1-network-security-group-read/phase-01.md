# Phase 01. 공용 리소스 해석기 분리와 보안그룹 service client 추가

**Execution profile**: standard

## 목표

보안그룹 조회 명령이 쓸 service client 메서드 5개와 응답 타입을 추가한다.
Load Balancer 전용이던 이름·UUID 해석 규칙을 공용 파일로 옮겨 보안그룹 명령도 같은 규칙을 쓰게 한다.

**범위 외**: Commander 명령과 출력 형식은 Phase 02가 만든다.
보안그룹 생성·수정·삭제, 규칙 생성·삭제, 인스턴스 연결 변경은 이 task 범위가 아니다.

## 컨텍스트

- 이름·UUID 해석 규칙은 현재 `src/commands/loadbalancer/helpers.ts`의 `requireResourceInput`, `resolvedId`, `resolveFromList`에 있다.
  UUID가 정확히 일치하면 그 리소스를 쓰고, 이름이 하나만 일치하면 그것을 쓴다.
  이름이 없으면 `을(를) 찾을 수 없습니다`, 중복되면 `이름이 중복됩니다 ... (후보 UUID: ...)`로 `EXIT_PARAM_ERROR`를 던진다.
- `NetworkClient`(`src/services/network/client.ts`)의 `networkEndpoint`는 이미 `/v2.0`을 포함한다(`src/api/keystone.ts`의 `networkEndpoint = https://${networkHost(...)}/v2.0`).
  기존 메서드도 `${this.networkEndpoint}/vpcs`처럼 버전 없이 경로를 붙인다.
- 응답 가드는 같은 파일의 `isVpc`, `isFloatingIp` 패턴을 따른다. 출력에 쓰는 필드를 모두 검증하고 가드 실패는 `EXIT_API_ERROR`다.
- HTTP 오류는 `toNhnCloudCliError(err)`로 바꾼다. 요청은 `retry: 0`, `timeout: DEFAULT_TIMEOUT_MS`를 쓴다.

**근거 문서**: `docs/code-architecture.md`의 「명령 실행 경계」 절, `docs/flow.md`의 「IaaS 흐름」 절, `docs/adr/013-iaas-multi-service-endpoint.md`, `docs/adr/037-gov-profile-endpoints.md`

**공식 API**: [Security Groups API](https://docs.nhncloud.com/ko/Network/Security%20Groups/ko/public-api/), [공공기관용](https://docs.gov-nhncloud.com/ko/Network/Security%20Groups/ko/public-api-gov/)

### 실측으로 확인한 응답 형태 (2026-09-28, 일반망 kr1)

모든 필드는 항상 존재했다. `null`이 될 수 있는 필드만 표에 적는다.

| 객체 | 필드 | 타입 |
|---|---|---|
| security group | `id`, `name`, `description`, `tenant_id` | string |
| security group | `security_group_rules` | rule 배열 |
| rule | `id`, `security_group_id`, `direction`, `ethertype`, `tenant_id`, `project_id` | string |
| rule | `protocol`, `remote_ip_prefix`, `remote_group_id`, `description` | string 또는 `null` |
| rule | `port_range_min`, `port_range_max` | number 또는 `null` |
| port | `id`, `name`, `status`, `device_owner`, `device_id`, `network_id`, `mac_address`, `tenant_id`, `project_id` | string |
| port | `admin_state_up` | boolean |
| port | `fixed_ips` | `{ subnet_id: string; ip_address: string }` 배열 |
| port | `security_groups` | string 배열 |

- 목록 API는 `limit` 없이 호출하면 전체를 한 번에 돌려준다. 응답에 `_links` 같은 다음 페이지 정보가 없다.
- 단건 응답은 `{ security_group: {...} }`, `{ security_group_rule: {...} }`로 감싼다.
- 포트의 `device_owner`에는 `compute:<az>` 외에 `trunk:subport`도 나온다.

## 의도 메모

- 해석기를 `src/commands/`에 두는 이유: `NhnCloudCliError(…, EXIT_PARAM_ERROR)`를 던지는 입력 검증이라 service 계층이 아니다.
- `requireResourceInputs`, `requireYes` 등 Load Balancer 고유 helper는 옮기지 않는다.
- `loadbalancer/helpers.ts`는 옮긴 `requireResourceInput`을 re-export한다. 이 함수를 import하는 Load Balancer 명령 5개 파일을 이번에 고치지 않기 위해서다.
- 목록 요청에 `limit`를 넣지 않는다. 넣으면 서버가 그 수만 돌려준다.

## Blocked 조건

- 공식 문서의 요청 경로나 응답 키가 위 표와 다르면 `PHASE_BLOCKED: 보안그룹 API 응답 형태 불일치`를 출력하고 종료한다.

## 작업 항목

### 1. `src/commands/resource-resolver.ts` 신규

`src/commands/loadbalancer/helpers.ts`에서 아래 세 함수를 옮긴다. 본문과 오류 문구는 바꾸지 않는다.

```ts
export function requireResourceInput(value: string, label: string): string;
function resolvedId(resource: { id: string }, label: string): string;
export function resolveFromList<T extends { id: string; name: string }>(
  resources: T[],
  input: string,
  label: string,
): string;
```

### 2. `src/commands/loadbalancer/helpers.ts` 수정

- 세 함수의 정의를 지우고 `resource-resolver.ts`에서 `requireResourceInput`, `resolveFromList`를 import한다.
- `export { requireResourceInput } from "../resource-resolver.js";`로 기존 export를 유지한다.
- `resolveLoadBalancerId`, `resolveIpAclGroupId`, `requireResourceInputs`의 동작은 그대로 둔다.

### 3. `src/services/network/types.ts`에 타입 추가

```ts
export interface SecurityGroupRule {
  id: string;
  security_group_id: string;
  direction: string;          // "ingress" | "egress"
  ethertype: string;          // "IPv4" | "IPv6"
  protocol: string | null;
  port_range_min: number | null;
  port_range_max: number | null;
  remote_ip_prefix: string | null;
  remote_group_id: string | null;
  description: string | null;
  tenant_id: string;
}

export interface SecurityGroup {
  id: string;
  name: string;
  description: string;
  tenant_id: string;
  security_group_rules: SecurityGroupRule[];
}

export interface SecurityGroupPort {
  id: string;
  name: string;
  status: string;
  device_owner: string;
  device_id: string;
  network_id: string;
  fixed_ips: { subnet_id: string; ip_address: string }[];
  security_groups: string[];
}
```

`direction`과 `ethertype`은 서버가 값을 늘릴 수 있어 string으로 받는다.
응답의 나머지 필드(`project_id`, `mac_address`, `admin_state_up`)는 타입에 넣지 않는다. `--json` 원본 출력에는 그대로 남는다.

### 4. `src/services/network/client.ts`에 가드와 메서드 추가

가드 `isSecurityGroupRule`, `isSecurityGroup`, `isSecurityGroupPort`를 추가한다.
nullable 필드는 `=== null || typeof === "string"`(포트 범위는 `"number"`)로 검증한다.
`fixed_ips`는 원소마다 두 필드가 string인지, `security_groups`는 원소가 모두 string인지 확인한다.

| 메서드 | 요청 | 응답 키 |
|---|---|---|
| `listSecurityGroups(): Promise<SecurityGroup[]>` | `GET ${networkEndpoint}/security-groups` | `security_groups` |
| `getSecurityGroup(id: string): Promise<SecurityGroup>` | `GET ${networkEndpoint}/security-groups/${encodeURIComponent(id)}` | `security_group` |
| `listSecurityGroupRules(securityGroupId: string): Promise<SecurityGroupRule[]>` | `GET ${networkEndpoint}/security-group-rules`, `searchParams: { security_group_id }` | `security_group_rules` |
| `getSecurityGroupRule(id: string): Promise<SecurityGroupRule>` | `GET ${networkEndpoint}/security-group-rules/${encodeURIComponent(id)}` | `security_group_rule` |
| `listSecurityGroupPorts(securityGroupId: string): Promise<SecurityGroupPort[]>` | `GET ${networkEndpoint}/security-group-ports`, `searchParams: { security_group_id }` | `security_group_ports` |

가드가 실패하면 `"<메서드에 대응하는 명령> 응답 형식이 올바르지 않습니다 — <키> 배열이 없습니다."` 형식의 `NhnCloudCliError(…, EXIT_API_ERROR)`를 던진다.
단건은 `객체가 없습니다`로 끝낸다.
`catch`는 기존 메서드처럼 `throw toNhnCloudCliError(err)`로 통일한다.

### 5. 테스트 `src/commands/resource-resolver.test.ts` 신규

- UUID가 일치하면 이름보다 먼저 그 UUID를 반환한다(다른 리소스 이름이 그 UUID와 같아도).
- 이름이 하나만 일치하면 그 UUID를 반환한다.
- 일치하는 것이 없으면 `EXIT_PARAM_ERROR`와 `찾을 수 없습니다`.
- 이름이 둘이면 `EXIT_PARAM_ERROR`와 정렬된 후보 UUID 두 개가 메시지에 들어간다.
- `requireResourceInput("  a  ", …)`는 `"a"`, 공백만 있으면 `EXIT_PARAM_ERROR`.

### 6. 테스트 `src/services/network/client.test.ts` 신규

`src/services/loadbalancer/client.test.ts`처럼 `ky`를 mock한다.

- 메서드 5개가 모두 `https://kr1-api-network-infrastructure.nhncloudservice.com/v2.0/<경로>`로 호출되고 URL에 `/v2.0/v2.0`이 없다.
- 규칙과 포트 목록은 `searchParams`에 `security_group_id`만 담고 `limit`를 담지 않는다.
- 위 표의 nullable 필드가 모두 `null`인 규칙을 가드가 통과시킨다.
- `protocol: 6`처럼 타입이 틀린 규칙, `security_groups` 원소가 숫자인 포트는 `EXIT_API_ERROR`로 거부한다.
- `HTTPError` 403은 `EXIT_AUTH_ERROR`, 500은 `EXIT_API_ERROR`로 바뀐다(`src/api/httpError.ts`의 `toNhnCloudCliError` 매핑).
- 공공망: `new NetworkClient(token, "https://kr1-api-network-infrastructure.gov-nhncloudservice.com/v2.0")`로 만든 client가 그 host로 호출한다.

## 검증

```bash
node_modules/.bin/vitest run src/commands/resource-resolver.test.ts src/services/network/client.test.ts src/commands/loadbalancer
pnpm tsc --noEmit
pnpm test
grep -c 'networkEndpoint}/v2' src/services/network/client.ts   # 0
grep -n 'function resolveFromList\|function resolvedId' src/commands/loadbalancer/helpers.ts   # 출력 없음
```

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/commands/resource-resolver.ts` | 신규 |
| `src/commands/resource-resolver.test.ts` | 신규 |
| `src/commands/loadbalancer/helpers.ts` | 수정 |
| `src/services/network/types.ts` | 수정 |
| `src/services/network/client.ts` | 수정 |
| `src/services/network/client.test.ts` | 신규 |
