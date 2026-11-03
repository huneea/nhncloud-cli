import { beforeEach, describe, expect, it, vi } from "vitest";
import ky, { HTTPError, TimeoutError } from "ky";
import { PIPELINE_UNKNOWN_OUTCOME_HINT, PipelineClient } from "./client.js";
import { EXIT_API_ERROR, EXIT_AUTH_ERROR } from "../../utils/exit-codes.js";

vi.mock("ky", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ky")>();
  return { ...actual, default: { ...actual.default, post: vi.fn() } };
});

const APPKEY = "test-appkey-0001";
const TOKEN = "test-token-0001";
const ok = { isSuccessful: true, resultCode: 0, resultMessage: "SUCCESS" };
const body = {
  appkey: APPKEY,
  region: "KR1",
  pipelineName: "demo",
  reason: null,
  lastExecutionId: "execution-0001",
};

function respond(payload: unknown) {
  return { json: async () => payload } as never;
}

function rejectWith(error: unknown) {
  return { json: async () => { throw error; } } as never;
}

describe("PipelineClient.execute", () => {
  const post = vi.mocked(ky.post);

  beforeEach(() => {
    post.mockReset();
  });

  it("v1.1 실행 API 를 한 번 호출하고 lastExecutionId 를 돌려준다", async () => {
    post.mockReturnValue(respond({ header: ok, body }));
    const client = new PipelineClient(TOKEN, APPKEY, "kr1");

    const result = await client.execute("my pipeline/a");

    expect(result.lastExecutionId).toBe("execution-0001");
    expect(post).toHaveBeenCalledTimes(1);
    const [url, options] = post.mock.calls[0]!;
    expect(url).toBe("https://kr1-pipeline.api.nhncloudservice.com/api/anchor/v1.1/pipelines/my%20pipeline%2Fa/execute");
    expect(options).toMatchObject({
      headers: {
        "Content-Type": "application/json",
        "X-NHN-REGION": "KR1",
        "X-NHN-APPKEY": APPKEY,
        "X-NHN-Authorization": `Bearer ${TOKEN}`,
      },
      retry: 0,
    });
    expect(options).not.toHaveProperty("json");
    expect(options).not.toHaveProperty("body");
  });

  it("kr3 는 kr3 host 와 대문자 KR3 헤더를 쓴다", async () => {
    post.mockReturnValue(respond({ header: ok, body }));

    await new PipelineClient(TOKEN, APPKEY, "kr3").execute("demo");

    const [url, options] = post.mock.calls[0]!;
    expect(url).toContain("https://kr3-pipeline.api.nhncloudservice.com/");
    expect((options as { headers: Record<string, string> }).headers["X-NHN-REGION"]).toBe("KR3");
  });

  it("공공망 kr1 host 를 쓰고 지원하지 않는 region 은 생성 시점에 거부한다", async () => {
    post.mockReturnValue(respond({ header: ok, body }));
    await new PipelineClient(TOKEN, APPKEY, "kr1", "gov").execute("demo");
    expect(post.mock.calls[0]![0]).toContain("https://kr1-pipeline.api.gov-nhncloudservice.com/");
    expect(() => new PipelineClient(TOKEN, APPKEY, "kr3", "gov")).toThrow();
    expect(() => new PipelineClient(TOKEN, APPKEY, "kr2")).toThrow();
  });

  it("봉투 실패는 재실행 금지 문구 없이 API 오류가 된다", async () => {
    post.mockReturnValue(
      respond({ header: { isSuccessful: false, resultCode: -1, resultMessage: "Not found pipeline" } }),
    );

    const error = await new PipelineClient(TOKEN, APPKEY, "kr1").execute("demo").catch((e) => e);

    expect(error).toMatchObject({ exitCode: EXIT_API_ERROR });
    expect(error.message).toContain("Not found pipeline");
    expect(error.message).not.toContain(PIPELINE_UNKNOWN_OUTCOME_HINT);
  });

  it("HTTP 404 는 확정된 실패라 재실행 금지 문구가 없다", async () => {
    const url = "https://kr1-pipeline.api.nhncloudservice.com/x";
    post.mockReturnValue(rejectWith(new HTTPError(new Response("{}", { status: 404 }), new Request(url), {} as never)));

    const error = await new PipelineClient(TOKEN, APPKEY, "kr1").execute("demo").catch((e) => e);

    expect(error).toMatchObject({ exitCode: EXIT_API_ERROR });
    expect(error.message).toContain("404");
    expect(error.message).not.toContain(PIPELINE_UNKNOWN_OUTCOME_HINT);
  });

  it("HTTP 401 은 인증 오류 코드를 유지한다", async () => {
    const url = "https://kr1-pipeline.api.nhncloudservice.com/x";
    post.mockReturnValue(rejectWith(new HTTPError(new Response("{}", { status: 401 }), new Request(url), {} as never)));

    await expect(new PipelineClient(TOKEN, APPKEY, "kr1").execute("demo")).rejects.toMatchObject({
      exitCode: EXIT_AUTH_ERROR,
    });
  });

  it("timeout 은 EXIT_API_ERROR 와 재실행 금지 문구다", async () => {
    post.mockReturnValue(rejectWith(new TimeoutError(new Request("https://example.com"))));

    const error = await new PipelineClient(TOKEN, APPKEY, "kr1").execute("demo").catch((e) => e);

    expect(error).toMatchObject({ exitCode: EXIT_API_ERROR });
    expect(error.message).toContain(PIPELINE_UNKNOWN_OUTCOME_HINT);
    expect(error.message).not.toContain("--request-timeout");
  });

  it("연결 끊김도 재실행 금지 문구를 담는다", async () => {
    post.mockReturnValue(rejectWith(new TypeError("fetch failed")));

    const error = await new PipelineClient(TOKEN, APPKEY, "kr1").execute("demo").catch((e) => e);

    expect(error).toMatchObject({ exitCode: EXIT_API_ERROR });
    expect(error.message).toContain(PIPELINE_UNKNOWN_OUTCOME_HINT);
  });

  it("body 에 lastExecutionId 가 없으면 재실행 금지 문구와 API 오류다", async () => {
    post.mockReturnValue(respond({ header: ok, body: { pipelineName: "demo" } }));

    const error = await new PipelineClient(TOKEN, APPKEY, "kr1").execute("demo").catch((e) => e);

    expect(error).toMatchObject({ exitCode: EXIT_API_ERROR });
    expect(error.message).toContain("lastExecutionId");
    expect(error.message).toContain(PIPELINE_UNKNOWN_OUTCOME_HINT);
  });

  it("성공 응답에 body 키가 없어도 재실행 금지 문구와 API 오류다", async () => {
    post.mockReturnValue(respond({ header: ok }));

    const error = await new PipelineClient(TOKEN, APPKEY, "kr1").execute("demo").catch((e) => e);

    expect(error).toMatchObject({ exitCode: EXIT_API_ERROR });
    expect(error.message).toContain(PIPELINE_UNKNOWN_OUTCOME_HINT);
  });
});

describe("PipelineClient.buildExecuteRequest", () => {
  it("method·url·region 만 담고 appkey 와 토큰은 담지 않는다", () => {
    const request = new PipelineClient(TOKEN, APPKEY, "kr3").buildExecuteRequest("a b");

    expect(request).toEqual({
      method: "POST",
      url: "https://kr3-pipeline.api.nhncloudservice.com/api/anchor/v1.1/pipelines/a%20b/execute",
      region: "KR3",
    });
    const text = JSON.stringify(request);
    expect(text).not.toContain(APPKEY);
    expect(text).not.toContain(TOKEN);
  });
});
