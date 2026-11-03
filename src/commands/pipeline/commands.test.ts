import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { PipelineClient } from "../../services/pipeline/client.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR, EXIT_CONFIG_ERROR, EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { configureCommanderExitCodes } from "../commander-errors.js";
import { executeCommand } from "./execute.js";
import { startSpinner } from "../../utils/spinner.js";
import { issuePipelineToken, resolvePipelineAppKey, resolvePipelineProfile, resolvePipelineUak } from "./helpers.js";

vi.mock("./helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./helpers.js")>();
  return {
    ...actual,
    resolvePipelineProfile: vi.fn(),
    resolvePipelineAppKey: vi.fn(),
    resolvePipelineUak: vi.fn(),
    issuePipelineToken: vi.fn(),
  };
});
vi.mock("../../utils/spinner.js", () => ({ startSpinner: vi.fn(), stopSpinner: vi.fn() }));

const executeSpy = vi.spyOn(PipelineClient.prototype, "execute");
const body = {
  appkey: "official-appkey",
  region: "KR1",
  pipelineName: "demo",
  reason: null,
  lastExecutionId: "executionId",
};

function program(): Command {
  const pipeline = new Command("pipeline").addCommand(executeCommand);
  const root = new Command("nhncloud").exitOverride().option("--json").option("--quiet").addCommand(pipeline);
  configureCommanderExitCodes(root);
  return root;
}

async function run(...args: string[]): Promise<void> {
  await program().parseAsync(["node", "nhncloud", "pipeline", ...args]);
}

describe("pipeline execute 명령", () => {
  let stdoutWrite: MockInstance<typeof process.stdout.write>;
  const stdout = (): string => stdoutWrite.mock.calls.map((call) => String(call[0])).join("");

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.mocked(resolvePipelineProfile).mockResolvedValue({ profileName: "default", environment: "real" });
    vi.mocked(resolvePipelineAppKey).mockResolvedValue("test-appkey");
    vi.mocked(resolvePipelineUak).mockResolvedValue({ id: "<uak-id>", secret: "<uak-secret>" });
    vi.mocked(issuePipelineToken).mockResolvedValue("test-token");
    executeSpy.mockResolvedValue(body);
  });
  afterEach(() => stdoutWrite.mockRestore());

  it("--yes 와 --dry-run 이 모두 없으면 토큰 발급과 호출 없이 입력 오류다", async () => {
    await expect(run("execute", "demo")).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR,
      message: expect.stringMatching(/--yes.*--dry-run/),
    });

    expect(resolvePipelineProfile).not.toHaveBeenCalled();
    expect(issuePipelineToken).not.toHaveBeenCalled();
    expect(executeSpy).not.toHaveBeenCalled();
    expect(stdout()).toBe("");
  });

  it("빈 pipeline 이름은 profile 해석 전에 입력 오류다", async () => {
    await expect(run("execute", "  ", "--yes")).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });

    expect(resolvePipelineProfile).not.toHaveBeenCalled();
  });

  it("--dry-run 은 요청만 출력하고 비밀값을 담지 않는다", async () => {
    await run("execute", "demo", "--dry-run");

    const out = stdout();
    expect(out).toContain("KR1");
    expect(out).toContain("demo");
    expect(out).toContain("/api/anchor/v1.1/pipelines/demo/execute");
    expect(out).not.toContain("test-appkey");
    expect(out).not.toContain("test-token");
    expect(resolvePipelineAppKey).toHaveBeenCalledWith("default");
    expect(issuePipelineToken).not.toHaveBeenCalled();
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("--dry-run --json 은 dry_run 과 pipelineName 을 담는다", async () => {
    await run("execute", "demo", "--dry-run", "--json");

    const parsed = JSON.parse(stdout());
    expect(parsed.dry_run).toBe(true);
    expect(parsed.requests[0]).toMatchObject({ method: "POST", region: "KR1", pipelineName: "demo" });
    expect(stdout()).not.toContain("test-appkey");
  });

  it("지원하지 않는 region 은 appkey 해석과 토큰 발급 전에 거부한다", async () => {
    await expect(run("execute", "demo", "--yes", "--region", "kr2")).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR,
      message: expect.stringContaining("kr2"),
    });

    expect(resolvePipelineAppKey).not.toHaveBeenCalled();
    expect(issuePipelineToken).not.toHaveBeenCalled();
  });

  it("공공망 profile 은 kr3 를 거부한다", async () => {
    vi.mocked(resolvePipelineProfile).mockResolvedValue({ profileName: "default", environment: "gov" });

    await expect(run("execute", "demo", "--yes", "--region", "kr3")).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR,
      message: expect.stringContaining("kr1"),
    });

    expect(issuePipelineToken).not.toHaveBeenCalled();
  });

  it("appkey 가 없으면 설정 오류로 끝나고 토큰을 발급하지 않는다", async () => {
    vi.mocked(resolvePipelineAppKey).mockRejectedValue(new NhnCloudCliError("appkey 없음", EXIT_CONFIG_ERROR));

    await expect(run("execute", "demo", "--yes")).rejects.toMatchObject({ exitCode: EXIT_CONFIG_ERROR });

    expect(issuePipelineToken).not.toHaveBeenCalled();
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("UAK 가 없으면 진행 표시를 시작하지 않고 설정 오류로 끝난다", async () => {
    vi.mocked(resolvePipelineUak).mockRejectedValue(new NhnCloudCliError("UAK 없음", EXIT_CONFIG_ERROR));

    await expect(run("execute", "demo", "--yes")).rejects.toMatchObject({ exitCode: EXIT_CONFIG_ERROR });

    expect(startSpinner).not.toHaveBeenCalled();
    expect(issuePipelineToken).not.toHaveBeenCalled();
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("--app-key 옵션은 없다", async () => {
    await expect(run("execute", "demo", "--yes", "--app-key", "x")).rejects.toMatchObject({
      message: expect.stringContaining("--app-key"),
    });

    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("--yes 는 기본 출력에 이름·region·실행 ID 표를 쓴다", async () => {
    await run("execute", "demo", "--yes");

    const out = stdout();
    expect(out).toContain("demo");
    expect(out).toContain("kr1");
    expect(out).toContain("executionId");
    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledWith("demo");
    expect(issuePipelineToken).toHaveBeenCalledWith("default", "real", { id: "<uak-id>", secret: "<uak-secret>" });
  });

  it("--json 은 응답 body 를 그대로 쓴다", async () => {
    await run("execute", "demo", "--yes", "--json");

    expect(JSON.parse(stdout())).toEqual(body);
  });

  it("--quiet 는 실행 ID 한 줄만 쓴다", async () => {
    await run("execute", "demo", "--yes", "--quiet");

    expect(stdout()).toBe("executionId\n");
  });

  it("API 오류는 같은 종료 코드로 전파되고 stdout 은 비어 있다", async () => {
    executeSpy.mockRejectedValue(new NhnCloudCliError("실패", EXIT_API_ERROR));

    await expect(run("execute", "demo", "--yes")).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });

    expect(stdout()).toBe("");
  });
});
