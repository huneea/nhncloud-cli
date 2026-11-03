import ky from "ky";
import { toNhnCloudCliError } from "../../api/httpError.js";
import { DEFAULT_TIMEOUT_MS } from "../../api/timeout.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR } from "../../utils/exit-codes.js";
import type { Volume, VolumeListParams, CreateVolumeParams } from "./types.js";

// ── 응답 타입 가드 ─────────────────────────────────────────────────────────────

function isVolume(val: unknown): val is Volume {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    typeof obj["id"] === "string" &&
    // Cinder 는 --name 미지정 시 null — null 인 볼륨 하나가 list 전체를 거부하지 않게 허용 (isImage 선례).
    (typeof obj["name"] === "string" || obj["name"] === null) &&
    typeof obj["size"] === "number" &&
    typeof obj["status"] === "string" &&
    (obj["availability_zone"] === undefined || typeof obj["availability_zone"] === "string") &&
    Array.isArray(obj["attachments"])
  );
}

function isVolumeResponse(val: unknown): val is { volume: Volume } {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  return isVolume(obj["volume"]);
}

const DEFAULT_POLL_INTERVAL_MS = 3_000;

/** get() 은 모든 오류를 NhnCloudCliError 로 바꾸므로 상태를 메시지의 "(404)" 접두사로 판별한다. */
function isNotFound(err: unknown): boolean {
  return err instanceof NhnCloudCliError && err.message.startsWith("API 호출 실패 (404)");
}

// ── BlockStorageClient ────────────────────────────────────────────────────────

export class BlockStorageClient {
  private readonly tokenId: string;
  private readonly endpoint: string; // blockStorageEndpoint (/v2/{tenantId} 까지 포함)

  constructor(tokenId: string, blockStorageEndpoint: string) {
    this.tokenId = tokenId;
    this.endpoint = blockStorageEndpoint;
  }

  private authHeaders(): Record<string, string> {
    return { "X-Auth-Token": this.tokenId };
  }

  async list(params?: VolumeListParams): Promise<Volume[]> {
    // summary(`/volumes`)는 id·name·links 만 반환해 size·status·attachments 가 없다 → isVolume 가드 실패.
    // instance 의 `/servers/detail` 선례와 동일하게 detail 엔드포인트를 쓴다.
    const url = `${this.endpoint}/volumes/detail`;
    const searchParams: Record<string, string | number> = {};
    if (params?.sort !== undefined) searchParams["sort"] = params.sort;
    if (params?.limit !== undefined) searchParams["limit"] = params.limit;
    if (params?.offset !== undefined) searchParams["offset"] = params.offset;
    if (params?.marker !== undefined) searchParams["marker"] = params.marker;
    try {
      const raw = await ky
        .get(url, { headers: this.authHeaders(), searchParams, retry: 0, timeout: DEFAULT_TIMEOUT_MS })
        .json();
      // isVolume 가드와 동일하게 캐스팅 전 object/null 을 명시 precheck (파일 내 컨벤션 일치).
      if (typeof raw !== "object" || raw === null) {
        throw new NhnCloudCliError(
          "volume list 응답 형식이 올바르지 않습니다 — volumes 배열이 없습니다.",
          EXIT_API_ERROR,
        );
      }
      const obj = raw as Record<string, unknown>;
      if (!Array.isArray(obj["volumes"])) {
        throw new NhnCloudCliError(
          "volume list 응답 형식이 올바르지 않습니다 — volumes 배열이 없습니다.",
          EXIT_API_ERROR,
        );
      }
      if (!obj["volumes"].every(isVolume)) {
        throw new NhnCloudCliError(
          "volume list 응답의 볼륨 항목 형식이 예상과 다릅니다 — API 응답 필드를 확인하세요.",
          EXIT_API_ERROR,
        );
      }
      return obj["volumes"] as Volume[];
    } catch (err) {
      throw toNhnCloudCliError(err);
    }
  }

  async get(id: string): Promise<Volume> {
    const url = `${this.endpoint}/volumes/${encodeURIComponent(id)}`;
    try {
      const raw = await ky
        .get(url, { headers: this.authHeaders(), retry: 0, timeout: DEFAULT_TIMEOUT_MS })
        .json();
      if (!isVolumeResponse(raw)) {
        throw new NhnCloudCliError(
          "volume get 응답 형식이 올바르지 않습니다 — volume 객체가 없습니다.",
          EXIT_API_ERROR,
        );
      }
      return raw.volume;
    } catch (err) {
      throw toNhnCloudCliError(err);
    }
  }

  async create(params: CreateVolumeParams): Promise<Volume> {
    const url = `${this.endpoint}/volumes`;
    const volumeBody: Record<string, unknown> = { size: params.size };
    if (params.name !== undefined) volumeBody["name"] = params.name;
    if (params.description !== undefined) volumeBody["description"] = params.description;
    if (params.volume_type !== undefined) volumeBody["volume_type"] = params.volume_type;
    if (params.availability_zone !== undefined) volumeBody["availability_zone"] = params.availability_zone;
    if (params.snapshot_id !== undefined) volumeBody["snapshot_id"] = params.snapshot_id;
    try {
      const raw = await ky
        .post(url, {
          headers: this.authHeaders(),
          json: { volume: volumeBody },
          retry: 0,
          timeout: DEFAULT_TIMEOUT_MS,
        })
        .json();
      if (!isVolumeResponse(raw)) {
        throw new NhnCloudCliError(
          "volume create 응답에 volume 객체가 없습니다.",
          EXIT_API_ERROR,
        );
      }
      return raw.volume;
    } catch (err) {
      throw toNhnCloudCliError(err);
    }
  }

  /** 볼륨을 삭제한다 (DELETE /volumes/{id}, 202 무응답). 연결된 볼륨은 서버가 거절한다. */
  async delete(id: string): Promise<void> {
    const url = `${this.endpoint}/volumes/${encodeURIComponent(id)}`;
    try {
      await ky.delete(url, { headers: this.authHeaders(), retry: 0, timeout: DEFAULT_TIMEOUT_MS });
    } catch (err) {
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * 볼륨이 `done` 조건을 만족할 때까지 폴링한다.
   * `error*` 상태가 되면 기다리지 않고 실패하고, 제한 시간을 넘으면 마지막 상태를 담아 실패한다.
   */
  async waitForVolume(
    id: string,
    done: (volume: Volume) => boolean,
    opts: { timeoutMs: number; intervalMs?: number; label: string },
  ): Promise<Volume> {
    const intervalMs = opts.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const deadline = Date.now() + opts.timeoutMs;
    let lastStatus = "unknown";
    for (;;) {
      const volume = await this.get(id);
      lastStatus = volume.status;
      if (done(volume)) return volume;
      if (volume.status.startsWith("error")) {
        throw new NhnCloudCliError(
          `볼륨 ${id} 가 ${opts.label} 중 오류 상태가 되었습니다 (상태: ${volume.status}).`,
          EXIT_API_ERROR,
        );
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
    }
    throw new NhnCloudCliError(
      `볼륨 ${id} 의 ${opts.label} 이 끝나지 않았습니다 (마지막 상태: ${lastStatus}). ` +
        `--wait 타임아웃(${Math.round(opts.timeoutMs / 1000)}초) 초과.`,
      EXIT_API_ERROR,
    );
  }

  /** 볼륨 조회가 404 가 될 때까지 폴링한다. `error_deleting` 이 되면 바로 실패한다. */
  async waitForDeleted(id: string, opts: { timeoutMs: number; intervalMs?: number }): Promise<void> {
    const intervalMs = opts.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const deadline = Date.now() + opts.timeoutMs;
    let lastStatus = "unknown";
    for (;;) {
      try {
        const volume = await this.get(id);
        lastStatus = volume.status;
        if (volume.status.startsWith("error")) {
          throw new NhnCloudCliError(
            `볼륨 ${id} 삭제 중 오류 상태가 되었습니다 (상태: ${volume.status}).`,
            EXIT_API_ERROR,
          );
        }
      } catch (err) {
        if (isNotFound(err)) return;
        throw err;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
    }
    throw new NhnCloudCliError(
      `볼륨 ${id} 삭제가 끝나지 않았습니다 (마지막 상태: ${lastStatus}). ` +
        `--wait 타임아웃(${Math.round(opts.timeoutMs / 1000)}초) 초과.`,
      EXIT_API_ERROR,
    );
  }
}
