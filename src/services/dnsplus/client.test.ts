import { beforeEach, describe, expect, it, vi } from "vitest";
import ky, { HTTPError } from "ky";
import { DnsplusClient } from "./client.js";
import { DnsplusApiError } from "./errors.js";
import { EXIT_API_ERROR, EXIT_AUTH_ERROR } from "../../utils/exit-codes.js";

vi.mock("ky", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ky")>();
  return { ...actual, default: { ...actual.default, get: vi.fn(), post: vi.fn(), delete: vi.fn() } };
});

const APPKEY = "test-appkey-0001";
const ZONE_ID = "11111111-2222-3333-4444-555555555555";
const realBase = `https://dnsplus.api.nhncloudservice.com/dnsplus/v1.0/appkeys/${APPKEY}`;
const govBase = `https://dnsplus.api.gov-nhncloudservice.com/dnsplus/v1.0/appkeys/${APPKEY}`;
const ok = { isSuccessful: true, resultCode: 0, resultMessage: "SUCCESS" };

const zone = {
  engineId: "engine-1",
  zoneId: ZONE_ID,
  zoneName: "example.com.",
  zoneStatus: "USE",
  description: "테스트",
  createdAt: "2019-06-04T12:32:50.000+09:00",
  updatedAt: "2019-06-04T12:32:50.000+09:00",
  recordsetCount: 2,
};
const recordset = {
  recordsetId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  recordsetName: "www.example.com.",
  recordsetType: "A",
  recordsetTtl: 300,
  recordsetStatus: "USE",
  recordList: [{ recordDisabled: false, recordContent: "192.0.2.10", ipV4: "192.0.2.10" }],
};

function respond(body: unknown) {
  return { json: async () => body } as never;
}

describe("DnsplusClient", () => {
  beforeEach(() => vi.clearAllMocks());

  it("존 목록을 앱키가 든 경로로 조회하고 페이지 파라미터를 붙인다", async () => {
    vi.mocked(ky.get).mockReturnValue(respond({ header: ok, totalCount: 1, zoneList: [zone] }));

    const zones = await new DnsplusClient(APPKEY, "real").listZones({ searchZoneName: "example.com." });

    expect(zones).toEqual([zone]);
    expect(ky.get).toHaveBeenCalledWith(
      `${realBase}/zones`,
      expect.objectContaining({
        searchParams: { searchZoneName: "example.com.", page: 1, limit: 3000 },
        retry: 0,
      }),
    );
  });

  it("공공망 profile 은 공공망 host 로 보낸다", async () => {
    vi.mocked(ky.get).mockReturnValue(respond({ header: ok, totalCount: 0, zoneList: [] }));

    await new DnsplusClient(APPKEY, "gov").listZones();

    expect(vi.mocked(ky.get).mock.calls[0]?.[0]).toBe(`${govBase}/zones`);
  });

  it("totalCount 를 채울 때까지 다음 페이지를 읽는다", async () => {
    vi.mocked(ky.get)
      .mockReturnValueOnce(respond({ header: ok, totalCount: 2, zoneList: [zone] }))
      .mockReturnValueOnce(respond({ header: ok, totalCount: 2, zoneList: [{ ...zone, zoneId: "z2" }] }));

    const zones = await new DnsplusClient(APPKEY).listZones();

    expect(zones.map((z) => z.zoneId)).toEqual([ZONE_ID, "z2"]);
    expect(vi.mocked(ky.get).mock.calls[1]?.[1]).toMatchObject({ searchParams: { page: 2 } });
  });

  it("레코드 세트 목록에 이름과 타입 필터를 쉼표로 붙인다", async () => {
    vi.mocked(ky.get).mockReturnValue(respond({ header: ok, totalCount: 1, recordsetList: [recordset] }));

    const result = await new DnsplusClient(APPKEY).listRecordsets(ZONE_ID, {
      searchRecordsetName: "www.example.com.",
      recordsetTypeList: ["A", "TXT"],
    });

    expect(result).toHaveLength(1);
    expect(ky.get).toHaveBeenCalledWith(
      `${realBase}/zones/${ZONE_ID}/recordsets`,
      expect.objectContaining({
        searchParams: { searchRecordsetName: "www.example.com.", recordsetTypeList: "A,TXT", page: 1, limit: 3000 },
      }),
    );
  });

  it("레코드 세트 생성 본문은 recordset 객체 하나다", async () => {
    vi.mocked(ky.post).mockReturnValue(respond({ header: ok, recordset }));
    const input = {
      recordsetName: "www.example.com.",
      recordsetType: "A" as const,
      recordsetTtl: 300,
      recordList: [{ recordDisabled: false, recordContent: "192.0.2.10" }],
    };

    const created = await new DnsplusClient(APPKEY).createRecordset(ZONE_ID, input);

    expect(created.recordsetId).toBe(recordset.recordsetId);
    expect(ky.post).toHaveBeenCalledWith(
      `${realBase}/zones/${ZONE_ID}/recordsets`,
      expect.objectContaining({ json: { recordset: input }, retry: 0 }),
    );
  });

  it("레코드 세트 삭제는 ID 목록을 쉼표로 묶어 보낸다", async () => {
    vi.mocked(ky.delete).mockReturnValue(respond({ header: ok }));

    await new DnsplusClient(APPKEY).deleteRecordsets(ZONE_ID, ["r1", "r2"]);

    expect(ky.delete).toHaveBeenCalledWith(
      `${realBase}/zones/${ZONE_ID}/recordsets`,
      expect.objectContaining({ searchParams: { recordsetIdList: "r1,r2" }, retry: 0 }),
    );
  });

  it("HTTP 200 봉투의 4010001 은 인증 오류(종료 코드 2)다", async () => {
    vi.mocked(ky.get).mockReturnValue(
      respond({ header: { isSuccessful: false, resultCode: 4010001, resultMessage: "Invalid appKey. " } }),
    );

    const error = await new DnsplusClient(APPKEY).listZones().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DnsplusApiError);
    expect((error as DnsplusApiError).exitCode).toBe(EXIT_AUTH_ERROR);
    expect((error as DnsplusApiError).message).toContain("Invalid appKey.");
  });

  it("그 밖의 봉투 실패는 API 오류(종료 코드 1)고 메시지의 앱키를 가린다", async () => {
    vi.mocked(ky.get).mockReturnValue(
      respond({ header: { isSuccessful: false, resultCode: 5000000, resultMessage: `bad ${APPKEY}` } }),
    );

    const error = (await new DnsplusClient(APPKEY).listZones().catch((e: unknown) => e)) as DnsplusApiError;

    expect(error.exitCode).toBe(EXIT_API_ERROR);
    expect(error.message).not.toContain(APPKEY);
    expect(error.message).toContain("<appkey>");
  });

  it("HTTP 오류 메시지에 요청 URL(앱키)을 싣지 않는다", async () => {
    const response = new Response("{}", { status: 404, statusText: "Not Found" });
    const request = new Request(`${realBase}/zones`);
    vi.mocked(ky.get).mockImplementation(() => {
      throw new HTTPError(response, request, {} as never);
    });

    const error = (await new DnsplusClient(APPKEY).listZones().catch((e: unknown) => e)) as Error;

    expect(error.message).toBe("DNS Plus API 호출 실패 (404)");
    expect(error.message).not.toContain(APPKEY);
  });

  it("봉투가 없는 응답과 목록 형식이 틀린 응답은 형식 오류다", async () => {
    vi.mocked(ky.get).mockReturnValueOnce(respond({ zoneList: [] }));
    await expect(new DnsplusClient(APPKEY).listZones()).rejects.toThrow("응답 형식 오류: header");

    vi.mocked(ky.get).mockReturnValueOnce(respond({ header: ok, totalCount: 1, zoneList: [{ zoneId: 1 }] }));
    await expect(new DnsplusClient(APPKEY).listZones()).rejects.toThrow("응답 형식 오류: zoneList");
  });
});
