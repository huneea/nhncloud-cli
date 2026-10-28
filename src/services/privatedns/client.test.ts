import { beforeEach, describe, expect, it, vi } from "vitest";
import ky, { HTTPError, TimeoutError } from "ky";
import { PrivateDnsClient } from "./client.js";
import { EXIT_API_ERROR } from "../../utils/exit-codes.js";

vi.mock("ky", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ky")>();
  return { ...actual, default: { ...actual.default, get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
});

const endpoint = "https://kr1-api-network-infrastructure.nhncloudservice.com/v2.0";
const zone = {
  id: "zone-1", name: "example.internal.", description: null, status: "ACTIVE",
  networks: ["network-1"], created_at: "2026-10-07T06:52:06Z", updated_at: "2026-10-07T06:52:06Z", rrset_count: 2,
};
function rrset(id: string, over: Record<string, unknown> = {}) {
  return {
    id, name: "www.example.internal.", description: "web", zone_id: "zone-1", ttl: 300, type: "A",
    records: [{ content: "192.0.2.1" }], created_at: "2026-10-07T06:52:06Z", updated_at: "2026-10-07T06:52:06Z", ...over,
  };
}

function reply(method: "get" | "post" | "put", value: unknown): void {
  vi.mocked(ky[method]).mockReturnValue({ json: async () => value } as never);
}

function makeHttpError(status: number, body?: string): HTTPError {
  const response = new Response(body, { status });
  return new HTTPError(response, new Request(`${endpoint}/privatedns/zones`), {} as never);
}

describe("PrivateDnsClient 경로와 본문", () => {
  beforeEach(() => vi.resetAllMocks());

  it("조회 메서드는 /v2.0 이 중복되지 않은 경로와 올바른 응답 키를 쓴다", async () => {
    const client = new PrivateDnsClient("token", endpoint);
    const cases = [
      { invoke: () => client.listZones(), path: "/privatedns/zones", body: { zones: [zone] } },
      { invoke: () => client.getZone("zone-1"), path: "/privatedns/zones/zone-1", body: { zone } },
      { invoke: () => client.listRecordSets("zone-1"), path: "/privatedns/zones/zone-1/rrsets", body: { rrsets: [rrset("r1")] } },
      { invoke: () => client.getRecordSet("zone-1", "r1"), path: "/privatedns/zones/zone-1/rrsets/r1", body: { rrset: rrset("r1") } },
    ];
    for (const testCase of cases) {
      reply("get", testCase.body);
      await testCase.invoke();
      expect(ky.get).toHaveBeenLastCalledWith(endpoint + testCase.path, expect.objectContaining({
        headers: { "X-Auth-Token": "token" }, retry: 0,
      }));
      expect(vi.mocked(ky.get).mock.lastCall?.[0]).not.toContain("/v2.0/v2.0");
    }
    expect(vi.mocked(ky.get).mock.calls[0]?.[1]).not.toHaveProperty("searchParams.limit");
  });

  it("쓰기 메서드는 zone·rrset 으로 감싼 본문을 보내고 undefined 선택 필드는 뺀다", async () => {
    const client = new PrivateDnsClient("token", endpoint);
    reply("post", { zone });
    await client.createZone({ name: "example.internal.", description: undefined, networks: ["network-1"] });
    expect(ky.post).toHaveBeenLastCalledWith(`${endpoint}/privatedns/zones`, expect.objectContaining({
      json: { zone: { name: "example.internal.", networks: ["network-1"] } },
    }));
    const body = vi.mocked(ky.post).mock.lastCall?.[1] as { json: { zone: object } };
    expect(body.json.zone).not.toHaveProperty("description");

    reply("put", { zone });
    await client.updateZone("zone-1", { description: "d", networks: ["network-1"] });
    expect(ky.put).toHaveBeenLastCalledWith(`${endpoint}/privatedns/zones/zone-1`, expect.objectContaining({
      json: { zone: { description: "d", networks: ["network-1"] } },
    }));

    reply("post", { rrset: rrset("r1") });
    await client.createRecordSet("zone-1", { name: "www.example.internal.", type: "A", records: [{ content: "192.0.2.1" }], description: "web" });
    expect(ky.post).toHaveBeenLastCalledWith(`${endpoint}/privatedns/zones/zone-1/rrsets`, expect.objectContaining({
      json: { rrset: { name: "www.example.internal.", type: "A", records: [{ content: "192.0.2.1" }], description: "web" } },
    }));

    reply("put", { rrset: rrset("r1") });
    await client.updateRecordSet("zone-1", "r1", { type: "A", records: [{ content: "192.0.2.2" }], ttl: 60, description: "web" });
    expect(ky.put).toHaveBeenLastCalledWith(`${endpoint}/privatedns/zones/zone-1/rrsets/r1`, expect.objectContaining({
      json: { rrset: { type: "A", records: [{ content: "192.0.2.2" }], ttl: 60, description: "web" } },
    }));

    vi.mocked(ky.delete).mockResolvedValue(new Response(null, { status: 204 }) as never);
    await client.deleteZone("zone-1");
    await client.deleteRecordSet("zone-1", "r1");
    expect(vi.mocked(ky.delete).mock.calls.map((c) => c[0])).toEqual([
      `${endpoint}/privatedns/zones/zone-1`,
      `${endpoint}/privatedns/zones/zone-1/rrsets/r1`,
    ]);
  });
});

describe("PrivateDnsClient 응답 가드", () => {
  beforeEach(() => vi.resetAllMocks());

  it("getZone 은 zone 객체를 돌려주고 zones 배열 응답은 거부한다", async () => {
    const client = new PrivateDnsClient("token", endpoint);
    reply("get", { zone });
    await expect(client.getZone("zone-1")).resolves.toEqual(zone);
    reply("get", { zones: [zone] });
    await expect(client.getZone("zone-1")).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });

  it("description 이 null 인 시스템 레코드 세트를 통과시킨다", async () => {
    const client = new PrivateDnsClient("token", endpoint);
    const soa = rrset("soa", { type: "SOA", description: null });
    reply("get", { rrsets: [soa] });
    await expect(client.listRecordSets("zone-1")).resolves.toEqual([soa]);
    reply("get", { rrsets: [rrset("bad", { ttl: "300" })] });
    await expect(client.listRecordSets("zone-1")).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });
});

describe("PrivateDnsClient pagination", () => {
  beforeEach(() => vi.resetAllMocks());

  const href = (query: string) => `https://other-host.example.com/v2.0/privatedns/zones/zone-1/rrsets?${query}`;

  it("next 링크의 marker 와 limit 을 필터와 함께 같은 endpoint 로 이어 받는다", async () => {
    const client = new PrivateDnsClient("token", endpoint);
    vi.mocked(ky.get)
      .mockReturnValueOnce({ json: async () => ({
        rrsets: [rrset("r1")],
        rrsets_links: [{ href: href("type=A&marker=r2&limit=1"), rel: "next" }],
      }) } as never)
      .mockReturnValueOnce({ json: async () => ({ rrsets: [rrset("r2")] }) } as never);
    const result = await client.listRecordSets("zone-1", { type: "A" });
    expect(result.map((r) => r.id)).toEqual(["r1", "r2"]);
    const calls = vi.mocked(ky.get).mock.calls;
    expect(calls[0]?.[1]).toMatchObject({ searchParams: { type: "A" } });
    expect(calls[1]?.[0]).toBe(`${endpoint}/privatedns/zones/zone-1/rrsets`);
    expect(calls[1]?.[1]).toMatchObject({ searchParams: { type: "A", marker: "r2", limit: "1" } });
  });

  it("같은 marker 가 반복되면 API 오류로 끝낸다", async () => {
    const client = new PrivateDnsClient("token", endpoint);
    vi.mocked(ky.get).mockReturnValue({ json: async () => ({
      rrsets: [rrset("r1")],
      rrsets_links: [{ href: href("marker=r2&limit=1"), rel: "next" }],
    }) } as never);
    await expect(client.listRecordSets("zone-1")).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
    expect(ky.get).toHaveBeenCalledTimes(2);
  });

  it("next 링크에 marker 가 없으면 API 오류로 끝낸다", async () => {
    const client = new PrivateDnsClient("token", endpoint);
    reply("get", { zones: [zone], zones_links: [{ href: "https://other-host.example.com/v2.0/privatedns/zones?limit=1", rel: "next" }] });
    await expect(client.listZones()).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });
});

describe("PrivateDnsClient 쓰기 오류", () => {
  beforeEach(() => vi.resetAllMocks());

  const recordArgs: Parameters<PrivateDnsClient["createRecordSet"]> = [
    "zone-1", { name: "www.example.internal.", type: "A", records: [{ content: "192.0.2.1" }], description: "web" },
  ];
  const failure = (promise: Promise<unknown>): Promise<Error> =>
    promise.then(() => { throw new Error("거부되어야 합니다"); }, (e: unknown) => e as Error);

  it("시간 초과는 반영 여부 불명 안내를 레코드 목록 명령과 함께 붙인다", async () => {
    const client = new PrivateDnsClient("token", endpoint);
    vi.mocked(ky.post).mockImplementation(() => { throw new TimeoutError(new Request(endpoint)); });
    await expect(client.createRecordSet(...recordArgs)).rejects.toThrow(/요청이 반영됐는지 알 수 없습니다[\s\S]*privatedns record list/);
  });

  it("연결 오류는 zone 목록 확인 안내를 붙인다", async () => {
    const client = new PrivateDnsClient("token", endpoint);
    vi.mocked(ky.delete).mockImplementation(() => { throw new Error("fetch failed"); });
    await expect(client.deleteZone("zone-1")).rejects.toThrow(/요청이 반영됐는지 알 수 없습니다[\s\S]*privatedns zone list/);
  });

  it("HTTP 400 은 서버 거부 사유를 붙이고 반영 여부 안내는 붙이지 않는다", async () => {
    const client = new PrivateDnsClient("token", endpoint);
    const body = JSON.stringify({ NeutronError: { message: "Invalid record" } });
    vi.mocked(ky.post).mockImplementation(() => { throw makeHttpError(400, body); });
    const err = await failure(client.createRecordSet(...recordArgs));
    expect(err.message).toContain("서버 응답: Invalid record");
    expect(err.message).not.toContain("요청이 반영됐는지 알 수 없습니다");
  });

  it("응답 가드 실패에는 반영 여부 안내를 붙이지 않는다", async () => {
    const client = new PrivateDnsClient("token", endpoint);
    reply("post", { zone });
    const err = await failure(client.createRecordSet(...recordArgs));
    expect(err).toMatchObject({ exitCode: EXIT_API_ERROR });
    expect(err.message).not.toContain("요청이 반영됐는지 알 수 없습니다");
  });
});
