/**
 * RDS for MySQL API v3 응답·요청 타입 (ADR-046).
 * 가드는 명령이 쓰는 필드만 필수로 본다. 표시만 하는 필드는 없거나 null 이어도 받고,
 * 명령이 쓰지 않는 필드는 검사하지 않는다. 문서가 nullable 여부를 밝히지 않아서다.
 */

export interface RdsMysqlDbInstance {
  dbInstanceId: string;
  dbInstanceName: string;
  dbInstanceStatus: string;
  dbVersion?: string | null;
  dbInstanceType?: string | null;
  progressStatus?: string | null;
  [key: string]: unknown;
}

export interface RdsMysqlDbInstanceDetail extends RdsMysqlDbInstance {
  /** 쓰는 쪽은 `=== false` 일 때만 미지원으로 본다. 가드는 검사하지 않는다. */
  supportAuthenticationPlugin?: boolean | null;
}

export interface RdsMysqlDbSchema {
  dbSchemaId: string;
  dbSchemaName: string;
  dbSchemaStatus: string;
  createdYmdt?: string | null;
  [key: string]: unknown;
}

export interface RdsMysqlDbUser {
  dbUserId: string;
  dbUserName: string;
  host: string;
  authorityType: string;
  dbUserStatus: string;
  authenticationPlugin?: string | null;
  tlsOption?: string | null;
  [key: string]: unknown;
}

export interface RdsMysqlResourceRelation {
  resourceType?: string | null;
  resourceId?: string | null;
  [key: string]: unknown;
}

export interface RdsMysqlJob {
  jobId: string;
  jobStatus: string;
  resourceRelations?: RdsMysqlResourceRelation[] | null;
  createdYmdt?: string | null;
  updatedYmdt?: string | null;
  [key: string]: unknown;
}

export type RdsMysqlAuthorityType = "READ" | "CRUD" | "DDL" | "ALL";
export type RdsMysqlAuthPlugin = "NATIVE" | "CACHING_SHA2" | "SHA256";
export type RdsMysqlTlsOption = "NONE" | "SSL" | "X509";

export interface RdsMysqlDbUserCreateInput {
  dbUserName: string;
  dbPassword: string;
  host: string;
  authorityType: RdsMysqlAuthorityType;
  authenticationPlugin?: RdsMysqlAuthPlugin;
  tlsOption?: RdsMysqlTlsOption;
}

/**
 * 권한 변경 요청 본문이다. tlsOption 은 서버가 준 현재 값을 그대로 되돌려 보내므로 string 으로 받는다.
 * authenticationPlugin 은 두지 않는다. 플러그인 변경은 비밀번호 변경이 함께 있어야 해서다 (ADR-047).
 */
export interface RdsMysqlDbUserUpdateInput {
  authorityType: RdsMysqlAuthorityType;
  tlsOption?: string;
}

export type RdsMysqlJobOutcome = "completed" | "failed" | "uncertain" | "running";

const FAILED_JOB_STATUSES: ReadonlySet<string> = new Set([
  "FAILED",
  "ERROR",
  "CANCELED",
  "INTERRUPTED",
  "CANNOT_PROGRESS",
  "FAIL_TO_READY",
  "FAIL_TO_REGISTER",
]);

/** 끝났지만 요청한 변경이 반영됐는지 단정할 수 없는 상태다 (ADR-047). */
const UNCERTAIN_JOB_STATUSES: ReadonlySet<string> = new Set(["COMPLETED_WITH_ERROR", "DELETED"]);

/**
 * 작업 상태를 대기 결과로 해석한다 (ADR-047).
 * 문서에 없는 값은 아직 진행 중으로 보고 대기 상한까지 계속 조회한다.
 */
export function classifyJobStatus(status: string): RdsMysqlJobOutcome {
  if (status === "COMPLETED") return "completed";
  if (FAILED_JOB_STATUSES.has(status)) return "failed";
  if (UNCERTAIN_JOB_STATUSES.has(status)) return "uncertain";
  return "running";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasStrings(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => typeof obj[key] === "string");
}

/** 선택 필드는 없거나 null 이거나 string 이어야 한다. */
function hasOptionalStrings(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => obj[key] === undefined || obj[key] === null || typeof obj[key] === "string");
}

export function isRdsMysqlDbInstance(value: unknown): value is RdsMysqlDbInstance {
  if (!isRecord(value)) return false;
  return (
    hasStrings(value, ["dbInstanceId", "dbInstanceName", "dbInstanceStatus"]) &&
    hasOptionalStrings(value, ["dbVersion", "dbInstanceType", "progressStatus"])
  );
}

/** 상세 응답의 추가 필드는 명령이 표시만 하거나 쓰는 쪽이 따로 해석하므로 목록 항목 가드와 같다. */
export function isRdsMysqlDbInstanceDetail(value: unknown): value is RdsMysqlDbInstanceDetail {
  return isRdsMysqlDbInstance(value);
}

export function isRdsMysqlDbSchema(value: unknown): value is RdsMysqlDbSchema {
  if (!isRecord(value)) return false;
  return (
    hasStrings(value, ["dbSchemaId", "dbSchemaName", "dbSchemaStatus"]) &&
    hasOptionalStrings(value, ["createdYmdt"])
  );
}

export function isRdsMysqlDbUser(value: unknown): value is RdsMysqlDbUser {
  if (!isRecord(value)) return false;
  return (
    hasStrings(value, ["dbUserId", "dbUserName", "host", "authorityType", "dbUserStatus"]) &&
    hasOptionalStrings(value, ["authenticationPlugin", "tlsOption"])
  );
}

function isRdsMysqlResourceRelation(value: unknown): value is RdsMysqlResourceRelation {
  return isRecord(value) && hasOptionalStrings(value, ["resourceType", "resourceId"]);
}

export function isRdsMysqlJob(value: unknown): value is RdsMysqlJob {
  if (!isRecord(value)) return false;
  const relations = value["resourceRelations"];
  return (
    hasStrings(value, ["jobId", "jobStatus"]) &&
    hasOptionalStrings(value, ["createdYmdt", "updatedYmdt"]) &&
    (relations === undefined ||
      relations === null ||
      (Array.isArray(relations) && relations.every(isRdsMysqlResourceRelation)))
  );
}
