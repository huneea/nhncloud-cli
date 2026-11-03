import { describe, expect, it } from "vitest";
import { failedDeployKeys, normalizeRunResult, renderTaskDetails, runResultRows } from "./run-result.js";

// 공식 문서의 배포 실행 응답 예와 같은 모양이다. taskResult 항목은 문서에 "..." 로만 있다.
const docEntry = {
  deployKey: 192349,
  deployStatus: "fail",
  deployResult: [{ deployKey: 192349, hostname: "host-a", status: "fail", taskResult: ["..."] }],
  deployResultLocation: "https://console.example.com/deploy",
};

describe("normalizeRunResult", () => {
  it("일반 서버 그룹의 객체 body 를 한 건 목록으로 바꾼다", () => {
    expect(normalizeRunResult(docEntry)).toEqual([docEntry]);
  });

  it("Autoscale 서버 그룹의 목록 body 를 그대로 받는다", () => {
    expect(normalizeRunResult([docEntry, docEntry])).toHaveLength(2);
  });

  it.each([[{ other: 1 }], [[]], ["text"], [{ deployKey: 1, deployResult: "bad" }]])(
    "모르는 모양 %j 은 undefined 다",
    (body) => {
      expect(normalizeRunResult(body)).toBeUndefined();
    },
  );
});

describe("runResultRows 와 failedDeployKeys", () => {
  it("서버마다 한 행이고 서버 결과가 없으면 배포 상태만 한 행이다", () => {
    expect(runResultRows([docEntry, { deployKey: 2, deployStatus: "deploying" }])).toEqual([
      ["192349", "fail", "host-a", "fail"],
      ["2", "deploying", "", ""],
    ]);
  });

  it("실패 계열 상태만 고른다", () => {
    expect(
      failedDeployKeys([docEntry, { deployKey: 2, deployStatus: "success" }, { deployKey: 3, deployStatus: "FAILURE" }]),
    ).toEqual(["192349", "3"]);
  });
});

describe("renderTaskDetails", () => {
  it("문자열 Task 는 그대로, 객체 Task 는 들여쓴 JSON 으로 보이고 제어 문자를 지운다", () => {
    const text = renderTaskDetails([
      {
        ...docEntry,
        deployResult: [{ hostname: "host-a", status: "fail", taskResult: ["line1\nline2\u001b[31m", { exitCode: 1 }] }],
      },
    ]);

    expect(text).toContain("[host-a] deployKey=192349 status=fail");
    expect(text).toContain("1. line1\nline2?[31m");
    expect(text).toContain('2. {\n  "exitCode": 1\n}');
    expect(text).toContain("콘솔 결과: https://console.example.com/deploy");
  });

  it("Task 결과와 링크가 없으면 빈 문자열이다", () => {
    expect(renderTaskDetails([{ deployKey: 1, deployStatus: "deploying" }])).toBe("");
  });
});
