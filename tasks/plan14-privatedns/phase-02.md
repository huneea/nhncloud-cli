# Phase 02. 쓰기 확인 공용화와 Private DNS 명령 도우미

**Execution profile**: standard

## 목표

`--yes`/`--dry-run` 확인과 미리보기 출력을 Load Balancer 전용 파일에서 공용 파일로 옮기고, Private DNS 명령이 함께 쓸 이름 해석·보호·병합 도우미를 만든다.
phase 03(zone 명령)과 phase 04(record 명령)가 같은 규칙을 한 곳에서 가져가게 하기 위해서다.

**범위 외**: Commander 명령 정의와 `src/index.ts` 등록(phase 03, 04), 사용자 문서(phase 05).

## 컨텍스트

- 현재 `requireWriteMode`, `PlannedRequest`, `outputDryRun` 은 `src/commands/loadbalancer/lbaas-helpers.ts` 에 있다(`requireWriteMode` 50행, `outputDryRun` 83행, `PlannedRequest` 의 `method` 는 `"POST" | "DELETE"`). Load Balancer 명령 다섯 파일(`listener.ts`, `pool.ts`, `healthmonitor.ts`, `l7policy.ts`, `certificate.ts`)과 `lbaas-commands.test.ts` 가 `./lbaas-helpers.js` 에서 가져온다.
- 이름 또는 UUID 해석은 `src/commands/resource-resolver.ts` 의 `requireResourceInput`, `resolveFromList` 를 재사용한다. `resolveFromList` 는 UUID 일치 → 이름이 하나 → 없음/중복 오류(후보 UUID) 순서다.
- IaaS 토큰 해석은 `src/commands/iaas.ts` 의 `resolveIaasTokenContext(opts)` 이고, 그 안에서 `resolveProfileName`, `getIaasCredential`, `getProfileEnvironment`(`src/config/credentials.ts`)를 부른다. region 판정은 토큰 발급 **전에** 해야 한다(ADR-037: 주소가 없는 region 은 API 호출 전에 거부).
- VPC 이름 해석은 `NetworkClient.listVpcs()`(`src/services/network/client.ts`, `Vpc` 는 `id`, `name` 을 가진다)를 쓴다. 같은 Keystone 토큰으로 `new NetworkClient(tokenId, networkEndpoint)` 를 만든다(`src/commands/network/helpers.ts` 의 `resolveSecurityGroupClients` 패턴).
- `assertPrivateDnsRegion`(`src/api/endpoints.ts`)과 `PrivateDnsClient`, 타입(`src/services/privatedns/`)은 phase 01 이 만들었다.

**근거 문서**: `docs/adr/049-privatedns-write-merge-and-protection.md`, `docs/flow.md` 의 「Private DNS」·「Private DNS 쓰기」 절, `docs/code-architecture.md` 의 「명령 실행 경계」(`src/commands/write-mode.ts`, `src/commands/privatedns/helpers.ts` 의 책임).

## 의도 메모

- `lbaas-helpers.ts` 에서는 옮긴 정의를 지우고 `export { requireWriteMode, outputDryRun, type PlannedRequest } from "../write-mode.js";` 로 다시 내보낸다. Load Balancer 명령 파일과 테스트의 import 를 바꾸지 않아 이 phase 의 변경 범위를 줄인다. `WriteGlobalOpts` 는 `lbaas-helpers.ts` 에 남기되 `WriteModeOpts` 를 확장하게 바꾼다.
- `requireWriteMode` 의 오류 문구(`...에는 --yes 플래그가 필요합니다. 보낼 요청만 보려면 --dry-run 을 쓰세요.`)와 `outputDryRun` 의 출력 형태(`headers: ["method", "path", "body"]`, `raw: { operation, dry_run: true, requests }`, `ids: []`)는 한 글자도 바꾸지 않는다. `lbaas-commands.test.ts` 가 이 문구를 단언한다.
- 레코드 이름 비교는 대소문자를 구분하지 않는다(DNS 이름 규칙). zone 이름도 같다.
- 기각: `resolveFromList` 를 레코드 세트에 그대로 쓰기. 같은 이름에 타입이 다른 레코드 세트가 정상적으로 공존해서, 타입으로 좁히고 후보를 `타입:UUID` 로 보여 줘야 한다.

## 작업 항목

### 1. `src/commands/write-mode.ts` 신규

```ts
export interface WriteModeOpts { yes?: boolean; dryRun?: boolean }
export interface PlannedRequest { method: "POST" | "PUT" | "DELETE"; path: string; body?: unknown }
export function requireWriteMode(opts: WriteModeOpts, operation: string): boolean
export function outputDryRun(opts: OutputOptions, operation: string, requests: PlannedRequest[]): void
```

본문은 `lbaas-helpers.ts` 의 현재 구현을 그대로 옮긴다. `method` 에 `"PUT"` 만 더한다.

### 2. `src/commands/loadbalancer/lbaas-helpers.ts` 수정

옮긴 세 정의를 지우고 위 「의도 메모」 대로 다시 내보낸다. `WriteGlobalOpts` 는 `extends LbaasGlobalOpts, WriteModeOpts` 로 바꾼다. 쓰지 않게 된 import 는 지운다.

### 3. `src/commands/privatedns/helpers.ts` 신규

```ts
export interface PrivateDnsGlobalOpts extends OutputOptions { region?: string; profile?: string }
export interface PrivateDnsWriteOpts extends PrivateDnsGlobalOpts, WriteModeOpts {}

export async function resolvePrivateDnsClients(opts: IaasResolverOpts): Promise<{ dns: PrivateDnsClient; network: NetworkClient; profileName: string }>
export function withPrivateDnsOptions(command: Command): Command
export function normalizeZoneName(input: string): string
export async function resolveZone(client: Pick<PrivateDnsClient, "listZones">, input: string): Promise<PrivateDnsZone>
export function toRecordName(input: string, zoneName: string): string
export function parseRecordType(value: string): PrivateDnsRecordType
export async function resolveRecordSet(client: Pick<PrivateDnsClient, "listRecordSets">, zone: PrivateDnsZone, input: string, type?: PrivateDnsRecordType): Promise<PrivateDnsRecordSet>
export function isProtectedRecordSet(rrset: Pick<PrivateDnsRecordSet, "name" | "type">, zoneName: string): boolean
export function assertWritableRecordSet(rrset: Pick<PrivateDnsRecordSet, "name" | "type">, zoneName: string): void
export function countUserRecordSets(rrsets: Pick<PrivateDnsRecordSet, "name" | "type">[], zoneName: string): number
export function mergeRecordSetUpdate(current: PrivateDnsRecordSet, change: { records?: string[]; ttl?: number; description?: string }): UpdatePrivateDnsRecordSetParams
export function mergeZoneNetworks(current: string[], change: { replace?: string[]; add?: string[]; remove?: string[] }): string[]
export async function resolveVpcIds(network: Pick<NetworkClient, "listVpcs">, inputs: string[]): Promise<string[]>
```

규칙(모든 입력 오류는 `NhnCloudCliError(message, EXIT_PARAM_ERROR)`):

- `resolvePrivateDnsClients`: `resolveProfileName(opts.profile)` → `getIaasCredential` 의 region(또는 `opts.region`) → `getProfileEnvironment` → `assertPrivateDnsRegion(region, environment)` → `resolveIaasTokenContext(opts)` → `new PrivateDnsClient(tokenId, networkEndpoint)`, `new NetworkClient(tokenId, networkEndpoint)`.
- `withPrivateDnsOptions`: `--region <region>`(설명 `region override (기본: iaas 자격증명의 region)`)과 `--profile <name>`(설명 `사용할 profile 이름`)을 붙인다.
- `normalizeZoneName`: 앞뒤 공백을 지우고, 비면 `Private DNS zone 이름이 비어 있습니다.`, 끝이 `.` 이 아니면 `.` 를 붙인다.
- `resolveZone`: `requireResourceInput(input, "Private DNS zone")` 뒤 `listZones()` 전체에서 UUID 가 정확히 같으면 그 zone. 아니면 `normalizeZoneName(input).toLowerCase()` 와 `zone.name.toLowerCase()` 가 같은 zone 을 고른다. 하나면 반환하고, 없거나 둘 이상이면 `resolveFromList` 와 같은 문구(`Private DNS zone을(를) 찾을 수 없습니다: ...`, `Private DNS zone 이름이 중복됩니다: ... (후보 UUID: ...)`)로 끝낸다.
- `toRecordName`: 앞뒤 공백을 지운 값이 비면 `레코드 세트 이름이 비어 있습니다.`. `@` 면 `zoneName`, 끝이 `.` 이면 그대로, 아니면 `${input}.${zoneName}`(zoneName 은 끝이 `.` 인 정규화된 값).
- `parseRecordType`: 대문자로 바꿔 `PRIVATE_DNS_RECORD_TYPES` 에 있으면 반환. 없으면 `--type은 A, AAAA, CAA, CNAME, MX, NAPTR, NS, PTR, SOA, SPF, SRV, TXT 중 하나여야 합니다: "<입력>"`.
- `resolveRecordSet`: `listRecordSets(zone.id)` 에서 UUID 가 정확히 같으면 그것(타입 인자가 있고 다르면 찾을 수 없음 오류). 아니면 `toRecordName(input, zone.name)` 과 이름이 같은(대소문자 무시) 것 가운데 `type` 이 주어지면 그 타입만 남긴다. 0개면 `레코드 세트를 찾을 수 없습니다: "<입력>"`. 2개 이상이면 `이름이 같은 레코드 세트가 N개 있습니다: <FQDN> (후보: A:<uuid>, TXT:<uuid>). --type 으로 고르세요.`
- `isProtectedRecordSet`: `type === "SOA"` 이거나, `type === "NS"` 이면서 이름이 zone 이름과 같다(대소문자 무시).
- `assertWritableRecordSet`: 보호 대상이면 `SOA 와 zone apex NS 레코드 세트는 바꾸거나 지울 수 없습니다: <type> <name>`.
- `countUserRecordSets`: 보호 대상이 아닌 개수.
- `mergeRecordSetUpdate`: `{ type: current.type, records: change.records ? change.records.map((content) => ({ content })) : current.records.map(({ content }) => ({ content })), ttl: change.ttl ?? current.ttl, description: change.description ?? current.description ?? "" }`.
- `mergeZoneNetworks`(입력은 이미 UUID): `replace` 와 `add`·`remove` 를 함께 주면 `--network는 --add-network, --remove-network와 함께 쓸 수 없습니다.`. `replace` 가 있으면 중복을 지운 그 목록. 아니면 현재 목록에서 `remove` 를 빼고(현재 목록에 없는 UUID 가 있으면 `연결되지 않은 VPC 입니다: <uuid>`) `add` 를 중복 없이 뒤에 더한다. 결과가 비면 `zone 에는 VPC 가 하나 이상 연결되어야 합니다.`.
- `resolveVpcIds`: `listVpcs()` 를 한 번만 부르고 입력마다 `resolveFromList(vpcs, requireResourceInput(input, "VPC"), "VPC")`.

### 4. 이 phase 를 검증하는 테스트

- `src/commands/write-mode.test.ts` 신규: `requireWriteMode` 가 `dryRun` 이면 `true`, `yes` 만 있으면 `false`, 둘 다 없으면 `EXIT_PARAM_ERROR` 와 `--dry-run` 이 든 메시지. `outputDryRun` 은 `../formatters/table.js` 의 `output` 을 mock 해 `raw.dry_run === true`, `ids` 가 빈 배열인지 본다.
- `src/commands/privatedns/helpers.test.ts` 신규:
  - `normalizeZoneName("example.net")` → `example.net.`, 빈 값 오류.
  - `resolveZone`: UUID 일치, `Example.NET` 입력이 `example.net.` 에 일치, 같은 이름 둘이면 중복 오류.
  - `toRecordName`: `www`·`@`·`www.example.net.` 세 입력.
  - `parseRecordType("cname")` → `CNAME`, `"ALIAS"` 는 오류.
  - `resolveRecordSet`: 같은 이름의 A·TXT 가 있을 때 타입 없이 고르면 후보 `A:`, `TXT:` 가 든 오류, `A` 를 주면 A 반환.
  - `isProtectedRecordSet`: SOA 는 보호, apex NS 보호, `sub.example.net.` 의 NS 는 보호 아님.
  - `mergeRecordSetUpdate`: `ttl` 만 주면 records·type·description 보존, `description: null` 이면 `""`.
  - `mergeZoneNetworks`: add 중복 무시, 없는 VPC remove 오류, 결과 빈 목록 오류, replace 와 add 동시 오류.
  - `resolvePrivateDnsClients`: `../../config/credentials.js` 와 `../iaas.js` 를 mock 해 공공망 `kr2` 면 `EXIT_PARAM_ERROR` 이고 `resolveIaasTokenContext` 가 불리지 않는다. 일반망 `kr1` 이면 `resolveIaasTokenContext` 가 불리고, 돌려준 `dns`·`network` 가 그 `networkEndpoint` 로 요청한다(`ky.get` mock 의 URL 이 `networkEndpoint` 로 시작).
- 기존 `src/commands/loadbalancer/lbaas-commands.test.ts` 가 바꾸지 않고 통과한다.

## 검증

```bash
node_modules/.bin/vitest run src/commands/write-mode.test.ts src/commands/privatedns/helpers.test.ts src/commands/loadbalancer
node_modules/.bin/tsc --noEmit
! grep -n "export function requireWriteMode\|export function outputDryRun" src/commands/loadbalancer/lbaas-helpers.ts
git diff --check
```

기대값: 테스트 통과(Load Balancer 테스트 포함), 타입 오류 0, grep 결과 없음.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/commands/write-mode.ts` | 신규 |
| `src/commands/write-mode.test.ts` | 신규 |
| `src/commands/loadbalancer/lbaas-helpers.ts` | 수정 |
| `src/commands/privatedns/helpers.ts` | 신규 |
| `src/commands/privatedns/helpers.test.ts` | 신규 |
