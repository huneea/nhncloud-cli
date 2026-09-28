# Common Reference

CLI와 공개 스킬 설치, configure, profile, 출력 모드, 에러 코드를 다룬다.
서비스별 세부 명령은 각 reference를 읽는다.

## 설치

```bash
npm install -g @bifos/nhncloud-cli
```

## Claude Code 공개 스킬 관리

전역 설치한 CLI나 `npx`로 패키지의 공개 스킬을 관리 저장소에 설치할 수 있다.
관리 저장소는 실행 중인 npm 패키지 경로와 분리되므로 `npx`의 임시 패키지 경로가 사라져도 활성 스킬은 유지된다.

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
| `current` | 현재 CLI 버전과 콘텐츠 해시가 일치함 | 조치 없음 |
| `missing` | 활성 스킬이 설치되지 않음 | `nhncloud skills install` |
| `outdated` | 이전 버전 또는 기존 패키지·저장소 직접 링크 | `nhncloud skills update` |
| `broken` | 관리형 링크 또는 기존 패키지 링크의 대상이 없음 | `nhncloud skills update` |
| `modified` | 관리 저장소 콘텐츠가 설치 매니페스트와 다름 | 내용을 확인한 뒤 `nhncloud skills update --force` |
| `corrupt` | 관리 저장소 경로나 매니페스트가 손상됨 | 내용을 확인한 뒤 `nhncloud skills update --force` |
| `unmanaged` | 사용자가 만든 파일·디렉터리 또는 알 수 없는 링크가 설치 경로를 차지함 | 내용을 확인한 뒤 `nhncloud skills update --force` |

`--force`는 사용자 항목 또는 수정·손상된 관리 저장소를 삭제하지 않고 같은 상위 디렉터리에 백업한 뒤 교체한다.
`nhncloud skills uninstall`은 `~/.claude/skills/nhncloud-cli`의 활성 심볼릭 링크만 제거하며 버전별 관리 저장소는 보존한다.
설치 경로가 사용자 파일이나 실제 디렉터리이면 제거하지 않는다.

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
`--quiet`은 상태 토큰 하나만 stdout에 출력한다.

## 초기 설정

첫 설정은 `nhncloud configure`로 한다.
대화형 마법사가 profile, UAK, 서비스별 자격증명을 묻고 저장 전 연결을 테스트한다.

공공망 profile에는 `~/.nhncloud/credentials.json`의 해당 profile 블록에 `"environment": "gov"`를 명시한다.
기존 profile은 이 필드를 생략하면 일반망을 사용한다.
현재 공공망 endpoint 선택 대상은 OAuth, Deploy, NCR, IaaS이며 공공망에서 주소가 확인되지 않은 API는 호출하지 않는다.
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

## Command catalog

`nhncloud commands`는 Commander tree에서 command path, argument, option, description을 출력한다.
외부 API를 호출하지 않는 read-only metadata 명령이다.

```bash
nhncloud commands
nhncloud commands --json
nhncloud commands --json | jq '.commands[] | select(.path=="nks cluster list")'
```

AI 에이전트는 먼저 `commands --json`으로 실제 command path와 option 이름을 확인하고, 그다음 서비스 reference를 읽는다.

## 되돌릴 수 없는 명령

실행 전에 대상과 변경 범위를 조회한다. 확인 방식은 명령마다 다르다.

| 확인 방식 | 명령 |
|---|---|
| TTY 여부와 관계없이 `--yes` 필수 | `apigateway stage update`, `apigateway stage import-resources`, `apigateway stage deploy create`, `apigateway stage deploy rollback`, `apigateway resource set-path-plugin`, `apigateway resource set-method-plugin` (`--dry-run` 제외), `loadbalancer ipacl delete`, `loadbalancer ipacl target add`, `loadbalancer ipacl target remove`, `loadbalancer set-ipacl`, `loadbalancer clear-ipacl` |
| 비대화형 환경에서는 `--yes` 필수, TTY에서는 확인 질문 | `instance delete`, `floatingip delete`, `nks cluster delete`, `nks cluster addon remove`, `nks nodegroup delete`, `ncs template delete`, `ncs template version delete`, `ncs workload delete` |
| 확인 질문과 `--yes` 없음 | `instance keypair delete`, `deploy run`, `nks cluster resize --nodes-to-remove`, `nks nodegroup upgrade`, `ncs workload update` (PUT 전체 교체), `instance volume detach` |

`nks cluster resize`는 `--nodes-to-remove`를 생략해도 확인 없이 실행되며, 감축 대상 노드를 API가 선택할 수 있다는 경고를 출력한다.
