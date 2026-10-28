# Phase 04. `privatedns record` 명령

**Execution profile**: standard

## 목표

`nhncloud privatedns record list|get|create|update|delete` 를 만들어 `privatedns` 그룹에 붙인다.
특정 zone 의 레코드 세트를 스크립트와 에이전트가 콘솔 없이 추가·수정·삭제하는 것이 이번 기능의 중심이다.

**범위 외**: zone 명령(phase 03), README·스킬 문서(phase 05).

## 컨텍스트

- 이 phase 가 쓰는 도우미(phase 02): `src/commands/write-mode.ts` 의 `requireWriteMode`, `outputDryRun`, `src/commands/privatedns/helpers.ts` 의 `resolvePrivateDnsClients`, `withPrivateDnsOptions`, `resolveZone`, `toRecordName`, `parseRecordType`, `resolveRecordSet`, `assertWritableRecordSet`, `mergeRecordSetUpdate`, `PrivateDnsGlobalOpts`, `PrivateDnsWriteOpts`.
- 같은 형태의 명령 파일: phase 03 의 `src/commands/privatedns/zone.ts`(출력, dry-run, 삭제 결과 형식). 반복 옵션은 `src/commands/loadbalancer/helpers.ts` 의 `collectOption`.
- 숫자 옵션은 `src/commands/parse-options.ts` 의 `parseIntegerOption(value, "--ttl", { min: 1 })`. 공식 문서가 TTL 상한을 적지 않으므로 상한을 두지 않고 서버 판정에 맡긴다(`docs/pitfalls/plan/numeric-param-range-unverified.md`).
- `src/index.ts` 에는 phase 03 이 만든 `privatednsCommand` 와 `privatednsAgentWorkflow` 가 있다.

**근거 문서**: `docs/flow.md` 의 「Private DNS」·「Private DNS 쓰기」 절, `docs/adr/049-privatedns-write-merge-and-protection.md`, `docs/prd.md` 의 성공 지표(`record update --ttl` 이 레코드와 설명을 보존).

## 의도 메모

- `record create` 의 `description` 은 공식 문서가 필수로 적어 `--description` 이 없으면 `""` 를 보낸다. `ttl` 은 `--ttl` 이 없으면 본문에서 뺀다(서버 기본값 300).
- `record create` 는 같은 이름·타입 레코드 세트가 이미 있으면 요청하지 않고 `이미 같은 이름과 타입의 레코드 세트가 있습니다: <FQDN> <TYPE> (<uuid>). 값을 바꾸려면 record update 를 쓰세요.`(종료 코드 3). 재실행 중복을 막는다.
- `record create --type SOA` 는 자격증명 전에 `SOA 레코드 세트는 만들 수 없습니다.`(종료 코드 3).
- `record update` 의 `--type` 은 대상을 고르는 데만 쓴다. 타입 변경은 지원하지 않으며 PUT 본문의 `type` 은 늘 현재 값이다(`mergeRecordSetUpdate`).
- `record update` 의 「바꿀 옵션이 없으면」 판정은 `--record` 배열이 비었고 `opts.ttl === undefined`, `opts.description === undefined` 인지로 한다. `--description ""` 는 설명을 비우는 정상 입력이다.
- list 의 headers 배열은 `["id", "name", "type", "ttl", "records", "description"]` 처럼 한 줄로 쓴다(문서 대조 grep 이 한 줄을 본다).
- `--record` 값은 앞뒤 공백만 지우고 형식(IPv4 등)은 검사하지 않는다. 타입별 형식 판정은 서버가 하고, 거절 사유는 `toNetworkWriteError` 가 `서버 응답:` 으로 붙인다. 빈 값은 `--record 값이 비어 있습니다.`(종료 코드 3).

## 작업 항목

### 1. `src/commands/privatedns/record.ts` 신규: `export const recordCommand`

`new Command("record").description("Private DNS 레코드 세트 조회·생성·수정·삭제")` 아래 다섯 하위 명령. 모두 `withPrivateDnsOptions` 를 붙이고 첫 인수는 `<zone>`(zone 이름 또는 UUID)이다. `<record>` 는 레코드 세트 UUID, FQDN, 상대 이름, `@` 다.

| 명령 | 인수·옵션 | 동작 |
|---|---|---|
| `list <zone>` | `--name <name>`, `--type <type>` | `resolveZone` → `listRecordSets(zone.id, { name: toRecordName(...), type })`. headers `["id", "name", "type", "ttl", "records", "description"]`, `records` 는 `content` 를 `", "` 로 연결, `description` 은 `?? ""`. `ids` 는 UUID |
| `get <zone> <record>` | `--type <type>` | `resolveRecordSet` 결과를 field/value 로 출력: `id`, `name`, `type`, `ttl`, `records`(줄마다 하나, `"\n"` 로 연결), `description`, `zone_id`, `created_at`, `updated_at` |
| `create <zone>` | `--name <name>`(필수), `--type <type>`(필수), `--record <value>`(필수, 반복), `--ttl <seconds>`, `--description <text>`, `--yes`, `--dry-run` | 형식·타입 검사 → `requireWriteMode(opts, "레코드 세트 생성")` → client 해석 → `resolveZone` → 같은 이름·타입 검사 → 본문 `{ name: FQDN, type, records: [{ content }...], ttl?, description }` → dry-run 이면 `POST /v2.0/privatedns/zones/{zoneId}/rrsets` 출력, 아니면 `createRecordSet` → `get` 과 같은 field/value 출력 |
| `update <zone> <record>` | `--type <type>`, `--record <value>`(반복, 레코드 목록을 이 값들로 바꾼다), `--ttl <seconds>`, `--description <text>`, `--yes`, `--dry-run` | `--record`, `--ttl`, `--description` 이 모두 없으면 `--record, --ttl, --description 중 하나는 필요합니다.`(종료 코드 3, 자격증명 전) → `requireWriteMode(opts, "레코드 세트 수정")` → client 해석 → `resolveZone` → `resolveRecordSet` → `assertWritableRecordSet` → `mergeRecordSetUpdate` → dry-run 이면 `PUT /v2.0/privatedns/zones/{zoneId}/rrsets/{id}` 출력, 아니면 `updateRecordSet` |
| `delete <zone> <record>` | `--type <type>`, `--yes`, `--dry-run` | `requireWriteMode(opts, "레코드 세트 삭제")` → 해석 → `assertWritableRecordSet` → dry-run 이면 `DELETE .../rrsets/{id}` 출력, 아니면 `deleteRecordSet`. 결과 raw `{ operation: "privatedns-record-delete", status: "succeeded", zone_id, rrset_id }`, `ids: [rrsetId]` |

`--type` 값은 모든 명령에서 `parseRecordType` 으로 자격증명 해석 전에 검사한다.

### 2. `src/index.ts` 수정

- `import { recordCommand as privateDnsRecordCommand } from "./commands/privatedns/record.js";` 와 `privatednsCommand.addCommand(privateDnsRecordCommand);`(zone 등록 바로 뒤).
- `privatednsAgentWorkflow` 를 다음으로 바꾼다.

```text
Agent workflow:
  1. nhncloud privatedns zone list --json
  2. nhncloud privatedns record list <zone> --json
  3. nhncloud privatedns record create <zone> --name <name> --type A --record <ip> --dry-run --json
  4. 같은 명령을 --yes 로 보낸다. 수정은 record update 로 바꿀 옵션만 준다(나머지는 현재 값 유지).
  5. 이름이 같은 레코드 세트가 여럿이면 --type 을 붙인다. SOA 와 zone apex NS 는 바꿀 수 없다.
  6. zone 생성 직후 상태는 BUILD 다. zone get 으로 ACTIVE 를 확인한 뒤 레코드를 만든다.
```

### 3. 이 phase 를 검증하는 `src/commands/privatedns/record.test.ts`

phase 03 의 `zone.test.ts` 와 같은 mock 구성을 쓴다(`./helpers.js` 의 `resolvePrivateDnsClients` 만 `vi.fn()`, `output`·spinner mock).

- `record create example.net --name www --type a --record 10.0.0.1 --record 10.0.0.2 --dry-run` 의 `raw.requests[0].body` 가 `{ rrset: { name: "www.example.net.", type: "A", records: [{ content: "10.0.0.1" }, { content: "10.0.0.2" }], description: "" } }` 이고 `ttl` 키가 없다. `createRecordSet` 은 불리지 않는다.
- 같은 이름·타입이 있으면 `record create --yes` 가 `EXIT_PARAM_ERROR` 이고 `createRecordSet` 을 부르지 않는다.
- `record create --type SOA` 는 `resolvePrivateDnsClients` 전에 `EXIT_PARAM_ERROR`.
- `record update example.net www --ttl 600 --yes` 가 `updateRecordSet(zoneId, id, { type: "A", records: <현재>, ttl: 600, description: <현재 또는 ""> })` 로 부른다(prd 성공 지표).
- `record update` 에 바꿀 옵션이 없으면 자격증명 전에 `EXIT_PARAM_ERROR`.
- `record update example.net www --description "" --yes` 가 `description: ""` 와 현재 records·ttl 로 `updateRecordSet` 을 부른다.
- `record delete example.net @ --type NS --yes` 는 `deleteRecordSet` 을 부르지 않고 `EXIT_PARAM_ERROR`.
- `record list` 가 records 를 `", "` 로 이어 rows 에 넣는다.
- `record update` 에서 서버가 400 을 돌려주는 경우는 phase 01 client 테스트가 다루므로 여기서는 반복하지 않는다.

## 검증

```bash
node_modules/.bin/vitest run src/commands/privatedns/record.test.ts src/commands/privatedns/zone.test.ts
node_modules/.bin/tsc --noEmit
node_modules/.bin/tsup
node dist/index.js commands --json | grep -c '"privatedns record'
node dist/index.js privatedns record create example.net --name www --type SOA --record x --yes; test $? -eq 3
git diff --check
```

기대값: 테스트 통과, 타입 오류 0, 빌드 성공, 카탈로그 grep 이 5 이상, SOA 생성이 자격증명을 읽기 전에 종료 코드 3.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/commands/privatedns/record.ts` | 신규 |
| `src/commands/privatedns/record.test.ts` | 신규 |
| `src/index.ts` | 수정 |
