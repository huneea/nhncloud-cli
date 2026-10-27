import { beforeEach, describe, expect, it, vi } from "vitest";
import ky, { HTTPError } from "ky";
import { CertificateClient, KeyManagerError, refId } from "./certificate-client.js";
import { EXIT_API_ERROR, EXIT_AUTH_ERROR } from "../../utils/exit-codes.js";

vi.mock("ky", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ky")>();
  return { ...actual, default: vi.fn() };
});

const endpoint = "https://kr1-api-key-manager-infrastructure.nhncloudservice.com/v1";

function container(id: string, type = "certificate", name: string | null = `cert-${id}`) {
  return {
    status: "ACTIVE",
    name,
    consumers: [],
    container_ref: `${endpoint}/containers/${id}`,
    secret_refs: [
      { name: "certificate", secret_ref: `${endpoint}/secrets/${id}-c` },
      { name: "private_key", secret_ref: `${endpoint}/secrets/${id}-k` },
    ],
    type,
    common_name: "example.com.",
    expiration: "2027-01-01T00:00:00",
  };
}

function respondJson(...bodies: unknown[]): void {
  for (const body of bodies) {
    vi.mocked(ky).mockResolvedValueOnce({ json: async () => body } as never);
  }
}

describe("CertificateClient", () => {
  beforeEach(() => vi.resetAllMocks());

  it("컨테이너 목록을 끝까지 넘기고 certificate 타입만 돌려준다", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      container(`c${index}`, index === 0 ? "generic" : "certificate"),
    );
    respondJson(
      { containers: firstPage, total: 101, next: `${endpoint}/containers?limit=100&offset=100` },
      { containers: [container("last")], total: 101 },
    );
    const client = new CertificateClient("token-id", endpoint);

    const result = await client.listCertificateContainers();

    expect(result).toHaveLength(100);
    expect(result.every((item) => item.type === "certificate")).toBe(true);
    expect(vi.mocked(ky).mock.calls.map(([url, options]) => [url, (options as { searchParams: unknown }).searchParams])).toEqual([
      [`${endpoint}/containers`, { limit: "100", offset: "0" }],
      [`${endpoint}/containers`, { limit: "100", offset: "100" }],
    ]);
    expect(ky).toHaveBeenCalledWith(
      `${endpoint}/containers`,
      expect.objectContaining({ method: "get", headers: { "X-Auth-Token": "token-id" }, retry: 0 }),
    );
  });

  it("서버가 limit 보다 적게 잘라도 next 가 있으면 받은 개수만큼 offset 을 옮겨 이어 받는다", async () => {
    respondJson(
      { containers: [container("a"), container("b")], total: 3, next: `${endpoint}/containers?limit=2&offset=2` },
      { containers: [container("c")], total: 3 },
    );
    const client = new CertificateClient("token-id", endpoint);

    await expect(client.listCertificateContainers()).resolves.toHaveLength(3);
    expect(vi.mocked(ky).mock.calls.map(([, options]) => (options as { searchParams: { offset: string } }).searchParams.offset)).toEqual(["0", "2"]);
  });

  it("이름이 null 인 컨테이너도 통과시키고 형식이 다르면 API 오류로 끝난다", async () => {
    const client = new CertificateClient("token-id", endpoint);

    respondJson({ containers: [container("a", "certificate", null)], total: 1 });
    await expect(client.listCertificateContainers()).resolves.toHaveLength(1);

    respondJson({ containers: [{ name: "broken" }], total: 1 });
    await expect(client.listCertificateContainers()).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });

  it("시크릿과 컨테이너 생성은 응답의 ref 를 돌려준다", async () => {
    respondJson({ secret_ref: `${endpoint}/secrets/s-1` }, { container_ref: `${endpoint}/containers/c-1` });
    const client = new CertificateClient("token-id", endpoint);
    const secret = {
      name: "web-certificate",
      secret_type: "certificate" as const,
      payload: "-----BEGIN CERTIFICATE-----\n",
      payload_content_type: "text/plain" as const,
    };

    await expect(client.createSecret(secret)).resolves.toBe(`${endpoint}/secrets/s-1`);
    await expect(
      client.createContainer({ type: "certificate", name: "web", secret_refs: [] }),
    ).resolves.toBe(`${endpoint}/containers/c-1`);
    expect(ky).toHaveBeenNthCalledWith(1, `${endpoint}/secrets`, expect.objectContaining({ method: "post", json: secret }));
    expect(ky).toHaveBeenNthCalledWith(
      2,
      `${endpoint}/containers`,
      expect.objectContaining({ method: "post", json: { type: "certificate", name: "web", secret_refs: [] } }),
    );
  });

  it("시크릿 삭제는 secret_ref 의 마지막 경로 조각을 ID 로 쓴다", async () => {
    vi.mocked(ky).mockResolvedValueOnce(new Response(null, { status: 204 }) as never);
    const client = new CertificateClient("token-id", endpoint);

    await client.deleteSecret(`${endpoint}/secrets/s-1`);

    expect(ky).toHaveBeenCalledWith(`${endpoint}/secrets/s-1`, expect.objectContaining({ method: "delete" }));
    expect(refId(`${endpoint}/containers/c-1/`)).toBe("c-1");
  });

  it("2xx 응답에 ref 가 없으면 결과를 모르는 실패로 표시한다", async () => {
    respondJson({});
    const client = new CertificateClient("token-id", endpoint);

    const error = await client
      .createSecret({ name: "s", secret_type: "certificate", payload: "p", payload_content_type: "text/plain" })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(KeyManagerError);
    expect(error).toMatchObject({ outcomeKnown: false, exitCode: EXIT_API_ERROR });
  });

  it("403 은 key-manager 권한 안내를 붙여 인증 오류로 끝난다", async () => {
    const request = new Request(`${endpoint}/containers`);
    const response = new Response("{}", { status: 403, statusText: "Forbidden" });
    vi.mocked(ky).mockRejectedValueOnce(new HTTPError(response, request, {} as never));
    const client = new CertificateClient("token-id", endpoint);

    await expect(client.listCertificateContainers()).rejects.toMatchObject({
      exitCode: EXIT_AUTH_ERROR,
      outcomeKnown: true,
      message: expect.stringContaining("key-manager 권한이 없습니다"),
    });
  });
});
