import ky, { HTTPError } from "ky";
import { rdsMysqlHost } from "../../api/endpoints.js";
import { readHttpErrorBody, toNhnCloudCliError } from "../../api/httpError.js";
import { DEFAULT_TIMEOUT_MS } from "../../api/timeout.js";
import type { CloudEnvironment } from "../../config/types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR } from "../../utils/exit-codes.js";
import { RdsMysqlApiError } from "./errors.js";
import {
  classifyJobStatus,
  isRdsMysqlDbInstance,
  isRdsMysqlDbInstanceDetail,
  isRdsMysqlDbSchema,
  isRdsMysqlDbUser,
  isRdsMysqlJob,
  type RdsMysqlDbInstance,
  type RdsMysqlDbInstanceDetail,
  type RdsMysqlDbSchema,
  type RdsMysqlDbUser,
  type RdsMysqlDbUserCreateInput,
  type RdsMysqlDbUserUpdateInput,
  type RdsMysqlJob,
} from "./types.js";

/** 작업 상태 조회 간격 기본값 (ADR-047). */
const DEFAULT_JOB_POLL_INTERVAL_MS = 3000;

type HttpMethod = "get" | "post" | "put" | "delete";

type Guard<T> = (value: unknown) => value is T;

type Envelope = Record<string, unknown> & { header: Record<string, unknown> & { isSuccessful: boolean } };

export interface RdsMysqlJobWaitResult {
  outcome: "completed" | "failed" | "uncertain" | "timeout";
  job: RdsMysqlJob | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 성공 판정에 쓰는 header.isSuccessful 이 있는 봉투인지 검사한다 (ADR-006, ADR-046). */
function isEnvelope(value: unknown): value is Envelope {
  if (!isRecord(value)) return false;
  const header = value["header"];
  return isRecord(header) && typeof header["isSuccessful"] === "boolean";
}

function arrayOf<T>(guard: Guard<T>): Guard<T[]> {
  return (value: unknown): value is T[] => Array.isArray(value) && value.every(guard);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function envelopeError(header: Record<string, unknown>, httpStatus?: number, readRequest = false): RdsMysqlApiError {
  const code = header["resultCode"];
  const message = header["resultMessage"];
  return new RdsMysqlApiError(
    typeof code === "number" || typeof code === "string" ? code : String(code),
    typeof message === "string" ? message : "",
    httpStatus,
    { readRequest },
  );
}

/**
 * HTTP 4xx·5xx 응답 본문이 봉투면 결과 코드를 담은 RdsMysqlApiError 로, 아니면 공용 변환 결과로 바꾼다.
 * 요청 본문(비밀번호)은 오류 메시지에 넣지 않는다.
 */
async function toRdsMysqlError(err: unknown): Promise<NhnCloudCliError> {
  if (!(err instanceof HTTPError)) return toNhnCloudCliError(err);
  const body = await readHttpErrorBody(err);
  if (isEnvelope(body)) return envelopeError(body.header, err.response.status);
  return toNhnCloudCliError(err);
}

function formatError(field: string): NhnCloudCliError {
  return new NhnCloudCliError(`RDS for MySQL 응답 형식 오류: ${field}`, EXIT_API_ERROR);
}

/** header 키를 뺀 나머지 키를 원래 순서대로 담는다. 출력 단계가 봉투를 다시 보지 않게 한다. */
function withoutHeader(response: Envelope): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(response)) {
    if (key !== "header") result[key] = value;
  }
  return result;
}

/**
 * RDS for MySQL API v3 클라이언트 (ADR-046).
 * 요청마다 appkey 와 공통 UAK 를 정적 헤더로 보낸다. OAuth 토큰으로 교환하지 않는다.
 * 결과는 body 가 아니라 header 옆의 이름 있는 필드로 온다.
 */
export class RdsMysqlClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(appKey: string, uakId: string, uakSecret: string, region: string, environment: CloudEnvironment) {
    this.baseUrl = `https://${rdsMysqlHost(region, environment)}/v3.0`;
    this.headers = {
      "X-TC-APP-KEY": appKey,
      "X-TC-AUTHENTICATION-ID": uakId,
      "X-TC-AUTHENTICATION-SECRET": uakSecret,
    };
  }

  /**
   * 요청을 보내고 성공 봉투를 반환한다.
   * 쓰기 요청이 중복 실행되지 않게 재시도하지 않는다.
   */
  private async send(method: HttpMethod, path: string, json?: unknown): Promise<Envelope> {
    let response: unknown;
    try {
      response = await ky[method](`${this.baseUrl}${path}`, {
        headers: this.headers,
        ...(json === undefined ? {} : { json }),
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      }).json<unknown>();
    } catch (err) {
      throw await toRdsMysqlError(err);
    }

    if (!isEnvelope(response)) throw formatError("header");
    if (!response.header.isSuccessful) throw envelopeError(response.header, undefined, method === "get");
    return response;
  }

  /** 이름 있는 필드 하나를 가드로 검사해 반환한다. 목록이 배열이 아니면 빈 배열로 숨기지 않고 형식 오류로 끝낸다. */
  private async field<T>(method: HttpMethod, path: string, field: string, guard: Guard<T>, json?: unknown): Promise<T> {
    const value = (await this.send(method, path, json))[field];
    if (!guard(value)) throw formatError(field);
    return value;
  }

  /** header 를 뺀 최상위 객체를 가드로 검사해 반환한다. */
  private async topLevel<T>(path: string, name: string, guard: Guard<T>): Promise<T> {
    const value = withoutHeader(await this.send("get", path));
    if (!guard(value)) throw formatError(name);
    return value;
  }

  private instancePath(dbInstanceId: string): string {
    return `/db-instances/${encodeURIComponent(dbInstanceId)}`;
  }

  private userPath(dbInstanceId: string, dbUserId: string): string {
    return `${this.instancePath(dbInstanceId)}/db-users/${encodeURIComponent(dbUserId)}`;
  }

  listDbInstances(): Promise<RdsMysqlDbInstance[]> {
    return this.field("get", "/db-instances", "dbInstances", arrayOf(isRdsMysqlDbInstance));
  }

  getDbInstance(dbInstanceId: string): Promise<RdsMysqlDbInstanceDetail> {
    return this.topLevel(this.instancePath(dbInstanceId), "dbInstance", isRdsMysqlDbInstanceDetail);
  }

  listDbSchemas(dbInstanceId: string): Promise<RdsMysqlDbSchema[]> {
    return this.field("get", `${this.instancePath(dbInstanceId)}/db-schemas`, "dbSchemas", arrayOf(isRdsMysqlDbSchema));
  }

  createDbSchema(dbInstanceId: string, dbSchemaName: string): Promise<string> {
    return this.field("post", `${this.instancePath(dbInstanceId)}/db-schemas`, "jobId", isString, { dbSchemaName });
  }

  listDbUsers(dbInstanceId: string): Promise<RdsMysqlDbUser[]> {
    return this.field("get", `${this.instancePath(dbInstanceId)}/db-users`, "dbUsers", arrayOf(isRdsMysqlDbUser));
  }

  createDbUser(dbInstanceId: string, input: RdsMysqlDbUserCreateInput): Promise<string> {
    return this.field("post", `${this.instancePath(dbInstanceId)}/db-users`, "jobId", isString, input);
  }

  /** 값이 undefined 인 키는 본문에서 뺀다. */
  updateDbUser(dbInstanceId: string, dbUserId: string, input: RdsMysqlDbUserUpdateInput): Promise<string> {
    const body = Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
    return this.field("put", this.userPath(dbInstanceId, dbUserId), "jobId", isString, body);
  }

  deleteDbUser(dbInstanceId: string, dbUserId: string): Promise<string> {
    return this.field("delete", this.userPath(dbInstanceId, dbUserId), "jobId", isString);
  }

  getJob(jobId: string): Promise<RdsMysqlJob> {
    return this.topLevel(`/jobs/${encodeURIComponent(jobId)}`, "job", isRdsMysqlJob);
  }

  /**
   * 작업이 끝날 때까지 상태를 조회한다 (ADR-047).
   * 상한을 넘기면 마지막으로 받은 작업과 함께 timeout 을 돌려준다. 조회 오류는 잡지 않고 그대로 던진다.
   */
  async waitForJob(jobId: string, opts: { timeoutMs: number; intervalMs?: number }): Promise<RdsMysqlJobWaitResult> {
    const intervalMs = opts.intervalMs ?? DEFAULT_JOB_POLL_INTERVAL_MS;
    const deadline = Date.now() + opts.timeoutMs;
    let lastJob: RdsMysqlJob | null = null;

    while (Date.now() < deadline) {
      const job = await this.getJob(jobId);
      lastJob = job;

      const outcome = classifyJobStatus(job.jobStatus);
      if (outcome !== "running") return { outcome, job };

      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
    }

    return { outcome: "timeout", job: lastJob };
  }
}
