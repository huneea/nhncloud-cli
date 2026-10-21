import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT_PARAM_ERROR } from "../utils/exit-codes.js";

const mocks = vi.hoisted(() => ({
  resolveProfileName: vi.fn(),
  getUserAccessKey: vi.fn(),
  getProfileEnvironment: vi.fn(),
  getAccessToken: vi.fn(),
  resolveServiceAppKey: vi.fn(),
  NcsClient: vi.fn(),
  ApiGatewayClient: vi.fn(),
}));

vi.mock("../config/credentials.js", () => ({
  resolveProfileName: mocks.resolveProfileName,
  getUserAccessKey: mocks.getUserAccessKey,
  getProfileEnvironment: mocks.getProfileEnvironment,
}));
vi.mock("../api/oauth.js", () => ({ getAccessToken: mocks.getAccessToken }));
vi.mock("./service-appkey.js", () => ({ resolveServiceAppKey: mocks.resolveServiceAppKey }));
vi.mock("../services/ncs/client.js", () => ({ NcsClient: mocks.NcsClient }));
vi.mock("../services/apigateway/client.js", () => ({ ApiGatewayClient: mocks.ApiGatewayClient }));

import { resolveNcsClient } from "./ncs/helpers.js";
import { resolveApiGatewayClient } from "./apigateway/helpers.js";

const resolvers = [
  ["NCS", resolveNcsClient, mocks.NcsClient],
  ["API Gateway", resolveApiGatewayClient, mocks.ApiGatewayClient],
] as const;

describe.each(resolvers)("%s 공공망 profile client 해석", (_name, resolve, Client) => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveProfileName.mockResolvedValue("public");
    mocks.getUserAccessKey.mockResolvedValue({ id: "uak-id", secret: "uak-secret" });
    mocks.getProfileEnvironment.mockResolvedValue("gov");
    mocks.getAccessToken.mockResolvedValue("token");
    mocks.resolveServiceAppKey.mockResolvedValue("appkey");
  });

  it("공공망 OAuth 토큰으로 공공망 client를 만든다", async () => {
    await resolve({});

    expect(mocks.getAccessToken).toHaveBeenCalledWith("public", "uak-id", "uak-secret", false, "gov");
    expect(Client).toHaveBeenCalledWith("token", "kr1", "appkey", "gov");
  });

  it.each(["kr2", "kr3"])("공공망 문서에 없는 region %s 는 토큰 발급 전에 거부한다", async (region) => {
    await expect(resolve({ region })).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(mocks.getUserAccessKey).not.toHaveBeenCalled();
    expect(mocks.getAccessToken).not.toHaveBeenCalled();
  });

  it("일반망 profile은 기존 region을 그대로 쓴다", async () => {
    mocks.getProfileEnvironment.mockResolvedValue("real");

    await resolve({ region: "kr3" });

    expect(mocks.getAccessToken).toHaveBeenCalledWith("public", "uak-id", "uak-secret", false, "real");
    expect(Client).toHaveBeenCalledWith("token", "kr3", "appkey", "real");
  });
});
