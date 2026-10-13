# RDS for MySQL 명령 안내

`rds-mysql` 명령군은 RDS for MySQL의 DB 인스턴스, DB 스키마, DB 사용자를 다룬다.
DB 인스턴스는 조회만 하고, 스키마 생성과 사용자 생성·권한 변경·삭제는 비동기 작업으로 요청한다.

## 인증과 설정

공통 UAK와 RDS for MySQL `appKey`가 필요하다. 프로젝트 통합 appkey도 쓸 수 있다.
`nhncloud configure --rds-mysql-appkey <appkey>`로 profile의 `rds-mysql.appkey`를 설정한다.

- 요청마다 UAK를 정적 헤더로 보내므로 토큰 발급 단계가 없다.
- 일반망의 `--region`은 `kr1`(기본), `kr2`, `jp1`이다.
- 공공망은 profile의 `"environment": "gov"`로 고르고 `kr1`만 받는다. 다른 region은 API를 호출하기 전에 종료 코드 3이다.
- 프로젝트 권한 `RDS for MySQL VIEWER`는 조회 명령만 쓸 수 있다.

## 명령 탐색

정확한 명령 경로와 옵션은 `nhncloud commands --json`에서 확인한다.
ID 인자는 이름이 아니라 UUID만 받는다. 목록에서 ID를 찾아 다음 명령에 넘긴다.

```bash
nhncloud rds-mysql instance list
nhncloud rds-mysql schema list <db-instance-id>
nhncloud rds-mysql user list <db-instance-id>
nhncloud rds-mysql user update <db-instance-id> <db-user-id> --authority crud          # 미리보기
nhncloud rds-mysql user delete <db-instance-id> <db-user-id>                           # 미리보기
nhncloud rds-mysql job get <job-id>
```

목록 API에는 페이지가 없어 한 번의 응답을 그대로 출력한다. 빈 목록도 성공이다.

`--quiet`가 출력하는 값은 다음과 같다.

- `instance list`·`instance get`: `dbInstanceId`
- `schema list`: `dbSchemaName`
- `user list`: `dbUserId`
- `job get`: `jobStatus`
- `schema create`·`user create`·`user update`·`user delete`: 요청했을 때만 `jobId`. 미리보기와 변경 없음은 아무것도 출력하지 않는다.

## 쓰기 명령

`schema create`, `user create`, `user update`, `user delete`는 같은 규칙을 따른다.

```bash
nhncloud rds-mysql schema create <db-instance-id> --name <schema>                        # 미리보기
nhncloud rds-mysql schema create <db-instance-id> --name <schema> --yes --wait           # 반영하고 완료까지 대기
nhncloud rds-mysql user create <db-instance-id> --name <user> --host '10.0.0.%' --authority crud --password-file ./pw.txt
printf '%s' "$DB_PASSWORD" | nhncloud rds-mysql user create <db-instance-id> --name <user> --host '10.0.0.%' --authority crud --yes --wait --timeout 600
```

- `--yes`가 없으면 미리보기다. 보낼 내용을 출력하고 종료 코드 0으로 끝나며 쓰기 요청은 보내지 않는다.
- 미리보기도 사전 검사를 한다. 같은 이름의 스키마나 같은 `이름@host` 사용자가 이미 있거나, 바꾸거나 지울 `dbUserId`가 목록에 없거나, 인스턴스가 지원하지 않는 인증 플러그인을 지정하면 종료 코드 3이다.
- 권한이 이미 같으면 `--yes`를 줘도 요청하지 않고 변경 없음으로 끝난다.
- 쓰기 응답은 `jobId`뿐이다. `--wait`를 주면 작업 상태를 3초 간격으로 조회하고, 대기 상한은 기본 300초다. `--timeout <sec>`(1~3600)은 `--wait`와 함께만 쓴다.
- `--wait` 없이 요청한 작업은 `rds-mysql job get <job-id>`로 확인한다.
- 비밀번호는 `--password-file`이나 표준 입력으로만 받는다. `--password` 인수는 없다. 끝 줄바꿈(`\n` 또는 `\r\n`) 하나를 지우고 4자 이상 256자 이하인지 본다. 터미널에서 입력 없이 실행하면 묻지 않고 종료 코드 3이다. 비밀번호는 어떤 출력에도 나오지 않는다.
- 셸 이력에 남지 않도록 `echo` 대신 `printf '%s' "$DB_PASSWORD" |`나 파일을 쓴다.
- `--auth-plugin`(`native`, `caching-sha2`, `sha256`)과 `--tls`(`none`, `ssl`, `x509`)는 `user create`에서만 받는다. 인스턴스가 지원하지 않으면(MySQL 5.7.33 미만) 종료 코드 3이다.
- `user update`는 권한만 바꾼다. 현재 인증 플러그인과 TLS 옵션을 읽어 함께 보내므로 두 설정은 유지된다. 비밀번호 변경과 사용자 정의 권한은 콘솔에서 한다.
- 현재 권한이 `CUSTOM`인 사용자를 `user update`로 바꾸면 `CUSTOM`으로 되돌릴 수 없다. 실행 전에 stderr 경고를 확인한다.
- 권한은 `read`, `crud`, `ddl`, `all`만 받는다. `CUSTOM`은 받지 않는다.
- DB 인스턴스가 다른 작업을 진행 중이면(`progressStatus`가 `NONE`이 아니면) stderr에 경고하고 계속한다.

## 권한 범위

`read`, `crud`, `ddl`, `all`은 인스턴스의 모든 스키마(`*.*`)에 적용된다. 스키마 하나로 좁히는 API는 없다.
스키마 하나로 좁히려면 DB에 접속해 직접 부여한다.

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON `<schema>`.* TO '<user>'@'<host>';
```

이렇게 부여한 권한은 콘솔과 `user list`에 `CUSTOM`으로 보일 수 있다.
CLI가 DB에 접속해 권한을 관리하지는 않는다.

## 실패와 재실행

| 상황 | 종료 코드 | 할 일 |
|------|-----------|-------|
| 인수 형식 오류, 빈 비밀번호, 지원하지 않는 region, 사전 검사 실패(이미 있음, `dbUserId` 없음, 인증 플러그인 미지원) | 3 | 요청이 나가지 않았다. 입력을 고쳐 다시 실행한다. |
| 서버가 쓰기 요청을 실패로 알림 | 1 | 서버 메시지의 원인을 고쳐 다시 실행한다. |
| 쓰기 요청의 시간 초과, 연결 오류, 응답 형식 오류 | 1 | 접수 여부를 알 수 없다. 다시 실행하기 전에 `schema list`나 `user list`로 반영 여부를 확인한다. |
| `--wait` 중 작업이 `FAILED` 등 실패 상태로 끝남 | 1 | 작업이 실패했다. 원인을 확인해 고친 뒤 다시 실행한다. |
| `--wait`의 결과 불확정(`COMPLETED_WITH_ERROR`, `DELETED`), 대기 상한 초과, 상태 조회 실패 | 1 | 다시 실행하지 않는다. `job get <job-id>`와 목록으로 확인한다. 작업은 계속 진행 중일 수 있다. |

결과를 모르는 실패 뒤에 같은 생성 명령을 다시 실행하면 사전 검사가 이미 있는 대상을 종료 코드 3으로 막아 중복 생성을 피한다.
`--wait`가 실패해도 `jobId`가 담긴 결과는 먼저 출력한다.
작업 상태 값의 해석은 공식 문서가 불완전하다. 성공은 `COMPLETED` 하나뿐이고, 모르는 상태는 진행 중으로 보고 상한까지 기다린다.
