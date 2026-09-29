# nhncloud-cli

[![npm version](https://img.shields.io/npm/v/@bifos/nhncloud-cli.svg)](https://www.npmjs.com/package/@bifos/nhncloud-cli)
[![npm downloads](https://img.shields.io/npm/dm/@bifos/nhncloud-cli.svg)](https://www.npmjs.com/package/@bifos/nhncloud-cli)
[![CI](https://github.com/jon890/nhncloud-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/jon890/nhncloud-cli/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@bifos/nhncloud-cli.svg)](https://github.com/jon890/nhncloud-cli/blob/main/LICENSE)

[NHN Cloud](https://www.nhncloud.com) 를 AI 에이전트가 다룰 수 있게 만든 CLI 다.

Compute·Network·Block Storage·Load Balancer·Container Registry·Kubernetes·Container Service·Log & Crash·Deploy·API Gateway 를 명령 한 줄로 다루고, 결과를 `--json` 으로 내보낸다.
Claude Code 같은 에이전트에 스킬로 설치하면 "인스턴스 목록 보여줘" 같은 자연어 지시를 그대로 처리한다.

```bash
npm install -g @bifos/nhncloud-cli
nhncloud configure
nhncloud skills install
```

## 설치와 설정

Node.js 20 이상이 필요하다.

```bash
npm install -g @bifos/nhncloud-cli
```

`nhncloud configure` 가 profile 과 서비스별 자격증명을 대화형으로 받는다.
공통 UAK, Log & Crash appkey, iaas 자격증명, NCR appkey, NCS appkey, Deploy appkey 순으로 입력한다.
appkey 는 명령 옵션으로 지정할 수 없고 profile 에만 둔다.
여러 프로젝트를 다루려면 profile 을 나눠 `--profile` 로 전환한다.
저장 전 연결 테스트를 자동으로 수행한다 (`--no-verify` 로 생략).

```bash
nhncloud configure
nhncloud doctor   # 설정이 제대로 됐는지 확인
```

자격증명은 `~/.nhncloud/credentials.json`(mode 0600), 설정은 `~/.nhncloud/config.json` 에 저장한다.
profile 우선순위는 `--profile` > `NHNCLOUD_PROFILE` > `config.defaultProfile` > `default` 다.

공공기관용 NHN Cloud를 사용한다면 해당 profile의 `credentials.json` 블록에 `"environment": "gov"`를 추가한다.
기존 profile은 이 필드를 생략하면 일반망을 사용한다.
공공망 endpoint 선택은 OAuth, Deploy, NCR, IaaS 호출에 적용된다.
공공망 NCR은 `kr1`, IaaS는 `kr1`과 `kr2`만 지원한다.

```json
{
  "version": 1,
  "profiles": {
    "public-project": {
      "environment": "gov",
      "userAccessKey": { "id": "<uak-id>", "secret": "<uak-secret>" },
      "deploy": { "appkey": "<appkey>" }
    }
  }
}
```

`nhncloud deploy artifacts --profile public-project --json`으로 조회할 수 있다.
현재 `configure`의 연결 테스트는 일반망 주소를 사용하므로, 공공망 자격증명을 저장할 때는 `--no-verify`를 지정한다.
공공망 표시를 추가한 뒤 조회 명령으로 연결과 권한을 확인한다.

> **iaas 자격증명의 함정 두 가지**
>
> `--iaas-password` 는 NHN Cloud 콘솔 IAM 의 **API 비밀번호**다. 로그인 비밀번호와 다르다.
> IAM 사용자 상세 페이지의 "API 비밀번호 설정"에서 따로 발급한다.
>
> `--iaas-username` 은 계정 이메일 또는 **IAM 계정 ID(사번)** 다.
> tenantId 와 비슷하게 생긴 "API 사용자 ID"(UUID) 가 아니다.

CI·자동화는 flag 로 비대화형 설정한다. 비밀번호는 환경변수를 권장한다.

```bash
NHNCLOUD_IAAS_PASSWORD=<api-password> nhncloud configure \
  --uak-id <uak-id> --uak-secret <uak-secret> \
  --logncrash-appkey <appkey> \
  [--deploy-appkey <appkey>] [--ncr-appkey <appkey>] [--ncs-appkey <appkey>] \
  --iaas-tenant-id <tenant-id> --iaas-username <iam-username> --iaas-region kr1 \
  --no-verify
```

에이전트에서 쓰려면 스킬을 설치한다. Claude Code 가 이 CLI 의 사용법을 알게 된다.

```bash
nhncloud skills install
nhncloud skills status
```

전역 설치 없이 `npx --yes @bifos/nhncloud-cli@latest skills install` 로도 설치된다.
관리 저장소에 복사되므로 임시 패키지 경로가 사라져도 남는다.
CLI 를 새 버전으로 올린 뒤에는 `nhncloud skills update` 를 실행해야 스킬도 갱신된다.

상태는 `current`, `missing`, `outdated`, `broken`, `unmanaged`, `modified`, `corrupt` 중 하나이고, 출력에 딸린 복구 명령을 따르면 된다.
사용자 항목이나 수정·손상된 저장소는 자동으로 덮어쓰지 않는다.

## 사용법

설정을 마치면 에이전트에게 한국어로 시키면 된다.

```
"인스턴스 목록 보여줘"
"kr1 리전에 인스턴스 만들고 ACTIVE 될 때까지 기다려줘"
"최근 1시간 에러 로그 찾아줘"
"배포 실행하고 완료되면 알려줘"
"이 로드밸런서에 IP ACL 그룹 붙여줘"
"클러스터 kubeconfig 받아줘"
"레지스트리 이미지 태그 목록 보여줘"
```

에이전트가 알맞은 `nhncloud` 명령으로 옮기고, 필요하면 인스턴스 id 나 VPC id 를 먼저 조회한다.

에이전트가 쓰는 명령 카탈로그와 판단 기준은 [스킬 문서](skills/nhncloud-cli/SKILL.md)에 있다.
서비스별 상세는 [references/](skills/nhncloud-cli/references/) 아래 파일로 나뉘어 있다.

## 에이전트 없이 직접 쓰기

터미널에서 바로 쓸 수도 있다.

```bash
nhncloud instance list                                        # 인스턴스 목록
nhncloud instance get <instance-id>                           # 인스턴스 상세
nhncloud network list                                         # VPC 목록
nhncloud network security-group list                          # 보안그룹 목록
nhncloud instance security-group add <instance-id> <group> --yes  # 인스턴스에 보안그룹 연결
nhncloud volume list                                          # 블록 스토리지 볼륨
nhncloud floatingip list                                      # Floating IP
nhncloud loadbalancer list                                    # 로드밸런서
nhncloud ncr list                                             # 컨테이너 레지스트리
nhncloud nks cluster list                                     # Kubernetes 클러스터
nhncloud deploy artifacts                                     # 배포 아티팩트
nhncloud deploy scenarios --artifact-id <id> --server-group-id <id>  # 서버그룹 시나리오
nhncloud logncrash available-token                            # 남은 조회 토큰과 추정 대기 시간
nhncloud logncrash search --query '*' --from 1h --to now      # 최근 1시간 로그
nhncloud logncrash export --query '<lucene>' --from 1h --to now --output logs.jsonl  # 대량 로그 파일 저장
nhncloud apigateway service list                               # API Gateway 서비스
nhncloud apigateway stage update <service-id> <stage-id> --description "설명" --yes  # API Gateway 스테이지 수정
nhncloud apigateway stage import-resources <service-id> <stage-id> --yes             # 리소스를 스테이지로 반영
nhncloud apigateway stage deploy create <service-id> <stage-id> --yes                 # API Gateway 스테이지 배포
```

전체 명령과 옵션은 `--help` 로 본다.

```bash
nhncloud --help
nhncloud instance --help
nhncloud instance create --help
```

기계가 읽을 카탈로그가 필요하면 `commands` 를 쓴다. 외부 API 를 호출하지 않고 Commander 트리 메타데이터만 출력한다.

```bash
nhncloud commands --json | jq '.commands[] | select(.path=="nks cluster list")'
```

출력은 세 가지 모드다.

| 플래그 | 출력 | 쓰는 곳 |
| --- | --- | --- |
| (없음) | 사람이 읽는 표 | 터미널 |
| `--json` | JSON | 파싱, 명령 연결 |
| `--quiet` | 명령이 문서화한 핵심 값 한 줄 | 스크립트 |

전역 옵션이라 모든 명령에 붙일 수 있다. `--no-color` 와 `--request-timeout <sec>` 도 같은 자리에서 쓴다.
요청 타임아웃은 초 단위이며 기본값은 30초, 허용 범위는 1~3600초다.
`NHNCLOUD_REQUEST_TIMEOUT` 환경변수로도 지정할 수 있으며 명령줄 옵션이 환경변수보다 우선한다.

`--json` 은 CLI 가 가공한 출력 계약이라 원본 응답의 최상위 래퍼를 그대로 보존하지 않는다.
예를 들어 `instance get --json` 은 `.server.status` 가 아니라 `.status` 를 읽는다.
명령별 shape 는 [common.md 의 JSON shape 요약](skills/nhncloud-cli/references/common.md)에 있다.

```bash
nhncloud instance get <instance-id> --json | jq -r '.status'
nhncloud logncrash available-token --json | jq -r '.availableToken'
nhncloud logncrash search --query '*' --from 1h --to now --json | jq -r '.data[].logBody'
```

### 종료 코드

| 코드 | 의미 |
| :---: | --- |
| 0 | 성공 |
| 1 | API 오류 |
| 2 | 인증 실패 (401/403) |
| 3 | 입력 오류 (파라미터·시간 범위) |
| 4 | 설정 오류 (자격증명 누락) |

### 되돌리기 어려운 명령의 확인

삭제·전체 교체처럼 되돌리기 어려운 명령은 실행 전 확인을 요구한다.
자동화·파이프 등 비대화형 실행에서는 `--yes` 를 명시해야 한다.
플래그가 없으면 API 를 호출하기 전에 종료 코드 3 으로 끝난다.

`--region` 은 IaaS 와 NKS 계열에서 결과를 가르므로, 기본값에 기대지 말고 명시하는 편이 안전하다.

## 프로젝트 구조

```
src/
  index.ts       CLI 진입점
  api/           공통 endpoint, 응답 봉투, HTTP 오류 처리 (ky)
  services/      서비스별 API 클라이언트와 타입 가드
  commands/      Commander.js 명령 정의
  config/        ~/.nhncloud/ 자격증명·설정 스키마와 profile 해석
  cache/         ~/.nhncloud/cache/ 토큰 캐시
  formatters/    표·JSON·quiet 출력
  skill/         Claude Code 스킬 설치·갱신
  utils/         에러, 스피너, 종료 코드
```

`commands/`는 `services/`, `api/`, `config/`의 기능을 조합한다.
`services/`가 `commands/`를 import하지 않는 경계와 상세 의존 방향은 `docs/code-architecture.md`를 기준으로 삼는다.

| 문서 | 담는 것 |
| --- | --- |
| [docs/prd.md](docs/prd.md) | 제품 목적과 범위 |
| [docs/flow.md](docs/flow.md) | 사용자 흐름 |
| [docs/code-architecture.md](docs/code-architecture.md) | 디렉터리 트리, 레이어, 경계 |
| [docs/data-schema.md](docs/data-schema.md) | 자격증명과 캐시 스키마 |
| [docs/adr/INDEX.md](docs/adr/INDEX.md) | 기술 의사결정 기록 |
| [docs/pitfalls/INDEX.md](docs/pitfalls/INDEX.md) | 반복해서 발견된 회피 패턴 |

## 기여하기

이슈와 PR 모두 환영한다.

### 개발 환경

```bash
git clone https://github.com/jon890/nhncloud-cli.git
cd nhncloud-cli
pnpm install

pnpm run build       # tsup 으로 dist/index.js 단일 번들 생성
pnpm test            # vitest
pnpm tsc --noEmit    # 타입 검사 (빌드는 타입을 검사하지 않는다)

node dist/index.js --help        # 빌드 결과 직접 실행
node dist/index.js commands --json
```

`pnpm` 을 쓴다. 빌드는 `tsup`(esbuild) 이 담당하고 `tsc` 는 타입 검사 전용이므로,
타입 오류를 잡으려면 `pnpm tsc --noEmit` 를 따로 돌려야 한다.

### 새 명령을 추가할 때

1. [공식 API 문서](https://docs.nhncloud.com)로 엔드포인트와 요청·응답 구조를 먼저 확인한다. 확정할 수 없으면 추측해 구현하지 않는다
2. `src/services/<service>/` 에 API 클라이언트와 타입 가드를 둔다. 공식 예제 JSON 과 필드 타입을 맞춘다
3. `src/commands/<service>/` 에 명령을 정의한다. 인접한 명령의 구조를 따르는 것이 가장 빠르다
4. 출력은 `src/formatters/` 에서 표·JSON·quiet 세 모드를 모두 지원한다
5. `src/**/*.test.ts` 에 테스트를 추가한다
6. 명령이나 옵션이 바뀌면 이 README 와 `skills/nhncloud-cli/references/` 를 함께 갱신한다

HTTP 호출은 `ky` 만 쓰고, 사용자 오류는 `NhnCloudCliError` 와 `src/utils/exit-codes.ts` 의 종료 코드를 쓴다.
데이터는 stdout, 진행 상황·경고·오류는 stderr 로 분리한다.

NHN Cloud API 가 문서와 다르거나 직관에 반하면 [docs/adr/](docs/adr/) 에 기록한다.
엔드포인트 버전 이중 prefix 나 200 응답 속 `isSuccessful: false`처럼 직관에 반하는 동작은 관련 ADR과 반복 함정 문서에서 확인한다.

### PR 을 낼 때

- 커밋과 PR 제목은 `type(scope): 설명` 형식을 쓴다
- 커밋 메시지와 PR 본문은 한국어로 쓴다
- PR 을 열면 CI 가 타입 검사·테스트·빌드를 돌리고, Claude 가 코드 리뷰를 남긴다
- 리뷰의 🔴 항목은 머지 전에 반영한다

이 저장소와 npm 패키지는 공개된다.
문서·코드·테스트 fixture·이슈 본문에 실제 자격증명이나 사용자 리소스 ID 를 남기지 않고 `<instance-id>` 같은 placeholder 로 바꾼다.

### 버그와 제안

[GitHub Issues](https://github.com/jon890/nhncloud-cli/issues) 에 올린다.
설정 문제라면 `nhncloud doctor` 출력을 함께 붙이면 진단이 빠르다 (비밀값은 가려서 붙인다).

## 기술 스택

| 분류 | 사용 |
| --- | --- |
| 언어·런타임 | TypeScript, Node.js 20+ |
| CLI 프레임워크 | Commander.js |
| HTTP | ky |
| 출력 | chalk, cli-table3, ora |
| 대화형 입력 | @inquirer/prompts |
| 빌드 | tsup (CJS 단일 번들) |
| 테스트 | vitest |

## 라이선스

MIT
