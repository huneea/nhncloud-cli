# Phase 05. 사용자 가이드와 공개 스킬 참조

**Execution profile**: fast

## 목표

`privatedns` 명령의 사용자 가이드를 공개 스킬 참조와 README 에 더한다.
에이전트와 사용자가 명령 카탈로그와 같은 내용으로 Private DNS 작업을 찾게 하기 위해서다.

**범위 외**: 코드 변경(phase 01~04). `docs/` 의 설계 문서는 계획 단계에서 이미 갱신했다.

## 컨텍스트

- 사용자 문서의 단일 소스는 실제 명령 트리다. 먼저 `node dist/index.js commands --json` 과 각 명령의 `--help` 를 읽고 그 경로·인수·옵션 이름만 쓴다(`AGENTS.md` 의 「단일 소스」).
- 참조 문서 형식은 `skills/nhncloud-cli/references/loadbalancer.md` 를 따른다(제목 `# ... Reference`, 「탐색 순서」, 「이름과 UUID 해석」, 쓰기 절, 실측 메모).
- `skills/nhncloud-cli/SKILL.md` 는 라우터다. 서비스 상세는 참조 파일에만 둔다(`AGENTS.md` 의 「문서와 스킬」).
- 동작 규칙의 원본은 `docs/flow.md` 의 「Private DNS」·「Private DNS 쓰기」 절과 `docs/adr/049-privatedns-write-merge-and-protection.md` 다. 사용자 문서에는 사용법과 결과만 적고 결정 근거는 ADR 링크 대신 짧은 설명으로 둔다.
- 공개 저장소다. 예시에는 `example.net.`, `<zone-id>`, `<rrset-id>`, `<vpc-id>`, `10.0.0.1` 같은 placeholder 만 쓴다(`AGENTS.md` 의 「공개 저장소 정보 보호」).

**근거 문서**: `docs/flow.md` 의 「서비스별 시작점」 표(Private DNS 행이 `../skills/nhncloud-cli/references/privatedns.md` 를 가리킨다), `docs/prd.md` 의 `nhncloud privatedns` 항목.

## 작업 항목

### 1. `skills/nhncloud-cli/references/privatedns.md` 신규

다음 절을 담는다.

- 개요: zone 과 레코드 세트 조회·생성·수정·삭제, IaaS 자격증명·Keystone 토큰·network endpoint 공유, 지원 region(일반망 kr1·kr2·kr3, 공공망 kr1).
- 탐색 순서: `nhncloud commands --json | jq '.commands[] | select(.path|startswith("privatedns"))'`, `privatedns zone list`, `privatedns record list <zone>`.
- 이름 해석: zone 이름의 끝 `.` 생략, 레코드 세트의 UUID·FQDN·상대 이름·`@`, 같은 이름 여러 타입이면 `--type`.
- 레코드 세트 쓰기: `create`(여러 값은 `--record` 반복, `--ttl` 생략 시 서버 기본 300), `update`(바꿀 옵션만, `--record` 는 레코드 목록을 준 값들로 바꿈, 타입 변경 불가), `delete`. 모두 `--dry-run` 으로 본문 확인 뒤 `--yes`. SOA 와 zone apex NS 는 바꿀 수 없다.
- zone 쓰기: `create`(`--network` 반복, 상태 `BUILD`, `zone get` 으로 `ACTIVE` 확인), `update`(`--add-network`·`--remove-network`·`--network`, `--description`), `delete`(남은 레코드가 있으면 `--force`).
- 출력: list 테이블 컬럼(zone: `id`, `name`, `status`, `records`, `vpcs`, `description` / record: `id`, `name`, `type`, `ttl`, `records`, `description`)은 phase 03·04 코드의 `headers` 배열과 1:1 로 맞춘다(`docs/pitfalls/plan/list-output-column-docs-mismatch.md`). `--quiet` 은 UUID, `--dry-run` 의 `--quiet` 은 출력 없음.
- 실패와 재실행: 같은 이름 zone·같은 이름과 타입 레코드 세트가 있으면 create 가 거부, 결과를 모르는 실패 뒤에는 list 로 확인, 조회와 수정 사이 동시 변경은 덮어쓴다.

### 2. `skills/nhncloud-cli/SKILL.md` 수정

- frontmatter `description` 의 서비스 나열에 `Private DNS` 를 `Load Balancer,` 뒤에 더한다.
- 「참조 라우터」 표의 Load Balancer 행 뒤에 `| Private DNS zone, 레코드 세트 조회·생성·수정·삭제 | [privatedns.md](references/privatedns.md) |` 를 더한다.

### 3. `README.md` 수정

- 「할 수 있는 일」 표의 Load Balancer 행 뒤에 `| Private DNS zone, 레코드 세트 | \`nhncloud privatedns\` | [Private DNS](skills/nhncloud-cli/references/privatedns.md) |`.
- 예시 명령 목록(`nhncloud loadbalancer certificate upload ...` 줄 뒤)에 `nhncloud privatedns zone list`, `nhncloud privatedns record create <zone> --name www --type A --record 10.0.0.1 --dry-run` 두 줄과 짧은 주석.
- 공공망 지원 서비스를 나열한 문장이 있으면 Private DNS(kr1)를 더한다. 없으면 더하지 않는다.

### 4. 문서와 명령 카탈로그 대조 테스트

새 테스트 파일은 만들지 않는다. 문서 대조는 아래 검증의 grep 과 카탈로그 비교로 하고, 패키지 포함 여부는 `scripts/verify-package.mjs` 의 기존 테스트(`scripts/verify-package.test.mjs`)와 전체 `vitest` 로 확인한다.

## 검증

```bash
node_modules/.bin/tsup
node dist/index.js commands --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s).commands.filter(x=>x.path.startsWith("privatedns ")).map(x=>x.path);console.log(c.join("\n"));if(c.length<10)process.exit(1)})'
grep -c "privatedns" skills/nhncloud-cli/references/privatedns.md
grep -n "references/privatedns.md" skills/nhncloud-cli/SKILL.md README.md docs/flow.md
grep -n '"id", "name", "status", "records", "vpcs", "description"' src/commands/privatedns/zone.ts
grep -n '"id", "name", "type", "ttl", "records", "description"' src/commands/privatedns/record.ts
node scripts/check-pii.mjs
node_modules/.bin/vitest run
pnpm verify:package
git diff --check
```

기대값: 카탈로그에 `privatedns` 하위 명령 10개 이상, 세 문서가 참조 파일을 가리킴, 두 headers grep 이 각각 한 줄(문서 컬럼과 같은 순서), PII 검사·전체 테스트·패키지 검증 종료 코드 0.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `skills/nhncloud-cli/references/privatedns.md` | 신규 |
| `skills/nhncloud-cli/SKILL.md` | 수정 |
| `README.md` | 수정 |
