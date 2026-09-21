# Deploy Reference

`deploy` 명령군은 NHN Cloud Deploy v2.1 API를 호출한다.
UAK를 OAuth `client_credentials`로 교환한 Bearer token으로 인증하고, token은 만료 전까지 캐시한다.

## 설정

`~/.nhncloud/credentials.json`에 profile 공통 `userAccessKey`가 필요하다.
appkey는 `nhncloud configure --deploy-appkey <key>`로 profile에 설정한다.
`nhncloud configure` 사용을 권장한다.
공공망에서는 profile에 `"environment": "gov"`를 명시하고 `--profile`로 선택한다.
공공망 Deploy API 주소는 `https://api-tcd.gov-nhncloudservice.com`이다.

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

| 옵션 | 설명 |
|------|------|
| `--artifact-id <id>` | 배포할 아티팩트 ID (`artifacts`로 확인) |
| `--server-group-id <id>` | 배포 대상 서버그룹 ID (`server-groups`로 확인) |
| `--scenario-ids <csv>` | 실행할 시나리오 ID 목록 (쉼표 구분) |
| `--target-hosts <csv>` | 대상 호스트. 생략 시 서버그룹 전체 |
| `--concurrent <n>` | 병렬 배포 수. 기본 1 |
| `--next-when-fail` | 시나리오 실패 시에도 진행 |
| `--note <s>` | 배포 메모 |
| `--async` | 즉시 반환. 기본은 완료 대기 |
| `--profile <name>` | 사용할 profile |

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

의도별 명령:

| 의도 | 명령 |
|------|------|
| 아티팩트 목록 | `deploy artifacts` |
| 서버그룹 목록 | `deploy server-groups --artifact-id <id>` |
| 시나리오 목록 | `deploy scenarios --artifact-id <id> --server-group-id <id>` |
| 배포 이력 | `deploy histories --artifact-id <id>` |
| 바이너리 그룹 목록 | `deploy binary-groups --artifact-id <id>` |
| 바이너리 목록 | `deploy binaries --binary-group <key> --artifact-id <id>` |

`deploy binary-groups --json`은 `binaryGroups` wrapper를 언랩한 배열이다.
`deploy scenarios --json`은 시나리오 배열이며, `--quiet`은 시나리오 ID를 한 줄씩 출력한다.
`deploy binaries --json`은 `{ totalCount, binaries }` 객체다.

## 바이너리 전송

```bash
nhncloud deploy upload --artifact-id <id> --file ./app.tgz --binary-group <key>
nhncloud deploy download --artifact-id <id> --binary-group <key> --binary-key <key> -o ./app.tgz
```

`upload`는 multipart로 로컬 파일을 업로드한다.
`--quiet`이면 `binaryKey`만 출력한다.

`download`는 바이너리를 파일로 저장한다.
대상 파일이 이미 있으면 기본 거부하고, `--force`가 있을 때만 덮어쓴다.

## 체이닝 예시

```bash
nhncloud deploy artifacts --json | jq -r '.[0].artifactId'
nhncloud deploy run --artifact-id <artifactId> --server-group-id <id> --scenario-ids <ids>
nhncloud deploy histories --artifact-id <id> --json | jq '.[0] | {deployKey, deployStatus}'
```

## 에러 코드

| 상황 | exit code |
|------|-----------|
| UAK 누락 또는 profile에 deploy appkey 없음 | 4 |
| 필수 옵션 누락(좌표, `--binary-group`·`--binary-key`·`--file`·`-o`) | 3 |
| OAuth 인증 실패 | 2 |
| Deploy API 오류 또는 봉투 실패 | 1 |

필수 옵션 누락은 검증 방식과 관계없이 종료 코드 3으로 끝난다.
Commander의 조기 검증과 명령 내부 검증은 오류 문구가 다를 수 있지만 자동화는 같은 입력 오류로 처리할 수 있다.
