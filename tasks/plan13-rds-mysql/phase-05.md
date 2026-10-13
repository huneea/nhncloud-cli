# Phase 05. README 와 공개 스킬에 RDS for MySQL 안내를 더한다

**Execution profile**: standard

## 목표

사용자와 에이전트가 `rds-mysql` 명령을 찾고 안전하게 쓰도록 README, 공개 스킬 라우터와 서비스 reference 를 갱신한다.

**범위 외**: 코드 변경. `docs/` 의 설계 문서(이미 갱신돼 있다).

## 컨텍스트

- 실제 명령 경로와 옵션은 `nhncloud commands --json` 과 `--help` 가 소유한다. 문서의 명령과 옵션은 phase-03, phase-04 가 만든 실제 help 를 보고 쓴다.
- 서비스 reference 의 형식 선례는 `skills/nhncloud-cli/references/skm.md`(인증과 설정, 명령 탐색, `--quiet` 출력 목록, 쓰기 명령)다.
- `skills/nhncloud-cli/SKILL.md` 는 라우터다. frontmatter `description` 의 서비스 나열과 「참조 라우터」 표에 한 줄씩 더한다.
- `skills/nhncloud-cli/references/common.md` 의 「초기 설정」 절은 `--skm-appkey` 예를 싣고, 「되돌릴 수 없는 명령」 절의 표는 `--yes` 가 필요한 명령을 나열한다(`skm secret patch` 는 `(--yes 없으면 미리보기)` 로 적혀 있다).
- `skills/nhncloud-cli/references/troubleshooting.md` 의 「인증 모델」 표와 「Region mismatch」 절은 서비스별 인증과 region 을 나열한다.
- README 의 「할 수 있는 일」 표와 「에이전트 없이 직접 쓰기」 예시 블록이 서비스를 나열한다.
- `scripts/verify-package.mjs` 는 패키지에 담기는 공개 스킬 파일을 검사한다. 새 reference 파일이 `skills/nhncloud-cli/references/` 아래에 있으면 함께 담긴다.

**근거 문서**: `docs/flow.md` 의 「RDS for MySQL」, 「RDS for MySQL 쓰기」 절, `docs/adr/046-rds-mysql-v3-static-auth.md`, `docs/adr/047-rds-mysql-write-preview-and-job-wait.md`.

## 의도 메모

- 공개 저장소다. 예시의 ID 는 `<db-instance-id>`, `<db-user-id>`, `<job-id>`, 비밀번호는 파일 경로나 `"$DB_PASSWORD"` 같은 변수로만 쓴다. 실제 값과 사내 이름을 넣지 않는다.
- 비밀번호를 `echo` 로 넘기는 예는 셸 이력에 남으므로 `--password-file` 이나 `printf '%s' "$DB_PASSWORD" |` 형태로 쓴다.
- 문서 문체는 기존 파일을 따른다. README 는 공손체(`~해요`), `skills/` 는 평서체다.

## 작업 항목

### 1. `skills/nhncloud-cli/references/rds-mysql.md` 신규

다음 절을 둔다.

- 「인증과 설정」: 공통 UAK 와 `rds-mysql.appkey`(프로젝트 통합 appkey 도 된다), `nhncloud configure --rds-mysql-appkey <appkey>`. 공공망은 profile `"environment": "gov"` 이고 `kr1` 만 된다. `--region` 은 일반망 `kr1`(기본), `kr2`, `jp1`. 프로젝트 권한 `RDS for MySQL VIEWER` 는 조회만 된다.
- 「명령 탐색」: `instance list` → `schema list`, `user list` → `user update`, `user delete` 로 ID 를 넘기는 순서 예시와 `--quiet` 출력 목록(`instance list|get`: `dbInstanceId`, `schema list`: `dbSchemaName`, `user list`: `dbUserId`, `job get`: `jobStatus`, 쓰기 명령: 요청했을 때만 `jobId`).
- 「쓰기 명령」: `--yes` 가 없으면 미리보기라는 것, 미리보기도 사전 검사(이미 있음, `dbUserId` 없음, 인증 플러그인 미지원)를 한다는 것, `--wait` 와 `--timeout`, 비밀번호는 `--password-file` 이나 표준 입력으로만 받고 끝 줄바꿈 하나를 지운다는 것, `user update` 는 권한만 바꾸고 현재 인증 플러그인과 TLS 옵션을 유지한다는 것, `CUSTOM` 에서 바꾸면 되돌릴 수 없다는 것.
- 「권한 범위」: `read`, `crud`, `ddl`, `all` 은 인스턴스의 모든 스키마(`*.*`)에 적용된다. 스키마 하나로 좁히는 API 는 없다. 필요하면 DB 에 접속해 아래처럼 직접 부여하고, 그 사용자는 콘솔과 `user list` 에 `CUSTOM` 으로 보일 수 있다고 적는다.

  ```sql
  GRANT SELECT, INSERT, UPDATE, DELETE ON `<schema>`.* TO '<user>'@'<host>';
  ```

- 「실패와 재실행」: 종료 코드 1 의 세 문구 갈래(서버가 알린 실패는 원인을 고쳐 재실행, 결과 불명과 대기 상한 초과는 재실행하지 말고 `job get` 과 목록으로 확인)와 종료 코드 3(사전 검사)을 표로 적는다. 결과 불명 뒤 같은 생성 명령을 다시 실행하면 사전 검사가 막는다는 것도 적는다.

### 2. `skills/nhncloud-cli/SKILL.md`

- frontmatter `description` 의 서비스 나열 끝 `Secure Key Manager` 다음에 `RDS for MySQL` 을 더한다.
- 「참조 라우터」 표의 SKM 행 아래에 `| RDS for MySQL DB 인스턴스·스키마·사용자 조회, 스키마·사용자 생성, 사용자 권한 변경·삭제 | [rds-mysql.md](references/rds-mysql.md) |` 를 더한다.

### 3. `skills/nhncloud-cli/references/common.md`

- 「초기 설정」 절의 비대화형 예시에 `--rds-mysql-appkey <appkey> \` 줄을 `--skm-appkey` 다음에 더한다.
- 「되돌릴 수 없는 명령」 표의 `--yes` 필수 칸 끝에 `rds-mysql schema create`, `rds-mysql user create`, `rds-mysql user update`, `rds-mysql user delete` (`--yes` 없으면 미리보기) 를 더한다.

### 4. `skills/nhncloud-cli/references/troubleshooting.md`

- 「인증 모델」 표에 `| RDS for MySQL | UAK id 와 secret(정적 헤더), RDS for MySQL appkey |` 행을 더한다.
- 「빠른 진단 순서」 2번의 `IaaS/NKS/NCR` 과 「Region mismatch」 절의 서비스 나열에 RDS for MySQL 을 더한다.

### 5. `README.md`

- 「할 수 있는 일」 표의 SKM 행 아래에 `| RDS for MySQL | \`nhncloud rds-mysql\` | [RDS for MySQL](skills/nhncloud-cli/references/rds-mysql.md) |`.
- 「에이전트 없이 직접 쓰기」 블록의 SKM 예시 아래에 다음 세 줄을 같은 주석 정렬로 더한다.

  ```bash
  nhncloud rds-mysql user list <db-instance-id>                  # RDS for MySQL DB 사용자 목록
  nhncloud rds-mysql user create <db-instance-id> --name app --host '10.0.0.%' --authority crud --password-file ./pw.txt   # 미리보기
  nhncloud rds-mysql user create <db-instance-id> --name app --host '10.0.0.%' --authority crud --password-file ./pw.txt --yes --wait   # 반영하고 완료까지 대기
  ```

### 6. 이 phase 를 검증하는 문서 대조

명령과 옵션 이름이 실제 카탈로그와 같은지 아래 검증 명령으로 확인한다. 저장소 테스트 전체(`pnpm test` 에 해당하는 vitest)를 돌려 공개 스킬 매니페스트와 패키지 검사 테스트가 새 파일을 받아들이는지 본다.

## 검증

```bash
node_modules/.bin/tsup && node scripts/verify-package.mjs
node_modules/.bin/vitest run
node dist/index.js commands --json > /tmp/nhncloud-commands.json && for c in "rds-mysql instance list" "rds-mysql schema create" "rds-mysql user create" "rds-mysql user update" "rds-mysql user delete" "rds-mysql job get"; do grep -q "\"$c\"" /tmp/nhncloud-commands.json || { echo "missing $c"; exit 1; }; done
grep -c "rds-mysql" README.md skills/nhncloud-cli/SKILL.md skills/nhncloud-cli/references/common.md skills/nhncloud-cli/references/troubleshooting.md skills/nhncloud-cli/references/rds-mysql.md
node scripts/check-pii.mjs
```

기대값: 패키지 검사 통과, 전체 테스트 통과, 누락 명령 없음, 각 파일에서 `rds-mysql` 이 한 번 이상, 공개 정보 검사 통과.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `skills/nhncloud-cli/references/rds-mysql.md` | 신규 |
| `skills/nhncloud-cli/SKILL.md` | 수정 |
| `skills/nhncloud-cli/references/common.md` | 수정 |
| `skills/nhncloud-cli/references/troubleshooting.md` | 수정 |
| `README.md` | 수정 |
