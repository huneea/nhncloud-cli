import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { SkmClient } from "../../services/skm/client.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR, EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { configureCommanderExitCodes } from "../commander-errors.js";
import { resolveSkmClient } from "./helpers.js";
import { processStdin } from "./input.js";
import { keyCommand } from "./key.js";
import { secretCommand } from "./secret.js";

vi.mock("./helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./helpers.js")>();
  return { ...actual, resolveSkmClient: vi.fn() };
});
vi.mock("../../utils/spinner.js", () => ({ startSpinner: vi.fn(), stopSpinner: vi.fn() }));

const client = new SkmClient("token", "real", "appkey");
const getKeyStore = vi.spyOn(client, "getKeyStore");
const createSecret = vi.spyOn(client, "createSecret");
const createSymmetricKey = vi.spyOn(client, "createSymmetricKey");
const createAsymmetricKey = vi.spyOn(client, "createAsymmetricKey");
const updateSecret = vi.spyOn(client, "updateSecret");
const scheduleKeyDeletion = vi.spyOn(client, "scheduleKeyDeletion");
const deleteKeyNow = vi.spyOn(client, "deleteKeyNow");

const RETURNED_SECRET = "returned-secret-value";

function program(): Command {
  const root = new Command("nhncloud")
    .exitOverride()
    .option("--json")
    .option("--quiet")
    .addCommand(keyCommand)
    .addCommand(secretCommand);
  configureCommanderExitCodes(root);
  return root;
}

async function run(...args: string[]): Promise<void> {
  await program().parseAsync(["node", "nhncloud", ...args]);
}

describe("skm 키 쓰기 명령", () => {
  let stdoutWrite: MockInstance<typeof process.stdout.write>;
  const stdout = (): string => stdoutWrite.mock.calls.map((call) => String(call[0])).join("");

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.mocked(resolveSkmClient).mockResolvedValue({ client, profileName: "default" });
    getKeyStore.mockResolvedValue({
      keyStoreId: 3, name: "store-name", ip4AuthUse: "N", macAuthUse: "N", certificateAuthUse: "N",
    });
    createSecret.mockResolvedValue({ keyId: "new-key", keyStatus: "ENABLED" });
    createSymmetricKey.mockResolvedValue({ keyId: "new-key", keyStatus: "ENABLED" });
    createAsymmetricKey.mockResolvedValue({ keyId: "new-key", keyStatus: "ENABLED" });
    updateSecret.mockResolvedValue({ keyId: "k1", name: "app", secretValue: RETURNED_SECRET });
    scheduleKeyDeletion.mockResolvedValue({ keyId: "k1", deletionDateTime: "2026-10-09T00:00:00" });
    deleteKeyNow.mockResolvedValue({ keyId: "k1", deletionDateTime: "2026-10-02T00:00:00" });
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
  });

  it("key create --type secret은 키 저장소 이름으로 끝 줄바꿈을 지우지 않은 값을 보낸다", async () => {
    await run("--quiet", "key", "create", "3", "--type", "secret", "--name", "app", "--value", "pw\n");
    expect(getKeyStore).toHaveBeenCalledWith(3);
    expect(createSecret).toHaveBeenCalledWith("store-name", "app", undefined, "pw\n");
    expect(stdout()).toBe("new-key\n");
  });

  it("key create --json은 keyId, keyStatus, keyStoreId, name을 출력한다", async () => {
    await run("--json", "key", "create", "3", "--type", "secret", "--name", " app ", "--value", "pw");
    expect(JSON.parse(stdout())).toEqual({ keyId: "new-key", keyStatus: "ENABLED", keyStoreId: 3, name: "app" });
  });

  it("key create --type symmetric-key는 대칭키 생성만 부른다", async () => {
    await run("key", "create", "3", "--type", "symmetric-key", "--name", "k", "--description", "  ");
    expect(createSymmetricKey).toHaveBeenCalledWith("store-name", "k", undefined);
    expect(createSecret).not.toHaveBeenCalled();
    expect(createAsymmetricKey).not.toHaveBeenCalled();
  });

  it("key create --type asymmetric-key는 trim한 설명으로 비대칭키를 만든다", async () => {
    await run("key", "create", "3", "--type", "asymmetric-key", "--name", "k", "--description", " d ");
    expect(createAsymmetricKey).toHaveBeenCalledWith("store-name", "k", "d");
  });

  it("key create는 secret이 아닌 종류의 --value를 client 해석 전에 거부한다", async () => {
    await expect(run("key", "create", "3", "--type", "asymmetric-key", "--name", "k", "--value", "x"))
      .rejects.toMatchObject({ message: "--value와 --file은 --type secret에서만 씁니다.", exitCode: EXIT_PARAM_ERROR });
    expect(resolveSkmClient).not.toHaveBeenCalled();
  });

  it("key create --type secret은 값이 없고 stdin이 TTY면 client 해석 전에 거부한다", async () => {
    const isTTY = vi.spyOn(processStdin, "isTTY", "get").mockReturnValue(true);
    try {
      await expect(run("key", "create", "3", "--type", "secret", "--name", "app"))
        .rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
      expect(resolveSkmClient).not.toHaveBeenCalled();
    } finally {
      isTTY.mockRestore();
    }
  });

  it("key create는 --type 누락을 EXIT_PARAM_ERROR로 끝낸다", async () => {
    const stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await expect(run("key", "create", "3", "--name", "app"))
        .rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
      expect(resolveSkmClient).not.toHaveBeenCalled();
    } finally {
      stderrWrite.mockRestore();
    }
  });

  it("key create는 키 저장소 조회가 실패하면 생성 요청을 보내지 않는다", async () => {
    getKeyStore.mockRejectedValue(new NhnCloudCliError("키 저장소 없음", EXIT_API_ERROR));
    await expect(run("key", "create", "3", "--type", "secret", "--name", "app", "--value", "pw"))
      .rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
    expect(createSecret).not.toHaveBeenCalled();
    expect(stdout()).toBe("");
  });

  it("key delete는 --yes가 없으면 client 해석 전에 EXIT_PARAM_ERROR로 끝낸다", async () => {
    await expect(run("key", "delete", "k1")).rejects.toMatchObject({
      message: expect.stringContaining("--yes"),
      exitCode: EXIT_PARAM_ERROR,
    });
    expect(resolveSkmClient).not.toHaveBeenCalled();
    expect(scheduleKeyDeletion).not.toHaveBeenCalled();
  });

  it("key delete --yes는 삭제를 예약하고 operation을 key-delete-scheduled로 출력한다", async () => {
    await run("--json", "key", "delete", "k1", "--yes");
    expect(scheduleKeyDeletion).toHaveBeenCalledWith("k1");
    expect(deleteKeyNow).not.toHaveBeenCalled();
    expect(JSON.parse(stdout())).toEqual({
      operation: "key-delete-scheduled", status: "succeeded", keyId: "k1", deletionDateTime: "2026-10-09T00:00:00",
    });
  });

  it("key purge는 --yes가 없으면 client 해석 전에 EXIT_PARAM_ERROR로 끝낸다", async () => {
    await expect(run("key", "purge", "k1")).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(resolveSkmClient).not.toHaveBeenCalled();
  });

  it("key purge --yes는 즉시 삭제만 부르고 --quiet으로 keyId를 쓴다", async () => {
    await run("--quiet", "key", "purge", "k1", "--yes");
    expect(deleteKeyNow).toHaveBeenCalledWith("k1");
    expect(scheduleKeyDeletion).not.toHaveBeenCalled();
    expect(stdout()).toBe("k1\n");
  });

  it.each([
    { format: "table", flags: [] },
    { format: "--json", flags: ["--json"] },
    { format: "--quiet", flags: ["--quiet"] },
  ])("secret update $format 출력에 응답의 기밀 데이터 값이 없다", async ({ flags }) => {
    await run(...flags, "secret", "update", "k1", "--value", "new");
    expect(updateSecret).toHaveBeenCalledWith("k1", "new");
    expect(stdout()).not.toContain("secretValue");
    expect(stdout()).not.toContain(RETURNED_SECRET);
  });

  it("secret update --json은 secretValue를 뺀 응답을 출력한다", async () => {
    await run("--json", "secret", "update", "k1", "--value", "new");
    expect(JSON.parse(stdout())).toEqual({ keyId: "k1", name: "app" });
  });
});
