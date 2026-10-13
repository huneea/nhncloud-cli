# Phase 01. 비밀값 입력 모듈을 SKM 밖으로 옮긴다

**Execution profile**: fast

## 목표

파일이나 표준 입력에서 비밀값을 읽는 모듈을 `src/commands/skm/input.ts` 에서 `src/commands/input-source.ts` 로 옮긴다.
RDS for MySQL 명령이 DB 사용자 비밀번호를 같은 규칙으로 읽게 하려는 준비다. 동작은 바꾸지 않는다.

**범위 외**: RDS for MySQL 코드(phase-02 부터). 입력 규칙 자체의 변경.

## 컨텍스트

- `src/commands/skm/input.ts` 는 `StdinSource`, `processStdin`, `SkmInputSpec`, `readSkmInput`, `decodeUtf8Input` 을 export 한다.
  다른 서비스 명령이 `../skm/input.js` 를 import 하면 서비스 명령끼리 서로 기대게 된다(`docs/pitfalls/code-review/shared-helper-in-command-file.md`).
- 현재 이 모듈을 import 하는 파일: `src/commands/skm/asymmetric-key.ts`, `key-manage.ts`, `keystore-manage.ts`, `secret.ts`, `symmetric-key.ts`, 그리고 테스트 `input.test.ts`, `key-write.test.ts`, `keystore-write.test.ts`, `secret-patch.test.ts`(모두 `src/commands/skm/` 아래). 세 테스트는 `processStdin` 만 import 한다.

**근거 문서**: `docs/code-architecture.md` 의 「명령 실행 경계」 절(입력 규칙의 소유 파일이 `src/commands/input-source.ts` 로 적혀 있다).

## 의도 메모

- 이름에서 `Skm` 을 뺀다. `readSkmInput` 은 `readInputSource`, `SkmInputSpec` 은 `InputSourceSpec` 이다. `StdinSource`, `processStdin`, `decodeUtf8Input` 은 이름을 유지한다.
- 오류 문구와 동작은 한 글자도 바꾸지 않는다. 기존 테스트가 그대로 통과해야 한다.

## 작업 항목

### 1. `git mv src/commands/skm/input.ts src/commands/input-source.ts`

- `readSkmInput` → `readInputSource`, `SkmInputSpec` → `InputSourceSpec` 으로 이름을 바꾼다. 함수 본문, JSDoc 의 의미, 오류 문구는 그대로 둔다.
- import 경로를 `../utils/errors.js`, `../utils/exit-codes.js` 로 고친다.

### 2. SKM 명령 다섯 파일의 import 를 고친다

`src/commands/skm/asymmetric-key.ts`, `key-manage.ts`, `keystore-manage.ts`, `secret.ts`, `symmetric-key.ts` 에서
`import { decodeUtf8Input, readSkmInput } from "./input.js";` 를 `import { decodeUtf8Input, readInputSource } from "../input-source.js";` 로 바꾸고 호출부 `readSkmInput(` 을 `readInputSource(` 로 바꾼다.

### 3. 이 phase 를 검증하는 테스트를 옮기고 import 를 고친다

- `git mv src/commands/skm/input.test.ts src/commands/input-source.test.ts` 후 import 를 `./input-source.js` 로, `../../utils/exit-codes.js` 처럼 두 단계 위를 가리키던 import 를 `../utils/...` 로 바꾸고, 이름을 새 이름으로 바꾼다. describe 이름도 `readInputSource` 로 바꾼다. 단언은 그대로 둔다.
- `src/commands/skm/key-write.test.ts`, `keystore-write.test.ts`, `secret-patch.test.ts` 의 `import { processStdin } from "./input.js";` 를 `"../input-source.js"` 로 바꾼다.

## 검증

```bash
node_modules/.bin/vitest run src/commands/input-source.test.ts src/commands/skm/key-write.test.ts src/commands/skm/keystore-write.test.ts src/commands/skm/secret-patch.test.ts src/commands/skm
node_modules/.bin/tsc --noEmit
! git grep -n "readSkmInput\|SkmInputSpec\|skm/input" -- src docs
```

기대값: 테스트 전부 통과, 타입 오류 0, 마지막 grep 은 일치 없음(종료 코드 0).

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/commands/input-source.ts` | 신규 |
| `src/commands/input-source.test.ts` | 신규 |
| `src/commands/skm/input.ts` | 삭제 |
| `src/commands/skm/input.test.ts` | 삭제 |
| `src/commands/skm/asymmetric-key.ts` | 수정 |
| `src/commands/skm/key-manage.ts` | 수정 |
| `src/commands/skm/keystore-manage.ts` | 수정 |
| `src/commands/skm/secret.ts` | 수정 |
| `src/commands/skm/symmetric-key.ts` | 수정 |
| `src/commands/skm/key-write.test.ts` | 수정 |
| `src/commands/skm/keystore-write.test.ts` | 수정 |
| `src/commands/skm/secret-patch.test.ts` | 수정 |
