import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { output } from "../../formatters/table.js";
import { SkmClient } from "../../services/skm/client.js";
import type { SkmKey, SkmKeyStore } from "../../services/skm/types.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { configureCommanderExitCodes } from "../commander-errors.js";
import { confirmCommand } from "./confirm.js";
import { resolveSkmClient } from "./helpers.js";
import { keyCommand } from "./key.js";
import { keystoreCommand } from "./keystore.js";

vi.mock("./helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./helpers.js")>();
  return { ...actual, resolveSkmClient: vi.fn() };
});
vi.mock("../../formatters/table.js", () => ({ output: vi.fn() }));
vi.mock("../../utils/spinner.js", () => ({ startSpinner: vi.fn(), stopSpinner: vi.fn() }));

const client = new SkmClient("token", "real", "appkey");
const confirm = vi.spyOn(client, "confirm");
const listKeyStores = vi.spyOn(client, "listKeyStores");
const listKeys = vi.spyOn(client, "listKeys");
const getAuth = vi.spyOn(client, "getAuth");

const store = (keyStoreId: number): SkmKeyStore => ({
  keyStoreId, name: `store-${keyStoreId}`, ip4AuthUse: "N", macAuthUse: "N", certificateAuthUse: "Y",
  lastChangeDatetime: "2026-01-01T00:00:00.000+09:00",
});

function program(): Command {
  const root = new Command("nhncloud")
    .exitOverride()
    .option("--json")
    .option("--quiet")
    .addCommand(confirmCommand)
    .addCommand(keystoreCommand)
    .addCommand(keyCommand);
  configureCommanderExitCodes(root);
  return root;
}

async function run(...args: string[]): Promise<void> {
  await program().parseAsync(["node", "nhncloud", ...args]);
}

describe("skm 조회 명령", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveSkmClient).mockResolvedValue({ client, profileName: "default" });
    confirm.mockResolvedValue({ clientIp: "192.0.2.1", clientMacHeader: null, clientSentCertificate: false });
    listKeyStores.mockResolvedValue([store(1), store(2)]);
    listKeys.mockResolvedValue([] as SkmKey[]);
  });

  it("keystore list는 키 저장소 ID 목록과 헤더를 출력한다", async () => {
    await run("keystore", "list");
    expect(output).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      headers: ["keyStoreId", "name", "ip4AuthUse", "macAuthUse", "certificateAuthUse", "lastChangeDatetime"],
      ids: ["1", "2"],
    }));
  });

  it("keystore auth get은 인증서 비밀번호를 rows와 raw 어디에도 내지 않는다", async () => {
    getAuth.mockResolvedValue([{ name: "cert1", password: "super-secret-pw", description: "d" }]);
    await run("keystore", "auth", "get", "1", "cert1", "--type", "certificate");
    expect(getAuth).toHaveBeenCalledWith(1, "certificate", "cert1");
    const payload = vi.mocked(output).mock.calls[0]?.[1] as { rows: string[][]; raw: Array<{ password?: string }>; ids: string[] };
    expect(payload.raw[0]?.password).toBe("***");
    expect(payload.rows[0]?.[0]).toBe("cert1");
    expect(payload.ids).toEqual(["cert1"]);
    expect(JSON.stringify(payload)).not.toContain("super-secret-pw");
  });

  it("key list의 잘못된 --type은 client 해석 전에 EXIT_PARAM_ERROR로 거부한다", async () => {
    await expect(run("key", "list", "1", "--type", "unknown")).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(resolveSkmClient).not.toHaveBeenCalled();
  });

  it("key list는 지정한 필터만 listKeys에 넘긴다", async () => {
    await run("key", "list", "1", "--type", "symmetric-key", "--status", "active");
    expect(listKeys).toHaveBeenCalledWith(1, { type: "SYMMETRIC_KEY", status: "active" });
  });

  it("confirm의 잘못된 --mac-address는 client 해석 전에 EXIT_PARAM_ERROR로 거부한다", async () => {
    await expect(run("confirm", "--mac-address", "bad")).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(resolveSkmClient).not.toHaveBeenCalled();
  });

  it("confirm은 정규화한 MAC 주소로 client를 해석한다", async () => {
    await run("confirm", "--mac-address", "AA:BB:CC:DD:EE:FF");
    expect(resolveSkmClient).toHaveBeenCalledWith(expect.objectContaining({ macAddress: "aa:bb:cc:dd:ee:ff" }));
  });

  it("keystore auth list는 --type이 없으면 EXIT_PARAM_ERROR로 거부한다", async () => {
    await expect(run("keystore", "auth", "list", "1")).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(resolveSkmClient).not.toHaveBeenCalled();
  });
});
