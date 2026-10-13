# Secure Key Manager 명령 안내

`skm` 명령군은 Secure Key Manager의 키 저장소, 키, 인증 정보, 기밀 데이터를 다룬다.

## 인증과 설정

공통 UAK와 SKM `appKey`가 필요하다.
`nhncloud configure --skm-appkey <appkey>`로 profile의 `skm.appkey`를 설정한다.

공공망은 profile의 `"environment": "gov"`로 고른다.

## 클라이언트 인증

키 저장소에 등록한 클라이언트 인증 정보와 호출 환경이 맞아야 키와 데이터를 읽을 수 있다.
CLI는 IPv4 인증과 MAC 인증을 지원한다. 인증서 인증 정보 등록(`auth add --type certificate`)은 지원하지만, CLI가 클라이언트 인증서를 보내 인증하는 것은 지원하지 않는다.

- IPv4 인증은 서버가 본 요청 출발지 IP가 키 저장소에 등록돼 있어야 한다. 이 IP는 공인 IP와 다를 수 있다.
  - 사내망처럼 내부 경로로 SKM endpoint에 닿는 환경에서는 서버에 사설 IP(예: `10.x.x.x`)로 보인다. 이때 공인 IP만 등록하면 `ipv4 auth failure`로 실패한다.
  - 허용 IP는 `nhncloud skm confirm`의 `clientIp`를 기준으로 등록한다. 출발지 IP가 바뀔 수 있으면 `skm keystore auth add <keystore-id> <대역>/24 --type ipv4`처럼 CIDR 대역으로 등록한다.
  - CLI는 `/0`부터 `/32`까지 받는다. `0.0.0.0/0`은 모든 출발지를 허용하므로 등록하지 않는다.
  - 대역은 `10.0.0.0/24`처럼 호스트 비트를 0으로 맞춰 등록한다. 지울 때는 `auth list --type ipv4`에 나온 값을 `auth delete`에 그대로 넘긴다.
- MAC 인증을 켠 키 저장소는 `--mac-address aa:bb:cc:dd:ee:ff`로 MAC을 넘긴다. 콜론 형식만 받고 소문자로 바꿔 보낸다.
- `nhncloud skm confirm`은 서버가 본 클라이언트 IP와 MAC 헤더를 보여 준다. 인증 오류가 나면 먼저 확인한다.

## 명령 탐색

정확한 명령 경로와 옵션은 `nhncloud commands --json`에서 확인한다.

```bash
nhncloud skm keystore list
nhncloud skm key list <keystore-id>
nhncloud skm key list <keystore-id> --status active   # active|inactive 로 거른다
nhncloud skm secret get <key-id> --quiet
nhncloud skm secret get <key-id> --field <name> --quiet
```

`--quiet`가 출력하는 값은 다음과 같다.

- `keystore list`·`keystore get`: `keyStoreId`
- `key list`·`key get`: `keyId`
- `secret get`: 기밀 데이터
- `secret get --field`: 필드 값(문자열이면 원문, 그 밖은 JSON 표기)
- `symmetric-key get`: 대칭키 원문
- `symmetric-key encrypt`: 암호문
- `symmetric-key decrypt`: 평문
- `asymmetric-key sign`: 서명값
- `asymmetric-key public-key`·`private-key`: `standardEncodedKey`(PKCS#8), 응답에 없으면 `encodedKey`. 일반망 문서의 응답에는 `standardEncodedKey`가 없다.
- `symmetric-key create-local-key`: 평문 키와 암호화된 키 두 줄
- `asymmetric-key verify`: 출력 없음
- `key create`·`secret update`·`key delete|purge`: `keyId`
- `secret patch`: `action`(`added`, `replaced`, `deleted`, `unchanged`)
- `keystore create|update|delete`: `keyStoreId`
- `keystore auth add|delete|purge`: 입력한 IPv4·MAC 값(소문자로 정규화) 또는 인증서 이름
- `keystore auth get`: 조회한 인증 정보의 값 또는 인증서 이름

## 쓰기 명령

처음 구성하는 순서 예시는 다음과 같다.

```bash
nhncloud skm keystore create --name <name> --auth ipv4
nhncloud skm keystore auth add <keystore-id> 10.0.0.1 --type ipv4
nhncloud skm keystore auth add <keystore-id> 10.0.0.0/24 --type ipv4   # CIDR 대역도 등록할 수 있다
printf '%s' "$SECRET" | nhncloud skm key create <keystore-id> --type secret --name <name>
```

- 키 저장소는 `<keystore-id>`로 지정하고, CLI가 키 저장소 이름을 조회해 요청에 넣는다.
- 기밀 데이터 값(`key create --type secret`, `secret update`)은 `--value`, `--file`, 표준 입력 중 하나로 넘긴다. `--value`로 넘긴 값은 셸 히스토리와 프로세스 목록에 남으므로 비밀값은 `--file`이나 표준 입력으로 넘긴다.
- `keystore update`는 주지 않은 값을 현재 값으로 채운다. 조회 응답에 인증 결합 방식이 없으므로 `--auth-mode`는 매번 필수다. `--description`에 공백만 주면 현재 설명을 유지하며 설명을 지우는 경로는 없다.
- `delete`는 7일 뒤 삭제되고 콘솔에서 취소할 수 있다. `purge`는 삭제가 예약된 대상만 즉시 지우며 되돌릴 수 없다. 모든 삭제 명령에 `--yes`가 필요하다.
- 인증 정보를 지우거나 인증 설정을 바꾸기 전에 `nhncloud skm confirm`으로 현재 IP·MAC을 확인한다. 실행 위치가 키를 쓰지 못하게 될 수 있다.
- 인증서 추가는 `--life-time <days>`가 필수다. 비밀번호는 `--password` 대신 `--password-file`이나 표준 입력을 권장하며, 끝 줄바꿈(`\n` 또는 `\r\n`) 하나를 지운다.
- 대칭키·비대칭키는 자동 회전 없이 만들어진다. 자동 회전은 콘솔에서 설정한다.
- MAC 값은 소문자로 바꿔 보내므로 콘솔에서 대문자로 등록한 MAC은 CLI로 지우지 못할 수 있다.

값이 JSON 객체인 기밀 데이터는 `secret patch`로 최상위 필드 하나만 더하거나 바꾸거나 지운다.

```bash
printf '%s' "$NEW_PASSWORD" | nhncloud skm secret patch <key-id> db_password --replace          # 미리보기
printf '%s' "$NEW_PASSWORD" | nhncloud skm secret patch <key-id> db_password --replace --yes    # 반영
nhncloud skm secret patch <key-id> old_field --delete --yes
```

- 값이 JSON 객체인 기밀 데이터에만 쓴다. 값이 JSON 객체가 아니거나, 다시 쓰면 바뀌는 숫자(안전 정수 범위 밖의 정수, 유효 숫자 15자리를 넘는 소수)가 있으면 종료 코드 3이다.
- 새 값은 `--file`이나 표준 입력으로만 받고 JSON 문자열로 들어간다. 끝 줄바꿈도 값에 들어가므로 `echo` 대신 `printf '%s'`로 넘긴다.
- 기본은 미리보기라 동작(`action`)만 출력하고 쓰지 않는다. `--yes`를 줄 때만 전체 값을 쓴다. 동작이 `unchanged`면 `--yes`를 줘도 쓰지 않는다.
- 이미 있는 필드의 값을 다른 값으로 바꾸려면 `--replace`가 필요하다. 없으면 미리보기에서도 종료 코드 3이다. `--delete`는 `--file`·`--replace`와 함께 쓸 수 없고, 지울 필드가 없으면 `unchanged`다.
- 반영 뒤 같은 키를 다시 조회해 바꾼 필드와 다른 필드를 대조하고, 결과를 `fieldVerified`, `othersVerified`로 낸다. 어긋나거나 다시 조회하지 못하면 결과를 출력한 뒤 종료 코드 1로 끝난다.
- 실패 문구에 따라 할 일이 다르다.
  - 쓰기 요청 실패: 반영 여부를 알 수 없다. 같은 명령을 `--yes` 없이 다시 실행해 `action`이 `unchanged`인지 확인한다.
  - 다시 조회 실패: 값은 바꿨지만 검증하지 못했다. `secret get`으로 현재 값을 확인한다.
  - 대조 불일치: 다른 쓰기가 끼어들었거나 승인 기능 때문에 변경이 대기 중일 수 있다. `secret get`으로 현재 값을 확인한다.
- 기밀 데이터에는 버전이 없다. 같은 키를 동시에 고치면 나중에 쓴 쪽이 앞의 변경을 덮어쓰고, 덮어쓴 값은 되돌릴 수 없다.
- 같은 이름의 키가 둘 이상이면 뒤의 것만 남는다. 들여쓰기와 끝 줄바꿈은 원래 값을 따르고, 그 밖의 공백, 이스케이프, 숫자 표기(`1.0` 은 `1`)는 다시 쓴다. 필드 순서는 유지하고 새 필드는 끝에 붙는다.

## 입력과 크기 한도

암복호화·서명·검증 명령의 입력은 `--plaintext`·`--ciphertext`, `--file`, 표준 입력 순서로 고른다.

- `--plaintext`로 넘긴 값은 셸 히스토리와 프로세스 목록에 남는다. 비밀 평문은 `--file`이나 표준 입력으로 넘긴다.
- 입력의 끝 줄바꿈과 BOM을 지우지 않는다. 줄바꿈 없는 값은 `echo` 대신 `printf`로 넘긴다.
- 크기 한도는 명령마다 다르다.
  - `symmetric-key encrypt`: 평문 32KB(32768바이트)
  - `symmetric-key decrypt`: 암호문 1MB(1,000,000바이트)
  - `asymmetric-key sign`·`verify`: 245바이트, `--standard`를 주면 64KB(65536바이트)
  - `key create --type secret`·`secret update`: 기밀 데이터 값 1MB(1,000,000바이트)
  - `secret patch`: 필드에 넣을 값 1MB(1,000,000바이트)
  - 인증서 비밀번호: 1024바이트
- 기밀 데이터는 공식 문서 기준 32KB 이하 텍스트이며, 이 상한은 서버가 판정한다.
- `--standard`는 바이너리 입력을 base64로 바꿔 보낸다.

```bash
printf 'hello' | nhncloud skm symmetric-key encrypt <key-id> --quiet
```

## 비밀값 출력

비밀값을 출력하는 명령은 값을 숨기지 않는다.
`--quiet`는 원문 뒤에 줄바꿈 하나를 붙이고, `--json`은 응답 그대로, 기본 출력은 제어 문자만 `?`로 바꾼 값을 낸다.
입력은 끝 줄바꿈을 지우지 않으므로 `--quiet` 출력을 다른 skm 명령의 입력으로 넘기면 그 줄바꿈까지 암호화·서명된다.
원문만 넘기려면 `--json` 출력에서 줄바꿈 없이 값을 꺼낸다.

```bash
nhncloud skm secret get <key-id> --json | jq -j '.secret' > secret.txt
```

`secret get --field <name>`은 값이 JSON 객체인 기밀 데이터에서 최상위 필드 하나만 낸다.
`--json` 출력은 `{ keyId, field, value }`이고 `value`는 필드의 원래 JSON 타입이다.
필드가 없거나 값이 JSON 객체가 아니면 종료 코드 3이다.
문자열이 아닌 필드의 숫자가 정밀도를 잃을 수 있으면(안전 정수 범위를 넘거나 유효 숫자 15자리를 넘으면) 이때도 종료 코드 3이다.

인증서 인증 상세의 `password`는 `***`로 가린다.
`secret update`는 바꾼 값을 출력하지 않는다.
`secret patch`는 값과 해시를 출력하지 않는다. 출력은 `keyId`, `field`, `action`, `applied`, `fieldVerified`, `othersVerified`뿐이다.
`symmetric-key get`은 대칭키 원문을 stdout에 낸다.
`key get`, `keystore get`, `keystore auth get`은 메타데이터만 출력하고 키 원문과 인증서 비밀번호는 내지 않는다.
비밀값 명령의 stdout을 로그나 이슈, 채팅에 붙이지 않는다.

## 서명 검증 종료 코드

`asymmetric-key verify`는 검증 결과가 `false`면 종료 코드 1을 반환한다.
`--quiet`에서는 stdout이 비어 있으므로 종료 코드로 판단한다.

```bash
if nhncloud skm asymmetric-key verify <key-id> --plaintext hello --signature <signature>; then
  echo ok
fi
```

`--standard` 검증에 넘길 `--key-version`은 `asymmetric-key sign --standard --json` 출력의 `keyVersion`에서 얻는다.
