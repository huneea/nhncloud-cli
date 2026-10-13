import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { SkmClient } from "../../services/skm/client.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR, EXIT_AUTH_ERROR, EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { configureCommanderExitCodes } from "../commander-errors.js";
import { resolveSkmClient } from "./helpers.js";
import { processStdin } from "../input-source.js";
import { secretCommand } from "./secret.js";

vi.mock("./helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./helpers.js")>();
  return { ...actual, resolveSkmClient: vi.fn() };
});
vi.mock("../../utils/spinner.js", () => ({ startSpinner: vi.fn(), stopSpinner: vi.fn() }));

const client = new SkmClient("token", "real", "appkey");
const getSecret = vi.spyOn(client, "getSecret");
const updateSecret = vi.spyOn(client, "updateSecret");

const CURRENT = '{"db":"old","port":5432}';
const RETURNED_SECRET = "returned-secret-value";

function program(): Command {
  const root = new Command("nhncloud").exitOverride().option("--json").option("--quiet").addCommand(secretCommand);
  configureCommanderExitCodes(root);
  return root;
}

async function run(...args: string[]): Promise<void> {
  await program().parseAsync(["node", "nhncloud", ...args]);
}

async function runError(...args: string[]): Promise<NhnCloudCliError> {
  try {
    await run(...args);
  } catch (e) {
    return e as NhnCloudCliError;
  }
  throw new Error(`명령이 실패해야 하는데 성공했다: ${args.join(" ")}`);
}

describe("skm secret patch", () => {
  let stdoutWrite: MockInstance<typeof process.stdout.write>;
  let stderrWrite: MockInstance<typeof process.stderr.write>;
  let stdinRead: MockInstance<() => Buffer>;
  let stdinIsTTY: MockInstance;
  const stdout = (): string => stdoutWrite.mock.calls.map((call) => String(call[0])).join("");
  const stderr = (): string => stderrWrite.mock.calls.map((call) => String(call[0])).join("");
  const stdinValue = (value: string): void => {
    stdinRead.mockReturnValue(Buffer.from(value));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    stdinIsTTY = vi.spyOn(processStdin, "isTTY", "get").mockReturnValue(false);
    stdinRead = vi.spyOn(processStdin, "read").mockReturnValue(Buffer.from("new"));
    vi.mocked(resolveSkmClient).mockResolvedValue({ client, profileName: "default" });
    getSecret.mockReset();
    getSecret.mockResolvedValueOnce(CURRENT);
    updateSecret.mockResolvedValue({ keyId: "k1", name: "app", secretValue: RETURNED_SECRET });
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
    stdinIsTTY.mockRestore();
    stdinRead.mockRestore();
  });

  it("--yes 없이는 쓰지 않고 판정만 출력하며 반영 방법을 안내한다", async () => {
    await run("--json", "secret", "patch", "k1", "db", "--replace");
    expect(updateSecret).not.toHaveBeenCalled();
    expect(JSON.parse(stdout())).toEqual({
      keyId: "k1", field: "db", action: "replaced", applied: false, fieldVerified: null, othersVerified: null,
    });
    expect(stderr()).toContain("--yes를 붙이세요");
  });

  it("값이 다른 기존 필드에 --replace가 없으면 미리보기에서도 매개변수 오류다", async () => {
    const error = await runError("secret", "patch", "k1", "db");
    expect(error).toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(updateSecret).not.toHaveBeenCalled();
  });

  it("--yes면 다시 쓴 전체 값을 보내고 다시 조회해 대조한 결과를 낸다", async () => {
    getSecret.mockResolvedValueOnce('{"db":"new","port":5432}');
    await run("--json", "secret", "patch", "k1", "db", "--replace", "--yes");
    expect(updateSecret).toHaveBeenCalledWith("k1", '{"db":"new","port":5432}');
    expect(JSON.parse(stdout())).toEqual({
      keyId: "k1", field: "db", action: "replaced", applied: true, fieldVerified: true, othersVerified: true,
    });
    for (const leaked of ["new", "old", "sha", RETURNED_SECRET]) {
      expect(stdout()).not.toContain(leaked);
    }
  });

  it("없는 필드는 --yes로 더하고 종료 코드 0으로 끝난다", async () => {
    getSecret.mockResolvedValueOnce('{"db":"old","port":5432,"newkey":"new"}');
    await run("--json", "secret", "patch", "k1", "newkey", "--yes");
    expect(updateSecret).toHaveBeenCalledWith("k1", '{"db":"old","port":5432,"newkey":"new"}');
    expect(JSON.parse(stdout())).toMatchObject({ action: "added", applied: true });
  });

  it("같은 값이면 --yes를 줘도 쓰지 않는다", async () => {
    stdinValue("old");
    await run("--json", "secret", "patch", "k1", "db", "--yes");
    expect(updateSecret).not.toHaveBeenCalled();
    expect(JSON.parse(stdout())).toMatchObject({ action: "unchanged", applied: false });
    expect(stderr()).not.toContain("--yes를 붙이세요");
  });

  it("--delete는 표준 입력을 읽지 않고 필드를 뺀 값을 보낸다", async () => {
    getSecret.mockResolvedValueOnce('{"port":5432}');
    await run("--json", "secret", "patch", "k1", "db", "--delete", "--yes");
    expect(stdinRead).not.toHaveBeenCalled();
    expect(updateSecret).toHaveBeenCalledWith("k1", '{"port":5432}');
    expect(JSON.parse(stdout())).toMatchObject({ action: "deleted", applied: true, fieldVerified: true });
  });

  it("--delete와 --replace, --delete와 --file은 client 해석 전에 거부한다", async () => {
    expect(await runError("secret", "patch", "k1", "db", "--delete", "--replace")).toMatchObject({
      message: "--delete와 --replace는 함께 지정할 수 없습니다.", exitCode: EXIT_PARAM_ERROR,
    });
    expect(await runError("secret", "patch", "k1", "db", "--delete", "--file", "x")).toMatchObject({
      message: "--delete와 --file은 함께 지정할 수 없습니다.", exitCode: EXIT_PARAM_ERROR,
    });
    expect(resolveSkmClient).not.toHaveBeenCalled();
  });

  it("다시 조회한 필드 값이 다르면 결과를 낸 뒤 승인 기능 가능성을 안내하며 API 오류로 끝낸다", async () => {
    getSecret.mockResolvedValueOnce('{"db":"other","port":5432}');
    const error = await runError("--json", "secret", "patch", "k1", "db", "--replace", "--yes");
    expect(JSON.parse(stdout())).toMatchObject({ applied: true, fieldVerified: false, othersVerified: true });
    expect(error).toMatchObject({ exitCode: EXIT_API_ERROR });
    expect(error.message).toContain("승인 기능");
    expect(error.message).toContain('필드 "db"');
    expect(error.message).not.toContain("other");
  });

  it("다시 조회한 다른 필드가 바뀌면 othersVerified가 거짓이다", async () => {
    getSecret.mockResolvedValueOnce('{"db":"new","port":5433}');
    const error = await runError("--json", "secret", "patch", "k1", "db", "--replace", "--yes");
    expect(JSON.parse(stdout())).toMatchObject({ fieldVerified: true, othersVerified: false });
    expect(error).toMatchObject({ exitCode: EXIT_API_ERROR });
    expect(error.message).toContain("다른 필드");
  });

  it("다시 조회가 실패하면 반영은 했으나 검증하지 못했다고 알린다", async () => {
    getSecret.mockRejectedValueOnce(new NhnCloudCliError("API 호출 실패 (500): boom", EXIT_API_ERROR));
    const error = await runError("--json", "secret", "patch", "k1", "db", "--replace", "--yes");
    expect(JSON.parse(stdout())).toEqual({
      keyId: "k1", field: "db", action: "replaced", applied: true, fieldVerified: null, othersVerified: null,
    });
    expect(error).toMatchObject({ exitCode: EXIT_API_ERROR });
    expect(error.message).toContain("검증하지 못했습니다");
  });

  it("쓰기 요청이 실패하면 아무것도 출력하지 않고 원래 종료 코드로 재실행을 안내한다", async () => {
    updateSecret.mockRejectedValueOnce(new NhnCloudCliError("API 호출 실패 (403): denied", EXIT_AUTH_ERROR));
    const error = await runError("--json", "secret", "patch", "k1", "db", "--replace", "--yes");
    expect(stdout()).toBe("");
    expect(error).toMatchObject({ exitCode: EXIT_AUTH_ERROR });
    expect(error.message).toContain("--yes 없이 다시 실행");
  });

  it.each(["plain", '{"id":12345678901234567890}'])("현재 값 %s는 원문을 싣지 않고 거부한다", async (current) => {
    getSecret.mockReset();
    getSecret.mockResolvedValueOnce(current);
    const error = await runError("secret", "patch", "k1", "db", "--replace", "--yes");
    expect(error).toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(error.message).not.toContain(current);
    expect(error.message).not.toContain("12345678901234567890");
    expect(updateSecret).not.toHaveBeenCalled();
  });

  it("줄바꿈으로 끝나는 값은 경고하고 줄바꿈까지 값에 넣는다", async () => {
    await run("--json", "secret", "patch", "k1", "db", "--replace");
    expect(stderr()).not.toContain("줄바꿈으로 끝납니다");
    stdinValue("new\n");
    getSecret.mockResolvedValueOnce(CURRENT).mockResolvedValueOnce('{"db":"new\\n","port":5432}');
    await run("--json", "secret", "patch", "k1", "db", "--replace", "--yes");
    expect(stderr()).toContain("줄바꿈으로 끝납니다");
    expect(updateSecret).toHaveBeenCalledWith("k1", '{"db":"new\\n","port":5432}');
  });

  it("--quiet은 action만 출력한다", async () => {
    await run("--quiet", "secret", "patch", "k1", "db", "--replace");
    expect(stdout()).toBe("replaced\n");
  });
});
