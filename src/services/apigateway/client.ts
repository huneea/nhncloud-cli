import ky from "ky";
import { apigatewayHost } from "../../api/endpoints.js";
import type { CloudEnvironment } from "../../config/types.js";
import { unwrapHeader, type NhnEnvelope } from "../../api/envelope.js";
import { toNhnCloudCliError } from "../../api/httpError.js";
import { DEFAULT_TIMEOUT_MS } from "../../api/timeout.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR } from "../../utils/exit-codes.js";
import {
  DEPLOY_STATUS_DEPLOYING,
  isApiGatewayPaging,
  isApiGatewayService,
  isDeployHistory,
  isLatestDeployResult,
  isResource,
  isResourceParameters,
  isResourceResponses,
  isStage,
  isStageResource,
  isSwaggerData,
  isUpdatedResource,
  isUpdatedStage,
  isWrittenStageResource,
  type ApiGatewayService,
  type ApiGatewayServiceListParams,
  type DeployHistory,
  type LatestDeployResult,
  type MethodPluginUpdateBody,
  type PathPluginInput,
  type Resource,
  type ResourceParameters,
  type ResourceResponses,
  type Stage,
  type StageResource,
  type StageUpdateBody,
  type SwaggerData,
  type UpdatedResource,
  type UpdatedStage,
  type WrittenStageResource,
} from "./types.js";

const DEFAULT_DEPLOY_POLL_INTERVAL_MS = 3_000;

interface ApiGatewayServiceListResponse extends NhnEnvelope<unknown> {
  apigwServiceList?: unknown;
  paging?: unknown;
}

interface ApiGatewayServiceGetResponse extends NhnEnvelope<unknown> {
  apigwService?: unknown;
}

interface ResourceListResponse extends NhnEnvelope<unknown> {
  resourceList?: unknown;
}

interface ResourceUpdateResponse extends NhnEnvelope<unknown> {
  resourceList?: unknown;
}

interface ResourceParametersResponse extends NhnEnvelope<unknown> {
  queryStringList?: unknown;
  headerList?: unknown;
  formDataList?: unknown;
  requestBody?: unknown;
  contentTypeList?: unknown;
}

interface ResourceResponsesResponse extends NhnEnvelope<unknown> {
  responseList?: unknown;
  contentTypeList?: unknown;
}

interface StageListResponse extends NhnEnvelope<unknown> {
  stageList?: unknown;
  paging?: unknown;
}

interface StageUpdateResponse extends NhnEnvelope<unknown> {
  stage?: unknown;
}

interface StageSwaggerResponse extends NhnEnvelope<unknown> {
  swaggerData?: unknown;
}

interface StageResourceListResponse extends NhnEnvelope<unknown> {
  stageResourceList?: unknown;
}

interface DeployHistoryListResponse extends NhnEnvelope<unknown> {
  stageDeployHistoryList?: unknown;
  paging?: unknown;
}

interface LatestDeployResponse extends NhnEnvelope<unknown> {
  latestStageDeployResult?: unknown;
}

/** API Gateway 조회·쓰기 API 클라이언트 (ADR-027, ADR-028). */
export class ApiGatewayClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;

  constructor(accessToken: string, region: string, appKey: string, environment: CloudEnvironment = "real") {
    this.accessToken = accessToken;
    this.baseUrl = `https://${apigatewayHost(region, environment)}/v2.0/appkeys/${encodeURIComponent(appKey)}`;
  }

  private authHeaders(): Record<string, string> {
    return { "X-NHN-Authorization": `Bearer ${this.accessToken}` };
  }

  /** paging.totalCount 를 기준으로 API Gateway service 전체를 수집한다. */
  async listServices(
    params: ApiGatewayServiceListParams = {},
  ): Promise<ApiGatewayService[]> {
    const services: ApiGatewayService[] = [];
    const limit = params.limit ?? 1000;
    let page = params.page ?? 1;

    try {
      while (true) {
        const response = await ky
          .get(`${this.baseUrl}/services`, {
            headers: this.authHeaders(),
            searchParams: { page, limit },
            retry: 0,
            timeout: DEFAULT_TIMEOUT_MS,
          })
          .json<ApiGatewayServiceListResponse>();

        unwrapHeader(response);
        if (
          !Array.isArray(response.apigwServiceList) ||
          !response.apigwServiceList.every(isApiGatewayService)
        ) {
          throw new NhnCloudCliError(
            "API Gateway 응답 형식 오류: apigwServiceList 가 올바른 배열이 아닙니다.",
            EXIT_API_ERROR,
          );
        }
        if (!isApiGatewayPaging(response.paging)) {
          throw new NhnCloudCliError(
            "API Gateway 응답 형식 오류: paging 필드가 없거나 올바르지 않습니다.",
            EXIT_API_ERROR,
          );
        }

        services.push(...response.apigwServiceList);
        if (response.paging.page * response.paging.limit >= response.paging.totalCount) {
          break;
        }
        if (response.apigwServiceList.length === 0) {
          throw new NhnCloudCliError(
            "API Gateway 응답 형식 오류: paging.totalCount 전에 빈 service 페이지가 반환되었습니다.",
            EXIT_API_ERROR,
          );
        }
        page = response.paging.page + 1;
      }

      return services;
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /** API Gateway service 한 건을 조회한다. */
  async getService(apigwServiceId: string): Promise<ApiGatewayService> {
    try {
      const response = await ky
        .get(`${this.baseUrl}/services/${encodeURIComponent(apigwServiceId)}`, {
          headers: this.authHeaders(),
          retry: 0,
          timeout: DEFAULT_TIMEOUT_MS,
        })
        .json<ApiGatewayServiceGetResponse>();

      unwrapHeader(response);
      if (!isApiGatewayService(response.apigwService)) {
        throw new NhnCloudCliError(
          "API Gateway 응답 형식 오류: apigwService 필드가 없거나 올바르지 않습니다.",
          EXIT_API_ERROR,
        );
      }
      return response.apigwService;
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /** paging 없이 API Gateway resource 전체를 한 번에 조회한다. */
  async listResources(apigwServiceId: string): Promise<Resource[]> {
    try {
      const response = await ky
        .get(
          `${this.baseUrl}/services/${encodeURIComponent(apigwServiceId)}/resources`,
          {
            headers: this.authHeaders(),
            retry: 0,
            timeout: DEFAULT_TIMEOUT_MS,
          },
        )
        .json<ResourceListResponse>();

      unwrapHeader(response);
      if (!Array.isArray(response.resourceList) || !response.resourceList.every(isResource)) {
        throw new NhnCloudCliError(
          "API Gateway 응답 형식 오류: resourceList 가 올바른 배열이 아닙니다.",
          EXIT_API_ERROR,
        );
      }
      return response.resourceList;
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /** API Gateway resource 경로 플러그인을 upsert한다. */
  async setPathPlugins(
    apigwServiceId: string,
    resourceId: string,
    pathPluginList: PathPluginInput[],
  ): Promise<UpdatedResource[]> {
    try {
      const response = await ky
        .put(
          `${this.baseUrl}/services/${encodeURIComponent(apigwServiceId)}/resource-paths/${encodeURIComponent(resourceId)}`,
          {
            headers: this.authHeaders(),
            json: { pathPluginList },
            retry: 0,
            timeout: DEFAULT_TIMEOUT_MS,
          },
        )
        .json<ResourceUpdateResponse>();

      unwrapHeader(response);
      if (
        !Array.isArray(response.resourceList) ||
        !response.resourceList.every(isUpdatedResource)
      ) {
        throw new NhnCloudCliError(
          "API Gateway 응답 형식 오류: resourceList 가 올바른 수정 응답 배열이 아닙니다.",
          EXIT_API_ERROR,
        );
      }
      return response.resourceList;
    } catch (error) {
      if (error instanceof NhnCloudCliError) throw error;
      throw toNhnCloudCliError(error);
    }
  }

  /** API Gateway resource 메서드 플러그인을 upsert한다. */
  async setMethodPlugins(
    apigwServiceId: string,
    resourceId: string,
    body: MethodPluginUpdateBody,
  ): Promise<UpdatedResource[]> {
    try {
      const response = await ky
        .put(
          `${this.baseUrl}/services/${encodeURIComponent(apigwServiceId)}/resource-methods/${encodeURIComponent(resourceId)}`,
          {
            headers: this.authHeaders(),
            json: body,
            retry: 0,
            timeout: DEFAULT_TIMEOUT_MS,
          },
        )
        .json<ResourceUpdateResponse>();

      unwrapHeader(response);
      if (
        !Array.isArray(response.resourceList) ||
        !response.resourceList.every(isUpdatedResource)
      ) {
        throw new NhnCloudCliError(
          "API Gateway 응답 형식 오류: resourceList 가 올바른 수정 응답 배열이 아닙니다.",
          EXIT_API_ERROR,
        );
      }
      return response.resourceList;
    } catch (error) {
      if (error instanceof NhnCloudCliError) throw error;
      throw toNhnCloudCliError(error);
    }
  }

  /** API Gateway resource 요청 parameter를 조회한다. */
  async getResourceParameters(
    apigwServiceId: string,
    resourceId: string,
  ): Promise<ResourceParameters> {
    try {
      const response = await ky
        .get(
          `${this.baseUrl}/services/${encodeURIComponent(apigwServiceId)}/resources/${encodeURIComponent(resourceId)}/parameters`,
          {
            headers: this.authHeaders(),
            retry: 0,
            timeout: DEFAULT_TIMEOUT_MS,
          },
        )
        .json<ResourceParametersResponse>();

      unwrapHeader(response);
      if (!isResourceParameters(response)) {
        throw new NhnCloudCliError(
          "API Gateway 응답 형식 오류: resource parameter 필드가 없거나 올바르지 않습니다.",
          EXIT_API_ERROR,
        );
      }
      // 봉투(header)를 그대로 흘리지 않는다. --json 출력 계약은 아래 다섯 필드만 담는다.
      return {
        queryStringList: response.queryStringList,
        headerList: response.headerList,
        formDataList: response.formDataList,
        requestBody: response.requestBody,
        contentTypeList: response.contentTypeList,
      };
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /** API Gateway resource 응답 정의를 조회한다. */
  async getResourceResponses(
    apigwServiceId: string,
    resourceId: string,
  ): Promise<ResourceResponses> {
    try {
      const response = await ky
        .get(
          `${this.baseUrl}/services/${encodeURIComponent(apigwServiceId)}/resources/${encodeURIComponent(resourceId)}/responses`,
          {
            headers: this.authHeaders(),
            retry: 0,
            timeout: DEFAULT_TIMEOUT_MS,
          },
        )
        .json<ResourceResponsesResponse>();

      unwrapHeader(response);
      if (!isResourceResponses(response)) {
        throw new NhnCloudCliError(
          "API Gateway 응답 형식 오류: resource response 필드가 없거나 올바르지 않습니다.",
          EXIT_API_ERROR,
        );
      }
      // 봉투(header)를 그대로 흘리지 않는다. --json 출력 계약은 아래 두 필드만 담는다.
      return {
        responseList: response.responseList,
        contentTypeList: response.contentTypeList,
      };
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /** paging.totalCount 를 기준으로 API Gateway stage 전체를 수집한다. */
  async listStages(apigwServiceId: string): Promise<Stage[]> {
    // 응답 paging의 page·limit·totalCount를 따라 마지막 페이지까지 순회한다.
    const stages: Stage[] = [];
    const limit = 1000;
    let page = 1;

    try {
      while (true) {
        const response = await ky
          .get(
            `${this.baseUrl}/services/${encodeURIComponent(apigwServiceId)}/stages`,
            {
              headers: this.authHeaders(),
              searchParams: { page, limit },
              retry: 0,
              timeout: DEFAULT_TIMEOUT_MS,
            },
          )
          .json<StageListResponse>();

        unwrapHeader(response);
        if (!Array.isArray(response.stageList) || !response.stageList.every(isStage)) {
          throw new NhnCloudCliError(
            "API Gateway 응답 형식 오류: stageList 가 올바른 배열이 아닙니다.",
            EXIT_API_ERROR,
          );
        }
        if (!isApiGatewayPaging(response.paging)) {
          throw new NhnCloudCliError(
            "API Gateway 응답 형식 오류: paging 필드가 없거나 올바르지 않습니다.",
            EXIT_API_ERROR,
          );
        }

        stages.push(...response.stageList);
        if (response.paging.page * response.paging.limit >= response.paging.totalCount) {
          break;
        }
        if (response.stageList.length === 0) {
          throw new NhnCloudCliError(
            "API Gateway 응답 형식 오류: paging.totalCount 전에 빈 stage 페이지가 반환되었습니다.",
            EXIT_API_ERROR,
          );
        }
        page = response.paging.page + 1;
      }

      return stages;
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /** API Gateway stage의 backend endpoint와 설명을 수정한다. */
  async updateStage(
    apigwServiceId: string,
    stageId: string,
    body: StageUpdateBody,
  ): Promise<UpdatedStage> {
    try {
      const response = await ky
        .put(
          `${this.baseUrl}/services/${encodeURIComponent(apigwServiceId)}/stages/${encodeURIComponent(stageId)}`,
          {
            headers: this.authHeaders(),
            json: body,
            retry: 0,
            timeout: DEFAULT_TIMEOUT_MS,
          },
        )
        .json<StageUpdateResponse>();

      unwrapHeader(response);
      if (!isUpdatedStage(response.stage)) {
        throw new NhnCloudCliError(
          "API Gateway 응답 형식 오류: stage 필드가 없거나 올바른 수정 응답이 아닙니다.",
          EXIT_API_ERROR,
        );
      }
      return response.stage;
    } catch (error) {
      if (error instanceof NhnCloudCliError) throw error;
      throw toNhnCloudCliError(error);
    }
  }

  /** 사용자 정의 Swagger 객체를 내부 해석 없이 반환한다. */
  async getStageSwagger(apigwServiceId: string, stageId: string): Promise<SwaggerData> {
    try {
      const response = await ky
        .get(
          `${this.baseUrl}/services/${encodeURIComponent(apigwServiceId)}/stages/${encodeURIComponent(stageId)}/swagger`,
          {
            headers: this.authHeaders(),
            retry: 0,
            timeout: DEFAULT_TIMEOUT_MS,
          },
        )
        .json<StageSwaggerResponse>();

      unwrapHeader(response);
      if (!isSwaggerData(response.swaggerData)) {
        throw new NhnCloudCliError(
          "API Gateway 응답 형식 오류: swaggerData 필드가 없거나 객체가 아닙니다.",
          EXIT_API_ERROR,
        );
      }
      return response.swaggerData;
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /** paging 없이 배포된 API Gateway stage resource 전체를 한 번에 조회한다. */
  async listStageResources(
    apigwServiceId: string,
    stageId: string,
  ): Promise<StageResource[]> {
    try {
      const response = await ky
        .get(
          `${this.baseUrl}/services/${encodeURIComponent(apigwServiceId)}/stages/${encodeURIComponent(stageId)}/resources`,
          {
            headers: this.authHeaders(),
            retry: 0,
            timeout: DEFAULT_TIMEOUT_MS,
          },
        )
        .json<StageResourceListResponse>();

      unwrapHeader(response);
      if (
        !Array.isArray(response.stageResourceList) ||
        !response.stageResourceList.every(isStageResource)
      ) {
        throw new NhnCloudCliError(
          "API Gateway 응답 형식 오류: stageResourceList 가 올바른 배열이 아닙니다.",
          EXIT_API_ERROR,
        );
      }
      return response.stageResourceList;
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /** API Gateway service resource를 stage에 반영한다. */
  async importStageResources(
    apigwServiceId: string,
    stageId: string,
  ): Promise<WrittenStageResource[]> {
    try {
      const response = await ky
        .put(
          `${this.baseUrl}/services/${encodeURIComponent(apigwServiceId)}/stages/${encodeURIComponent(stageId)}/resources`,
          {
            headers: this.authHeaders(),
            retry: 0,
            timeout: DEFAULT_TIMEOUT_MS,
          },
        )
        .json<StageResourceListResponse>();

      unwrapHeader(response);
      if (
        !Array.isArray(response.stageResourceList) ||
        !response.stageResourceList.every(isWrittenStageResource)
      ) {
        throw new NhnCloudCliError(
          "API Gateway 응답 형식 오류: stageResourceList 가 올바른 배열이 아닙니다.",
          EXIT_API_ERROR,
        );
      }
      return response.stageResourceList;
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /** API Gateway stage 배포를 요청한다. */
  async createDeploy(
    apigwServiceId: string,
    stageId: string,
    body: { deployDescription?: string },
  ): Promise<void> {
    const json =
      body.deployDescription === undefined
        ? {}
        : { deployDescription: body.deployDescription };

    try {
      const response = await ky
        .post(
          `${this.baseUrl}/services/${encodeURIComponent(apigwServiceId)}/stages/${encodeURIComponent(stageId)}/deploys`,
          {
            headers: this.authHeaders(),
            json,
            retry: 0,
            timeout: DEFAULT_TIMEOUT_MS,
          },
        )
        .json<NhnEnvelope<unknown>>();

      unwrapHeader(response);
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /** 배포 이력의 설정으로 API Gateway stage를 롤백한다. */
  async rollbackDeploy(
    apigwServiceId: string,
    stageId: string,
    deployId: string,
  ): Promise<WrittenStageResource[]> {
    try {
      const response = await ky
        .post(
          `${this.baseUrl}/services/${encodeURIComponent(apigwServiceId)}/stages/${encodeURIComponent(stageId)}/deploys/${encodeURIComponent(deployId)}/rollback`,
          {
            headers: this.authHeaders(),
            retry: 0,
            timeout: DEFAULT_TIMEOUT_MS,
          },
        )
        .json<StageResourceListResponse>();

      unwrapHeader(response);
      if (
        !Array.isArray(response.stageResourceList) ||
        !response.stageResourceList.every(isWrittenStageResource)
      ) {
        throw new NhnCloudCliError(
          "API Gateway 응답 형식 오류: stageResourceList 가 올바른 배열이 아닙니다.",
          EXIT_API_ERROR,
        );
      }
      return response.stageResourceList;
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /** paging.totalCount 를 기준으로 API Gateway stage 배포 이력 전체를 수집한다. */
  async listDeploys(apigwServiceId: string, stageId: string): Promise<DeployHistory[]> {
    // 응답 paging의 page·limit·totalCount를 따라 마지막 페이지까지 순회한다.
    const deploys: DeployHistory[] = [];
    const limit = 1000;
    let page = 1;

    try {
      while (true) {
        const response = await ky
          .get(
            `${this.baseUrl}/services/${encodeURIComponent(apigwServiceId)}/stages/${encodeURIComponent(stageId)}/deploys`,
            {
              headers: this.authHeaders(),
              searchParams: { page, limit },
              retry: 0,
              timeout: DEFAULT_TIMEOUT_MS,
            },
          )
          .json<DeployHistoryListResponse>();

        unwrapHeader(response);
        if (
          !Array.isArray(response.stageDeployHistoryList) ||
          !response.stageDeployHistoryList.every(isDeployHistory)
        ) {
          throw new NhnCloudCliError(
            "API Gateway 응답 형식 오류: stageDeployHistoryList 가 올바른 배열이 아닙니다.",
            EXIT_API_ERROR,
          );
        }
        if (!isApiGatewayPaging(response.paging)) {
          throw new NhnCloudCliError(
            "API Gateway 응답 형식 오류: paging 필드가 없거나 올바르지 않습니다.",
            EXIT_API_ERROR,
          );
        }

        deploys.push(...response.stageDeployHistoryList);
        if (response.paging.page * response.paging.limit >= response.paging.totalCount) {
          break;
        }
        if (response.stageDeployHistoryList.length === 0) {
          throw new NhnCloudCliError(
            "API Gateway 응답 형식 오류: paging.totalCount 전에 빈 deploy 페이지가 반환되었습니다.",
            EXIT_API_ERROR,
          );
        }
        page = response.paging.page + 1;
      }

      return deploys;
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /** API Gateway stage 최신 배포 결과를 조회한다. */
  async getLatestDeploy(
    apigwServiceId: string,
    stageId: string,
  ): Promise<LatestDeployResult> {
    try {
      const response = await ky
        .get(
          `${this.baseUrl}/services/${encodeURIComponent(apigwServiceId)}/stages/${encodeURIComponent(stageId)}/deploys/latest`,
          {
            headers: this.authHeaders(),
            retry: 0,
            timeout: DEFAULT_TIMEOUT_MS,
          },
        )
        .json<LatestDeployResponse>();

      unwrapHeader(response);
      if (!isLatestDeployResult(response.latestStageDeployResult)) {
        throw new NhnCloudCliError(
          "API Gateway 응답 형식 오류: latestStageDeployResult 필드가 없거나 올바르지 않습니다.",
          EXIT_API_ERROR,
        );
      }
      return response.latestStageDeployResult;
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /** 직전 배포 ID와 상태를 비교해 이번 stage 배포가 종료될 때까지 대기한다. */
  async waitForDeploy(
    apigwServiceId: string,
    stageId: string,
    opts: { intervalMs?: number; timeoutMs: number; baselineDeployId: string | null },
  ): Promise<LatestDeployResult> {
    const intervalMs = opts.intervalMs ?? DEFAULT_DEPLOY_POLL_INTERVAL_MS;
    const deadline = Date.now() + opts.timeoutMs;
    let lastDeploy: LatestDeployResult | null = null;

    while (Date.now() < deadline) {
      const deploy = await this.getLatestDeploy(apigwServiceId, stageId);
      lastDeploy = deploy;

      const isNewDeploy =
        opts.baselineDeployId === null || deploy.deployId !== opts.baselineDeployId;
      if (isNewDeploy && deploy.deployStatus !== DEPLOY_STATUS_DEPLOYING) {
        return deploy;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(intervalMs, remaining)),
      );
    }

    const lastDeploySummary = lastDeploy
      ? `마지막 상태: ${lastDeploy.deployStatus}, 마지막 배포 ID: ${lastDeploy.deployId}`
      : "마지막 조회 없음";
    const baselineDeployId = opts.baselineDeployId ?? "없음";
    throw new NhnCloudCliError(
      `API Gateway stage 배포가 완료되지 않았습니다 (${lastDeploySummary}, 기준 배포 ID: ${baselineDeployId}). ` +
        `대기 상한(${Math.round(opts.timeoutMs / 1000)}초)을 넘겼습니다. --timeout 으로 늘릴 수 있습니다.`,
      EXIT_API_ERROR,
    );
  }
}
