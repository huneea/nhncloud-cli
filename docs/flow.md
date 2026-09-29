# User Flow: nhncloud-cli

이 문서는 명령을 나열하지 않고 사용자가 거치는 흐름과 실패 경계를 설명한다.
전체 명령, 인수와 옵션은 `nhncloud --help`와 `nhncloud commands --json`에서 확인한다.

## 공통 실행 흐름

1. 사용자가 명령과 `--profile`을 선택한다.
2. CLI가 인수·옵션을 검증하고 위험한 쓰기라면 확인 조건을 검사한다.
3. profile 우선순위에 따라 자격증명을 읽는다.
4. OAuth, Keystone 또는 서비스 고유 인증으로 client를 만든다.
5. API를 호출하고 서비스 응답을 공통 오류로 정규화한다.
6. 데이터는 stdout, 진행 상황·경고·오류는 stderr로 출력한다.

`--json`은 구조화된 전체 결과를, `--quiet`은 다음 명령에 넘길 핵심 값만 출력한다.
자격증명이나 인수가 잘못되면 외부 요청과 spinner를 시작하기 전에 종료한다.

## 공통 CLI 입력 오류

필수 옵션 누락은 Commander의 `requiredOption`과 명령 내부의 수동 검증 모두 종료 코드 3으로 끝난다(ADR-035).
Commander가 먼저 발견한 누락은 기존 영문 오류를 stderr에 한 번만 출력하고, 수동 검증은 기존 오류 문구를 유지한다.
두 경우 모두 API를 호출하거나 stdout에 데이터를 출력하지 않는다.

알 수 없는 옵션이나 불필요한 인수 같은 다른 Commander 문법 오류는 종료 코드 1을 유지한다.
도움말과 버전 출력은 종료 코드 0이다.
`--json`과 `--quiet`은 파서 오류를 데이터 출력으로 바꾸지 않는다.

## 최초 설정

`nhncloud configure`는 대화형 입력과 CI용 flag 입력을 모두 지원한다.

- profile을 정하고 공통 UAK와 필요한 서비스 블록만 저장한다.
- 비대화형 flag가 하나라도 있으면 prompt를 열지 않는다.
- 기본 동작은 이번에 입력한 자격증명을 확인한다. `--no-verify`를 주면 연결 테스트를 생략한다.
- 자격증명은 `credentials.json`, 기본 profile 같은 일반 설정은 `config.json`에 둔다.

설정 후 `nhncloud doctor`로 파일 권한, profile과 공개 스킬 상태를 오프라인 진단할 수 있다.
세부 필드는 [data-schema.md](data-schema.md)를 따른다.

## 명령 탐색

사람은 단계별 help로 좁혀 간다.

```bash
nhncloud --help
nhncloud instance --help
nhncloud instance create --help
```

에이전트와 스크립트는 `nhncloud commands --json`에서 경로, 인수와 옵션 메타데이터를 읽는다.
이 명령은 외부 API와 자격증명을 사용하지 않는다.

## 서비스별 시작점

| 영역 | 일반 흐름 | 상세 사용자 가이드 |
|---|---|---|
| Log & Crash | 조회 토큰 확인, 검색, 대량 export, 로그 전송 | [logncrash.md](../skills/nhncloud-cli/references/logncrash.md) |
| Deploy | 좌표 탐색, 배포 실행, 바이너리 전송 | [deploy.md](../skills/nhncloud-cli/references/deploy.md) |
| Instance·Network·Volume·Floating IP | 리소스 탐색 뒤 조회·생성·변경 | [iaas.md](../skills/nhncloud-cli/references/iaas.md) |
| Load Balancer | 대상 탐색, IP ACL 변경과 부분 실패 복구 | [loadbalancer.md](../skills/nhncloud-cli/references/loadbalancer.md) |
| NCR | registry 조회 뒤 image와 tag 탐색 | [ncr.md](../skills/nhncloud-cli/references/ncr.md) |
| NKS | 지원 버전과 리소스를 조회한 뒤 변경 | [nks.md](../skills/nhncloud-cli/references/nks.md) |
| NCS | template을 기준으로 workload를 만들고 관찰 | [ncs.md](../skills/nhncloud-cli/references/ncs.md) |
| API Gateway | service·stage·resource 탐색 뒤 설정·배포 | [apigateway.md](../skills/nhncloud-cli/references/apigateway.md) |

## 조회와 페이지 이동

조회 명령은 가능한 한 table을 기본으로 하고 JSON과 quiet 출력을 함께 제공한다.
목록 API의 cursor나 paging은 응답에 존재할 때만 다음 요청에 사용한다.
빈 결과는 성공이며 데이터 출력으로 표현한다.

Log & Crash 검색은 상대시간과 절대시간을 UTC 범위로 정규화한다.
검색과 export는 각 검색 요청 직전에 조회 토큰 잔량을 확인한다.
잔량이 0 이하면 검색 요청을 보내지 않고 API 오류로 끝내며, 관측한 회복 속도로 양수가 될 때까지의 추정 대기 시간을 안내한다.
잔량 조회가 실패해도 검색 요청을 보내지 않고 원래 오류를 전달한다.
양수 잔량은 다음 요청의 비용까지 충분하다는 보장이 아니며, 동시 소비로 실제 요청이 429를 반환할 수 있다.
CLI는 자동으로 기다리거나 다시 시도하지 않고, export가 중간에 멈추면 받은 결과를 보존한다(ADR-032, ADR-036).
대량 export는 API 제한에 맞게 기간과 페이지를 나누며, 실패한 다음 요청을 성공으로 숨기지 않는다.
조회 중 실패한 결과는 `.partial`, 조회를 마쳤지만 JSON 배열을 닫지 못한 결과는 `.unfinalized`, 형식까지 완성했지만 최종 경로로 교체하지 못한 결과는 `.complete`로 보존한다.
복구 파일은 실행별 고유 경로를 쓰며 뒤의 성공 실행이 자동으로 삭제하지 않는다(ADR-032, ADR-034).
NCS logs와 events도 같은 시간 해석 유틸리티를 재사용한다.

## 쓰기 명령의 공통 흐름

1. 리소스 ID와 입력 파일을 로컬에서 검증한다.
2. 위험한 변경은 API 호출 전에 `--yes` 또는 명시적 확인을 요구한다.
3. API가 비동기 작업을 반환하면 기본 동작과 `--wait`의 차이를 help에 드러낸다.
4. 여러 하위 작업 중 일부만 실패하면 성공·실패 대상을 구조화해 반환한다.
5. 재실행 시 중복 생성이나 상태 역전을 일으킬 수 있는지 오류에 설명한다.

복잡한 NKS·NCS·API Gateway payload는 JSON 파일을 사용한다.
파일 크기, JSON 형태와 경로 안전성을 확인한 뒤 요청한다.

## IaaS 흐름

IaaS 서비스는 profile의 Keystone 자격증명과 region을 해석하고 토큰과 endpoint를 공유한다.
탐색은 목록에서 이름과 UUID를 확인한 뒤 상세 조회나 쓰기로 진행한다.

- Instance 생성은 비동기가 기본이며 `--wait`를 주면 ACTIVE와 주소 확인까지 기다린다.
- delete, 전원 제어와 resize는 대상 확인을 먼저 수행한다.
- Network, Floating IP, Volume과 Load Balancer는 같은 Keystone 토큰을 재사용하되 서로 다른 endpoint 경계를 쓴다.
- Load Balancer IP ACL 대상 변경은 기존 binding을 보존해 재바인딩하고, 부분 실패를 숨기지 않는다.
- 보안그룹은 이름이나 UUID로 지정한다. UUID가 일치하면 그 그룹을 쓰고, 이름이 없거나 중복되면 후보 UUID와 함께 입력 오류로 끝난다.
- 보안그룹 연결 포트 조회는 연결 API 결과에 Compute 인스턴스 목록의 이름을 붙인다.
  `device_owner`가 `compute:`로 시작하는 포트만 대상이다.
  인스턴스 목록 조회가 실패하면 이름 칸을 비우고 stderr에 경고를 남기며, 연결 정보는 그대로 출력하고 성공으로 끝난다.
  `--quiet`은 다음 명령에 넘길 인스턴스 UUID를 중복 없이 출력한다.

## 서비스 고유 흐름

### Deploy와 OAuth 서비스

공통 UAK를 OAuth access token으로 교환하고 profile의 서비스 appkey를 경로에 사용한다.
배포 좌표는 명령 옵션으로 받으며 profile에 저장하지 않는다.
Log & Crash 검색, NCS와 API Gateway도 같은 계정 토큰 캐시를 재사용하지만 서비스별 헤더와 응답 봉투는 client가 책임진다.

### NCR

Management API는 공통 UAK 정적 헤더와 profile의 NCR appkey를 쓴다.
image와 tag 조회는 registry 응답의 host를 검증한 뒤 Harbor REST에 UAK Basic Auth로 접근한다.
관리 API와 data plane 응답을 같은 봉투로 가정하지 않는다.

### API Gateway 배포

설정 변경 뒤 resource를 stage에 반영하고 새 배포를 만든다.
배포 생성 응답만으로 완료를 단정하지 않고 배포 상태를 조회한다.
rollback도 새 상태 전이를 만들 수 있으므로 완료와 실패를 같은 방식으로 확인한다.

## 공개 스킬 수명주기

`nhncloud skills status`는 활성 링크, 관리 저장소 매니페스트와 콘텐츠 해시를 비교한다.
install과 update는 새 관리 저장소를 완성한 뒤 링크를 원자적으로 전환한다.
사용자 항목이나 수정·손상된 관리 저장소는 기본 보존하고, 강제 교체할 때도 백업한다.
uninstall은 인식 가능한 활성 링크만 제거하고 실제 디렉터리와 알 수 없는 링크는 거부한다.

## 실패와 자동화 계약

- 설정 오류, 인수 오류, 인증 오류와 API 오류는 서로 다른 종료 코드로 구분한다.
- 자격증명 파일 손상과 존재하지 않는 profile 오류는 원인을 그대로 표시한다.
  NCR, NCS, API Gateway와 Deploy의 서비스 자격증명 블록이나 필수 appkey만 없을 때
  해당 서비스의 `configure` 명령을 안내한다.
- JSON 모드에서도 경고와 오류를 stdout에 섞지 않는다.
- API 문서와 실제 응답이 다르면 타입을 추측해 넓히지 않고 실측 근거를 남긴다.
- 자동화 흐름은 prompt를 기다리지 않고 같은 입력에 같은 출력과 종료 코드를 반환한다.

문제 해결 순서는 [troubleshooting.md](../skills/nhncloud-cli/references/troubleshooting.md)를 따른다.
