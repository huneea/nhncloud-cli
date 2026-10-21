# Common Reference

공개 스킬 관리, configure, profile, 출력 모드, 에러 코드를 다룬다.
서비스별 세부 명령은 각 reference를 읽는다.

## Claude Code·Codex 공개 스킬 관리

설치 경로는 Claude Code 의 `~/.claude/skills/nhncloud-cli` 와 Codex 의 `~/.agents/skills/nhncloud-cli` 다.
두 경로는 같은 관리 저장소를 가리킨다.
Codex 를 설치했는지와 관계없이 두 경로를 만들고, 필요하면 `~/.agents/skills` 디렉터리도 만든다.
이전에 Claude Code 경로에만 설치했다면 `nhncloud skills install` 이나 `update` 를 다시 실행해 Codex 경로를 연결한다.

```bash
# 전역 설치한 CLI에서 설치
nhncloud skills install

# 전역 설치 없이 최신 공개 스킬 설치
npx --yes @bifos/nhncloud-cli@latest skills install

# 상태 확인 (`nhncloud skills`도 동일)
nhncloud skills status
```

npm 패키지와 설치된 공개 스킬은 자동으로 함께 갱신되지 않는다.
패키지를 먼저 갱신한 뒤 새 CLI로 스킬 갱신을 명시적으로 실행한다.

```bash
npm install -g @bifos/nhncloud-cli@latest
nhncloud skills update
```

상태별 의미와 복구 명령:

| 상태 | 의미 | 복구 명령 |
|------|------|-----------|
| `current` | 모든 설치 경로가 현재 CLI 버전과 콘텐츠 해시에 일치함 | 조치 없음 |
| `missing` | 한 경로라도 활성 스킬이 설치되지 않음 | `nhncloud skills install` |
| `outdated` | 한 경로라도 이전 버전 또는 기존 패키지·저장소 직접 링크임 | `nhncloud skills update` |
| `broken` | 한 경로라도 관리형 링크 또는 기존 패키지 링크의 대상이 없음 | `nhncloud skills update` |
| `modified` | 한 경로라도 관리 저장소 콘텐츠가 설치 매니페스트와 다름 | 내용을 확인한 뒤 `nhncloud skills update --force` |
| `corrupt` | 한 경로라도 관리 저장소 경로나 매니페스트가 손상됨 | 내용을 확인한 뒤 `nhncloud skills update --force` |
| `unmanaged` | 한 경로라도 사용자가 만든 파일·디렉터리 또는 알 수 없는 링크가 설치 경로를 차지함 | 내용을 확인한 뒤 `nhncloud skills update --force` |

상태는 설치 경로를 합친 값이고 위 표의 `corrupt`부터 `current` 방향으로 먼저 해당하는 값이다.
`status --json`의 최상위 `destination`, `linkTarget`, `managed`는 Claude Code 경로 값이다. 경로별 상세의 위치는 아래 `--json` 설명이 명령별로 정한다.

두 경로가 모두 `current` 일 때만 상태가 `current` 다.

`--force`는 사용자 항목 또는 수정·손상된 관리 저장소를 삭제하지 않고 같은 상위 디렉터리에 백업한 뒤 교체한다.
한 경로라도 `unmanaged`, `modified`, `corrupt` 면 `--force` 없이는 어느 경로도 바꾸지 않는다.
다른 링크를 거쳐 가다가 대상이 사라진 링크(예: `~/.agents/skills/nhncloud-cli` 가 없는 `~/.claude/skills/nhncloud-cli` 를 가리킴)도 `unmanaged` 로 판정한다. 링크가 가리키는 곳을 확인한 뒤 `--force` 로 교체한다.
한 경로의 전환이 실패하면 이미 바꾼 경로를 이전 상태로 되돌린다.
`nhncloud skills uninstall`은 두 설치 경로의 활성 심볼릭 링크만 제거하며 버전별 관리 저장소는 보존한다.
한 경로라도 사용자 파일, 실제 디렉터리, 알 수 없는 링크이면 어느 링크도 제거하지 않는다.

자동화에서는 모든 하위 명령에 전역 출력 옵션을 함께 사용할 수 있다.

```bash
# 전체 상태 객체
nhncloud skills status --json

# 상태 토큰 하나만 출력
nhncloud skills status --quiet

# 갱신 결과의 상태 전이와 백업 경로 확인
nhncloud skills update --force --json

# 제거 결과 토큰만 출력 (`missing`)
nhncloud skills uninstall --quiet
```

`--json`은 상태·변경 여부·백업 경로처럼 자동화에 필요한 필드를 제공한다.
경로별 정보는 `agents.claude`, `agents.codex` 에 있고 위치는 명령마다 다르다.
`status` 는 최상위 `agents.*` 에 경로별 상세를 두고, 최상위 필드는 합친 `status` 를 빼면 Claude Code 경로의 상세다.
`install` 과 `update` 는 `status.agents.*` 에 경로별 상세를 둔다.
`uninstall` 은 최상위 `agents.*` 에 경로별 `action` 과 `destination` 을 둔다.
`--quiet`은 상태 토큰 하나만 stdout에 출력한다.

Codex 에서는 `$nhncloud-cli` 로 스킬을 부를 수 있다.
설치한 스킬이 Codex 에 보이지 않으면 Codex 를 다시 시작한다.

## 초기 설정

첫 설정은 `nhncloud configure`로 한다.
대화형 마법사가 profile, UAK, 서비스별 자격증명을 묻고 저장 전 연결을 테스트한다.

공공망 profile에는 `~/.nhncloud/credentials.json`의 해당 profile 블록에 `"environment": "gov"`를 명시한다.
기존 profile은 이 필드를 생략하면 일반망을 사용한다.
공공망에서 주소가 확인되지 않은 API는 호출하지 않는다.
`configure`의 연결 테스트는 일반망 주소를 사용한다. 공공망 자격증명은 `--no-verify`로 저장하고, profile에 `environment`를 추가한 뒤 조회 명령으로 확인한다.

```bash
nhncloud configure
nhncloud configure --profile staging
```

CI나 자동화에서는 flag로 비대화형 저장을 한다.

```bash
nhncloud configure \
  --uak-id <uak-id> --uak-secret <uak-secret> \
  --logncrash-appkey <appkey> \
  --ncr-appkey <appkey> \
  --skm-appkey <appkey> \
  --rds-mysql-appkey <appkey> \
  --no-verify
```

Log & Crash Search v3는 서비스 appkey와 profile 공통 UAK를 함께 사용한다.
CLI가 UAK를 OAuth 토큰으로 교환하므로 별도 logncrash secret은 저장하지 않는다.

```json
{
  "version": 1,
  "profiles": {
    "default": {
      "userAccessKey": {
        "id": "<uak-id>",
        "secret": "<uak-secret>"
      },
      "logncrash": {
        "appkey": "<appkey>"
      }
    }
  }
}
```

설정 가능한 전체 옵션은 `nhncloud configure --help`에서 확인한다.
폐기 예정인 `--logncrash-secret`은 경고 후 사용·저장하지 않는다.

저장 파일은 `~/.nhncloud/credentials.json`이고 mode 0600으로 관리된다.
기본 profile은 선택적으로 `~/.nhncloud/config.json`의 `defaultProfile`로 지정한다.

## 설정 진단

`nhncloud doctor`는 자격증명 파일, 설정 파일, 대상 profile, 공개 스킬 상태를 진단한다.
기본 실행은 외부 API를 호출하지 않는다.
`--check-connection`을 주면 대상 profile 하나의 자격증명으로 실제 연결을 확인한다.

```bash
nhncloud doctor
nhncloud doctor --json | jq .
nhncloud doctor --profile staging --check-connection --json
nhncloud doctor --quiet          # ready 또는 not-ready
nhncloud doctor --json | jq -e '.ready'   # 준비되지 않았으면 jq 가 1 로 끝난다
```

진단 보고서를 출력했으면 종료 코드는 문제가 있어도 0이다.
실패로 끝나야 하는 점검은 `ready` 필드로 판정한다.
비밀값(UAK secret, API 비밀번호, appkey)은 어떤 출력 형식에도 넣지 않는다.

`--json` 최상위 필드:

| 필드 | 값 |
|---|---|
| `schemaVersion` | `1` |
| `ready` | 자격증명 파일이 `ok`, 대상 profile 이 있고 자격증명 블록이 하나 이상 있으며 `environment`가 올바르고, 연결 확인을 했다면 `failed`가 없을 때 `true`. `config.state`는 반영하지 않으므로 `config.json` 손상은 `config.state`로 따로 본다 |
| `credentials` | `credentials.json` 진단. 아래 표 |
| `config` | `config.json` 진단. 아래 표 |
| `profile` | `{ "name": string \| null, "exists": boolean }`. `name`은 profile 해석 순서로 정한 대상이며, `config.json` 이 JSON 이 아니라 해석하지 못하면 `null` |
| `connection` | 연결 확인 결과. 아래 표 |
| `skills` | `{ "agents": { "claude": ..., "codex": ... } }`. 에이전트별 공개 스킬 상태 |

`credentials`와 `config`:

| 필드 | 값 |
|---|---|
| `path` | 파일의 절대 경로 |
| `state` | `ok`, `missing`, `invalid`(JSON 이 아니거나 형식이 맞지 않음), `unreadable`(권한 등으로 읽지 못함) |
| `reason` | `state`가 `invalid`나 `unreadable`일 때만 있는 고정 문구. 파일 내용은 담지 않는다 |
| `permissions` | `credentials`에만 있다. 파일이 있으면 `ok`(group·other 권한 없음), `too-open`, `unknown`(Windows) |
| `profiles` | `credentials`에만 있다. `[{ "name", "environment": "real" \| "gov" \| "invalid", "blocks": string[] }]`. `blocks`는 profile 안의 블록 이름(`userAccessKey`, `iaas`, `logncrash` 등)을 정렬한 목록이다 |
| `defaultProfile` | `config`에만 있다. `defaultProfile` 값이나 `null` |

`connection`:

| 경우 | 모양 |
|---|---|
| `--check-connection` 없음 | `{ "checked": false }` |
| `--check-connection` 있음 | `{ "checked": true, "profile": string \| null, "targets": { "userAccessKey", "iaas", "logncrash", "ncr", "ncs" } }` |

`targets`의 각 값은 `{ "status", "reason"?, "exitCode"? }`다.

| `status` | `reason` | 뜻 |
|---|---|---|
| `ok` | 없음 | 연결과 인증에 성공했다 |
| `failed` | `auth` | 인증에 실패했다. 키나 appkey를 확인한다 |
| `failed` | `error` | 네트워크나 API 오류로 확인하지 못했다. `exitCode`에 그 오류의 종료 코드가 있다. Log & Crash 는 조회 한도 소진도 `failed`로 보고된다 |
| `skipped` | `not-configured` | profile 에 그 블록이 없거나 필수 값이 비어 있다 |
| `skipped` | `uak-missing` | appkey 는 있지만 함께 쓰는 공통 UAK 가 없다(`logncrash`, `ncr`, `ncs`) |
| `skipped` | `uak-failed` | `userAccessKey` 확인이 `ok`가 아니라 UAK 로 OAuth 토큰을 받는 대상(`logncrash`, `ncs`)을 확인하지 않았다 |
| `skipped` | `gov-unsupported` | 공공망 profile 이라 확인하지 않았다 |
| `skipped` | `profile-unavailable` | 자격증명 파일을 읽지 못했거나 대상 profile 이 없거나 `environment`가 올바르지 않다 |

`ncr`과 `ncs` 확인은 `kr1` region 을 가정한다.
연결 확인은 대상을 순차로 확인하며 요청마다 `--request-timeout`(기본 30초) 상한이 적용된다.
`logncrash` 확인은 최근 1분 범위의 검색 요청을 하나 보내므로 Log & Crash 조회 토큰을 쓴다.

`skills.agents.claude`와 `skills.agents.codex`는 각각 Claude Code(`~/.claude/skills/nhncloud-cli`)와 Codex(`~/.agents/skills/nhncloud-cli`) 경로 하나의 `SkillStatus`(`schemaVersion` 1)에 `recoveryCommand`(복구 명령, `current`이면 `null`)를 더한 것이다.
상태를 판정하지 못하면 `{ "status": "error", "reason": string }`이다.
한 경로의 판정이 실패해도 그 에이전트만 `error`가 되고 다른 에이전트의 상태는 그대로다.
`reason`에는 원문 오류 메시지를 넣지 않고 고정 문구만 쓴다. 오류에 문자열 errno 코드(`EACCES` 등)가 있으면 그 코드만 붙인다.
에이전트가 늘면 `agents`에 키가 추가되며 기존 키의 모양은 바뀌지 않는다.
doctor 가 경로마다 다른 복구 명령을 보여도 어느 명령이든 두 경로를 함께 고친다.

## Profile 우선순위

profile 해석 순서:

1. `--profile <name>`
2. `NHNCLOUD_PROFILE`
3. `config.defaultProfile`
4. `"default"`

자동화에서는 `--profile`을 명시해 실행 환경 차이를 줄인다.

## 출력 모드

| 플래그 | 출력 | 용도 |
|--------|------|------|
| 없음 | 사람이 읽기 좋은 table | 터미널 확인 |
| `--json` | JSON stdout | 파싱, 자동화, AI 에이전트 |
| `--quiet` | 명령이 문서화한 핵심 값 한 줄을 stdout으로 출력 | 단순 체이닝 |

`--json`의 응답 구조는 서비스 reference에서 확인한다.

## 요청 타임아웃

HTTP 요청의 기본 상한은 30초다.
조회 기간이 넓은 `logncrash search` 같은 요청은 기본 상한을 넘을 수 있으므로 전역 옵션이나 환경변수로 늘린다.

```bash
nhncloud logncrash search --query '*' --from 24h --to now --request-timeout 120 --json
NHNCLOUD_REQUEST_TIMEOUT=120 nhncloud logncrash search --query '*' --from 24h --to now --json
```

값은 초 단위이며 1~3600 사이의 정수만 허용한다.
범위를 벗어나면 API 호출 전에 종료 코드 3으로 실패한다.
우선순위는 다음과 같다.

1. `--request-timeout <sec>`
2. `NHNCLOUD_REQUEST_TIMEOUT`
3. 기본값 30초

deploy 바이너리 업로드·다운로드의 상한은 최소 600초를 유지한다.
전역 값을 600초보다 크게 지정했을 때만 함께 늘어나며, 더 작게 지정해도 바이너리 전송 상한은 낮아지지 않는다.

`instance create --timeout` 과 `ncs workload create --timeout` 은 상태 폴링 대기 시간을 지정한다.
HTTP 요청 상한과는 다른 설정이므로 서로 대체하지 않는다.

## 프록시

외부로 나가는 길이 프록시뿐인 서버에서는 전역 옵션이나 환경변수로 프록시를 지정한다.
토큰 발급을 포함한 모든 HTTP 요청이 같은 프록시를 거친다.

```bash
nhncloud --proxy http://proxy.example:3128 skm confirm --json
HTTPS_PROXY=http://proxy.example:3128 nhncloud skm confirm --json
```

우선순위는 다음과 같다.

1. `--proxy <url>`: HTTP와 HTTPS 요청 모두에 쓴다.
2. 소문자 환경변수 `https_proxy`, `http_proxy`
3. 대문자 환경변수 `HTTPS_PROXY`, `HTTP_PROXY`

- `HTTPS_PROXY` 가 없으면 HTTPS 요청에도 `HTTP_PROXY` 를 쓴다.
- `NO_PROXY`(또는 `no_proxy`)에 적은 host 는 프록시를 거치지 않는다. `--proxy` 를 줘도 `NO_PROXY` 는 그대로 적용된다.
- 빈 값은 지정하지 않은 것으로 본다. 프록시 값이 하나도 없으면 직접 연결한다.
- 값은 `http://` 또는 `https://` 로 시작하는 URL 이어야 한다. 아니면 API 호출 전에 종료 코드 3으로 실패하고, 오류 문구에는 값 대신 옵션이나 환경변수 이름만 나온다.
  이 검사는 모든 명령 앞에서 하므로 `skills`, `commands`, `configure`, `doctor` 처럼 HTTP 요청이 없는 명령도 종료 코드 3으로 끝난다.
- 프록시에 연결하지 못하면 종료 코드 1로 실패하고, 오류 문구 뒤 괄호에 원인이 붙는다(예: `fetch failed (connect ECONNREFUSED ...)`).

프록시 인증이 필요하면 `http://user:password@proxy.example:3128` 형식으로 사용자 정보를 URL 에 넣는다.
비밀번호가 셸 이력에 남지 않도록 `--proxy` 대신 환경변수로 넘긴다.

## Command catalog

`nhncloud commands`는 command path, argument, option, description을 출력한다. 외부 API를 호출하지 않는다.

```bash
nhncloud commands
nhncloud commands --json
nhncloud commands --json | jq '.commands[] | select(.path=="nks cluster list")'
```

## 되돌릴 수 없는 명령

되돌릴 수 없거나 서비스를 중단시키는 명령이다. 실행 전에 대상과 변경 범위를 조회한다. 확인 방식은 명령마다 다르다.

| 확인 방식 | 명령 |
|---|---|
| TTY 여부와 관계없이 `--yes` 필수 | `apigateway stage update`, `apigateway stage import-resources`, `apigateway stage deploy create`, `apigateway stage deploy rollback`, `apigateway resource set-path-plugin`, `apigateway resource set-method-plugin` (`--dry-run` 제외), `loadbalancer ipacl delete`, `loadbalancer ipacl target add` (`--dry-run` 제외), `loadbalancer ipacl target remove` (별칭 `delete`), `loadbalancer set-ipacl`, `loadbalancer clear-ipacl`, `network security-group delete`, `network security-group rule delete`, `instance security-group add`, `instance security-group remove`, `skm key delete`, `skm key purge`, `skm keystore delete`, `skm keystore auth delete`, `skm keystore auth purge`, `skm secret patch` (`--yes` 없으면 미리보기), `rds-mysql schema create`, `rds-mysql user create`, `rds-mysql user update`, `rds-mysql user delete` (`--yes` 없으면 미리보기) |
| 비대화형 환경에서는 `--yes` 필수, TTY에서는 확인 질문 | `instance delete`, `floatingip delete`, `nks cluster delete`, `nks cluster addon remove`, `nks nodegroup delete`, `ncs template delete`, `ncs template version delete`, `ncs workload delete` |
| 확인 질문과 `--yes` 없음 | `instance keypair delete`, `loadbalancer ipacl target update`, `deploy run`, `nks cluster resize --nodes-to-remove`, `nks nodegroup upgrade`, `ncs workload update` (PUT 전체 교체), `instance volume detach`, `instance resize`, `instance stop`, `instance reboot`, `nks nodegroup update-flavor`, `nks cluster set-ipacl`, `nks cluster set-control-plane-log`, `nks cluster update-sgw`, `ncs workload patch` (JSON Patch `remove` 포함 가능), `nks nodegroup stop-node` (지정 노드 중지), `ncs workload pause` (workload 일시정지), `ncs workload restart` (task 재시작), `instance resize-confirm` (새 flavor로 고정, 이후 `resize-revert` 불가), `skm secret update` (기밀 데이터 값 교체), `skm keystore update` (실행 위치가 키를 쓰지 못하게 될 수 있으므로 먼저 `skm confirm`) |

`nks cluster resize`는 `--nodes-to-remove`를 생략해도 확인 없이 실행되며, 감축 대상 노드를 API가 선택할 수 있다는 경고를 출력한다.
