import ky, { HTTPError } from "ky";
import { pipelineHost } from "../../api/endpoints.js";
import { unwrapHeader, type NhnEnvelope } from "../../api/envelope.js";
import { toNhnCloudCliError } from "../../api/httpError.js";
import { DEFAULT_TIMEOUT_MS } from "../../api/timeout.js";
import type { CloudEnvironment } from "../../config/types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR } from "../../utils/exit-codes.js";
import { isPipelineExecuteResult, type PipelineExecuteResult } from "./types.js";

/** 요청을 보낸 뒤 결과를 알 수 없을 때 붙이는 안내. 재실행은 중복 배포다. */
export const PIPELINE_UNKNOWN_OUTCOME_HINT =
  "실행이 접수됐을 수 있습니다. 콘솔 실행 이력을 확인하기 전에 다시 실행하지 마세요.";

/** Pipeline 수동 실행 API v1.1 클라이언트. 실행은 쓰기이므로 재시도하지 않는다. */
export class PipelineClient {
  private readonly accessToken: string;
  private readonly appKey: string;
  private readonly region: string;
  private readonly host: string;

  constructor(accessToken: string, appKey: string, region: string, environment: CloudEnvironment = "real") {
    this.accessToken = accessToken;
    this.appKey = appKey;
    this.region = region.toUpperCase();
    this.host = pipelineHost(region, environment);
  }

  private executeUrl(pipelineName: string): string {
    return `https://${this.host}/api/anchor/v1.1/pipelines/${encodeURIComponent(pipelineName)}/execute`;
  }

  /** `--dry-run` 용 요청 설명. appkey 와 토큰을 담지 않는다. */
  buildExecuteRequest(pipelineName: string): { method: "POST"; url: string; region: string } {
    return { method: "POST", url: this.executeUrl(pipelineName), region: this.region };
  }

  async execute(pipelineName: string): Promise<PipelineExecuteResult> {
    try {
      const response = await ky
        .post(this.executeUrl(pipelineName), {
          headers: {
            "Content-Type": "application/json",
            "X-NHN-REGION": this.region,
            "X-NHN-APPKEY": this.appKey,
            "X-NHN-Authorization": `Bearer ${this.accessToken}`,
          },
          retry: 0,
          timeout: DEFAULT_TIMEOUT_MS,
        })
        .json<NhnEnvelope<unknown>>();

      unwrapHeader(response);
      if (!isPipelineExecuteResult(response.body)) {
        throw new NhnCloudCliError(
          `Pipeline 실행 응답에 lastExecutionId 가 없습니다. ${PIPELINE_UNKNOWN_OUTCOME_HINT}`,
          EXIT_API_ERROR,
        );
      }
      return response.body;
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      const converted = toNhnCloudCliError(err);
      // 서버가 상태 코드로 답했으면 결과가 확정이다. 그 밖(timeout·연결 끊김)은 접수 여부를 모른다.
      if (err instanceof HTTPError) throw converted;
      // --request-timeout 으로 상한을 늘려 다시 실행하라는 안내는 중복 배포를 부르므로 뺀다.
      const message = converted.message.replace(/\s*--request-timeout <초>로 상한을 늘릴 수 있습니다\./, "");
      throw new NhnCloudCliError(`${message} ${PIPELINE_UNKNOWN_OUTCOME_HINT}`, EXIT_API_ERROR);
    }
  }
}
