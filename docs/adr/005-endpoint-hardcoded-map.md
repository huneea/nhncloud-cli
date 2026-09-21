# ADR-005: 엔드포인트 하드코딩 맵 (gov 제외) — IaaS 는 region 분기

공공망 profile의 endpoint 선택은 [ADR-037](037-gov-profile-endpoints.md)에서 추가했다.

- **결정**: 서비스별 고정 도메인을 코드 맵으로 관리한다.
  - PaaS 는 단일 도메인 (`api-lncs-search.nhncloudservice.com` 등)
  - IaaS instance 는 `<region>-api-instance-infrastructure.nhncloudservice.com` 으로 region prefix 가변
- **맥락**: NHN PaaS 는 서비스별 고정 도메인을 쓴다. IaaS instance 는 kr1/kr2/kr3/jp1 4개 region 이 각각 다른 host 다.
  - 정적 맵과 region 분기로 충분 (Keystone serviceCatalog 도 같은 host 를 반환)
- **대안 기각**: serviceCatalog 동적 파싱(token 발급마다 추출하고 파싱이 복잡), profile 에 endpoint 직접 저장(설정 부담). gov 분기는 후속.
