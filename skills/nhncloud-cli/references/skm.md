# Secure Key Manager 조회·데이터 명령 안내

`skm` 명령군은 키 저장소·키·인증 정보를 조회하고 기밀 데이터 조회, 대칭키 암복호화, 비대칭키 서명·검증, 키 원문 조회를 지원한다.
키 저장소와 키의 생성·수정·삭제는 지원하지 않는다.

## 인증과 설정

공통 UAK와 SKM `appKey`가 필요하다.
`nhncloud configure --skm-appkey <appkey>`로 profile의 `skm.appkey`를 설정한다.

API 요청은 공통 UAK로 발급한 Bearer 토큰을 `X-NHN-Authorization` 헤더에 담는다.
표준 `Authorization` 헤더가 아니므로 직접 API를 호출할 때 혼동하지 않는다.

공공망은 profile의 `"environment": "gov"`로 고른다.

## 클라이언트 인증

키 저장소에 등록한 클라이언트 인증 정보와 호출 환경이 맞아야 키와 데이터를 읽을 수 있다.
CLI는 IPv4 인증과 MAC 인증을 지원하고 인증서 인증은 지원하지 않는다.

- IPv4 인증은 호출한 곳의 공인 IP가 키 저장소에 등록돼 있어야 한다.
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

## 입력과 크기 한도

암복호화·서명·검증 명령의 입력은 `--plaintext`·`--ciphertext`, `--file`, 표준 입력 순서로 고른다.

- `--plaintext`로 넘긴 값은 셸 히스토리와 프로세스 목록에 남는다. 비밀 평문은 `--file`이나 표준 입력으로 넘긴다.
- 입력의 끝 줄바꿈과 BOM을 지우지 않는다. 줄바꿈 없는 값은 `echo` 대신 `printf`로 넘긴다.
- 한도는 대칭키 암복호화 32KB, 비대칭키 서명·검증 245바이트다. `--standard`는 64KB까지 받는다.
- `--standard`는 바이너리 입력을 base64로 바꿔 보낸다.

```bash
printf 'hello' | nhncloud skm symmetric-key encrypt <key-id> --quiet
```

## 비밀값 출력

비밀값을 출력하는 명령은 값을 숨기지 않는다.
`--quiet`와 `--json`은 원문을, 기본 출력은 제어 문자만 `?`로 바꾼 값을 낸다.
인증서 인증 상세의 `password`는 `***`로 가린다.
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
