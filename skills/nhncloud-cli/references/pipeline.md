# Pipeline 명령 안내

`pipeline` 명령군은 NHN Cloud Pipeline 을 수동으로 실행한다(Pipeline API v1.1).
실행 상태·이력 조회와 완료 대기는 공개 API 가 없어 지원하지 않는다.

## 인증과 설정

profile 공통 UAK 와 Pipeline `appkey` 가 필요하다. 콘솔 Pipeline 의 **URL & Appkey** 에서 appkey 를 확인한다.
`nhncloud configure --pipeline-appkey <appkey>`로 profile 의 `pipeline.appkey` 를 설정한다. 연결 테스트는 하지 않고 저장만 한다.

- UAK 를 OAuth 토큰으로 교환해 `X-NHN-Authorization` 으로 보내고, appkey 는 `X-NHN-APPKEY` 로 보낸다.
- `--app-key` 옵션은 없다. appkey 가 없으면 API 를 호출하기 전에 종료 코드 4로 끝나고 `--pipeline-appkey` 를 안내한다.
- 공공망은 profile 의 `"environment": "gov"`로 고르고 `kr1` 만 쓴다.

## 실행

`pipeline execute`는 `--yes`나 `--dry-run` 중 하나가 있어야 한다. 둘 다 없으면 토큰을 발급하기 전에 종료 코드 3으로 끝난다.
실행은 실제 배포를 일으킬 수 있으니 `--dry-run`으로 보낼 요청을 먼저 확인한다.

```bash
nhncloud pipeline execute <pipeline-name> --dry-run
nhncloud pipeline execute <pipeline-name> --yes
nhncloud pipeline execute <pipeline-name> --yes --region kr3
```

- `--region`은 `kr1`(기본)과 `kr3`다. 공공망은 `kr1` 만 허용하고 그 밖의 값은 토큰 발급 전에 종료 코드 3이다.
- `kr3`(`X-NHN-REGION: KR3`)는 실호출로 확인하지 않았다.
- `--dry-run`은 API 를 호출하지 않고 method·URL·region·pipeline 이름을 출력한다. appkey 와 토큰은 나오지 않는다.
- 정확한 명령 경로와 옵션은 `nhncloud commands --json`에서 확인한다.

## 출력

| 형식 | stdout |
|---|---|
| 기본 | pipeline 이름·region·`lastExecutionId` 표 |
| `--json` | 응답 `body` 그대로 |
| `--quiet` | `<execution-id>` 한 줄 |

진행과 오류는 stderr 로 나간다.

## 종료 코드와 재실행

| 구분 | 상황 | 종료 코드 |
|---|---|---|
| 입력 오류 | `--yes`/`--dry-run` 없음, 지원하지 않는 region, 빈 이름 | 3 |
| 설정 오류 | Pipeline appkey 없음, UAK 없음 | 4 |
| 인증 오류 | HTTP 401·403 | 2 |
| API 오류 | 그 밖의 실패, 접수 여부를 모르는 실패 | 1 |

HTTP 4xx·5xx 와 `header.isSuccessful=false` 는 서버가 답한 확정 실패다.
요청을 보낸 뒤 timeout·연결 끊김이 나거나, 성공 응답인데 `lastExecutionId` 가 없으면 실행이 접수됐을 수 있다.
이때는 오류 메시지의 안내대로 **콘솔 실행 이력을 확인하기 전에 다시 실행하지 않는다.** 재실행은 중복 배포다.
CLI 는 실행을 자동으로 재시도하지 않는다.
