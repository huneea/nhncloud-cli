import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAccessToken } from "../../api/oauth.js";
import { getProfileEnvironment, getUserAccessKey, resolveProfileName } from "../../config/credentials.js";
import { SkmClient } from "../../services/skm/client.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_CONFIG_ERROR, EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { resolveServiceAppKey } from "../service-appkey.js";
import {
  formatCell,
  maskAuthDetail,
  parseAuthTypeOption,
  parseKeyNameOption,
  parseKeyStatusOption,
  parseKeyStoreId,
  parseKeyTypeOption,
  parseMacAddressOption,
  resolveKeyStoreName,
  resolveSkmClient,
} from "./helpers.js";

vi.mock("../../config/credentials.js", () => ({
  resolveProfileName: vi.fn(),
  getUserAccessKey: vi.fn(),
  getProfileEnvironment: vi.fn(),
}));
vi.mock("../../api/oauth.js", () => ({ getAccessToken: vi.fn() }));
vi.mock("../service-appkey.js", () => ({ resolveServiceAppKey: vi.fn() }));
vi.mock("../../services/skm/client.js", () => ({ SkmClient: vi.fn() }));

function paramError(fn: () => unknown): void {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(NhnCloudCliError);
    expect((err as NhnCloudCliError).exitCode).toBe(EXIT_PARAM_ERROR);
    return;
  }
  throw new Error("EXIT_PARAM_ERROR 오류가 던져지지 않았다");
}

describe("skm helpers 파서", () => {
  it("MAC 주소는 콜론 형식만 받고 소문자로 바꾼다", () => {
    expect(parseMacAddressOption("aa:bb:cc:dd:ee:ff")).toBe("aa:bb:cc:dd:ee:ff");
    expect(parseMacAddressOption("AA:BB:CC:DD:EE:FF")).toBe("aa:bb:cc:dd:ee:ff");
    expect(parseMacAddressOption(undefined)).toBeUndefined();
    for (const bad of ["AA-BB-CC-DD-EE-FF", "aa:bb-cc:dd:ee:ff", "aabbccddeeff", ""]) {
      paramError(() => parseMacAddressOption(bad));
    }
  });

  it("keystore-id는 0 이상의 정수만 받는다", () => {
    expect(parseKeyStoreId("1")).toBe(1);
    paramError(() => parseKeyStoreId("-1"));
    paramError(() => parseKeyStoreId("a"));
  });

  it("키 종류, 상태, 인증 종류를 해석한다", () => {
    expect(parseKeyTypeOption("symmetric-key")).toBe("SYMMETRIC_KEY");
    expect(parseKeyTypeOption(undefined)).toBeUndefined();
    paramError(() => parseKeyTypeOption("unknown"));
    paramError(() => parseKeyTypeOption("toString"));
    expect(parseKeyStatusOption("inactive")).toBe("inactive");
    paramError(() => parseKeyStatusOption("all"));
    expect(parseAuthTypeOption("certificate")).toBe("certificate");
    paramError(() => parseAuthTypeOption("ip"));
  });

  it("키 이름은 trim 후 1자 이상 100자 이하여야 한다", () => {
    expect(parseKeyNameOption(" abc ")).toBe("abc");
    expect(parseKeyNameOption("a".repeat(100))).toBe("a".repeat(100));
    paramError(() => parseKeyNameOption("   "));
    paramError(() => parseKeyNameOption("a".repeat(101)));
  });
});

describe("maskAuthDetail", () => {
  it("password를 가린 사본을 돌려주고 원본은 바꾸지 않는다", () => {
    const original = { name: "c", password: "p" };
    const masked = maskAuthDetail(original);
    expect(masked.password).toBe("***");
    expect(original.password).toBe("p");
  });

  it("password가 없거나 null이면 그대로다", () => {
    const withoutPassword = { name: "c" };
    expect(maskAuthDetail(withoutPassword)).toEqual({ name: "c" });
    expect(maskAuthDetail({ name: "c", password: null })).toEqual({ name: "c", password: null });
  });
});

describe("formatCell", () => {
  it("null과 undefined는 -, 나머지는 문자열로 바꾼다", () => {
    expect(formatCell(null)).toBe("-");
    expect(formatCell(undefined)).toBe("-");
    expect(formatCell(3)).toBe("3");
    expect(formatCell(false)).toBe("false");
  });
});

describe("resolveSkmClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveProfileName).mockResolvedValue("default");
    vi.mocked(getUserAccessKey).mockResolvedValue({ id: "uak-id", secret: "uak-secret" });
    vi.mocked(getProfileEnvironment).mockResolvedValue("gov");
    vi.mocked(getAccessToken).mockResolvedValue("token");
  });

  it("appkey가 없으면 토큰을 발급하지 않고 EXIT_CONFIG_ERROR로 끝난다", async () => {
    vi.mocked(resolveServiceAppKey).mockRejectedValue(new NhnCloudCliError("appkey 없음", EXIT_CONFIG_ERROR));
    await expect(resolveSkmClient({})).rejects.toMatchObject({ exitCode: EXIT_CONFIG_ERROR });
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("환경과 MAC 주소를 담아 SkmClient를 만든다", async () => {
    vi.mocked(resolveServiceAppKey).mockResolvedValue("appkey");
    const { profileName } = await resolveSkmClient({ macAddress: "aa:bb:cc:dd:ee:ff" });
    expect(profileName).toBe("default");
    expect(SkmClient).toHaveBeenCalledWith("token", "gov", "appkey", "aa:bb:cc:dd:ee:ff");
  });
});

describe("resolveKeyStoreName", () => {
  // SkmClient 는 이 파일에서 vi.fn() 생성자로 mock 되어 있어 인스턴스에 메서드가 없다.
  function keyStoreClient(): SkmClient {
    const client = new SkmClient("token", "real", "appkey");
    client.getKeyStore = vi.fn();
    return client;
  }

  it("키 저장소 상세 조회 응답의 name을 돌려준다", async () => {
    const client = keyStoreClient();
    vi.mocked(client.getKeyStore).mockResolvedValue({
      keyStoreId: 3, name: "store-name", ip4AuthUse: "N", macAuthUse: "N", certificateAuthUse: "N",
    });
    await expect(resolveKeyStoreName(client, 3)).resolves.toBe("store-name");
    expect(client.getKeyStore).toHaveBeenCalledWith(3);
  });

  it("상세 조회가 실패하면 같은 오류로 reject한다", async () => {
    const failure = new NhnCloudCliError("키 저장소 없음", EXIT_PARAM_ERROR);
    const client = keyStoreClient();
    vi.mocked(client.getKeyStore).mockRejectedValue(failure);
    await expect(resolveKeyStoreName(client, 3)).rejects.toBe(failure);
  });
});
