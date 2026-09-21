import { beforeEach, describe, expect, it, vi } from "vitest";
import { getIaasToken } from "../api/keystone.js";
import { getIaasCredential, getProfileEnvironment, resolveProfileName } from "../config/credentials.js";
import type { IaasCredential } from "../config/types.js";
import { resolveIaasTokenContext } from "./iaas.js";

vi.mock("../api/keystone.js", () => ({
  getIaasToken: vi.fn(),
}));

vi.mock("../config/credentials.js", () => ({
  getIaasCredential: vi.fn(),
  getProfileEnvironment: vi.fn(),
  resolveProfileName: vi.fn(),
}));

const resolveProfileNameMock = vi.mocked(resolveProfileName);
const getIaasCredentialMock = vi.mocked(getIaasCredential);
const getProfileEnvironmentMock = vi.mocked(getProfileEnvironment);
const getIaasTokenMock = vi.mocked(getIaasToken);

const iaasCredential: IaasCredential = {
  tenantId: "tenant-a",
  username: "user-a",
  password: "password-a",
  region: "kr1",
};

const tokenContext = {
  tokenId: "token-a",
  computeEndpoint: "https://compute.example.com/v2/tenant-a",
  imageEndpoint: "https://image.example.com/v2",
  networkEndpoint: "https://network.example.com/v2.0",
  blockStorageEndpoint: "https://block-storage.example.com/v2/tenant-a",
  nksEndpoint: "https://nks.example.com/v1",
};

describe("resolveIaasTokenContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveProfileNameMock.mockResolvedValue("default");
    getIaasCredentialMock.mockResolvedValue(iaasCredential);
    getProfileEnvironmentMock.mockResolvedValue("real");
    getIaasTokenMock.mockResolvedValue(tokenContext);
  });

  it("profile이 없으면 resolveProfileName(undefined) 결과를 사용한다", async () => {
    await resolveIaasTokenContext({});

    expect(resolveProfileNameMock).toHaveBeenCalledWith(undefined);
    expect(getIaasCredentialMock).toHaveBeenCalledWith("default");
    expect(getIaasTokenMock).toHaveBeenCalledWith("default", iaasCredential, false, "real");
  });

  it("profile이 있으면 해당 값을 resolveProfileName(profile)에 전달한다", async () => {
    resolveProfileNameMock.mockResolvedValue("profile-a");

    await resolveIaasTokenContext({ profile: "profile-a" });

    expect(resolveProfileNameMock).toHaveBeenCalledWith("profile-a");
    expect(getIaasCredentialMock).toHaveBeenCalledWith("profile-a");
    expect(getIaasTokenMock).toHaveBeenCalledWith("profile-a", iaasCredential, false, "real");
  });

  it("region이 있으면 getIaasToken에 전달되는 credential의 region을 override한다", async () => {
    await resolveIaasTokenContext({ region: "kr2" });

    expect(getIaasTokenMock).toHaveBeenCalledWith("default", {
      ...iaasCredential,
      region: "kr2",
    }, false, "real");
  });

  it("region이 없으면 자격증명 region을 그대로 사용한다", async () => {
    await resolveIaasTokenContext({});

    expect(getIaasTokenMock).toHaveBeenCalledWith("default", iaasCredential, false, "real");
  });

  it("profileName, tokenId, 모든 endpoint를 반환한다", async () => {
    const result = await resolveIaasTokenContext({});

    expect(result).toEqual({
      profileName: "default",
      ...tokenContext,
    });
  });
});
