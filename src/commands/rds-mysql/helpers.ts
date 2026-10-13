import type { Command } from "commander";
import { getProfileEnvironment, getUserAccessKey, resolveProfileName } from "../../config/credentials.js";
import type { OutputOptions } from "../../formatters/table.js";
import { RdsMysqlClient } from "../../services/rds-mysql/client.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { startSpinner, stopSpinner } from "../../utils/spinner.js";
import { sanitizeForTerminal } from "../../utils/terminal.js";
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
 * ID 인자는 UUID 만 받는다. 이름 해석은 하지 않는다 (ADR-046).
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
