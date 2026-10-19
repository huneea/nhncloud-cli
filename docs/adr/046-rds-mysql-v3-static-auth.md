# ADR-046: RDS for MySQL 은 API v3 와 UAK 정적 헤더로 호출하고 region 은 명령 옵션으로 받는다

- **status**: `accepted`
- **결정**: `nhncloud rds-mysql` 명령은 RDS for MySQL API v3(`/v3.0`)를 호출한다.
  - 인증은 요청마다 `X-TC-APP-KEY`(profile `rds-mysql.appkey`), `X-TC-AUTHENTICATION-ID`, `X-TC-AUTHENTICATION-SECRET`(profile 공통 UAK)를 보낸다. OAuth 토큰으로 교환하지 않고 토큰 캐시를 쓰지 않는다.
  - host 는 `{region}-rds-mysql.api.nhncloudservice.com` 이고, region 은 `--region`(기본 `kr1`)으로 받는다. 일반망은 `kr1`, `kr2`, `jp1`, 공공망(profile `environment: gov`)은 `kr1` 만 받고 `kr1-rds-mysql.api.gov-nhncloudservice.com` 을 쓴다. 그 밖의 region 은 API 호출 전에 종료 코드 3으로 끝난다.
  - 명령 이름은 엔진을 드러낸 `rds-mysql` 이다.
  - 응답은 HTTP 200 과 `header.isSuccessful` 봉투로 판정한다. 결과 필드는 `body` 가 아니라 `header` 옆의 이름 있는 필드(`dbInstances`, `dbUsers`, `jobId` 등)다. `resultCode` 가 `80401`, `80403`, `401`, `403` 이거나 HTTP 상태가 401, 403 이면 인증 오류(종료 코드 2)다. HTTP 5xx 본문의 봉투는 결과 코드와 무관하게 API 오류(종료 코드 1)다.
- **맥락**:
  - 공식 문서에 v3 와 v4 가이드가 함께 있다. 경로와 요청·응답 필드는 같고 인증만 다르다. v3 는 UAK ID 와 Secret 을 정적 헤더로, v4 는 `X-NHN-AUTHORIZATION` 에 UAK 토큰을 보낸다.
  - v4 문서는 헤더 값에 `Bearer ` 접두사를 붙이는지 밝히지 않는다. 실호출 없이 확정할 수 없다. v3 는 헤더 이름과 값이 문서에 모두 있다.
  - 공공망 가이드(v3, v4)는 판교 리전 host 하나만 싣는다. 경로, 인증 헤더와 사용자·스키마 API 필드는 일반망 가이드와 같다.
  - 같은 정적 헤더 방식을 NCR Management API 가 이미 쓴다([[adr-016]]). `--region` 기본값 `kr1` 도 NCR 명령과 같다.
  - 같은 이름의 RDS 계열(MariaDB, PostgreSQL, MS-SQL)은 host 와 API 가 엔진마다 다르다.
  - 공공망 실호출(2026-10)에서 문서와 다른 결과 코드를 확인했다. 잘못된 UAK Secret 은 HTTP 200 과 `resultCode` 401 이다.
    `403` 은 `80401`·`80403` 짝에 맞춰 둔 값이고 실호출로 확인하지 않았다.
    `X-TC-APP-KEY` 가 없거나 RDS for MySQL 이 인식하지 못하는 앱키면 `resultCode` 500(`Internal Server Error`)이다. 이 500 은 서버 오류와 구분되지 않아 종료 코드 1로 두고, 조회 요청의 오류 문구에만 앱키를 확인하라는 안내를 붙인다. 쓰기 요청은 사전 조회를 거친 뒤라 앱키가 원인일 가능성이 낮다.
  - 공식 문서: [API v3.0 가이드](https://docs.nhncloud.com/ko/Database/RDS%20for%20MySQL/ko/api-guide-v3.0/), [공공기관용 API v3.0 가이드](https://docs.gov-nhncloud.com/ko/Database/RDS%20for%20MySQL/ko/api-guide-v3.0-gov/), [API v4.0 가이드](https://docs.nhncloud.com/ko/Database/RDS%20for%20MySQL/ko/api-guide-v4.0/).
- **대안 기각**:
  - v4 와 OAuth 토큰: 기존 토큰 캐시를 재사용할 수 있지만 헤더 값 형식을 추측해야 한다. 실호출로 형식을 확인한 뒤 바꿀 수 있다. 경로와 필드가 같아 client 의 base path 와 인증 헤더만 바뀐다.
  - profile 에 region 저장: IaaS 처럼 profile 기본값을 둘 수 있지만 RDS 만을 위한 저장 필드가 늘어난다. NCR 과 같은 옵션 방식으로 둔다.
  - 명령 이름 `rds`: 짧지만 다른 엔진을 더할 때 이름이 겹친다.
- **결과**:
  - 얻는 것: 새 의존과 토큰 캐시 변경 없이 일반망과 공공망에서 같은 명령을 쓴다.
  - 감당할 것: UAK Secret 이 매 요청 헤더로 RDS host 에 간다. v3 폐기 일정은 문서에 없어, 폐기가 공지되면 v4 로 옮겨야 한다. 공공망 평촌 리전은 공식 host 가 확인될 때 더한다.
- **적용 범위**: `rds-mysql` 명령군. 공공망 endpoint 선택 규칙은 [[adr-037]] 을 따른다.
