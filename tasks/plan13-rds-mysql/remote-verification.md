# 원격 검증

실제 RDS for MySQL 을 부르는 검증이다. 에이전트는 실행하지 않고 사용자가 테스트용 DB 인스턴스로 확인한다.
결과가 문서 해석과 다르면 PR 리뷰 반영으로 상태 목록, 요청 본문과 문서를 고친다.

| 선행 조건 | 시점 | 실행 위치 | 명령 | 기대값 |
|---|---|---|---|---|
| push | PR 뒤 | 사용자 터미널, 일반망 profile, 읽기 전용 | `nhncloud rds-mysql instance list --json` 과 `user list <db-instance-id> --json` | 종료 코드 0, 응답 필드가 가드를 통과한다 |
| push | PR 뒤 | 사용자 터미널, 공공망 profile, 읽기 전용 | `nhncloud rds-mysql instance list --profile <gov-profile>` | `kr1-rds-mysql.api.gov-nhncloudservice.com` 으로 종료 코드 0 |
| push | PR 뒤 | 사용자 터미널, 잘못된 UAK profile | `nhncloud rds-mysql instance list` | 종료 코드 2, 실제 HTTP 상태와 `resultCode` 80401 을 기록 |
| push | PR 뒤 | 사용자 터미널, 테스트용 인스턴스 | `printf '%s' "$DB_PASSWORD" \| nhncloud rds-mysql user create <db-instance-id> --name <user> --host '10.0.0.%' --authority read --yes --wait` | 종료 코드 0, 거쳐 간 `jobStatus` 값과 최종 값이 `COMPLETED` 인지 기록 |
| push | PR 뒤 | 사용자 터미널, 테스트용 인스턴스 | `nhncloud rds-mysql user update <db-instance-id> <db-user-id> --authority crud --yes --wait` 후 그 사용자로 기존 비밀번호 접속 | 권한만 바뀌고 비밀번호, 인증 플러그인, TLS 옵션이 유지된다 |
| push | PR 뒤 | 사용자 터미널, 테스트용 인스턴스 | `nhncloud rds-mysql schema create <db-instance-id> --name <schema> --yes --wait` 와 `user delete <db-instance-id> <db-user-id> --yes --wait` | 종료 코드 0, 삭제 작업의 최종 `jobStatus` 가 `COMPLETED` 인지 `DELETED` 인지 기록 |
