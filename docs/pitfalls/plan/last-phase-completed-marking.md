---
id: last-phase-completed-marking
category: plan
title: 마지막 phase에서 task 완료 상태를 일관되게 갱신하지 않음
triggers: [마지막 phase, index.json, completed]
tool_catchable: false
source: [PR62]
related: [task-index-phase-count-mismatch]
---

**증상**: 모든 phase 구현이 끝났는데 `index.json`의 task 상태와 `current_phase`가 완료 시점을 가리키지 않는다. 실행자는 명시된 범위 밖의 관리 상태를 임의로 고치지 않으므로 마지막 phase에 완료 전이가 없으면 모순이 남는다.

**Good**: 마지막 phase의 작업과 완료 조건에 task `status`와 `current_phase`를 같은 변경에서 갱신하고 검증하는 항목을 둔다. 새 task는 현재 `execution_profile` 스키마를 유지하며 provider별 `model`이나 `allowedTools`를 추가하지 않는다.

**검출**:

```bash
jq -e '
  .status == "completed" and
  .current_phase == .total_phases and
  (.total_phases == (.phases | length))
' tasks/<plan>/index.json
```

**Self-check**: 마지막 phase가 task 완료 전이를 명시하는가? `current_phase`와 `total_phases`가 일치하는가? 완료 상태 변경이 마지막 phase의 검증과 같은 커밋에 들어가는가?

**Why**: PR62에서 마지막 phase가 구현만 끝내고 task 완료 상태 갱신을 남겨 team-lead가 별도로 보완했다. 하드코딩한 `sed` 치환보다 JSON 구조를 기준으로 판정해야 phase 수나 필드 순서가 바뀌어도 안전하다.

관련: [[task-index-phase-count-mismatch]]
