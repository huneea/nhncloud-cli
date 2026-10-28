# Phase 01. Private DNS region 판정과 서비스 client

**Execution profile**: standard

## 목표

Private DNS API(`/v2.0/privatedns/zones` 아래 zone 과 레코드 세트)를 부르는 `PrivateDnsClient` 와 응답 타입, 지원 region 판정 함수를 만든다.
명령 계층(phase 02~04)이 이 client 만 거쳐 API 를 부르게 하기 위해서다.

**범위 외**: 명령, 이름 해석, 병합 로직(phase 02~04), 사용자 문서(phase 05).

## 컨텍스트

- 인증과 endpoint 는 기존 IaaS 경계를 그대로 쓴다. `src/api/keystone.ts:83` 이 `networkEndpoint = https://${networkHost(region, environment)}/v2.0` 을 만든다.
  **`networkEndpoint` 는 이미 `/v2.0` 으로 끝난다.** client 는 `${networkEndpoint}/privatedns/zones` 처럼 붙이고 `/v2.0` 을 다시 붙이지 않는다(`docs/pitfalls/plan/endpoint-version-double-prefix.md`).
- 따를 패턴: `src/services/network/client.ts` 의 `NetworkClient`(생성자 `(tokenId, networkEndpoint)`, `X-Auth-Token` 헤더, `retry: 0`, `timeout: DEFAULT_TIMEOUT_MS`, 응답 가드 실패 시 `NhnCloudCliError(..., EXIT_API_ERROR)`, 조회 오류는 `toNhnCloudCliError`, 쓰기 오류는 `toNetworkWriteError`).
- `toNetworkWriteError`(`src/services/network/errors.ts`)는 400·409 응답의 `NeutronError.message` 를 덧붙인다. Private DNS 도 같은 오류 본문을 쓴다(실측: 없는 zone 은 HTTP 404 `{"NeutronError": {"message": "...", "type": "ZoneNotFound"}}`).
- region 판정 함수는 `src/api/endpoints.ts` 에 둔다. 같은 파일의 `ncrHost` 가 공공망 kr1 외 region 을 `EXIT_PARAM_ERROR` 로 거부하는 방식과 문구를 따른다.

**근거 문서**: `docs/adr/049-privatedns-write-merge-and-protection.md`(응답 실측, region), `docs/flow.md` 의 「Private DNS」 절(pagination), `docs/adr/037-gov-profile-endpoints.md` 의 privatedns 행, `docs/code-architecture.md` 의 「인증과 endpoint 조합」.

실측으로 확정한 응답 형태(2026-10-28, 공공망 kr1). 공식 문서 예시와 다르므로 아래를 따른다.

| 요청 | 응답 최상위 키 |
|---|---|
| `GET /privatedns/zones` | `zones`(배열). `limit` 을 주었을 때만 `zones_links` |
| `GET /privatedns/zones/{zoneId}` | `zone`(객체). 문서의 `zones` 배열이 아니다 |
| `POST`, `PUT /privatedns/zones...` | `zone`(객체) |
| `GET /privatedns/zones/{zoneId}/rrsets` | `rrsets`(배열), `limit` 을 주었을 때만 `rrsets_links` |
| `GET`, `POST`, `PUT /privatedns/zones/{zoneId}/rrsets/{rrsetId}` | `rrset`(객체) |
| `DELETE` 둘 | 본문 없음 |

- 시각 필드는 `2026-10-07T06:52:06Z` 형식 문자열이다. 가드는 문자열인지만 본다.
- `description` 은 `null` 일 수 있다(SOA·NS 시스템 레코드). zone 의 `rrset_count` 는 목록과 단건 조회에만 있고 생성·수정 응답에는 없을 수 있다.
- `*_links` 예: `[{"href": "https://<host>/v2.0/privatedns/zones/<zone-id>/rrsets?marker=<rrset-id>&limit=2", "rel": "next"}, {"href": "...", "rel": "previous"}]`.
- 응답의 `tenant_id`, `project_id` 는 문서에 없는 필드라 타입에 넣지 않는다.

## 의도 메모

- pagination: 첫 요청에는 `limit` 을 넣지 않는다(실측: 이때 전체가 오고 `*_links` 가 없다). 그래도 응답에 `rel: "next"` 가 있으면 첫 요청의 필터 쿼리(`name`, `type`)를 그대로 유지하고, 그 href 에서 꺼낸 `marker`(그리고 있으면 `limit`)만 더해 같은 경로로 다시 보낸다. 필터를 빼면 둘째 페이지부터 거르지 않은 결과가 섞인다. href 주소 자체로 요청하지 않는다. 토큰을 응답이 준 다른 host 로 보내지 않기 위해서다.
- 같은 marker 가 반복되면 무한 반복을 막기 위해 `EXIT_API_ERROR` 로 끝낸다. `next` href 에 `marker` 가 없어도 `EXIT_API_ERROR` 다.
- 쓰기(POST·PUT·DELETE)가 시간 초과(`ky` 의 `TimeoutError`)나 연결 오류(`HTTPError`·`NhnCloudCliError` 가 아닌 `Error`)로 실패하면 서버 반영 여부를 알 수 없다(`docs/flow.md` 「Private DNS 쓰기」 의 「반영 여부 불명, list 로 확인 안내」). 이때는 `toNetworkWriteError` 결과 메시지 뒤에 줄을 바꿔 zone 쓰기면 `요청이 반영됐는지 알 수 없습니다. nhncloud privatedns zone list 로 확인한 뒤 다시 실행하세요.`, 레코드 세트 쓰기면 `요청이 반영됐는지 알 수 없습니다. nhncloud privatedns record list <zone> 으로 확인한 뒤 다시 실행하세요.` 를 덧붙인다. 종료 코드는 그대로 둔다. HTTP 오류 응답(4xx·5xx)에는 덧붙이지 않는다.
- 생성 요청에서 선택 필드는 `undefined` 면 본문에서 뺀다(`NetworkClient` 의 `omitUndefined` 와 같은 처리, 같은 이름의 지역 함수를 새 파일에 둔다). 단 레코드 세트의 `description` 은 공식 문서가 필수로 적으므로 명령 계층이 늘 문자열을 넘긴다.
- 기각: `NetworkClient` 에 메서드를 더하기. 이미 434줄이고 Private DNS 는 독립 리소스라 별도 서비스 디렉터리(`src/services/privatedns/`)에 둔다.

## 작업 항목

### 1. `src/api/endpoints.ts` 에 `assertPrivateDnsRegion` 추가

```ts
export function assertPrivateDnsRegion(region: string, environment: CloudEnvironment = "real"): void
```

- 일반망 허용: `kr1`, `kr2`, `kr3`. 위반 문구: `지원하지 않는 Private DNS region 입니다: "${region}". 사용 가능한 region: kr1, kr2, kr3`
- 공공망 허용: `kr1`. 위반 문구: `지원하지 않는 공공망 Private DNS region 입니다: "${region}". 사용 가능한 region: kr1`
- 둘 다 `NhnCloudCliError(message, EXIT_PARAM_ERROR)`. 허용 목록은 파일 안의 상수 하나로 둔다.

### 2. `src/services/privatedns/types.ts` 신규

```ts
export const PRIVATE_DNS_RECORD_TYPES = ["A", "AAAA", "CAA", "CNAME", "MX", "NAPTR", "NS", "PTR", "SOA", "SPF", "SRV", "TXT"] as const;
export type PrivateDnsRecordType = (typeof PRIVATE_DNS_RECORD_TYPES)[number];

export interface PrivateDnsZone {
  id: string; name: string; description: string | null; status: string;
  networks: string[]; created_at: string; updated_at: string; rrset_count?: number;
}
export interface PrivateDnsRecord { content: string }
export interface PrivateDnsRecordSet {
  id: string; name: string; description: string | null; zone_id: string;
  ttl: number; type: string; records: PrivateDnsRecord[]; created_at: string; updated_at: string;
}
export interface CreatePrivateDnsZoneParams { name: string; description?: string; networks: string[] }
export interface UpdatePrivateDnsZoneParams { description: string; networks: string[] }
export interface CreatePrivateDnsRecordSetParams {
  name: string; type: string; records: PrivateDnsRecord[]; ttl?: number; description: string;
}
export interface UpdatePrivateDnsRecordSetParams {
  type: string; records: PrivateDnsRecord[]; ttl: number; description: string;
}
```

`type` 을 응답 타입에서 `string` 으로 두는 이유: 서버가 목록 밖 타입을 돌려줘도 조회는 실패하지 않게 하기 위해서다.

### 3. `src/services/privatedns/client.ts` 신규: `PrivateDnsClient`

생성자 `(tokenId: string, networkEndpoint: string)`. 메서드와 경로(모두 `${networkEndpoint}` 뒤에 붙인다, ID 는 `encodeURIComponent`).

| 메서드 | 요청 | 반환 |
|---|---|---|
| `listZones(filters?: { name?: string })` | `GET /privatedns/zones`(`name` 이 있으면 쿼리) | `PrivateDnsZone[]`(모든 페이지) |
| `getZone(zoneId)` | `GET /privatedns/zones/{zoneId}` | `zone` |
| `createZone(params: CreatePrivateDnsZoneParams)` | `POST /privatedns/zones`, 본문 `{ zone: omitUndefined(params) }` | `zone` |
| `updateZone(zoneId, params: UpdatePrivateDnsZoneParams)` | `PUT /privatedns/zones/{zoneId}`, 본문 `{ zone: params }` | `zone` |
| `deleteZone(zoneId)` | `DELETE /privatedns/zones/{zoneId}` | `void` |
| `listRecordSets(zoneId, filters?: { name?: string; type?: string })` | `GET /privatedns/zones/{zoneId}/rrsets` | `PrivateDnsRecordSet[]`(모든 페이지) |
| `getRecordSet(zoneId, rrsetId)` | `GET .../rrsets/{rrsetId}` | `rrset` |
| `createRecordSet(zoneId, params: CreatePrivateDnsRecordSetParams)` | `POST .../rrsets`, 본문 `{ rrset: omitUndefined(params) }` | `rrset` |
| `updateRecordSet(zoneId, rrsetId, params: UpdatePrivateDnsRecordSetParams)` | `PUT .../rrsets/{rrsetId}`, 본문 `{ rrset: params }` | `rrset` |
| `deleteRecordSet(zoneId, rrsetId)` | `DELETE .../rrsets/{rrsetId}` | `void` |

- 응답 가드 `isZone`, `isRecordSet`: 위 타입의 필수 필드를 모두 검사한다(`description` 은 `string | null`, `networks` 는 문자열 배열, `records` 는 `content` 가 문자열인 객체 배열, `rrset_count` 는 있으면 number).
- 가드 실패 문구 형식: `privatedns zone list 응답 형식이 올바르지 않습니다 — zones 배열이 없습니다.` / `privatedns zone get 응답 형식이 올바르지 않습니다 — zone 객체가 없습니다.` / record 쪽은 `privatedns record ...`, `rrsets 배열`, `rrset 객체`. 종료 코드 `EXIT_API_ERROR`.
- 조회 메서드의 catch 는 `throw toNhnCloudCliError(err)`, 쓰기(POST·PUT·DELETE)의 catch 는 지역 함수 `toPrivateDnsWriteError(err, target: "zone" | "record")` 를 거쳐 던진다. 이 함수는 `await toNetworkWriteError(err)` 결과에 「의도 메모」 의 반영 여부 불명 안내를 시간 초과·연결 오류일 때만 덧붙인다.
- 목록 두 메서드는 지역 함수 `nextMarker(raw, linksKey): { marker: string; limit?: string } | null` 와 반복 루프로 모든 페이지를 모은다. 규칙은 「의도 메모」 대로다.

### 4. 이 phase 를 검증하는 테스트

- `src/api/gov-endpoints.test.ts` 에 `assertPrivateDnsRegion` 케이스: 일반망 `kr1`·`kr2`·`kr3` 통과, 일반망 `jp1` 거부, 공공망 `kr1` 통과, 공공망 `kr2` 거부. 거부는 `exitCode` 가 `EXIT_PARAM_ERROR` 이고 메시지에 허용 목록이 있다.
- `src/services/privatedns/client.test.ts` 신규. `src/services/network/client.test.ts` 처럼 `ky` 의 `get`·`post`·`put`·`delete` 를 `vi.mock` 한다. endpoint 는 `https://kr1-api-network-infrastructure.nhncloudservice.com/v2.0`.
  - 열 메서드가 부르는 URL 이 `/v2.0/v2.0` 없이 위 표의 경로와 같다. POST·PUT 은 `json` 옵션 본문이 `{ zone: ... }`·`{ rrset: ... }` 이고 `createZone` 의 `description` 이 `undefined` 면 키가 없다.
  - `getZone` 이 `{ zone: {...} }` 를 받아 객체를 돌려주고, `{ zones: [...] }` 를 받으면 `EXIT_API_ERROR`.
  - `description: null` 인 SOA 레코드 세트가 가드를 통과한다.
  - `listRecordSets(zoneId, { type: "A" })` 첫 응답에 `rrsets_links` 의 `rel: "next"`(`marker=r2&limit=1`)가 있으면 두 번째 `ky.get` 의 `searchParams` 가 `type: "A"`, `marker: "r2"`, `limit: "1"` 을 모두 담고, 두 응답의 레코드를 합쳐 돌려준다. 두 번째 요청 URL 은 href 의 host 가 아니라 생성자 endpoint 다.
  - 같은 marker 가 두 번 오면 `EXIT_API_ERROR`.
  - `rel: "next"` href 에 `marker` 가 없으면 `EXIT_API_ERROR`.
  - `createRecordSet` 이 `TimeoutError` 로 실패하면 메시지에 `요청이 반영됐는지 알 수 없습니다` 와 `privatedns record list` 가 들어가고, HTTP 400 실패에는 이 문장이 없다. `deleteZone` 의 연결 오류(`new Error("fetch failed")`)는 `privatedns zone list` 안내를 단다.
  - `createRecordSet` 이 HTTP 400 `{"NeutronError": {"message": "Invalid record"}}` 를 받으면 오류 메시지에 `서버 응답: Invalid record` 가 들어간다(`HTTPError` 생성 방식은 `src/services/network/errors.test.ts` 를 따른다).

## 검증

```bash
node_modules/.bin/vitest run src/api/gov-endpoints.test.ts src/services/privatedns/client.test.ts
node_modules/.bin/tsc --noEmit
! grep -n '/v2.0/privatedns' src/services/privatedns/client.ts
git diff --check
```

기대값: 테스트 통과, 타입 오류 0, grep 결과 없음(종료 코드 0).

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/api/endpoints.ts` | 수정 |
| `src/api/gov-endpoints.test.ts` | 수정 |
| `src/services/privatedns/types.ts` | 신규 |
| `src/services/privatedns/client.ts` | 신규 |
| `src/services/privatedns/client.test.ts` | 신규 |
