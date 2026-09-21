import ky from "ky";
import { ncrHost } from "../../api/endpoints.js";
import { unwrapHeader, type NhnEnvelope } from "../../api/envelope.js";
import { toNhnCloudCliError } from "../../api/httpError.js";
import { DEFAULT_TIMEOUT_MS } from "../../api/timeout.js";
import { isRegistry, type Registry } from "./types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR } from "../../utils/exit-codes.js";
import type { CloudEnvironment } from "../../config/types.js";

/**
 * NCR Management API 응답 봉투 (실측 확정 — ADR-016).
 * 표준 NHN 봉투의 `body` 가 아니라 `header` 와 나란히 named 필드로 온다:
 * 목록은 `registries`, 단건은 `registry`. 따라서 unwrap(body 필수) 대신
 * unwrapHeader(header 검사) 후 named 필드를 직접 읽는다.
 */
interface NcrListResponse extends NhnEnvelope<unknown> {
  registries?: Registry[];
}
interface NcrGetResponse extends NhnEnvelope<unknown> {
  registry?: Registry;
}

/**
 * NCR Management API 클라이언트 (ADR-016).
 * 공통 UAK 를 정적 헤더(X-TC-AUTHENTICATION-ID/SECRET)로 직접 전송 — OAuth 교환 없음.
 */
export class NcrClient {
  private readonly uakId: string;
  private readonly uakSecret: string;
  private readonly baseUrl: string;

  constructor(uakId: string, uakSecret: string, region: string, environment: CloudEnvironment = "real") {
    this.uakId = uakId;
    this.uakSecret = uakSecret;
    this.baseUrl = `https://${ncrHost(region, environment)}`;
  }

  private authHeaders(): Record<string, string> {
    return {
      "X-TC-AUTHENTICATION-ID": this.uakId,
      "X-TC-AUTHENTICATION-SECRET": this.uakSecret,
    };
  }

  /**
   * 레지스트리 목록을 반환한다.
   * GET /ncr/v2.0/appkeys/{appKey}/registries
   * 응답: { header, registries: [...] } — body 가 아니라 named 필드.
   */
  async listRegistries(appKey: string): Promise<Registry[]> {
    const url = `${this.baseUrl}/ncr/v2.0/appkeys/${encodeURIComponent(appKey)}/registries`;
    try {
      const res = await ky
        .get(url, {
          headers: this.authHeaders(),
          retry: 0,
          timeout: DEFAULT_TIMEOUT_MS,
        })
        .json<NcrListResponse>();

      unwrapHeader(res);
      if (!Array.isArray(res.registries)) {
        // 누락은 빈 목록, 비배열(키 형태 변경)은 명확한 형식 오류 — getRegistry 와 같은 결.
        if (res.registries === undefined) return [];
        throw new NhnCloudCliError(
          "NCR API 응답 형식 오류: registries 가 배열이 아닙니다.",
          EXIT_API_ERROR,
        );
      }
      return res.registries.filter(isRegistry);
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * 단일 레지스트리를 반환한다.
   * GET /ncr/v2.0/appkeys/{appKey}/registries/{registryNameOrId}
   * 응답: { header, registry: {...} } — body 가 아니라 named 필드.
   */
  async getRegistry(appKey: string, registry: string): Promise<Registry> {
    const url = `${this.baseUrl}/ncr/v2.0/appkeys/${encodeURIComponent(appKey)}/registries/${encodeURIComponent(registry)}`;
    try {
      const res = await ky
        .get(url, {
          headers: this.authHeaders(),
          retry: 0,
          timeout: DEFAULT_TIMEOUT_MS,
        })
        .json<NcrGetResponse>();

      unwrapHeader(res);
      if (res.registry && isRegistry(res.registry)) {
        return res.registry;
      }

      throw new NhnCloudCliError(
        "NCR API 응답 형식 오류: registry 객체를 찾을 수 없습니다.",
        EXIT_API_ERROR,
      );
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }
}
