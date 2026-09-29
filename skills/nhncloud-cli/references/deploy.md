# Deploy Reference

## 설정

`~/.nhncloud/credentials.json`에 profile 공통 `userAccessKey`가 필요하다.
appkey는 `nhncloud configure --deploy-appkey <key>`로 profile에 설정한다.
`nhncloud configure` 사용을 권장한다.
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
비동기 모드는 `deploying` 상태를 즉시 반환하고, 완료 확인은 `deploy histories`로 한다.

## 조회 명령

```bash
nhncloud deploy artifacts --json
nhncloud deploy server-groups --artifact-id <id> --json
nhncloud deploy scenarios --artifact-id <id> --server-group-id <id> --json
nhncloud deploy histories --artifact-id <id> --json
nhncloud deploy binary-groups --artifact-id <id> --json
nhncloud deploy binaries --binary-group <key> --artifact-id <id> --json
```

`deploy binary-groups --json`은 `binaryGroups` wrapper를 언랩한 배열이다.
`deploy scenarios --json`은 시나리오 배열이며, `--quiet`은 시나리오 ID를 한 줄씩 출력한다.
`deploy binaries --json`은 `{ totalCount, binaries }` 객체다.

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
nhncloud deploy artifacts --json | jq -r '.[0].artifactId'
nhncloud deploy run --artifact-id <artifactId> --server-group-id <id> --scenario-ids <ids>
nhncloud deploy histories --artifact-id <id> --json | jq '.[0] | {deployKey, deployStatus}'
```
