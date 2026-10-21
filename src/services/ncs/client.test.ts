import { describe, it, expect, vi, beforeEach } from "vitest";
import ky from "ky";
import { NcsClient } from "./client.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_AUTH_ERROR, EXIT_API_ERROR, EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";

vi.mock("ky");

function mockKyResponse(body: unknown, headers: Record<string, string> = {}) {
  return {
    json: async () => body,
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
  } as never;
}

describe("NcsClient.listTemplates", () => {
  beforeEach(() => vi.resetAllMocks());

  it("공공망 profile은 공공망 kr1 주소로 조회한다", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({ header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" }, templates: [] }),
    );

    await new NcsClient("token", "kr1", "test-appkey", "gov").listTemplates();

    expect(ky.get).toHaveBeenCalledWith(
      "https://kr1-ncs.api.gov-nhncloudservice.com/ncs/v1.0/appkeys/test-appkey/templates",
      expect.any(Object),
    );
  });

  it("{ header, templates: [...] } 에서 templates 반환 + X-Total-Count 헤더 파싱", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse(
        {
          header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
          templates: [
            { id: "tmpl-1", name: "nginx-template", version: "second", versionCount: 2, workloadCount: 1 },
            { id: "tmpl-2", name: "redis-template", versionCount: "1" },
          ],
        },
        { "x-total-count": "2" },
      ),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.listTemplates();
    expect(result.totalCount).toBe(2);
    expect(result.templates).toHaveLength(2);
    expect(result.templates[0].id).toBe("tmpl-1");
    // 6-2 검증: versionCount 가 string 이어도 수용
    expect(result.templates[1].versionCount).toBe("1");
  });

  it("x-nhn-authorization 헤더 포함 단언", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
        templates: [],
      }),
    );

    const client = new NcsClient("my-token", "kr1", "test-appkey");
    await client.listTemplates();

    expect(ky.get).toHaveBeenCalledWith(
      expect.stringContaining("kr1-ncs.api.nhncloudservice.com"),
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-nhn-authorization": "Bearer my-token",
        }),
      }),
    );
  });

  it("templates 누락 시 빈 배열 반환 (방어)", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.listTemplates();
    expect(result.templates).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it("templates 가 비배열(키 형태 변경)이면 형식 오류 throw", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
        templates: { unexpected: "object" },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await expect(client.listTemplates()).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });

  it("isSuccessful=false 면 throw (EXIT_API_ERROR)", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: false, resultCode: 401, resultMessage: "Unauthorized" },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await expect(client.listTemplates()).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });

  it("HTTP 401 → EXIT_AUTH_ERROR (toNhnCloudCliError 매핑 흉내)", async () => {
    // vi.mock("ky") 가 HTTPError 까지 자동 mock 해 instanceof 체크가 깨진다.
    // toNhnCloudCliError 가 401 → EXIT_AUTH_ERROR 로 변환한 결과를 직접 주입.
    vi.mocked(ky.get).mockReturnValue({
      json: async () => {
        throw new NhnCloudCliError("API 호출 실패 (401)", EXIT_AUTH_ERROR);
      },
    } as never);

    const client = new NcsClient("token", "kr1", "test-appkey");
    await expect(client.listTemplates()).rejects.toMatchObject({
      exitCode: EXIT_AUTH_ERROR,
    });
  });

  it("HTTP 404(그 외 4xx) → EXIT_API_ERROR (toNhnCloudCliError 매핑 흉내)", async () => {
    vi.mocked(ky.get).mockReturnValue({
      json: async () => {
        throw new NhnCloudCliError("API 호출 실패 (404)", EXIT_API_ERROR);
      },
    } as never);

    const client = new NcsClient("token", "kr1", "test-appkey");
    await expect(client.listTemplates()).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });

  it("미등록 region('xx') → NcsClient 생성 시 EXIT_PARAM_ERROR", () => {
    expect(() => new NcsClient("token", "xx", "test-appkey")).toThrow(
      expect.objectContaining({ exitCode: EXIT_PARAM_ERROR }),
    );
  });
});

describe("NcsClient.getTemplate", () => {
  beforeEach(() => vi.resetAllMocks());

  it("{ header, template: {...} } 에서 template 반환", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
        template: { id: "tmpl-1", name: "nginx-template", versionCount: 2 },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.getTemplate("tmpl-1");
    expect(result.id).toBe("tmpl-1");
    expect(result.name).toBe("nginx-template");
  });

  it("template 필드 누락 시 형식 오류 throw (EXIT_API_ERROR)", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await expect(client.getTemplate("tmpl-1")).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });
});

describe("NcsClient.listTemplateVersions", () => {
  beforeEach(() => vi.resetAllMocks());

  it("{ header, versions: [...] } 에서 versions 반환 + X-Total-Count 헤더 파싱", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse(
        {
          header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
          versions: [
            { id: "v-1", version: "1", workloadCount: 1 },
            { id: "v-2", version: "second" },
          ],
        },
        { "x-total-count": "2" },
      ),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.listTemplateVersions("tmpl-1");
    expect(result.totalCount).toBe(2);
    expect(result.versions).toHaveLength(2);
    expect(result.versions[1].version).toBe("second");
  });

  it("versions 누락 시 빈 배열 반환 (방어)", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.listTemplateVersions("tmpl-1");
    expect(result.versions).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it("versions 가 비배열(키 형태 변경)이면 형식 오류 throw", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
        versions: { unexpected: "object" },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await expect(client.listTemplateVersions("tmpl-1")).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });
});

describe("NcsClient.getTemplateVersion", () => {
  beforeEach(() => vi.resetAllMocks());

  it("{ header, version: {...} } 에서 version 반환", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
        version: { id: "v-1", version: "1", workloadCount: 3 },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.getTemplateVersion("tmpl-1", "1");
    expect(result.id).toBe("v-1");
    expect(result.version).toBe("1");
  });

  it("version 필드 누락 시 형식 오류 throw (EXIT_API_ERROR)", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await expect(client.getTemplateVersion("tmpl-1", "1")).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });
});

describe("NcsClient.listWorkloads", () => {
  beforeEach(() => vi.resetAllMocks());

  it("{ header, workloads: [...] } 에서 workloads 반환 + X-Total-Count 헤더 파싱", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse(
        {
          header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
          workloads: [
            { id: "wl-1", name: "nginx", status: "Running", type: "deployment" },
            { id: "wl-2", name: "redis", status: "Pending" },
          ],
        },
        { "x-total-count": "2" },
      ),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.listWorkloads();
    expect(result.totalCount).toBe(2);
    expect(result.workloads).toHaveLength(2);
    expect(result.workloads[0].id).toBe("wl-1");
  });

  it("workloads 누락 시 빈 배열 반환 (방어)", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.listWorkloads();
    expect(result.workloads).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it("workloads 가 비배열(키 형태 변경)이면 형식 오류 throw", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
        workloads: { unexpected: "object" },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await expect(client.listWorkloads()).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });
});

describe("NcsClient.getWorkload", () => {
  beforeEach(() => vi.resetAllMocks());

  it("{ header, workload: {...tasks} } 에서 workload 반환", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
        workload: {
          id: "wl-1",
          name: "nginx",
          status: "Running",
          tasks: [
            {
              id: "task-1",
              containers: [{ name: "nginx", state: "Running", startedAt: "2024-10-27T22:29:23Z" }],
            },
          ],
        },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.getWorkload("wl-1");
    expect(result.id).toBe("wl-1");
    expect(result.tasks?.[0]?.containers?.[0]?.state).toBe("Running");
  });

  it("workload 필드 누락 시 형식 오류 throw (EXIT_API_ERROR)", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await expect(client.getWorkload("wl-1")).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });
});

describe("NcsClient.getWorkloadLogs", () => {
  beforeEach(() => vi.resetAllMocks());

  it("{ header, logs: [...] } 에서 logs 반환 + containerName 쿼리 전달", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
        logs: [{ log: "starting", time: "2024-10-27T22:29:23Z" }],
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.getWorkloadLogs("wl-1", "task-1", { container: "nginx" });
    expect(result.logs).toHaveLength(1);
    expect(ky.get).toHaveBeenCalledWith(
      expect.stringContaining("/workloads/wl-1/tasks/task-1/logs"),
      expect.objectContaining({
        searchParams: expect.objectContaining({ containerName: "nginx" }),
      }),
    );
  });

  it("container 쿼리 누락 시 EXIT_PARAM_ERROR 던짐 (API 호출 전)", async () => {
    const client = new NcsClient("token", "kr1", "test-appkey");
    await expect(
      client.getWorkloadLogs("wl-1", "task-1", { container: "" }),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(ky.get).not.toHaveBeenCalled();
  });

  it("제공된 from·to를 그대로 전달하고 생략된 필드는 만들지 않는다", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
        logs: [],
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await client.getWorkloadLogs("wl-1", "task-1", {
      container: "nginx",
      from: "2026-07-28T12:00:00Z",
      to: "2026-07-28T12:30:00Z",
    });
    expect(vi.mocked(ky.get).mock.calls[0]?.[1]?.searchParams).toEqual({
      containerName: "nginx",
      from: "2026-07-28T12:00:00Z",
      to: "2026-07-28T12:30:00Z",
    });

    vi.mocked(ky.get).mockClear();
    await client.getWorkloadLogs("wl-1", "task-1", { container: "nginx" });
    expect(vi.mocked(ky.get).mock.calls[0]?.[1]?.searchParams).toEqual({
      containerName: "nginx",
    });
  });
});

describe("NcsClient.getWorkloadEvents", () => {
  beforeEach(() => vi.resetAllMocks());

  it("{ header, events: [...] } 에서 events 반환", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse(
        {
          header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
          events: [
            {
              type: "Normal",
              reason: "Scheduled",
              message: "Successfully assigned",
              createTimestamp: "2024-10-27T22:29:06Z",
              lastTimestamp: "2024-10-27T22:29:06Z",
              count: 1,
            },
          ],
        },
        { "x-total-count": "1" },
      ),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.getWorkloadEvents("wl-1", "task-1");
    expect(result.totalCount).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].reason).toBe("Scheduled");
  });

  it("events 누락 시 빈 배열 반환 (방어)", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.getWorkloadEvents("wl-1", "task-1");
    expect(result.events).toEqual([]);
    expect(result.totalCount).toBe(0);
  });

  it("제공된 from·to를 그대로 전달하고 생략된 필드는 만들지 않는다", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
        events: [],
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await client.getWorkloadEvents("wl-1", "task-1", {
      from: "2026-07-28T12:00:00Z",
      to: "2026-07-28T12:30:00Z",
    });
    expect(vi.mocked(ky.get).mock.calls[0]?.[1]?.searchParams).toEqual({
      from: "2026-07-28T12:00:00Z",
      to: "2026-07-28T12:30:00Z",
    });

    vi.mocked(ky.get).mockClear();
    await client.getWorkloadEvents("wl-1", "task-1");
    expect(vi.mocked(ky.get).mock.calls[0]?.[1]?.searchParams).toEqual({});
  });
});

describe("NcsClient.listWorkloadHistory", () => {
  beforeEach(() => vi.resetAllMocks());

  it("{ header, history: [...] } 에서 history 반환", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse(
        {
          header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
          history: [
            {
              id: 1,
              createdAt: "2024-10-27T22:29:05.996Z",
              deletedAt: null,
              templateId: "tmpl-1",
              templateVersion: "first",
              name: "nginx-template",
              status: "Succeeded",
            },
          ],
        },
        { "x-total-count": "1" },
      ),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.listWorkloadHistory("wl-1");
    expect(result.totalCount).toBe(1);
    expect(result.history[0].status).toBe("Succeeded");
  });
});

describe("NcsClient.getWorkloadHistory", () => {
  beforeEach(() => vi.resetAllMocks());

  it("{ header, history: {...}, template: {...} } 에서 history+template 병합 반환", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
        history: {
          id: 1,
          createdAt: "2024-10-27T22:29:05.996Z",
          deletedAt: null,
          templateId: "tmpl-1",
          name: "nginx-template",
          status: "Succeeded",
        },
        template: { id: "tmpl-1", name: "nginx-template" },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.getWorkloadHistory("wl-1", "1");
    expect(result.id).toBe(1);
    expect(result.template).toMatchObject({ id: "tmpl-1" });
  });

  it("history 필드 누락 시 형식 오류 throw (EXIT_API_ERROR)", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await expect(client.getWorkloadHistory("wl-1", "1")).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });
});

describe("NcsClient.getWorkloadScheduleHistory", () => {
  beforeEach(() => vi.resetAllMocks());

  it("{ header, schedulehistory: [...] } 에서 scheduleHistory 반환", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
        schedulehistory: [
          {
            id: "job-1",
            createdAt: "2024-10-27T22:48:00Z",
            finishedAt: "2024-10-27T22:48:45Z",
            status: "Completed",
          },
        ],
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.getWorkloadScheduleHistory("wl-1");
    expect(result.scheduleHistory).toHaveLength(1);
    expect(result.scheduleHistory[0].status).toBe("Completed");
  });

  it("schedulehistory 누락 시 빈 배열 반환 (방어)", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.getWorkloadScheduleHistory("wl-1");
    expect(result.scheduleHistory).toEqual([]);
  });
});

describe("NcsClient.createTemplate", () => {
  beforeEach(() => vi.resetAllMocks());

  it("{ header, template: {...} } 에서 template 반환", async () => {
    vi.mocked(ky.post).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
        template: { id: "tmpl-1", name: "nginx-template" },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.createTemplate({ name: "nginx-template" });
    expect(result.id).toBe("tmpl-1");
    expect(ky.post).toHaveBeenCalledWith(
      expect.stringContaining("/templates"),
      expect.objectContaining({ json: { name: "nginx-template" } }),
    );
  });

  it("template 필드 누락 시 형식 오류 throw (EXIT_API_ERROR)", async () => {
    vi.mocked(ky.post).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await expect(client.createTemplate({})).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });
});

describe("NcsClient.deleteTemplate", () => {
  beforeEach(() => vi.resetAllMocks());

  it("DELETE /templates/{id} 를 호출한다", async () => {
    vi.mocked(ky.delete).mockReturnValue(
      mockKyResponse({ header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" } }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await client.deleteTemplate("tmpl-1");

    expect(ky.delete).toHaveBeenCalledWith(
      expect.stringContaining("/templates/tmpl-1"),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("isSuccessful=false 면 throw (봉투 실패 삼키지 않음, EXIT_API_ERROR)", async () => {
    vi.mocked(ky.delete).mockReturnValue(
      mockKyResponse({ header: { isSuccessful: false, resultCode: 500, resultMessage: "FAIL" } }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await expect(client.deleteTemplate("tmpl-1")).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });
});

describe("NcsClient.createTemplateVersion", () => {
  beforeEach(() => vi.resetAllMocks());

  it("{ header, version: {...} } 에서 version 반환", async () => {
    vi.mocked(ky.post).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
        version: { id: "tmpl-1", version: "3" },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.createTemplateVersion("tmpl-1", { sourceVersion: "2" });
    expect(result.version).toBe("3");
    expect(ky.post).toHaveBeenCalledWith(
      expect.stringContaining("/templates/tmpl-1/versions"),
      expect.objectContaining({ json: { sourceVersion: "2" } }),
    );
  });

  it("version 필드 누락 시 형식 오류 throw (EXIT_API_ERROR)", async () => {
    vi.mocked(ky.post).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await expect(client.createTemplateVersion("tmpl-1", { sourceVersion: "2" })).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });
});

describe("NcsClient.deleteTemplateVersion", () => {
  beforeEach(() => vi.resetAllMocks());

  it("DELETE /templates/{id}/versions/{version} 를 호출한다", async () => {
    vi.mocked(ky.delete).mockReturnValue(
      mockKyResponse({ header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" } }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await client.deleteTemplateVersion("tmpl-1", "3");

    expect(ky.delete).toHaveBeenCalledWith(
      expect.stringContaining("/templates/tmpl-1/versions/3"),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("isSuccessful=false 면 throw (EXIT_API_ERROR)", async () => {
    vi.mocked(ky.delete).mockReturnValue(
      mockKyResponse({ header: { isSuccessful: false, resultCode: 500, resultMessage: "FAIL" } }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await expect(client.deleteTemplateVersion("tmpl-1", "3")).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });
});

describe("NcsClient.createWorkload", () => {
  beforeEach(() => vi.resetAllMocks());

  it("{ header, workload: {...} } 에서 생성된 workload 전체를 반환한다 (id 만 반환하는 축약 응답 아님)", async () => {
    vi.mocked(ky.post).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
        workload: {
          id: "wl-1",
          name: "ncs-workload",
          status: "",
          desired: 1,
          templateId: "tmpl-1",
        },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.createWorkload({ name: "ncs-workload", templateId: "tmpl-1", desired: 1 });
    expect(result.id).toBe("wl-1");
    expect(result.desired).toBe(1);
    expect(ky.post).toHaveBeenCalledWith(
      expect.stringContaining("/workloads"),
      expect.objectContaining({ json: { name: "ncs-workload", templateId: "tmpl-1", desired: 1 } }),
    );
  });

  it("workload 필드 누락 시 형식 오류 throw (EXIT_API_ERROR)", async () => {
    vi.mocked(ky.post).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await expect(client.createWorkload({})).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });
});

describe("NcsClient.updateWorkload", () => {
  beforeEach(() => vi.resetAllMocks());

  it("PUT /workloads/{id} 로 교체된 workload 전체를 반환한다", async () => {
    vi.mocked(ky.put).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
        workload: { id: "wl-1", name: "ncs-workload", status: "Running", desired: 2 },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.updateWorkload("wl-1", { name: "ncs-workload", desired: 2 });
    expect(result.desired).toBe(2);
    expect(ky.put).toHaveBeenCalledWith(
      expect.stringContaining("/workloads/wl-1"),
      expect.objectContaining({ json: { name: "ncs-workload", desired: 2 } }),
    );
  });
});

describe("NcsClient.patchWorkload", () => {
  beforeEach(() => vi.resetAllMocks());

  it("PATCH /workloads/{id} 를 application/json-patch+json Content-Type 으로 호출한다", async () => {
    vi.mocked(ky.patch).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
        workload: { id: "wl-1", name: "ncs-workload", status: "Running", desired: 3 },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const patch = [{ op: "replace", path: "/workload/desired", value: 3 }];
    const result = await client.patchWorkload("wl-1", patch);
    expect(result.desired).toBe(3);
    expect(ky.patch).toHaveBeenCalledWith(
      expect.stringContaining("/workloads/wl-1"),
      expect.objectContaining({
        json: patch,
        headers: expect.objectContaining({ "Content-Type": "application/json-patch+json" }),
      }),
    );
  });
});

describe("NcsClient.waitForRunning", () => {
  beforeEach(() => vi.resetAllMocks());

  it("1회차 Pending → 2회차 Running 이면 Running 워크로드를 반환한다", async () => {
    vi.mocked(ky.get)
      .mockReturnValueOnce(
        mockKyResponse({
          header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
          workload: { id: "wl-1", name: "ncs-workload", status: "Pending" },
        }),
      )
      .mockReturnValueOnce(
        mockKyResponse({
          header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
          workload: { id: "wl-1", name: "ncs-workload", status: "Running" },
        }),
      );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.waitForRunning("wl-1", { timeoutMs: 5_000, intervalMs: 5 });
    expect(result.status).toBe("Running");
    expect(ky.get).toHaveBeenCalledTimes(2);
  });

  it("타임아웃까지 Running 이 되지 않으면 EXIT_API_ERROR 를 throw 한다", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
        workload: { id: "wl-1", name: "ncs-workload", status: "Pending" },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await expect(
      client.waitForRunning("wl-1", { timeoutMs: 30, intervalMs: 10 }),
    ).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });
});

describe("NcsClient.pauseWorkload", () => {
  beforeEach(() => vi.resetAllMocks());

  it("POST /workloads/{id}/pause 를 호출한다", async () => {
    vi.mocked(ky.post).mockReturnValue(
      mockKyResponse({ header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" } }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await client.pauseWorkload("wl-1");

    expect(ky.post).toHaveBeenCalledWith(
      expect.stringContaining("/workloads/wl-1/pause"),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("isSuccessful=false 면 throw (EXIT_API_ERROR)", async () => {
    vi.mocked(ky.post).mockReturnValue(
      mockKyResponse({ header: { isSuccessful: false, resultCode: 500, resultMessage: "FAIL" } }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await expect(client.pauseWorkload("wl-1")).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });
});

describe("NcsClient.resumeWorkload", () => {
  beforeEach(() => vi.resetAllMocks());

  it("POST /workloads/{id}/resume 를 호출한다", async () => {
    vi.mocked(ky.post).mockReturnValue(
      mockKyResponse({ header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" } }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await client.resumeWorkload("wl-1");

    expect(ky.post).toHaveBeenCalledWith(
      expect.stringContaining("/workloads/wl-1/resume"),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("isSuccessful=false 면 throw (EXIT_API_ERROR)", async () => {
    vi.mocked(ky.post).mockReturnValue(
      mockKyResponse({ header: { isSuccessful: false, resultCode: 500, resultMessage: "FAIL" } }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await expect(client.resumeWorkload("wl-1")).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });
});

describe("NcsClient.restartWorkloadTask", () => {
  beforeEach(() => vi.resetAllMocks());

  it("POST /workloads/{id}/tasks/{taskId}/restart 를 호출한다", async () => {
    vi.mocked(ky.post).mockReturnValue(
      mockKyResponse({ header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" } }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await client.restartWorkloadTask("wl-1", "task-1");

    expect(ky.post).toHaveBeenCalledWith(
      expect.stringContaining("/workloads/wl-1/tasks/task-1/restart"),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("isSuccessful=false 면 throw (EXIT_API_ERROR)", async () => {
    vi.mocked(ky.post).mockReturnValue(
      mockKyResponse({ header: { isSuccessful: false, resultCode: 500, resultMessage: "FAIL" } }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await expect(client.restartWorkloadTask("wl-1", "task-1")).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });
});

describe("NcsClient.deleteWorkload", () => {
  beforeEach(() => vi.resetAllMocks());

  it("DELETE /workloads/{id} 를 호출한다", async () => {
    vi.mocked(ky.delete).mockReturnValue(
      mockKyResponse({ header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" } }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await client.deleteWorkload("wl-1");

    expect(ky.delete).toHaveBeenCalledWith(
      expect.stringContaining("/workloads/wl-1"),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("isSuccessful=false 면 throw (EXIT_API_ERROR)", async () => {
    vi.mocked(ky.delete).mockReturnValue(
      mockKyResponse({ header: { isSuccessful: false, resultCode: 500, resultMessage: "FAIL" } }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await expect(client.deleteWorkload("wl-1")).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });
});

describe("NcsClient.getMalwareConfig", () => {
  beforeEach(() => vi.resetAllMocks());

  it("{ header, enabled: true } (named 필드 아닌 flat 응답) 에서 enabled 를 반환한다", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
        enabled: true,
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.getMalwareConfig();
    expect(result.enabled).toBe(true);
    expect(ky.get).toHaveBeenCalledWith(
      expect.stringContaining("/malware/config"),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("enabled 필드 누락 시 형식 오류 throw (EXIT_API_ERROR)", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await expect(client.getMalwareConfig()).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });
});

describe("NcsClient.setMalwareConfig", () => {
  beforeEach(() => vi.resetAllMocks());

  it("POST /malware/config 로 { enabled: boolean } body 를 전송하고 결과를 반환한다", async () => {
    vi.mocked(ky.post).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
        enabled: false,
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.setMalwareConfig(false);
    expect(result.enabled).toBe(false);
    expect(ky.post).toHaveBeenCalledWith(
      expect.stringContaining("/malware/config"),
      expect.objectContaining({ json: { enabled: false } }),
    );
  });
});

describe("NcsClient.getMalwareResult", () => {
  beforeEach(() => vi.resetAllMocks());

  it("{ header, scannedAt, infectedFiles, reports: [...] } (flat 응답) 에서 결과를 반환한다", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
        scannedAt: "2025-10-28T00:00:00Z",
        infectedFiles: 0,
        scannedDirectories: 689,
        scannedFiles: 4210,
        reports: [
          { image: "nginx:latest", digest: "sha256:abc", layer: "sha256:def", detection: "-", result: "Clean" },
        ],
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.getMalwareResult("wl-1", "hist-1");
    expect(result.scannedAt).toBe("2025-10-28T00:00:00Z");
    expect(result.reports).toHaveLength(1);
    expect(result.reports?.[0].result).toBe("Clean");
    expect(ky.get).toHaveBeenCalledWith(
      expect.stringContaining("/workloads/wl-1/history/hist-1/malware"),
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("reports 누락 시 빈 배열 반환 (방어)", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    const result = await client.getMalwareResult("wl-1", "hist-1");
    expect(result.reports).toEqual([]);
  });

  it("reports 가 배열이 아니면 형식 오류 throw (조용히 삼키지 않음, EXIT_API_ERROR)", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: true, resultCode: 200, resultMessage: "SUCCESS" },
        reports: "not-an-array",
      }),
    );

    const client = new NcsClient("token", "kr1", "test-appkey");
    await expect(client.getMalwareResult("wl-1", "hist-1")).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });
});
