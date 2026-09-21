import { describe, it, expect, vi, beforeEach } from "vitest";
import ky from "ky";
import { DeployClient } from "./client.js";

vi.mock("ky");

describe("DeployClient.artifacts", () => {
  beforeEach(() => vi.resetAllMocks());

  it("봉투를 unwrap 해 body 를 반환", async () => {
    vi.mocked(ky.get).mockReturnValue({
      json: async () => ({
        header: { isSuccessful: true, resultCode: 0, resultMessage: "OK" },
        body: { artifacts: [{ id: "a1" }] },
      }),
    } as never);

    const client = new DeployClient("token");
    const res = await client.artifacts("appkey");
    expect(res).toEqual({ artifacts: [{ id: "a1" }] });
  });

  it("isSuccessful=false 면 throw", async () => {
    vi.mocked(ky.get).mockReturnValue({
      json: async () => ({
        header: { isSuccessful: false, resultCode: "ERROR", resultMessage: "fail" },
      }),
    } as never);

    const client = new DeployClient("token");
    await expect(client.artifacts("appkey")).rejects.toThrow();
  });
});

describe("DeployClient.binaryGroups", () => {
  beforeEach(() => vi.resetAllMocks());

  it("description null 을 정상 응답으로 수용", async () => {
    vi.mocked(ky.get).mockReturnValue({
      json: async () => ({
        header: { isSuccessful: true, resultCode: 0, resultMessage: "OK" },
        body: {
          binaryGroups: [
            {
              key: 1,
              name: "default",
              description: null,
              regionCode: "KR1",
              createDate: "2026-06-23T00:00:00Z",
            },
          ],
        },
      }),
    } as never);

    const client = new DeployClient("token");
    const res = await client.binaryGroups("appkey", "artifact");
    expect(res[0]?.description).toBeNull();
  });

  it("description 누락을 정상 응답으로 수용", async () => {
    vi.mocked(ky.get).mockReturnValue({
      json: async () => ({
        header: { isSuccessful: true, resultCode: 0, resultMessage: "OK" },
        body: {
          binaryGroups: [
            {
              key: 1,
              name: "default",
              regionCode: "KR1",
              createDate: "2026-06-23T00:00:00Z",
            },
          ],
        },
      }),
    } as never);

    const client = new DeployClient("token");
    const res = await client.binaryGroups("appkey", "artifact");
    expect(res[0]?.description).toBeUndefined();
  });
});

describe("DeployClient.scenarios", () => {
  it("공공망 시나리오 경로로 조회하고 응답 body를 반환한다", async () => {
    vi.mocked(ky.get).mockReturnValue({ json: async () => ({ header: { isSuccessful: true, resultCode: "SUCCESS" }, body: { scenarios: [{ scenarioId: 1 }] } }) } as never);
    const result = await new DeployClient("token", "gov").scenarios("appkey", "1", "2");
    expect(result).toEqual({ scenarios: [{ scenarioId: 1 }] });
    expect(ky.get).toHaveBeenCalledWith("https://api-tcd.gov-nhncloudservice.com/api/v2.1/projects/appkey/artifacts/1/server-groups/2/scenarios", expect.any(Object));
  });
});
