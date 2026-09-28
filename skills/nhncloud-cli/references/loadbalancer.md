# Load Balancer Reference

`loadbalancer` 명령군은 Load Balancer와 IP ACL 그룹·대상을 조회하고 관리한다.
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

# 대상 추가와 삭제
nhncloud loadbalancer ipacl target add <group> \
  --cidr <ip-or-cidr> \
  --description <description> \
  --profile <profile> \
  --region <region> \
  --yes \
  --json
nhncloud loadbalancer ipacl target remove <target-id> \
  --profile <profile> \
  --region <region> \
  --yes \
  --json
```

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

## 출력 모드

| 명령 | `--json` 출력 | `--quiet` 출력 |
|------|----------------|----------------|
| `loadbalancer list` | Load Balancer 배열 | Load Balancer UUID를 한 줄에 하나씩 출력 |
| `loadbalancer get` | 단일 Load Balancer 객체 | 선택한 Load Balancer UUID 한 줄 |
| `loadbalancer ipacl list` | IP ACL 그룹 배열 | IP ACL 그룹 UUID를 한 줄에 하나씩 출력 |
| `loadbalancer ipacl get` | 단일 IP ACL 그룹 객체 | 선택한 IP ACL 그룹 UUID 한 줄 |
| `loadbalancer ipacl target list` | IP ACL 대상 배열 | IP ACL 대상 UUID를 한 줄에 하나씩 출력 |
| `loadbalancer ipacl create/delete` | 작업 상태와 IP ACL 그룹 UUID 객체 | IP ACL 그룹 UUID 한 줄 |
| `loadbalancer ipacl target add/remove` | 대상과 재바인딩 결과 객체 | IP ACL 대상 UUID 한 줄 |
| `loadbalancer set-ipacl/clear-ipacl` | 작업 상태와 Load Balancer·그룹 UUID 객체 | Load Balancer UUID 한 줄 |

옵션을 생략하면 사람이 읽기 좋은 테이블을 출력한다.
목록이 비어 있으면 기본 모드는 `결과 없음`을 stdout에 출력하고, `--json`은 빈 배열을 출력하며, `--quiet`는 출력하지 않는다.
`--json`은 NHN Cloud 응답의 최상위 래퍼를 제거한 객체 또는 배열이다.

## stdout과 stderr

- 테이블, JSON, UUID, 정상 빈 결과는 stdout에 출력한다.
- 진행 상황, 운영 경고, 오류는 stderr에 출력한다.
- 파이프라인에서는 stdout만 다음 명령에 전달하고 stderr는 진단 로그로 분리한다.
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
