# NCR Reference

## 설정

공통 UAK와 NCR appkey가 필요하다.

```bash
nhncloud configure --uak-id <uak-id> --uak-secret <uak-secret> --ncr-appkey <appkey>
```

기본 region은 `kr1`이고, `kr1`, `kr2`, `kr3`를 지원한다.
공공망 profile(`"environment": "gov"`)의 NCR API는 `kr1`만 지원한다.

## Registry 조회

```bash
nhncloud commands --json | jq '.commands[] | select(.path|startswith("ncr"))'
nhncloud ncr list --json
nhncloud ncr list --region kr2 --json
nhncloud ncr get <registry> --json
```

`ncr list --json`은 `registries` wrapper를 언랩한 registry 배열이다.
`ncr get --json`은 `registry` wrapper를 언랩한 단일 registry 객체다.

## Image와 tag 조회

```bash
nhncloud ncr images <registry> --json
nhncloud ncr tags <registry> <repository> --json
```

`ncr images --json`은 repository 배열이다.
`ncr tags --json`은 tag 배열이다.

## 체이닝 예시

```bash
nhncloud ncr list --json | jq -r '.[].name'
nhncloud ncr get <registry> --json
nhncloud ncr images <registry> --json | jq -r '.[].repository'
nhncloud ncr images <registry> --json | jq '.[] | {repository, artifact_count}'
nhncloud ncr tags <registry> <repository> --json | jq -r '.[].tag'
nhncloud ncr tags <registry> <repository> --json | jq 'sort_by(.push_time) | last | .tag'
```

## 주의사항

- Harbor REST 경로는 NHN 공통 봉투가 아니므로 wrapper unwrap을 기대하지 않는다.
- registry나 repository 인수는 공백 또는 빈값이면 입력 오류다.
