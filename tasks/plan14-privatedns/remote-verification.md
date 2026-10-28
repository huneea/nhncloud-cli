# 원격 검증

공공망 IaaS 자격증명이 있는 profile 을 `<gov-profile>` 로 적는다. 실제 zone·VPC 이름과 UUID 는 PR 본문과 문서에 남기지 않는다.

| 선행 조건 | 시점 | 실행 위치 | 명령 | 기대값 |
|---|---|---|---|---|
| 없음 | PR 전 | 로컬, 공공망 kr1 읽기 전용 | `node dist/index.js privatedns zone list --profile <gov-profile> --json` 와 `privatedns zone get <zone>`, `privatedns record list <zone>`, `privatedns record get <zone> @ --type SOA` | 모두 종료 코드 0, 응답 가드 오류 없음 |
| 없음 | PR 전 | 로컬, 공공망 읽기 전용 | `node dist/index.js privatedns zone list --profile <gov-profile> --region kr2` | 토큰 발급 전에 종료 코드 3 |
| 없음 | PR 뒤 | 로컬, 공공망 kr1 쓰기. 실행 직전 사용자 확인 | 임시 zone `cli-verify-<YYYYMMDD>.internal.` 로 `zone create --network <vpc> --yes` → `zone get` 으로 `ACTIVE` 확인 → `record create --name www --type A --record 10.0.0.1 --yes`(`--description` 없이) → `record update <zone> www --ttl 600 --yes` → `record get` 으로 records·description 보존 확인 → `zone delete --yes`(거부 확인) → `record delete <zone> www --yes` → `zone delete --yes` | create 가 description 생략으로 성공하는지, PUT 이 병합 본문을 받는지, 레코드가 남은 zone 삭제가 `--force` 없이 거부되는지 확인. 결과를 ADR-049 「맥락」 실측 문장과 ADR-037 privatedns 행에 날짜와 함께 적는다. 기존 zone 은 건드리지 않는다 |
