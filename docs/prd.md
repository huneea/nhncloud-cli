# PRD: nhncloud-cli

## 한 줄 정의

NHN Cloud 서비스를 AWS CLI 처럼 터미널·AI 에이전트가 쉽게 호출하도록 돕는 통합 CLI다.

## 문제

NHN Cloud 는 서비스별 REST API 와 일부 SDK 만 제공한다.
AWS CLI 같은 통합 명령줄 도구가 없어 매번 토큰·엔드포인트·헤더를 직접 다뤄야 한다.

## 타겟

- NHN Cloud 를 일상적으로 쓰는 개발자 (Deploy, Log & Crash 등)
- 자동화 스크립트·AI 에이전트 (구조화된 `--json` 출력 소비)

## 핵심 가치

- 서비스마다 다른 인증·엔드포인트를 하나의 profile 추상화 뒤로 숨긴다.
- 데이터는 stdout, 진행·에러는 stderr 로 분리해 파이프라인에 친화적이다.
- AI 에이전트가 자연어를 명령으로 변환하도록 `skills/nhncloud-cli/SKILL.md` 를 제공한다.
- CLI 버전과 공개 스킬 문서의 정합성을 진단하고 안전하게 갱신한다.

## MVP 범위 (v1)

### 포함

- `nhncloud configure`: 대화형/flag 자격증명 설정 마법사 (UAK 와 서비스별 키, 연결 테스트)
- `nhncloud logncrash search`: Log & Crash Search v3 커서 기반 로그 검색 ([[adr-024]])
- `nhncloud logncrash export`: scroll 대량 추출과 조회 상태별 결과 파일 보존 ([[adr-030]], [[adr-032]], [[adr-034]])
- `nhncloud logncrash available-token`: 남은 조회 토큰과 양수가 될 때까지의 추정 대기 시간 확인 ([[adr-036]])
- `nhncloud logncrash send`: 로그 전송 (collector)
- `nhncloud deploy`: 배포 실행과 조회 (자주 쓰는 핵심 명령군)
  - `run`: 배포 실행 (OAuth 토큰 교환, 동기/`--async`)
  - `artifacts` / `server-groups` / `histories`: 조회
  - `scenarios`: 시나리오 조회
  - `upload` / `download` / `binaries` / `binary-groups`: 바이너리 전송과 조회
  - appkey 는 profile 로만 지정하고 배포 좌표는 명령 옵션으로만 받는다([[adr-033]])
- `nhncloud instance`: Compute 인스턴스 제어 (OpenStack Nova v2 호환, 일회성 CI 러너 자동화)
  - `create`: 발급 (비동기 기본, `--wait` 로 ACTIVE+IP 대기)
  - `list` / `get <id>` / `delete <id>`: 조회·삭제 (`--yes` 로 즉시 삭제)
  - `flavors`: 인스턴스 타입(flavor) 목록·상세 조회 (`--detail`, `--min-disk`/`--min-ram` 필터)
  - GPU 인스턴스도 같은 명령으로: GPU flavor id 를 `--flavor` 에 넘기면 된다 (NHN docs 가 API 호환성을 명시하진 않지만 동일 Nova v2 카탈로그를 공유)
- `nhncloud network`·`volume`·`floatingip`: 같은 Keystone profile과 region으로 IaaS 네트워크, Block Storage와 공인 IP를 관리한다.
  - `network security-group`: 일반망과 공공망에서 보안그룹과 규칙, 그룹에 연결된 포트를 조회하고 변경한다.
    공유 그룹을 바꾸기 전에 어느 인스턴스가 그 그룹을 쓰는지 확인하는 것이 목적이다.
    그룹과 규칙을 생성·삭제하고 인스턴스의 그룹 연결을 추가·해제해, 공유 그룹을 쓰는 개발 DB를 전용 그룹으로 분리할 수 있다([[adr-038]]).
- `nhncloud ncr`: NHN Container Registry 조회.
  레지스트리 목록·단일은 Management API·UAK 정적 헤더를 쓴다([[adr-016]]).
  이미지/태그는 Harbor REST 데이터플레인·UAK Basic Auth 를 쓴다([[adr-017]]).
- `nhncloud nks`: NHN Kubernetes Service 관리 (Keystone 토큰과 container-infra API·ADR-019)
  - 클러스터, 노드 그룹, 애드온, 지원 Kubernetes 버전과 작업 종류를 조회한다.
  - 생성·삭제·resize·upgrade·autoscale 등 쓰기 작업을 지원하며, 복잡한 payload 는 JSON 파일 입력을 기본으로 한다.
- `nhncloud ncs`: NHN Container Service 관리 (Deploy OAuth 토큰 재사용과 appkey 경로·ADR-020, region kr1/kr3)
  - `template`(컨테이너 실행 설계도)·`workload`(런타임 실행)·`malware`(악성코드 검사) 3개 리소스를 조회·생성·삭제·실행제어한다.
  - workload 는 비동기라 `create --wait` 로 Running 을 대기하고, 복잡한 생성·변경은 `--file <json>` 입력을 기본으로 한다.
- `nhncloud loadbalancer`: Load Balancer와 IP ACL 그룹·대상을 조회하고 안전하게 변경한다([[adr-022]], [사용 흐름](flow.md#iaas-흐름)).
  - 리스너, 풀과 멤버, 헬스 모니터, L7 정책과 규칙을 조회하고 만들고 지운다. TLS 인증서는 key-manager 에 올리고 조회한다([[adr-048]]).
  - 수정(update) 명령, 기본 인증서 변경, 쓰기 뒤 `ACTIVE` 대기는 범위 밖이다.
- `nhncloud privatedns`: Private DNS zone 과 레코드 세트를 조회하고 만들고 고치고 지운다([[adr-050]]).
  - VPC 안에서 쓰는 내부 도메인의 레코드를 콘솔 대신 스크립트와 에이전트가 바꾸는 것이 목적이다. 일반망(kr1, kr2, kr3)과 공공망(kr1) profile 을 지원한다.
  - 수정은 현재 값을 읽어 사용자가 준 옵션만 바꿔 보낸다. 쓰기는 `--yes` 나 `--dry-run` 이 필요하다.
  - SOA 와 zone apex NS 레코드 세트의 수정·삭제, 레코드가 남은 zone 의 `--force` 없는 삭제는 거부한다. zone 생성 뒤 `ACTIVE` 대기는 범위 밖이다.
- `nhncloud apigateway`: API Gateway 서비스·리소스·스테이지·배포를 조회하고
  스테이지 Swagger 를 내보낸다.
  - 결정은 [[adr-027]]과 [[adr-028]], [사용 흐름](flow.md#api-gateway-배포)을 따른다.
  - 인증은 공통 UAK OAuth 토큰을 재사용하고 appkey 는 경로에 넣는다.
    appkey 는 profile 로만 지정하고 명령 단위 오버라이딩을 두지 않는다([[adr-029]]).
  - 저장해 둔 Swagger 스펙이 실제 설정과 어긋나는 것을 CI 에서 주기적으로 대조하는 용도를 우선한다.
  - 스테이지의 백엔드 엔드포인트와 설명을 바꾸고, 리소스 경로·메서드에 플러그인을 설정한다([[adr-028]]).
    콘솔 수작업이 비현실적인 규모에 플러그인을 한 번에 적용하는 것이 목적이다.
  - 변경을 스테이지로 가져와 배포하고, 배포 이력으로 되돌린다([[adr-031]]).
    배포는 결과가 따로 조회되는 구조라 CLI 가 완료까지 확인해 종료 코드로 알린다.
- `nhncloud skm`: Secure Key Manager의 키 저장소·키·인증 정보를 조회·관리하고, 저장된 키로 기밀 데이터 조회, 암복호화, 서명과 검증을 실행한다([[adr-039]]).
  - 애플리케이션 배포 스크립트와 에이전트가 SDK 없이 키를 꺼내 쓰는 것이 목적이다. 일반망과 공공망 profile을 모두 지원한다.
  - 인증은 공통 UAK OAuth 토큰과 profile의 `skm.appkey`다. 키 저장소의 IPv4·MAC 인증을 지원하고 인증서 인증은 지원하지 않는다.
  - 키 저장소, 키, 인증 정보를 생성·수정·삭제하고 기밀 데이터 값을 바꾼다. 삭제 예약과 즉시 삭제는 다른 명령이며 모두 `--yes`가 필요하다([[adr-040]]).
  - JSON 객체로 담은 기밀 데이터는 필드 하나를 읽고, 필드 하나만 더하거나 바꾸거나 지운다. 필드 수정은 미리보기가 기본이고 `--yes`로 반영한 뒤 다시 조회해 대조한다([[adr-045]]).
- `nhncloud rds-mysql`: RDS for MySQL의 DB 인스턴스, DB 스키마, DB 사용자를 조회하고, DB 스키마와 DB 사용자를 만들고 사용자 권한을 바꾸거나 사용자를 지운다([[adr-046]], [[adr-047]]).
  - 콘솔 대신 스크립트와 에이전트가 DB 사용자와 권한을 다루는 것이 목적이다. 일반망과 공공망 profile을 모두 지원한다.
  - 인증은 profile 공통 UAK 정적 헤더와 `rds-mysql.appkey`다. region은 `--region`(기본 `kr1`)으로 고른다.
  - 쓰기는 `--yes`가 없으면 미리보기이고, 비동기 작업은 `--wait`로 완료까지 기다린다. 비밀번호는 파일이나 표준 입력으로만 받고 출력하지 않는다.
  - 권한은 인스턴스의 모든 스키마에 적용된다. 스키마 하나로 좁히는 권한, 비밀번호 변경, 스키마 삭제는 범위 밖이다.
- `nhncloud skills`: 공개 스킬의 상태 조회·설치·갱신·제거. 버전과 콘텐츠 해시로 오래된 설치와 사용자 수정본을 구분한다([[adr-025]]).
  Claude Code 와 Codex 의 스킬 경로를 같은 관리 저장소에 함께 연결하고 함께 바꾼다([[adr-043]]).
- `nhncloud commands`와 `doctor`: 기계 판독 가능한 명령 탐색과 로컬 설정 진단. `doctor`는 `--json` 보고서를 내고, `--check-connection`을 줄 때만 대상 profile 의 연결을 확인한다([[adr-042]]).
- profile 기반 자격증명 (`~/.nhncloud/credentials.json` 과 `~/.nhncloud/config.json`)
- 공공망 profile(`environment: gov`)은 OAuth, Deploy, NCR, IaaS(Private DNS 포함), NKS, Secure Key Manager, RDS for MySQL, Log & Crash, NCS, API Gateway를 지원한다. 공공망 문서에 주소가 없는 region은 호출 전에 거부한다 ([[adr-037]])
- 출력 3모드: 테이블 / `--json` / `--quiet`
- `--profile` 로 profile 전환
- `--proxy` 와 `HTTPS_PROXY`·`HTTP_PROXY`·`NO_PROXY` 로 토큰 발급을 포함한 모든 HTTP 요청을 프록시로 보낸다 ([[adr-044]])

## 성공 지표

- `nhncloud logncrash search --query ... --from ... --to ... --json` 이 v3 API에서 실제 로그를 반환하고, 다음 페이지가 있으면 `nextCursor`를 포함한다.
- `nhncloud logncrash export`가 조회를 마친 결과를 최종 파일 교체 실패 때문에 삭제하지 않는다.
- Log & Crash 검색과 export는 조회 토큰이 0 이하면 검색 요청을 보내지 않고 추정 대기 시간을 안내한다.
- `nhncloud privatedns record update <zone> <record> --ttl <n> --yes` 가 레코드 목록과 설명을 보존한 채 TTL 만 바꾼다.
- 필수 옵션을 빠뜨리면 검증 방식과 관계없이 입력 오류인 종료 코드 3으로 끝난다([[adr-035]]).
- 위치 인수를 옵션 이름으로 넘기면 오류 출력이 그 위치 인수와 명령 사용법을 함께 안내하고, 종료 코드는 1을 유지한다.
- profile 미설정 시 친절한 설정 안내로 종료한다 (exit code 명확).
