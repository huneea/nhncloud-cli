---
id: gov-doc-field-parity-assumed
category: plan
title: 일반망과 공공망 문서의 경로·봉투가 같다는 이유로 응답 필드까지 같다고 단정
triggers: [공공망, gov, environment, 응답 가드, endpoint]
tool_catchable: false
source: [PR116]
related: [new-endpoint-envelope-assumed, optional-response-field-guard]
---

**증상**: 일반망과 공공기관용 API 가이드의 경로와 응답 봉투가 같다는 것을 확인하고, 응답 필드도 같다고 적는다.
한쪽 문서에만 있는 필드를 가드가 필수로 검사하면, 다른 망에서는 그 명령이 항상 응답 형식 오류로 끝난다.
테스트 fixture 를 한 문서의 예제로만 만들면 vitest 도 통과한다.

**Good**: 두 문서의 응답 예제를 명령마다 필드 단위로 대조하고, 한쪽에만 있는 필드는 선택 필드로 둔다.
출력이 그 필드를 쓰면 없을 때의 대체 값을 정하고, 차이를 ADR 과 공개 스킬 reference 에 적는다.

```ts
// standardEncodedKey 는 공공망 문서에만 있다
hasStrings(value, ["keyType", "key", "encodedKey"]) &&
  hasOptional(value, ["standardEncodedKey"], "string");
printSkmValue(opts, body.standardEncodedKey ?? body.encodedKey, body);
```

**검출**: 두 문서를 받아 응답 필드 이름의 등장 횟수를 비교한다.

```bash
curl -sL "<일반망 가이드 URL>" -o real.html
curl -sL "<공공망 가이드 URL>" -o gov.html
for f in real gov; do grep -o '"<필드명>"' $f.html | wc -l; done
```

**Self-check**: 가드가 필수로 검사하는 필드가 두 문서의 해당 응답 예제에 모두 있는가?
「두 망의 응답 형식이 같다」 는 문장의 근거가 경로·봉투 대조뿐이지 않은가?

**Why**: PR116 — SKM 비대칭키 조회 가드가 공공망 문서에만 있는 `standardEncodedKey` 를 필수로 검사해, 일반망에서 `public-key`·`private-key` 가 응답 형식 오류로 끝날 상태였다.

관련: [[new-endpoint-envelope-assumed]], [[optional-response-field-guard]]
