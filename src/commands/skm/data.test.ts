import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { SkmClient } from "../../services/skm/client.js";
import { EXIT_API_ERROR, EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { configureCommanderExitCodes } from "../commander-errors.js";
import { asymmetricKeyCommand } from "./asymmetric-key.js";
import { resolveSkmClient } from "./helpers.js";
import { secretCommand } from "./secret.js";
import { symmetricKeyCommand } from "./symmetric-key.js";

vi.mock("./helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./helpers.js")>();
  return { ...actual, resolveSkmClient: vi.fn() };
});
vi.mock("../../utils/spinner.js", () => ({ startSpinner: vi.fn(), stopSpinner: vi.fn() }));

const client = new SkmClient("token", "real", "appkey");
const getSecret = vi.spyOn(client, "getSecret");
const encrypt = vi.spyOn(client, "encrypt");
const decrypt = vi.spyOn(client, "decrypt");
const createLocalKey = vi.spyOn(client, "createLocalKey");
const sign = vi.spyOn(client, "sign");
const signStandard = vi.spyOn(client, "signStandard");
const verify = vi.spyOn(client, "verify");
const verifyStandard = vi.spyOn(client, "verifyStandard");
const getPrivateKey = vi.spyOn(client, "getPrivateKey");
const getPublicKey = vi.spyOn(client, "getPublicKey");

const keyMaterial = {
  keyType: "RSA", key: "raw-key", encodedKey: "encoded-key",
  standardEncodedKey: "-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----", keyVersion: 2,
};

function program(): Command {
  const root = new Command("nhncloud")
    .exitOverride()
    .option("--json")
    .option("--quiet")
    .addCommand(secretCommand)
    .addCommand(symmetricKeyCommand)
    .addCommand(asymmetricKeyCommand);
  configureCommanderExitCodes(root);
  return root;
}

async function run(...args: string[]): Promise<void> {
  await program().parseAsync(["node", "nhncloud", ...args]);
}

describe("skm 데이터 명령", () => {
  let stdoutWrite: MockInstance<typeof process.stdout.write>;
  const stdout = (): string => stdoutWrite.mock.calls.map((call) => String(call[0])).join("");

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.mocked(resolveSkmClient).mockResolvedValue({ client, profileName: "default" });
    getSecret.mockResolvedValue("line1\nline2\u001b[31m");
    encrypt.mockResolvedValue({ ciphertext: "c1", keyVersion: 1 });
    decrypt.mockResolvedValue({ plaintext: "p1", keyVersion: 1 });
    createLocalKey.mockResolvedValue({ localKeyPlaintext: "lk-plain", localKeyCiphertext: "lk-cipher", keyVersion: 1 });
    sign.mockResolvedValue({ signature: "sig", keyVersion: 1 });
    signStandard.mockResolvedValue({
      signature: "sig", keyVersion: 1, algorithm: "RSASSA-PSS", hashAlgorithm: "SHA-256",
      mgfAlgorithm: "MGF1", saltLength: 32,
    });
    verify.mockResolvedValue({ result: true, keyVersion: 1 });
    verifyStandard.mockResolvedValue({ result: true, keyVersion: 0 });
    getPrivateKey.mockResolvedValue(keyMaterial);
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
  });

  it("secret get --quiet은 기밀 데이터 원문과 개행만 stdout에 쓴다", async () => {
    await run("--quiet", "secret", "get", "k1");
    expect(getSecret).toHaveBeenCalledWith("k1");
    expect(stdout()).toBe("line1\nline2\u001b[31m\n");
  });

  it("secret get 기본 출력은 개행을 남기고 제어 문자를 ?로 바꾼다", async () => {
    await run("secret", "get", "k1");
    expect(stdout()).toBe("line1\nline2?[31m\n");
  });

  it("secret get --json은 secret 필드를 담은 JSON을 쓴다", async () => {
    await run("--json", "secret", "get", "k1");
    expect(JSON.parse(stdout())).toEqual({ secret: "line1\nline2\u001b[31m" });
  });

  it("symmetric-key encrypt는 평문 끝 줄바꿈을 지우지 않고 보낸다", async () => {
    await run("symmetric-key", "encrypt", "k1", "--plaintext", "a\n");
    expect(encrypt).toHaveBeenCalledWith("k1", "a\n");
    expect(stdout()).toBe("c1\n");
  });

  it("symmetric-key encrypt는 32768바이트를 넘는 평문을 client 해석 전에 거부한다", async () => {
    await expect(run("symmetric-key", "encrypt", "k1", "--plaintext", "a".repeat(32769)))
      .rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(resolveSkmClient).not.toHaveBeenCalled();
    expect(encrypt).not.toHaveBeenCalled();
  });

  it("symmetric-key decrypt는 암호문의 앞뒤 공백을 지우고 보낸다", async () => {
    await run("symmetric-key", "decrypt", "k1", "--ciphertext", "  abc=\n");
    expect(decrypt).toHaveBeenCalledWith("k1", "abc=");
    expect(stdout()).toBe("p1\n");
  });

  it("symmetric-key decrypt는 공백뿐인 암호문을 client 해석 전에 거부한다", async () => {
    await expect(run("symmetric-key", "decrypt", "k1", "--ciphertext", " \n"))
      .rejects.toMatchObject({ message: "복호화할 암호문이 비어 있습니다.", exitCode: EXIT_PARAM_ERROR });
    expect(resolveSkmClient).not.toHaveBeenCalled();
  });

  it("symmetric-key create-local-key --quiet은 평문 키와 암호화된 키를 한 줄씩 쓴다", async () => {
    await run("--quiet", "symmetric-key", "create-local-key", "k1");
    expect(createLocalKey).toHaveBeenCalledWith("k1");
    expect(stdout()).toBe("lk-plain\nlk-cipher\n");
  });

  it("asymmetric-key sign --standard는 입력 바이트를 base64로 보낸다", async () => {
    await run("asymmetric-key", "sign", "k1", "--standard", "--plaintext", "hi");
    expect(signStandard).toHaveBeenCalledWith("k1", "aGk=");
    expect(sign).not.toHaveBeenCalled();
    expect(stdout()).toBe("sig\n");
  });

  it("asymmetric-key sign은 245바이트를 넘는 일반 서명 입력을 거부한다", async () => {
    await expect(run("asymmetric-key", "sign", "k1", "--plaintext", "a".repeat(246)))
      .rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(sign).not.toHaveBeenCalled();
    expect(resolveSkmClient).not.toHaveBeenCalled();
  });

  it("asymmetric-key verify는 검증 실패를 출력한 뒤 EXIT_API_ERROR로 끝낸다", async () => {
    verify.mockResolvedValue({ result: false, keyVersion: 1 });
    await expect(run("asymmetric-key", "verify", "k1", "--plaintext", "x", "--signature", "s"))
      .rejects.toMatchObject({ message: "서명 검증에 실패했습니다.", exitCode: EXIT_API_ERROR });
    expect(verify).toHaveBeenCalledWith("k1", "x", "s");
    expect(stdout()).toBe("검증 실패 (keyVersion 1)\n");
  });

  it("asymmetric-key verify는 검증 성공이면 정상 종료한다", async () => {
    await expect(run("asymmetric-key", "verify", "k1", "--plaintext", "x", "--signature", "s")).resolves.toBeUndefined();
    expect(stdout()).toBe("검증 성공 (keyVersion 1)\n");
  });

  it("asymmetric-key verify --quiet은 검증 실패에도 stdout에 쓰지 않고 EXIT_API_ERROR로 끝낸다", async () => {
    verify.mockResolvedValue({ result: false, keyVersion: 1 });
    await expect(run("--quiet", "asymmetric-key", "verify", "k1", "--plaintext", "x", "--signature", "s"))
      .rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
    expect(stdout()).toBe("");
  });

  it("asymmetric-key verify --standard는 --key-version 없이 client 해석 전에 거부한다", async () => {
    await expect(run("asymmetric-key", "verify", "k1", "--plaintext", "x", "--signature", "s", "--standard"))
      .rejects.toMatchObject({ message: "--standard 검증에는 --key-version이 필요합니다.", exitCode: EXIT_PARAM_ERROR });
    expect(resolveSkmClient).not.toHaveBeenCalled();
  });

  it("asymmetric-key verify는 --standard 없는 --key-version을 client 해석 전에 거부한다", async () => {
    await expect(run("asymmetric-key", "verify", "k1", "--plaintext", "x", "--signature", "s", "--key-version", "0"))
      .rejects.toMatchObject({ message: "--key-version은 --standard와 함께 지정합니다.", exitCode: EXIT_PARAM_ERROR });
    expect(resolveSkmClient).not.toHaveBeenCalled();
  });

  it("asymmetric-key verify --standard는 base64 입력과 키 버전 0을 보낸다", async () => {
    await run("asymmetric-key", "verify", "k1", "--plaintext", "x", "--signature", "s", "--standard", "--key-version", "0");
    expect(verifyStandard).toHaveBeenCalledWith("k1", "eA==", "s", 0);
    expect(verify).not.toHaveBeenCalled();
  });

  it("asymmetric-key private-key --quiet은 지정 버전의 standardEncodedKey 원문을 쓴다", async () => {
    await run("--quiet", "asymmetric-key", "private-key", "k1", "--key-version", "2");
    expect(getPrivateKey).toHaveBeenCalledWith("k1", 2);
    expect(stdout()).toBe(`${keyMaterial.standardEncodedKey}\n`);
  });

  it("asymmetric-key public-key --quiet은 standardEncodedKey가 없는 일반망 응답이면 encodedKey를 쓴다", async () => {
    const { standardEncodedKey: _omitted, ...realKeyMaterial } = keyMaterial;
    getPublicKey.mockResolvedValueOnce(realKeyMaterial);
    await run("--quiet", "asymmetric-key", "public-key", "k1");
    expect(getPublicKey).toHaveBeenCalledWith("k1", undefined);
    expect(stdout()).toBe(`${keyMaterial.encodedKey}\n`);
  });
});
