# ADR-037: 공공망 profile의 endpoint 선택

- **결정**: `credentials.json`의 profile에 `"environment": "gov"`를 명시하면 OAuth, Deploy, NCR, IaaS, Secure Key Manager 호출에 공공망 endpoint를 사용한다. 이 필드가 없는 기존 profile은 일반망 주소를 유지한다.
- **인증**: UAK와 IaaS 자격증명 형식은 유지한다. OAuth와 Keystone 토큰 캐시의 자격 지문에 망 구분을 포함해, 같은 profile의 설정을 바꾼 뒤 다른 망의 토큰을 재사용하지 않는다.
- **지원 범위**: 공공망 Deploy는 `api-tcd.gov-nhncloudservice.com`, NCR은 `kr1-ncr.api.gov-nhncloudservice.com`, IaaS는 공식 문서에 주소가 있는 `kr1`과 `kr2`만 사용한다. 공공망에서 구현하지 않은 NCS, API Gateway, Log & Crash 호출과 주소가 확인되지 않은 region은 API 호출 전에 거부한다. Secure Key Manager는 공공망 endpoint `api-keymanager.gov-nhncloudservice.com`을 사용한다([[adr-039]]).
- **근거**: [공공망 UAK 토큰](https://docs.gov-nhncloud.com/ko/nhncloud/ko/public-api/user-access-key-token-gov/), [Deploy API v2.1](https://docs.gov-nhncloud.com/ko/Dev%20Tools/Deploy/ko/api-guide-v2.1-gov/), [NCR API](https://docs.gov-nhncloud.com/ko/Container/NCR/ko/public-api-gov/), [IaaS 토큰과 serviceCatalog](https://docs.gov-nhncloud.com/ko/nhncloud/ko/public-api/iaas-token-gov/), [서비스 게이트웨이 endpoint](https://docs.gov-nhncloud.com/ko/Network/Service%20Gateway/ko/service-endpoint-gov/), [Secure Key Manager API v1.3](https://docs.gov-nhncloud.com/ko/Security/Secure%20Key%20Manager/ko/api-guide-v1.3-gov/).
- **제한**: `configure`는 망 선택을 묻지 않는다. 공공망 profile을 만들 때 credentials 파일에 `environment`를 명시한다. Deploy 쓰기 명령의 실제 성공 여부는 해당 프로젝트 권한과 배포 좌표가 필요하다.
