# ADR-037: 공공망 profile의 endpoint 선택

- **status**: `accepted`
- **결정**: `credentials.json`의 profile에 `"environment": "gov"`를 명시하면 OAuth, Deploy, NCR, IaaS(NKS, Floating IP, Load Balancer 포함), Secure Key Manager, RDS for MySQL, Log & Crash(검색, 수집), NCS, API Gateway 호출에 공공망 endpoint를 사용한다. 이 필드가 없는 기존 profile은 일반망 주소를 유지한다.
- **대체된 부분**: [ADR-005](005-endpoint-hardcoded-map.md)의 gov 제외 결정을 대체한다.
- **맥락**: 공공기관용 자격증명으로 호출해도 CLI가 일반망 주소에 연결되는 문제가 있었다(PR #108). 일반망과 공공망의 토큰과 endpoint가 섞이면 한 망의 자격증명이 다른 망 주소로 전송될 수 있다.
- **인증**: UAK와 IaaS 자격증명 형식은 유지한다. OAuth와 Keystone 토큰 캐시의 자격 지문에 망 구분을 포함해, 같은 profile의 설정을 바꾼 뒤 다른 망의 토큰을 재사용하지 않는다. OAuth 토큰을 쓰는 서비스는 profile의 망으로 토큰을 발급받고, 같은 망의 서비스 주소에만 그 토큰을 보낸다.
- **지원 범위**: 공식 문서에 공공망 주소가 있는 서비스와 region만 지원한다. 아래 「서비스별 조사」 표가 판정을 소유한다. 주소가 확인되지 않은 서비스와 region은 API 호출 전에 거부한다. Secure Key Manager는 [[adr-039]], RDS for MySQL은 [[adr-046]]의 인증 방식을 그대로 쓴다.
- **configure 연결 테스트**: 공공망 profile도 연결 테스트를 한다. 검증 요청은 profile의 망 주소로만 보낸다. NCR과 NCS 검증은 지금처럼 kr1을 가정하고, 공공망 문서도 두 서비스 모두 kr1 주소를 둔다. IaaS 검증은 저장할 region이 공공망 IaaS region이 아니면 요청 전에 거부한다. 망은 credentials 파일의 `environment`로만 정하므로, 파일에 아직 없는 새 profile은 일반망으로 검증한다. 대화형 `configure`의 UAK 재사용 후보도 같은 망의 profile로 한정한다.
- **근거**: [공공망 UAK 토큰](https://docs.gov-nhncloud.com/ko/nhncloud/ko/public-api/user-access-key-token-gov/), [Deploy API v2.1](https://docs.gov-nhncloud.com/ko/Dev%20Tools/Deploy/ko/api-guide-v2.1-gov/), [NCR API](https://docs.gov-nhncloud.com/ko/Container/NCR/ko/public-api-gov/), [IaaS 토큰과 serviceCatalog](https://docs.gov-nhncloud.com/ko/nhncloud/ko/public-api/iaas-token-gov/), [서비스 게이트웨이 endpoint](https://docs.gov-nhncloud.com/ko/Network/Service%20Gateway/ko/service-endpoint-gov/), [Secure Key Manager API v1.3](https://docs.gov-nhncloud.com/ko/Security/Secure%20Key%20Manager/ko/api-guide-v1.3-gov/), [RDS for MySQL API v3.0](https://docs.gov-nhncloud.com/ko/Database/RDS%20for%20MySQL/ko/api-guide-v3.0-gov/), [Log & Crash Search API](https://docs.gov-nhncloud.com/ko/Data%20%26%20Analytics/Log%20%26%20Crash%20Search/ko/gov-api-guide/), [NCS API](https://docs.gov-nhncloud.com/ko/Container/NCS/ko/public-api-gov/), [API Gateway API v2.0](https://docs.gov-nhncloud.com/ko/Application%20Service/API%20Gateway/ko/api-guide-v2.0-gov/).
- **제한**: `configure`는 망 선택을 묻지 않는다. 공공망 profile을 만들 때 credentials 파일에 `environment`를 명시한다. Deploy 쓰기 명령의 실제 성공 여부는 해당 프로젝트 권한과 배포 좌표가 필요하다. `doctor`의 연결 확인은 공공망 profile을 아직 건너뛴다.
- **결과**: 공공망 profile로 Log & Crash 검색과 수집, NCS, API Gateway 명령을 쓴다. 미지원 서비스와 region은 API 호출 전에 거부한다.

## 서비스별 조사

2026-10-21 기준이다. 서비스 목록은 `nhncloud commands --json`의 최상위 명령 가운데 NHN Cloud API를 부르는 것이다.
인증 없는 호출은 자격증명 없이 공공망 주소에 보낸 요청의 응답이다. 실호출은 공공망 profile로 읽기 전용 조회를 한 결과다.

| 서비스 | 공공망 공식 주소 | 일반망과 다른 인증 | 지원 region | 인증 없는 호출 | 실호출 | 판정 |
|---|---|---|---|---|---|---|
| deploy | `api-tcd.gov-nhncloudservice.com` ([Deploy API v2.1](https://docs.gov-nhncloud.com/ko/Dev%20Tools/Deploy/ko/api-guide-v2.1-gov/)) | OAuth 발급 주소만 공공망 | 없음(전역) | `/` 가 HTTP 404 | `deploy artifacts` 성공 | 지원 |
| ncr | `{region}-ncr.api.gov-nhncloudservice.com` ([NCR API](https://docs.gov-nhncloud.com/ko/Container/NCR/ko/public-api-gov/)) | 없음 | kr1 | kr1 은 `resultCode 4041007`, kr2 는 연결 실패 | 미확인(profile 에 ncr appkey 없음) | 지원 |
| instance, network, volume, nks | `{region}-api-{instance,image,network,block-storage,kubernetes}-infrastructure.gov-nhncloudservice.com` ([서비스 게이트웨이](https://docs.gov-nhncloud.com/ko/Network/Service%20Gateway/ko/service-endpoint-gov/)) | Keystone 발급 주소만 공공망 | kr1, kr2 | API 버전 목록 응답 | 미확인(profile 에 iaas 없음) | 지원 |
| floatingip, loadbalancer | network 주소를 쓴다 | Keystone 발급 주소만 공공망 | kr1, kr2 | network 행과 같다 | `loadbalancer list`, `get`, `listener`·`pool`·`healthmonitor`·`l7policy` 조회 성공(2026-10-27) | 지원 |
| loadbalancer certificate | `{region}-api-key-manager-infrastructure.gov-nhncloudservice.com` ([Load Balancer API v2](https://docs.gov-nhncloud.com/ko/Network/Load%20Balancer/ko/public-api-gov/)) | Keystone 발급 주소만 공공망 | kr1, kr2 | 확인하지 않음 | `GET /v1/containers` 가 HTTP 403(IAM 계정의 key-manager 권한 없음) | 지원([[adr-048]]) |
| skm | `api-keymanager.gov-nhncloudservice.com` ([SKM API v1.3](https://docs.gov-nhncloud.com/ko/Security/Secure%20Key%20Manager/ko/api-guide-v1.3-gov/)) | OAuth 발급 주소만 공공망 | 없음(전역) | `resultCode 20002` | `skm keystore list` 성공 | 지원 |
| rds-mysql | `kr1-rds-mysql.api.gov-nhncloudservice.com` ([RDS for MySQL API v3.0](https://docs.gov-nhncloud.com/ko/Database/RDS%20for%20MySQL/ko/api-guide-v3.0-gov/)) | 없음 | kr1 | kr1 은 본문 봉투 응답, kr2 는 HTTP 503 | `rds-mysql instance list` 성공 | 지원 |
| logncrash 검색 | `api-lncs-search.gov-nhncloudservice.com` ([Log & Crash Search API](https://docs.gov-nhncloud.com/ko/Data%20%26%20Analytics/Log%20%26%20Crash%20Search/ko/gov-api-guide/)) | OAuth 발급 주소만 공공망 | 없음(전역) | `available-token` 이 `resultCode -401` | `available-token`, `search` 성공 | 지원 |
| logncrash 수집(`send`) | `api-logncrash.gov-nhncloudservice.com` (같은 문서) | 없음(본문의 appkey 로 식별) | 없음(전역) | `GET /v2/log` 가 HTTP 405 `Only support POST method` | 쓰기라 실행하지 않음 | 지원 |
| ncs | `kr1-ncs.api.gov-nhncloudservice.com` ([NCS API](https://docs.gov-nhncloud.com/ko/Container/NCS/ko/public-api-gov/)) | OAuth 발급 주소만 공공망 | kr1 | kr1 은 `resultCode 10001`, kr2 는 DNS 없음 | 미확인(profile 에 ncs appkey 없음) | 지원 |
| apigateway | `kr1-apigateway.api.gov-nhncloudservice.com` ([API Gateway API v2.0](https://docs.gov-nhncloud.com/ko/Application%20Service/API%20Gateway/ko/api-guide-v2.0-gov/)) | OAuth 발급 주소만 공공망 | kr1 | kr1, kr2 모두 `resultCode 403100000` | 미확인(profile 에 apigateway appkey 없음) | 지원(kr1) |
| apigateway kr2, kr3 | 문서에 없음 | | | kr2 는 응답이 오지만 문서에 없다 | | 거부 유지 |

`configure`, `doctor`, `commands`, `skills`는 서비스 API를 부르지 않거나 위 서비스의 검증 경로를 재사용한다. `doctor`는 공공망 profile의 연결 확인을 건너뛰며, 이 점은 위 「제한」 절에 있다.

### 문서와 실제 응답의 차이

- 서비스 게이트웨이 문서는 Log & Crash 수집 주소를 `http://` 로 적지만 Log & Crash API 문서의 예시는 `https://` 다. HTTPS 로 요청해 응답을 받았으므로 HTTPS 를 쓴다.
- 공공망 API Gateway `kr2` 주소는 인증 없는 요청에 응답하지만 문서에 없어 거부한다.

### 실호출 기록

2026-10-21, 공공망 profile 하나로 읽기 전용 명령만 실행했다.

| 명령 | 결과 |
|---|---|
| `deploy artifacts` | 종료 코드 0 |
| `rds-mysql instance list` | 종료 코드 0 |
| `skm keystore list` | 종료 코드 0 |
| `ncs template list` | 공공망 OAuth 토큰 발급까지 성공, profile 에 ncs appkey 가 없어 종료 코드 4 |
| `ncs template list --region kr3` | 토큰 발급 전에 종료 코드 3 |
| `apigateway service list --region kr2` | 토큰 발급 전에 종료 코드 3 |
| `logncrash available-token` | 성공, 응답 정상 |
| `logncrash search` (최근 1시간, 7일 범위) | 성공, 응답에 `totalItems`, `data`, `nextCursor` |

`logncrash send` 는 쓰기라 실호출하지 않았다. ncr, IaaS 계열, apigateway(kr1) 는 profile 에 해당 자격증명이 없어 실호출로 확인하지 못했다.

2026-10-27, IaaS 자격증명이 있는 다른 공공망 profile 로 Load Balancer 읽기 명령을 실행했다.

| 명령 | 결과 |
|---|---|
| `loadbalancer list`, `get` | 종료 코드 0. 응답에 문서에 없는 필드(`loadbalancer_type`, `workflow_status` 등)가 있고 IP ACL 이 없으면 `ipacl_group_action` 필드가 없다 |
| `loadbalancer listener list`, `get` | 종료 코드 0. `TERMINATED_HTTPS` 리스너에 `cert_expire_date` 가 붙는다 |
| `loadbalancer pool list`, `get`, `pool member list`, `get` | 종료 코드 0. 멤버의 `subnet_id` 가 `null` 일 수 있다 |
| `loadbalancer healthmonitor list`, `get`, `l7policy list`, `get`, `l7policy rule list`, `get` | 종료 코드 0 |
| `loadbalancer certificate list` | key-manager 가 HTTP 403, 종료 코드 2 |
