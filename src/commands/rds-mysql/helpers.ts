import type { Command } from "commander";
import { getProfileEnvironment, getUserAccessKey, resolveProfileName } from "../../config/credentials.js";
import { type OutputOptions, output } from "../../formatters/table.js";
import { RdsMysqlClient, type RdsMysqlJobWaitResult } from "../../services/rds-mysql/client.js";
import { RdsMysqlApiError } from "../../services/rds-mysql/errors.js";
import type {
  RdsMysqlAuthorityType,
  RdsMysqlAuthPlugin,
  RdsMysqlDbInstanceDetail,
  RdsMysqlTlsOption,
} from "../../services/rds-mysql/types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR, EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { startSpinner, stopSpinner } from "../../utils/spinner.js";
import { sanitizeForTerminal } from "../../utils/terminal.js";
import { decodeUtf8Input, readInputSource, type StdinSource } from "../input-source.js";
import { parseIntegerOption } from "../parse-options.js";
import { resolveServiceAppKey } from "../service-appkey.js";

export interface RdsMysqlCommandOptions extends OutputOptions {
  profile?: string;
  region?: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 모든 rds-mysql 명령에 --region, --profile 을 붙인다. */
export function withRdsMysqlOptions(command: Command): Command {
  return command
    .option("--region <region>", "RDS for MySQL region (kr1|kr2|jp1, 공공망은 kr1)", "kr1")
    .option("--profile <name>", "사용할 profile 이름");
}

/**
 * ID 인자는 UUID 만 받는다. 이름 해석은 하지 않는다 (docs/flow.md 「RDS for MySQL」).
 * 앞뒤 공백을 지우지 않고 그대로 거른다.
 */
export function parseUuidArgument(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new NhnCloudCliError(
      `${label}는 UUID 형식이어야 합니다 (입력: ${JSON.stringify(value)}).`,
      EXIT_PARAM_ERROR,
    );
  }
  return value;
}

/**
 * profile → rds-mysql appkey → 공통 UAK → environment → RdsMysqlClient.
 * 요청마다 정적 헤더로 인증하므로 토큰 발급 단계가 없다 (ADR-046).
 */
export async function resolveRdsMysqlClient(opts: {
  profile?: string;
  region?: string;
}): Promise<{ client: RdsMysqlClient; profileName: string }> {
  const profileName = await resolveProfileName(opts.profile);
  const appKey = await resolveServiceAppKey(
    "rds-mysql",
    profileName,
    "RDS for MySQL appkey가 없습니다. nhncloud configure --rds-mysql-appkey <key>로 설정하세요.",
  );
  const uak = await getUserAccessKey(profileName);
  const environment = await getProfileEnvironment(profileName);
  return { client: new RdsMysqlClient(appKey, uak.id, uak.secret, opts.region ?? "kr1", environment), profileName };
}

function stringifyValue(value: unknown): string {
  // instance get 은 응답 키를 그대로 옮기므로, 중첩 필드가 [object Object] 로 찍히지 않게 JSON 으로 쓴다.
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

/** null·undefined 는 `-`, 배열은 쉼표로 잇고, 객체는 JSON 으로 쓴다. 터미널 제어 문자는 치환한다. */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "-";
  const text = Array.isArray(value) ? value.map(stringifyValue).join(",") : stringifyValue(value);
  return sanitizeForTerminal(text);
}

/** spinner 를 켜고 RDS for MySQL 호출 하나를 기다린다. 실패하면 spinner 를 실패로 끝내고 오류를 그대로 던진다. */
export async function withRdsMysqlSpinner<T>(text: string, call: () => Promise<T>): Promise<T> {
  startSpinner(text);
  let result: T;
  try {
    result = await call();
  } catch (err) {
    stopSpinner(false);
    throw err;
  }
  stopSpinner(true);
  return result;
}

export interface RdsMysqlWriteOptions extends RdsMysqlCommandOptions {
  yes?: boolean;
  wait?: boolean;
  timeout?: string;
}

/** 쓰기 명령에 --region, --profile 과 --yes, --wait, --timeout 을 붙인다 (ADR-047). */
export function withRdsMysqlWriteOptions(command: Command): Command {
  return withRdsMysqlOptions(command)
    .option("--yes", "요청을 보낸다. 없으면 미리보기만 한다")
    .option("--wait", "작업이 끝날 때까지 기다린다")
    .option("--timeout <sec>", "--wait 대기 상한 (초, 기본 300)");
}

const DEFAULT_WAIT_TIMEOUT_SEC = 300;

/** --timeout 은 --wait 와 함께만 받는다. 요청 전에 파싱 단계에서 부른다. */
export function parseWaitOptions(opts: { wait?: boolean; timeout?: string }): { wait: boolean; timeoutMs: number } {
  const wait = opts.wait === true;
  if (opts.timeout !== undefined && !wait) {
    throw new NhnCloudCliError("--timeout은 --wait와 함께 씁니다.", EXIT_PARAM_ERROR);
  }
  const timeoutSec =
    opts.timeout === undefined
      ? DEFAULT_WAIT_TIMEOUT_SEC
      : parseIntegerOption(opts.timeout, "--timeout", { min: 1, max: 3600 });
  return { wait, timeoutMs: timeoutSec * 1000 };
}

/** 쓰기 명령의 출력 객체다. 비밀번호 필드는 두지 않는다 (ADR-047). */
export interface RdsMysqlWriteResult {
  operation: "schema-create" | "user-create" | "user-update" | "user-delete";
  dbInstanceId: string;
  target: string;
  dbUserId: string | null;
  authorityType: string | null;
  previousAuthorityType: string | null;
  authenticationPlugin: string | null;
  tlsOption: string | null;
  action: "create" | "update" | "delete" | "unchanged";
  applied: boolean;
  jobId: string | null;
  jobStatus: string | null;
}

type RdsMysqlWriteResultFields = Pick<RdsMysqlWriteResult, "operation" | "dbInstanceId" | "target" | "action"> &
  Partial<
    Pick<
      RdsMysqlWriteResult,
      "dbUserId" | "authorityType" | "previousAuthorityType" | "authenticationPlugin" | "tlsOption"
    >
  >;

/** 요청 전 결과 객체를 만든다. 주지 않은 필드는 null, applied 는 false 다. 키 순서가 곧 table 출력 순서다. */
export function rdsMysqlWriteResult(fields: RdsMysqlWriteResultFields): RdsMysqlWriteResult {
  return {
    operation: fields.operation,
    dbInstanceId: fields.dbInstanceId,
    target: fields.target,
    dbUserId: fields.dbUserId ?? null,
    authorityType: fields.authorityType ?? null,
    previousAuthorityType: fields.previousAuthorityType ?? null,
    authenticationPlugin: fields.authenticationPlugin ?? null,
    tlsOption: fields.tlsOption ?? null,
    action: fields.action,
    applied: false,
    jobId: null,
    jobStatus: null,
  };
}

/** --json 은 객체 그대로, --quiet 은 jobId 가 있을 때만 그 한 줄, table 은 키 순서대로 field/value 다. */
export function outputRdsMysqlWriteResult(opts: OutputOptions, result: RdsMysqlWriteResult): void {
  output(opts, {
    headers: ["field", "value"],
    rows: Object.entries(result).map(([key, value]) => [key, formatCell(value)]),
    raw: result,
    ids: result.jobId === null ? [] : [result.jobId],
  });
}

/**
 * 쓰기 전에 DB 인스턴스를 조회한다. 미리보기와 반영에서 똑같이 돈다 (ADR-047).
 * 인증 플러그인이나 TLS 를 지정했는데 인스턴스가 지원하지 않으면 요청 전에 막는다.
 */
export async function checkInstanceForWrite(
  client: RdsMysqlClient,
  dbInstanceId: string,
  needsAuthPlugin: boolean,
): Promise<RdsMysqlDbInstanceDetail> {
  const instance = await withRdsMysqlSpinner(`DB 인스턴스 조회 중 (${dbInstanceId})...`, () =>
    client.getDbInstance(dbInstanceId),
  );
  if (needsAuthPlugin && instance.supportAuthenticationPlugin === false) {
    throw new NhnCloudCliError(
      "이 DB 인스턴스는 인증 플러그인과 TLS 옵션을 지원하지 않습니다 (MySQL 5.7.33 이상). --auth-plugin과 --tls를 빼고 다시 실행하세요.",
      EXIT_PARAM_ERROR,
    );
  }
  const progressStatus = instance.progressStatus;
  if (typeof progressStatus === "string" && progressStatus !== "NONE") {
    process.stderr.write(
      `경고: DB 인스턴스에서 다른 작업이 진행 중입니다 (progressStatus=${sanitizeForTerminal(progressStatus)}). 요청이 거절되거나 늦게 반영될 수 있습니다.\n`,
    );
  }
  return instance;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 미리보기, 요청, 작업 대기를 한 흐름으로 처리한다 (ADR-047).
 * 서버가 봉투로 알린 실패(RdsMysqlApiError)와 결과를 모르는 실패를 다른 문구로 안내한다.
 * HTTP 5xx 는 본문이 봉투여도 게이트웨이나 서버 내부 오류일 수 있어 결과를 모르는 실패로 본다.
 * wait 는 명령이 파싱 단계에서 parseWaitOptions 로 얻은 값이다.
 */
export async function applyRdsMysqlWrite(
  opts: RdsMysqlWriteOptions,
  wait: { wait: boolean; timeoutMs: number },
  client: RdsMysqlClient,
  result: RdsMysqlWriteResult,
  request: () => Promise<string>,
  listHint: string,
): Promise<void> {
  if (!opts.yes) {
    outputRdsMysqlWriteResult(opts, result);
    process.stderr.write("미리보기입니다. 요청하지 않았습니다. 반영하려면 --yes를 붙입니다.\n");
    return;
  }

  let jobId: string;
  try {
    jobId = await withRdsMysqlSpinner(`RDS for MySQL ${result.operation} 요청 중 (${result.dbInstanceId})...`, request);
  } catch (err) {
    const knownOutcome =
      err instanceof RdsMysqlApiError && !(err.httpStatus !== undefined && err.httpStatus >= 500);
    if (!knownOutcome) {
      process.stderr.write(
        `주의: 요청이 접수됐는지 알 수 없습니다. 다시 실행하기 전에 ${listHint}로 반영 여부를 확인하세요.\n`,
      );
    }
    throw err;
  }

  result.applied = true;
  result.jobId = jobId;
  const safeJobId = sanitizeForTerminal(jobId);

  if (!wait.wait) {
    outputRdsMysqlWriteResult(opts, result);
    process.stderr.write(`안내: 작업을 요청했습니다. 결과는 nhncloud rds-mysql job get ${safeJobId}로 확인합니다.\n`);
    return;
  }

  let waited: RdsMysqlJobWaitResult;
  try {
    waited = await withRdsMysqlSpinner(`작업 대기 중 (jobId=${safeJobId})...`, () =>
      client.waitForJob(jobId, { timeoutMs: wait.timeoutMs }),
    );
  } catch (err) {
    outputRdsMysqlWriteResult(opts, result);
    throw new NhnCloudCliError(
      `작업 상태를 확인하지 못했습니다 (jobId=${safeJobId}): ${errorMessage(err)}. 다시 실행하지 말고 nhncloud rds-mysql job get ${safeJobId}와 ${listHint}로 확인하세요.`,
      EXIT_API_ERROR,
    );
  }

  const jobStatus = waited.job?.jobStatus ?? null;
  result.jobStatus = jobStatus;
  // 오류 문구는 jobId 와 같은 규칙으로 정제한다. 결과 객체에는 서버 값을 그대로 둔다.
  const safeJobStatus = jobStatus === null ? null : sanitizeForTerminal(jobStatus);
  outputRdsMysqlWriteResult(opts, result);

  switch (waited.outcome) {
    case "completed":
      return;
    case "failed":
      throw new NhnCloudCliError(
        `RDS for MySQL 작업이 실패했습니다 (jobId=${safeJobId}, jobStatus=${safeJobStatus}). 원인을 확인해 고친 뒤 다시 실행하세요.`,
        EXIT_API_ERROR,
      );
    case "uncertain":
      throw new NhnCloudCliError(
        `RDS for MySQL 작업 결과를 확정하지 못했습니다 (jobId=${safeJobId}, jobStatus=${safeJobStatus}). 다시 실행하지 말고 nhncloud rds-mysql job get ${safeJobId}와 ${listHint}로 확인하세요.`,
        EXIT_API_ERROR,
      );
    case "timeout":
      throw new NhnCloudCliError(
        `RDS for MySQL 작업이 대기 상한(${wait.timeoutMs / 1000}초) 안에 끝나지 않았습니다 (jobId=${safeJobId}, 마지막 jobStatus=${safeJobStatus ?? "없음"}). 작업은 계속 진행될 수 있습니다. 다시 실행하지 말고 nhncloud rds-mysql job get ${safeJobId}로 확인하세요.`,
        EXIT_API_ERROR,
      );
  }
}

function paramError(message: string, value: string): NhnCloudCliError {
  return new NhnCloudCliError(`${message} (입력: ${JSON.stringify(value)}).`, EXIT_PARAM_ERROR);
}

const AUTHORITY_TYPES: Readonly<Record<string, RdsMysqlAuthorityType>> = {
  read: "READ",
  crud: "CRUD",
  ddl: "DDL",
  all: "ALL",
};

/** 권한은 read, crud, ddl, all 만 받는다. CUSTOM 은 받지 않는다 (ADR-047). */
export function parseAuthorityOption(value: string): RdsMysqlAuthorityType {
  const key = value.toLowerCase();
  const authority = Object.hasOwn(AUTHORITY_TYPES, key) ? AUTHORITY_TYPES[key] : undefined;
  if (authority === undefined) throw paramError("--authority는 read, crud, ddl, all 중 하나여야 합니다", value);
  return authority;
}

const AUTH_PLUGINS: Readonly<Record<string, RdsMysqlAuthPlugin>> = {
  native: "NATIVE",
  "caching-sha2": "CACHING_SHA2",
  sha256: "SHA256",
};

export function parseAuthPluginOption(value: string | undefined): RdsMysqlAuthPlugin | undefined {
  if (value === undefined) return undefined;
  const plugin = Object.hasOwn(AUTH_PLUGINS, value) ? AUTH_PLUGINS[value] : undefined;
  if (plugin === undefined) throw paramError("--auth-plugin은 native, caching-sha2, sha256 중 하나여야 합니다", value);
  return plugin;
}

const TLS_OPTIONS: Readonly<Record<string, RdsMysqlTlsOption>> = { none: "NONE", ssl: "SSL", x509: "X509" };

export function parseTlsOption(value: string | undefined): RdsMysqlTlsOption | undefined {
  if (value === undefined) return undefined;
  const tls = Object.hasOwn(TLS_OPTIONS, value) ? TLS_OPTIONS[value] : undefined;
  if (tls === undefined) throw paramError("--tls는 none, ssl, x509 중 하나여야 합니다", value);
  return tls;
}

const SCHEMA_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const RESERVED_SCHEMA_NAMES: ReadonlySet<string> = new Set([
  "information_schema",
  "performance_schema",
  "db_helper",
  "sys",
  "mysql",
  "rds_maintenance",
]);

export function parseSchemaName(value: string): string {
  if (!SCHEMA_NAME_PATTERN.test(value)) {
    throw paramError("--name은 영문으로 시작하고 영문, 숫자, _ 로 된 64자 이하여야 합니다", value);
  }
  if (RESERVED_SCHEMA_NAMES.has(value.toLowerCase())) {
    throw paramError(`${value}은 DB 스키마 이름으로 쓸 수 없습니다`, value);
  }
  return value;
}

const CONTROL_CHAR_PATTERN = /[\x00-\x1F\x7F]/;
const RESERVED_DB_USER_NAMES: ReadonlySet<string> = new Set([
  "mysql.session",
  "mysql.sys",
  "mysql.infoschema",
  "sqlgw",
  "admin",
  "etladm",
  "alertman",
  "prom",
  "rds_admin",
  "rds_mha",
  "rds_repl",
]);

export function parseDbUserName(value: string): string {
  const length = [...value].length;
  if (length < 1 || length > 32 || CONTROL_CHAR_PATTERN.test(value)) {
    throw paramError("--name은 1자 이상 32자 이하여야 합니다", value);
  }
  if (RESERVED_DB_USER_NAMES.has(value)) {
    throw paramError(`${value}은 DB 사용자 이름으로 쓸 수 없습니다`, value);
  }
  return value;
}

const HOST_INVALID_CHAR_PATTERN = /[\s\x00-\x1F\x7F]/;

export function parseDbUserHost(value: string): string {
  const length = [...value].length;
  if (length < 1 || length > 45 || HOST_INVALID_CHAR_PATTERN.test(value)) {
    throw paramError("--host는 공백 없는 45자 이하 값이어야 합니다 (예: 10.0.0.%)", value);
  }
  return value;
}

const PASSWORD_LABEL = "DB 사용자 비밀번호";

/**
 * 비밀번호는 --password-file 이나 표준 입력으로만 받는다 (ADR-047).
 * 끝 줄바꿈 하나만 지우고, 오류 문구에 값을 넣지 않는다.
 * 앞쪽 BOM 은 편집기가 붙인 것일 가능성이 커서, 비밀번호에 섞어 보내지 않고 거부한다.
 */
export function readDbUserPassword(file: string | undefined, stdin?: StdinSource): string {
  const input = readInputSource({ file }, { fileFlag: "--password-file", label: PASSWORD_LABEL, maxBytes: 1024 }, stdin);
  const password = decodeUtf8Input(input, PASSWORD_LABEL, "파일 인코딩을 확인하세요.").replace(/\r?\n$/, "");
  if (password.startsWith("\uFEFF")) {
    throw new NhnCloudCliError(
      "DB 사용자 비밀번호 앞에 BOM(U+FEFF)이 있습니다. BOM 없는 UTF-8로 저장해 다시 실행하세요.",
      EXIT_PARAM_ERROR,
    );
  }
  const length = [...password].length;
  if (length < 4 || length > 256) {
    throw new NhnCloudCliError("DB 사용자 비밀번호는 4자 이상 256자 이하여야 합니다.", EXIT_PARAM_ERROR);
  }
  return password;
}
