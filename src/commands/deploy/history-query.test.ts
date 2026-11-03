import { describe, expect, it, vi } from "vitest";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import {
  MAX_SCAN_PAGES,
  parseDateOption,
  parseResultOption,
  resolveHistoryRange,
  scanHistories,
} from "./history-query.js";

const today = new Date(Date.UTC(2026, 10, 3)); // 2026-11-03

describe("parseDateOption", () => {
  it.each(["2026-02-30", "2026-13-01", "2026-1-01", "20260101", ""])("%j 는 입력 오류다", (value) => {
    expect(() => parseDateOption(value, "--from")).toThrow(expect.objectContaining({ exitCode: EXIT_PARAM_ERROR }));
  });

  it("윤년 2월 29일은 받는다", () => {
    expect(parseDateOption("2024-02-29", "--from").toISOString()).toBe("2024-02-29T00:00:00.000Z");
  });
});

describe("resolveHistoryRange", () => {
  it("둘 다 없으면 쿼리를 보내지 않는다", () => {
    expect(resolveHistoryRange(undefined, undefined, today)).toEqual({});
  });

  it("--from 만 있으면 종료일은 오늘이다", () => {
    expect(resolveHistoryRange("2026-10-01", undefined, today)).toEqual({ from: "2026-10-01", to: "2026-11-03" });
  });

  it("--to 만 있으면 시작일은 종료일의 1개월 전이고 말일을 맞춘다", () => {
    expect(resolveHistoryRange(undefined, "2026-03-31", today)).toEqual({ from: "2026-02-28", to: "2026-03-31" });
  });

  it("시작일이 종료일보다 늦으면 거부한다", () => {
    expect(() => resolveHistoryRange("2026-11-03", "2026-11-01", today)).toThrow(/보다 늦습니다/);
  });

  // 경계는 실제 API 응답으로 맞췄다: 종료일의 1년 전과 같거나 이른 시작일은 API 가 거부한다.
  it.each([
    ["2025-11-04", "2026-11-03", true],
    ["2025-11-03", "2026-11-03", false],
    ["2024-02-29", "2025-02-28", true],
    ["2023-03-01", "2024-02-29", true],
    ["2024-11-03", "2026-11-03", false],
  ])("%s ~ %s 허용 여부는 %s 다", (from, to, allowed) => {
    const call = () => resolveHistoryRange(from, to, today);
    if (allowed) expect(call()).toEqual({ from, to });
    else expect(call).toThrow(expect.objectContaining({ exitCode: EXIT_PARAM_ERROR }));
  });
});

describe("parseResultOption", () => {
  it("대소문자를 무시하고 소문자로 맞춘다", () => {
    expect(parseResultOption("FAIL")).toBe("fail");
    expect(parseResultOption(undefined)).toBeUndefined();
  });
});

describe("scanHistories", () => {
  const row = (deployKey: number) => ({ deployKey, totalResult: "success" });

  it("빈 페이지를 받으면 멈춘다", async () => {
    const histories = vi
      .fn()
      .mockResolvedValueOnce({ totalCount: 0, deployHistories: [] });

    const result = await scanHistories({ histories }, "k", "1", {});

    expect(result).toEqual({ totalCount: 0, deployHistories: [], complete: true });
    expect(histories).toHaveBeenCalledTimes(1);
  });

  it("totalCount 만큼 모으면 멈춘다", async () => {
    const histories = vi
      .fn()
      .mockResolvedValueOnce({ totalCount: 3, deployHistories: [row(3), row(2)] })
      .mockResolvedValueOnce({ totalCount: 3, deployHistories: [row(1)] });

    const result = await scanHistories({ histories }, "k", "1", { pageSize: 2 });

    expect(result.deployHistories.map((h) => h.deployKey)).toEqual([3, 2, 1]);
    expect(histories).toHaveBeenCalledTimes(2);
  });

  it("상한 페이지에 닿으면 complete=false 로 끝낸다", async () => {
    const histories = vi.fn().mockResolvedValue({ totalCount: Number.MAX_SAFE_INTEGER, deployHistories: [row(1)] });

    const result = await scanHistories({ histories }, "k", "1", { pageSize: 1 });

    expect(result.complete).toBe(false);
    expect(histories).toHaveBeenCalledTimes(MAX_SCAN_PAGES);
  });
});
