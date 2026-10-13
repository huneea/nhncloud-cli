# Troubleshooting Reference

실패 시 exit code, 인증 모델, profile/region, JSON shape를 먼저 확인한다.

## 빠른 진단 순서

1. 명령에 `--profile <name>`을 명시했는지 확인한다.
2. IaaS/NKS/NCR/RDS for MySQL 명령이면 `--region <region>`이 의도와 맞는지 확인한다.
3. 조회 명령을 `--json`으로 다시 실행해 stdout shape를 확인한다.
4. `nhncloud commands --json`으로 실제 command path와 option 이름을 확인한다.
5. exit code를 확인한다.
6. 서비스별 인증 모델을 대조한다.

`nhncloud doctor`는 기본으로 외부 API를 호출하지 않고 자격증명, 설정 파일, 공개 스킬 설치 상태를 진단한다.
`--check-connection`을 주면 대상 profile 의 자격증명으로 실제 연결까지 확인한다.
출력 필드와 상태 값은 [common.md](common.md#설정-진단)의 「설정 진단」 절을 본다.

## 인증 모델

| 서비스 | 비밀 |
|--------|------|
| Log & Crash 검색/export | appkey 와 공통 UAK id/secret |
| Log & Crash send | appkey |
| Deploy | UAK id 와 secret, Deploy appkey |
| Instance/network/volume/floatingip | tenantId, username, API password |
| NKS | tenantId, username, API password |
| NCR registry | UAK id, secret, NCR appkey |
| NCR images/tags | UAK id 와 secret |
| NCS | UAK id 와 secret, NCS appkey |
| API Gateway | UAK id 와 secret, API Gateway appkey |
| Secure Key Manager | UAK id 와 secret, SKM appkey, 키 저장소 IPv4·MAC 인증 |
| RDS for MySQL | UAK id 와 secret(정적 헤더), RDS for MySQL appkey |

## Exit code

| exit code | 의미 | 대표 원인 |
|-----------|------|-----------|
| 0 | 성공 | 요청이 끝났고 출력이 완결됐다 |
| 1 | API 오류 | 4xx/5xx, 봉투 실패, wait timeout |
| 2 | 인증 실패 | UAK/secret/password 오류, 권한 부족 |
| 3 | 입력 오류 | 필수 옵션 누락, region 미지원, 시간 범위 초과, `--yes` 누락 |
| 4 | config 오류 | profile 없음, 자격증명 블록 누락 |

## Profile 누락

profile 선택 순서는 [Profile 우선순위](common.md#profile-우선순위)를 확인한다.
자동화에서 의도와 다른 profile이 쓰이면 `--profile`을 명시한다.

## Region mismatch

IaaS/NKS/NCR/RDS for MySQL은 region별 endpoint를 사용한다.
리소스가 보이지 않으면 같은 profile에서 다른 region을 조회했을 수 있다.

```bash
nhncloud instance list --region kr1 --json
nhncloud instance list --region kr2 --json
nhncloud nks cluster list --region kr1 --json
nhncloud ncr list --region kr2 --json
nhncloud rds-mysql instance list --region kr2 --json
```

## JSON shape 혼동

서비스와 명령에 따라 API wrapper 처리 방식이 다르다.
`instance get --json`은 `.server.status`가 아니라 `.status`를 반환하지만, NKS 단건·설정 조회는 raw 객체를 보존한다.
NCR의 Harbor 이미지·태그 조회에는 NHN 공통 wrapper 언랩을 적용하지 않는다.
jq path를 쓰기 전에 `--json` 원문을 확인한다.

```bash
nhncloud instance get <instance-id> --json | jq keys
nhncloud ncr list --json | jq '.[0] | keys'
```

## Log & Crash 검색 제한

검색 기간·`--size`·`--page`·export 제한은 [logncrash.md](logncrash.md)를 따른다.

## 쓰기 명령 확인

명령별 확인 방식은 [되돌릴 수 없는 명령](common.md#되돌릴-수-없는-명령)에서 확인한다.
