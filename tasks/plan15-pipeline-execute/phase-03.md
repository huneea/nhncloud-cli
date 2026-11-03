# Phase 03. 사용자 가이드와 전역 문서

**Execution profile**: fast

## 목표

`pipeline execute` 와 `configure --pipeline-appkey` 를 사용자 가이드, 공개 스킬, 서비스 목록 문서에 실제 명령 카탈로그와 같은 이름으로 적는다.

**범위 외**: 코드 변경. phase 01·02 가 끝냈다.

## 컨텍스트

이 phase 가 맡는 요구사항: `docs/features/pipeline-execute/spec.md` 의 R7.

- 명령 이름·인수·옵션은 `node dist/index.js commands --json` 출력이 단일 소스다. 문서를 쓰기 전에 빌드하고 `pipeline execute` 항목을 확인한다.
- 같은 서비스 문서 형식은 DNS Plus 를 따른다: `README.md` 의 서비스 표와 예시 줄, `skills/nhncloud-cli/SKILL.md` 의 라우팅 표, `skills/nhncloud-cli/references/dnsplus.md`.
- 공개 스킬에서 서비스나 configure flag 를 나열하는 곳: `skills/nhncloud-cli/SKILL.md:9` description 의 서비스 나열, `skills/nhncloud-cli/references/common.md:100-108` 의 비대화형 configure 예시, 같은 파일의 「되돌릴 수 없는 명령」 절.
- README 의 `--yes` 단락(165행 부근)은 `--yes`·`--dry-run` 을 요구하는 명령을 나열한다. README 에는 configure flag 목록이 없다.
- 전역 문서에서 서비스를 나열하는 줄: `docs/prd.md`(서비스 bullet, 80행 부근과 공공망 지원 목록 88행 부근), `docs/flow.md`(서비스 표 150행 부근과 서비스별 절 342행 부근), `docs/code-architecture.md`(35행 서비스 목록과 68행 부근 인증 표), `docs/data-schema.md`(서비스 블록 예시와 121–129행 서비스 설명, 134행 공공망 endpoint 선택 대상 목록, 173행 appkey 누락 안내, 「캐시 범위」 절 178행의 공통 OAuth 토큰 캐시 서비스 목록).
- 공공망 조사 표는 `docs/adr/037-gov-profile-endpoints.md` 의 표다. 실호출 칸은 「미확인」 으로 적는다.
- 문서는 한국어, 명령·경로·필드는 원문. 실제 appkey·파이프라인 이름·실행 ID 대신 `<appkey>`·`<pipeline-name>`·`<execution-id>` 를 쓴다.

**근거 문서**: `docs/features/pipeline-execute/spec.md`, `docs/adr/037-gov-profile-endpoints.md`, `docs/adr/029-appkey-profile-only.md`

## 의도 메모

- references/pipeline.md 에는 상태 조회 API 가 없어 실행 결과는 콘솔 실행 이력에서 확인해야 한다는 점, `--yes` 없이 쓰면 멈추는 점, kr3 는 실호출 미검증이라는 점을 적는다.
- timeout·연결 끊김이나 `lastExecutionId` 없는 응답은 실행이 접수됐을 수 있다. 이때 재실행하지 말고 콘솔 실행 이력을 먼저 확인하라는 안내를 references/pipeline.md 와 common.md 「되돌릴 수 없는 명령」 절에 적는다(스펙 R6).
- 새 ADR 은 만들지 않는다(스펙 「설계」 절).

## 작업 항목

### 1. `skills/nhncloud-cli/references/pipeline.md` 신규

설정(`nhncloud configure --pipeline-appkey <appkey>`, UAK 필요), `pipeline execute <pipeline-name> --yes [--region kr1|kr3]`, `--dry-run`, 출력 세 형식(`--quiet` 는 `<execution-id>` 한 줄), 종료 코드(입력 오류·설정 오류·API 오류), 제약(상태 조회 없음, 공공망 kr1 만).

### 2. `skills/nhncloud-cli/SKILL.md`, `README.md` 수정

- SKILL 라우팅 표에 「Pipeline 수동 실행」 → `references/pipeline.md` 행.
- SKILL.md 9행 description 의 서비스 나열에 Pipeline.
- `skills/nhncloud-cli/references/common.md`: 비대화형 configure 예시에 `--pipeline-appkey <appkey> \\` 줄, 「되돌릴 수 없는 명령」 절에 `pipeline execute`(재실행 = 중복 배포, 결과 불확정 시 콘솔 확인).
- README 서비스 표에 Pipeline 행, 예시 블록에 `nhncloud pipeline execute <pipeline-name> --dry-run` 과 `--yes` 예시, 165행 부근 `--yes` 단락에 「`pipeline execute` 는 `--yes` 나 `--dry-run` 이 없으면 API 를 호출하기 전에 끝나요」.

### 3. 전역 docs 수정

- `docs/prd.md`: `nhncloud pipeline` bullet(수동 실행만, UAK OAuth 토큰과 `pipeline.appkey` 헤더, `--yes` 필수). 공공망 지원 서비스 목록에 Pipeline.
- `docs/flow.md`: 서비스 표에 Pipeline 행과 짧은 「Pipeline」 절(검증 순서: `--yes`/region/appkey → 토큰 → 실행, 재시도 없음).
- `docs/code-architecture.md`: 서비스 목록에 `pipeline`, 인증 표에 「profile 의 `pipeline.appkey` 를 `X-NHN-APPKEY` 헤더로, UAK OAuth 토큰을 `X-NHN-Authorization` 으로」.
- `docs/data-schema.md`: 서비스 블록 예시에 `"pipeline": { "appkey": "<appkey>" }`, 서비스 설명에 `pipeline` 줄(appkey 를 `X-NHN-APPKEY` 헤더로, UAK OAuth 토큰 재사용, region 은 명령 `--region`), 134행 공공망 목록에 Pipeline, appkey 누락 안내 문장의 서비스 목록에 Pipeline, 「캐시 범위」 의 공통 OAuth 토큰 캐시 서비스 목록에 pipeline.
- `docs/adr/037-gov-profile-endpoints.md`: apigateway 두 행과 같은 형식으로 두 행을 더한다.
  - `pipeline` 행: `kr1-pipeline.api.gov-nhncloudservice.com` ([Pipeline API v1.1](https://docs.gov-nhncloud.com/ko/Dev%20Tools/Pipeline/ko/api-guide-gov-v1-1/)) | OAuth 발급 주소만 공공망 | kr1 | 확인하지 않음 | 미확인(실행 API 뿐이라 부작용 없는 확인 호출이 없다) | 지원(kr1).
  - `pipeline kr3` 행: 문서에 없음 | | | | | 거부.
  - 4행 「결정」 의 공공망 endpoint 사용 서비스 나열 끝(`API Gateway` 뒤)에 `Pipeline` 을 더한다.
- `docs/adr/INDEX.md`: ADR-037 항목 괄호 안 서비스 나열 끝에 `Pipeline` 을 더한다.

### 4. 이 phase 를 검증하는 테스트

문서 phase 이므로 카탈로그·도움말 테스트와 공개 정보 검사로 확인한다.
`src/commands/commands.test.ts` 와 `src/commands/help.test.ts` 가 문서와 명령 트리의 대조를 다루지 않으면 수정하지 않는다.

## 검증

```bash
pnpm run build
node dist/index.js commands --json | node -e 'const c=JSON.parse(require("fs").readFileSync(0,"utf8"));const e=c.commands.find(x=>x.path.endsWith("pipeline execute"));const o=(e?e.options:[]).join(" ");if(!e||!e.arguments.join(" ").includes("pipeline-name")||!["--region","--yes","--dry-run","--profile"].every(f=>o.includes(f))||o.includes("--app-key"))process.exit(1)'
pnpm vitest run src/commands/commands.test.ts src/commands/help.test.ts
for f in README.md skills/nhncloud-cli/SKILL.md skills/nhncloud-cli/references/pipeline.md skills/nhncloud-cli/references/common.md docs/prd.md docs/flow.md docs/code-architecture.md docs/data-schema.md docs/adr/037-gov-profile-endpoints.md docs/adr/INDEX.md; do rg -qi "pipeline" "$f" || { echo "missing: $f"; exit 1; }; done
rg -q -- "--pipeline-appkey" skills/nhncloud-cli/references/common.md
rg -q "pipeline execute" skills/nhncloud-cli/references/pipeline.md
node scripts/check-pii.mjs
git diff --check
```

기대값: 카탈로그 확인 종료 코드 0(항목이 있고 인수·네 옵션이 있으며 `--app-key` 가 없다), 테스트 통과, 파일별 `rg -q` 루프와 두 `rg -q` 종료 코드 0, PII 검사와 `git diff --check` 종료 코드 0.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `skills/nhncloud-cli/references/pipeline.md` | 신규 |
| `skills/nhncloud-cli/SKILL.md` | 수정 |
| `skills/nhncloud-cli/references/common.md` | 수정 |
| `README.md` | 수정 |
| `docs/prd.md` | 수정 |
| `docs/flow.md` | 수정 |
| `docs/code-architecture.md` | 수정 |
| `docs/data-schema.md` | 수정 |
| `docs/adr/037-gov-profile-endpoints.md` | 수정 |
| `docs/adr/INDEX.md` | 수정 |
