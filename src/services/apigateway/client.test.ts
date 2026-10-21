import { beforeEach, describe, expect, it, vi } from "vitest";
import ky from "ky";
import { ApiGatewayClient } from "./client.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR, EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import {
  DEPLOY_STATUS_COMPLETE,
  DEPLOY_STATUS_DEPLOYING,
  DEPLOY_STATUS_FAILURE,
  isWrittenStageResource,
} from "./types.js";

vi.mock("ky");

const successfulHeader = {
  isSuccessful: true,
  resultCode: 0,
  resultMessage: "SUCCESS",
};

function service(id: string, dedicatedId: string | null = null) {
  return {
    apigwServiceId: id,
    apigwServiceAlias: `alias-${id}`,
    apigwServiceName: `service-${id}`,
    apigwServiceDescription: `description-${id}`,
    apigwDomain: `${id}.example.com`,
    appKey: "test-appkey",
    regionCode: "kr1",
    serverGroupId: "server-group-id",
    dedicatedId,
    createdAt: "2026-08-01T00:00:00+09:00",
    updatedAt: "2026-08-02T00:00:00+09:00",
    apigwServiceTypeCode: "BASIC",
  };
}

function resource(id: string) {
  return {
    resourceId: id,
    apigwServiceId: "service-1",
    parentPath: null,
    path: "/pets",
    methodType: null,
    methodName: null,
    methodDescription: null,
    createdAt: "2026-08-01T00:00:00+09:00",
    updatedAt: "2026-08-02T00:00:00+09:00",
    resourcePluginList: [],
  };
}

function stage(id: string, stageName: string | null = null) {
  return {
    stageId: id,
    apigwServiceId: "service-1",
    regionCode: "kr1",
    stageName,
    stageDescription: `description-${id}`,
    stageUrl: `https://${id}.example.com`,
    backendEndpointUrl: "https://backend.example.com",
    resourceUpdatedAt: "2026-08-03T00:00:00+09:00",
    createdAt: "2026-08-01T00:00:00+09:00",
    updatedAt: "2026-08-02T00:00:00+09:00",
    stageCustomUrl: `https://custom-${id}.example.com`,
    stageCustomDomainList: [
      { customDomain: `custom-${id}.example.com`, createdAt: "2026-08-01T00:00:00+09:00" },
    ],
    stageAliasDomainList: [
      { aliasDomain: `alias-${id}.example.com`, createdAt: "2026-08-01T00:00:00+09:00" },
    ],
  };
}

function updatedStage(id: string) {
  return {
    stageId: id,
    stageName: null,
    stageUrl: `https://${id}.example.com`,
    backendEndpointUrl: "https://updated-backend.example.com",
    updatedAt: "2026-08-11T00:00:00+09:00",
  };
}

function updatedResource(id: string, path: string) {
  return { resourceId: id, path };
}

function stageResource(id: string) {
  return {
    stageResourceId: id,
    path: "/pets",
    methodType: null,
    methodName: null,
    methodDescription: null,
    customBackendEndpointUrl: null,
    updatedAt: "2026-08-02T00:00:00+09:00",
    stageResourcePluginList: [{ pluginType: "CORS" }],
  };
}

function deployHistory(id: string) {
  return {
    deployId: id,
    stageId: "stage-1",
    deployedAt: "2026-08-03T00:00:00+09:00",
    rollbackAt: null,
    deployDescription: `deploy-${id}`,
    isBase: false,
  };
}

function latestDeploy(id: string, deployStatus: string) {
  return {
    ...deployHistory(id),
    deployStatus,
    stageResourceList: [],
  };
}

function mockKyResponse(body: unknown) {
  return { json: async () => body } as never;
}

describe("isWrittenStageResource", () => {
  it("customEndpointUrl 만 있는 롤백 응답 예시를 허용한다", () => {
    expect(
      isWrittenStageResource({
        stageResourceId: "stage-resource-1",
        path: "/",
        methodType: null,
        methodName: null,
        customEndpointUrl: null,
        stageResourcePluginList: [],
      }),
    ).toBe(true);
  });

  it("customBackendEndpointUrl 이 있는 조회형 응답도 허용한다", () => {
    expect(
      isWrittenStageResource({
        stageResourceId: "stage-resource-1",
        path: "/",
        customBackendEndpointUrl: null,
      }),
    ).toBe(true);
  });

  it("stageResourcePluginList 가 없는 응답을 허용한다", () => {
    expect(isWrittenStageResource({ stageResourceId: "stage-resource-1", path: "/" })).toBe(
      true,
    );
  });

  it.each([
    { path: "/" },
    { stageResourceId: "stage-resource-1" },
  ])("stageResourceId 나 path 가 없으면 거부한다", (value) => {
    expect(isWrittenStageResource(value)).toBe(false);
  });

  it("optional 필드가 있을 때 형식이 어긋나면 거부한다", () => {
    expect(
      isWrittenStageResource({
        stageResourceId: "stage-resource-1",
        path: "/",
        methodType: 1,
      }),
    ).toBe(false);
    expect(
      isWrittenStageResource({
        stageResourceId: "stage-resource-1",
        path: "/",
        stageResourcePluginList: [null],
      }),
    ).toBe(false);
  });
});

describe("ApiGatewayClient.listServices", () => {
  beforeEach(() => vi.resetAllMocks());

  it("공공망 profile은 공공망 kr1 주소로 조회한다", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({ header: successfulHeader, apigwServiceList: [], paging: { limit: 100, page: 1, totalCount: 0 } }),
    );

    await new ApiGatewayClient("access-token", "kr1", "test-appkey", "gov").listServices();

    expect(ky.get).toHaveBeenCalledWith(
      "https://kr1-apigateway.api.gov-nhncloudservice.com/v2.0/appkeys/test-appkey/services",
      expect.any(Object),
    );
  });

  it("paging.totalCount까지 전수 수집하고 X-NHN-Authorization을 사용한다", async () => {
    vi.mocked(ky.get)
      .mockReturnValueOnce(
        mockKyResponse({
          header: successfulHeader,
          apigwServiceList: [service("service-1")],
          paging: { limit: 1, page: 1, totalCount: 2 },
        }),
      )
      .mockReturnValueOnce(
        mockKyResponse({
          header: successfulHeader,
          apigwServiceList: [service("service-2", "dedicated-id")],
          paging: { limit: 1, page: 2, totalCount: 2 },
        }),
      );

    const client = new ApiGatewayClient("access-token", "kr1", "test-appkey");
    const result = await client.listServices({ limit: 1 });

    expect(result.map((item) => item.apigwServiceId)).toEqual(["service-1", "service-2"]);
    expect(result[0]?.dedicatedId).toBeNull();
    expect(ky.get).toHaveBeenCalledTimes(2);
    expect(ky.get).toHaveBeenNthCalledWith(
      1,
      "https://kr1-apigateway.api.nhncloudservice.com/v2.0/appkeys/test-appkey/services",
      expect.objectContaining({
        headers: { "X-NHN-Authorization": "Bearer access-token" },
        searchParams: { page: 1, limit: 1 },
        retry: 0,
        timeout: expect.any(Number),
      }),
    );
    expect(ky.get).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({ searchParams: { page: 2, limit: 1 } }),
    );
  });

  it("dedicatedId가 null인 service 응답을 거르지 않는다", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: successfulHeader,
        apigwServiceList: [service("service-1", null)],
        paging: { limit: 1000, page: 1, totalCount: 1 },
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(client.listServices()).resolves.toHaveLength(1);
  });

  it("service 항목 형식이 올바르지 않으면 EXIT_API_ERROR", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: successfulHeader,
        apigwServiceList: [{ ...service("service-1"), dedicatedId: 123 }],
        paging: { limit: 1000, page: 1, totalCount: 1 },
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(client.listServices()).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });

  it("isSuccessful=false면 EXIT_API_ERROR", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: false, resultCode: 403100000, resultMessage: "Permission denied" },
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(client.listServices()).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });

  it("미등록 region이면 client 생성 시 EXIT_PARAM_ERROR", () => {
    expect(() => new ApiGatewayClient("token", "xx", "appkey")).toThrow(
      expect.objectContaining({ exitCode: EXIT_PARAM_ERROR }),
    );
  });
});

describe("ApiGatewayClient.getService", () => {
  beforeEach(() => vi.resetAllMocks());

  it("apigwService 단건을 반환하고 ID를 URL 인코딩한다", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({ header: successfulHeader, apigwService: service("service-1") }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(client.getService("service/id")).resolves.toMatchObject({
      apigwServiceId: "service-1",
      dedicatedId: null,
    });
    expect(ky.get).toHaveBeenCalledWith(
      expect.stringContaining("/services/service%2Fid"),
      expect.objectContaining({
        headers: { "X-NHN-Authorization": "Bearer token" },
        retry: 0,
        timeout: expect.any(Number),
      }),
    );
  });

  it("apigwService 필드가 없으면 EXIT_API_ERROR", async () => {
    vi.mocked(ky.get).mockReturnValue(mockKyResponse({ header: successfulHeader }));

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(client.getService("service-1")).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });

  it("isSuccessful=false면 EXIT_API_ERROR", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: false, resultCode: 4041007, resultMessage: "URL Not Found" },
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(client.getService("service-1")).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });

  it("이미 변환된 NhnCloudCliError를 그대로 보존한다", async () => {
    const error = new NhnCloudCliError("API 호출 실패 (404)", EXIT_API_ERROR);
    vi.mocked(ky.get).mockReturnValue({ json: async () => { throw error; } } as never);

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(client.getService("service-1")).rejects.toBe(error);
  });
});

describe("ApiGatewayClient.listResources", () => {
  beforeEach(() => vi.resetAllMocks());

  it("paging 없이 한 번만 조회하고 nullable resource 필드를 허용한다", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({ header: successfulHeader, resourceList: [resource("resource-1")] }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    const result = await client.listResources("service/id");

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      parentPath: null,
      methodType: null,
      methodName: null,
      methodDescription: null,
    });
    expect(ky.get).toHaveBeenCalledTimes(1);
    expect(ky.get).toHaveBeenCalledWith(
      expect.stringContaining("/services/service%2Fid/resources"),
      expect.objectContaining({
        headers: { "X-NHN-Authorization": "Bearer token" },
        retry: 0,
        timeout: expect.any(Number),
      }),
    );
    expect(vi.mocked(ky.get).mock.calls[0]?.[1]).not.toHaveProperty("searchParams");
  });

  it("isSuccessful=false면 EXIT_API_ERROR", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: false, resultCode: 403100000, resultMessage: "Permission denied" },
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(client.listResources("service-1")).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });
});

describe("ApiGatewayClient 봉투 leak 방지", () => {
  beforeEach(() => vi.resetAllMocks());

  it("getResourceParameters 는 header 를 반환값에 담지 않는다", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: successfulHeader,
        queryStringList: [],
        headerList: [],
        formDataList: [],
        requestBody: { name: null, description: null, modelId: null },
        contentTypeList: [],
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    const result = await client.getResourceParameters("service-1", "resource-1");

    // objectContaining 은 잉여 키를 통과시키므로 키 집합을 정확히 단언한다.
    expect(Object.keys(result).sort()).toEqual(
      ["contentTypeList", "formDataList", "headerList", "queryStringList", "requestBody"].sort(),
    );
    expect(result).not.toHaveProperty("header");
  });

  it("getResourceResponses 는 header 를 반환값에 담지 않는다", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: successfulHeader,
        responseList: [],
        contentTypeList: [],
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    const result = await client.getResourceResponses("service-1", "resource-1");

    expect(Object.keys(result).sort()).toEqual(["contentTypeList", "responseList"].sort());
    expect(result).not.toHaveProperty("header");
  });
});

describe("ApiGatewayClient.getResourceParameters", () => {
  beforeEach(() => vi.resetAllMocks());

  it("빈 배열과 nullable requestBody를 정상 응답으로 반환한다", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: successfulHeader,
        queryStringList: [],
        headerList: [],
        formDataList: [],
        requestBody: { name: null, description: null, modelId: null },
        contentTypeList: [],
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(client.getResourceParameters("service/id", "resource/id")).resolves.toEqual(
      expect.objectContaining({
        queryStringList: [],
        requestBody: { name: null, description: null, modelId: null },
      }),
    );
    expect(ky.get).toHaveBeenCalledWith(
      expect.stringContaining("/services/service%2Fid/resources/resource%2Fid/parameters"),
      expect.objectContaining({
        headers: { "X-NHN-Authorization": "Bearer token" },
        retry: 0,
        timeout: expect.any(Number),
      }),
    );
  });

  it("isSuccessful=false면 EXIT_API_ERROR", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: false, resultCode: 4041007, resultMessage: "URL Not Found" },
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(client.getResourceParameters("service-1", "resource-1")).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });
});

describe("ApiGatewayClient.getResourceResponses", () => {
  beforeEach(() => vi.resetAllMocks());

  it("빈 responseList와 contentTypeList를 정상 응답으로 반환한다", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: successfulHeader,
        responseList: [],
        contentTypeList: [],
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(client.getResourceResponses("service/id", "resource/id")).resolves.toEqual(
      expect.objectContaining({ responseList: [], contentTypeList: [] }),
    );
    expect(ky.get).toHaveBeenCalledWith(
      expect.stringContaining("/services/service%2Fid/resources/resource%2Fid/responses"),
      expect.objectContaining({
        headers: { "X-NHN-Authorization": "Bearer token" },
        retry: 0,
        timeout: expect.any(Number),
      }),
    );
  });

  it("isSuccessful=false면 EXIT_API_ERROR", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: false, resultCode: 4041007, resultMessage: "URL Not Found" },
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(client.getResourceResponses("service-1", "resource-1")).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });
});

describe("ApiGatewayClient.listStages", () => {
  beforeEach(() => vi.resetAllMocks());

  it("두 페이지를 전수 수집하고 stageName null과 중첩 도메인을 허용한다", async () => {
    vi.mocked(ky.get)
      .mockReturnValueOnce(
        mockKyResponse({
          header: successfulHeader,
          stageList: [stage("stage-1")],
          paging: { limit: 1, page: 1, totalCount: 2 },
        }),
      )
      .mockReturnValueOnce(
        mockKyResponse({
          header: successfulHeader,
          stageList: [stage("stage-2", "production")],
          paging: { limit: 1, page: 2, totalCount: 2 },
        }),
      );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    const result = await client.listStages("service/id");

    expect(result.map((item) => item.stageId)).toEqual(["stage-1", "stage-2"]);
    expect(result[0]?.stageName).toBeNull();
    expect(ky.get).toHaveBeenCalledTimes(2);
    expect(ky.get).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("/services/service%2Fid/stages"),
      expect.objectContaining({
        headers: { "X-NHN-Authorization": "Bearer token" },
        searchParams: { page: 1, limit: 1000 },
      }),
    );
    expect(ky.get).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({ searchParams: { page: 2, limit: 1000 } }),
    );
  });

  it("isSuccessful=false면 EXIT_API_ERROR", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: false, resultCode: 403100000, resultMessage: "Permission denied" },
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(client.listStages("service-1")).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });
});

describe("ApiGatewayClient.getStageSwagger", () => {
  beforeEach(() => vi.resetAllMocks());

  it("사용자 정의 객체를 내부 필드 검증 없이 반환한다", async () => {
    const swaggerData = { arbitrary: { nested: true }, list: [1, "two"] };
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({ header: successfulHeader, swaggerData }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(client.getStageSwagger("service/id", "stage/id")).resolves.toEqual(swaggerData);
    expect(ky.get).toHaveBeenCalledWith(
      expect.stringContaining("/services/service%2Fid/stages/stage%2Fid/swagger"),
      expect.objectContaining({ headers: { "X-NHN-Authorization": "Bearer token" } }),
    );
  });

  it("isSuccessful=false면 EXIT_API_ERROR", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: false, resultCode: 4041007, resultMessage: "URL Not Found" },
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(client.getStageSwagger("service-1", "stage-1")).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });
});

describe("ApiGatewayClient.listStageResources", () => {
  beforeEach(() => vi.resetAllMocks());

  it("paging 없이 한 번만 조회하고 nullable stage resource 필드를 허용한다", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: successfulHeader,
        stageResourceList: [stageResource("stage-resource-1")],
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    const result = await client.listStageResources("service/id", "stage/id");

    expect(result[0]).toMatchObject({
      methodType: null,
      methodName: null,
      methodDescription: null,
      customBackendEndpointUrl: null,
    });
    expect(ky.get).toHaveBeenCalledTimes(1);
    expect(ky.get).toHaveBeenCalledWith(
      expect.stringContaining("/services/service%2Fid/stages/stage%2Fid/resources"),
      expect.objectContaining({ headers: { "X-NHN-Authorization": "Bearer token" } }),
    );
    expect(vi.mocked(ky.get).mock.calls[0]?.[1]).not.toHaveProperty("searchParams");
  });

  it("isSuccessful=false면 EXIT_API_ERROR", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: false, resultCode: 403100000, resultMessage: "Permission denied" },
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(client.listStageResources("service-1", "stage-1")).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });
});

describe("ApiGatewayClient.importStageResources", () => {
  beforeEach(() => vi.resetAllMocks());

  it("반영 응답을 반환하고 요청 본문 없이 PUT 호출한다", async () => {
    const stageResourceList = [
      { stageResourceId: "stage-resource-1", path: "/", customEndpointUrl: null },
    ];
    vi.mocked(ky.put).mockReturnValue(
      mockKyResponse({ header: successfulHeader, stageResourceList }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(client.importStageResources("service/id", "stage/id")).resolves.toEqual(
      stageResourceList,
    );
    expect(ky.put).toHaveBeenCalledWith(
      "https://kr1-apigateway.api.nhncloudservice.com/v2.0/appkeys/appkey/services/service%2Fid/stages/stage%2Fid/resources",
      {
        headers: { "X-NHN-Authorization": "Bearer token" },
        retry: 0,
        timeout: expect.any(Number),
      },
    );
    expect(vi.mocked(ky.put).mock.calls[0]?.[1]).not.toHaveProperty("json");
  });

  it("반영 응답 필수 필드가 빠지면 EXIT_API_ERROR 로 거부한다", async () => {
    vi.mocked(ky.put).mockReturnValue(
      mockKyResponse({
        header: successfulHeader,
        stageResourceList: [{ stageResourceId: "stage-resource-1" }],
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(
      client.importStageResources("service-1", "stage-1"),
    ).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });

  it("HTTP 200의 isSuccessful=false를 EXIT_API_ERROR로 거부한다", async () => {
    vi.mocked(ky.put).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: false, resultCode: 500, resultMessage: "FAILURE" },
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(
      client.importStageResources("service-1", "stage-1"),
    ).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });
});

describe("ApiGatewayClient.createDeploy", () => {
  beforeEach(() => vi.resetAllMocks());

  it("배포 설명을 본문에 담고 공통 헤더 응답을 검사한다", async () => {
    vi.mocked(ky.post).mockReturnValue(mockKyResponse({ header: successfulHeader }));

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(
      client.createDeploy("service/id", "stage/id", { deployDescription: "release" }),
    ).resolves.toBeUndefined();
    expect(ky.post).toHaveBeenCalledWith(
      "https://kr1-apigateway.api.nhncloudservice.com/v2.0/appkeys/appkey/services/service%2Fid/stages/stage%2Fid/deploys",
      {
        headers: { "X-NHN-Authorization": "Bearer token" },
        json: { deployDescription: "release" },
        retry: 0,
        timeout: expect.any(Number),
      },
    );
  });

  it("배포 설명이 없으면 빈 객체 본문을 보낸다", async () => {
    vi.mocked(ky.post).mockReturnValue(mockKyResponse({ header: successfulHeader }));

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await client.createDeploy("service-1", "stage-1", {});

    expect(ky.post).toHaveBeenCalledWith(
      expect.stringContaining("/services/service-1/stages/stage-1/deploys"),
      expect.objectContaining({ json: {} }),
    );
  });

  it("HTTP 200의 isSuccessful=false를 EXIT_API_ERROR로 거부한다", async () => {
    vi.mocked(ky.post).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: false, resultCode: 500, resultMessage: "FAILURE" },
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(
      client.createDeploy("service-1", "stage-1", {}),
    ).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });
});

describe("ApiGatewayClient.rollbackDeploy", () => {
  beforeEach(() => vi.resetAllMocks());

  it("롤백 응답을 반환하고 요청 본문 없이 POST 호출한다", async () => {
    const stageResourceList = [
      { stageResourceId: "stage-resource-1", path: "/", customEndpointUrl: null },
    ];
    vi.mocked(ky.post).mockReturnValue(
      mockKyResponse({ header: successfulHeader, stageResourceList }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(
      client.rollbackDeploy("service/id", "stage/id", "deploy/id"),
    ).resolves.toEqual(stageResourceList);
    expect(ky.post).toHaveBeenCalledWith(
      "https://kr1-apigateway.api.nhncloudservice.com/v2.0/appkeys/appkey/services/service%2Fid/stages/stage%2Fid/deploys/deploy%2Fid/rollback",
      {
        headers: { "X-NHN-Authorization": "Bearer token" },
        retry: 0,
        timeout: expect.any(Number),
      },
    );
    expect(vi.mocked(ky.post).mock.calls[0]?.[1]).not.toHaveProperty("json");
  });

  it("롤백 응답 필수 필드가 빠지면 EXIT_API_ERROR 로 거부한다", async () => {
    vi.mocked(ky.post).mockReturnValue(
      mockKyResponse({
        header: successfulHeader,
        stageResourceList: [{ stageResourceId: "stage-resource-1" }],
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(
      client.rollbackDeploy("service-1", "stage-1", "deploy-1"),
    ).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });

  it("HTTP 200의 isSuccessful=false를 EXIT_API_ERROR로 거부한다", async () => {
    vi.mocked(ky.post).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: false, resultCode: 500, resultMessage: "FAILURE" },
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(
      client.rollbackDeploy("service-1", "stage-1", "deploy-1"),
    ).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });
});

describe("ApiGatewayClient.listDeploys", () => {
  beforeEach(() => vi.resetAllMocks());

  it("두 페이지를 전수 수집하고 rollbackAt null을 허용한다", async () => {
    vi.mocked(ky.get)
      .mockReturnValueOnce(
        mockKyResponse({
          header: successfulHeader,
          stageDeployHistoryList: [deployHistory("deploy-1")],
          paging: { limit: 1, page: 1, totalCount: 2 },
        }),
      )
      .mockReturnValueOnce(
        mockKyResponse({
          header: successfulHeader,
          stageDeployHistoryList: [deployHistory("deploy-2")],
          paging: { limit: 1, page: 2, totalCount: 2 },
        }),
      );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    const result = await client.listDeploys("service/id", "stage/id");

    expect(result.map((item) => item.deployId)).toEqual(["deploy-1", "deploy-2"]);
    expect(result[0]?.rollbackAt).toBeNull();
    expect(ky.get).toHaveBeenCalledTimes(2);
    expect(ky.get).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("/services/service%2Fid/stages/stage%2Fid/deploys"),
      expect.objectContaining({ searchParams: { page: 2, limit: 1000 } }),
    );
  });

  it("isSuccessful=false면 EXIT_API_ERROR", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: false, resultCode: 403100000, resultMessage: "Permission denied" },
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(client.listDeploys("service-1", "stage-1")).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });
});

describe("ApiGatewayClient.getLatestDeploy", () => {
  beforeEach(() => vi.resetAllMocks());

  it("최신 배포와 중첩 stage resource를 반환한다", async () => {
    const latestStageDeployResult = {
      ...deployHistory("deploy-latest"),
      deployStatus: "SUCCESS",
      stageResourceList: [stageResource("stage-resource-1")],
    };
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({ header: successfulHeader, latestStageDeployResult }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(client.getLatestDeploy("service/id", "stage/id")).resolves.toEqual(
      latestStageDeployResult,
    );
    expect(ky.get).toHaveBeenCalledWith(
      expect.stringContaining("/services/service%2Fid/stages/stage%2Fid/deploys/latest"),
      expect.objectContaining({ headers: { "X-NHN-Authorization": "Bearer token" } }),
    );
  });

  it("isSuccessful=false면 EXIT_API_ERROR", async () => {
    vi.mocked(ky.get).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: false, resultCode: 4041007, resultMessage: "URL Not Found" },
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(client.getLatestDeploy("service-1", "stage-1")).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });
});

describe("ApiGatewayClient.waitForDeploy", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("DEPLOYING 이후 COMPLETE 가 되면 최종 결과를 반환한다", async () => {
    const client = new ApiGatewayClient("token", "kr1", "appkey");
    const complete = latestDeploy("deploy-2", DEPLOY_STATUS_COMPLETE);
    vi.spyOn(client, "getLatestDeploy")
      .mockResolvedValueOnce(latestDeploy("deploy-2", DEPLOY_STATUS_DEPLOYING))
      .mockResolvedValueOnce(complete);

    await expect(
      client.waitForDeploy("service-1", "stage-1", {
        intervalMs: 1,
        timeoutMs: 1_000,
        baselineDeployId: "deploy-1",
      }),
    ).resolves.toEqual(complete);
    expect(client.getLatestDeploy).toHaveBeenCalledTimes(2);
  });

  it("직전 배포의 COMPLETE 를 이번 배포 결과로 오해하지 않는다", async () => {
    const client = new ApiGatewayClient("token", "kr1", "appkey");
    const current = latestDeploy("deploy-new", DEPLOY_STATUS_COMPLETE);
    vi.spyOn(client, "getLatestDeploy")
      .mockResolvedValueOnce(latestDeploy("deploy-old", DEPLOY_STATUS_COMPLETE))
      .mockResolvedValueOnce(current);

    await expect(
      client.waitForDeploy("service-1", "stage-1", {
        intervalMs: 1,
        timeoutMs: 1_000,
        baselineDeployId: "deploy-old",
      }),
    ).resolves.toEqual(current);
    expect(client.getLatestDeploy).toHaveBeenCalledTimes(2);
  });

  it("baselineDeployId 가 null 이면 deployId 비교 없이 상태로 종료한다", async () => {
    const client = new ApiGatewayClient("token", "kr1", "appkey");
    const complete = latestDeploy("deploy-1", DEPLOY_STATUS_COMPLETE);
    vi.spyOn(client, "getLatestDeploy").mockResolvedValue(complete);

    await expect(
      client.waitForDeploy("service-1", "stage-1", {
        intervalMs: 1,
        timeoutMs: 1_000,
        baselineDeployId: null,
      }),
    ).resolves.toEqual(complete);
    expect(client.getLatestDeploy).toHaveBeenCalledTimes(1);
  });

  it("FAILURE 를 오류로 바꾸지 않고 그대로 반환한다", async () => {
    const client = new ApiGatewayClient("token", "kr1", "appkey");
    const failure = latestDeploy("deploy-2", DEPLOY_STATUS_FAILURE);
    vi.spyOn(client, "getLatestDeploy").mockResolvedValue(failure);

    await expect(
      client.waitForDeploy("service-1", "stage-1", {
        intervalMs: 1,
        timeoutMs: 1_000,
        baselineDeployId: "deploy-1",
      }),
    ).resolves.toEqual(failure);
  });

  it("문서에 없는 상태도 DEPLOYING 이 아니면 그대로 반환한다", async () => {
    const client = new ApiGatewayClient("token", "kr1", "appkey");
    const unknownStatus = latestDeploy("deploy-2", "UNKNOWN_STATUS");
    vi.spyOn(client, "getLatestDeploy").mockResolvedValue(unknownStatus);

    await expect(
      client.waitForDeploy("service-1", "stage-1", {
        intervalMs: 1,
        timeoutMs: 1_000,
        baselineDeployId: "deploy-1",
      }),
    ).resolves.toEqual(unknownStatus);
  });

  it("최신 배포 조회 오류를 삼키지 않고 그대로 전파한다", async () => {
    const client = new ApiGatewayClient("token", "kr1", "appkey");
    const apiError = new NhnCloudCliError("조회 실패", EXIT_API_ERROR);
    vi.spyOn(client, "getLatestDeploy").mockRejectedValue(apiError);

    await expect(
      client.waitForDeploy("service-1", "stage-1", {
        intervalMs: 1,
        timeoutMs: 1_000,
        baselineDeployId: "deploy-1",
      }),
    ).rejects.toBe(apiError);
  });

  it("타임아웃에 마지막 상태·배포 ID·기준 ID를 담아 EXIT_API_ERROR로 종료한다", async () => {
    const client = new ApiGatewayClient("token", "kr1", "appkey");
    vi.spyOn(client, "getLatestDeploy").mockResolvedValue(
      latestDeploy("deploy-2", DEPLOY_STATUS_DEPLOYING),
    );

    const error = await client
      .waitForDeploy("service-1", "stage-1", {
        intervalMs: 2,
        timeoutMs: 10,
        baselineDeployId: "deploy-1",
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NhnCloudCliError);
    expect(error).toMatchObject({ exitCode: EXIT_API_ERROR });
    expect((error as Error).message).toContain(`마지막 상태: ${DEPLOY_STATUS_DEPLOYING}`);
    expect((error as Error).message).toContain("마지막 배포 ID: deploy-2");
    expect((error as Error).message).toContain("기준 배포 ID: deploy-1");
  });
});

describe("ApiGatewayClient.updateStage", () => {
  beforeEach(() => vi.resetAllMocks());

  it("수정 응답 최소 필드를 반환하고 PUT URL·본문을 인코딩해 전달한다", async () => {
    const responseStage = updatedStage("stage-1");
    vi.mocked(ky.put).mockReturnValue(
      mockKyResponse({ header: successfulHeader, stage: responseStage }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    const body = {
      backendEndpointUrl: "https://updated-backend.example.com",
      stageDescription: "updated",
    };

    await expect(client.updateStage("service/id", "stage/id", body)).resolves.toEqual(
      responseStage,
    );
    expect(ky.put).toHaveBeenCalledWith(
      "https://kr1-apigateway.api.nhncloudservice.com/v2.0/appkeys/appkey/services/service%2Fid/stages/stage%2Fid",
      {
        headers: { "X-NHN-Authorization": "Bearer token" },
        json: body,
        retry: 0,
        timeout: expect.any(Number),
      },
    );
  });

  it("HTTP 200의 isSuccessful=false를 EXIT_API_ERROR로 거부한다", async () => {
    vi.mocked(ky.put).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: false, resultCode: 403100000, resultMessage: "Permission denied" },
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(
      client.updateStage("service-1", "stage-1", {
        backendEndpointUrl: "https://backend.example.com",
      }),
    ).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });

  it("수정 응답 필수 필드가 빠지면 EXIT_API_ERROR로 거부한다", async () => {
    const { stageUrl: _stageUrl, ...invalidStage } = updatedStage("stage-1");
    vi.mocked(ky.put).mockReturnValue(
      mockKyResponse({ header: successfulHeader, stage: invalidStage }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(
      client.updateStage("service-1", "stage-1", {
        backendEndpointUrl: "https://backend.example.com",
      }),
    ).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });
});

describe("ApiGatewayClient.setPathPlugins", () => {
  beforeEach(() => vi.resetAllMocks());

  it("최소 resource 수정 응답을 반환하고 resource-paths에 목록 본문을 전달한다", async () => {
    const resourceList = [updatedResource("resource-1", "/private")];
    vi.mocked(ky.put).mockReturnValue(
      mockKyResponse({ header: successfulHeader, resourceList }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    const pathPluginList = [
      {
        pluginType: "CORS",
        pluginConfigJson: { allowedMethods: ["GET"] },
        applyChildPath: true,
      },
    ];

    await expect(
      client.setPathPlugins("service/id", "resource/id", pathPluginList),
    ).resolves.toEqual(resourceList);
    expect(ky.put).toHaveBeenCalledWith(
      "https://kr1-apigateway.api.nhncloudservice.com/v2.0/appkeys/appkey/services/service%2Fid/resource-paths/resource%2Fid",
      {
        headers: { "X-NHN-Authorization": "Bearer token" },
        json: { pathPluginList },
        retry: 0,
        timeout: expect.any(Number),
      },
    );
  });

  it("HTTP 200의 isSuccessful=false를 EXIT_API_ERROR로 거부한다", async () => {
    vi.mocked(ky.put).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: false, resultCode: 403100000, resultMessage: "Permission denied" },
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(
      client.setPathPlugins("service-1", "resource-1", [{ pluginType: "CORS" }]),
    ).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });

  it("resourceList 항목의 최소 필드가 빠지면 EXIT_API_ERROR로 거부한다", async () => {
    vi.mocked(ky.put).mockReturnValue(
      mockKyResponse({
        header: successfulHeader,
        resourceList: [{ resourceId: "resource-1" }],
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(
      client.setPathPlugins("service-1", "resource-1", [{ pluginType: "CORS" }]),
    ).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });
});

describe("ApiGatewayClient.setMethodPlugins", () => {
  beforeEach(() => vi.resetAllMocks());

  it("최소 resource 수정 응답을 반환하고 resource-methods에 본문을 전달한다", async () => {
    const resourceList = [updatedResource("resource-1", "/private")];
    vi.mocked(ky.put).mockReturnValue(
      mockKyResponse({ header: successfulHeader, resourceList }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    const body = {
      methodName: "private-get",
      methodDescription: "updated",
      methodPluginList: [{ pluginType: "HTTP", pluginConfigJson: { method: "GET" } }],
    };

    await expect(
      client.setMethodPlugins("service/id", "resource/id", body),
    ).resolves.toEqual(resourceList);
    expect(ky.put).toHaveBeenCalledWith(
      "https://kr1-apigateway.api.nhncloudservice.com/v2.0/appkeys/appkey/services/service%2Fid/resource-methods/resource%2Fid",
      {
        headers: { "X-NHN-Authorization": "Bearer token" },
        json: body,
        retry: 0,
        timeout: expect.any(Number),
      },
    );
  });

  it("HTTP 200의 isSuccessful=false를 EXIT_API_ERROR로 거부한다", async () => {
    vi.mocked(ky.put).mockReturnValue(
      mockKyResponse({
        header: { isSuccessful: false, resultCode: 403100000, resultMessage: "Permission denied" },
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(
      client.setMethodPlugins("service-1", "resource-1", {
        methodName: "private-get",
        methodPluginList: [{ pluginType: "HTTP" }],
      }),
    ).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });

  it("resourceList가 배열이 아니면 EXIT_API_ERROR로 거부한다", async () => {
    vi.mocked(ky.put).mockReturnValue(
      mockKyResponse({
        header: successfulHeader,
        resourceList: updatedResource("resource-1", "/private"),
      }),
    );

    const client = new ApiGatewayClient("token", "kr1", "appkey");
    await expect(
      client.setMethodPlugins("service-1", "resource-1", {
        methodName: "private-get",
        methodPluginList: [{ pluginType: "HTTP" }],
      }),
    ).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });
});
