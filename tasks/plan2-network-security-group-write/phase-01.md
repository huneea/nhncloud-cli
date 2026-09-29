# Phase 01. Network 쓰기 오류 변환과 service client 쓰기 메서드

**Execution profile**: standard

## 목표

보안그룹 쓰기 명령이 쓸 service 메서드와, 서버의 거부 사유를 사용자에게 보여 주는 오류 변환을 추가한다.

**범위 외**: Commander 명령은 Phase 02·03이 만든다. 실제 NHN Cloud API는 호출하지 않는다. 테스트는 `ky` mock으로만 한다.

## 컨텍스트

- `NetworkClient`(`src/services/network/client.ts`)의 `networkEndpoint`는 이미 `/v2.0`을 포함한다. 새 URL도 `${this.networkEndpoint}/security-groups`처럼 버전 없이 붙인다.
- 헤더는 `this.authHeaders()`(`X-Auth-Token`), 요청 옵션은 `retry: 0`, `timeout: DEFAULT_TIMEOUT_MS`다. 무본문 DELETE는 `deleteFloatingIp`를 따른다.
- 응답 가드 `isSecurityGroup`, `isSecurityGroupRule`과 타입 `SecurityGroup`, `SecurityGroupRule`은 같은 파일과 `src/services/network/types.ts`에 이미 있다. 재사용한다.
- `InstanceClient`(`src/services/instance/client.ts`)의 `private async serverAction(id, payload)`는 `POST /servers/{id}/action`을 202 무본문으로 호출한다. `start`, `stop`, `reboot`가 이것을 쓴다.
- 오류 변환의 선례는 `src/services/logncrash/errors.ts`의 `toLogncrashError`다. HTTP 오류 본문을 한 번 읽고, 나머지는 `toNhnCloudCliError`(`src/api/httpError.ts`)에 맡긴다. 401·403은 `EXIT_AUTH_ERROR`, 그 밖은 `EXIT_API_ERROR`다.

**근거 문서**: `docs/adr/038-security-group-write-safety.md`, `docs/code-architecture.md`의 「명령 실행 경계」 절, `docs/flow.md`의 「IaaS 흐름」 절

### 실측한 쓰기 응답 (2026-09-29, 일반망 kr1)

| 요청 | 결과 |
|---|---|
| `POST /security-groups` | 201, `{ security_group }`. 송신 규칙 IPv4·IPv6 두 개가 자동으로 들어 있다 |
| `PUT /security-groups/{id}` | 200, `{ security_group }` |
| `DELETE /security-groups/{id}`, `DELETE /security-group-rules/{id}` | 204 무본문 |
| `POST /security-group-rules` | 201, `{ security_group_rule }` |
| 규칙 거부 | 400, 본문 `{"NeutronError": {"message": "...", "type": "...", "detail": ""}}` |
| 없는 규칙 삭제 | 404, 같은 형태의 본문 |

실측한 `NeutronError.message` 예: `Only remote_ip_prefix or remote_group_id may be provided.`, `Must also specify protocol if port range is given.`

## 의도 메모

- 오류 변환은 쓰기 메서드에만 적용한다. 조회 메서드의 오류 문구는 바꾸지 않는다.
- 서버 메시지는 터미널 제어 문자를 제거한 뒤 붙인다(`sanitizeForTerminal`, `src/utils/terminal.ts`).
- 본문이 JSON이 아니거나 `NeutronError.message`가 없으면 공용 변환 결과를 그대로 쓴다.

## Blocked 조건

- 구현 중 실제 API 호출이 필요하다고 판단되면 호출하지 말고 `PHASE_BLOCKED: 실호출 필요`를 출력하고 종료한다.

## 작업 항목

### 1. `src/services/network/errors.ts` 신규

```ts
export async function toNetworkWriteError(err: unknown): Promise<NhnCloudCliError>;
```

- `err`가 `HTTPError`이면 `err.response.json()`을 시도해 `NeutronError.message`가 string이면 기본 변환 메시지 뒤에 `\n서버 응답: <sanitize 한 message>`를 붙인다. 종료 코드는 `toNhnCloudCliError(err).exitCode`를 유지한다.
- 그 밖은 `toNhnCloudCliError(err)`를 반환한다.

### 2. `src/services/network/client.ts`에 쓰기 메서드 추가

| 메서드 | 요청 | 반환 |
|---|---|---|
| `createSecurityGroup(params: { name: string; description?: string }): Promise<SecurityGroup>` | `POST /security-groups`, `json: { security_group: params }` | `security_group` 가드 통과 객체 |
| `updateSecurityGroup(id: string, params: { name?: string; description?: string }): Promise<SecurityGroup>` | `PUT /security-groups/{id}`, `json: { security_group: params }` | 같음 |
| `deleteSecurityGroup(id: string): Promise<void>` | `DELETE /security-groups/{id}` | 없음 |
| `createSecurityGroupRule(params: CreateSecurityGroupRuleParams): Promise<SecurityGroupRule>` | `POST /security-group-rules`, `json: { security_group_rule: { ...params, ethertype: "IPv4" } }` | `security_group_rule` 가드 통과 객체 |
| `deleteSecurityGroupRule(id: string): Promise<void>` | `DELETE /security-group-rules/{id}` | 없음 |
| `listSecurityGroupRulesByRemoteGroup(remoteGroupId: string): Promise<SecurityGroupRule[]>` | `GET /security-group-rules`, `searchParams: { remote_group_id }` | `security_group_rules` 배열 |

- id 경로 조각은 `encodeURIComponent`로 감싼다.
- 쓰기 메서드 다섯 개의 `catch`는 `throw await toNetworkWriteError(err)`다. 가드 실패 오류(`NhnCloudCliError`)는 그대로 통과한다.
- `listSecurityGroupRulesByRemoteGroup`은 조회라 기존 `listSecurityGroupRules`처럼 `toNhnCloudCliError`를 쓴다. `limit`를 넣지 않는다.
- `src/services/network/types.ts`에 추가한다:

```ts
export interface CreateSecurityGroupRuleParams {
  security_group_id: string;
  direction: "ingress" | "egress";
  protocol?: string;
  port_range_min?: number;
  port_range_max?: number;
  remote_ip_prefix?: string;
  remote_group_id?: string;
  description?: string;
}
```

값이 `undefined`인 키는 요청 본문에서 빠져야 한다(`ky`의 JSON 직렬화가 `undefined` 키를 버리는지 테스트로 확인한다).

### 3. `src/services/instance/client.ts`에 연결 메서드 추가

```ts
async addSecurityGroup(id: string, groupName: string): Promise<void>     // serverAction(id, { addSecurityGroup: { name: groupName } })
async removeSecurityGroup(id: string, groupName: string): Promise<void>  // serverAction(id, { removeSecurityGroup: { name: groupName } })
```

### 4. 테스트 `src/services/network/errors.test.ts` 신규

- 400 `HTTPError`에 `NeutronError.message`가 있으면 메시지에 `서버 응답: Only remote_ip_prefix or remote_group_id may be provided.`가 들어가고 종료 코드는 `EXIT_API_ERROR`다.
- 403은 `EXIT_AUTH_ERROR`를 유지한다.
- 본문이 JSON이 아니면 공용 변환 메시지와 같다.
- message 안의 ANSI escape(`\u001b[31m`)가 제거된다.

### 5. 테스트 `src/services/network/client.test.ts`에 추가

- 메서드 여섯 개의 URL·HTTP 메서드·본문을 단언한다. 규칙 생성 본문에 `ethertype: "IPv4"`가 들어가고 `undefined` 키가 없다.
- 규칙 생성 400 거부가 `서버 응답:`을 담은 오류로 바뀐다.
- 원격 그룹 조회는 `searchParams`에 `remote_group_id`만 담는다.

### 6. 테스트 `src/services/instance/client.test.ts` 신규

`ky`를 mock하고 `addSecurityGroup`·`removeSecurityGroup`이 `POST <compute>/servers/<id>/action`에 각각 `{ addSecurityGroup: { name } }`, `{ removeSecurityGroup: { name } }`을 보내는지 단언한다.

## 검증

```bash
node_modules/.bin/vitest run src/services/network/errors.test.ts src/services/network/client.test.ts src/services/instance/client.test.ts
pnpm tsc --noEmit
pnpm test
grep -c 'networkEndpoint}/v2' src/services/network/client.ts   # 0
```

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/services/network/errors.ts` | 신규 |
| `src/services/network/errors.test.ts` | 신규 |
| `src/services/network/client.ts` | 수정 |
| `src/services/network/client.test.ts` | 수정 |
| `src/services/network/types.ts` | 수정 |
| `src/services/instance/client.ts` | 수정 |
| `src/services/instance/client.test.ts` | 신규 |
