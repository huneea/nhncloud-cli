import { describe, it, expect, vi, beforeEach } from "vitest";
import ky from "ky";
import { BlockStorageClient } from "./client.js";
import { EXIT_API_ERROR } from "../../utils/exit-codes.js";
import { NhnCloudCliError } from "../../utils/errors.js";

vi.mock("ky");

const volumeResponse = {
  volume: {
    id: "vol-1",
    name: "data",
    size: 10,
    status: "creating",
    volume_type: "General SSD",
    availability_zone: "kr-pub-a",
    attachments: [],
    created_at: "2026-07-03T00:00:00Z",
  },
};

describe("BlockStorageClient.create", () => {
  beforeEach(() => vi.resetAllMocks());

  it("availability_zone 지정 시 create payload 에 포함한다", async () => {
    vi.mocked(ky.post).mockReturnValue({
      json: async () => volumeResponse,
    } as never);

    const client = new BlockStorageClient("token", "https://example.com/v2/tenant");
    await client.create({
      size: 10,
      name: "data",
      volume_type: "General SSD",
      availability_zone: "kr-pub-a",
    });

    expect(ky.post).toHaveBeenCalledWith(
      "https://example.com/v2/tenant/volumes",
      expect.objectContaining({
        headers: { "X-Auth-Token": "token" },
        json: {
          volume: {
            size: 10,
            name: "data",
            volume_type: "General SSD",
            availability_zone: "kr-pub-a",
          },
        },
      }),
    );
  });

  it("availability_zone 미지정 시 create payload 에 포함하지 않는다", async () => {
    vi.mocked(ky.post).mockReturnValue({
      json: async () => volumeResponse,
    } as never);

    const client = new BlockStorageClient("token", "https://example.com/v2/tenant");
    await client.create({ size: 10 });

    expect(ky.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        json: { volume: { size: 10 } },
      }),
    );
  });

  it("응답 형식 오류는 EXIT_API_ERROR 로 throw 한다", async () => {
    vi.mocked(ky.post).mockReturnValue({
      json: async () => ({ unexpected: true }),
    } as never);

    const client = new BlockStorageClient("token", "https://example.com/v2/tenant");
    await expect(client.create({ size: 10 })).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });

  it("availability_zone 응답 필드가 문자열이 아니면 EXIT_API_ERROR 로 throw 한다", async () => {
    vi.mocked(ky.post).mockReturnValue({
      json: async () => ({
        volume: {
          ...volumeResponse.volume,
          availability_zone: 123,
        },
      }),
    } as never);

    const client = new BlockStorageClient("token", "https://example.com/v2/tenant");
    await expect(client.create({ size: 10 })).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });
});

describe("BlockStorageClient.list", () => {
  beforeEach(() => vi.resetAllMocks());

  it("/volumes/detail URL 로 호출한다", async () => {
    vi.mocked(ky.get).mockReturnValue({
      json: async () => ({ volumes: [] }),
    } as never);

    const client = new BlockStorageClient("token", "https://example.com/v2/tenant");
    await client.list();

    expect(ky.get).toHaveBeenCalledWith(
      "https://example.com/v2/tenant/volumes/detail",
      expect.objectContaining({
        headers: { "X-Auth-Token": "token" },
      }),
    );
  });

  it("detail 응답을 파싱해 볼륨 배열을 반환한다", async () => {
    const detailVolume = {
      id: "vol-1",
      name: "data",
      size: 10,
      status: "in-use",
      attachments: [],
      availability_zone: "kr-pub-a",
      volume_type: "General SSD",
    };
    vi.mocked(ky.get).mockReturnValue({
      json: async () => ({ volumes: [detailVolume] }),
    } as never);

    const client = new BlockStorageClient("token", "https://example.com/v2/tenant");
    const result = await client.list();

    expect(result).toEqual([detailVolume]);
  });

  it("빈 목록은 빈 배열을 반환한다", async () => {
    vi.mocked(ky.get).mockReturnValue({
      json: async () => ({ volumes: [] }),
    } as never);

    const client = new BlockStorageClient("token", "https://example.com/v2/tenant");
    const result = await client.list();

    expect(result).toEqual([]);
  });

  it("summary 형태 응답(size·status·attachments 없음)은 EXIT_API_ERROR 로 throw 한다", async () => {
    vi.mocked(ky.get).mockReturnValue({
      json: async () => ({
        volumes: [{ id: "vol-1", name: "data", links: [] }],
      }),
    } as never);

    const client = new BlockStorageClient("token", "https://example.com/v2/tenant");
    await expect(client.list()).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });

  it("volumes 키가 없으면 EXIT_API_ERROR 로 throw 한다", async () => {
    vi.mocked(ky.get).mockReturnValue({
      json: async () => ({ unexpected: true }),
    } as never);

    const client = new BlockStorageClient("token", "https://example.com/v2/tenant");
    await expect(client.list()).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });

  it("sort/limit/offset/marker 를 searchParams 로 전달한다", async () => {
    vi.mocked(ky.get).mockReturnValue({
      json: async () => ({ volumes: [] }),
    } as never);

    const client = new BlockStorageClient("token", "https://example.com/v2/tenant");
    await client.list({ sort: "name:asc", limit: 10, offset: 5, marker: "vol-0" });

    expect(ky.get).toHaveBeenCalledWith(
      "https://example.com/v2/tenant/volumes/detail",
      expect.objectContaining({
        searchParams: { sort: "name:asc", limit: 10, offset: 5, marker: "vol-0" },
      }),
    );
  });
});

describe("BlockStorageClient.delete / wait", () => {
  beforeEach(() => vi.resetAllMocks());

  const client = new BlockStorageClient("token", "https://example.com/v2/tenant");
  const vol = (status: string, attachments: unknown[] = []) => ({
    json: async () => ({ volume: { ...volumeResponse.volume, status, attachments } }),
  });

  it("delete 는 DELETE /volumes/{id} 를 보낸다", async () => {
    vi.mocked(ky.delete).mockResolvedValue({} as never);
    await client.delete("vol-1");
    expect(ky.delete).toHaveBeenCalledWith(
      "https://example.com/v2/tenant/volumes/vol-1",
      expect.objectContaining({ headers: { "X-Auth-Token": "token" } }),
    );
  });

  it("waitForVolume 은 조건이 될 때까지 폴링한다", async () => {
    vi.mocked(ky.get)
      .mockReturnValueOnce(vol("detaching") as never)
      .mockReturnValueOnce(vol("available") as never);
    const v = await client.waitForVolume("vol-1", (x) => x.status === "available", {
      timeoutMs: 1000,
      intervalMs: 1,
      label: "연결 해제",
    });
    expect(v.status).toBe("available");
    expect(ky.get).toHaveBeenCalledTimes(2);
  });

  it("waitForVolume 은 error 상태에서 바로 실패한다", async () => {
    vi.mocked(ky.get).mockReturnValue(vol("error") as never);
    await expect(
      client.waitForVolume("vol-1", () => false, { timeoutMs: 1000, intervalMs: 1, label: "연결" }),
    ).rejects.toThrow(/오류 상태/);
    expect(ky.get).toHaveBeenCalledTimes(1);
  });

  it("waitForVolume 은 제한 시간을 넘으면 마지막 상태와 함께 실패한다", async () => {
    vi.mocked(ky.get).mockReturnValue(vol("detaching") as never);
    await expect(
      client.waitForVolume("vol-1", () => false, { timeoutMs: 5, intervalMs: 1, label: "연결 해제" }),
    ).rejects.toThrow(/detaching/);
  });

  it("waitForDeleted 는 404 가 되면 끝난다", async () => {
    vi.mocked(ky.get)
      .mockReturnValueOnce(vol("deleting") as never)
      .mockReturnValueOnce({
        json: async () => {
          throw new NhnCloudCliError("API 호출 실패 (404): Not Found", EXIT_API_ERROR);
        },
      } as never);
    await expect(client.waitForDeleted("vol-1", { timeoutMs: 1000, intervalMs: 1 })).resolves.toBeUndefined();
  });

  it("waitForDeleted 는 error_deleting 에서 실패한다", async () => {
    vi.mocked(ky.get).mockReturnValue(vol("error_deleting") as never);
    await expect(client.waitForDeleted("vol-1", { timeoutMs: 1000, intervalMs: 1 })).rejects.toThrow(/오류 상태/);
  });
});
