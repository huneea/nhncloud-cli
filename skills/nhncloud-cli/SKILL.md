---
name: nhncloud-cli
description: >-
  NHN Cloud 리소스를 nhncloud CLI로 조회·생성·변경·삭제하거나,
  configure·profile·출력 형식·종료 코드·명령 문법을 확인할 때 사용한다.
  Claude Code 공개 스킬의 상태를 확인하거나
  `skills status|install|update|uninstall`로 관리하고 상태별 복구 방법을 안내할 때도 사용한다.
  Log & Crash, Deploy, Compute, Network, Block Storage, Floating IP,
  Load Balancer, NCR, NKS, NCS, API Gateway 작업을 서비스별 참조와 명령 카탈로그로 안내한다.
---

# nhncloud-cli

## 실행 순서

1. 아래 표에서 대상 서비스의 reference 하나만 먼저 읽는다.
2. 정확한 경로·인수·옵션이 필요하면 `nhncloud commands --json`에서 해당 명령을 찾는다.
3. 조회 명령을 `--json`으로 실행해 대상 식별자와 현재 상태를 확인한다.
4. 쓰기 명령은 대상, `--profile`, 필요한 `--region`을 명시하고, 명령이 지원하면 `--yes`를 API 호출 전에 전달한다.
5. 결과는 stdout의 구조화 데이터로 판정하고 stderr는 진행 상황과 진단에 사용한다.
6. 실패하면 [troubleshooting.md](references/troubleshooting.md)에서 종료 코드와 인증 모델을 확인한다.

`--quiet`는 해당 명령이 핵심 값 한 줄 출력을 문서화한 경우에만 사용한다.
명령 문법이나 응답 형태를 추측하지 않는다.
비밀값과 실제 사용자 리소스 ID는 문서·이슈·보고서에 남기지 않고 placeholder로 바꾼다.

## 참조 라우터

| 작업 | 읽을 파일 |
|---|---|
| CLI 설치·설정·출력, 공개 스킬 관리 | [common.md](references/common.md) |
| Log & Crash Search v3 커서 검색·scroll 대량 추출·collector 전송<br>반복 조회 자동화의 호출 비용 설계 | [logncrash.md](references/logncrash.md) |
| Deploy 실행·조회·바이너리 전송 | [deploy.md](references/deploy.md) |
| Compute, VPC, Block Storage, Floating IP | [iaas.md](references/iaas.md) |
| Load Balancer와 IP ACL | [loadbalancer.md](references/loadbalancer.md) |
| Container Registry | [ncr.md](references/ncr.md) |
| Kubernetes Service | [nks.md](references/nks.md) |
| Container Service | [ncs.md](references/ncs.md) |
| API Gateway 조회·변경·배포·Swagger export | [apigateway.md](references/apigateway.md) |
| 인증·profile·region·출력·검색 제한 문제 해결 | [troubleshooting.md](references/troubleshooting.md) |
