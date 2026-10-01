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
  parseAuthListOption,
  parseAuthModeOption,
  parseAuthTypeOption,
  parseAuthValue,
  parseDescriptionOption,
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

function paramErrorMessage(fn: () => unknown, message: string): void {
  expect(fn).toThrow(expect.objectContaining({ message, exitCode: EXIT_PARAM_ERROR }));
}

describe("skm 키 저장소 쓰기 파서", () => {
  it("--auth는 나열한 인증만 Y로 바꾼다", () => {
    expect(parseAuthListOption("ipv4,mac")).toEqual({ ip4AuthUse: "Y", macAuthUse: "Y", certificateAuthUse: "N" });
    expect(parseAuthListOption("certificate")).toEqual({ ip4AuthUse: "N", macAuthUse: "N", certificateAuthUse: "Y" });
  });

  it("--auth는 빈 항목과 알 수 없는 값을 거부한다", () => {
    for (const bad of ["ipv4,", "", "ipv4,ip"]) {
      paramErrorMessage(
        () => parseAuthListOption(bad),
        `--auth는 ipv4, mac, certificate를 쉼표로 나열해야 합니다 (입력: ${JSON.stringify(bad)}).`,
      );
    }
  });

  it("--auth-mode는 대소문자 없이 and·or만 받는다", () => {
    expect(parseAuthModeOption("OR")).toBe("OR");
    expect(parseAuthModeOption("and")).toBe("AND");
    paramErrorMessage(() => parseAuthModeOption("xor"), '--auth-mode는 and 또는 or여야 합니다 (입력: "xor").');
  });

  it("--description은 trim하고 비면 undefined, 한도를 넘으면 거부한다", () => {
    expect(parseDescriptionOption(" d ", 1000)).toBe("d");
    expect(parseDescriptionOption("   ", 1000)).toBeUndefined();
    expect(parseDescriptionOption(undefined, 1000)).toBeUndefined();
    expect(parseDescriptionOption("a".repeat(1000), 1000)).toBe("a".repeat(1000));
    paramErrorMessage(() => parseDescriptionOption("a".repeat(1001), 1000), "--description은 1000자 이하여야 합니다.");
  });

  it("인증 정보 값은 종류별 형식을 검사한다", () => {
    expect(parseAuthValue("ipv4", "10.0.0.1")).toBe("10.0.0.1");
    expect(parseAuthValue("mac", "AA:BB:CC:DD:EE:FF")).toBe("aa:bb:cc:dd:ee:ff");
    expect(parseAuthValue("certificate", " cert1 ")).toBe("cert1");
    paramErrorMessage(() => parseAuthValue("ipv4", "999.0.0.1"), 'IPv4 주소 형식이 아닙니다 (입력: "999.0.0.1").');
    paramErrorMessage(
      () => parseAuthValue("mac", "AA-BB-CC-DD-EE-FF"),
      'MAC 주소는 aa:bb:cc:dd:ee:ff 형식이어야 합니다 (입력: "AA-BB-CC-DD-EE-FF").',
    );
    paramErrorMessage(() => parseAuthValue("certificate", "  "), "인증서 이름이 비어 있습니다.");
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
