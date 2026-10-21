import { beforeEach, describe, expect, it, vi } from "vitest";
import ky from "ky";
import { LogncrashClient } from "./client.js";
import { EXIT_API_ERROR, EXIT_CONFIG_ERROR } from "../../utils/exit-codes.js";

vi.mock("ky");

const successHeader = {
  isSuccessful: true,
  resultCode: 0,
  resultMessage: "SUCCESS",
};

function respondWith(body: unknown): void {
  vi.mocked(ky.post).mockReturnValue({
    json: async () => ({ header: successHeader, body }),
  } as never);
}

function respondToGet(body: unknown): void {
  vi.mocked(ky.get).mockReturnValue({
    json: async () => ({ header: successHeader, body }),
  } as never);
}

describe("LogncrashClient Search v3", () => {
  beforeEach(() => vi.resetAllMocks());

  it("공공망 profile은 공공망 검색 주소로 조회한다", async () => {
    respondToGet({ availableToken: 10 });

    await new LogncrashClient("appkey", "access-token", "gov").availableToken();

    expect(ky.get).toHaveBeenCalledWith(
      "https://api-lncs-search.gov-nhncloudservice.com/v3/appkey/logs/available-token",
      expect.objectContaining({ headers: { "X-NHN-Authorization": "Bearer access-token" } }),
    );
  });

  it("available-token을 v3 GET·Bearer로 조회하고 음수 정수를 보존한다", async () => {
    respondToGet({ availableToken: -2_302 });

    const client = new LogncrashClient("app/key", "access-token");
    await expect(client.availableToken()).resolves.toEqual({ availableToken: -2_302 });

    expect(ky.get).toHaveBeenCalledWith(
      "https://api-lncs-search.nhncloudservice.com/v3/app%2Fkey/logs/available-token",
      {
        headers: { "X-NHN-Authorization": "Bearer access-token" },
        retry: 0,
        timeout: 30_000,
      },
    );
  });

  it.each([
    ["누락", {}],
    ["문자열", { availableToken: "10" }],
    ["소수", { availableToken: 1.5 }],
    ["NaN", { availableToken: Number.NaN }],
    ["무한대", { availableToken: Number.POSITIVE_INFINITY }],
  ])("availableToken %s 응답은 EXIT_API_ERROR로 거부한다", async (_name, body) => {
    respondToGet(body);

    await expect(
      new LogncrashClient("appkey", "access-token").availableToken(),
    ).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
      message: expect.stringContaining("availableToken 정수 필드"),
    });
  });

  it("available-token 봉투 실패는 EXIT_API_ERROR로 보존한다", async () => {
    vi.mocked(ky.get).mockReturnValue({
      json: async () => ({
        header: { isSuccessful: false, resultCode: 429, resultMessage: "rate limit" },
      }),
    } as never);

    await expect(
      new LogncrashClient("appkey", "access-token").availableToken(),
    ).rejects.toMatchObject({ exitCode: EXIT_API_ERROR, resultCode: 429 });
  });

  it("cursor 첫 요청에 v3 URL·Bearer·선택 pageSize와 고정 sort를 보낸다", async () => {
    respondWith({ totalItems: 2, pageNumber: 0, pageSize: 10, data: [] });

    const client = new LogncrashClient("app/key", "access-token");
    await client.cursorSearch({
      query: "logType:NORMAL",
      from: "2026-08-03T00:00:00Z",
      to: "2026-08-03T01:00:00Z",
      pageSize: 10,
    });

    expect(ky.post).toHaveBeenCalledWith(
      "https://api-lncs-search.nhncloudservice.com/v3/app%2Fkey/logs/cursor",
      {
        headers: { "X-NHN-Authorization": "Bearer access-token" },
        json: {
          query: "logType:NORMAL",
          from: "2026-08-03T00:00:00Z",
          to: "2026-08-03T01:00:00Z",
          sort: { logTime: "DESC" },
          pageSize: 10,
        },
        retry: 0,
        timeout: 30_000,
      },
    );
    const options = vi.mocked(ky.post).mock.calls[0]?.[1];
    expect(options?.json).toHaveProperty("sort", { logTime: "DESC" });
    expect(options?.json).not.toHaveProperty("cursor");
  });

  it("nextCursor를 변형하지 않고 다음 cursor 요청 body에 전달한다", async () => {
    const nextCursor = "opaque+/= cursor";
    respondWith({
      totalItems: 2,
      pageNumber: 0,
      pageSize: 10,
      data: [{ logTime: "2026-08-03T00:00:00Z" }],
      nextCursor,
    });

    const client = new LogncrashClient("appkey", "access-token");
    const result = await client.cursorSearch({
      query: "*",
      from: "2026-08-03T00:00:00Z",
      to: "2026-08-03T01:00:00Z",
      cursor: nextCursor,
    });

    expect(vi.mocked(ky.post).mock.calls[0]?.[1]?.json).toEqual({
      query: "*",
      from: "2026-08-03T00:00:00Z",
      to: "2026-08-03T01:00:00Z",
      sort: { logTime: "DESC" },
      cursor: nextCursor,
    });
    expect(result.nextCursor).toBe(nextCursor);
  });

  it("scroll 시작 body에서 pageSize를 제거하고 계속 요청에는 body를 보내지 않는다", async () => {
    respondWith({ scrollKey: "scroll/key", totalItems: 1, pageSize: 10, data: [] });
    const client = new LogncrashClient("app/key", "access-token");

    await client.scrollStart({
      query: "*",
      from: "2026-08-03T00:00:00Z",
      to: "2026-08-03T01:00:00Z",
    });
    expect(ky.post).toHaveBeenLastCalledWith(
      "https://api-lncs-search.nhncloudservice.com/v3/app%2Fkey/logs/scroll",
      {
        headers: { "X-NHN-Authorization": "Bearer access-token" },
        json: {
          query: "*",
          from: "2026-08-03T00:00:00Z",
          to: "2026-08-03T01:00:00Z",
        },
        retry: 0,
        timeout: 30_000,
      },
    );

    await client.scrollNext("scroll/key");
    expect(ky.post).toHaveBeenLastCalledWith(
      "https://api-lncs-search.nhncloudservice.com/v3/app%2Fkey/logs/scroll/scroll%2Fkey",
      {
        headers: { "X-NHN-Authorization": "Bearer access-token" },
        retry: 0,
        timeout: 30_000,
      },
    );
    expect(vi.mocked(ky.post).mock.calls[1]?.[1]).not.toHaveProperty("json");
  });

  it("숫자 성공 봉투를 unwrap하고 실패 봉투는 EXIT_API_ERROR로 거부한다", async () => {
    const client = new LogncrashClient("appkey", "access-token");
    respondWith({ totalItems: 0, pageNumber: 0, pageSize: 10, data: [] });
    await expect(
      client.cursorSearch({ query: "*", from: "2026-08-03T00:00:00Z", to: "2026-08-03T01:00:00Z" }),
    ).resolves.toMatchObject({ totalItems: 0 });

    vi.mocked(ky.post).mockReturnValue({
      json: async () => ({
        header: { isSuccessful: false, resultCode: 10001, resultMessage: "invalid query" },
      }),
    } as never);
    await expect(
      client.cursorSearch({ query: "*", from: "2026-08-03T00:00:00Z", to: "2026-08-03T01:00:00Z" }),
    ).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });

  it.each([
    ["availableToken", (client: LogncrashClient) => client.availableToken()],
    ["cursorSearch", (client: LogncrashClient) => client.cursorSearch({ query: "*", from: "a", to: "b" })],
    ["scrollStart", (client: LogncrashClient) => client.scrollStart({ query: "*", from: "a", to: "b" })],
    ["scrollNext", (client: LogncrashClient) => client.scrollNext("scroll-key")],
  ])("access token이 없으면 %s를 HTTP 전에 EXIT_CONFIG_ERROR로 거부한다", async (_name, call) => {
    await expect(call(new LogncrashClient("appkey"))).rejects.toMatchObject({
      exitCode: EXIT_CONFIG_ERROR,
    });
    expect(ky.post).not.toHaveBeenCalled();
    expect(ky.get).not.toHaveBeenCalled();
  });
});

describe("LogncrashClient collector 회귀", () => {
  beforeEach(() => vi.resetAllMocks());

  it("send는 collector v2 경로·appkey payload를 유지하고 Bearer 헤더를 보내지 않는다", async () => {
    vi.mocked(ky.post).mockReturnValue({
      json: async () => ({ header: successHeader }),
    } as never);

    const client = new LogncrashClient("appkey", "search-token");
    await client.send({ projectVersion: "1.0.0", body: "hello", logLevel: "INFO" });

    expect(ky.post).toHaveBeenCalledWith(
      "https://api-logncrash.nhncloudservice.com/v2/log",
      {
        headers: { "Content-Type": "application/json" },
        json: {
          projectName: "appkey",
          projectVersion: "1.0.0",
          logVersion: "v2",
          body: "hello",
          logLevel: "INFO",
        },
        retry: 0,
        timeout: 30_000,
      },
    );
    const headers = vi.mocked(ky.post).mock.calls[0]?.[1]?.headers;
    expect(headers).not.toHaveProperty("X-NHN-Authorization");
  });

  it("공공망 profile은 공공망 collector 주소로 보낸다", async () => {
    vi.mocked(ky.post).mockReturnValue({
      json: async () => ({ header: successHeader }),
    } as never);

    await new LogncrashClient("appkey", undefined, "gov").send({ projectVersion: "1.0.0", body: "hello" });

    expect(ky.post).toHaveBeenCalledWith("https://api-logncrash.gov-nhncloudservice.com/v2/log", expect.any(Object));
  });
});
