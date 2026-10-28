import ky, { HTTPError, TimeoutError } from "ky";
import { toNhnCloudCliError } from "../../api/httpError.js";
import { DEFAULT_TIMEOUT_MS } from "../../api/timeout.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR } from "../../utils/exit-codes.js";
import { toNetworkWriteError } from "../network/errors.js";
import type {
  PrivateDnsZone, PrivateDnsRecordSet, CreatePrivateDnsZoneParams, UpdatePrivateDnsZoneParams,
  CreatePrivateDnsRecordSetParams, UpdatePrivateDnsRecordSetParams,
} from "./types.js";

// ── 응답 타입 가드 ─────────────────────────────────────────────────────────────

function isNullableString(val: unknown): boolean {
  return val === null || typeof val === "string";
}

function isZone(val: unknown): val is PrivateDnsZone {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    typeof obj["id"] === "string" &&
    typeof obj["name"] === "string" &&
    isNullableString(obj["description"]) &&
    typeof obj["status"] === "string" &&
    Array.isArray(obj["networks"]) && obj["networks"].every((n) => typeof n === "string") &&
    typeof obj["created_at"] === "string" &&
    typeof obj["updated_at"] === "string" &&
    (obj["rrset_count"] === undefined || typeof obj["rrset_count"] === "number")
  );
}

function isRecordSet(val: unknown): val is PrivateDnsRecordSet {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    typeof obj["id"] === "string" &&
    typeof obj["name"] === "string" &&
    isNullableString(obj["description"]) &&
    typeof obj["zone_id"] === "string" &&
    typeof obj["ttl"] === "number" &&
    typeof obj["type"] === "string" &&
    Array.isArray(obj["records"]) &&
    obj["records"].every((r: unknown) =>
      typeof r === "object" && r !== null && typeof (r as Record<string, unknown>)["content"] === "string") &&
    typeof obj["created_at"] === "string" &&
    typeof obj["updated_at"] === "string"
  );
}

/** 값이 undefined 인 키를 뺀다 — 요청 본문에 선택 필드를 null 이나 빈 값으로 보내지 않기 위함. */
function omitUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function field(raw: unknown, key: string): unknown {
  return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)[key] : undefined;
}

/** 응답의 rel: "next" 링크에서 marker(와 limit)를 꺼낸다. 다음 페이지가 없으면 null. */
function nextMarker(raw: unknown, linksKey: string): { marker: string; limit?: string } | null {
  const links = field(raw, linksKey);
  if (!Array.isArray(links)) return null;
  const next = links.find((l: unknown) => field(l, "rel") === "next");
  if (next === undefined) return null;
  const href = field(next, "href");
  let params: URLSearchParams | null = null;
  if (typeof href === "string") {
    try { params = new URL(href).searchParams; } catch { params = null; }
  }
  const marker = params?.get("marker");
  if (!marker) {
    throw new NhnCloudCliError(`privatedns 응답 형식이 올바르지 않습니다 — ${linksKey} 의 next 링크에 marker 가 없습니다.`, EXIT_API_ERROR);
  }
  const limit = params?.get("limit");
  return limit ? { marker, limit } : { marker };
}

const ZONES_SHAPE = "privatedns zone list 응답 형식이 올바르지 않습니다 — zones 배열이 없습니다.";
const RRSETS_SHAPE = "privatedns record list 응답 형식이 올바르지 않습니다 — rrsets 배열이 없습니다.";

const WRITE_UNKNOWN_HINT: Record<"zone" | "record", string> = {
  zone: "요청이 반영됐는지 알 수 없습니다. nhncloud privatedns zone list 로 확인한 뒤 다시 실행하세요.",
  record: "요청이 반영됐는지 알 수 없습니다. nhncloud privatedns record list <zone> 으로 확인한 뒤 다시 실행하세요.",
};

/**
 * 쓰기 요청의 오류를 변환한다. 시간 초과·연결 오류는 서버 반영 여부를 알 수 없으므로 확인 안내를 덧붙인다.
 * HTTP 오류 응답과 응답 형식 오류에는 덧붙이지 않는다.
 */
async function toPrivateDnsWriteError(err: unknown, target: "zone" | "record"): Promise<NhnCloudCliError> {
  const base = await toNetworkWriteError(err);
  const unknownOutcome = err instanceof TimeoutError ||
    (err instanceof Error && !(err instanceof HTTPError) && !(err instanceof NhnCloudCliError));
  if (!unknownOutcome) return base;
  return new NhnCloudCliError(`${base.message}\n${WRITE_UNKNOWN_HINT[target]}`, base.exitCode);
}

// ── PrivateDnsClient ───────────────────────────────────────────────────────────

export class PrivateDnsClient {
  constructor(
    private readonly tokenId: string,
    private readonly networkEndpoint: string,
  ) {}

  private authHeaders(): Record<string, string> {
    return { "X-Auth-Token": this.tokenId };
  }

  /** 모든 페이지를 모은다. 첫 요청에는 limit 을 주지 않고, next 링크가 있으면 필터를 유지한 채 marker 로 이어 받는다. */
  private async listAll(path: string, key: string, filters: Record<string, string>, shapeMessage: string): Promise<unknown[]> {
    const items: unknown[] = [];
    const seen = new Set<string>();
    let page: { marker: string; limit?: string } | null = null;
    do {
      const searchParams: Record<string, string> = { ...filters, ...(page ?? {}) };
      const raw: unknown = await ky.get(`${this.networkEndpoint}${path}`, {
        headers: this.authHeaders(), searchParams, retry: 0, timeout: DEFAULT_TIMEOUT_MS,
      }).json();
      const list = field(raw, key);
      if (!Array.isArray(list)) throw new NhnCloudCliError(shapeMessage, EXIT_API_ERROR);
      items.push(...list);
      page = nextMarker(raw, `${key}_links`);
      if (page !== null) {
        if (seen.has(page.marker)) {
          throw new NhnCloudCliError(`privatedns 응답 형식이 올바르지 않습니다 — ${key}_links 의 marker 가 반복됩니다.`, EXIT_API_ERROR);
        }
        seen.add(page.marker);
      }
    } while (page !== null);
    return items;
  }

  async listZones(filters?: { name?: string }): Promise<PrivateDnsZone[]> {
    try {
      const zones = await this.listAll("/privatedns/zones", "zones", omitUndefined(filters ?? {}) as Record<string, string>, ZONES_SHAPE);
      if (!zones.every(isZone)) {
        throw new NhnCloudCliError(ZONES_SHAPE, EXIT_API_ERROR);
      }
      return zones;
    } catch (err) { throw toNhnCloudCliError(err); }
  }

  async getZone(zoneId: string): Promise<PrivateDnsZone> {
    try {
      const raw: unknown = await ky.get(`${this.networkEndpoint}/privatedns/zones/${encodeURIComponent(zoneId)}`, {
        headers: this.authHeaders(), retry: 0, timeout: DEFAULT_TIMEOUT_MS,
      }).json();
      return zoneOf(raw, "get");
    } catch (err) { throw toNhnCloudCliError(err); }
  }

  /** zone 을 생성한다 (POST privatedns/zones). */
  async createZone(params: CreatePrivateDnsZoneParams): Promise<PrivateDnsZone> {
    try {
      const raw: unknown = await ky.post(`${this.networkEndpoint}/privatedns/zones`, {
        headers: this.authHeaders(), json: { zone: omitUndefined(params) }, retry: 0, timeout: DEFAULT_TIMEOUT_MS,
      }).json();
      return zoneOf(raw, "create");
    } catch (err) { throw await toPrivateDnsWriteError(err, "zone"); }
  }

  /** zone 설명·연결 VPC 를 변경한다 (PUT privatedns/zones/{zoneId}). */
  async updateZone(zoneId: string, params: UpdatePrivateDnsZoneParams): Promise<PrivateDnsZone> {
    try {
      const raw: unknown = await ky.put(`${this.networkEndpoint}/privatedns/zones/${encodeURIComponent(zoneId)}`, {
        headers: this.authHeaders(), json: { zone: params }, retry: 0, timeout: DEFAULT_TIMEOUT_MS,
      }).json();
      return zoneOf(raw, "update");
    } catch (err) { throw await toPrivateDnsWriteError(err, "zone"); }
  }

  async deleteZone(zoneId: string): Promise<void> {
    try {
      await ky.delete(`${this.networkEndpoint}/privatedns/zones/${encodeURIComponent(zoneId)}`, {
        headers: this.authHeaders(), retry: 0, timeout: DEFAULT_TIMEOUT_MS,
      });
    } catch (err) { throw await toPrivateDnsWriteError(err, "zone"); }
  }

  async listRecordSets(zoneId: string, filters?: { name?: string; type?: string }): Promise<PrivateDnsRecordSet[]> {
    try {
      const rrsets = await this.listAll(
        `/privatedns/zones/${encodeURIComponent(zoneId)}/rrsets`, "rrsets",
        omitUndefined(filters ?? {}) as Record<string, string>, RRSETS_SHAPE,
      );
      if (!rrsets.every(isRecordSet)) {
        throw new NhnCloudCliError(RRSETS_SHAPE, EXIT_API_ERROR);
      }
      return rrsets;
    } catch (err) { throw toNhnCloudCliError(err); }
  }

  async getRecordSet(zoneId: string, rrsetId: string): Promise<PrivateDnsRecordSet> {
    try {
      const raw: unknown = await ky.get(this.rrsetUrl(zoneId, rrsetId), {
        headers: this.authHeaders(), retry: 0, timeout: DEFAULT_TIMEOUT_MS,
      }).json();
      return rrsetOf(raw, "get");
    } catch (err) { throw toNhnCloudCliError(err); }
  }

  /** 레코드 세트를 생성한다 (POST privatedns/zones/{zoneId}/rrsets). */
  async createRecordSet(zoneId: string, params: CreatePrivateDnsRecordSetParams): Promise<PrivateDnsRecordSet> {
    try {
      const raw: unknown = await ky.post(`${this.networkEndpoint}/privatedns/zones/${encodeURIComponent(zoneId)}/rrsets`, {
        headers: this.authHeaders(), json: { rrset: omitUndefined(params) }, retry: 0, timeout: DEFAULT_TIMEOUT_MS,
      }).json();
      return rrsetOf(raw, "create");
    } catch (err) { throw await toPrivateDnsWriteError(err, "record"); }
  }

  /** 레코드 세트를 변경한다 (PUT privatedns/zones/{zoneId}/rrsets/{rrsetId}). */
  async updateRecordSet(zoneId: string, rrsetId: string, params: UpdatePrivateDnsRecordSetParams): Promise<PrivateDnsRecordSet> {
    try {
      const raw: unknown = await ky.put(this.rrsetUrl(zoneId, rrsetId), {
        headers: this.authHeaders(), json: { rrset: params }, retry: 0, timeout: DEFAULT_TIMEOUT_MS,
      }).json();
      return rrsetOf(raw, "update");
    } catch (err) { throw await toPrivateDnsWriteError(err, "record"); }
  }

  async deleteRecordSet(zoneId: string, rrsetId: string): Promise<void> {
    try {
      await ky.delete(this.rrsetUrl(zoneId, rrsetId), {
        headers: this.authHeaders(), retry: 0, timeout: DEFAULT_TIMEOUT_MS,
      });
    } catch (err) { throw await toPrivateDnsWriteError(err, "record"); }
  }

  private rrsetUrl(zoneId: string, rrsetId: string): string {
    return `${this.networkEndpoint}/privatedns/zones/${encodeURIComponent(zoneId)}/rrsets/${encodeURIComponent(rrsetId)}`;
  }
}

function zoneOf(raw: unknown, action: string): PrivateDnsZone {
  const zone = field(raw, "zone");
  if (!isZone(zone)) {
    throw new NhnCloudCliError(`privatedns zone ${action} 응답 형식이 올바르지 않습니다 — zone 객체가 없습니다.`, EXIT_API_ERROR);
  }
  return zone;
}

function rrsetOf(raw: unknown, action: string): PrivateDnsRecordSet {
  const rrset = field(raw, "rrset");
  if (!isRecordSet(rrset)) {
    throw new NhnCloudCliError(`privatedns record ${action} 응답 형식이 올바르지 않습니다 — rrset 객체가 없습니다.`, EXIT_API_ERROR);
  }
  return rrset;
}
