import { Command } from "commander";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { appendFile as appendFileAsync, rename as renameAsync } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NhnEnvelopeError } from "../../api/envelope.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR, EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { LogncrashServerError } from "../../services/logncrash/errors.js";
import { startSpinner, stopSpinner } from "../../utils/spinner.js";
import { resolveLogncrashClient } from "./helpers.js";
import {
  createExportCommand,
  finalizeExportFile,
  type ExportFileOps,
} from "./export.js";

vi.mock("./helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./helpers.js")>();
  return { ...actual, resolveLogncrashClient: vi.fn() };
});
vi.mock("../../utils/spinner.js", () => ({
  startSpinner: vi.fn(() => ({ text: "" })),
  stopSpinner: vi.fn(),
}));

const scrollStart = vi.fn();
const scrollNext = vi.fn();
const availableToken = vi.fn();
const client = { availableToken, scrollStart, scrollNext };
let directory: string;

function programWithExport(finalizeOps?: ExportFileOps): Command {
  return new Command("nhncloud").exitOverride().addCommand(createExportCommand(finalizeOps));
}

function args(output: string, extra: string[] = []): string[] {
  return [
    "node",
    "nhncloud",
    "export",
    "--query",
    "*",
    "--from",
    "2026-08-03T00:00:00Z",
    "--to",
    "2026-08-03T01:00:00Z",
    "--output",
    output,
    ...extra,
  ];
}

// 인자의 고정 날짜가 90일 조회 한도 안에 들도록 테스트 시각을 고정한다. 고정하지 않으면 날짜가 지나며 깨진다.
const FIXED_NOW = new Date("2026-08-03T02:00:00Z");

describe("logncrash export v3 scroll", () => {
  beforeEach(() => {
    // 90일 조회 한도 검사가 실행 날짜에 흔들리지 않도록 현재 시각만 고정한다.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-03T12:00:00Z"));
    vi.clearAllMocks();
    vi.setSystemTime(FIXED_NOW);
    directory = mkdtempSync(join(tmpdir(), "logncrash-export-test-"));
    vi.mocked(resolveLogncrashClient).mockResolvedValue(client as never);
    availableToken.mockResolvedValue({ availableToken: 1 });
    scrollStart.mockResolvedValue({ totalItems: 0, pageSize: 10, data: [] });
    scrollNext.mockResolvedValue({ totalItems: 0, data: [] });
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  describe("finalizeExportFile", () => {
    it("JSON 배열 닫기 실패 시 원본 바이트를 고유 .unfinalized로 보존한다", async () => {
      const output = join(directory, "logs.json");
      const tmp = `${output}.run-new.tmp`;
      const cause = new Error("append failed");
      writeFileSync(tmp, '[{"id":1}');
      writeFileSync(`${output}.run-old.complete`, '[{"id":0}]\n');
      writeFileSync(`${output}.run-older.unfinalized`, '[{"id":-1}');
      const ops: ExportFileOps = {
        appendFile: vi.fn().mockRejectedValue(cause),
        rename: renameAsync,
      };

      const result = await finalizeExportFile(tmp, output, "run-new", "json", ops);

      expect(result).toEqual({
        ok: false,
        state: "unfinalized",
        cause,
        recoveryPath: `${output}.run-new.unfinalized`,
        preserved: true,
      });
      expect(readFileSync(`${output}.run-new.unfinalized`, "utf-8")).toBe('[{"id":1}');
      expect(existsSync(tmp)).toBe(false);
      expect(existsSync(`${output}.run-old.complete`)).toBe(true);
      expect(existsSync(`${output}.run-older.unfinalized`)).toBe(true);
      expect(existsSync(`${output}.partial`)).toBe(false);
    });

    it("최종 교체 실패 시 파싱 가능한 고유 .complete로 보존한다", async () => {
      const output = join(directory, "logs.json");
      const tmp = `${output}.run-new.tmp`;
      const cause = new Error("replace failed");
      writeFileSync(tmp, '[{"id":1}');
      const ops: ExportFileOps = {
        appendFile: appendFileAsync,
        rename: vi.fn(async (from: string, to: string) => {
          if (to === output) throw cause;
          await renameAsync(from, to);
        }),
      };

      const result = await finalizeExportFile(tmp, output, "run-new", "json", ops);

      expect(result).toEqual({
        ok: false,
        state: "complete",
        cause,
        recoveryPath: `${output}.run-new.complete`,
        preserved: true,
      });
      expect(JSON.parse(readFileSync(`${output}.run-new.complete`, "utf-8"))).toEqual([{ id: 1 }]);
      expect(existsSync(tmp)).toBe(false);
    });

    it("복구 이동도 실패하면 원래 원인을 보존하고 temp를 삭제하지 않는다", async () => {
      const output = join(directory, "logs.json");
      const tmp = `${output}.run-new.tmp`;
      const cause = new Error("append failed");
      writeFileSync(tmp, '[{"id":1}');
      const ops: ExportFileOps = {
        appendFile: vi.fn().mockRejectedValue(cause),
        rename: vi.fn().mockRejectedValue(new Error("recovery failed")),
      };

      const result = await finalizeExportFile(tmp, output, "run-new", "json", ops);

      expect(result).toEqual({
        ok: false,
        state: "unfinalized",
        cause,
        recoveryPath: `${output}.run-new.unfinalized`,
        preserved: false,
      });
      expect(readFileSync(tmp, "utf-8")).toBe('[{"id":1}');
    });
  });

  describe("조회 토큰 preflight", () => {
    it("scroll 시작과 각 다음 페이지 직전에 잔량을 확인한다", async () => {
      scrollStart.mockResolvedValue({
        scrollKey: "scroll-1",
        totalItems: 2,
        data: [{ id: 1 }],
      });
      scrollNext.mockResolvedValue({ totalItems: 2, data: [{ id: 2 }] });
      const output = join(directory, "logs.jsonl");

      await programWithExport().parseAsync(args(output));

      expect(availableToken).toHaveBeenCalledTimes(2);
      expect(availableToken.mock.invocationCallOrder[0]).toBeLessThan(
        scrollStart.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
      );
      expect(availableToken.mock.invocationCallOrder[1]).toBeLessThan(
        scrollNext.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
      );
    });

    it.each([0, -10])("첫 잔량이 %s이면 검색과 파일 생성을 남기지 않는다", async (remaining) => {
      availableToken.mockResolvedValue({ availableToken: remaining });
      const output = join(directory, "logs.jsonl");

      await expect(programWithExport().parseAsync(args(output))).rejects.toMatchObject({
        exitCode: EXIT_API_ERROR,
        message: expect.stringContaining("검색 요청을 보내지 않았습니다"),
      });

      expect(scrollStart).not.toHaveBeenCalled();
      expect(existsSync(output)).toBe(false);
      expect(readdirSync(directory)).toEqual([]);
    });

    it("중간 잔량 차단은 받은 결과를 partial로 보존한다", async () => {
      availableToken
        .mockResolvedValueOnce({ availableToken: 1 })
        .mockResolvedValueOnce({ availableToken: 0 });
      scrollStart.mockResolvedValue({
        scrollKey: "scroll-1",
        totalItems: 2,
        data: [{ id: 1 }],
      });
      const output = join(directory, "logs.jsonl");

      await expect(programWithExport().parseAsync(args(output))).rejects.toMatchObject({
        exitCode: EXIT_API_ERROR,
        message: expect.stringContaining("검색 요청을 보내지 않았습니다"),
      });

      expect(scrollNext).not.toHaveBeenCalled();
      expect(readFileSync(`${output}.partial`, "utf-8")).toBe('{"id":1}\n');
      expect(existsSync(output)).toBe(false);
    });

    it("잔량 조회 오류를 보존하고 검색을 보내지 않는다", async () => {
      const error = new NhnCloudCliError("토큰 조회 실패", EXIT_API_ERROR);
      availableToken.mockRejectedValue(error);
      const output = join(directory, "logs.jsonl");

      await expect(programWithExport().parseAsync(args(output))).rejects.toBe(error);

      expect(scrollStart).not.toHaveBeenCalled();
      expect(readdirSync(directory)).toEqual([]);
    });

    it("첫 preflight의 429 봉투 오류에는 검색 rate limit 안내를 붙이지 않는다", async () => {
      const error = new NhnEnvelopeError(429, "available-token failed");
      availableToken.mockRejectedValue(error);
      const output = join(directory, "logs.jsonl");

      await expect(programWithExport().parseAsync(args(output))).rejects.toBe(error);

      expect(error.message).not.toContain("조회 횟수 제한에 걸렸습니다");
      expect(scrollStart).not.toHaveBeenCalled();
      expect(readdirSync(directory)).toEqual([]);
    });

    it("첫 preflight의 500 오류에는 적응형 분할을 적용하지 않는다", async () => {
      const error = new LogncrashServerError("available-token failed", "request-id");
      availableToken.mockRejectedValue(error);
      const output = join(directory, "logs.jsonl");

      await expect(programWithExport().parseAsync(args(output))).rejects.toBe(error);

      expect(availableToken).toHaveBeenCalledTimes(1);
      expect(scrollStart).not.toHaveBeenCalled();
      expect(readdirSync(directory)).toEqual([]);
    });

    it("중간 preflight의 429 봉투 오류를 보존하고 받은 결과만 partial로 남긴다", async () => {
      const error = new NhnEnvelopeError(429, "available-token failed");
      availableToken
        .mockResolvedValueOnce({ availableToken: 1 })
        .mockRejectedValueOnce(error);
      scrollStart.mockResolvedValue({
        scrollKey: "scroll-1",
        totalItems: 2,
        data: [{ id: 1 }],
      });
      const output = join(directory, "logs.jsonl");

      await expect(programWithExport().parseAsync(args(output))).rejects.toBe(error);

      expect(error.message).not.toContain("조회 횟수 제한에 걸렸습니다");
      expect(scrollNext).not.toHaveBeenCalled();
      expect(readFileSync(`${output}.partial`, "utf-8")).toBe('{"id":1}\n');
    });
  });

  describe("조회 완료 뒤 로컬 파일 실패 (ADR-034)", () => {
    function stderrText(): string {
      return vi
        .mocked(process.stderr.write)
        .mock.calls.map(([message]) => String(message))
        .join("");
    }

    function expectNoSuccessSpinner(): void {
      expect(vi.mocked(stopSpinner).mock.calls.some(([success]) => success === true)).toBe(false);
      expect(stopSpinner).toHaveBeenCalledWith(false);
      expect(vi.mocked(stopSpinner).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(process.stderr.write).mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
      );
    }

    it("JSON 배열 닫기 실패는 .unfinalized를 남기고 재조회를 안내하지 않는다", async () => {
      scrollStart.mockResolvedValue({ totalItems: 1, data: [{ id: 1 }] });
      const output = join(directory, "logs.json");
      const cause = new Error("append failed");
      const ops: ExportFileOps = {
        appendFile: vi.fn().mockRejectedValue(cause),
        rename: renameAsync,
      };

      await expect(
        programWithExport(ops).parseAsync(args(output, ["--format", "json"])),
      ).rejects.toMatchObject({
        exitCode: EXIT_PARAM_ERROR,
        message: expect.stringContaining("append failed"),
      });

      const files = readdirSync(directory);
      const recovery = files.find((file) => file.endsWith(".unfinalized"));
      expect(recovery).toBeDefined();
      expect(readFileSync(join(directory, recovery ?? ""), "utf-8")).toBe('[{"id":1}');
      expect(files.some((file) => file.endsWith(".tmp"))).toBe(false);
      expect(files).not.toContain("logs.json.partial");
      expect(stderrText()).toContain("API 재조회가 필요 없는");
      expect(stderrText()).toContain(join(directory, recovery ?? ""));
      expect(stderrText()).not.toContain("이어받");
      expectNoSuccessSpinner();
    });

    it("최종 교체 실패는 파싱 가능한 .complete와 정확한 복구 안내를 남긴다", async () => {
      scrollStart.mockResolvedValue({ totalItems: 1, data: [{ id: 1 }] });
      const output = join(directory, "logs.json");
      const cause = new Error("replace failed");
      const ops: ExportFileOps = {
        appendFile: appendFileAsync,
        rename: vi.fn(async (from: string, to: string) => {
          if (to === output) throw cause;
          await renameAsync(from, to);
        }),
      };

      await expect(
        programWithExport(ops).parseAsync(args(output, ["--format", "json"])),
      ).rejects.toMatchObject({
        exitCode: EXIT_PARAM_ERROR,
        message: expect.stringContaining("replace failed"),
      });

      const files = readdirSync(directory);
      const recovery = files.find((file) => file.endsWith(".complete"));
      expect(recovery).toBeDefined();
      expect(JSON.parse(readFileSync(join(directory, recovery ?? ""), "utf-8"))).toEqual([{ id: 1 }]);
      expect(files.some((file) => file.endsWith(".tmp"))).toBe(false);
      expect(stderrText()).toContain("그대로 사용할 수 있습니다");
      expect(stderrText()).toContain(join(directory, recovery ?? ""));
      expect(stderrText()).not.toContain("이어받");
      expectNoSuccessSpinner();
    });

    it("복구 이동도 실패하면 temp 경로와 원래 오류를 알린다", async () => {
      scrollStart.mockResolvedValue({ totalItems: 1, data: [{ id: 1 }] });
      const output = join(directory, "logs.json");
      const cause = new Error("append failed");
      const ops: ExportFileOps = {
        appendFile: vi.fn().mockRejectedValue(cause),
        rename: vi.fn().mockRejectedValue(new Error("recovery failed")),
      };

      await expect(
        programWithExport(ops).parseAsync(args(output, ["--format", "json"])),
      ).rejects.toMatchObject({
        exitCode: EXIT_PARAM_ERROR,
        message: expect.stringContaining("append failed"),
      });

      const temp = readdirSync(directory).find((file) => file.endsWith(".tmp"));
      expect(temp).toBeDefined();
      expect(stderrText()).toContain("삭제하지 않았습니다");
      expect(stderrText()).toContain(join(directory, temp ?? ""));
      expectNoSuccessSpinner();
    });
  });

  it("--size 생략 시 경고 없이 scroll 시작 body에 query/from/to만 전달한다", async () => {
    const output = join(directory, "logs.jsonl");
    await programWithExport().parseAsync(args(output));

    expect(scrollStart).toHaveBeenCalledWith({
      query: "*",
      from: "2026-08-03T00:00:00Z",
      to: "2026-08-03T01:00:00Z",
    });
    expect(String(vi.mocked(process.stderr.write).mock.calls.flat())).not.toContain("폐기 예정");
    expect(readFileSync(output, "utf-8")).toBe("");
  });

  it("--size 100은 한 번 경고하지만 scroll body에는 넣지 않는다", async () => {
    const output = join(directory, "logs.jsonl");
    await programWithExport().parseAsync(args(output, ["--size", "100"]));

    const warnings = vi.mocked(process.stderr.write).mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.includes("폐기 예정"));
    expect(warnings).toHaveLength(1);
    expect(scrollStart.mock.calls[0]?.[0]).not.toHaveProperty("pageSize");
  });

  it("범위 밖 --size를 자격증명·파일·API 전에 거부한다", async () => {
    const output = join(directory, "logs.jsonl");
    await expect(
      programWithExport().parseAsync(args(output, ["--size", "101"])),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });

    expect(resolveLogncrashClient).not.toHaveBeenCalled();
    expect(startSpinner).not.toHaveBeenCalled();
    expect(scrollStart).not.toHaveBeenCalled();
    expect(readdirSync(directory)).toEqual([]);
  });

  it("pageSize 없는 다음 응답을 처리하고 빈 data 또는 전체 건수에서 종료한다", async () => {
    scrollStart.mockResolvedValue({
      scrollKey: "scroll-1",
      totalItems: 2,
      pageSize: 10,
      data: [{ id: 1 }],
    });
    scrollNext.mockResolvedValue({ totalItems: 2, data: [{ id: 2 }] });
    const output = join(directory, "logs.jsonl");

    await programWithExport().parseAsync(args(output));

    expect(scrollNext).toHaveBeenCalledWith("scroll-1");
    expect(readFileSync(output, "utf-8")).toBe('{"id":1}\n{"id":2}\n');
  });

  it("다음 페이지 실패 시 임시 파일을 정리하고 원본 오류를 보존한다", async () => {
    scrollStart.mockResolvedValue({
      scrollKey: "scroll-1",
      totalItems: 2,
      data: [{ id: 1 }],
    });
    scrollNext.mockRejectedValue(
      new NhnCloudCliError("upstream 503", EXIT_API_ERROR),
    );
    const output = join(directory, "logs.jsonl");

    await expect(programWithExport().parseAsync(args(output))).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
      message: expect.stringContaining("upstream 503"),
    });
    expect(scrollStart).toHaveBeenCalledTimes(1);
    // 받은 1건은 .partial 로 보존하고 임시 파일은 남기지 않는다.
    expect(readdirSync(directory)).toEqual(["logs.jsonl.partial"]);
  });

  it("첫 500 뒤 절반 창으로 재시도해 전체 범위를 추출한다", async () => {
    scrollStart
      .mockRejectedValueOnce(new LogncrashServerError("server 500", "req-1"))
      .mockResolvedValueOnce({ totalItems: 1, data: [{ id: 1 }] })
      .mockResolvedValueOnce({ totalItems: 1, data: [{ id: 2 }] });
    const output = join(directory, "logs.jsonl");

    await programWithExport().parseAsync(args(output));

    expect(scrollStart.mock.calls.map(([body]) => body)).toEqual([
      { query: "*", from: "2026-08-03T00:00:00Z", to: "2026-08-03T01:00:00Z" },
      { query: "*", from: "2026-08-03T00:00:00Z", to: "2026-08-03T00:30:00Z" },
      { query: "*", from: "2026-08-03T00:30:00Z", to: "2026-08-03T01:00:00Z" },
    ]);
    expect(availableToken).toHaveBeenCalledTimes(3);
    expect(readFileSync(output, "utf-8")).toBe('{"id":1}\n{"id":2}\n');
  });

  it("찾아낸 성공 창 크기를 남은 구간에 재사용한다", async () => {
    scrollStart
      .mockRejectedValueOnce(new LogncrashServerError("server 500", null))
      .mockRejectedValueOnce(new LogncrashServerError("server 500", null))
      .mockResolvedValue({ totalItems: 0, data: [] });
    const output = join(directory, "logs.jsonl");

    await programWithExport().parseAsync(args(output));

    expect(scrollStart.mock.calls.slice(2).map(([body]) => body)).toEqual([
      { query: "*", from: "2026-08-03T00:00:00Z", to: "2026-08-03T00:15:00Z" },
      { query: "*", from: "2026-08-03T00:15:00Z", to: "2026-08-03T00:30:00Z" },
      { query: "*", from: "2026-08-03T00:30:00Z", to: "2026-08-03T00:45:00Z" },
      { query: "*", from: "2026-08-03T00:45:00Z", to: "2026-08-03T01:00:00Z" },
    ]);
  });

  it("최소 창에서도 500이면 실패하고 결과와 임시 파일을 남기지 않는다", async () => {
    scrollStart.mockRejectedValue(new LogncrashServerError("server 500", null));
    const output = join(directory, "logs.jsonl");

    await expect(programWithExport().parseAsync(args(output))).rejects.toBeInstanceOf(
      LogncrashServerError,
    );

    expect(scrollStart).toHaveBeenCalledTimes(3);
    expect(existsSync(output)).toBe(false);
    expect(readdirSync(directory)).toEqual([]);
  });

  it("scrollNext에서 일부를 쓴 뒤 500이어도 분할하고 실패 창의 로그를 되돌린다", async () => {
    scrollStart
      .mockResolvedValueOnce({ totalItems: 3, scrollKey: "full-1", data: [{ id: 1 }] })
      .mockResolvedValueOnce({ totalItems: 2, data: [{ id: 1 }, { id: 2 }] })
      .mockResolvedValueOnce({ totalItems: 1, data: [{ id: 3 }] });
    scrollNext
      .mockResolvedValueOnce({ totalItems: 3, scrollKey: "full-2", data: [{ id: 2 }] })
      .mockRejectedValueOnce(new LogncrashServerError("next 500", "req-next"));
    const output = join(directory, "logs.jsonl");

    await programWithExport().parseAsync(args(output));

    expect(scrollNext).toHaveBeenCalledTimes(2);
    expect(readFileSync(output, "utf-8")).toBe('{"id":1}\n{"id":2}\n{"id":3}\n');
  });

  it("여러 창의 totalItems를 누적해 진행률 분모를 유지한다", async () => {
    scrollStart
      .mockRejectedValueOnce(new LogncrashServerError("server 500", null))
      .mockResolvedValueOnce({ totalItems: 2, data: [{ id: 1 }, { id: 2 }] })
      .mockResolvedValueOnce({ totalItems: 3, data: [{ id: 3 }, { id: 4 }, { id: 5 }] });
    const output = join(directory, "logs.jsonl");

    await programWithExport().parseAsync(args(output));

    const spinner = vi.mocked(startSpinner).mock.results[0]?.value as { text: string };
    expect(spinner.text).toContain("5/5");
  });

  it("상한에 도달하면 남은 창을 조회하지 않고 절단 경고를 남긴다", async () => {
    scrollStart
      .mockRejectedValueOnce(new LogncrashServerError("server 500", null))
      .mockResolvedValueOnce({
        totalItems: 100_000,
        data: Array(100_000).fill({ id: 1 }),
      });
    const output = join(directory, "logs.jsonl");

    await programWithExport().parseAsync(args(output));

    expect(scrollStart).toHaveBeenCalledTimes(2);
    expect(vi.mocked(process.stderr.write).mock.calls.flat().join(" ")).toContain(
      "남은 창을 조회하지 않은 채 상한 100000건까지만 추출했습니다",
    );
  });

  it("500이 아닌 scrollStart 오류는 분할 재시도하지 않는다", async () => {
    const error = new NhnCloudCliError("unauthorized", EXIT_API_ERROR);
    scrollStart.mockRejectedValue(error);
    const output = join(directory, "logs.jsonl");

    await expect(programWithExport().parseAsync(args(output))).rejects.toBe(error);

    expect(scrollStart).toHaveBeenCalledTimes(1);
    expect(readdirSync(directory)).toEqual([]);
  });

  it("JSON 형식은 여러 창에서도 하나의 올바른 배열을 만든다", async () => {
    scrollStart
      .mockRejectedValueOnce(new LogncrashServerError("server 500", null))
      .mockResolvedValueOnce({ totalItems: 1, data: [{ id: 1 }] })
      .mockResolvedValueOnce({ totalItems: 1, data: [{ id: 2 }] });
    const output = join(directory, "logs.json");

    await programWithExport().parseAsync(args(output, ["--format", "json"]));

    expect(JSON.parse(readFileSync(output, "utf-8"))).toEqual([{ id: 1 }, { id: 2 }]);
    expect(readFileSync(output, "utf-8")).toBe('[{"id":1},{"id":2}]\n');
  });

  describe("조회 횟수 제한과 부분 결과 보존 (ADR-032)", () => {
    const rateLimit = (): NhnEnvelopeError =>
      new NhnEnvelopeError(429, "Rate limit exceeded.");

    function stderrText(): string {
      return vi
        .mocked(process.stderr.write)
        .mock.calls.map(([message]) => String(message))
        .join("");
    }

    it("일부를 받은 뒤 실패하면 .partial 에 남기고 --output 은 만들지 않는다", async () => {
      scrollStart.mockResolvedValue({
        scrollKey: "scroll-1",
        totalItems: 2,
        data: [{ id: 1 }],
      });
      scrollNext.mockRejectedValue(rateLimit());
      const output = join(directory, "logs.jsonl");

      await expect(programWithExport().parseAsync(args(output))).rejects.toMatchObject({
        exitCode: EXIT_API_ERROR,
      });

      expect(existsSync(output)).toBe(false);
      expect(readFileSync(`${output}.partial`, "utf-8")).toBe('{"id":1}\n');
      expect(readdirSync(directory)).toEqual(["logs.jsonl.partial"]);
      expect(stderrText()).toContain("받은 1건을");
    });

    it("--format json 부분 파일도 배열을 닫아 그대로 파싱된다", async () => {
      scrollStart.mockResolvedValue({
        scrollKey: "scroll-1",
        totalItems: 5,
        data: [{ id: 1 }, { id: 2 }],
      });
      scrollNext.mockRejectedValue(rateLimit());
      const output = join(directory, "logs.json");

      await expect(
        programWithExport().parseAsync(args(output, ["--format", "json"])),
      ).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });

      expect(JSON.parse(readFileSync(`${output}.partial`, "utf-8"))).toEqual([
        { id: 1 },
        { id: 2 },
      ]);
    });

    it("분할이 일어난 뒤 실패하면 안내의 --from 이 실패한 창의 시작이다", async () => {
      scrollStart
        .mockRejectedValueOnce(new LogncrashServerError("server 500", null))
        .mockResolvedValueOnce({
          totalItems: 1,
          data: [{ id: 1, logTime: "2026-08-03T00:05:00Z" }],
        })
        .mockRejectedValueOnce(rateLimit());
      const output = join(directory, "logs.jsonl");

      await expect(programWithExport().parseAsync(args(output))).rejects.toMatchObject({
        exitCode: EXIT_API_ERROR,
      });

      // 창은 오래된 쪽부터 처리되므로 이어받을 지점은 실패한 창(2번째)의 시작이다.
      expect(stderrText()).toContain(
        '--from "2026-08-03T00:30:00Z" --to "2026-08-03T01:00:00Z"',
      );
      // 이미 받은 구간의 시작도, 파일 마지막 로그의 logTime 도 아니다.
      expect(stderrText()).not.toContain('--from "2026-08-03T00:00:00Z"');
      expect(stderrText()).not.toContain("00:05:00Z");
    });

    // 실패 위에 실패가 겹치는 경로다. 보존이 안 되는 것보다 원인이 가려지는 것이 나쁘다.
    it("부분 결과 보존이 실패해도 원본 오류를 가리지 않는다", async () => {
      scrollStart.mockResolvedValue({
        scrollKey: "scroll-1",
        totalItems: 2,
        data: [{ id: 1 }],
      });
      scrollNext.mockRejectedValue(rateLimit());
      const output = join(directory, "logs.jsonl");
      // .partial 자리를 디렉터리로 막아 rename 을 실패시킨다.
      mkdirSync(`${output}.partial`);

      const error: unknown = await programWithExport()
        .parseAsync(args(output))
        .then(() => null)
        .catch((e: unknown) => e);

      // 원본 rate limit 오류가 그대로 올라온다.
      expect(error).toMatchObject({ exitCode: EXIT_API_ERROR });
      expect((error as Error).message).toContain("조회 횟수 제한");

      const written = vi.mocked(process.stderr.write).mock.calls
        .map((call) => String(call[0]))
        .join("");
      expect(written).toContain("남기지 못했습니다");
      // 남기지 못했는데 남겼다고 알리면 안 된다.
      expect(written).not.toContain("에 남겼습니다");
    });

    it("한 건도 받지 못하고 실패하면 .partial 도 임시 파일도 남지 않는다", async () => {
      scrollStart.mockRejectedValue(rateLimit());
      const output = join(directory, "logs.jsonl");

      await expect(programWithExport().parseAsync(args(output))).rejects.toMatchObject({
        exitCode: EXIT_API_ERROR,
      });

      expect(readdirSync(directory)).toEqual([]);
    });

    it("scrollNext 의 조회 횟수 제한은 available-token 재확인을 안내한다", async () => {
      scrollStart.mockResolvedValue({
        scrollKey: "scroll-1",
        totalItems: 2,
        data: [{ id: 1 }],
      });
      scrollNext.mockRejectedValue(rateLimit());
      const output = join(directory, "logs.jsonl");

      const error: unknown = await programWithExport()
        .parseAsync(args(output))
        .then(() => null)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(NhnCloudCliError);
      expect((error as NhnCloudCliError).message).toContain("nhncloud logncrash available-token");
      expect((error as NhnCloudCliError).message).not.toContain("범위를 좁혀");
    });

    it("scrollStart 단계의 조회 횟수 제한도 같은 안내를 받는다", async () => {
      scrollStart.mockRejectedValue(rateLimit());
      const output = join(directory, "logs.jsonl");

      await expect(programWithExport().parseAsync(args(output))).rejects.toMatchObject({
        exitCode: EXIT_API_ERROR,
        message: expect.stringContaining("nhncloud logncrash available-token"),
      });
    });

    it("조회 횟수 제한은 적응형 분할을 유발하지 않는다", async () => {
      scrollStart.mockRejectedValue(rateLimit());
      const output = join(directory, "logs.jsonl");

      await expect(programWithExport().parseAsync(args(output))).rejects.toBeInstanceOf(
        NhnCloudCliError,
      );

      expect(scrollStart).toHaveBeenCalledTimes(1);
    });

    // 분할이 없으면 실패한 창이 곧 요청 구간 전체라 이어받을 지점이 없다.
    // 그때 --from 안내를 내면 방금 친 명령과 글자까지 같아진다.
    it("분할이 없으면 이어받기 대신 전량 재조회를 알린다", async () => {
      scrollStart.mockResolvedValue({
        scrollKey: "scroll-1",
        totalItems: 2,
        data: [{ id: 1 }],
      });
      scrollNext.mockRejectedValue(rateLimit());
      const output = join(directory, "logs.jsonl");

      await expect(programWithExport().parseAsync(args(output))).rejects.toMatchObject({
        exitCode: EXIT_API_ERROR,
      });

      const written = stderrText();
      expect(written).toContain("이어받을 지점이 없습니다");
      expect(written).not.toContain("이어받으려면 --from");
    });

    // 힌트를 붙이는 지점이 한 곳이라 문구가 두 번 붙을 수 없다.
    it("조회 횟수 제한 안내가 한 번만 붙는다", async () => {
      scrollStart.mockResolvedValue({
        scrollKey: "scroll-1",
        totalItems: 2,
        data: [{ id: 1 }],
      });
      scrollNext.mockRejectedValue(rateLimit());
      const output = join(directory, "logs.jsonl");

      const error: unknown = await programWithExport()
        .parseAsync(args(output))
        .then(() => null)
        .catch((e: unknown) => e);

      const message = (error as Error).message;
      expect(message.split("조회 횟수 제한에 걸렸습니다").length - 1).toBe(1);
    });

    // 교체 전에 지우면 rename 이 실패했을 때 이번 결과와 앞선 부분 결과를 한꺼번에 잃는다.
    it("교체가 실패하면 앞선 부분 파일을 지우지 않는다", async () => {
      // --output 자리를 비어 있지 않은 디렉터리로 막으면 rename 이 실패한다.
      const output = join(directory, "blocked");
      mkdirSync(output);
      writeFileSync(join(output, "keep"), "x");
      writeFileSync(`${output}.partial`, '{"kept":true}\n');

      scrollStart.mockResolvedValue({ scrollKey: undefined, totalItems: 1, data: [{ id: 1 }] });

      await expect(
        programWithExport().parseAsync(args(output, ["--force"])),
      ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });

      // 이번 결과를 잃은 위에 앞선 부분 결과까지 잃으면 안 된다.
      expect(existsSync(`${output}.partial`)).toBe(true);
    });

    // 성공한 실행은 낡은 부분 결과만 치우고, 사용자가 확인해야 할 복구 파일은 보존한다.
    it("성공하면 .partial만 치우고 앞선 .complete와 .unfinalized는 보존한다", async () => {
      const output = join(directory, "logs.jsonl");
      writeFileSync(`${output}.partial`, '{"stale":true}\n');
      writeFileSync(`${output}.run-old.complete`, '{"complete":true}\n');
      writeFileSync(`${output}.run-older.unfinalized`, '[{"unfinalized":true}');

      scrollStart.mockResolvedValue({ scrollKey: undefined, totalItems: 1, data: [{ id: 1 }] });
      const renameForSuccess = vi.fn(renameAsync);

      await programWithExport({
        appendFile: appendFileAsync,
        rename: renameForSuccess,
      }).parseAsync(args(output));

      expect(existsSync(output)).toBe(true);
      expect(existsSync(`${output}.partial`)).toBe(false);
      expect(existsSync(`${output}.run-old.complete`)).toBe(true);
      expect(existsSync(`${output}.run-older.unfinalized`)).toBe(true);
      const successSpinnerCall = vi.mocked(stopSpinner).mock.calls.findIndex(([success]) => success === true);
      expect(successSpinnerCall).toBeGreaterThanOrEqual(0);
      expect(renameForSuccess.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(stopSpinner).mock.invocationCallOrder[successSpinnerCall] ?? 0,
      );
    });
  });
});
