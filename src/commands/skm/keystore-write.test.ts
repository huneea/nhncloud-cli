import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { SkmClient } from "../../services/skm/client.js";
import type { SkmKeyStore } from "../../services/skm/types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR, EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { configureCommanderExitCodes } from "../commander-errors.js";
import { resolveSkmClient } from "./helpers.js";
import { processStdin } from "./input.js";
import { keystoreCommand } from "./keystore.js";

vi.mock("./helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./helpers.js")>();
  return { ...actual, resolveSkmClient: vi.fn() };
});
vi.mock("../../utils/spinner.js", () => ({ startSpinner: vi.fn(), stopSpinner: vi.fn() }));

const client = new SkmClient("token", "real", "appkey");
const getKeyStore = vi.spyOn(client, "getKeyStore");
const createKeyStore = vi.spyOn(client, "createKeyStore");
const updateKeyStore = vi.spyOn(client, "updateKeyStore");
const deleteKeyStore = vi.spyOn(client, "deleteKeyStore");
const addAuth = vi.spyOn(client, "addAuth");
const addCertificate = vi.spyOn(client, "addCertificate");
const scheduleAuthDeletion = vi.spyOn(client, "scheduleAuthDeletion");
const deleteAuthNow = vi.spyOn(client, "deleteAuthNow");

const CERT_PASSWORD = "cert-password-value";

const CURRENT_STORE: SkmKeyStore = {
  keyStoreId: 5,
  name: "store-name",
  description: "current description",
  ip4AuthUse: "Y",
  macAuthUse: "N",
  certificateAuthUse: "N",
};

function program(): Command {
  const root = new Command("nhncloud")
    .exitOverride()
    .option("--json")
    .option("--quiet")
    .addCommand(keystoreCommand);
  configureCommanderExitCodes(root);
  return root;
}

async function run(...args: string[]): Promise<void> {
  await program().parseAsync(["node", "nhncloud", ...args]);
}

describe("skm 키 저장소 쓰기 명령", () => {
  let stdoutWrite: MockInstance<typeof process.stdout.write>;
  let stderrWrite: MockInstance<typeof process.stderr.write>;
  const stdout = (): string => stdoutWrite.mock.calls.map((call) => String(call[0])).join("");

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    // Commander 가 필수 옵션 누락을 stderr 에 쓴다.
    stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.mocked(resolveSkmClient).mockResolvedValue({ client, profileName: "default" });
    getKeyStore.mockResolvedValue(CURRENT_STORE);
    createKeyStore.mockResolvedValue({
      keyStoreId: 7, name: "s", ip4AuthUse: "Y", macAuthUse: "N", certificateAuthUse: "N", authMode: "AND",
    });
    updateKeyStore.mockResolvedValue(undefined);
    deleteKeyStore.mockResolvedValue(undefined);
    addAuth.mockResolvedValue({ value: null, description: null });
    addCertificate.mockResolvedValue({ name: "cert1", description: null });
    scheduleAuthDeletion.mockResolvedValue({ name: "cert1", deletionDateTime: "2026-10-09T00:00:00" });
    deleteAuthNow.mockResolvedValue({ name: "cert1", deletionDateTime: "2026-10-02T00:00:00" });
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
  });

  it("keystore create는 나열한 인증만 켜고 기본 and로 만들며 설명이 없으면 description을 보내지 않는다", async () => {
    await run("--quiet", "keystore", "create", "--name", "s", "--auth", "ipv4");
    expect(createKeyStore).toHaveBeenCalledWith({
      name: "s", ip4AuthUse: "Y", macAuthUse: "N", certificateAuthUse: "N", authMode: "AND",
    });
    expect(stdout()).toBe("7\n");
  });

  it("keystore create --json은 생성 응답을 출력한다", async () => {
    await run("--json", "keystore", "create", "--name", "s", "--auth", "ipv4", "--description", " d ");
    expect(createKeyStore).toHaveBeenCalledWith(expect.objectContaining({ description: "d" }));
    expect(JSON.parse(stdout())).toEqual({
      keyStoreId: 7, name: "s", ip4AuthUse: "Y", macAuthUse: "N", certificateAuthUse: "N", authMode: "AND",
    });
  });

  it("keystore update는 현재 값을 읽어 주지 않은 항목을 채운다", async () => {
    await run("--json", "keystore", "update", "5", "--auth-mode", "or", "--description", "d");
    expect(getKeyStore).toHaveBeenCalledWith(5);
    const expected = {
      name: "store-name", description: "d", ip4AuthUse: "Y", macAuthUse: "N", certificateAuthUse: "N", authMode: "OR",
    };
    expect(updateKeyStore).toHaveBeenCalledWith(5, expected);
    expect(JSON.parse(stdout())).toEqual({
      operation: "keystore-update", status: "succeeded", keyStoreId: 5, ...expected,
    });
  });

  it("keystore update는 --description이 없으면 현재 설명을 다시 보낸다", async () => {
    await run("keystore", "update", "5", "--auth-mode", "and", "--name", "n");
    expect(updateKeyStore).toHaveBeenCalledWith(5, expect.objectContaining({
      name: "n", description: "current description", authMode: "AND",
    }));
  });

  it("keystore update는 --auth-mode 누락을 조회 전에 EXIT_PARAM_ERROR로 끝낸다", async () => {
    await expect(run("keystore", "update", "5", "--name", "n")).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(getKeyStore).not.toHaveBeenCalled();
    expect(updateKeyStore).not.toHaveBeenCalled();
  });

  it("keystore update --auth는 현재 인증 값을 바꿔 보낸다", async () => {
    await run("keystore", "update", "5", "--auth-mode", "and", "--auth", "certificate");
    expect(updateKeyStore).toHaveBeenCalledWith(5, expect.objectContaining({
      ip4AuthUse: "N", macAuthUse: "N", certificateAuthUse: "Y",
    }));
  });

  it("keystore update는 인증이 모두 꺼지는 요청을 보내지 않는다", async () => {
    getKeyStore.mockResolvedValue({ ...CURRENT_STORE, ip4AuthUse: "N" });
    await expect(run("keystore", "update", "5", "--auth-mode", "and")).rejects.toMatchObject({
      message: "키 저장소 인증은 하나 이상 켜야 합니다.",
      exitCode: EXIT_PARAM_ERROR,
    });
    expect(updateKeyStore).not.toHaveBeenCalled();
  });

  it("keystore update는 현재 값 조회가 실패하면 수정 요청을 보내지 않는다", async () => {
    getKeyStore.mockRejectedValue(new NhnCloudCliError("키 저장소 없음", EXIT_API_ERROR));
    await expect(run("keystore", "update", "5", "--auth-mode", "and")).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
    expect(updateKeyStore).not.toHaveBeenCalled();
    expect(stdout()).toBe("");
  });

  it("keystore delete는 --yes가 없으면 client 해석 전에 EXIT_PARAM_ERROR로 끝낸다", async () => {
    await expect(run("keystore", "delete", "5")).rejects.toMatchObject({
      message: expect.stringContaining("--yes"),
      exitCode: EXIT_PARAM_ERROR,
    });
    expect(resolveSkmClient).not.toHaveBeenCalled();
    expect(deleteKeyStore).not.toHaveBeenCalled();
  });

  it("keystore delete --yes는 키 저장소를 삭제하고 operation을 keystore-delete로 출력한다", async () => {
    await run("--json", "keystore", "delete", "5", "--yes");
    expect(deleteKeyStore).toHaveBeenCalledWith(5);
    expect(JSON.parse(stdout())).toEqual({ operation: "keystore-delete", status: "succeeded", keyStoreId: 5 });
  });

  it("keystore auth add --type ipv4는 키 저장소 이름으로 IPv4를 추가하고 --quiet으로 값을 쓴다", async () => {
    await run("--quiet", "keystore", "auth", "add", "5", "10.0.0.1", "--type", "ipv4");
    expect(getKeyStore).toHaveBeenCalledWith(5);
    expect(addAuth).toHaveBeenCalledWith("ipv4", "store-name", "10.0.0.1", undefined);
    expect(stdout()).toBe("10.0.0.1\n");
  });

  it("keystore auth add --type mac은 소문자 MAC을 보낸다", async () => {
    await run("keystore", "auth", "add", "5", "AA:BB:CC:DD:EE:FF", "--type", "mac");
    expect(addAuth).toHaveBeenCalledWith("mac", "store-name", "aa:bb:cc:dd:ee:ff", undefined);
  });

  it("keystore auth add --type certificate는 비밀번호 끝 줄바꿈 하나를 지우고 비밀번호를 출력하지 않는다", async () => {
    await run(
      "--json", "keystore", "auth", "add", "5", "cert1", "--type", "certificate",
      "--life-time", "365", "--password", `${CERT_PASSWORD}\n`,
    );
    expect(addCertificate).toHaveBeenCalledWith("store-name", "cert1", CERT_PASSWORD, 365, undefined);
    expect(addAuth).not.toHaveBeenCalled();
    expect(stdout()).not.toContain(CERT_PASSWORD);
    expect(JSON.parse(stdout())).toMatchObject({ operation: "auth-add", type: "certificate", keyStoreId: 5 });
  });

  it("keystore auth add는 응답에 덧붙은 비밀번호 필드도 출력하지 않는다", async () => {
    const echoed = { name: "cert1", password: CERT_PASSWORD };
    addCertificate.mockResolvedValue(echoed);
    await run(
      "--json", "keystore", "auth", "add", "5", "cert1", "--type", "certificate",
      "--life-time", "1", "--password", CERT_PASSWORD,
    );
    expect(stdout()).not.toContain(CERT_PASSWORD);
  });

  it("keystore auth add --type certificate는 --life-time이 없으면 client 해석 전에 거부한다", async () => {
    await expect(run("keystore", "auth", "add", "5", "cert1", "--type", "certificate", "--password", "pw"))
      .rejects.toMatchObject({ message: "인증서 추가에는 --life-time이 필요합니다.", exitCode: EXIT_PARAM_ERROR });
    expect(resolveSkmClient).not.toHaveBeenCalled();
  });

  it("keystore auth add --type ipv4는 인증서 전용 옵션을 stdin을 읽지 않고 거부한다", async () => {
    const read = vi.spyOn(processStdin, "read");
    try {
      await expect(run("keystore", "auth", "add", "5", "10.0.0.1", "--type", "ipv4", "--life-time", "1"))
        .rejects.toMatchObject({
          message: "--life-time과 --password는 --type certificate에서만 씁니다.",
          exitCode: EXIT_PARAM_ERROR,
        });
      expect(read).not.toHaveBeenCalled();
      expect(resolveSkmClient).not.toHaveBeenCalled();
    } finally {
      read.mockRestore();
    }
  });

  it("keystore auth add는 IPv4 형식이 아닌 값을 client 해석 전에 거부한다", async () => {
    await expect(run("keystore", "auth", "add", "5", "999.0.0.1", "--type", "ipv4"))
      .rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(resolveSkmClient).not.toHaveBeenCalled();
  });

  it("keystore auth add --type certificate는 비밀번호가 없고 stdin이 TTY면 client 해석 전에 거부한다", async () => {
    const isTTY = vi.spyOn(processStdin, "isTTY", "get").mockReturnValue(true);
    try {
      await expect(run("keystore", "auth", "add", "5", "cert1", "--type", "certificate", "--life-time", "1"))
        .rejects.toMatchObject({ message: expect.stringContaining("--password-file"), exitCode: EXIT_PARAM_ERROR });
      expect(resolveSkmClient).not.toHaveBeenCalled();
    } finally {
      isTTY.mockRestore();
    }
  });

  it("keystore auth add는 줄바꿈만 있는 비밀번호를 비었다고 거부한다", async () => {
    await expect(run(
      "keystore", "auth", "add", "5", "cert1", "--type", "certificate", "--life-time", "1", "--password", "\r\n",
    )).rejects.toMatchObject({ message: "인증서 비밀번호가 비어 있습니다.", exitCode: EXIT_PARAM_ERROR });
    expect(resolveSkmClient).not.toHaveBeenCalled();
  });

  it("keystore auth delete --yes는 인증서 삭제를 예약한다", async () => {
    await run("--json", "keystore", "auth", "delete", "5", "cert1", "--type", "certificate", "--yes");
    expect(scheduleAuthDeletion).toHaveBeenCalledWith("certificate", "store-name", "cert1");
    expect(deleteAuthNow).not.toHaveBeenCalled();
    expect(JSON.parse(stdout())).toEqual({
      operation: "auth-delete-scheduled", type: "certificate", keyStoreId: 5,
      name: "cert1", deletionDateTime: "2026-10-09T00:00:00",
    });
  });

  it("keystore auth purge --yes는 즉시 삭제만 부르고 --quiet으로 값을 쓴다", async () => {
    await run("--quiet", "keystore", "auth", "purge", "5", "cert1", "--type", "certificate", "--yes");
    expect(deleteAuthNow).toHaveBeenCalledWith("certificate", "store-name", "cert1");
    expect(scheduleAuthDeletion).not.toHaveBeenCalled();
    expect(stdout()).toBe("cert1\n");
  });

  it.each(["delete", "purge"])("keystore auth %s는 --yes가 없으면 client 해석 전에 EXIT_PARAM_ERROR로 끝낸다", async (sub) => {
    await expect(run("keystore", "auth", sub, "5", "cert1", "--type", "certificate"))
      .rejects.toMatchObject({ message: expect.stringContaining("--yes"), exitCode: EXIT_PARAM_ERROR });
    expect(resolveSkmClient).not.toHaveBeenCalled();
    expect(scheduleAuthDeletion).not.toHaveBeenCalled();
    expect(deleteAuthNow).not.toHaveBeenCalled();
  });
});
