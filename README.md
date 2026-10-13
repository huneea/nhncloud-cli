# nhncloud-cli

[![npm version](https://img.shields.io/npm/v/@bifos/nhncloud-cli.svg)](https://www.npmjs.com/package/@bifos/nhncloud-cli)
[![npm downloads](https://img.shields.io/npm/dm/@bifos/nhncloud-cli.svg)](https://www.npmjs.com/package/@bifos/nhncloud-cli)
[![CI](https://github.com/jon890/nhncloud-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/jon890/nhncloud-cli/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@bifos/nhncloud-cli.svg)](https://github.com/jon890/nhncloud-cli/blob/main/LICENSE)

[NHN Cloud](https://www.nhncloud.com) 를 터미널과 AI 에이전트에서 쓸 수 있게 해 주는 비공식 CLI 예요.
NHN 이 만든 공식 제품이 아니에요.

인스턴스, 네트워크, 로드밸런서, Kubernetes, 컨테이너 레지스트리와 컨테이너 서비스, 로그 검색, 배포, API Gateway, 키 관리를 명령 한 줄로 다루고, 결과를 `--json` 으로 내보내요.
Claude Code 나 Codex 에 스킬로 설치하면 "인스턴스 목록 보여줘" 같은 말을 그대로 알아듣고 처리해요.

```bash
npm install -g @bifos/nhncloud-cli
nhncloud configure
nhncloud skills install
```

```
"인스턴스 목록 보여줘"
"kr1 리전에 인스턴스 만들고 ACTIVE 될 때까지 기다려줘"
"최근 1시간 에러 로그 찾아줘"
"배포 실행하고 완료되면 알려줘"
"클러스터 kubeconfig 받아줘"
```

## 이런 분께 맞아요

- NHN Cloud 콘솔을 열지 않고 터미널에서 리소스를 확인하고 바꾸고 싶은 분
- AI 에이전트에게 인스턴스 관리, 로그 조회, 배포 실행을 맡기고 싶은 분
- 로그 추출이나 배포처럼 반복되는 작업을 스크립트로 자동화하고 싶은 분

## 빠른 시작

Node.js 20.18.1 이상이 필요해요.

### 1. 설치해요

```bash
npm install -g @bifos/nhncloud-cli
```

### 2. 자격증명을 설정해요

아래 명령을 실행하면 profile 과 서비스별 자격증명을 차례로 물어봐요.
쓰는 서비스의 값만 입력해도 돼요.
저장하기 전에 연결 테스트를 자동으로 수행해요.

```bash
nhncloud configure
```

인스턴스, 네트워크 같은 IaaS 명령을 쓴다면 두 값을 특히 조심해 주세요.

- "API 비밀번호"(`--iaas-password`)는 콘솔 로그인 비밀번호가 아니라 IAM 의 **API 비밀번호**예요. IAM 사용자 상세 페이지의 "API 비밀번호 설정"에서 따로 발급해요.
- "IAM username"(`--iaas-username`)은 계정 이메일이나 IAM 계정 ID 예요. tenantId 와 비슷하게 생긴 UUID 형태의 "API 사용자 ID"가 아니에요.

나머지 입력 항목은 [IaaS 가이드](skills/nhncloud-cli/references/iaas.md)에 있어요.
공공기관용 NHN Cloud 설정은 [공통 가이드](skills/nhncloud-cli/references/common.md)에 있어요.

### 3. 설정을 확인해요

```bash
nhncloud doctor
nhncloud doctor --check-connection   # 대상 profile 의 실제 연결까지 확인
```

`doctor` 는 기본으로 외부 API 를 호출하지 않고 자격증명, 설정 파일, 스킬 설치 상태를 확인해요.
`--check-connection` 을 주면 대상 profile 의 자격증명으로 실제 연결까지 확인해요.

### 4. 첫 명령을 실행해요

```bash
nhncloud instance list --region kr1    # 인스턴스 목록
nhncloud network list --region kr1     # VPC 목록
```

`--region` 은 IaaS 와 NKS 계열에서 결과가 달라지므로, 기본값에 기대지 말고 직접 지정하는 편이 안전해요.

### 5. AI 에이전트에 연결해요 (선택)

Claude Code 나 Codex 를 쓴다면 스킬을 설치해요. 에이전트가 이 CLI 의 사용법을 알게 돼요.
설치하면 Claude Code 의 `~/.claude/skills/nhncloud-cli` 와 Codex 의 `~/.agents/skills/nhncloud-cli` 에 함께 연결돼요.

```bash
nhncloud skills install
nhncloud skills status
```

이제 에이전트에게 한국어로 시키면 돼요.
에이전트가 알맞은 `nhncloud` 명령을 고르고, 필요하면 인스턴스 id 나 VPC id 를 먼저 조회해요.

CLI 를 새 버전으로 올린 뒤에는 `nhncloud skills update` 를 한 번 실행해 주세요. 그래야 스킬도 함께 갱신돼요.
전역 설치 없이 `npx --yes @bifos/nhncloud-cli@latest skills install` 로도 설치할 수 있어요.

## 할 수 있는 일

| 영역 | 대표 명령 | 가이드 |
| --- | --- | --- |
| Compute 인스턴스 | `nhncloud instance` | [IaaS](skills/nhncloud-cli/references/iaas.md) |
| 네트워크, 보안그룹 | `nhncloud network` | [IaaS](skills/nhncloud-cli/references/iaas.md) |
| Block Storage | `nhncloud volume` | [IaaS](skills/nhncloud-cli/references/iaas.md) |
| Floating IP | `nhncloud floatingip` | [IaaS](skills/nhncloud-cli/references/iaas.md) |
| Load Balancer, IP ACL | `nhncloud loadbalancer` | [Load Balancer](skills/nhncloud-cli/references/loadbalancer.md) |
| Log & Crash | `nhncloud logncrash` | [Log & Crash](skills/nhncloud-cli/references/logncrash.md) |
| Deploy | `nhncloud deploy` | [Deploy](skills/nhncloud-cli/references/deploy.md) |
| Container Registry | `nhncloud ncr` | [NCR](skills/nhncloud-cli/references/ncr.md) |
| Kubernetes Service | `nhncloud nks` | [NKS](skills/nhncloud-cli/references/nks.md) |
| Container Service | `nhncloud ncs` | [NCS](skills/nhncloud-cli/references/ncs.md) |
| API Gateway | `nhncloud apigateway` | [API Gateway](skills/nhncloud-cli/references/apigateway.md) |
| Secure Key Manager | `nhncloud skm` | [SKM](skills/nhncloud-cli/references/skm.md) |
| 설정과 진단 | `nhncloud configure`, `nhncloud doctor`, `nhncloud skills` | [공통](skills/nhncloud-cli/references/common.md) |

명령과 옵션 전체는 카탈로그로 확인할 수 있어요.
외부 API 를 호출하지 않고 명령 트리 정보만 출력해요.

```bash
nhncloud commands --json | jq '.commands[] | select(.path=="nks cluster list")'
```

## 에이전트 없이 직접 쓰기

터미널에서 바로 써도 돼요.

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
nhncloud apigateway service list                              # API Gateway 서비스
nhncloud apigateway stage deploy create <service-id> <stage-id> --yes  # API Gateway 스테이지 배포
nhncloud skm key list <keystore-id>                           # Secure Key Manager 키 목록
nhncloud skm secret get <key-id> --quiet                      # 기밀 데이터 원문
nhncloud skm secret get <key-id> --field <name> --quiet   # JSON 기밀 데이터의 필드 하나
printf '%s' "$VALUE" | nhncloud skm secret patch <key-id> <field> --replace --yes   # JSON 기밀 데이터의 필드 하나만 바꾸기
```

삭제처럼 되돌리기 어려운 일부 명령은 `--yes` 를 붙여야 실행돼요. 비대화형 환경에서 `--yes` 가 없으면 API 를 호출하기 전에 끝나요.
확인 없이 바로 실행되는 변경 명령도 있으니, 에이전트에게 맡기기 전에 [공통 가이드](skills/nhncloud-cli/references/common.md)의 「되돌릴 수 없는 명령」 절을 먼저 봐 주세요.

명령과 옵션은 `--help` 로 볼 수 있어요.

```bash
nhncloud --help
nhncloud instance --help
nhncloud instance create --help
```

### 출력 형식을 골라요

| 옵션 | 출력 | 쓰는 곳 |
| --- | --- | --- |
| (없음) | 사람이 읽기 좋은 표 | 터미널 |
| `--json` | JSON | 다른 프로그램에서 읽을 때 |
| `--quiet` | 명령이 문서화한 핵심 값 한 줄 | 셸 스크립트 |

```bash
nhncloud instance get <instance-id> --json | jq -r '.status'
nhncloud logncrash available-token --json | jq -r '.availableToken'
```

`--json` 은 CLI 가 가공한 출력이라 원본 응답과 모양이 달라요. 명령별 모양은 「할 수 있는 일」 표의 서비스별 가이드에 있어요.
요청 타임아웃, 환경변수, 비대화형 설정은 [공통 가이드](skills/nhncloud-cli/references/common.md)에 있어요.

## 더 알아보기

| 문서 | 내용 |
| --- | --- |
| [스킬 문서](skills/nhncloud-cli/SKILL.md) | 에이전트가 읽는 명령 목록과 판단 기준 |
| [공통 가이드](skills/nhncloud-cli/references/common.md) | 초기 설정, profile, 공공망, 출력 모드, 타임아웃 |
| [문제 해결](skills/nhncloud-cli/references/troubleshooting.md) | 종료 코드와 증상별 대처 |
| [docs/data-schema.md](docs/data-schema.md) | 자격증명과 설정 파일 스키마 |
| [docs/code-architecture.md](docs/code-architecture.md) | 코드 구조와 경계 |

## 문제가 생기면

- 설정이 의심되면 `nhncloud doctor` 를 먼저 실행해 보세요.
- 에이전트가 새 명령을 모르면 `nhncloud skills update` 를 실행해 주세요.
- 프록시를 거쳐야 하면 `--proxy http://proxy.example:3128` 또는 `HTTPS_PROXY` 를 지정해요. 자세한 규칙은 [공통 가이드](skills/nhncloud-cli/references/common.md)의 「프록시」 절에 있어요.
- 종료 코드별 대처는 [문제 해결](skills/nhncloud-cli/references/troubleshooting.md)에 있어요.
- 버그나 제안은 [GitHub Issues](https://github.com/jon890/nhncloud-cli/issues) 에 남겨 주세요. 설정 문제라면 `nhncloud doctor --json` 출력을 함께 붙여 주세요.
  비밀값은 출력에 들어가지 않지만 파일 경로에 사용자 이름이 보일 수 있으니 필요하면 가려 주세요.

## 기여하기

이슈와 PR 모두 환영해요.
개발 환경은 아래 명령으로 준비해요.

```bash
git clone https://github.com/jon890/nhncloud-cli.git
cd nhncloud-cli
pnpm install
pnpm run build
pnpm tsc --noEmit
pnpm test
```

새 명령을 추가하는 규칙은 [AGENTS.md](AGENTS.md) 와 [docs/code-architecture.md](docs/code-architecture.md) 에 있어요.
커밋과 PR 제목은 `type(scope): 설명` 형식으로, 커밋 메시지와 PR 본문은 한국어로 써 주세요.
이 저장소는 공개돼요. 실제 자격증명이나 리소스 ID 는 남기지 말고 `<instance-id>` 같은 placeholder 를 써 주세요.

## 라이선스

[MIT](LICENSE)
