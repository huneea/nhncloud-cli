import { beforeEach, describe, expect, it, vi } from "vitest";
import { output } from "../formatters/table.js";
import { EXIT_PARAM_ERROR } from "../utils/exit-codes.js";
import { outputDryRun, requireWriteMode } from "./write-mode.js";

vi.mock("../formatters/table.js", () => ({ output: vi.fn() }));

describe("requireWriteMode", () => {
  it("--dry-run 이면 true 를 돌려준다", () => {
    expect(requireWriteMode({ dryRun: true }, "zone 삭제")).toBe(true);
  });

  it("--yes 만 있으면 false 를 돌려준다", () => {
    expect(requireWriteMode({ yes: true }, "zone 삭제")).toBe(false);
  });

  it("둘 다 없으면 --dry-run 을 안내하는 입력 오류로 끝낸다", () => {
    let caught: unknown;
    try {
      requireWriteMode({}, "zone 삭제");
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect((caught as Error).message).toContain("zone 삭제에는 --yes 플래그가 필요합니다.");
    expect((caught as Error).message).toContain("--dry-run");
  });
});

describe("outputDryRun", () => {
  beforeEach(() => vi.mocked(output).mockReset());

  it("보낼 요청을 dry_run 표시와 빈 ids 로 출력한다", () => {
    const requests = [
      { method: "PUT" as const, path: "/privatedns/zones/zone-1", body: { zone: { description: "" } } },
      { method: "DELETE" as const, path: "/privatedns/zones/zone-1" },
    ];
    outputDryRun({ json: true }, "zone 수정", requests);

    expect(output).toHaveBeenCalledWith(
      { json: true },
      {
        headers: ["method", "path", "body"],
        rows: [
          ["PUT", "/privatedns/zones/zone-1", JSON.stringify({ zone: { description: "" } }, null, 2)],
          ["DELETE", "/privatedns/zones/zone-1", ""],
        ],
        raw: { operation: "zone 수정", dry_run: true, requests },
        ids: [],
      },
    );
  });
});
