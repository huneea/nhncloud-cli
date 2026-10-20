import { describe, it, expect, vi, beforeEach } from "vitest";
import ky from "ky";
import { verifyIaas, verifyLogncrash, verifyNcr, verifyNcs, verifyUserAccessKey } from "./configure-verify.js";
import { NhnCloudCliError } from "../utils/errors.js";
import { EXIT_AUTH_ERROR, EXIT_API_ERROR, EXIT_PARAM_ERROR } from "../utils/exit-codes.js";

vi.mock("ky");

function mockKyJsonResponse(body: unknown) {
  return { json: async () => body } as never;
}

describe("verifyNcs", () => {
  beforeEach(() => vi.resetAllMocks());

  it("공공망 profile은 공공망 OAuth와 공공망 NCS 주소로만 검증한다", async () => {
    vi.mocked(ky.post).mockReturnValue(
      mockKyJsonResponse({ access_token: "gov-token", expires_in: 3600, token_type: "Bearer" }),
    );
    vi.mocked(ky.get).mockReturnValue({
      json: async () => ({ header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" }, templates: [] }),
      headers: { get: () => null },
    } as never);

    await expect(verifyNcs({ id: "uak-id", secret: "uak-secret" }, "test-appkey", "gov")).resolves.toBe(true);

    expect(ky.post).toHaveBeenCalledWith("https://oauth.api.gov-nhncloudservice.com/oauth2/token/create", expect.anything());
    expect(ky.get).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/kr1-ncs\.api\.gov-nhncloudservice\.com\//), expect.anything());
  });

  it("appkey 가 빈 문자열이면 OAuth/NCS 호출 없이 false", async () => {
    const ok = await verifyNcs({ id: "uak-id", secret: "uak-secret" }, "");
    expect(ok).toBe(false);
    expect(ky.post).not.toHaveBeenCalled();
    expect(ky.get).not.toHaveBeenCalled();
  });

  it("OAuth 토큰 교환 + listTemplates 성공 시 true", async () => {
    vi.mocked(ky.post).mockReturnValue(
      mockKyJsonResponse({
        access_token: "test-token",
        expires_in: 3600,
        token_type: "Bearer",
      }),
    );
    vi.mocked(ky.get).mockReturnValue({
      json: async () => ({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
        templates: [],
      }),
      headers: { get: () => null },
    } as never);

    const ok = await verifyNcs({ id: "uak-id", secret: "uak-secret" }, "test-appkey");
    expect(ok).toBe(true);

    // 캐시 우회(forceRefresh=true) 확인 — OAuth 를 직접 호출했는지
    expect(ky.post).toHaveBeenCalledWith(
      expect.stringContaining("oauth2/token/create"),
      expect.anything(),
    );
  });

  it("OAuth 401 인증 실패 시 false", async () => {
    // vi.mock("ky") 가 HTTPError 까지 자동 mock 해 instanceof 체크가 깨진다(ncr/client.test.ts 와 동일 사유).
    // toNhnCloudCliError 가 401 → EXIT_AUTH_ERROR 로 변환한 결과를 직접 주입.
    vi.mocked(ky.post).mockImplementation(() => {
      throw new NhnCloudCliError("API 호출 실패 (401)", EXIT_AUTH_ERROR);
    });

    const ok = await verifyNcs({ id: "uak-id", secret: "uak-secret" }, "test-appkey");
    expect(ok).toBe(false);
  });

  it("non-auth 에러(5xx)는 삼키지 않고 throw", async () => {
    // 401/403 이 아닌 그 외 에러는 검증 자체가 불가하므로 boolean 으로 뭉개지 않고 rethrow 해야 한다.
    vi.mocked(ky.post).mockImplementation(() => {
      throw new NhnCloudCliError("API 호출 실패 (500)", EXIT_API_ERROR);
    });

    await expect(
      verifyNcs({ id: "uak-id", secret: "uak-secret" }, "test-appkey"),
    ).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });
});

describe("verifyLogncrash", () => {
  beforeEach(() => vi.resetAllMocks());

  it("공공망 profile은 공공망 OAuth와 공공망 검색 주소로만 검증한다", async () => {
    vi.mocked(ky.post)
      .mockReturnValueOnce(mockKyJsonResponse({ access_token: "gov-token", expires_in: 3600, token_type: "Bearer" }))
      .mockReturnValueOnce(
        mockKyJsonResponse({
          header: { isSuccessful: true, resultCode: 0, resultMessage: "SUCCESS" },
          body: { totalItems: 0, pageNumber: 0, pageSize: 1, data: [] },
        }),
      );

    await expect(verifyLogncrash({ id: "uak-id", secret: "uak-secret" }, "appkey", "gov")).resolves.toBe(true);

    expect(ky.post).toHaveBeenNthCalledWith(1, "https://oauth.api.gov-nhncloudservice.com/oauth2/token/create", expect.anything());
    expect(ky.post).toHaveBeenNthCalledWith(2, "https://api-lncs-search.gov-nhncloudservice.com/v3/appkey/logs/cursor", expect.anything());
  });

  it("빈 appkey는 OAuth와 검색 없이 false", async () => {
    await expect(
      verifyLogncrash({ id: "uak-id", secret: "uak-secret" }, ""),
    ).resolves.toBe(false);
    expect(ky.post).not.toHaveBeenCalled();
  });

  it("cache를 우회해 OAuth token을 발급하고 v3 cursor 검색에 성공하면 true", async () => {
    vi.mocked(ky.post)
      .mockReturnValueOnce(
        mockKyJsonResponse({
          access_token: "test-token",
          expires_in: 3600,
          token_type: "Bearer",
        }),
      )
      .mockReturnValueOnce(
        mockKyJsonResponse({
          header: { isSuccessful: true, resultCode: 0, resultMessage: "SUCCESS" },
          body: { totalItems: 0, pageNumber: 0, pageSize: 1, data: [] },
        }),
      );

    await expect(
      verifyLogncrash({ id: "uak-id", secret: "uak-secret" }, "appkey"),
    ).resolves.toBe(true);
    expect(ky.post).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("oauth2/token/create"),
      expect.objectContaining({ body: "grant_type=client_credentials" }),
    );
    expect(ky.post).toHaveBeenNthCalledWith(
      2,
      "https://api-lncs-search.nhncloudservice.com/v3/appkey/logs/cursor",
      expect.objectContaining({
        headers: { "X-NHN-Authorization": "Bearer test-token" },
        json: expect.objectContaining({ query: "*", pageSize: 1 }),
      }),
    );
  });

  it("OAuth 401은 false", async () => {
    vi.mocked(ky.post).mockImplementation(() => {
      throw new NhnCloudCliError("API 호출 실패 (401)", EXIT_AUTH_ERROR);
    });

    await expect(
      verifyLogncrash({ id: "uak-id", secret: "uak-secret" }, "appkey"),
    ).resolves.toBe(false);
  });

  it("검색 403은 false", async () => {
    vi.mocked(ky.post)
      .mockReturnValueOnce(
        mockKyJsonResponse({ access_token: "test-token", expires_in: 3600, token_type: "Bearer" }),
      )
      .mockReturnValueOnce({
        json: async () => {
          throw new NhnCloudCliError("API 호출 실패 (403)", EXIT_AUTH_ERROR);
        },
      } as never);

    await expect(
      verifyLogncrash({ id: "uak-id", secret: "uak-secret" }, "appkey"),
    ).resolves.toBe(false);
  });

  it("검색 5xx는 원형 오류를 다시 던진다", async () => {
    const error = new NhnCloudCliError("API 호출 실패 (500)", EXIT_API_ERROR);
    vi.mocked(ky.post)
      .mockReturnValueOnce(
        mockKyJsonResponse({ access_token: "test-token", expires_in: 3600, token_type: "Bearer" }),
      )
      .mockReturnValueOnce({ json: async () => { throw error; } } as never);

    await expect(
      verifyLogncrash({ id: "uak-id", secret: "uak-secret" }, "appkey"),
    ).rejects.toBe(error);
  });
});

describe("공공망 profile 연결 테스트", () => {
  beforeEach(() => vi.resetAllMocks());

  it("verifyUserAccessKey는 공공망 OAuth 주소로 보낸다", async () => {
    vi.mocked(ky.post).mockReturnValue(
      mockKyJsonResponse({ access_token: "gov-token", expires_in: 3600, token_type: "Bearer" }),
    );

    await expect(verifyUserAccessKey({ id: "uak-id", secret: "uak-secret" }, "gov")).resolves.toBe(true);

    expect(ky.post).toHaveBeenCalledWith("https://oauth.api.gov-nhncloudservice.com/oauth2/token/create", expect.anything());
  });

  it("verifyNcr는 공공망 kr1 NCR 주소로 보낸다", async () => {
    vi.mocked(ky.get).mockReturnValue(mockKyJsonResponse({ header: { isSuccessful: true, resultCode: 0, resultMessage: "SUCCESS" }, registries: [] }));

    await verifyNcr({ id: "uak-id", secret: "uak-secret" }, "appkey", "gov");

    expect(ky.get).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/kr1-ncr\.api\.gov-nhncloudservice\.com\//), expect.anything());
  });

  it("verifyIaas는 공공망에 없는 region을 Keystone 요청 전에 거부한다", async () => {
    await expect(
      verifyIaas({ tenantId: "tenant", username: "user", password: "pass", region: "kr3" }, "gov"),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(ky.post).not.toHaveBeenCalled();
  });
});
