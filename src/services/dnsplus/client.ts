import ky, { HTTPError } from "ky";
import { endpointFor } from "../../api/endpoints.js";
import { toNhnCloudCliError } from "../../api/httpError.js";
import { DEFAULT_TIMEOUT_MS } from "../../api/timeout.js";
import type { CloudEnvironment } from "../../config/types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR, EXIT_AUTH_ERROR } from "../../utils/exit-codes.js";
import { DnsplusApiError } from "./errors.js";
import {
  isDnsplusRecordset,
  isDnsplusZone,
  type DnsplusRecordset,
  type DnsplusRecordsetCreateInput,
  type DnsplusZone,
} from "./types.js";

/** API 가 허용하는 한 번의 조회 개수 상한이다. */
const PAGE_LIMIT = 3000;

type Envelope = Record<string, unknown> & { header: Record<string, unknown> & { isSuccessful: boolean } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEnvelope(value: unknown): value is Envelope {
  if (!isRecord(value)) return false;
  const header = value["header"];
  return isRecord(header) && typeof header["isSuccessful"] === "boolean";
}

function formatError(field: string): NhnCloudCliError {
  return new NhnCloudCliError(`DNS Plus 응답 형식 오류: ${field}`, EXIT_API_ERROR);
}

export interface DnsplusZoneQuery {
  zoneIdList?: string[];
  searchZoneName?: string;
}

export interface DnsplusRecordsetQuery {
  recordsetIdList?: string[];
  recordsetTypeList?: string[];
  searchRecordsetName?: string;
}

/**
 * DNS Plus API v1.0 클라이언트 (ADR-049).
 * 앱키는 요청 경로에만 들어가고 인증 헤더는 없다. 요청 URL 이 앱키를 담으므로
 * 오류 메시지에 URL 을 싣지 않고, 남는 메시지에서도 앱키를 가린다.
 */
export class DnsplusClient {
  private readonly appKey: string;
  private readonly baseUrl: string;

  constructor(appKey: string, environment: CloudEnvironment = "real") {
    this.appKey = appKey;
    this.baseUrl = `${endpointFor("dnsplus", environment)}/dnsplus/v1.0/appkeys/${encodeURIComponent(appKey)}`;
  }

  /** 앱키가 든 요청 경로를 출력용 표기로 바꾼다. */
  static displayPath(path: string): string {
    return `/dnsplus/v1.0/appkeys/<appkey>${path}`;
  }

  private redact(message: string): string {
    return message.split(this.appKey).join("<appkey>").split(encodeURIComponent(this.appKey)).join("<appkey>");
  }

  private toError(err: unknown): NhnCloudCliError {
    if (err instanceof HTTPError) {
      const status = err.response.status;
      return new NhnCloudCliError(
        `DNS Plus API 호출 실패 (${status})`,
        status === 401 || status === 403 ? EXIT_AUTH_ERROR : EXIT_API_ERROR,
      );
    }
    const converted = toNhnCloudCliError(err);
    return new NhnCloudCliError(this.redact(converted.message), converted.exitCode);
  }

  /** 요청을 보내고 성공 봉투를 돌려준다. 쓰기가 중복 실행되지 않게 재시도하지 않는다. */
  private async send(
    method: "get" | "post" | "delete",
    path: string,
    options: { json?: unknown; searchParams?: Record<string, string | number> } = {},
  ): Promise<Envelope> {
    let response: unknown;
    try {
      response = await ky[method](`${this.baseUrl}${path}`, {
        ...(options.json === undefined ? {} : { json: options.json }),
        ...(options.searchParams === undefined ? {} : { searchParams: options.searchParams }),
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      }).json<unknown>();
    } catch (err) {
      throw this.toError(err);
    }
    if (!isEnvelope(response)) throw formatError("header");
    if (!response.header.isSuccessful) {
      const code = response.header["resultCode"];
      const message = response.header["resultMessage"];
      throw new DnsplusApiError(
        typeof code === "number" || typeof code === "string" ? code : String(code),
        this.redact(typeof message === "string" ? message : ""),
      );
    }
    return response;
  }

  /** 모든 페이지를 읽어 이어 붙인다. totalCount 를 채우면 멈춘다. */
  private async paginate<T>(
    path: string,
    listField: string,
    guard: (value: unknown) => value is T,
    params: Record<string, string>,
  ): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; ; page += 1) {
      const response = await this.send("get", path, {
        searchParams: { ...params, page, limit: PAGE_LIMIT },
      });
      const list = response[listField];
      const total = response["totalCount"];
      if (!Array.isArray(list) || !list.every(guard)) throw formatError(listField);
      if (typeof total !== "number") throw formatError("totalCount");
      items.push(...list);
      if (list.length === 0 || items.length >= total) return items;
    }
  }

  async listZones(query: DnsplusZoneQuery = {}): Promise<DnsplusZone[]> {
    return this.paginate("/zones", "zoneList", isDnsplusZone, {
      ...(query.zoneIdList?.length ? { zoneIdList: query.zoneIdList.join(",") } : {}),
      ...(query.searchZoneName ? { searchZoneName: query.searchZoneName } : {}),
    });
  }

  async listRecordsets(zoneId: string, query: DnsplusRecordsetQuery = {}): Promise<DnsplusRecordset[]> {
    return this.paginate(`/zones/${encodeURIComponent(zoneId)}/recordsets`, "recordsetList", isDnsplusRecordset, {
      ...(query.recordsetIdList?.length ? { recordsetIdList: query.recordsetIdList.join(",") } : {}),
      ...(query.recordsetTypeList?.length ? { recordsetTypeList: query.recordsetTypeList.join(",") } : {}),
      ...(query.searchRecordsetName ? { searchRecordsetName: query.searchRecordsetName } : {}),
    });
  }

  async createRecordset(zoneId: string, input: DnsplusRecordsetCreateInput): Promise<DnsplusRecordset> {
    const response = await this.send("post", `/zones/${encodeURIComponent(zoneId)}/recordsets`, {
      json: { recordset: input },
    });
    const recordset = response["recordset"];
    if (!isDnsplusRecordset(recordset)) throw formatError("recordset");
    return recordset;
  }

  async deleteRecordsets(zoneId: string, recordsetIds: string[]): Promise<void> {
    await this.send("delete", `/zones/${encodeURIComponent(zoneId)}/recordsets`, {
      searchParams: { recordsetIdList: recordsetIds.join(",") },
    });
  }
}
