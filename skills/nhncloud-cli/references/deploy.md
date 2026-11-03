# Deploy Reference

## 설정

`~/.nhncloud/credentials.json`에 profile 공통 `userAccessKey`가 필요하다.
appkey는 `nhncloud configure --deploy-appkey <key>`로 profile에 설정한다.
공공망에서는 profile에 `"environment": "gov"`를 명시하고 `--profile`로 선택한다.

배포 좌표(아티팩트·서버그룹·시나리오 등)는 config에 두지 않는다.
매 호출마다 명령 옵션으로 넘긴다.
반복되는 값은 호출하는 쪽의 스크립트나 CI 변수가 관리한다.

**여러 배포 대상을 쓰려면 profile 을 나눈다.**
profile 하나에 appkey 하나다.

```bash
nhncloud configure --profile projA --deploy-appkey <keyA>
nhncloud deploy run --profile projA --artifact-id <id> --server-group-id <id> --scenario-ids <ids>
```

구버전에서 쓰던 config.json 의 이름 붙은 배포 대상 설정이 남아 있으면 경고가 나오며 읽지 않는다.

Discovery:

```bash
nhncloud commands --json | jq '.commands[] | select(.path|startswith("deploy"))'
```

## 배포 실행

```bash
nhncloud deploy run --artifact-id <id> --server-group-id <id> --scenario-ids <id1,id2>
nhncloud deploy run --artifact-id <id> --server-group-id <id> --scenario-ids <id1,id2> --async
nhncloud deploy run --artifact-id <id> --server-group-id <id> --scenario-ids <id1,id2> --target-hosts <host1,host2>
```

전체 옵션은 `nhncloud deploy run --help`에서 확인한다.

동기 모드는 서버가 배포 완료까지 응답을 보류한다.
표 출력은 서버마다 `deployKey`, `deployStatus`, `hostname`, `status` 한 행을 보이고, 그 뒤에 서버별 Task 결과(`taskResult`)를 적는다.
`--json`은 응답 원본, `--quiet`은 `deployKey`만 출력한다.
`deployStatus`가 `fail`이면 결과를 모두 출력한 뒤 종료 코드 1로 끝난다(ADR-050).

비동기 모드는 `deploying` 상태를 즉시 반환하고 종료 코드 0이다.
완료 여부는 `deploy histories --deploy-key <key>`로 확인한다.

**배포 한 건의 서버별 결과와 Task 로그를 나중에 조회하는 공개 API는 없다.**
서버별 로그가 필요하면 동기 모드로 실행해 그 출력을 남긴다.
이미 끝난 배포의 로그는 콘솔의 「결과 보기」에서 본다.

## 조회 명령

```bash
nhncloud deploy artifacts --json
nhncloud deploy server-groups --artifact-id <id> --json
nhncloud deploy scenarios --artifact-id <id> --server-group-id <id> --json
nhncloud deploy histories --artifact-id <id> --json
nhncloud deploy binary-groups --artifact-id <id> --json
nhncloud deploy binaries --binary-group <key> --artifact-id <id> --json
```

`deploy artifacts --name <name>`은 아티팩트 이름으로 검색하고, `deploy binaries --keyword <text>`는 바이너리 버전으로 검색한다.
`deploy artifacts`와 `deploy server-groups`의 `--json`은 응답 원본(`{ artifacts }`, `{ serverGroups }`)이고, `--quiet`은 `id`를 한 줄씩 출력한다.
`deploy binary-groups --json`은 `binaryGroups` wrapper를 언랩한 배열이다.
`deploy scenarios --json`은 시나리오 배열이며, `--quiet`은 시나리오 ID를 한 줄씩 출력한다.
`deploy binaries --json`은 `{ totalCount, binaries }` 객체다.

## 배포 이력

```bash
nhncloud deploy histories --artifact-id <id>
nhncloud deploy histories --artifact-id <id> --server-group-id <id> --from 2026-01-01 --to 2026-01-31
nhncloud deploy histories --artifact-id <id> --server-group-id <id> --all --result fail
nhncloud deploy histories --artifact-id <id> --deploy-key <key> --json
```

기간을 주지 않으면 최근 1개월이다.
하나만 주면 빠진 종료일은 오늘, 빠진 시작일은 종료일의 1개월 전이다.
기간은 1년보다 짧아야 하고, 시작일이 종료일의 1년 전과 같거나 이르면 요청 전에 종료 코드 3으로 거부한다.
`--page-size`는 1 이상 100 이하이고 기본은 20이다.

`--all`은 기간 안의 모든 페이지를 모은다.
`--deploy-key`는 기간 안의 페이지를 차례로 찾아 그 한 건만 보이고, 없으면 종료 코드 3이다. `--result`와 함께 쓸 수 없다.
`--result success|fail|running`은 API에 결과 필터가 없어 받은 행을 CLI가 필터링한다. 페이지 하나만 받았으면 그 안에서만 찾는다.

`--json`은 `{ totalCount, deployHistories }` 객체다.
`totalCount`는 API가 준 기간 전체 건수이고, `deployHistories`는 필터링한 행이다.
`--quiet`은 `deployKey`를 한 줄씩 출력한다.
`totalResult`는 소문자(`success`, `fail`, `running`)로 온다.

배포 이력에는 서버별 결과와 Task 로그가 없다. 공개 API의 이력 항목은 결과(`totalResult`) 하나뿐이다.

## 바이너리 전송

```bash
nhncloud deploy upload --artifact-id <id> --file ./app.tgz --binary-group <key>
nhncloud deploy download --artifact-id <id> --binary-group <key> --binary-key <key> -o ./app.tgz
```

`upload`는 로컬 파일을 업로드한다.
`--quiet`이면 `binaryKey`만 출력한다.

`download`는 바이너리를 파일로 저장한다.
대상 파일이 이미 있으면 기본 거부하고, `--force`가 있을 때만 덮어쓴다.

## 체이닝 예시

```bash
nhncloud deploy artifacts --json | jq -r '.artifacts[0].id'
nhncloud deploy run --artifact-id <artifactId> --server-group-id <id> --scenario-ids <ids>
nhncloud deploy histories --artifact-id <id> --json | jq '.deployHistories[0] | {deployKey, totalResult}'
```
