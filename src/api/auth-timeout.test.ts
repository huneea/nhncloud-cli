import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ky from "ky";
import { getIaasToken } from "./keystone.js";
import { getAccessToken } from "./oauth.js";
import { setRequestTimeoutMs } from "./timeout.js";

vi.mock("ky");

describe("인증 요청 타임아웃", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setRequestTimeoutMs(30_000);
  });

  afterEach(() => {
    setRequestTimeoutMs(30_000);
  });

  it("OAuth 토큰 요청에 기본 상한을 적용한다", async () => {
    vi.mocked(ky.post).mockReturnValue({
      json: async () => ({
        access_token: "test-token",
        expires_in: 3600,
        token_type: "Bearer",
      }),
    } as never);

    await getAccessToken("default", "<uak-id>", "<uak-secret>", true);

    expect(ky.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 30_000 }),
    );
  });

  it("Keystone 토큰 요청에 변경한 상한을 적용한다", async () => {
    setRequestTimeoutMs(120_000);
    vi.mocked(ky.post).mockReturnValue({
      json: async () => ({
        access: {
          token: {
            id: "test-token",
            expires: "2099-01-01T00:00:00Z",
          },
        },
      }),
    } as never);

    await getIaasToken("default", {
      tenantId: "<tenant-id>",
      username: "user@example.com",
      password: "<password>",
      region: "kr1",
    }, true);

    expect(ky.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ timeout: 120_000 }),
    );
  });

  it("gov OAuth 요청은 공공망 인증 주소를 사용한다", async () => {
    vi.mocked(ky.post).mockReturnValue({ json: async () => ({ access_token: "test-token", expires_in: 3600, token_type: "Bearer" }) } as never);
    await getAccessToken("public", "<uak-id>", "<uak-secret>", true, "gov");
    expect(ky.post).toHaveBeenCalledWith("https://oauth.api.gov-nhncloudservice.com/oauth2/token/create", expect.any(Object));
  });

  it("gov Keystone 요청은 공공망 인증 주소를 사용한다", async () => {
    vi.mocked(ky.post).mockReturnValue({ json: async () => ({ access: { token: { id: "test-token", expires: "2099-01-01T00:00:00Z" } } }) } as never);
    await getIaasToken("public", { tenantId: "<tenant-id>", username: "user@example.com", password: "<password>", region: "kr1" }, true, "gov");
    expect(ky.post).toHaveBeenCalledWith("https://api-identity-infrastructure.gov-nhncloudservice.com/v2.0/tokens", expect.any(Object));
  });
});
