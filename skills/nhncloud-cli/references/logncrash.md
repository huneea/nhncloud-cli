# Log & Crash Reference

`logncrash` 명령군은 Log & Crash Search v3 조회 토큰 확인, 커서 검색, scroll export, collector 전송을 다룬다.

조회 토큰 확인, 검색과 export에는 profile의 logncrash appkey와 공통 UAK가 필요하다.
CLI가 UAK를 OAuth 토큰으로 교환해 Bearer 인증을 적용한다.
`send`는 별도 collector 계약이므로 Search v3 전환의 영향을 받지 않는다.

## 검색

Discovery:

```bash
nhncloud commands --json | jq '.commands[] | select(.path|startswith("logncrash"))'
```

```bash
nhncloud logncrash search \
  --query 'logType:"ERROR"' \
  --from 1h \
  --to now \
  --json
```

CLI는 REAL API 실측 계약에 따라 모든 커서 요청을 `logTime DESC`로 고정 정렬한다.
사용자 정렬 옵션은 제공하지 않는다.

Lucene 예시:

| 의도 | 쿼리 |
|------|------|
| 전체 검색 | `*` |
| body 단어 검색 | `body:request_received` |
| body 부분 문자열 검색 | `body:*request_received*` |
| logType 검색 | `logType:"ERROR"` |

시간 입력:

- `1h`, `30m`, `2d`, `now`
- `2024-01-01T00:00:00+09:00` 이나 `2024-01-01T00:00:00Z` 같은 ISO8601 직접 입력
- 초와 시간대를 모두 지정해야 한다. 날짜만 주거나(`2024-01-01`) 초·시간대가 빠지면
  서버가 받지 않으므로 CLI 가 먼저 거부한다

API 제약:

- 검색 시작은 최근 90일 이내여야 한다.
- 검색 범위는 31일 이하여야 한다.
- 문서상 제약보다 짧은 기간에서도 서버가 500 응답을 낼 수 있다. 처리 가능한 기간의
  경계는 프로젝트의 로그 양에 따라 달라진다.

`search`는 기간을 자동으로 나누지 않는다. 서버가 500 응답을 반환하면 기간을 줄여
다시 시도하라는 안내와 서버 응답의 `requestId`를 보여 준다. 넓은 기간을 훑어야 하면
자동으로 기간을 나누는 `logncrash export`를 사용한다.

## 검색 출력

`--json` 출력은 `{ totalItems, pageNumber, pageSize, data, nextCursor? }` 객체다.
마지막 페이지에는 `nextCursor`가 없을 수 있다.

```bash
nhncloud logncrash search \
  --query '*' \
  --from 1h --to now \
  --json | jq '.totalItems'

# 다음 cursor가 있을 때만 순차 조회
next_cursor="$(nhncloud logncrash search \
  --query '*' --from 1h --to now --json | jq -r '.nextCursor // empty')"
if [ -n "$next_cursor" ]; then
  nhncloud logncrash search \
    --query '*' --from 1h --to now \
    --cursor "$next_cursor" --json
fi
```

cursor는 파싱하거나 인코딩을 바꾸지 않고 받은 문자열 그대로 전달한다.
임의 페이지 이동은 지원하지 않으므로 `--page 1` 이상은 입력 오류다.

전송 직후에는 인덱싱 지연으로 잠시 0건이 나올 수 있다.

## 조회 횟수 제한

짧은 시간에 여러 번 조회하면 조회 횟수 제한에 걸린다.
이 응답은 HTTP 200에 봉투 오류로 오며 500과는 다른 원인이다.
CLI는 둘을 구분해 안내한다.

검색 전에는 남은 조회 토큰을 직접 확인할 수 있다.

```bash
nhncloud logncrash available-token
nhncloud logncrash available-token --json
nhncloud logncrash available-token --quiet
```

기본 출력은 남은 조회 토큰과 양수가 될 때까지의 추정 대기 시간을 표로 보여 준다.
`--json`은 `{ availableToken, estimatedWaitSeconds }`를 출력하고, `--quiet`은 `availableToken` 숫자만 출력한다.
잔량이 양수이면 `estimatedWaitSeconds`는 `null`이다.

`search`와 `export`는 실제 검색 요청마다 먼저 잔량을 확인한다.
잔량이 0 이하면 검색 요청을 보내지 않고 종료 코드 1로 끝낸다.
추정 대기 시간은 관측한 회복 속도 1.6 token/s로 잔량이 양수가 될 때까지를 계산한 값이다.
서버가 보장한 값이 아니며, 같은 프로젝트의 다른 호출이 잔량을 쓰면 달라질 수 있다.

잔량이 양수여도 다음 검색의 비용까지 충분하다는 뜻은 아니다.
호출 비용을 사전에 계산할 공식 규칙이 없고, 성공한 한 번의 호출이 잔량을 음수로 만들 수 있다.
잔량 조회가 실패하면 CLI는 검색을 강행하지 않고 그 오류로 끝난다.

**검색 기간만 줄이는 것을 보장된 해법으로 보지 않는다.**
공식 가이드는 기간, 크기와 쿼리 복잡도가 함께 비용에 영향을 준다고 설명하지만 산정식은 공개하지 않는다.
기간을 나누면 한 호출의 비용이 줄 수 있지만 호출 수가 늘어난다.
`available-token`의 추정 시간을 확인한 뒤 사용자가 다시 실행해야 한다.

CLI는 자동으로 다시 시도하지 않는다.
추정값은 서버 계약이 아니므로 CLI가 그 시간만큼 자동으로 기다리지는 않는다.

### 반복 조회를 설계할 때

주기적으로 로그를 수집하는 자동화라면 아래를 전제로 짠다.

**호출 비용을 이전 실측값으로 예측하지 않는다.**
같은 프로젝트에서도 범위를 줄인 쿼리의 비용이 호출당 약 85에서 약 21,870까지 다르게 관측됐다.
쿼리와 기간은 필요한 데이터 범위에 맞추되, 다음 호출 전에 `available-token`을 다시 확인한다.

**전수 수집은 `search` 반복이 아니라 `export` 한 번이다.**
`search`를 페이지마다 부르면 호출 수가 페이지 수만큼 늘어난다.
`export`는 같은 양을 훨씬 적은 호출로 받고, 기간 재분할과 페이지 순회를 CLI가 처리한다.

**재시도할 때 오류를 구분한다.**
조회 횟수 제한은 토큰 회복 뒤 다시 시도할 수 있고, 서버 500은 export의 기간 분할 대상이다.
입력 오류와 설정 오류는 기다려도 풀리지 않는다.

| 종료 코드 | 의미 | 기다리면 풀리나 |
|---|---|---|
| 1 | API 오류, 봉투 실패 (조회 횟수 제한 포함) | 오류에 따라 다르다 |
| 2 | 인증 실패 | 아니다 |
| 3 | 입력 오류 | 아니다 |
| 4 | 설정 오류 | 아니다 |

**고정 간격 대신 매번 잔량을 확인한다.**
호출 비용은 쿼리마다 다르고 한 번에 큰 음수로 내려갈 수 있다.
짧은 고정 간격은 아직 회복하지 않은 상태에서 같은 실패만 반복할 수 있다.

## 대량 export

`logncrash export`는 검색 결과 전체를 scroll로 순회해 파일로 저장한다.
데이터는 stdout이 아니라 파일에 쓰고, 진행 상황은 stderr에 출력한다.

```bash
nhncloud logncrash export \
  --query '<lucene>' \
  --from 1h \
  --to now \
  --output logs.jsonl
```

기본 파일 형식은 JSON Lines이며, `--format json`을 지정하면 JSON 배열로 저장한다.

scroll 시작이나 계속 요청에서 서버가 500 응답을 반환하면 CLI가 해당 기간을 절반으로
줄여 자동으로 다시 시도한다. 성공한 기간 크기는 남은 구간에도 재사용하므로 사용자가
직접 기간을 나눠 호출할 필요가 없다.

더 나눌 수 없는 기간에서도 500 응답이 계속되거나 다른 오류가 발생하면 CLI가 원본
오류를 보존한다.
`--size`는 v3 scroll의 페이지 크기를 제어하지 않는다.

조회 횟수 제한을 만나면 기간을 나누지 않고 즉시 멈춘다.
나눌수록 호출이 늘어 제한을 더 소모하기 때문이다.

### 중단된 추출 이어받기

조회가 끝나기 전에 추출이 실패하면 `--output`은 만들어지지 않는다.
대신 그때까지 받은 결과가 `<output>.partial`에 남고, 위치와 이어받는 방법을 stderr로 알린다.

```text
안내: 여기까지 받은 3000건을 logs.jsonl.partial 에 남겼습니다.
안내: 이어받으려면 --from "<시각>" --to "<시각>" 로 다시 실행하세요. 경계 구간의 로그가 중복될 수 있습니다.
```

안내에 나온 `--from` 값과 원래 `--to`를 그대로 넘겨 다시 실행한다.
그 값은 아직 받지 못한 구간의 시작이며, 이미 받은 부분과 경계에서 겹칠 수 있다.

`--format json`이면 부분 파일도 배열을 닫아 그대로 파싱된다.
한 건도 받지 못하고 실패하면 부분 파일을 만들지 않는다.

부분 결과를 남기지 못하면 CLI가 그 사실을 경고로 알리고 원래 오류를 그대로 낸다.

### 조회 완료 뒤 복구 파일

모든 데이터를 받은 뒤 로컬 파일 처리에 실패했다면 API를 다시 호출하지 않는다.
stderr에 나온 복구 경로로 전체 결과를 확인한다.

| 복구 파일 | 상태 | 처리 방법 |
|---|---|---|
| `<output>.<id>.complete` | 모든 데이터를 받고 파일 형식까지 완성했지만 최종 경로 교체에 실패 | API를 다시 호출하지 않고 원하는 최종 경로로 옮겨 그대로 사용 |
| `<output>.<id>.unfinalized` | 모든 데이터를 받았지만 JSON 배열 마무리에 실패 | API를 다시 호출하지 않고 마지막 `]`를 확인한 뒤, JSON 파싱이 성공하면 원하는 최종 경로로 이동 |

`<id>`는 실행별 고유값이다.
`.complete`와 `.unfinalized`는 앞선 복구 파일을 덮어쓰지 않고, 이후 실행이 성공해도 CLI가 자동으로 삭제하지 않는다.

복구 경로로 옮기는 작업까지 실패하면 stderr가 임시 파일 경로를 알린다.
먼저 그 임시 파일을 별도 경로에 보존한 뒤 형식을 확인한다.

## 로그 전송

`logncrash send`는 collector host로 로그 한 건을 전송한다.
검색의 UAK OAuth Bearer 인증을 재사용하지 않는다.
인증 헤더 없이 body의 `projectName`에 appkey를 넣는다.

```bash
nhncloud logncrash send --body "batch finished" --level INFO
echo "batch finished" | nhncloud logncrash send --level INFO
nhncloud logncrash send --file ./error.log --level ERROR
```

입력 우선순위는 `--body` > `--file` > stdin이다.
본문이 없거나 비어 있으면 입력 오류다.
단일 로그 본문은 8MB 한도이며 초과 시 전송 전 차단된다.

`--json`이면 `{ ok: true, bytes }`를 stdout에 출력한다.
