# Phase 04. README와 공개 스킬 reference, 수동 QA 절차

**Execution profile**: fast

## 목표

SKM 쓰기 명령을 README와 공개 스킬(`skills/nhncloud-cli/`)에 반영하고, 실제 프로젝트로 확인할 수동 QA 절차를 PR 본문용으로 정리한다.

**범위 외**: 코드 변경은 없다. `docs/`(prd, flow, ADR-039, ADR-040)는 planning 단계에서 갱신했다. 수동 QA 실행은 사용자가 한다.

## 컨텍스트

- 명령 표면의 단일 소스는 `node dist/index.js commands --json`과 각 명령의 `--help`다. 문서의 명령과 옵션은 여기서 복사한다.
- `skills/nhncloud-cli/references/skm.md`: 제목 `# Secure Key Manager 조회·데이터 명령 안내`, 절 `## 인증과 설정`, `## 클라이언트 인증`, `## 명령 탐색`, `## 입력과 크기 한도`, `## 비밀값 출력`, `## 서명 검증 종료 코드`.
- `skills/nhncloud-cli/SKILL.md` 「참조 라우터」 표 40행 부근: `| Secure Key Manager 키 조회·기밀 데이터·암복호화·서명 검증 | [skm.md](references/skm.md) |`.
- `skills/nhncloud-cli/references/common.md` 「되돌릴 수 없는 명령」 표의 `TTY 여부와 관계없이 --yes 필수` 행.
- `README.md` 「에이전트 없이 직접 쓰기」 코드 블록의 `nhncloud skm …` 두 줄.

**근거 문서**: `docs/flow.md`의 「Secure Key Manager 쓰기」 절, `docs/adr/040-skm-write-commands.md`, `docs/pitfalls/plan/new-command-docs-required-skip.md`

## 의도 메모

- 문서에 명령 개수를 적지 않는다. 예시는 `<keystore-id>`, `<key-id>`, `10.0.0.1`(문서용 사설 주소), `aa:bb:cc:dd:ee:ff` 같은 placeholder만 쓴다.
- "데이터 명령" 같은 뜻이 드러나지 않는 묶음 이름 대신 하는 일(기밀 데이터 조회, 암복호화, 서명과 검증, 키 원문 조회, 생성·삭제)을 적는다.

## 작업 항목

### 1. `skills/nhncloud-cli/references/skm.md`

- 제목을 `# Secure Key Manager 명령 안내`로 바꾸고 소개 문단의 "생성·수정·삭제는 지원하지 않는다" 문장을 지원 범위에 맞게 고친다.
- `## 쓰기 명령` 절을 `## 명령 탐색` 다음에 추가한다.
  - 처음 구성하는 순서 예시: `skm keystore create --name <name> --auth ipv4` → `skm keystore auth add <keystore-id> 10.0.0.1 --type ipv4` → `printf '%s' "$SECRET" | skm key create <keystore-id> --type secret --name <name>`.
  - 키 저장소는 `<keystore-id>`로 지정하고 CLI가 이름을 조회한다는 점.
  - `keystore update`는 주지 않은 값을 현재 값으로 채우며 `--auth-mode`가 필수라는 점.
  - `delete`(7일 뒤 삭제, 콘솔에서 취소 가능)와 `purge`(예약된 대상만, 되돌릴 수 없음), 모든 삭제에 `--yes`가 필요하다는 점.
  - 인증 정보 삭제나 인증 설정 변경 전에 `skm confirm`으로 현재 IP·MAC을 확인하라는 경고.
  - 인증서 추가는 `--life-time <days>`가 필수이고, 비밀번호는 `--password-file`이나 표준 입력을 권장하며 끝 줄바꿈 하나를 지운다는 점.
  - 대칭키·비대칭키는 자동 회전 없이 만들어진다는 점(콘솔에서 설정).
- `## 비밀값 출력` 절에 `secret update`는 바꾼 값을 출력하지 않는다는 한 줄을 추가한다.
- `## 명령 탐색`의 `--quiet` 출력 목록에 쓰기 명령을 더한다: `key create`·`secret update`·`key delete|purge`는 keyId, `keystore create|update|delete`는 keyStoreId, `keystore auth add|delete|purge`는 입력한 IPv4·MAC 값 또는 인증서 이름.
- `## 입력과 크기 한도`에 `key create --type secret`·`secret update`의 값 1MB(1,000,000바이트), 인증서 비밀번호 1024바이트를 더한다.
- `## 클라이언트 인증`의 "인증서 인증은 지원하지 않는다" 문장을 "인증서 인증 정보 등록(`auth add --type certificate`)은 지원하지만, CLI가 클라이언트 인증서를 보내 인증하는 것은 지원하지 않는다"로 구분한다.
- `## 쓰기 명령`에 MAC 값은 소문자로 바꿔 보내므로 콘솔에서 대문자로 등록한 MAC은 CLI로 지우지 못할 수 있다는 한 줄을 넣는다.

### 2. `skills/nhncloud-cli/SKILL.md`

라우터 행 `Secure Key Manager 키 조회·기밀 데이터·암복호화·서명 검증`을 `Secure Key Manager 키·키 저장소·인증 정보 관리, 기밀 데이터·암복호화·서명 검증`으로 바꾼다.

### 3. `skills/nhncloud-cli/references/common.md`

「되돌릴 수 없는 명령」 표의 `TTY 여부와 관계없이 --yes 필수` 행 끝에 `` , `skm key delete`, `skm key purge`, `skm keystore delete`, `skm keystore auth delete`, `skm keystore auth purge` ``를 덧붙인다.

### 4. `README.md`

「에이전트 없이 직접 쓰기」 코드 블록의 `nhncloud skm secret get …` 줄 다음에 추가한다.

```bash
printf '%s' "$VALUE" | nhncloud skm key create <keystore-id> --type secret --name <name>  # 기밀 데이터 저장
```

### 5. 수동 QA 절차를 PR 본문용으로 정리

이 phase는 실제 API를 호출하지 않는다. 아래 표를 PR 본문의 수동 QA 항목에 옮긴다.
사용자는 SKM이 켜진 테스트 프로젝트를 준비한다. 운영 키 저장소에서 실행하지 않는다.

| 순서 | 명령 | 기대 |
|---|---|---|
| 1 | `nhncloud skm confirm --json`으로 현재 IP 확인 | 종료 코드 0 |
| 2 | `nhncloud skm keystore create --name qa-store --auth ipv4 --json` | 종료 코드 0, `keyStoreId` 반환 |
| 3 | `nhncloud skm keystore auth add <id> <1의 IP> --type ipv4` | 종료 코드 0 |
| 4 | `printf 'v1' \| nhncloud skm key create <id> --type secret --name qa-secret --quiet` | 키 ID 출력 |
| 5 | `nhncloud skm secret get <key-id> --quiet` | `v1` |
| 6 | `printf 'v2' \| nhncloud skm secret update <key-id> --json` 뒤 5 반복 | 출력에 `v2` 없음, 5는 `v2` |
| 7 | `nhncloud skm key create <id> --type symmetric-key --name qa-sym`, `--type asymmetric-key --name qa-asym` | 둘 다 종료 코드 0, `key get`의 `autoRotationPeriod`가 0 |
| 8 | `nhncloud skm keystore update <id> --auth-mode or --description qa` 뒤 `keystore get <id>` | 이름·인증 사용 여부가 그대로, 설명만 바뀜 |
| 9 | `nhncloud skm keystore auth add <id> qa-cert --type certificate --life-time 30 --password-file <파일>` | 종료 코드 0, `auth get … --json`의 `password`가 `***` |
| 10 | `nhncloud skm key delete <key-id>`(`--yes` 없음) | 종료 코드 3, 요청 없음 |
| 11 | `nhncloud skm key delete <key-id> --yes` 뒤 `key purge <key-id> --yes` | 둘 다 종료 코드 0 |
| 12 | 예약하지 않은 키에 `key purge <key-id> --yes` | 종료 코드 1, 서버 `resultMessage` 포함 |
| 13 | `keystore auth delete <id> qa-cert --type certificate --yes` 뒤 `auth purge` | 둘 다 종료 코드 0 |
| 14 | `nhncloud skm keystore delete <id> --yes` | 종료 코드 0 (`body: null` 응답 처리 실측) |
| 15 | 공공망 profile로 2와 14 반복 | 종료 코드 0 |
| 16 | 콘솔에서 MAC을 대문자로 등록한 키 저장소에 `keystore auth delete <id> <MAC> --type mac --yes` | 성공 또는 서버 오류. 결과를 ADR-040과 `skm.md`에 반영 |

QA 결과가 문서와 어긋나면 PR에서 `review-fix`로 client와 `docs/flow.md`, ADR-040, `skm.md`를 함께 고친다.

### 6. `tasks/plan4-skm-write/index.json` 완료 처리

`status`를 `"completed"`, `current_phase`를 `4`로 바꾼다.

## 검증

```bash
pnpm run build
pnpm test
node dist/index.js commands --json | grep -c '"path": "skm'   # 33
grep -c "skm key create" README.md   # 1
grep -c "## 쓰기 명령" skills/nhncloud-cli/references/skm.md   # 1
grep -c "skm keystore auth purge" skills/nhncloud-cli/references/common.md   # 1
grep -c "생성·수정·삭제는 지원하지 않" skills/nhncloud-cli/references/skm.md   # 0
grep -rnoE "(https?://|@)[A-Za-z0-9.-]+\.(com|co\.kr|net)" README.md skills/ docs/ AGENTS.md CLAUDE.md src/ tasks/ .agents/ .claude/ .codex/ .github/ 2>/dev/null | grep -vE "nhncloud\.com|nhncloudservice\.com|github\.com|npmjs\.com|example\.com|openai\.com|anthropic\.com" | wc -l   # 0
grep -rnE "(secret|password|appkey)['\"]?[[:space:]]*[:=][[:space:]]*['\"][A-Za-z0-9]{16,}" README.md skills/ docs/ AGENTS.md CLAUDE.md src/ tasks/ .agents/ .claude/ .codex/ .github/ 2>/dev/null | wc -l   # 0
jq -e '.status == "completed" and .current_phase == .total_phases and (.total_phases == (.phases | length))' tasks/plan4-skm-write/index.json
git diff --check
```

## 변경 파일

| 파일 | 변경 |
|---|---|
| `skills/nhncloud-cli/references/skm.md` | 수정 |
| `skills/nhncloud-cli/SKILL.md` | 수정 |
| `skills/nhncloud-cli/references/common.md` | 수정 |
| `README.md` | 수정 |
| `tasks/plan4-skm-write/index.json` | 수정 |
