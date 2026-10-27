# Load Balancer Reference

`loadbalancer` 명령군은 Load Balancer, 리스너, 풀과 멤버, 헬스 모니터, L7 정책과 규칙, TLS 인증서, IP ACL 그룹·대상을 조회하고 관리한다.
`network`와 같은 IaaS 자격증명, Keystone 토큰, network endpoint를 공유한다.
region이 중요하면 `--region <region>`을 명시한다.

## 탐색 순서

자동화와 AI 에이전트는 실제 명령 표면을 확인한 뒤 목록에서 UUID를 찾는다.

```bash
nhncloud commands --json \
  | jq '.commands[] | select(.path|startswith("loadbalancer"))'

nhncloud loadbalancer list --profile <profile> --region <region> --json
nhncloud loadbalancer ipacl list --profile <profile> --region <region> --json
nhncloud loadbalancer ipacl target list <group> \
  --profile <profile> \
  --region <region> \
  --json
```

단건 Load Balancer 테이블에는 `id`, `name`, `vip_address`, `provisioning_status`, `operating_status`, `ipacl_group_action`, `ipacl_group_ids`가 행으로 출력된다.
IP ACL이 연결되지 않은 Load Balancer는 공식 문서와 달리 응답에 `ipacl_group_action` 칸이 없으며(`ipacl_groups`는 빈 배열), 표에서는 빈 값으로 출력하고 `--json`은 응답을 그대로 보존한다.
단건 IP ACL 그룹 테이블에는 `id`, `name`, `action`, `ipacl_target_count`, `loadbalancer_ids`가 행으로 출력된다.

## 이름과 UUID 해석

`<loadbalancer>`와 `<group>`에는 이름 또는 UUID를 넣는다.

1. UUID가 정확히 일치하면 해당 리소스를 선택한다.
2. UUID가 아니면 정확히 일치하는 이름을 찾는다.
3. 이름이 하나만 일치하면 해당 리소스를 선택한다.
4. 같은 이름이 여러 개면 입력 오류와 후보 UUID를 출력한다.
5. 일치하는 리소스가 없으면 입력 오류로 종료한다.

중복 이름으로 자동화가 불안정해지는 것을 막으려면 목록에서 UUID를 확인한 뒤 다음 명령에 전달한다.

```bash
profile_name="<profile>"
region_name="<region>"
loadbalancer_id="<loadbalancer-id>"

nhncloud loadbalancer list \
  --profile "$profile_name" \
  --region "$region_name" \
  --json \
  | jq -r '.[] | [.name, .id] | @tsv'

nhncloud loadbalancer get "$loadbalancer_id" \
  --profile "$profile_name" \
  --region "$region_name" \
  --json
```

`target remove`의 `<target-id>`는 이름 해석을 하지 않는다.
`target list` 또는 이전 쓰기 결과에서 확인한 UUID를 그대로 전달한다.

## 쓰기 절차

쓰기 전에 현재 리소스를 `--json`으로 조회한다.
명령에는 `--profile`, `--region`, `--json`을 명시한다.
삭제·연결 교체·대상 변경에는 `--yes`도 명시한다.

```bash
# 그룹 생성
nhncloud loadbalancer ipacl create \
  --name <group-name> \
  --action ALLOW \
  --description <description> \
  --profile <profile> \
  --region <region> \
  --json

# 그룹 삭제: 대상과 Load Balancer 연결 규칙도 함께 제거
nhncloud loadbalancer ipacl delete <group> \
  --profile <profile> \
  --region <region> \
  --yes \
  --json

# 연결 전체 교체: --group은 반복 가능하며 action이 모두 같아야 함
nhncloud loadbalancer set-ipacl <loadbalancer> \
  --group <group> \
  --group <other-group> \
  --profile <profile> \
  --region <region> \
  --yes \
  --json

# 연결 전체 해제
nhncloud loadbalancer clear-ipacl <loadbalancer> \
  --profile <profile> \
  --region <region> \
  --yes \
  --json

# 대상 추가: --cidr 는 여러 번 줄 수 있다. 먼저 --dry-run 으로 확인한다
nhncloud loadbalancer ipacl target add <group> \
  --cidr <ip-or-cidr> \
  --cidr <ip-or-cidr> \
  --description <description> \
  --profile <profile> \
  --region <region> \
  --dry-run \
  --json
nhncloud loadbalancer ipacl target add <group> \
  --cidr <ip-or-cidr> \
  --description <description> \
  --profile <profile> \
  --region <region> \
  --yes \
  --json

# 대상 설명 변경: CIDR 은 바꿀 수 없으니 바꾸려면 삭제 후 다시 추가한다
nhncloud loadbalancer ipacl target update <target-id> \
  --description <description> \
  --profile <profile> \
  --region <region> \
  --json

# 대상 삭제: delete 는 remove 의 별칭이다
nhncloud loadbalancer ipacl target remove <target-id> \
  --profile <profile> \
  --region <region> \
  --yes \
  --json
```

`target add`는 그룹의 기존 대상과 입력 안의 반복을 비교해 이미 있는 CIDR은 만들지 않고 stderr 로 알린다.
단독 IP 는 `/32`(IPv6 는 `/128`)와 같은 대상으로 본다.
건너뛴 항목은 `skipped_duplicates`, 만든 항목은 `targets` 에 담긴다.
모두 중복이면 `status` 는 `unchanged` 이고 대상 생성도 재바인딩도 하지 않으며 종료 코드는 0 이다.
이때 `target` 과 `--quiet` 출력에는 건너뛴 기존 대상 id 를 내고, `rebind.skipped` 는 `--no-rebind` 를 쓴 경우에만 `true` 다.
`--description` 은 이번 호출에서 만드는 모든 대상에 같은 값을 쓴다.
`--dry-run` 은 `--yes` 없이 쓰기 없이 `would_create`, `skipped_duplicates`, `loadbalancers_to_rebind` 만 출력한다.
`loadbalancers_to_rebind` 는 만들 대상이 없거나 `--no-rebind` 이면 빈 배열이고, 아니면 실제 실행과 같게 중복을 없애 ID 순으로 정렬한다.
여러 대상을 만드는 중간에 실패하면 이미 만든 대상은 되돌리지 않고 그 대상으로 재바인딩을 계속한다.
이때 `status` 는 `partial` 이고 `failed_creates` 와 `not_attempted` 를 stdout 에 내며 종료 코드는 API 오류다.
같은 명령을 다시 실행하면 이미 만든 대상은 건너뛴다.
`target update` 는 설명만 바꾸므로 `--yes` 와 재바인딩이 없다.

`set-ipacl`은 기존 연결에 그룹을 추가하는 명령이 아니다.
전달한 그룹 목록으로 기존 연결 전체를 교체한다.
모든 연결을 없애려면 그룹을 생략하지 말고 `clear-ipacl`을 사용한다.

대상 추가·삭제는 변경 전에 연결 상태를 모두 수집한다.
수집이 하나라도 실패하면 대상을 변경하지 않는다.
대상 변경 후에는 관련 Load Balancer를 ID 순서로 재바인딩하고, 한 건이 실패해도 나머지를 계속 처리한다.
자동 되돌리기는 수행하지 않는다.

`--no-rebind`는 재바인딩만 생략한다.
데이터 영역에 규칙이 즉시 반영되지 않을 수 있으므로 의도적으로 지연을 감수할 때만 사용한다.
대상 변경의 반영에는 약 10–20초가 걸릴 수 있다.
`ALLOW` 그룹 대상에는 Load Balancer가 속한 VPC의 private CIDR을 사용한다.

## 리스너, 풀, 헬스 모니터, L7, 인증서

새 도메인을 HTTPS 로 Load Balancer 에 붙이는 순서다.
쓰기 명령은 모두 `--yes` 나 `--dry-run` 이 있어야 실행한다.
`--dry-run` 은 이름을 UUID 로 바꾸는 조회만 하고 보낼 method, 경로, 본문을 출력한다.
먼저 `--dry-run` 으로 본문을 확인한 뒤 같은 명령을 `--yes` 로 다시 실행한다.

```bash
# 1. 인증서 업로드: PEM 파일 경로만 받는다. 개인 키는 비밀번호를 제거한 것이어야 한다
nhncloud loadbalancer certificate upload \
  --name <cert-name> \
  --certificate-file <cert.pem> \
  --private-key-file <key.pem> \
  --intermediates-file <chain.pem> \
  --profile <profile> --region <region> --yes --json

# 2. 풀과 멤버, 헬스 모니터
nhncloud loadbalancer pool create --loadbalancer <loadbalancer> \
  --protocol HTTP --lb-algorithm ROUND_ROBIN --name <pool-name> \
  --profile <profile> --region <region> --yes --json
nhncloud loadbalancer pool member create <pool> \
  --address <member-ip> --port <member-port> --subnet <subnet-id> \
  --profile <profile> --region <region> --yes --json
nhncloud loadbalancer healthmonitor create --pool <pool> \
  --type HTTP --delay 30 --timeout 5 --max-retries 3 --url-path /health \
  --profile <profile> --region <region> --yes --json

# 3. HTTPS 리스너: TERMINATED_HTTPS 는 --certificate 필수
nhncloud loadbalancer listener create --loadbalancer <loadbalancer> \
  --protocol TERMINATED_HTTPS --port 443 \
  --certificate <cert-name> --default-pool <pool> \
  --profile <profile> --region <region> --yes --json

# 4. 기존 리스너에 Host 헤더 라우팅을 더할 때: 정책을 만들고 HOST_NAME 규칙을 붙인다
nhncloud loadbalancer l7policy create --listener <listener> \
  --action REDIRECT_TO_POOL --pool <pool> --name <policy-name> \
  --profile <profile> --region <region> --yes --json
nhncloud loadbalancer l7policy rule create <policy> \
  --type HOST_NAME --compare-type EQUAL_TO --value <domain> \
  --profile <profile> --region <region> --yes --json
```

- 리스너, 풀, L7 정책과 인증서는 이름이나 UUID 로 지정한다. 멤버, 헬스 모니터, L7 규칙은 이름이 없어 UUID 만 받는다.
- `listener list --loadbalancer`, `pool list --loadbalancer`, `l7policy list --listener` 는 받은 전체 목록을 CLI 가 필터링한다.
- `--certificate` 와 `--sni-certificate` 는 인증서 컨테이너 이름, UUID, `container_ref` 주소를 받는다. 주소를 주면 key-manager 를 조회하지 않는다.
- L7 규칙의 `invert` 는 `--invert` 가 없으면 `false` 로 명시해 보낸다. API 문서는 생략하면 `true` 라고 적는다.
- `HEADER`, `COOKIE` 규칙은 `--key` 가 필요하다. `REDIRECT_TO_POOL` 정책은 `--pool`, `REDIRECT_TO_URL` 정책은 `--redirect-url` 이 필요하다.
- 쓰기 뒤 Load Balancer 는 잠시 `PENDING_UPDATE` 가 되고, 그동안의 다른 쓰기는 HTTP 409 로 거절된다. `loadbalancer get` 으로 `provisioning_status` 가 `ACTIVE` 인지 보고 다음 쓰기를 실행한다.
- 인증서 추가는 Load Balancer 를 재기동한다. 새 세션이 1초 미만 처리되지 않을 수 있다.
- 수정(update) 명령과 기본 인증서 변경은 없다. 콘솔에서 한다.
- 빈 값을 준 선택 옵션(`--default-pool " "` 등)은 자격증명을 읽기 전에 종료 코드 3으로 막는다.

| 명령 | 선택 옵션 |
|------|-----------|
| `listener create` | `--name`, `--description`, `--default-pool`, `--certificate`, `--sni-certificate`(반복), `--tls-version`(TERMINATED_HTTPS 만, 예: `TLSv1.2`), `--connection-limit`, `--keepalive-timeout`(초) |
| `pool create` | `--loadbalancer` 또는 `--listener`(하나만), `--member-port`, `--name`, `--description` |
| `pool member create` | `--weight` |
| `healthmonitor create` | `--url-path`, `--http-method`, `--expected-codes`(예: `200`, `200-204`), `--health-check-port`(0 이면 멤버 포트), `--host-header` |
| `l7policy create` | `--pool`(REDIRECT_TO_POOL), `--redirect-url`, `--redirect-http-code`(301 또는 302), `--position`(1 이상, 생략하면 마지막), `--name`, `--description` |
| `l7policy rule create` | `--key`(HEADER, COOKIE), `--invert` |
| `certificate upload` | `--intermediates-file` |

### 인증서

- 인증서는 공용망과 공공망 모두 key-manager(OpenStack Barbican) 의 시크릿과 `certificate` 컨테이너로 저장한다. host 만 다르다.
- `certificate upload` 는 인증서, 개인 키, 체인 인증서 시크릿(`<name>-certificate`, `<name>-private-key`, `<name>-intermediates`)을 만들고 컨테이너로 묶는다.
  - 같은 이름의 인증서 컨테이너가 이미 있으면 올리기 전에 종료 코드 3으로 막는다.
  - 서버가 거절한 응답(HTTP 4xx, 5xx)으로 실패하면 이번에 만든 시크릿을 지우고 실패로 끝난다. 지우지 못한 시크릿은 오류 메시지에 `secret_ref` 로 남는다.
  - 시간 초과나 연결 오류처럼 결과를 모르는 실패는 그 시크릿이나 컨테이너가 만들어졌을 수 있다고 알린다. 컨테이너 단계에서 결과를 모르면 컨테이너가 시크릿을 참조할 수 있어 시크릿을 지우지 않고 `secret_ref` 를 알린다. `certificate list` 로 확인한다.
- 시크릿 payload 는 어떤 출력에도 나오지 않는다. `--dry-run` 은 payload 자리에 파일 경로와 바이트 수만 쓴다.
- 암호화된 개인 키(`ENCRYPTED PRIVATE KEY`), OpenSSH 형식 개인 키, 개인 키를 함께 넣은 인증서나 체인 인증서 파일은 요청 전에 종료 코드 3으로 막는다.
- `certificate list` 는 `certificate` 타입 컨테이너만 보여 준다. `certificate get` 은 컨테이너 정보만 조회하고 시크릿 내용은 읽지 않는다.
- key-manager 가 HTTP 403 이면 IAM 계정에 key-manager 권한이 없는 것이다. 종료 코드 2와 함께 안내 문구를 낸다.

## 출력 모드

| 명령 | `--json` 출력 | `--quiet` 출력 |
|------|----------------|----------------|
| `loadbalancer list` | Load Balancer 배열 | Load Balancer UUID를 한 줄에 하나씩 출력 |
| `loadbalancer get` | 단일 Load Balancer 객체 | 선택한 Load Balancer UUID 한 줄 |
| `loadbalancer ipacl list` | IP ACL 그룹 배열 | IP ACL 그룹 UUID를 한 줄에 하나씩 출력 |
| `loadbalancer ipacl get` | 단일 IP ACL 그룹 객체 | 선택한 IP ACL 그룹 UUID 한 줄 |
| `loadbalancer ipacl target list` | IP ACL 대상 배열 | IP ACL 대상 UUID를 한 줄에 하나씩 출력 |
| `loadbalancer ipacl create/delete` | 작업 상태와 IP ACL 그룹 UUID 객체 | IP ACL 그룹 UUID 한 줄 |
| `loadbalancer ipacl target add` | 만든 대상 `targets`, 건너뛴 `skipped_duplicates`, 재바인딩 결과 객체 | 만든 IP ACL 대상 UUID 를 한 줄에 하나씩 출력 |
| `loadbalancer ipacl target update/remove` | 대상(update 는 CIDR·설명 포함)과 작업 상태 객체 | IP ACL 대상 UUID 한 줄 |
| `loadbalancer set-ipacl/clear-ipacl` | 작업 상태와 Load Balancer·그룹 UUID 객체 | Load Balancer UUID 한 줄 |
| `loadbalancer listener/pool/healthmonitor/l7policy list`, `pool member list`, `l7policy rule list`, `certificate list` | 리소스 배열 | 리소스 UUID 를 한 줄에 하나씩 출력 |
| 위 리소스의 `get`, `create` | 단일 리소스 객체 | 리소스 UUID 한 줄 |
| 위 리소스의 `delete` | 작업 상태와 지운 UUID 객체 | 지운 리소스 UUID 한 줄 |
| 쓰기 명령의 `--dry-run` | `operation`, `dry_run`, `requests`(method, path, body) 객체 | 출력하지 않는다 |
| `loadbalancer certificate upload` | 작업 상태, `container_ref`, 시크릿 이름과 `secret_ref` 객체 | 컨테이너 UUID 한 줄 |

옵션을 생략하면 사람이 읽기 좋은 테이블을 출력한다.
목록이 비어 있으면 기본 모드는 `결과 없음`을 stdout에 출력하고, `--json`은 빈 배열을 출력하며, `--quiet`는 출력하지 않는다.
`--json`은 NHN Cloud 응답의 최상위 래퍼를 제거한 객체 또는 배열이다.

## stdout과 stderr

stdout과 stderr 분리 규칙은 [SKILL.md](../SKILL.md)를 따른다.

- 부분 실패에서도 JSON 또는 UUID를 stdout에 먼저 출력한 뒤 stderr에 복구 안내를 출력한다.

## 부분 실패 복구

대상 변경이 성공했지만 일부 Load Balancer 재바인딩이 실패하면 종료 코드 1을 반환한다.
stdout JSON의 `status`는 `partial`이며, 실패마다 기계 실행용 `retry_argv`와 사람 확인용 `retry_command`를 제공한다.
사용자가 명시한 profile과 region은 `retry_argv`에 보존된다.

```json
{
  "operation": "ipacl-target-add",
  "status": "partial",
  "target": {
    "id": "<target-id>",
    "ipacl_group_id": "<group-id>"
  },
  "targets": [
    {
      "id": "<target-id>",
      "cidr_address": "203.0.113.5",
      "ipacl_group_id": "<group-id>"
    }
  ],
  "skipped_duplicates": [],
  "rebind": {
    "skipped": false,
    "succeeded": [],
    "failed": [
      {
        "loadbalancer_id": "<loadbalancer-id>",
        "ipacl_group_ids": ["<group-id>"],
        "error": "<message>",
        "retry_argv": [
          "nhncloud",
          "loadbalancer",
          "set-ipacl",
          "<loadbalancer-id>",
          "--group",
          "<group-id>",
          "--profile",
          "<profile>",
          "--region",
          "<region>",
          "--yes",
          "--json"
        ],
        "retry_command": "'nhncloud' 'loadbalancer' 'set-ipacl' '<loadbalancer-id>' '--group' '<group-id>' '--profile' '<profile>' '--region' '<region>' '--yes' '--json'"
      }
    ]
  }
}
```

AI 에이전트는 `retry_command`를 셸에서 다시 해석하지 말고 `retry_argv` 배열을 직접 실행한다.
빈 그룹 snapshot의 복구 배열은 `clear-ipacl`을 사용한다.
복구 명령이 성공한 뒤 원래 대상 추가·삭제를 반복하지 않는다.
