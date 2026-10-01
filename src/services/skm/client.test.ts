import { beforeEach, describe, expect, it, vi } from "vitest";
import ky, { HTTPError } from "ky";
import { SkmClient } from "./client.js";
import { NhnEnvelopeError } from "../../api/envelope.js";
import { EXIT_API_ERROR, EXIT_AUTH_ERROR } from "../../utils/exit-codes.js";

// HTTPError 를 실제 클래스로 유지해야 instanceof 분기를 검증할 수 있어 get·post 만 바꾼다.
vi.mock("ky", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ky")>();
  return { ...actual, default: { ...actual.default, get: vi.fn(), post: vi.fn() } };
});

const realBase = "https://api-keymanager.nhncloudservice.com/keymanager/v1.3/appkey/test-appkey";
const govBase = "https://api-keymanager.gov-nhncloudservice.com/keymanager/v1.3/appkey/test-appkey";
const successfulHeader = { isSuccessful: true, resultCode: 0, resultMessage: "success" };

function mockKyResponse(body: unknown) {
  return { json: async () => body } as never;
}

function envelope(body: unknown) {
  return mockKyResponse({ header: successfulHeader, body });
}

function key(keyId: string) {
  return { keyId, name: `name-${keyId}`, keyType: "SECRET", currentKeyValueVersion: 1 };
}

function keys(prefix: string, count: number) {
  return Array.from({ length: count }, (_, i) => key(`${prefix}-${i}`));
}

function getOptions(call: number) {
  return vi.mocked(ky.get).mock.calls[call]?.[1];
}

function postOptions(call: number) {
  return vi.mocked(ky.post).mock.calls[call]?.[1];
}

describe("SkmClient 요청 구성", () => {
  beforeEach(() => vi.clearAllMocks());

  it("일반망 profile 은 일반망 host 의 /confirm 으로 GET 한다", async () => {
    vi.mocked(ky.get).mockReturnValue(envelope({ clientIp: "192.0.2.1", clientSentCertificate: false }));
    await new SkmClient("token", "real", "test-appkey").confirm();
    expect(vi.mocked(ky.get).mock.calls[0]?.[0]).toBe(`${realBase}/confirm`);
    expect(getOptions(0)).toMatchObject({ retry: 0 });
  });

  it("공공망 profile 은 공공망 host 로 GET 한다", async () => {
    vi.mocked(ky.get).mockReturnValue(envelope({ clientIp: "192.0.2.1", clientSentCertificate: false }));
    await new SkmClient("token", "gov", "test-appkey").confirm();
    expect(vi.mocked(ky.get).mock.calls[0]?.[0]).toBe(`${govBase}/confirm`);
  });

  it("MAC 주소를 주면 X-TOAST-CLIENT-MAC-ADDR 헤더를 보낸다", async () => {
    vi.mocked(ky.get).mockReturnValue(envelope({ secret: "data" }));
    await new SkmClient("token", "real", "test-appkey", "aa:bb:cc:dd:ee:ff").getSecret("key-1");
    expect(getOptions(0)?.headers).toStrictEqual({
      "X-NHN-Authorization": "Bearer token",
      "X-TOAST-CLIENT-MAC-ADDR": "aa:bb:cc:dd:ee:ff",
    });
  });

  it("MAC 주소가 없으면 인증 헤더만 보낸다", async () => {
    vi.mocked(ky.get).mockReturnValue(envelope({ secret: "data" }));
    await new SkmClient("token", "real", "test-appkey").getSecret("key-1");
    expect(getOptions(0)?.headers).toStrictEqual({ "X-NHN-Authorization": "Bearer token" });
  });

  it("appkey 와 keyId 를 경로 인코딩한다", async () => {
    vi.mocked(ky.get).mockReturnValue(envelope({ secret: "data" }));
    await new SkmClient("token", "real", "app/key").getSecret("key/1");
    expect(vi.mocked(ky.get).mock.calls[0]?.[0]).toBe(
      "https://api-keymanager.nhncloudservice.com/keymanager/v1.3/appkey/app%2Fkey/secrets/key%2F1",
    );
  });

  it("confirm 응답에 clientMacHeader 가 없어도 반환한다", async () => {
    vi.mocked(ky.get).mockReturnValue(envelope({ clientIp: "192.0.2.1", clientSentCertificate: false }));
    await expect(new SkmClient("token", "real", "test-appkey").confirm()).resolves.toStrictEqual({
      clientIp: "192.0.2.1",
      clientSentCertificate: false,
    });
  });
});

describe("SkmClient.listKeys", () => {
  const client = new SkmClient("token", "real", "test-appkey");
  beforeEach(() => vi.clearAllMocks());

  it("100건 페이지 다음 3건 페이지에서 멈추고 103건을 반환한다", async () => {
    vi.mocked(ky.get)
      .mockReturnValueOnce(envelope({ keyList: keys("a", 100) }))
      .mockReturnValueOnce(envelope({ keyList: keys("b", 3) }));

    const result = await client.listKeys(1);

    expect(result).toHaveLength(103);
    expect(ky.get).toHaveBeenCalledTimes(2);
    expect(vi.mocked(ky.get).mock.calls[1]?.[0]).toBe(`${realBase}/keystores/1/keys`);
    expect(getOptions(0)?.searchParams).toStrictEqual({ detail: "true", pageNumber: 1, pageSize: 100 });
    expect(getOptions(1)?.searchParams).toStrictEqual({ detail: "true", pageNumber: 2, pageSize: 100 });
  });

  it("필터 값을 searchParams 에 싣는다", async () => {
    vi.mocked(ky.get).mockReturnValueOnce(envelope({ keyList: [] }));
    await expect(client.listKeys(1, { type: "SECRET", name: "db", status: "active" })).resolves.toStrictEqual([]);
    expect(getOptions(0)?.searchParams).toStrictEqual({
      detail: "true", pageNumber: 1, pageSize: 100, type: "SECRET", name: "db", status: "active",
    });
  });

  it("두 페이지가 같은 keyId 로 시작하면 EXIT_API_ERROR 로 끝낸다", async () => {
    vi.mocked(ky.get).mockReturnValue(envelope({ keyList: keys("a", 100) }));
    await expect(client.listKeys(1)).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
    expect(ky.get).toHaveBeenCalledTimes(2);
  });
});

describe("SkmClient 조회와 데이터 API", () => {
  const client = new SkmClient("token", "real", "test-appkey");
  beforeEach(() => vi.clearAllMocks());

  it("listKeyStores 는 detail=true 로 keyStoreList 를 반환한다", async () => {
    const store = { keyStoreId: 1, name: "store", ip4AuthUse: "Y", macAuthUse: "N", certificateAuthUse: "N" };
    vi.mocked(ky.get).mockReturnValue(envelope({ keyStoreList: [store] }));
    await expect(client.listKeyStores()).resolves.toStrictEqual([store]);
    expect(vi.mocked(ky.get).mock.calls[0]?.[0]).toBe(`${realBase}/keystores`);
    expect(getOptions(0)?.searchParams).toStrictEqual({ detail: "true" });
  });

  it("listAuths(mac) 는 /macs 의 macList 를 반환한다", async () => {
    vi.mocked(ky.get).mockReturnValue(envelope({ macList: ["aa:aa:aa:aa:aa:aa"] }));
    await expect(client.listAuths(1, "mac")).resolves.toStrictEqual(["aa:aa:aa:aa:aa:aa"]);
    expect(vi.mocked(ky.get).mock.calls[0]?.[0]).toBe(`${realBase}/keystores/1/macs`);
  });

  it("getAuth(certificate) 는 /certificates 에 value 를 실어 certificateList 를 반환한다", async () => {
    const detail = { name: "cert1", password: "<certificate-password>", deletionDatetime: null };
    vi.mocked(ky.get).mockReturnValue(envelope({ certificateList: [detail] }));
    await expect(client.getAuth(1, "certificate", "cert1")).resolves.toStrictEqual([detail]);
    expect(vi.mocked(ky.get).mock.calls[0]?.[0]).toBe(`${realBase}/keystores/1/certificates`);
    expect(getOptions(0)?.searchParams).toStrictEqual({ value: "cert1" });
  });

  it("getSecret 은 body.secret 을 반환한다", async () => {
    vi.mocked(ky.get).mockReturnValue(envelope({ secret: "data" }));
    await expect(client.getSecret("key-1")).resolves.toBe("data");
    expect(vi.mocked(ky.get).mock.calls[0]?.[0]).toBe(`${realBase}/secrets/key-1`);
  });

  it("encrypt 는 plaintext 를 본문에 담아 POST 한다", async () => {
    vi.mocked(ky.post).mockReturnValue(envelope({ ciphertext: "<ciphertext>", keyVersion: 1 }));
    await expect(client.encrypt("key-1", "data")).resolves.toStrictEqual({ ciphertext: "<ciphertext>", keyVersion: 1 });
    expect(vi.mocked(ky.post).mock.calls[0]?.[0]).toBe(`${realBase}/symmetric-keys/key-1/encrypt`);
    expect(postOptions(0)?.json).toStrictEqual({ plaintext: "data" });
  });

  it("createLocalKey 는 본문 없이 POST 한다", async () => {
    vi.mocked(ky.post).mockReturnValue(envelope({ localKeyPlaintext: "<p>", localKeyCiphertext: "<c>", keyVersion: 1 }));
    await client.createLocalKey("key-1");
    expect(vi.mocked(ky.post).mock.calls[0]?.[0]).toBe(`${realBase}/symmetric-keys/key-1/create-local-key`);
    expect(postOptions(0)?.json).toBeUndefined();
  });

  it("getSymmetricKey 는 keyVersion 이 있을 때만 searchParams 에 싣는다", async () => {
    vi.mocked(ky.get).mockReturnValue(envelope({ symmetricKey: "0x00", keyVersion: 2 }));
    await client.getSymmetricKey("key-1", 2);
    await client.getSymmetricKey("key-1");
    expect(vi.mocked(ky.get).mock.calls[0]?.[0]).toBe(`${realBase}/symmetric-keys/key-1/symmetric-key`);
    expect(getOptions(0)?.searchParams).toStrictEqual({ keyVersion: 2 });
    expect(getOptions(1)?.searchParams).toBeUndefined();
  });

  it("signStandard 는 RSASSA-PSS 알고리즘을 본문에 담는다", async () => {
    vi.mocked(ky.post).mockReturnValue(envelope({
      signature: "<signature>", algorithm: "RSASSA-PSS", hashAlgorithm: "SHA-256",
      mgfAlgorithm: "MGF1-SHA-256", saltLength: 32, keyVersion: 0,
    }));
    await client.signStandard("key-1", "ZGF0YQ==");
    expect(vi.mocked(ky.post).mock.calls[0]?.[0]).toBe(`${realBase}/asymmetric-keys/key-1/sign-standard`);
    expect(postOptions(0)?.json).toStrictEqual({ plaintext: "ZGF0YQ==", algorithm: "RSASSA-PSS" });
  });

  it("verifyStandard 는 RSASSA-PSS 알고리즘과 keyVersion 을 본문에 담는다", async () => {
    vi.mocked(ky.post).mockReturnValue(envelope({ result: false, keyVersion: 3 }));
    await expect(client.verifyStandard("key-1", "ZGF0YQ==", "<signature>", 3))
      .resolves.toStrictEqual({ result: false, keyVersion: 3 });
    expect(vi.mocked(ky.post).mock.calls[0]?.[0]).toBe(`${realBase}/asymmetric-keys/key-1/verify-standard`);
    expect(postOptions(0)?.json).toStrictEqual({
      plaintext: "ZGF0YQ==", signature: "<signature>", algorithm: "RSASSA-PSS", keyVersion: 3,
    });
  });

  it("getPrivateKey 는 /privateKey 경로로 GET 한다", async () => {
    vi.mocked(ky.get).mockReturnValue(envelope({
      keyType: "PrivateKey", key: "0x30", encodedKey: "<e>", standardEncodedKey: "<s>", keyVersion: 1,
    }));
    await client.getPrivateKey("key-1", 1);
    expect(vi.mocked(ky.get).mock.calls[0]?.[0]).toBe(`${realBase}/asymmetric-keys/key-1/privateKey`);
    expect(getOptions(0)?.searchParams).toStrictEqual({ keyVersion: 1 });
  });
});

describe("SkmClient 오류 변환", () => {
  const client = new SkmClient("token", "real", "test-appkey");
  beforeEach(() => vi.clearAllMocks());

  it("isSuccessful: false 봉투는 NhnEnvelopeError 가 된다", async () => {
    vi.mocked(ky.get).mockReturnValue(mockKyResponse({
      header: { isSuccessful: false, resultCode: -1, resultMessage: "Invalid key" },
    }));
    const err = await client.getSecret("key-1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NhnEnvelopeError);
    expect(err).toMatchObject({ exitCode: EXIT_API_ERROR, message: expect.stringContaining("Invalid key") });
  });

  it("가드가 실패하면 응답 형식 오류를 EXIT_API_ERROR 로 던진다", async () => {
    vi.mocked(ky.get).mockReturnValue(envelope({ secret: 1 }));
    await expect(client.getSecret("key-1")).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
      message: expect.stringContaining("Secure Key Manager 응답 형식 오류"),
    });
  });

  it("봉투가 아닌 응답은 응답 형식 오류다", async () => {
    vi.mocked(ky.get).mockReturnValue(mockKyResponse({ secret: "data" }));
    await expect(client.getSecret("key-1")).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
      message: expect.stringContaining("Secure Key Manager 응답 형식 오류"),
    });
  });

  it("HTTP 403 본문 봉투의 resultMessage 를 담아 EXIT_AUTH_ERROR 로 던진다", async () => {
    const url = `${realBase}/secrets/key-1`;
    const body = JSON.stringify({ header: { isSuccessful: false, resultCode: -1, resultMessage: "Forbidden client" } });
    const error = new HTTPError(new Response(body, { status: 403 }), new Request(url), {} as never);
    vi.mocked(ky.get).mockReturnValue({ json: async () => { throw error; } } as never);
    await expect(client.getSecret("key-1")).rejects.toMatchObject({
      exitCode: EXIT_AUTH_ERROR,
      message: "API 호출 실패 (403): Forbidden client",
    });
  });

  it("HTTP 400 본문 봉투는 EXIT_API_ERROR 로 던진다", async () => {
    const url = `${realBase}/symmetric-keys/key-1/decrypt`;
    const body = JSON.stringify({ header: { isSuccessful: false, resultCode: -2, resultMessage: "Invalid ciphertext" } });
    const error = new HTTPError(new Response(body, { status: 400 }), new Request(url), {} as never);
    vi.mocked(ky.post).mockReturnValue({ json: async () => { throw error; } } as never);
    await expect(client.decrypt("key-1", "<ciphertext>")).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
      message: "API 호출 실패 (400): Invalid ciphertext",
    });
  });

  it("본문이 JSON 이 아닌 HTTP 500 은 공용 변환 결과를 쓴다", async () => {
    const url = `${realBase}/secrets/key-1`;
    const error = new HTTPError(new Response("<html>error</html>", { status: 500 }), new Request(url), {} as never);
    vi.mocked(ky.get).mockReturnValue({ json: async () => { throw error; } } as never);
    await expect(client.getSecret("key-1")).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
      message: expect.stringContaining("API 호출 실패 (500)"),
    });
  });
});
