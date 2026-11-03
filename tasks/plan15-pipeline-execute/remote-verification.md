# 원격 검증

실호출은 사용자가 제공하는 kr1 Pipeline appkey 와 실행해도 되는 테스트 파이프라인으로 한다.
실제 appkey·파이프라인 이름·실행 ID 는 PR 본문과 커밋에 남기지 않고 placeholder 로 적는다.

| 선행 조건 | 시점 | 실행 위치 | 명령 | 기대값 |
|---|---|---|---|---|
| push | PR 뒤 | 사용자 로컬, pipeline appkey 를 설정한 profile | `node dist/index.js pipeline execute <test-pipeline> --yes --profile <profile>` | 종료 코드 0, stdout 표에 `lastExecutionId`. 콘솔 실행 이력에 실행 1건 (R1, R3) |
| push | PR 뒤 | 같은 곳 | `node dist/index.js pipeline execute <test-pipeline> --yes --quiet --profile <profile>` 와 `--json` | `--quiet` 는 실행 ID 한 줄, `--json` 은 응답 `body` (R3) |
| push | PR 뒤 | 같은 곳 | `node dist/index.js pipeline execute <no-such-pipeline> --yes --profile <profile>; echo $?` | 0 이 아닌 종료 코드, stdout 비어 있음, stderr 메시지. 실제 HTTP 상태와 `resultCode` 를 PR 에 기록 (R6) |
| push | PR 뒤 | kr3 Pipeline 이 있는 profile | `node dist/index.js pipeline execute <test-pipeline> --yes --region kr3 --profile <profile>` | 사용자가 kr3 파이프라인을 준비하지 않으면 미검증으로 남긴다 (R4) |
