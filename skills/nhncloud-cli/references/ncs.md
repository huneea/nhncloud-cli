# NCS Reference

## 설정

공통 UAK와 NCS appkey가 필요하다.

`nhncloud configure` (대화형 또는 `--ncs-appkey`) 로 설정한다.

```bash
nhncloud ncs template list
```

기본 region은 `kr1`이고, `kr1`, `kr3`만 지원한다(판교·광주).

## Template(설계도) 조회

```bash
nhncloud ncs template list --json
nhncloud ncs template list --region kr3 --json
nhncloud ncs template get <template-id> --json
nhncloud ncs template version list <template-id> --json
nhncloud ncs template version get <template-id> <version> --json
```

## Template(설계도) 생성/삭제

복잡한 생성 입력은 공식 API payload 를 JSON 파일로 전달한다(`--file`).
삭제는 위험 명령이라 비대화형 환경에서 `--yes` 가 필수이고, TTY 에서는 확인 프롬프트가 뜬다.

```bash
nhncloud ncs template create --file ./template-create.json
nhncloud ncs template delete <template-id> --yes
```

버전 생성도 동일하게 `--file` 을 쓰며, payload 의 `sourceVersion` 필드가 필수다(어느 버전을 기준으로 새 버전을 만들지 지정).

```bash
nhncloud ncs template version create <template-id> --file ./version-create.json
nhncloud ncs template version delete <template-id> <version> --yes
```

## Workload(런타임 실행) 조회

```bash
nhncloud ncs workload list --json
nhncloud ncs workload list --q <워크로드 이름> --json
nhncloud ncs workload get <workload-id> --json
```

컨테이너 로그와 이벤트는 특정 task 를 지정해야 한다.
`--task`는 `workload get` 응답의 `tasks[].id`에서 얻는다.
`--size`의 API 기본값은 `workload logs`에서 100, 나머지 `--size` 지원 명령에서 10이다.

```bash
nhncloud ncs workload logs <workload-id> --task <task-id> --container <name> --json
nhncloud ncs workload logs <workload-id> --task <task-id> --container <name> --from 1h --to now
nhncloud ncs workload events <workload-id> --task <task-id> --json
nhncloud ncs workload events <workload-id> --task <task-id> --type Warning --json
```

### logs·events 시간 필터

`--from`과 `--to`는 다음 두 형식을 받는다.

- 시간대와 초를 포함한 RFC3339 절대시간
- `now`
- 0 이상의 정수 뒤에 `m`, `h`, `d` 중 하나를 붙인 상대시간

상대시간 예시는 `30m`, `1h`, `2d`다.

```bash
# 같은 현재 시각을 기준으로 최근 1시간 조회
nhncloud ncs workload events <workload-id> \
  --task <task-id> \
  --from 1h \
  --to now \
  --profile <profile> \
  --json

# 시간대 오프셋을 포함한 절대시간 조회
nhncloud ncs workload logs <workload-id> \
  --task <task-id> \
  --container <name> \
  --from 2026-05-01T09:00:00+09:00 \
  --to 2026-05-01T10:00:00+09:00 \
  --profile <profile> \
  --json
```

CLI는 입력을 API 호출 전에 `YYYY-MM-DDTHH:mm:ssZ` 형식으로 정규화하고 소수 초를 제거한다.
두 옵션을 모두 생략하면 API 기본 범위를 사용한다.
한쪽만 지정하면 지정한 필드만 API에 전달한다.

존재하지 않는 날짜, 시간대 없는 절대시간, 지원하지 않는 상대시간 단위, `from > to`는 종료 코드 3으로 거부한다.
검증은 profile·자격증명 조회와 API 호출보다 먼저 실행된다.
AI 에이전트는 같은 입력으로 인증 재시도를 반복하지 말고 오류에 표시된 옵션 값을 수정한다.

실행 히스토리와 예약 실행 히스토리는 workload 단위로 조회한다.

```bash
nhncloud ncs workload history <workload-id> --json
nhncloud ncs workload history get <workload-id> <history-id> --json
nhncloud ncs workload schedule-history <workload-id> --json
```

## Workload 실행제어

일시정지·재개는 workload 단위, 재시작은 task 단위(`--task` 필수), 삭제는 위험 명령이라 `--yes` 필수(비대화형) 또는 확인 프롬프트(TTY)를 거친다.

```bash
nhncloud ncs workload pause <workload-id>
nhncloud ncs workload resume <workload-id>
nhncloud ncs workload restart <workload-id> --task <task-id>
nhncloud ncs workload delete <workload-id> --yes
```

## Workload 생성/변경

생성은 비동기다.
`--wait`를 주면 `Running` 상태가 될 때까지 폴링하고, `--timeout <sec>`(기본 300)으로 대기 시간을 조절한다.
변경은 `update`(PUT, 전체 교체)와 `patch`(PATCH, JSON Patch 배열 부분 변경) 두 가지다.

```bash
nhncloud ncs workload create --file ./workload-create.json --json
nhncloud ncs workload create --file ./workload-create.json --wait --timeout 600 --json

nhncloud ncs workload update <workload-id> --file ./workload-update.json --json
nhncloud ncs workload patch <workload-id> --file ./workload-patch.json --json
```

`patch`의 `--file`은 JSON Patch(RFC 6902) 배열이다.

```json
[
  { "op": "replace", "path": "/workload/desired", "value": 2 }
]
```

## 악성코드 검사(malware)

설정은 appkey 단위, 결과는 workload 실행 히스토리 단위로 조회한다.
`historyId`는 `workload history` 목록 또는 `workload history get`의 `id`를 사용한다.

```bash
nhncloud ncs malware config get --json
nhncloud ncs malware config set --enabled true
nhncloud ncs malware config set --enabled false

nhncloud ncs malware result <workload-id> <history-id> --json
```

## 체이닝 예시

```bash
nhncloud ncs template list --json | jq -r '.[].id'
nhncloud ncs workload list --json | jq -r '.[] | select(.status=="Failed") | .id'
nhncloud ncs workload get <workload-id> --json | jq -r '.tasks[].id'
nhncloud ncs workload history <workload-id> --json | jq -r '.[0].id' # 최신 historyId
```

## 주의사항

- `workload schedule-history`는 page/size를 아직 노출하지 않아 대량 이력에서 첫 페이지만 반환될 수 있다.
- template/workload id, history id 인수가 공백이면 입력 오류다.
- `--file` 로 지정한 JSON payload 파일은 1MB 를 넘거나 디렉터리면 입력 오류다.
- `workload create --wait`는 타임아웃까지 `Running` 상태에 도달하지 못하면 마지막 상태를 메시지에 포함해 API 오류로 반환한다.
