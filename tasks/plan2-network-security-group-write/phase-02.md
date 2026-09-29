# Phase 02. 보안그룹과 규칙 쓰기 명령

**Execution profile**: standard

## 목표

`network security-group create|update|delete`와 `network security-group rule create|delete`를 추가한다.
잘못된 입력과 위험한 삭제를 API 요청 전에 막는다.

**범위 외**: 인스턴스 연결 변경은 Phase 03, 사용자 가이드는 Phase 04다. 실제 API를 호출하지 않는다. `src/commands/apigateway/helpers.ts`의 같은 `requireYes`는 옮기지 않는다.

## 컨텍스트

- Phase 01이 추가한 것: `NetworkClient.createSecurityGroup`, `updateSecurityGroup`, `deleteSecurityGroup`, `createSecurityGroupRule`, `deleteSecurityGroupRule`, `listSecurityGroupRulesByRemoteGroup`, 타입 `CreateSecurityGroupRuleParams`.
- 기존 조회 명령: `src/commands/network/security-group.ts`(`list`, `get`, `ports`, `rule` 부착), `src/commands/network/security-group-rule.ts`(`rule list`, `rule get`, `ruleCommand` export).
- 공용 helper(`src/commands/network/helpers.ts`): `resolveSecurityGroupClients(opts)`, `resolveSecurityGroupId(client, value)`, `formatRulePorts`, `formatRuleRemote`, `withOptions(command)`.
- 이름·UUID 해석: `src/commands/resource-resolver.ts`의 `requireResourceInput(value, label)`.
- `--yes` 확인: `src/commands/loadbalancer/helpers.ts`의 `requireYes(yes, operation)`가 `"<operation>에는 --yes 플래그가 필요합니다."`를 `EXIT_PARAM_ERROR`로 던진다.
  이 함수를 `src/commands/resource-resolver.ts`로 옮기고 loadbalancer helpers는 `export { requireYes } from "../resource-resolver.js";`로 기존 export를 유지한다.
- 정수 옵션: `src/commands/parse-options.ts`의 `parseIntegerOption(value, flag, { min, max })`. `Number()`를 직접 쓰지 않는다.
- 쓰기 결과 출력 선례: `src/commands/loadbalancer/ipacl.ts`의 `deleteCommand`. `{ operation, status, <id> }` 객체를 `headers: ["field", "value"]`와 `raw`로 낸다.

**근거 문서**: `docs/adr/038-security-group-write-safety.md`, `docs/flow.md`의 「IaaS 흐름」 절

## 의도 메모

- 모든 옵션 파싱과 `requireYes`는 client 해석(`resolveSecurityGroupClients`)과 spinner보다 먼저 끝낸다.
- 규칙 교체는 원자적이지 않다. `rule create`와 `rule delete`의 help 설명 끝에 `(규칙 수정 API가 없어 교체는 생성 후 삭제로 한다)`를 넣는다.
- stderr 경고는 spinner를 닫은 뒤 출력한다. 경고에 넣는 서버 응답 값(그룹·규칙 UUID)은 `sanitizeForTerminal`(`src/utils/terminal.ts`)을 거친다.
- `GET /security-group-rules`가 `remote_group_id` 쿼리를 서버에서 적용하는지는 실측하지 않았다. 그래서 원격 참조 판정은 응답을 클라이언트에서 다시 거른다.

## 작업 항목

### 1. `src/commands/network/helpers.ts`에 규칙 입력 파서 추가

```ts
export interface ParsedRuleInput {
  direction: "ingress" | "egress";
  protocol?: string;
  portRangeMin?: number;
  portRangeMax?: number;
  cidr?: string;
  remoteGroup?: string;      // 해석 전 이름 또는 UUID
  description?: string;
}
export function parseRuleInput(opts: {
  direction?: string; protocol?: string; port?: string; portRange?: string;
  cidr?: string; remoteGroup?: string; description?: string;
}): ParsedRuleInput;
```

검증 순서와 오류(모두 `EXIT_PARAM_ERROR`, 입력은 `JSON.stringify`로 표기):

| 조건 | 오류 문구 |
|---|---|
| `direction`이 `ingress`·`egress`가 아님 | `--direction은 ingress 또는 egress여야 합니다: <값>` |
| `protocol`이 `tcp`·`udp`·`icmp`·`any`가 아님 | `--protocol은 tcp, udp, icmp, any 중 하나여야 합니다: <값>` (`any`는 요청에서 protocol을 뺀다) |
| `--port`와 `--port-range`를 함께 지정 | `--port와 --port-range는 함께 지정할 수 없습니다.` |
| 포트를 지정했는데 protocol이 `tcp`·`udp`가 아님 | `포트는 --protocol tcp 또는 udp와 함께 지정합니다.` |
| 포트가 1~65535 정수가 아님 | `parseIntegerOption(value, flag, { min: 1, max: 65535 })`의 기존 문구. `flag`는 `--port`이면 `"--port"`, `--port-range`의 시작·끝 값이면 둘 다 `"--port-range"` |
| `--port-range`가 `A-B` 형식이 아니거나 A > B | `--port-range는 시작-끝 형식이며 시작이 끝보다 클 수 없습니다: <값>` |
| `--cidr`와 `--remote-group`을 함께 지정 | `--cidr와 --remote-group은 함께 지정할 수 없습니다.` |
| `--cidr`가 IPv4 주소나 IPv4 CIDR(prefix 0~32)가 아님 | `--cidr는 IPv4 주소 또는 CIDR이어야 합니다: <값>` (`node:net`의 `isIP(address) === 4`) |

`--port N`은 min·max를 모두 N으로 둔다.

`ParsedRuleInput`을 `CreateSecurityGroupRuleParams`로 옮기는 대응은 다음과 같다. `protocol`이 `any`이면 `protocol` 키를 넣지 않는다.

| `ParsedRuleInput` | `CreateSecurityGroupRuleParams` |
|---|---|
| `direction` | `direction` |
| `protocol` (`any` 제외) | `protocol` |
| `portRangeMin`, `portRangeMax` | `port_range_min`, `port_range_max` |
| `cidr` | `remote_ip_prefix` |
| `remoteGroup` (UUID로 해석한 값) | `remote_group_id` |
| `description` | `description` |

### 2. `src/commands/resource-resolver.ts`로 `requireYes` 이동

본문과 문구는 바꾸지 않는다. loadbalancer helpers는 re-export한다.

### 3. `src/commands/network/security-group-manage.ts` 신규

`createCommand`, `updateCommand`, `deleteCommand`를 export하고 `security-group.ts`의 `securityGroupCommand`에 붙인다. 셋 다 `withOptions`를 쓴다.
`security-group.ts`의 `securityGroupCommand` description `보안그룹 조회`를 `보안그룹 조회와 변경`으로, `security-group-rule.ts`의 `ruleCommand` description `보안 규칙 조회`를 `보안 규칙 조회와 변경`으로 바꾼다.

이름 검증: `create --name`과 `update --name`의 값은 trim한 값을 보낸다. trim 결과가 비었으면 client 해석 전에 `--name은 비어 있을 수 없습니다.`를 `EXIT_PARAM_ERROR`로 던진다.

| 명령 | 옵션 | 동작 | 출력 |
|---|---|---|---|
| `create` | `--name <name>` 필수(`requiredOption`), `--description <text>` | 이름 검증 후 `createSecurityGroup` | 그룹 field/value(id, name, description, rules 개수), `raw` 그룹, `ids: [id]` |
| `update <group>` | `--name`, `--description` | 둘 다 없으면 `--name 또는 --description 중 하나는 필요합니다.`로 `EXIT_PARAM_ERROR`. 해석 후 `updateSecurityGroup` | create와 같음 |
| `delete <group>` | `--yes` | 아래 순서 | `{ operation: "security-group-delete", status: "succeeded", security_group_id }` |

`delete` 순서:

1. `requireYes(opts.yes, "보안그룹 삭제")`, `requireResourceInput(value, "보안그룹")`
2. client 해석 → spinner 시작 → `resolveSecurityGroupId`
3. `listSecurityGroupPorts(id)`가 비어 있지 않으면 spinner를 닫고 `보안그룹이 포트 <n>개에 연결되어 있어 삭제할 수 없습니다. 먼저 instance security-group remove로 연결을 해제하세요: <device_id 목록>`을 `EXIT_PARAM_ERROR`로 던진다.
4. `listSecurityGroupRulesByRemoteGroup(id)`에서 `rule.remote_group_id === id && rule.security_group_id !== id`인 규칙을 모은다.
5. `deleteSecurityGroup(id)` → spinner 종료
6. 4에서 모은 규칙이 있으면 `경고: 다른 보안그룹 규칙 <n>개가 이 그룹을 원격 그룹으로 참조했습니다: <security_group_id>/<rule id> 목록`을 stderr에 쓴다.

### 4. `src/commands/network/security-group-rule.ts`에 `create`, `delete` 추가

| 명령 | 옵션 | 동작 | 출력 |
|---|---|---|---|
| `rule create <group>` | `--direction <ingress\|egress>` 필수, `--protocol`, `--port`, `--port-range`, `--cidr`, `--remote-group`, `--description` | `parseRuleInput` → client 해석 → 그룹 해석, `--remote-group`이 있으면 같은 방식으로 해석 → `createSecurityGroupRule` | 기존 `rule get`과 같은 field/value, `raw` 규칙, `ids: [id]` |
| `rule delete <rule-id>` | `--yes` | `requireYes(opts.yes, "보안 규칙 삭제")`, `requireResourceInput(value, "보안 규칙")` → `deleteSecurityGroupRule` | `{ operation: "security-group-rule-delete", status: "succeeded", security_group_rule_id }` |

### 5. 테스트

`src/commands/network/helpers.test.ts` 신규: 작업 항목 1 표의 오류 행마다 한 건과, 정상 조합 넷(`--protocol tcp --port 22 --cidr 10.0.0.0/8`, `--protocol udp --port-range 1000-2000`, `--protocol icmp`, 옵션 없는 `--direction egress`)의 반환값.

`src/commands/network/security-group.test.ts`에 추가(기존 mock 방식 유지):

- `delete`에 `--yes`가 없으면 client 해석 전에 `EXIT_PARAM_ERROR`.
- 연결 포트가 있으면 `deleteSecurityGroup`을 부르지 않고 `EXIT_PARAM_ERROR`, 메시지에 `instance security-group remove`가 있다.
- 다른 그룹 규칙이 참조하면 삭제 후 stderr에 `경고: 다른 보안그룹 규칙 1개`가 나오고, 자기 그룹 규칙만 참조하면 경고가 없다.
- 서버가 `remote_group_id` 필터를 무시한 응답(다른 그룹을 원격 그룹으로 삼거나 `remote_group_id`가 `null`인 규칙 포함)을 흉내 내면, 삭제 대상 그룹을 참조하는 규칙만 경고 개수에 들어간다.
- `create --name "  "`는 client 해석 전에 `EXIT_PARAM_ERROR`.
- `update`에 옵션이 없으면 `EXIT_PARAM_ERROR`.
- `rule create`가 `--remote-group`을 UUID로 해석해 `remote_group_id`로 보낸다. `--cidr`와 함께 주면 client 해석 전에 거부한다.
- `rule delete`에 `--yes`가 없으면 `EXIT_PARAM_ERROR`.

## 검증

```bash
node_modules/.bin/vitest run src/commands/network/helpers.test.ts src/commands/network/security-group.test.ts src/commands/loadbalancer src/commands/resource-resolver.test.ts
pnpm tsc --noEmit
pnpm test
pnpm run build
node dist/index.js commands --json | jq -r '.commands[].path' | grep '^network security-group'
# create, update, delete, rule create, rule delete 가 추가로 나온다
grep -rnE "Number\(opts\." src/commands/network/   # 출력 없음
```

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/commands/network/helpers.ts` | 수정 |
| `src/commands/network/helpers.test.ts` | 신규 |
| `src/commands/network/security-group-manage.ts` | 신규 |
| `src/commands/network/security-group.ts` | 수정 |
| `src/commands/network/security-group-rule.ts` | 수정 |
| `src/commands/network/security-group.test.ts` | 수정 |
| `src/commands/resource-resolver.ts` | 수정 |
| `src/commands/loadbalancer/helpers.ts` | 수정 |
