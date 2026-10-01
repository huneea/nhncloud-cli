# Phase 04. README와 공개 스킬 reference, 수동 QA 절차

**Execution profile**: fast

## 목표

`skm` 명령군과 `configure --skm-appkey`를 README와 공개 스킬(`skills/nhncloud-cli/`)에 반영한다.
실제 SKM 프로젝트로 확인할 수동 QA 절차를 PR 본문에 남길 수 있게 정리한다.

**범위 외**: 코드 변경은 없다. `docs/`의 PRD, flow, code-architecture, data-schema, ADR-039는 planning 단계에서 이미 갱신했다. 수동 QA 실행은 사용자가 한다.

## 컨텍스트

- 명령 표면의 단일 소스: `node dist/index.js commands --json`과 각 명령의 `--help`. 문서의 명령 경로와 옵션은 여기서 복사한다.
- 공개 스킬 구조: `skills/nhncloud-cli/SKILL.md`(frontmatter `description`, 「참조 라우터」 표), `skills/nhncloud-cli/references/*.md`(서비스별 상세). 선례는 `skills/nhncloud-cli/references/apigateway.md`의 「인증과 설정」, 「명령 탐색」 절.
- `skills/nhncloud-cli/references/troubleshooting.md`의 「인증 모델」 표, `skills/nhncloud-cli/references/common.md`의 「초기 설정」 절.
- README: 「에이전트 없이 직접 쓰기」 코드 블록과 비대화형 configure 예시(`[--deploy-appkey <appkey>] [--ncr-appkey <appkey>] [--ncs-appkey <appkey>]` 줄).
- 공개 스킬 매니페스트는 `src/skill/manifest.ts`가 `references/` 아래 파일을 순회해 계산한다. 새 reference 파일을 따로 등록하지 않는다.

**근거 문서**: `docs/flow.md`의 「Secure Key Manager」 절, `docs/adr/039-skm-client-auth-and-secret-output.md`, `docs/pitfalls/plan/new-command-docs-required-skip.md`

## 의도 메모

- 문서에 명령 개수를 적지 않는다.
- 예시의 키 ID, appkey, MAC 주소, 비밀값은 `<key-id>`, `<keystore-id>`, `<appkey>`, `aa:bb:cc:dd:ee:ff` 같은 placeholder만 쓴다.
- 비밀값 출력 명령의 stdout을 로그나 이슈에 붙이지 말라는 안내를 reference에 넣는다.

## 작업 항목

### 1. `skills/nhncloud-cli/references/skm.md` 신규

다음 절을 둔다.

- `# Secure Key Manager 조회·데이터 명령 안내`: 한 문단 소개. 키 저장소·키·인증 정보 조회와 기밀 데이터 조회, 암복호화, 서명·검증, 키 원문 조회를 지원하고 생성·수정·삭제는 지원하지 않는다고 적는다.
- `## 인증과 설정`: `nhncloud configure --skm-appkey <appkey>`로 `skm.appkey`를 설정한다. 공통 UAK OAuth 토큰을 `X-NHN-Authorization`에 담는다. 공공망은 profile의 `"environment": "gov"`로 고른다.
- `## 클라이언트 인증`: 키 저장소의 IPv4·MAC 인증, `--mac-address`, 인증서 인증 미지원, `skm confirm`으로 서버가 본 IP·MAC 확인.
- `## 명령 탐색`: `skm keystore list` → `skm key list <keystore-id>` → 데이터 명령 순서 예시. `--quiet`이 출력하는 값을 명령별로 적는다(`keystore list`: keyStoreId, `key list`: keyId, `secret get`: 기밀 데이터, `encrypt`: 암호문, `decrypt`: 평문, `sign`: 서명값, `public-key`·`private-key`: `standardEncodedKey`, `create-local-key`: 평문 키와 암호화된 키 두 줄, `verify`: 출력 없음).
- `## 입력과 크기 한도`: `--plaintext`·`--ciphertext` > `--file` > 표준 입력 순서, `--plaintext`로 넘긴 비밀은 셸 히스토리와 프로세스 목록에 남으므로 비밀 평문은 `--file`이나 표준 입력을 권장한다는 안내, 끝 줄바꿈을 지우지 않으므로 `printf`를 쓰라는 안내, 32KB·245바이트·64KB 한도, `--standard`가 바이너리 입력을 base64로 바꿔 보내는 점.
- `## 비밀값 출력`: 비밀값 명령은 값을 숨기지 않는다. `--quiet`·`--json`은 원문, 기본 출력은 제어 문자만 `?`로 바꾼 값을 낸다. 인증서 상세의 `password`는 `***`다. stdout을 로그에 남기지 않는다.
- `## 서명 검증 종료 코드`: `verify`는 결과가 `false`면 종료 코드 1이다. `if nhncloud skm asymmetric-key verify ...; then` 예시. `--standard` 검증에 넘길 키 버전은 `sign --standard --json`의 `keyVersion`에서 얻는다.

### 2. `skills/nhncloud-cli/SKILL.md`

- frontmatter `description`의 서비스 나열 `Load Balancer, NCR, NKS, NCS, API Gateway 작업을`을 `Load Balancer, NCR, NKS, NCS, API Gateway, Secure Key Manager 작업을`로 바꾼다.
- 「참조 라우터」 표의 API Gateway 행 다음에 `| Secure Key Manager 키 조회·기밀 데이터·암복호화·서명 검증 | [skm.md](references/skm.md) |`를 추가한다.

### 3. `skills/nhncloud-cli/references/troubleshooting.md`

「인증 모델」 표의 API Gateway 행 다음에 `| Secure Key Manager | UAK id 와 secret, SKM appkey, 키 저장소 IPv4·MAC 인증 | OAuth Bearer token (`X-NHN-Authorization`), MAC 은 `X-TOAST-CLIENT-MAC-ADDR` |`를 추가한다.

### 4. `skills/nhncloud-cli/references/common.md`

「초기 설정」 절의 비대화형 configure 예시에 `--skm-appkey <appkey>` 줄을 기존 appkey 옵션들과 같은 형식으로 추가한다.

### 5. `README.md`

- 10행 소개 문장의 서비스 나열 `…Log & Crash·Deploy·API Gateway 를`을 `…Log & Crash·Deploy·API Gateway·Secure Key Manager 를`로 바꾼다.
- 비대화형 configure 예시의 `[--deploy-appkey <appkey>] [--ncr-appkey <appkey>] [--ncs-appkey <appkey>]` 줄 끝에 ` [--skm-appkey <appkey>]`를 붙인다.
- 「에이전트 없이 직접 쓰기」 코드 블록의 API Gateway 줄들 다음에 두 줄을 추가한다.

```bash
nhncloud skm key list <keystore-id>                            # Secure Key Manager 키 목록
nhncloud skm secret get <key-id> --quiet                       # 기밀 데이터 원문
```

### 6. 수동 QA 절차를 PR 본문용으로 정리

이 phase는 실제 API를 호출하지 않는다. 아래 표를 PR 본문의 「수동 QA」 절에 그대로 옮긴다.
사용자는 SKM이 켜진 프로젝트, IPv4 인증이 등록된 키 저장소, 기밀 데이터·대칭키·비대칭키 각 1개를 준비한다.

| 순서 | 명령 | 기대 |
|---|---|---|
| 1 | `nhncloud skm confirm --json` | 종료 코드 0. `clientIp`가 키 저장소에 등록한 IP다 |
| 2 | `nhncloud skm keystore list` | 키 저장소 행이 보인다 |
| 3 | `nhncloud skm key list <keystore-id> --json` | 키 3개가 보이고 `keyType`이 각각 다르다 |
| 4 | `nhncloud skm secret get <secret-key-id> --quiet` | 콘솔에 저장한 값과 같다 |
| 5 | `printf 'hello' \| nhncloud skm symmetric-key encrypt <sym-key-id> --quiet` 결과를 `decrypt --ciphertext`로 되돌림 | `hello` |
| 6 | `printf 'hello' \| nhncloud skm asymmetric-key sign <asym-key-id> --quiet` 결과로 `verify --plaintext hello --signature <sig>` | 종료 코드 0, `검증 성공` |
| 7 | 6의 서명으로 `verify --plaintext world --signature <sig>` | 종료 코드 1, `검증 실패` |
| 8 | `printf 'hello' \| nhncloud skm asymmetric-key sign <asym-key-id> --standard --json`의 `signature`·`keyVersion`으로 `printf 'hello' \| nhncloud skm asymmetric-key verify <asym-key-id> --standard --signature <signature> --key-version <keyVersion>` | 종료 코드 0 |
| 9 | `nhncloud skm keystore get <keystore-id>`, `nhncloud skm key get <keystore-id> <key-id>` | 종료 코드 0 |
| 10 | `nhncloud skm keystore auth list <keystore-id> --type ipv4`, `auth get <keystore-id> <ip> --type ipv4` | 등록한 IP가 보인다 |
| 11 | 인증서 인증 정보가 있으면 `auth get <keystore-id> <cert-name> --type certificate --json` | `password`가 `***` |
| 12 | `nhncloud skm symmetric-key get <sym-key-id>`를 `--key-version` 없이, 그리고 `--key-version 1`로 | 둘 다 종료 코드 0 (생략 허용 여부 실측) |
| 13 | `nhncloud skm symmetric-key create-local-key <sym-key-id> --json` | 종료 코드 0 (본문 없는 POST 실측), 평문·암호화 키가 모두 있다 |
| 14 | `nhncloud skm asymmetric-key public-key <asym-key-id>`, `private-key <asym-key-id>`를 `--key-version` 없이 | 종료 코드 0 |
| 15 | MAC 인증을 켠 키 저장소에서 `confirm --json`을 `--mac-address` 없이·있이 | 있을 때만 `clientMacHeader`가 준 값이다. 없을 때 필드가 빠지거나 `null`이어도 종료 코드 0 |
| 16 | 15의 키 저장소 키로 `secret get --mac-address <등록한 MAC>`. 콘솔에 MAC을 대문자로 등록한 경우도 한 번 | 둘 다 종료 코드 0 (CLI는 소문자로 보내므로 서버가 대소문자를 구분하는지 실측) |
| 17 | 공공망 profile로 1 반복 | 공공망 host로 호출되고 종료 코드 0 |
| 18 | IP가 등록되지 않은 곳에서 4 | 종료 코드 1 또는 2, 오류에 서버 `resultMessage`가 담긴다 |

QA 결과가 문서와 어긋나면(UAK 토큰 헤더 이름, 키 저장소 조회의 클라이언트 인증 요구, 4xx 오류 본문 형태, `keyVersion` 생략, MAC 대소문자 등) PR에서 `review-fix`로 client와 `docs/flow.md`, ADR-039, `skm.md`를 함께 고친다.

### 7. `tasks/plan3-skm/index.json` 완료 처리

`status`를 `"completed"`, `current_phase`를 `4`로 바꾼다.

## 검증

```bash
pnpm run build
pnpm test
node dist/index.js commands --json | grep -c '"path": "skm'   # 23
grep -c "skm" README.md   # 3 이상
grep -c "references/skm.md" skills/nhncloud-cli/SKILL.md   # 1
grep -c "Secure Key Manager" skills/nhncloud-cli/references/troubleshooting.md   # 1
test -f skills/nhncloud-cli/references/skm.md
grep -rnoE "(https?://|@)[A-Za-z0-9.-]+\.(com|co\.kr|net)" README.md skills/ docs/ AGENTS.md CLAUDE.md src/ tasks/ .agents/ .claude/ .codex/ .github/ 2>/dev/null | grep -vE "nhncloud\.com|nhncloudservice\.com|github\.com|npmjs\.com|example\.com|openai\.com|anthropic\.com" | wc -l   # 0
grep -rnE "(secret|password|appkey)['\"]?[[:space:]]*[:=][[:space:]]*['\"][A-Za-z0-9]{16,}" README.md skills/ docs/ AGENTS.md CLAUDE.md src/ tasks/ .agents/ .claude/ .codex/ .github/ 2>/dev/null | wc -l   # 0
jq -e '.status == "completed" and .current_phase == .total_phases and (.total_phases == (.phases | length))' tasks/plan3-skm/index.json
git diff --check
```

## 변경 파일

| 파일 | 변경 |
|---|---|
| `skills/nhncloud-cli/references/skm.md` | 신규 |
| `skills/nhncloud-cli/SKILL.md` | 수정 |
| `skills/nhncloud-cli/references/troubleshooting.md` | 수정 |
| `skills/nhncloud-cli/references/common.md` | 수정 |
| `README.md` | 수정 |
| `tasks/plan3-skm/index.json` | 수정 |
