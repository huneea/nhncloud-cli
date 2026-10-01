# Secure Key Manager 명령 안내

`skm` 명령군은 키 저장소·키·인증 정보를 조회하고 만들고 지우며, 기밀 데이터 조회·수정, 대칭키 암복호화, 비대칭키 서명·검증, 키 원문 조회를 지원한다.
키 저장소의 인증 정보 등록과 키 생성·삭제도 같은 명령군에서 한다.

## 인증과 설정

공통 UAK와 SKM `appKey`가 필요하다.
`nhncloud configure --skm-appkey <appkey>`로 profile의 `skm.appkey`를 설정한다.

API 요청은 공통 UAK로 발급한 Bearer 토큰을 `X-NHN-Authorization` 헤더에 담는다.
표준 `Authorization` 헤더가 아니므로 직접 API를 호출할 때 혼동하지 않는다.

공공망은 profile의 `"environment": "gov"`로 고른다.

## 클라이언트 인증

키 저장소에 등록한 클라이언트 인증 정보와 호출 환경이 맞아야 키와 데이터를 읽을 수 있다.
CLI는 IPv4 인증과 MAC 인증을 지원한다. 인증서 인증 정보 등록(`auth add --type certificate`)은 지원하지만, CLI가 클라이언트 인증서를 보내 인증하는 것은 지원하지 않는다.

- IPv4 인증은 서버가 본 요청 출발지 IP가 키 저장소에 등록돼 있어야 한다. 이 IP는 공인 IP와 다를 수 있다.
  - 사내망처럼 내부 경로로 SKM endpoint에 닿는 환경에서는 서버에 사설 IP(예: `10.x.x.x`)로 보인다. 이때 공인 IP만 등록하면 `ipv4 auth failure`로 실패한다.
  - 허용 IP는 `nhncloud skm confirm`의 `clientIp`를 기준으로 등록한다. 출발지 IP가 바뀔 수 있으면 `skm keystore auth add <keystore-id> <대역>/24 --type ipv4`처럼 CIDR 대역으로 등록한다.
- MAC 인증을 켠 키 저장소는 `--mac-address aa:bb:cc:dd:ee:ff`로 MAC을 넘긴다. 콜론 형식만 받고 소문자로 바꿔 보낸다.
- `nhncloud skm confirm`은 서버가 본 클라이언트 IP와 MAC 헤더를 보여 준다. 인증 오류가 나면 먼저 확인한다.

## 명령 탐색

정확한 명령 경로와 옵션은 `nhncloud commands --json`에서 확인한다.

```bash
nhncloud skm keystore list
nhncloud skm key list <keystore-id>
nhncloud skm secret get <key-id> --quiet
```

`--quiet`가 출력하는 값은 다음과 같다.

- `keystore list`: `keyStoreId`
- `key list`: `keyId`
- `secret get`: 기밀 데이터
- `symmetric-key encrypt`: 암호문
- `symmetric-key decrypt`: 평문
- `asymmetric-key sign`: 서명값
- `asymmetric-key public-key`·`private-key`: `standardEncodedKey`
- `symmetric-key create-local-key`: 평문 키와 암호화된 키 두 줄
- `asymmetric-key verify`: 출력 없음
- `key create`·`secret update`·`key delete|purge`: `keyId`
- `keystore create|update|delete`: `keyStoreId`
- `keystore auth add|delete|purge`: 입력한 IPv4·MAC 값(소문자로 정규화) 또는 인증서 이름

## 쓰기 명령

처음 구성하는 순서 예시는 다음과 같다.

```bash
nhncloud skm keystore create --name <name> --auth ipv4
nhncloud skm keystore auth add <keystore-id> 10.0.0.1 --type ipv4
nhncloud skm keystore auth add <keystore-id> 10.0.0.0/24 --type ipv4   # CIDR 대역도 등록할 수 있다
printf '%s' "$SECRET" | nhncloud skm key create <keystore-id> --type secret --name <name>
```

- 키 저장소는 `<keystore-id>`로 지정하고, CLI가 키 저장소 이름을 조회해 요청에 넣는다.
- `keystore update`는 주지 않은 값을 현재 값으로 채운다. 조회 응답에 인증 결합 방식이 없으므로 `--auth-mode`는 매번 필수다. `--description`에 공백만 주면 현재 설명을 유지하며 설명을 지우는 경로는 없다.
- `delete`는 7일 뒤 삭제되고 콘솔에서 취소할 수 있다. `purge`는 삭제가 예약된 대상만 즉시 지우며 되돌릴 수 없다. 모든 삭제 명령에 `--yes`가 필요하다.
- 인증 정보를 지우거나 인증 설정을 바꾸기 전에 `nhncloud skm confirm`으로 현재 IP·MAC을 확인한다. 실행 위치가 키를 쓰지 못하게 될 수 있다.
- 인증서 추가는 `--life-time <days>`가 필수다. 비밀번호는 `--password` 대신 `--password-file`이나 표준 입력을 권장하며, 끝 줄바꿈(`\n` 또는 `\r\n`) 하나를 지운다.
- 대칭키·비대칭키는 자동 회전 없이 만들어진다. 자동 회전은 콘솔에서 설정한다.
- MAC 값은 소문자로 바꿔 보내므로 콘솔에서 대문자로 등록한 MAC은 CLI로 지우지 못할 수 있다.

## 입력과 크기 한도

암복호화·서명·검증 명령의 입력은 `--plaintext`·`--ciphertext`, `--file`, 표준 입력 순서로 고른다.

- `--plaintext`로 넘긴 값은 셸 히스토리와 프로세스 목록에 남는다. 비밀 평문은 `--file`이나 표준 입력으로 넘긴다.
- 입력의 끝 줄바꿈과 BOM을 지우지 않는다. 줄바꿈 없는 값은 `echo` 대신 `printf`로 넘긴다.
- 크기 한도는 명령마다 다르다.
  - `symmetric-key encrypt`: 평문 32KB(32768바이트)
  - `symmetric-key decrypt`: 암호문 1MB(1,000,000바이트)
  - `asymmetric-key sign`·`verify`: 245바이트, `--standard`를 주면 64KB(65536바이트)
  - `key create --type secret`·`secret update`: 기밀 데이터 값 1MB(1,000,000바이트)
  - 인증서 비밀번호: 1024바이트
- `--standard`는 바이너리 입력을 base64로 바꿔 보낸다.

```bash
printf 'hello' | nhncloud skm symmetric-key encrypt <key-id> --quiet
```

## 비밀값 출력

비밀값을 출력하는 명령은 값을 숨기지 않는다.
`--quiet`와 `--json`은 원문을, 기본 출력은 제어 문자만 `?`로 바꾼 값을 낸다.
인증서 인증 상세의 `password`는 `***`로 가린다.
`secret update`는 바꾼 값을 출력하지 않는다.
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
