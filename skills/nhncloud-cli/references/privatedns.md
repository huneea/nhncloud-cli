# Private DNS Reference

`privatedns` 명령군은 Private DNS zone 과 레코드 세트를 조회하고 만들고 고치고 지운다.
`network`와 같은 IaaS 자격증명, Keystone 토큰, network endpoint를 공유한다.
일반망은 `kr1`, `kr2`, `kr3`, 공공망은 `kr1`만 지원한다. 다른 region은 토큰을 받기 전에 종료 코드 3으로 끝난다.
region이 중요하면 `--region <region>`을 명시한다.

## 탐색 순서

자동화와 AI 에이전트는 실제 명령 표면을 확인한 뒤 zone과 레코드 세트의 식별자를 찾는다.

```bash
nhncloud commands --json \
  | jq '.commands[] | select(.path|startswith("privatedns"))'

nhncloud privatedns zone list --profile <profile> --region <region> --json
nhncloud privatedns record list <zone> --profile <profile> --region <region> --json
```

## 이름과 UUID 해석

`<zone>`에는 zone 이름 또는 UUID를 넣는다. 이름 끝의 `.`은 생략해도 된다.

- `example.net`과 `example.net.`은 같은 zone으로 본다.
- 같은 이름의 zone이 여럿이면 입력 오류로 끝난다. `zone list --json`에서 UUID를 확인해 그 UUID를 넘긴다.

`<record>`에는 레코드 세트의 UUID, FQDN(끝이 `.`), zone 기준 상대 이름, zone apex를 뜻하는 `@`를 넣는다.

- 같은 이름에 타입이 다른 레코드 세트가 여럿이면 `--type`을 요구한다.
- `--type`이 없으면 후보 `타입:UUID`가 함께 나오고 종료 코드 3으로 끝난다. 후보 중 하나를 `--type`으로 고른다.
- `--type` 값은 대소문자를 가리지 않는다. `a`와 `A`는 같다. 지원하지 않는 타입은 종료 코드 3으로 끝난다.

```bash
nhncloud privatedns record get example.net. www \
  --type A \
  --profile <profile> \
  --region <region> \
  --json
```

## 레코드 세트 쓰기

`create`, `update`, `delete`는 모두 같은 순서로 쓴다.
먼저 `--dry-run`으로 보낼 요청 본문을 확인하고, 그 다음 같은 명령에 `--yes`를 붙인다.
`--dry-run`과 `--yes`를 함께 주면 `--dry-run`이 이긴다.

```bash
# 생성: --record 는 여러 번 줄 수 있다. --ttl 을 생략하면 서버 기본값 300 을 쓴다
nhncloud privatedns record create <zone> \
  --name www \
  --type A \
  --record 10.0.0.1 \
  --record 10.0.0.2 \
  --ttl 300 \
  --profile <profile> \
  --region <region> \
  --dry-run \
  --json
nhncloud privatedns record create <zone> \
  --name www \
  --type A \
  --record 10.0.0.1 \
  --profile <profile> \
  --region <region> \
  --yes \
  --json

# 수정: 바꿀 옵션만 준다. 나머지는 현재 값을 유지한다
# --record 는 레코드 목록 전체를 준 값들로 바꾼다. 타입은 바꿀 수 없다
nhncloud privatedns record update <zone> www \
  --type A \
  --ttl 600 \
  --profile <profile> \
  --region <region> \
  --dry-run \
  --json

# 삭제
nhncloud privatedns record delete <zone> www \
  --type A \
  --profile <profile> \
  --region <region> \
  --yes \
  --json
```

- `update`는 현재 값을 읽은 뒤 준 옵션만 바꾸고 전체 본문을 보낸다. `--description ""`이면 설명을 비운다.
- SOA와 zone apex NS는 만들 수도 없고 고치거나 지울 수도 없다.
- `delete`의 `<record>`도 이름 해석 규칙을 따른다. 이름이 같은 레코드 세트가 여럿이면 `--type`을 붙인다.

## zone 쓰기

```bash
# 생성: --network 는 VPC 이름 또는 UUID 를 여러 번 줄 수 있다
# 생성 직후 상태는 BUILD 다. CLI 는 ACTIVE 를 기다리지 않는다
nhncloud privatedns zone create \
  --name example.net. \
  --network <vpc-id> \
  --description <description> \
  --profile <profile> \
  --region <region> \
  --dry-run \
  --json
nhncloud privatedns zone create \
  --name example.net. \
  --network <vpc-id> \
  --profile <profile> \
  --region <region> \
  --yes \
  --json

# 상태 확인: ACTIVE 가 된 뒤에 레코드를 만든다
nhncloud privatedns zone get example.net. \
  --profile <profile> \
  --region <region> \
  --json

# VPC 연결 변경: --add-network, --remove-network 는 더하고 뺀다
# --network 는 연결 목록 전체를 바꾸며 다른 두 옵션과 함께 쓸 수 없다
nhncloud privatedns zone update example.net. \
  --add-network <vpc-id> \
  --remove-network <other-vpc-id> \
  --profile <profile> \
  --region <region> \
  --dry-run \
  --json

# 삭제: SOA 와 apex NS 외에 레코드 세트가 남아 있으면 --force 가 필요하다
nhncloud privatedns zone delete example.net. \
  --force \
  --profile <profile> \
  --region <region> \
  --yes \
  --json
```

- `update`는 `--description`, `--network`, `--add-network`, `--remove-network` 중 준 항목만 바꾼다.
- 이미 연결된 VPC를 `--add-network`로 주면 무시한다. 연결되지 않은 VPC를 `--remove-network`로 주면 종료 코드 3으로 끝난다.
- 이미 삭제된 VPC가 zone에 남아 있으면 `--remove-network`에 이름 대신 `zone get`에 나오는 UUID를 준다. 현재 연결 목록의 UUID는 VPC 조회 없이 뺀다.
- zone 삭제 전에 남은 사용자 레코드 수를 확인하고, `--force` 없이 남아 있으면 개수를 알린 뒤 쓰지 않고 종료 코드 3으로 끝난다.

## 출력 모드

`list` 테이블의 컬럼은 아래와 같고, 명령 코드의 `headers` 배열과 같은 순서다. 전체 필드는 `--json`으로 얻는다.

| 명령 | 테이블 컬럼 |
|---|---|
| `zone list` | `id`, `name`, `status`, `records`, `vpcs`, `description` |
| `record list` | `id`, `name`, `type`, `ttl`, `records`, `description` |

- `--quiet`는 `create`와 `update`에서 대상 UUID를, `delete`에서 지운 UUID를 출력한다.
- `--dry-run`은 이름을 UUID로 바꾸는 조회와 사전 검사만 하고, 보낼 method·경로·본문을 출력한다. `--dry-run --quiet`는 아무것도 출력하지 않는다.
- 진행 상황과 경고는 stderr로 나간다. 파이프라인에는 stdout만 넘긴다.

## 실패와 재실행

- 같은 이름의 zone이 이미 있거나, 같은 이름과 타입의 레코드 세트가 이미 있으면 create가 거부한다.
- 결과를 모르는 실패(시간 초과, 연결 오류)가 나면 바로 다시 실행하지 말고 `record list`나 `zone list`로 반영 여부를 먼저 확인한다.
- 조회와 수정 사이에 다른 사용자가 같은 대상을 바꾸면 CLI는 이를 막지 않고 그 변경을 덮어쓴다. 중요한 레코드는 `--dry-run` 결과와 현재 값을 비교한 뒤 `--yes`를 붙인다.
- 입력 오류(zone 또는 레코드 없음, 이름과 타입 중복, SOA나 apex NS 대상, 바꿀 옵션 없음)는 쓰기 요청 전에 종료 코드 3으로 끝난다.
- 서버가 요청을 거절하면(HTTP 400, 409) 서버가 준 메시지를 덧붙여 종료 코드 1로 끝난다.

## 실측 메모

- 조회 응답은 공공망 kr1에서 실제로 호출해 확인했다(2026-10-28). 단건 조회는 `zone`·`rrset` 객체로 오고, 서버가 만든 SOA·NS 레코드 세트는 `description`이 `null`이다.
- zone 이름 필터는 끝에 `.`이 있어야 서버가 찾는다. CLI가 `.`을 붙여 보낸다.
- 쓰기 명령도 공공망 kr1의 임시 zone으로 생성부터 삭제까지 확인했다(2026-10-28).
  - zone 생성 응답은 `status: BUILD`이고, 바로 다음 `zone get`에서 `ACTIVE`였다. VPC를 더할 때도 잠시 `BUILD`가 된다.
  - 생성 응답의 `updated_at`은 `created_at`과 같은 값으로 왔다.
  - `--description` 없이 만든 레코드 세트는 `description`이 `""`로 온다.
  - `record update --ttl`만 준 수정에서 레코드 값과 설명이 그대로 남았다. 서버가 돌려주는 레코드 순서는 바뀔 수 있다.
  - zone 의 설명과 VPC 연결을 바꿔도 레코드 세트는 바뀌지 않았다.
  - 레코드 세트를 지운 직후 같은 zone 을 `--force` 없이 지울 수 있었다.
