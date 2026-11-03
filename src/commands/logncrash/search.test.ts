import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { output } from "../../formatters/table.js";
import { LogncrashServerError } from "../../services/logncrash/errors.js";
import { NhnEnvelopeError } from "../../api/envelope.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { startSpinner } from "../../utils/spinner.js";
import { EXIT_API_ERROR, EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { resolveLogncrashClient } from "./helpers.js";
import { searchCommand } from "./search.js";

vi.mock("./helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./helpers.js")>();
  return { ...actual, resolveLogncrashClient: vi.fn() };
});
vi.mock("../../formatters/table.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../formatters/table.js")>();
  return { ...actual, output: vi.fn() };
});
vi.mock("../../utils/spinner.js", () => ({
  startSpinner: vi.fn(() => ({})),
  stopSpinner: vi.fn(),
}));

const cursorSearch = vi.fn();
const availableToken = vi.fn();
const client = { availableToken, cursorSearch };

function programWithSearch(): Command {
  return new Command("nhncloud")
    .exitOverride()
    .option("--json")
    .option("--quiet")
    .addCommand(searchCommand);
}

function baseArgs(): string[] {
  return [
    "node",
    "nhncloud",
    "search",
    "--query",
    "*",
    "--from",
    "2026-08-03T00:00:00Z",
    "--to",
    "2026-08-03T01:00:00Z",
  ];
}

// 인자의 고정 날짜가 90일 조회 한도 안에 들도록 테스트 시각을 고정한다. 고정하지 않으면 날짜가 지나며 깨진다.
const FIXED_NOW = new Date("2026-08-03T02:00:00Z");

describe("logncrash search v3 cursor", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    // 90일 조회 한도 검사가 실행 날짜에 흔들리지 않도록 현재 시각만 고정한다.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-03T12:00:00Z"));
    vi.clearAllMocks();
    vi.setSystemTime(FIXED_NOW);
    vi.mocked(resolveLogncrashClient).mockResolvedValue(client as never);
    availableToken.mockResolvedValue({ availableToken: 1 });
    cursorSearch.mockResolvedValue({
      totalItems: 1,
      pageNumber: 0,
      pageSize: 10,
      data: [{ logTime: "2026-08-03T00:30:00Z", logType: "NORMAL", logBody: "hello" }],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("조회 토큰을 cursor 검색 직전에 확인한다", async () => {
    await programWithSearch().parseAsync(baseArgs());

    expect(availableToken).toHaveBeenCalledTimes(1);
    expect(availableToken.mock.invocationCallOrder[0]).toBeLessThan(
      cursorSearch.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it.each([0, -10])("조회 토큰이 %s이면 cursor 검색을 보내지 않는다", async (remaining) => {
    availableToken.mockResolvedValue({ availableToken: remaining });

    await expect(programWithSearch().parseAsync(baseArgs())).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
      message: expect.stringMatching(/검색 요청을 보내지 않았습니다.*1\.6 token\/s.*자동으로 기다리지/s),
    });

    expect(cursorSearch).not.toHaveBeenCalled();
  });

  it("조회 토큰 확인 실패를 보존하고 cursor 검색을 보내지 않는다", async () => {
    const error = new NhnCloudCliError("토큰 조회 실패", EXIT_API_ERROR);
    availableToken.mockRejectedValue(error);

    await expect(programWithSearch().parseAsync(baseArgs())).rejects.toBe(error);

    expect(cursorSearch).not.toHaveBeenCalled();
  });

  it("조회 토큰 확인의 429 봉투 오류에는 검색 rate limit 안내를 붙이지 않는다", async () => {
    const error = new NhnEnvelopeError(429, "available-token failed");
    availableToken.mockRejectedValue(error);

    await expect(programWithSearch().parseAsync(baseArgs())).rejects.toBe(error);

    expect(error.message).not.toContain("조회 횟수 제한에 걸렸습니다");
    expect(cursorSearch).not.toHaveBeenCalled();
  });

  it.each([
    ["--page 1", ["--page", "1"]],
    ["빈 cursor", ["--cursor", ""]],
  ])("%s를 자격증명·spinner·API 전에 거부한다", async (_name, extra) => {
    await expect(
      programWithSearch().parseAsync([...baseArgs(), ...extra]),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });

    expect(resolveLogncrashClient).not.toHaveBeenCalled();
    expect(startSpinner).not.toHaveBeenCalled();
    expect(cursorSearch).not.toHaveBeenCalled();
  });

  it("첫 페이지는 cursor를 생략하고 JSON raw에도 nextCursor를 만들지 않는다", async () => {
    await programWithSearch().parseAsync([
      "node",
      "nhncloud",
      "--json",
      ...baseArgs().slice(2),
      "--size",
      "1",
      "--profile",
      "profile-a",
    ]);

    expect(resolveLogncrashClient).toHaveBeenCalledWith("profile-a");
    expect(cursorSearch).toHaveBeenCalledWith({
      query: "*",
      from: "2026-08-03T00:00:00Z",
      to: "2026-08-03T01:00:00Z",
      pageSize: 1,
    });
    const raw = vi.mocked(output).mock.calls[0]?.[1].raw as Record<string, unknown>;
    expect(raw).not.toHaveProperty("nextCursor");
  });

  it("opaque cursor를 변형 없이 전달하고 기존 table·quiet 식별 값을 유지한다", async () => {
    const nextCursor = "opaque+/=cursor";
    cursorSearch.mockResolvedValue({
      totalItems: 2,
      pageNumber: 0,
      pageSize: 10,
      data: [{ logTime: "2026-08-03T00:30:00Z", logType: "NORMAL", logBody: "hello" }],
      nextCursor,
    });

    await programWithSearch().parseAsync([
      "node",
      "nhncloud",
      "--quiet",
      ...baseArgs().slice(2),
      "--cursor",
      nextCursor,
    ]);

    expect(cursorSearch).toHaveBeenCalledWith(expect.objectContaining({ cursor: nextCursor }));
    expect(output).toHaveBeenCalledWith(
      expect.objectContaining({ quiet: true }),
      expect.objectContaining({
        headers: ["logTime", "logType", "본문 요약"],
        rows: [["2026-08-03T00:30:00Z", "NORMAL", "hello"]],
        ids: ["2026-08-03T00:30:00Z"],
        raw: expect.objectContaining({ nextCursor }),
      }),
    );
  });

  it("500에는 추정 안내와 정제한 requestId를 붙여 다시 던진다", async () => {
    cursorSearch.mockRejectedValue(
      new LogncrashServerError("API 호출 실패 (500)", "request\n-id"),
    );

    await expect(programWithSearch().parseAsync(baseArgs())).rejects.toMatchObject({
      requestId: "request?-id",
      message: expect.stringMatching(
        /API 호출 실패 \(500\).*검색 기간이 넓어.*export.*requestId: request\?-id/s,
      ),
    });
  });

  it("requestId가 null인 500에는 requestId 부분 없이 추정 안내만 붙인다", async () => {
    cursorSearch.mockRejectedValue(
      new LogncrashServerError("API 호출 실패 (500)", null),
    );

    await expect(programWithSearch().parseAsync(baseArgs())).rejects.toMatchObject({
      requestId: null,
      message: expect.stringMatching(
        /^(?!.*requestId:).*검색 기간이 넓어 서버가 처리하지 못했을 수 있습니다/s,
      ),
    });
  });

  it("401은 안내를 붙이지 않고 원본 오류를 그대로 전달한다", async () => {
    const error = new NhnCloudCliError("인증 실패 (401)", EXIT_API_ERROR);
    cursorSearch.mockRejectedValue(error);

    await expect(programWithSearch().parseAsync(baseArgs())).rejects.toBe(error);
  });

  // ADR-032: 실제 검색 rate limit에는 500 안내 대신 잔량 재확인 방법을 붙인다.
  it("실제 검색 rate limit에는 available-token 재확인을 안내한다", async () => {
    cursorSearch.mockRejectedValue(
      new NhnEnvelopeError(429, "Rate limit exceeded. Please try again later."),
    );

    await expect(programWithSearch().parseAsync(baseArgs())).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
      message: expect.stringContaining("nhncloud logncrash available-token"),
    });
    await expect(programWithSearch().parseAsync(baseArgs())).rejects.toMatchObject({
      message: expect.not.stringContaining("검색 기간이 넓어"),
    });
  });

  // 판별 없이 모든 봉투 오류를 감싸는 구현을 막는다.
  it("rate limit 이 아닌 봉투 오류에는 그 안내가 붙지 않는다", async () => {
    cursorSearch.mockRejectedValue(new NhnEnvelopeError(-401, "Authentication failed."));

    await expect(programWithSearch().parseAsync(baseArgs())).rejects.toMatchObject({
      message: expect.not.stringContaining("조회 횟수 제한"),
    });
  });
});
