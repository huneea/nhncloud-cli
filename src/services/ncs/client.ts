import ky from "ky";
import { ncsHost } from "../../api/endpoints.js";
import type { CloudEnvironment } from "../../config/types.js";
import { unwrapHeader, type NhnEnvelope } from "../../api/envelope.js";
import { toNhnCloudCliError } from "../../api/httpError.js";
import { DEFAULT_TIMEOUT_MS } from "../../api/timeout.js";
import {
  isNcsTemplateSummary,
  type NcsTemplateSummary,
  type NcsTemplateListParams,
  isNcsTemplateDetail,
  type NcsTemplateDetail,
  isNcsTemplateVersionSummary,
  type NcsTemplateVersionSummary,
  type NcsTemplateVersionListParams,
  isNcsTemplateVersionDetail,
  type NcsTemplateVersionDetail,
  isNcsWorkloadSummary,
  type NcsWorkloadSummary,
  type NcsWorkloadListParams,
  isNcsWorkloadDetail,
  type NcsWorkloadDetail,
  type NcsWorkloadLogsParams,
  isNcsWorkloadLog,
  type NcsWorkloadLog,
  type NcsWorkloadEventsParams,
  isNcsWorkloadEvent,
  type NcsWorkloadEvent,
  type NcsWorkloadHistoryListParams,
  isNcsWorkloadHistorySummary,
  type NcsWorkloadHistorySummary,
  isNcsWorkloadHistoryDetail,
  type NcsWorkloadHistoryDetail,
  isNcsWorkloadScheduleHistory,
  type NcsWorkloadScheduleHistory,
  isNcsMalwareConfig,
  type NcsMalwareConfig,
  isNcsMalwareReport,
  type NcsMalwareResult,
} from "./types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR, EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";

/** waitForRunning 기본 폴링 간격 (5초) — instance client 의 DEFAULT_POLL_INTERVAL_MS 선례와 동일. */
const DEFAULT_WAIT_POLL_INTERVAL_MS = 5_000;

/**
 * NCS API 응답 봉투 (공식 docs 예제 JSON 확정 — ADR-020, docs.nhncloud.com/ko/Container/NCS/ko/public-api/).
 * 표준 NHN 봉투의 `body` 가 아니라 `header` 와 나란히 named 필드로 온다 — NCR 과 같은 패턴.
 * 목록은 `templates`. 따라서 unwrap(body 필수) 대신 unwrapHeader(header 검사) 후 named 필드를 직접 읽는다.
 */
interface NcsTemplateListResponse extends NhnEnvelope<unknown> {
  templates?: NcsTemplateSummary[];
}

/** `template get` 단건 응답 — named 필드 `template` (Phase 1 확정 패턴 재사용). */
interface NcsTemplateGetResponse extends NhnEnvelope<unknown> {
  template?: NcsTemplateDetail;
}

/** `template version list` 목록 응답 — named 필드 `versions`. */
interface NcsTemplateVersionListResponse extends NhnEnvelope<unknown> {
  versions?: NcsTemplateVersionSummary[];
}

/** `template version get` 단건 응답 — named 필드 `version`. */
interface NcsTemplateVersionGetResponse extends NhnEnvelope<unknown> {
  version?: NcsTemplateVersionDetail;
}

/** `workload list` 목록 응답 — named 필드 `workloads` (template 과 동일 패턴). */
interface NcsWorkloadListResponse extends NhnEnvelope<unknown> {
  workloads?: NcsWorkloadSummary[];
}

/** `workload get` 단건 응답 — named 필드 `workload`. */
interface NcsWorkloadGetResponse extends NhnEnvelope<unknown> {
  workload?: NcsWorkloadDetail;
}

/** `workload logs` 응답 — named 필드 `logs`. totalCount 헤더는 docs 미기재(X-Total-Count 없음). */
interface NcsWorkloadLogsResponse extends NhnEnvelope<unknown> {
  logs?: NcsWorkloadLog[];
}

/** `workload events` 응답 — named 필드 `events`. */
interface NcsWorkloadEventsResponse extends NhnEnvelope<unknown> {
  events?: NcsWorkloadEvent[];
}

/** `workload history` 목록 응답 — named 필드 `history`. */
interface NcsWorkloadHistoryListResponse extends NhnEnvelope<unknown> {
  history?: NcsWorkloadHistorySummary[];
}

/**
 * `workload history get` 단건 응답 — named 필드 `history` + sibling `template`(당시 템플릿 스냅샷).
 * docs 예제 JSON 실측 확정 — history 안에 template 이 중첩되지 않는다.
 */
interface NcsWorkloadHistoryGetResponse extends NhnEnvelope<unknown> {
  history?: NcsWorkloadHistorySummary;
  template?: unknown;
}

/** `workload schedule-history` 응답 — named 필드 `schedulehistory`. */
interface NcsWorkloadScheduleHistoryResponse extends NhnEnvelope<unknown> {
  schedulehistory?: NcsWorkloadScheduleHistory[];
}

/**
 * `malware config get/set` 응답 — named 필드가 아니라 header 와 나란히 top-level `enabled` 필드
 * (docs 예제 JSON 확정 — template/workload 의 named 필드 패턴과 다름).
 */
interface NcsMalwareConfigResponse extends NhnEnvelope<unknown> {
  enabled?: boolean;
}

/** `malware result` 응답 — config 와 동일하게 header 와 나란히 flat top-level 필드(docs 예제 JSON 확정). */
interface NcsMalwareResultResponse extends NhnEnvelope<unknown> {
  scannedAt?: string;
  infectedFiles?: number | string;
  scannedDirectories?: number | string;
  scannedFiles?: number | string;
  reports?: unknown[];
}

/**
 * NCS(NHN Container Service) API 클라이언트 (ADR-020).
 * 인증은 Deploy 와 같은 UAK OAuth Bearer 토큰(src/api/oauth.ts getAccessToken) 을 재사용한다.
 */
export class NcsClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;

  constructor(accessToken: string, region: string, appKey: string, environment: CloudEnvironment = "real") {
    this.accessToken = accessToken;
    this.baseUrl = `https://${ncsHost(region, environment)}/ncs/v1.0/appkeys/${encodeURIComponent(appKey)}`;
  }

  private authHeaders(): Record<string, string> {
    return { "x-nhn-authorization": `Bearer ${this.accessToken}` };
  }

  /**
   * 설계도(template) 목록을 반환한다.
   * GET /ncs/v1.0/appkeys/{appKey}/templates
   * 응답: { header, templates: [...] } — body 가 아니라 named 필드(docs 예제 확정).
   *
   * pagination: 기본 page size 10(docs 확정). 목록이 앞부분만 조용히 반환(silent truncation)하지
   * 않도록 page/size 를 그대로 노출한다. 총 개수는 응답 헤더 X-Total-Count 로 온다(docs 확정) —
   * body/JSON 필드가 아니므로 ky Response 에서 header 를 직접 읽는다(harbor-client.ts 의
   * .json()+.headers.get() 분리 패턴과 동일 — .json<T>() 체이닝으로는 헤더를 못 본다).
   */
  async listTemplates(
    query: NcsTemplateListParams = {},
  ): Promise<{ totalCount: number; templates: NcsTemplateSummary[] }> {
    const url = `${this.baseUrl}/templates`;
    const searchParams: Record<string, string | number | boolean> = {};
    if (query.page !== undefined) searchParams["page"] = query.page;
    if (query.size !== undefined) searchParams["size"] = query.size;
    if (query.disableContainers !== undefined) {
      // wire 상 실제 쿼리 키는 docs 예제 인용(fetch, 실측 미검증)에 따라 snake_case 로 전송한다.
      // 이후 phase 에서 실제 200 응답으로 재확인 필요.
      searchParams["disable_containers"] = query.disableContainers;
    }

    try {
      const res = await ky.get(url, {
        headers: this.authHeaders(),
        searchParams,
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      const body = await res.json<NcsTemplateListResponse>();

      unwrapHeader(body);
      if (!Array.isArray(body.templates)) {
        // 누락은 빈 목록, 비배열(키 형태 변경)은 명확한 형식 오류 — NCR listRegistries 와 같은 결.
        if (body.templates === undefined) return { totalCount: 0, templates: [] };
        throw new NhnCloudCliError(
          "NCS API 응답 형식 오류: templates 가 배열이 아닙니다.",
          EXIT_API_ERROR,
        );
      }
      const templates = body.templates.filter(isNcsTemplateSummary);

      // X-Total-Count 헤더가 없거나 숫자가 아니면 현재 페이지 길이로 fallback(deploy binaries totalCount 패턴과 동일).
      const headerTotal = res.headers.get("x-total-count");
      const totalCount =
        headerTotal !== null && /^\d+$/.test(headerTotal) ? Number(headerTotal) : templates.length;

      return { totalCount, templates };
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * 설계도(template) 단건을 반환한다.
   * GET /ncs/v1.0/appkeys/{appKey}/templates/{id}
   * 응답: { header, template: {...} } — named 필드(listTemplates 와 같은 패턴).
   */
  async getTemplate(id: string): Promise<NcsTemplateDetail> {
    const url = `${this.baseUrl}/templates/${encodeURIComponent(id)}`;
    try {
      const res = await ky.get(url, {
        headers: this.authHeaders(),
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      const body = await res.json<NcsTemplateGetResponse>();

      unwrapHeader(body);
      if (!isNcsTemplateDetail(body.template)) {
        throw new NhnCloudCliError(
          "NCS API 응답 형식 오류: template 필드가 없거나 형식이 올바르지 않습니다.",
          EXIT_API_ERROR,
        );
      }
      return body.template;
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * 설계도(template) 의 버전 목록을 반환한다.
   * GET /ncs/v1.0/appkeys/{appKey}/templates/{id}/versions
   * 응답: { header, versions: [...] } — named 필드. pagination 은 listTemplates 와 동일하게
   * X-Total-Count 응답 헤더 + page/size 노출(silent truncation 방지).
   */
  async listTemplateVersions(
    id: string,
    query: NcsTemplateVersionListParams = {},
  ): Promise<{ totalCount: number; versions: NcsTemplateVersionSummary[] }> {
    const url = `${this.baseUrl}/templates/${encodeURIComponent(id)}/versions`;
    const searchParams: Record<string, string | number> = {};
    if (query.q !== undefined) searchParams["q"] = query.q;
    if (query.sort !== undefined) searchParams["sort"] = query.sort;
    if (query.page !== undefined) searchParams["page"] = query.page;
    if (query.size !== undefined) searchParams["size"] = query.size;

    try {
      const res = await ky.get(url, {
        headers: this.authHeaders(),
        searchParams,
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      const body = await res.json<NcsTemplateVersionListResponse>();

      unwrapHeader(body);
      if (!Array.isArray(body.versions)) {
        if (body.versions === undefined) return { totalCount: 0, versions: [] };
        throw new NhnCloudCliError(
          "NCS API 응답 형식 오류: versions 가 배열이 아닙니다.",
          EXIT_API_ERROR,
        );
      }
      const versions = body.versions.filter(isNcsTemplateVersionSummary);

      const headerTotal = res.headers.get("x-total-count");
      const totalCount =
        headerTotal !== null && /^\d+$/.test(headerTotal) ? Number(headerTotal) : versions.length;

      return { totalCount, versions };
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * 설계도(template) 버전 단건을 반환한다.
   * GET /ncs/v1.0/appkeys/{appKey}/templates/{id}/versions/{version}
   * 응답: { header, version: {...} } — named 필드.
   */
  async getTemplateVersion(id: string, version: string): Promise<NcsTemplateVersionDetail> {
    const url = `${this.baseUrl}/templates/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}`;
    try {
      const res = await ky.get(url, {
        headers: this.authHeaders(),
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      const body = await res.json<NcsTemplateVersionGetResponse>();

      unwrapHeader(body);
      if (!isNcsTemplateVersionDetail(body.version)) {
        throw new NhnCloudCliError(
          "NCS API 응답 형식 오류: version 필드가 없거나 형식이 올바르지 않습니다.",
          EXIT_API_ERROR,
        );
      }
      return body.version;
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * workload(런타임 실행) 목록을 반환한다.
   * GET /ncs/v1.0/appkeys/{appKey}/workloads
   * 응답: { header, workloads: [...] } — named 필드(listTemplates 와 동일 패턴).
   * pagination: X-Total-Count 응답 헤더 + page/size 노출(listTemplates 와 동일 규약).
   */
  async listWorkloads(
    query: NcsWorkloadListParams = {},
  ): Promise<{ totalCount: number; workloads: NcsWorkloadSummary[] }> {
    const url = `${this.baseUrl}/workloads`;
    const searchParams: Record<string, string | number> = {};
    if (query.q !== undefined) searchParams["q"] = query.q;
    if (query.page !== undefined) searchParams["page"] = query.page;
    if (query.size !== undefined) searchParams["size"] = query.size;

    try {
      const res = await ky.get(url, {
        headers: this.authHeaders(),
        searchParams,
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      const body = await res.json<NcsWorkloadListResponse>();

      unwrapHeader(body);
      if (!Array.isArray(body.workloads)) {
        if (body.workloads === undefined) return { totalCount: 0, workloads: [] };
        throw new NhnCloudCliError(
          "NCS API 응답 형식 오류: workloads 가 배열이 아닙니다.",
          EXIT_API_ERROR,
        );
      }
      const workloads = body.workloads.filter(isNcsWorkloadSummary);

      const headerTotal = res.headers.get("x-total-count");
      const totalCount =
        headerTotal !== null && /^\d+$/.test(headerTotal) ? Number(headerTotal) : workloads.length;

      return { totalCount, workloads };
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * workload 단건을 반환한다 (tasks[] 런타임 상태 포함).
   * GET /ncs/v1.0/appkeys/{appKey}/workloads/{workloadId}
   * 응답: { header, workload: {...} } — named 필드.
   */
  async getWorkload(id: string): Promise<NcsWorkloadDetail> {
    const url = `${this.baseUrl}/workloads/${encodeURIComponent(id)}`;
    try {
      const res = await ky.get(url, {
        headers: this.authHeaders(),
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      const body = await res.json<NcsWorkloadGetResponse>();

      unwrapHeader(body);
      if (!isNcsWorkloadDetail(body.workload)) {
        throw new NhnCloudCliError(
          "NCS API 응답 형식 오류: workload 필드가 없거나 형식이 올바르지 않습니다.",
          EXIT_API_ERROR,
        );
      }
      return body.workload;
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * workload task 의 컨테이너 로그를 반환한다.
   * GET /ncs/v1.0/appkeys/{appKey}/workloads/{workloadId}/tasks/{taskId}/logs
   * docs 확정 필수 쿼리는 `containerName` — CLI 시그니처 일관성을 위해 `container` 로 받고 여기서 매핑한다.
   * container 누락(빈 문자열 포함) 시 EXIT_PARAM_ERROR — API 호출 전 파라미터 검증(1-3 회피).
   * 응답: { header, logs: [...] } — named 필드. docs 에 X-Total-Count 헤더가 없어 totalCount 는 반환하지 않는다.
   */
  async getWorkloadLogs(
    id: string,
    taskId: string,
    query: NcsWorkloadLogsParams,
  ): Promise<{ logs: NcsWorkloadLog[] }> {
    if (!query.container || !query.container.trim()) {
      throw new NhnCloudCliError(
        "container 쿼리가 비어있습니다. 컨테이너 이름을 지정하세요.",
        EXIT_PARAM_ERROR,
      );
    }

    const url = `${this.baseUrl}/workloads/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/logs`;
    const searchParams: Record<string, string | number> = { containerName: query.container };
    if (query.from !== undefined) searchParams["from"] = query.from;
    if (query.to !== undefined) searchParams["to"] = query.to;
    if (query.page !== undefined) searchParams["page"] = query.page;
    if (query.size !== undefined) searchParams["size"] = query.size;

    try {
      const res = await ky.get(url, {
        headers: this.authHeaders(),
        searchParams,
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      const body = await res.json<NcsWorkloadLogsResponse>();

      unwrapHeader(body);
      if (!Array.isArray(body.logs)) {
        if (body.logs === undefined) return { logs: [] };
        throw new NhnCloudCliError(
          "NCS API 응답 형식 오류: logs 가 배열이 아닙니다.",
          EXIT_API_ERROR,
        );
      }
      return { logs: body.logs.filter(isNcsWorkloadLog) };
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * workload task 의 이벤트 목록을 반환한다.
   * GET /ncs/v1.0/appkeys/{appKey}/workloads/{workloadId}/tasks/{taskId}/events
   * 응답: { header, events: [...] } — named 필드.
   * pagination: X-Total-Count 헤더가 docs 에 명시되진 않았으나, 있으면 정확히 반영하고 없으면
   * 현재 페이지 길이로 fallback(listTemplates 와 동일한 방어적 패턴 — 실제 헤더 부재와도 호환).
   */
  async getWorkloadEvents(
    id: string,
    taskId: string,
    query: NcsWorkloadEventsParams = {},
  ): Promise<{ totalCount: number; events: NcsWorkloadEvent[] }> {
    const url = `${this.baseUrl}/workloads/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/events`;
    const searchParams: Record<string, string | number> = {};
    if (query.type !== undefined) searchParams["type"] = query.type;
    if (query.q !== undefined) searchParams["q"] = query.q;
    if (query.from !== undefined) searchParams["from"] = query.from;
    if (query.to !== undefined) searchParams["to"] = query.to;
    if (query.page !== undefined) searchParams["page"] = query.page;
    if (query.size !== undefined) searchParams["size"] = query.size;

    try {
      const res = await ky.get(url, {
        headers: this.authHeaders(),
        searchParams,
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      const body = await res.json<NcsWorkloadEventsResponse>();

      unwrapHeader(body);
      if (!Array.isArray(body.events)) {
        if (body.events === undefined) return { totalCount: 0, events: [] };
        throw new NhnCloudCliError(
          "NCS API 응답 형식 오류: events 가 배열이 아닙니다.",
          EXIT_API_ERROR,
        );
      }
      const events = body.events.filter(isNcsWorkloadEvent);

      const headerTotal = res.headers.get("x-total-count");
      const totalCount =
        headerTotal !== null && /^\d+$/.test(headerTotal) ? Number(headerTotal) : events.length;

      return { totalCount, events };
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * workload 의 실행 히스토리 목록을 반환한다.
   * GET /ncs/v1.0/appkeys/{appKey}/workloads/{workloadId}/history
   * 응답: { header, history: [...] } — named 필드.
   * pagination: getWorkloadEvents 와 동일한 방어적 X-Total-Count fallback 패턴.
   */
  async listWorkloadHistory(
    id: string,
    query: NcsWorkloadHistoryListParams = {},
  ): Promise<{ totalCount: number; history: NcsWorkloadHistorySummary[] }> {
    const url = `${this.baseUrl}/workloads/${encodeURIComponent(id)}/history`;
    const searchParams: Record<string, string | number> = {};
    if (query.page !== undefined) searchParams["page"] = query.page;
    if (query.size !== undefined) searchParams["size"] = query.size;
    if (query.sort !== undefined) searchParams["sort"] = query.sort;

    try {
      const res = await ky.get(url, {
        headers: this.authHeaders(),
        searchParams,
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      const body = await res.json<NcsWorkloadHistoryListResponse>();

      unwrapHeader(body);
      if (!Array.isArray(body.history)) {
        if (body.history === undefined) return { totalCount: 0, history: [] };
        throw new NhnCloudCliError(
          "NCS API 응답 형식 오류: history 가 배열이 아닙니다.",
          EXIT_API_ERROR,
        );
      }
      const history = body.history.filter(isNcsWorkloadHistorySummary);

      const headerTotal = res.headers.get("x-total-count");
      const totalCount =
        headerTotal !== null && /^\d+$/.test(headerTotal) ? Number(headerTotal) : history.length;

      return { totalCount, history };
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * workload 실행 히스토리 단건을 반환한다 (당시 사용한 template 스냅샷 포함).
   * GET /ncs/v1.0/appkeys/{appKey}/workloads/{workloadId}/history/{historyId}
   * 응답: { header, history: {...}, template: {...} } — history/template 이 sibling named 필드(docs 예제 확정).
   */
  async getWorkloadHistory(id: string, historyId: string): Promise<NcsWorkloadHistoryDetail> {
    const url = `${this.baseUrl}/workloads/${encodeURIComponent(id)}/history/${encodeURIComponent(historyId)}`;
    try {
      const res = await ky.get(url, {
        headers: this.authHeaders(),
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      const body = await res.json<NcsWorkloadHistoryGetResponse>();

      unwrapHeader(body);
      if (!isNcsWorkloadHistoryDetail(body.history)) {
        throw new NhnCloudCliError(
          "NCS API 응답 형식 오류: history 필드가 없거나 형식이 올바르지 않습니다.",
          EXIT_API_ERROR,
        );
      }
      return { ...body.history, template: body.template };
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * workload 의 예약 실행 히스토리 목록을 반환한다.
   * GET /ncs/v1.0/appkeys/{appKey}/workloads/{workloadId}/schedulehistory
   * 응답: { header, schedulehistory: [...] } — named 필드. docs 에 X-Total-Count 헤더가 없어
   * totalCount 는 반환하지 않는다(phase 범위 — page/size 는 후속 필요 시 추가, ADR-020 표 갱신 불필요한 범위 내 결정).
   */
  async getWorkloadScheduleHistory(
    id: string,
  ): Promise<{ scheduleHistory: NcsWorkloadScheduleHistory[] }> {
    const url = `${this.baseUrl}/workloads/${encodeURIComponent(id)}/schedulehistory`;
    try {
      const res = await ky.get(url, {
        headers: this.authHeaders(),
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      const body = await res.json<NcsWorkloadScheduleHistoryResponse>();

      unwrapHeader(body);
      if (!Array.isArray(body.schedulehistory)) {
        if (body.schedulehistory === undefined) return { scheduleHistory: [] };
        throw new NhnCloudCliError(
          "NCS API 응답 형식 오류: schedulehistory 가 배열이 아닙니다.",
          EXIT_API_ERROR,
        );
      }
      return { scheduleHistory: body.schedulehistory.filter(isNcsWorkloadScheduleHistory) };
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * 설계도(template) 를 생성한다.
   * POST /ncs/v1.0/appkeys/{appKey}/templates
   * 요청 body 는 `--file <json>` 로 읽은 값을 그대로 전달한다(필수값 검증은 API 오류에 위임).
   * 응답: { header, template: {...} } — named 필드(getTemplate 과 동일 패턴).
   */
  async createTemplate(body: unknown): Promise<NcsTemplateDetail> {
    const url = `${this.baseUrl}/templates`;
    try {
      const res = await ky.post(url, {
        headers: this.authHeaders(),
        json: body,
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      const resBody = await res.json<NcsTemplateGetResponse>();

      unwrapHeader(resBody);
      if (!isNcsTemplateDetail(resBody.template)) {
        throw new NhnCloudCliError(
          "NCS API 응답 형식 오류: template 필드가 없거나 형식이 올바르지 않습니다.",
          EXIT_API_ERROR,
        );
      }
      return resBody.template;
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * 설계도(template) 를 삭제한다.
   * DELETE /ncs/v1.0/appkeys/{appKey}/templates/{id}
   */
  async deleteTemplate(id: string): Promise<void> {
    const url = `${this.baseUrl}/templates/${encodeURIComponent(id)}`;
    try {
      const res = await ky.delete(url, {
        headers: this.authHeaders(),
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      unwrapHeader(await res.json<NhnEnvelope<unknown>>());
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * 설계도(template) 의 새 버전을 생성한다.
   * POST /ncs/v1.0/appkeys/{appKey}/templates/{id}/versions
   * body 에 `sourceVersion` 이 필수(docs 확정)이나 클라이언트는 그대로 전달하고
   * 필수값 검증은 API 응답 오류에 위임한다(1-3 회피 — API 경로에서 EXIT_PARAM_ERROR 를 만들지 않음).
   * 응답: { header, version: {...} } — named 필드(getTemplateVersion 과 동일 패턴).
   */
  async createTemplateVersion(id: string, body: unknown): Promise<NcsTemplateVersionDetail> {
    const url = `${this.baseUrl}/templates/${encodeURIComponent(id)}/versions`;
    try {
      const res = await ky.post(url, {
        headers: this.authHeaders(),
        json: body,
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      const resBody = await res.json<NcsTemplateVersionGetResponse>();

      unwrapHeader(resBody);
      if (!isNcsTemplateVersionDetail(resBody.version)) {
        throw new NhnCloudCliError(
          "NCS API 응답 형식 오류: version 필드가 없거나 형식이 올바르지 않습니다.",
          EXIT_API_ERROR,
        );
      }
      return resBody.version;
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * 설계도(template) 버전을 삭제한다.
   * DELETE /ncs/v1.0/appkeys/{appKey}/templates/{id}/versions/{version}
   */
  async deleteTemplateVersion(id: string, version: string): Promise<void> {
    const url = `${this.baseUrl}/templates/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}`;
    try {
      const res = await ky.delete(url, {
        headers: this.authHeaders(),
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      unwrapHeader(await res.json<NhnEnvelope<unknown>>());
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * workload 를 일시정지한다.
   * POST /ncs/v1.0/appkeys/{appKey}/workloads/{id}/pause
   */
  async pauseWorkload(id: string): Promise<void> {
    const url = `${this.baseUrl}/workloads/${encodeURIComponent(id)}/pause`;
    try {
      const res = await ky.post(url, {
        headers: this.authHeaders(),
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      unwrapHeader(await res.json<NhnEnvelope<unknown>>());
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * workload 를 재개한다.
   * POST /ncs/v1.0/appkeys/{appKey}/workloads/{id}/resume
   */
  async resumeWorkload(id: string): Promise<void> {
    const url = `${this.baseUrl}/workloads/${encodeURIComponent(id)}/resume`;
    try {
      const res = await ky.post(url, {
        headers: this.authHeaders(),
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      unwrapHeader(await res.json<NhnEnvelope<unknown>>());
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * workload task 를 재시작한다.
   * POST /ncs/v1.0/appkeys/{appKey}/workloads/{id}/tasks/{taskId}/restart
   */
  async restartWorkloadTask(id: string, taskId: string): Promise<void> {
    const url = `${this.baseUrl}/workloads/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/restart`;
    try {
      const res = await ky.post(url, {
        headers: this.authHeaders(),
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      unwrapHeader(await res.json<NhnEnvelope<unknown>>());
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * workload 를 생성한다.
   * POST /ncs/v1.0/appkeys/{appKey}/workloads
   * 요청 body 는 `--file <json>` 로 읽은 값을 그대로 전달한다(필수값 검증은 API 오류에 위임 — createTemplate 과 동일).
   * 응답: { header, workload: {...} } — 생성된 workload 전체 객체(id 만 반환하는 축약 응답 아님, docs 예제 실측 확정).
   */
  async createWorkload(body: unknown): Promise<NcsWorkloadDetail> {
    const url = `${this.baseUrl}/workloads`;
    try {
      const res = await ky.post(url, {
        headers: this.authHeaders(),
        json: body,
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      const resBody = await res.json<NcsWorkloadGetResponse>();

      unwrapHeader(resBody);
      if (!isNcsWorkloadDetail(resBody.workload)) {
        throw new NhnCloudCliError(
          "NCS API 응답 형식 오류: workload 필드가 없거나 형식이 올바르지 않습니다.",
          EXIT_API_ERROR,
        );
      }
      return resBody.workload;
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * workload 를 전체 교체한다.
   * PUT /ncs/v1.0/appkeys/{appKey}/workloads/{id}
   * 응답: { header, workload: {...} } — createWorkload 와 동일한 전체 객체 응답(docs 예제 실측 확정).
   */
  async updateWorkload(id: string, body: unknown): Promise<NcsWorkloadDetail> {
    const url = `${this.baseUrl}/workloads/${encodeURIComponent(id)}`;
    try {
      const res = await ky.put(url, {
        headers: this.authHeaders(),
        json: body,
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      const resBody = await res.json<NcsWorkloadGetResponse>();

      unwrapHeader(resBody);
      if (!isNcsWorkloadDetail(resBody.workload)) {
        throw new NhnCloudCliError(
          "NCS API 응답 형식 오류: workload 필드가 없거나 형식이 올바르지 않습니다.",
          EXIT_API_ERROR,
        );
      }
      return resBody.workload;
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * workload 를 부분 변경한다 (JSON Patch 배열, RFC 6902).
   * PATCH /ncs/v1.0/appkeys/{appKey}/workloads/{id}
   * Content-Type 이 application/json-patch+json 이어야 한다(docs 확정) — authHeaders() 에 덮어써서 명시 지정.
   * 응답: { header, workload: {...} } — createWorkload 와 동일한 전체 객체 응답(docs 예제 실측 확정).
   * redirect/status 분기 불필요 — 공통 봉투 응답(HTTP 200 고정, ADR-006).
   */
  async patchWorkload(id: string, patch: unknown): Promise<NcsWorkloadDetail> {
    const url = `${this.baseUrl}/workloads/${encodeURIComponent(id)}`;
    try {
      const res = await ky.patch(url, {
        headers: { ...this.authHeaders(), "Content-Type": "application/json-patch+json" },
        json: patch,
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      const resBody = await res.json<NcsWorkloadGetResponse>();

      unwrapHeader(resBody);
      if (!isNcsWorkloadDetail(resBody.workload)) {
        throw new NhnCloudCliError(
          "NCS API 응답 형식 오류: workload 필드가 없거나 형식이 올바르지 않습니다.",
          EXIT_API_ERROR,
        );
      }
      return resBody.workload;
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * workload 가 `Running` 상태에 도달할 때까지 폴링한다 (instance client 의 waitForActive 선례, ADR-011).
   * 데드라인을 고정해두고 매 반복 남은 시간만큼만 대기해 timeoutMs 를 초과하지 않는다.
   * 타임아웃 시 마지막으로 조회한 상태를 메시지에 포함해 NhnCloudCliError(EXIT_API_ERROR) 를 던진다.
   */
  async waitForRunning(
    id: string,
    opts: { timeoutMs: number; intervalMs?: number },
  ): Promise<NcsWorkloadDetail> {
    const intervalMs = opts.intervalMs ?? DEFAULT_WAIT_POLL_INTERVAL_MS;
    const deadline = Date.now() + opts.timeoutMs;

    let lastWorkload: NcsWorkloadDetail | null = null;

    while (Date.now() < deadline) {
      const workload = await this.getWorkload(id);
      lastWorkload = workload;

      if (workload.status === "Running") {
        return workload;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
    }

    const lastStatus = lastWorkload ? lastWorkload.status : "unknown";
    throw new NhnCloudCliError(
      `NCS workload ${id} 가 Running 상태가 되지 않았습니다 (마지막 상태: ${lastStatus}). ` +
        `--wait 타임아웃(${Math.round(opts.timeoutMs / 1000)}초) 초과.`,
      EXIT_API_ERROR,
    );
  }

  /**
   * workload 를 삭제한다.
   * DELETE /ncs/v1.0/appkeys/{appKey}/workloads/{id}
   */
  async deleteWorkload(id: string): Promise<void> {
    const url = `${this.baseUrl}/workloads/${encodeURIComponent(id)}`;
    try {
      const res = await ky.delete(url, {
        headers: this.authHeaders(),
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      unwrapHeader(await res.json<NhnEnvelope<unknown>>());
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * 악성코드 검사 설정을 조회한다.
   * GET /ncs/v1.0/appkeys/{appKey}/malware/config (appkey-scoped, docs 예제 실측 확정 — 계정 레벨 아님)
   * 응답: { header, enabled: true|false } — named 필드 없이 header 와 나란히 flat 필드(docs 예제 실측 확정).
   */
  async getMalwareConfig(): Promise<NcsMalwareConfig> {
    const url = `${this.baseUrl}/malware/config`;
    try {
      const res = await ky.get(url, {
        headers: this.authHeaders(),
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      const body = await res.json<NcsMalwareConfigResponse>();

      unwrapHeader(body);
      if (!isNcsMalwareConfig(body)) {
        throw new NhnCloudCliError(
          "NCS API 응답 형식 오류: enabled 필드가 없거나 형식이 올바르지 않습니다.",
          EXIT_API_ERROR,
        );
      }
      return { enabled: body.enabled };
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * 악성코드 검사 설정을 변경한다.
   * POST /ncs/v1.0/appkeys/{appKey}/malware/config (method 는 POST — docs 예제 실측 확정, PUT 아님)
   * 요청 body: { enabled: boolean } — docs 필드 표기는 "String" 이나 예제 JSON 이 quote 없는 boolean
   * 리터럴이라 실제 wire 타입은 boolean(malware.enabled 실측 확정, ADR-020 트레이드오프 절 참조).
   * 응답: { header, enabled: true|false } — getMalwareConfig 와 동일한 flat 패턴.
   */
  async setMalwareConfig(enabled: boolean): Promise<NcsMalwareConfig> {
    const url = `${this.baseUrl}/malware/config`;
    try {
      const res = await ky.post(url, {
        headers: this.authHeaders(),
        json: { enabled },
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      const body = await res.json<NcsMalwareConfigResponse>();

      unwrapHeader(body);
      if (!isNcsMalwareConfig(body)) {
        throw new NhnCloudCliError(
          "NCS API 응답 형식 오류: enabled 필드가 없거나 형식이 올바르지 않습니다.",
          EXIT_API_ERROR,
        );
      }
      return { enabled: body.enabled };
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * workload 실행 히스토리의 악성코드 검사 결과를 조회한다.
   * GET /ncs/v1.0/appkeys/{appKey}/workloads/{workloadId}/history/{historyId}/malware
   * 응답: { header, scannedAt, infectedFiles, scannedDirectories, scannedFiles, reports: [...] } —
   * named 필드로 감싸지 않고 header 와 나란히 flat 필드(docs 예제 실측 확정, malware config 와 동일 패턴).
   * 모든 top-level 필드가 docs 상 optional(미검사 워크로드는 누락 가능) — 존재하면 그대로 통과시킨다.
   */
  async getMalwareResult(workloadId: string, historyId: string): Promise<NcsMalwareResult> {
    const url = `${this.baseUrl}/workloads/${encodeURIComponent(workloadId)}/history/${encodeURIComponent(historyId)}/malware`;
    try {
      const res = await ky.get(url, {
        headers: this.authHeaders(),
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      const body = await res.json<NcsMalwareResultResponse>();

      unwrapHeader(body);
      if (body.reports !== undefined && !Array.isArray(body.reports)) {
        throw new NhnCloudCliError(
          "NCS API 응답 형식 오류: reports 가 배열이 아닙니다.",
          EXIT_API_ERROR,
        );
      }
      return {
        scannedAt: body.scannedAt,
        infectedFiles: body.infectedFiles,
        scannedDirectories: body.scannedDirectories,
        scannedFiles: body.scannedFiles,
        reports: body.reports?.filter(isNcsMalwareReport) ?? [],
      };
    } catch (err) {
      if (err instanceof NhnCloudCliError) throw err;
      throw toNhnCloudCliError(err);
    }
  }
}
