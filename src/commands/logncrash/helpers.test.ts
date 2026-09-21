import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT_CONFIG_ERROR } from "../../utils/exit-codes.js";
import { NhnCloudCliError } from "../../utils/errors.js";

const mocks = vi.hoisted(() => ({
  resolveProfileName: vi.fn(),
  getServiceCredential: vi.fn(),
  getUserAccessKey: vi.fn(),
  requireRealEnvironment: vi.fn(),
  getAccessToken: vi.fn(),
  clientConstructor: vi.fn(function () {
    return { kind: "logncrash-client" };
  }),
}));

vi.mock("../../config/credentials.js", () => ({
  resolveProfileName: mocks.resolveProfileName,
  getServiceCredential: mocks.getServiceCredential,
  getUserAccessKey: mocks.getUserAccessKey,
  requireRealEnvironment: mocks.requireRealEnvironment,
}));
vi.mock("../../api/oauth.js", () => ({ getAccessToken: mocks.getAccessToken }));
vi.mock("../../services/logncrash/client.js", () => ({
  LogncrashClient: mocks.clientConstructor,
}));

import { resolveLogncrashClient } from "./helpers.js";

describe("resolveLogncrashClient", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveProfileName.mockResolvedValue("resolved-profile");
    mocks.getServiceCredential.mockResolvedValue({ appkey: "appkey" });
    mocks.getUserAccessKey.mockResolvedValue({ id: "uak-id", secret: "uak-secret" });
    mocks.getAccessToken.mockResolvedValue("access-token");
  });

  it("profile → appkey → UAK → OAuth token → client 순서로 해석한다", async () => {
    const client = await resolveLogncrashClient("cli-profile");

    expect(mocks.resolveProfileName).toHaveBeenCalledWith("cli-profile");
    expect(mocks.getServiceCredential).toHaveBeenCalledWith("logncrash", "resolved-profile");
    expect(mocks.getUserAccessKey).toHaveBeenCalledWith("resolved-profile");
    expect(mocks.getAccessToken).toHaveBeenCalledWith(
      "resolved-profile",
      "uak-id",
      "uak-secret",
    );
    expect(mocks.clientConstructor).toHaveBeenCalledWith("appkey", "access-token");
    expect(client).toEqual({ kind: "logncrash-client" });

    const order = [
      mocks.resolveProfileName.mock.invocationCallOrder[0],
      mocks.getServiceCredential.mock.invocationCallOrder[0],
      mocks.getUserAccessKey.mock.invocationCallOrder[0],
      mocks.getAccessToken.mock.invocationCallOrder[0],
      mocks.clientConstructor.mock.invocationCallOrder[0],
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it.each([undefined, ""])("appkey가 %j이면 OAuth와 client 생성 전에 EXIT_CONFIG_ERROR", async (appkey) => {
    mocks.getServiceCredential.mockResolvedValue({ appkey });

    await expect(resolveLogncrashClient()).rejects.toMatchObject({
      exitCode: EXIT_CONFIG_ERROR,
    });
    expect(mocks.getUserAccessKey).not.toHaveBeenCalled();
    expect(mocks.getAccessToken).not.toHaveBeenCalled();
    expect(mocks.clientConstructor).not.toHaveBeenCalled();
  });

  it("UAK 누락 오류를 OAuth와 client 생성 전에 그대로 전달한다", async () => {
    const error = new NhnCloudCliError("UAK가 없습니다.", EXIT_CONFIG_ERROR);
    mocks.getUserAccessKey.mockRejectedValue(error);

    await expect(resolveLogncrashClient()).rejects.toBe(error);
    expect(mocks.getAccessToken).not.toHaveBeenCalled();
    expect(mocks.clientConstructor).not.toHaveBeenCalled();
  });

  it("canonical 자격증명 loader 오류를 빈 설정으로 삼키지 않는다", async () => {
    const error = new NhnCloudCliError("자격증명 파일 파싱 오류", EXIT_CONFIG_ERROR);
    mocks.getServiceCredential.mockRejectedValue(error);

    await expect(resolveLogncrashClient()).rejects.toBe(error);
    expect(mocks.getUserAccessKey).not.toHaveBeenCalled();
    expect(mocks.getAccessToken).not.toHaveBeenCalled();
  });
});
