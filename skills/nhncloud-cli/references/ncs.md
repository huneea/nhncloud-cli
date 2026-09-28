# NCS Reference

`ncs` 명령군은 NHN Container Service 의 template(설계도)과 workload(런타임 실행)를 조회·관리한다.
template 의 생성·삭제, workload 의 생성·변경(update/patch)·실행제어(일시정지/재개/재시작/삭제), 악성코드 검사(malware) 설정·결과 조회를 지원한다.

## 설정

공통 UAK와 NCS appkey가 필요하다.
인증은 Deploy 와 같은 UAK OAuth Bearer 토큰을 재사용한다(profile 토큰 캐시 공유).

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

## 옵션

| 옵션 | 설명 |
|------|------|
| `--region <region>` | NCS region. 기본 `kr1`. `kr1`·`kr3`만 지원 |
| `--profile <name>` | 사용할 profile |
| `--page <page>` / `--size <size>` | 페이지네이션. `workload logs`의 기본 size는 100, 다른 노출 명령은 10 |
| `--q <query>` | workload list·events 필터 |
| `--task <taskId>` | `workload logs`·`workload events`·`workload restart` 필수 |
| `--container <name>` | `workload logs` 필수 |
| `--from <time>` / `--to <time>` | `workload logs`·`workload events` 시간 필터. 시간대 포함 RFC3339, `now`, 0 이상의 정수와 `m`·`h`·`d` 단위 |
| `--sort <sort>` | `workload history` 정렬 (역순은 필드명 앞에 `-`) |
| `--file <path>` | `template create`·`template version create`·`workload create`·`workload update`·`workload patch` 필수 — JSON payload 파일 경로 (`patch`는 JSON Patch 배열) |
| `--wait` / `--timeout <sec>` | `workload create` — Running 상태 폴링(`--timeout` 기본 300초) |
| `--enabled <value>` | `malware config set` 필수. `true` 또는 `false` |
| `--yes` | `template delete`·`template version delete`·`workload delete` — 비대화형 환경 필수, TTY 는 생략 시 확인 프롬프트 |

## 주의사항

- appkey는 NCS service appkey다. 인증 secret은 공통 UAK secret을 사용한다.
- `workload logs`·`workload events`는 task 단위 조회라 `--task` 없이는 입력 오류다.
- `workload logs`·`workload events` 데이터는 stdout, 진행 상황과 오류는 stderr에 출력한다.
- 시간 필터를 생략하면 CLI가 임의 기본값을 만들지 않고 API 기본 범위를 유지한다.
- `workload restart`도 task 단위라 `--task` 없이는 입력 오류다.
- `workload schedule-history`는 page/size를 아직 노출하지 않아 대량 이력에서 첫 페이지만 반환될 수 있다.
- template/workload id, history id 인수가 공백이면 입력 오류다.
- `template version create`의 `--file` payload 는 `sourceVersion` 필드가 필수다 — 누락 시 API 오류로 반환된다(클라이언트가 사전 검증하지 않음).
- `--file` 로 지정한 JSON payload 파일은 1MB 를 넘거나 디렉터리면 입력 오류다.
- 삭제 명령(`template delete`·`template version delete`·`workload delete`)은 비대화형 환경에서 `--yes` 없이 실행하면 입력 오류다.
- `workload create --wait`는 타임아웃까지 `Running` 상태에 도달하지 못하면 마지막 상태를 메시지에 포함해 API 오류로 반환한다.
- `workload patch`는 `Content-Type: application/json-patch+json`으로 전송된다 — `--file`에는 JSON Patch 배열(`op`/`path`/`value`)을 담아야 한다.
- `malware config set --enabled`는 `true`·`false` 외의 값이면 입력 오류다.

## 에러 코드

| 상황 | exit code |
|------|-----------|
| UAK 누락 또는 NCS appkey 미설정 | 4 |
| UAK 인증 실패 | 2 |
| 지원하지 않는 region, 빈 id 인수, `--task`·`--container` 누락 | 3 |
| 잘못된 logs·events 시간 필터 | 3 |
| `--file` 파일 오류, 잘못된 `--enabled`, 비대화형 삭제 시 `--yes` 누락 | 3 |
| NCS API 오류 (payload 필수값 누락, `workload create --wait` 타임아웃 등 서버측 검증·폴링 실패 포함) | 1 |
