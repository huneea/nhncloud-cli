# DNS Plus 명령 안내

`dnsplus` 명령군은 DNS Plus의 존을 조회하고, 존 안의 레코드 세트를 조회·생성·삭제한다.
존 생성·삭제와 레코드 세트 수정은 없다. 생성하는 타입은 `A`, `CNAME`, `TXT`다.

## 인증과 설정

DNS Plus `appkey`만 필요하다. 콘솔 상단 **URL & Appkey** 메뉴에서 확인한다.
`nhncloud configure --dnsplus-appkey <appkey>`로 profile의 `dnsplus.appkey`를 설정한다. 연결 테스트는 존 목록 조회로 한다.

- 앱키가 요청 경로에 들어가고 UAK, 인증 헤더, `--region`은 없다.
- 공공망은 profile의 `"environment": "gov"`로 고른다. 공공망 콘솔은 DNS Plus를 앱키 기반 별도 화면으로 연다.
- API는 항상 HTTP 200으로 응답하고 실패는 본문으로 알린다. 잘못된 앱키는 종료 코드 2다.
- 오류 메시지와 `--dry-run` 출력에는 앱키가 나오지 않는다(`<appkey>`로 표시한다).
- `doctor --check-connection`은 DNS Plus를 확인하지 않는다.

## 명령 탐색

정확한 명령 경로와 옵션은 `nhncloud commands --json`에서 확인한다.
`--zone`과 `<zone>`은 존 ID(UUID)나 존 이름을 받는다. 이름은 끝 점과 대소문자 없이 비교하고, 정확히 같은 존이 하나일 때만 쓴다.

```bash
nhncloud dnsplus zone list
nhncloud dnsplus zone get example.com
nhncloud dnsplus recordset list --zone example.com --type A
nhncloud dnsplus recordset get www.example.com --zone example.com
```

`--quiet`가 출력하는 값은 `zone list`·`zone get`의 `zoneId`, `recordset list`·`get`·`create`·`delete`의 `recordsetId`다.
존 단건 조회 API가 없어 `zone get`은 목록을 좁혀 읽는다. 목록은 모든 페이지를 읽어 이어 붙인다.

## 레코드 세트 쓰기

`recordset create`와 `recordset delete`는 `--yes`나 `--dry-run` 중 하나가 있어야 한다. 둘 다 없으면 API를 호출하기 전에 종료 코드 3이다.
`--dry-run`은 이름 해석을 위한 조회만 하고 보낼 요청을 출력한다. `--yes`와 함께 주면 `--dry-run`이 이긴다.

```bash
nhncloud dnsplus recordset create --zone example.com --name www.example.com --type A --value 192.0.2.10 --dry-run
nhncloud dnsplus recordset create --zone example.com --name www.example.com --type A --value 192.0.2.10 --ttl 300 --yes
nhncloud dnsplus recordset delete www.example.com --zone example.com --type A --yes
```

- `--name`은 존 안의 이름이어야 한다. 끝 점은 생략할 수 있다.
- 같은 이름의 레코드 세트가 타입과 관계없이 있으면 덮지 않고 종료 코드 3으로 멈춘다. 바꾸려면 지우고 다시 만든다.
- `A`는 IPv4 주소만 받고 `--value`를 반복해 여러 개 줄 수 있다. `CNAME`은 값 하나이고 끝 점이 없으면 붙인다. `TXT`는 큰따옴표로 감싸서 보낸다.
- `--ttl`은 10~2147483647초이고 기본은 300이다.
- `delete`는 찾은 레코드 세트 하나만 지운다. 이름이 같은 타입이 여럿이면 `--type`이나 레코드 세트 ID를 준다. ID와 `--type`을 함께 주면 타입이 같아야 하고, 다르면 종료 코드 3이다. SOA는 지우지 않는다.
- 쓰기 결과를 모르는 실패(시간 초과, 연결 오류) 뒤에는 `recordset list`로 반영 여부를 확인한 다음 다시 실행한다.
