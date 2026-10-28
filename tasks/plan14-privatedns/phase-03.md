# Phase 03. `privatedns zone` 명령

**Execution profile**: standard

## 목표

`nhncloud privatedns zone list|get|create|update|delete` 를 만들고 최상위 `privatedns` 명령으로 등록한다.
레코드 세트 명령(phase 04)이 고를 zone 을 찾고, VPC 연결을 콘솔 없이 바꾸기 위해서다.

**범위 외**: `privatedns record` 명령(phase 04), README·스킬 문서(phase 05).

## 컨텍스트

- 따를 명령 패턴: `src/commands/loadbalancer/listener.ts`(쓰기에 `requireWriteMode` → 이름 해석 → `--dry-run` 이면 `outputDryRun` → 아니면 spinner 안에서 쓰기), `src/commands/network/security-group-manage.ts`(검증 → client 해석 → spinner → 출력 순서).
- 이 phase 가 쓰는 도우미(phase 02 가 만들었다): `src/commands/write-mode.ts` 의 `requireWriteMode`, `outputDryRun`, `PlannedRequest`, `src/commands/privatedns/helpers.ts` 의 `resolvePrivateDnsClients`, `withPrivateDnsOptions`, `normalizeZoneName`, `resolveZone`, `countUserRecordSets`, `mergeZoneNetworks`, `resolveVpcIds`, `PrivateDnsGlobalOpts`, `PrivateDnsWriteOpts`.
- 반복 옵션은 `src/commands/loadbalancer/helpers.ts` 의 `collectOption(value, previous)` 을 import 해서 쓴다. 빈 선택 옵션 값 검사는 `src/commands/loadbalancer/lbaas-helpers.ts` 의 `optionalInput(value, flag)` 를 쓴다.
- 출력은 `src/formatters/table.ts` 의 `output(opts, { headers, rows, raw, ids })`. 진행 표시는 `src/utils/spinner.ts` 의 `startSpinner`/`stopSpinner`(Load Balancer 의 `withSpinner` 를 써도 된다).
- 옵션은 `cmd.optsWithGlobals<...>()` 로 읽는다(전역 `--json`, `--quiet` 포함). 필수 옵션 누락은 `src/commands/commander-errors.ts` 가 트리 전체에 `EXIT_PARAM_ERROR` 로 바꾸므로 명령에서 따로 검사하지 않는다(ADR-035).
- 검증과 자격증명 해석 전에는 spinner 나 요청을 시작하지 않는다. 옵션 조합 오류는 `resolvePrivateDnsClients` 보다 먼저 던진다.
- dry-run 경로는 `/v2.0/privatedns/zones...` 처럼 `/v2.0` 을 포함해 적는다(`listener.ts` 의 `/v2.0/lbaas/listeners` 와 같은 표기).

**근거 문서**: `docs/flow.md` 의 「Private DNS」·「Private DNS 쓰기」 절, `docs/adr/049-privatedns-write-merge-and-protection.md`, `docs/adr/048-loadbalancer-listener-write-and-certificate.md`(`--yes`/`--dry-run` 규칙).

## 의도 메모

- `zone create` 는 같은 이름의 zone 이 이미 있으면(`listZones({ name })` 결과에 대소문자 무시 일치) 요청하지 않고 종료 코드 3으로 끝난다. 결과를 모르는 실패 뒤 재실행이 같은 zone 을 또 만들지 않게 하기 위해서다.
- `zone update` 는 `getZone` 으로 현재 값을 읽고 사용자가 준 것만 바꾼다. `--description` 이 없으면 현재 `description ?? ""` 를 보낸다(ADR-049).
- `zone delete` 는 `--dry-run` 에서도 남은 레코드 검사를 한다(`docs/flow.md`: dry-run 도 사전 검사를 똑같이 한다).
- 생성 직후 상태는 `BUILD` 이고 기다리지 않는다. help 설명에 이를 적는다.
- `zone list --name` 은 `normalizeZoneName` 을 거쳐 서버 쿼리에 보낸다(실측: 끝 `.` 없는 이름은 빈 목록).

## 작업 항목

### 1. `src/commands/privatedns/zone.ts` 신규: `export const zoneCommand`

`new Command("zone").description("Private DNS zone 조회·생성·수정·삭제")` 아래 다섯 하위 명령. 모두 `withPrivateDnsOptions` 로 `--region`, `--profile` 을 붙인다.

| 명령 | 인수·옵션 | 동작 |
|---|---|---|
| `list` | `--name <name>` | `listZones({ name })`. 출력 headers `["id", "name", "status", "records", "vpcs", "description"]`, rows 의 `records` 는 `rrset_count ?? ""`, `vpcs` 는 `networks.length`, `description` 은 `?? ""`. `raw` 는 zone 배열, `ids` 는 zone UUID |
| `get <zone>` | — | `resolveZone` 뒤 `getZone(id)`. headers `["field", "value"]`, rows `id`, `name`, `status`, `description`, `networks`(`", "` 로 연결), `rrset_count`, `created_at`, `updated_at`. `ids: [id]` |
| `create` | `--name <name>`(필수), `--network <vpc>`(필수, 반복), `--description <text>`, `--yes`, `--dry-run` | `requireWriteMode(opts, "Private DNS zone 생성")` → 이름 정규화 → client 해석 → 중복 검사 → `resolveVpcIds` → dry-run 이면 `{ method: "POST", path: "/v2.0/privatedns/zones", body: { zone } }` 출력, 아니면 `createZone`. 결과는 `get` 과 같은 field/value 출력 |
| `update <zone>` | `--description <text>`, `--network <vpc>`(반복, 연결 VPC 목록을 이 값들로 바꾼다), `--add-network <vpc>`(반복), `--remove-network <vpc>`(반복), `--yes`, `--dry-run` | 바꿀 옵션이 하나도 없으면 `--description, --network, --add-network, --remove-network 중 하나는 필요합니다.`(종료 코드 3). `--network` 와 add/remove 동시 지정도 자격증명 전에 거부. `requireWriteMode(opts, "Private DNS zone 수정")` → client 해석 → `resolveZone` → `getZone` → VPC 이름 해석 → `mergeZoneNetworks` → 본문 `{ description, networks }` → dry-run 이면 `PUT /v2.0/privatedns/zones/{id}` 출력, 아니면 `updateZone` |
| `delete <zone>` | `--yes`, `--dry-run`, `--force` | `requireWriteMode(opts, "Private DNS zone 삭제")` → client 해석 → `resolveZone` → `listRecordSets(id)` → `countUserRecordSets` 가 0 보다 크고 `--force` 가 없으면 `zone 에 레코드 세트 N개가 남아 있습니다(SOA, apex NS 제외). 지우려면 --force 를 함께 주세요.`(종료 코드 3) → dry-run 이면 `DELETE /v2.0/privatedns/zones/{id}` 출력, 아니면 `deleteZone`. 결과 raw `{ operation: "privatedns-zone-delete", status: "succeeded", zone_id }`, field/value 출력, `ids: [zoneId]` |

- `--description` 과 `--name` 의 빈 값은 `optionalInput` 으로 거부한다. 단 `--description ""` 처럼 설명을 비우려는 입력은 허용해야 하므로 `--description` 에는 `optionalInput` 을 쓰지 않고 값을 그대로 쓴다.
- 쓰기 결과의 zone 출력은 `get` 과 같은 지역 함수 `outputZone(opts, zone)` 로 한다. `rrset_count` 가 없으면 빈 칸이다.

### 2. `src/index.ts` 등록

- `import { zoneCommand as privateDnsZoneCommand } from "./commands/privatedns/zone.js";`
- `privatednsAgentWorkflow` 상수를 다른 `*AgentWorkflow` 옆에 둔다. 이 phase 에서는 다음 세 줄이다.

```text
Agent workflow:
  1. nhncloud privatedns zone list --json
  2. nhncloud privatedns zone get <zone> --json
  3. 쓰기는 먼저 --dry-run 으로 요청 본문을 확인하고 --yes 로 보낸다. zone 생성 직후 상태는 BUILD 다.
```

- `loadbalancer` 그룹 등록(`program.addCommand(loadbalancerCommand)`) 바로 뒤에 `const privatednsCommand = new Command("privatedns").description("Private DNS zone·레코드 세트 조회·관리").addHelpText("after", privatednsAgentWorkflow); privatednsCommand.addCommand(privateDnsZoneCommand); program.addCommand(privatednsCommand);`

### 3. 이 phase 를 검증하는 `src/commands/privatedns/zone.test.ts`

`src/commands/loadbalancer/lbaas-commands.test.ts` 처럼 `./helpers.js` 의 `resolvePrivateDnsClients` 만 `vi.fn()` 으로 바꾸고(`importOriginal` 로 나머지는 실제 구현), `../../formatters/table.js` 의 `output` 과 `../../utils/spinner.js` 를 mock 한다. `dns`, `network` 는 필요한 메서드만 가진 `vi.fn()` 객체로 넘긴다. 명령은 `parseAsync` 로 실행한다(`lbaas-commands.test.ts` 의 `run` 도우미 참고).

- `zone list` 가 `rrset_count`·`networks.length` 를 rows 에 넣는다.
- `zone create --name example.net --network vpc-a --dry-run` 이 `createZone` 을 부르지 않고, `output` 의 `raw.requests[0]` 이 `{ method: "POST", path: "/v2.0/privatedns/zones", body: { zone: { name: "example.net.", networks: ["<vpc-a uuid>"] } } }` 다.
- `zone create` 에 `--yes`·`--dry-run` 둘 다 없으면 `resolvePrivateDnsClients` 가 불리지 않고 `EXIT_PARAM_ERROR`.
- 같은 이름의 zone 이 있으면 `zone create --yes` 가 `createZone` 을 부르지 않고 `EXIT_PARAM_ERROR`.
- `zone update example.net --add-network vpc-b --yes` 가 `updateZone(id, { description: <현재 값 또는 "">, networks: [기존..., vpc-b uuid] })` 로 부른다.
- `zone update example.net --network vpc-a --add-network vpc-b --yes` 는 자격증명 해석 전에 `EXIT_PARAM_ERROR`.
- `zone delete` 는 사용자 레코드가 1개 남으면 `--force` 없이 `EXIT_PARAM_ERROR` 이고 `deleteZone` 을 부르지 않으며, `--force --yes` 면 부른다. SOA·apex NS 만 있으면 `--force` 없이 지운다.

## 검증

```bash
node_modules/.bin/vitest run src/commands/privatedns/zone.test.ts
node_modules/.bin/tsc --noEmit
node_modules/.bin/tsup
node dist/index.js commands --json | grep -c '"privatedns zone'
node dist/index.js privatedns zone create --name example.net --network x; test $? -eq 3
git diff --check
```

기대값: 테스트 통과, 타입 오류 0, 빌드 성공, 카탈로그 grep 이 5 이상, `--yes` 없는 create 가 자격증명을 읽기 전에 종료 코드 3.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/commands/privatedns/zone.ts` | 신규 |
| `src/commands/privatedns/zone.test.ts` | 신규 |
| `src/index.ts` | 수정 |
