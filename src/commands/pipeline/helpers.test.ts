import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT_CONFIG_ERROR, EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";

const mocks = vi.hoisted(() => ({
  getOptionalServiceCredential: vi.fn(),
}));

vi.mock("../../config/credentials.js", () => ({
  getOptionalServiceCredential: mocks.getOptionalServiceCredential,
  getProfileEnvironment: vi.fn(),
  getUserAccessKey: vi.fn(),
  resolveProfileName: vi.fn(),
}));

import { requireWriteMode, resolvePipelineAppKey } from "./helpers.js";

describe("resolvePipelineAppKey", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("pipeline 블록이 없으면 EXIT_CONFIG_ERROR 와 --pipeline-appkey 안내를 낸다", async () => {
    mocks.getOptionalServiceCredential.mockResolvedValue(undefined);

    await expect(resolvePipelineAppKey("default")).rejects.toMatchObject({
      exitCode: EXIT_CONFIG_ERROR,
      message: expect.stringContaining("--pipeline-appkey"),
    });
    expect(mocks.getOptionalServiceCredential).toHaveBeenCalledWith("pipeline", "default");
  });

  it("저장된 appkey 를 돌려준다", async () => {
    mocks.getOptionalServiceCredential.mockResolvedValue({ appkey: "stored-appkey" });

    await expect(resolvePipelineAppKey("default")).resolves.toBe("stored-appkey");
  });
});

describe("requireWriteMode", () => {
  it("--dry-run 이면 true", () => {
    expect(requireWriteMode({ dryRun: true }, "pipeline execute")).toBe(true);
  });

  it("--yes 이면 false", () => {
    expect(requireWriteMode({ yes: true }, "pipeline execute")).toBe(false);
  });

  it("둘 다 없으면 EXIT_PARAM_ERROR", () => {
    expect(() => requireWriteMode({}, "pipeline execute")).toThrow(
      expect.objectContaining({ exitCode: EXIT_PARAM_ERROR }),
    );
  });
});
