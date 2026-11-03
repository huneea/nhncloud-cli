import { isIPv4 } from "node:net";
import type { Command } from "commander";
import { getProfileEnvironment, resolveProfileName } from "../../config/credentials.js";
import { type OutputOptions } from "../../formatters/table.js";
import { DnsplusClient } from "../../services/dnsplus/client.js";
import type {
  DnsplusRecord,
  DnsplusRecordset,
  DnsplusRecordsetType,
  DnsplusZone,
} from "../../services/dnsplus/types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { startSpinner, stopSpinner } from "../../utils/spinner.js";
import { sanitizeForTerminal } from "../../utils/terminal.js";
import { parseRequiredArgument } from "../parse-options.js";
import { resolveServiceAppKey } from "../service-appkey.js";

export interface DnsplusCommandOptions extends OutputOptions {
  profile?: string;
}

export interface DnsplusWriteOptions extends DnsplusCommandOptions {
  yes?: boolean;
  dryRun?: boolean;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SUPPORTED_RECORDSET_TYPES: readonly DnsplusRecordsetType[] = ["A", "CNAME", "TXT"];

export const MIN_TTL = 10;
export const MAX_TTL = 2147483647;
export const DEFAULT_TTL = 300;

export function withDnsplusOptions(command: Command): Command {
  return command.option("--profile <name>", "사용할 profile 이름");
}

export function withDnsplusWriteOptions(command: Command): Command {
  return withDnsplusOptions(command)
    .option("--yes", "확인 없이 쓰기를 실행한다")
    .option("--dry-run", "쓰기 없이 보낼 요청을 출력한다");
}

/** `--dry-run` 이면 true, 아니면 `--yes` 를 API 호출 전에 요구한다 (ADR-048 과 같은 규칙). */
export function requireWriteMode(opts: DnsplusWriteOptions, operation: string): boolean {
  if (opts.dryRun) return true;
  if (!opts.yes) {
    throw new NhnCloudCliError(
      `${operation}에는 --yes 플래그가 필요합니다. 보낼 요청만 보려면 --dry-run 을 쓰세요.`,
      EXIT_PARAM_ERROR,
    );
  }
  return false;
}

/** profile → dnsplus appkey → environment → DnsplusClient. 인증 헤더나 토큰 교환이 없다 (ADR-049). */
export async function resolveDnsplusClient(opts: { profile?: string }): Promise<DnsplusClient> {
  const profileName = await resolveProfileName(opts.profile);
  const appKey = await resolveServiceAppKey(
    "dnsplus",
    profileName,
    "DNS Plus appkey가 없습니다. nhncloud configure --dnsplus-appkey <key>로 설정하세요.",
  );
  const environment = await getProfileEnvironment(profileName);
  return new DnsplusClient(appKey, environment);
}

export async function withDnsplusSpinner<T>(text: string, run: () => Promise<T>): Promise<T> {
  startSpinner(text);
  try {
    const result = await run();
    stopSpinner(true);
    return result;
  } catch (error) {
    stopSpinner(false);
    throw error;
  }
}

/** 터미널 제어 문자를 치환한다. 비어 있으면 `-` 다. */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  return sanitizeForTerminal(String(value));
}

export function formatRecords(records: DnsplusRecord[]): string {
  return records
    .map((record) => (record.recordDisabled ? `${record.recordContent} (disabled)` : record.recordContent))
    .join("\n");
}

/** 이름을 FQDN(끝 점 포함, 소문자)으로 맞춘다. DNS 이름은 대소문자를 구분하지 않는다. */
export function toFqdn(name: string): string {
  const lowered = name.trim().toLowerCase();
  return lowered.endsWith(".") ? lowered : `${lowered}.`;
}

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** `--zone` 값을 존 ID 나 이름으로 읽어 zone 하나로 해석한다. 이름이 정확히 같은 존만 받는다. */
export async function resolveZone(client: DnsplusClient, zoneInput: string): Promise<DnsplusZone> {
  const input = parseRequiredArgument(zoneInput, "--zone");
  if (isUuid(input)) {
    const zones = await withDnsplusSpinner("DNS Zone 조회 중...", () => client.listZones({ zoneIdList: [input] }));
    const zone = zones.find((candidate) => candidate.zoneId === input);
    if (!zone) throw new NhnCloudCliError(`DNS Zone 을 찾을 수 없습니다: ${input}`, EXIT_PARAM_ERROR);
    return zone;
  }
  const fqdn = toFqdn(input);
  const zones = await withDnsplusSpinner("DNS Zone 조회 중...", () => client.listZones({ searchZoneName: fqdn }));
  const matches = zones.filter((candidate) => candidate.zoneName.toLowerCase() === fqdn);
  if (matches.length === 0) {
    throw new NhnCloudCliError(
      `DNS Zone 을 찾을 수 없습니다: ${fqdn}. nhncloud dnsplus zone list 로 이름을 확인하세요.`,
      EXIT_PARAM_ERROR,
    );
  }
  if (matches.length > 1) {
    throw new NhnCloudCliError(
      `이름이 같은 DNS Zone 이 여럿입니다: ${fqdn}. 존 ID 로 지정하세요.`,
      EXIT_PARAM_ERROR,
    );
  }
  return matches[0] as DnsplusZone;
}

export function parseRecordsetType(value: string): DnsplusRecordsetType {
  const upper = value.trim().toUpperCase();
  const matched = SUPPORTED_RECORDSET_TYPES.find((type) => type === upper);
  if (!matched) {
    throw new NhnCloudCliError(
      `--type 은 ${SUPPORTED_RECORDSET_TYPES.join(", ")} 중 하나여야 합니다: ${JSON.stringify(value)}`,
      EXIT_PARAM_ERROR,
    );
  }
  return matched;
}

/** 레코드 세트 이름이 존 안에 있는지 검사하고 FQDN 으로 돌려준다. */
export function parseRecordsetName(name: string, zoneName: string): string {
  const fqdn = toFqdn(parseRequiredArgument(name, "--name"));
  const zone = zoneName.toLowerCase();
  if (fqdn !== zone && !fqdn.endsWith(`.${zone}`)) {
    throw new NhnCloudCliError(
      `--name 은 존 ${zoneName} 안의 이름이어야 합니다: ${JSON.stringify(name)}`,
      EXIT_PARAM_ERROR,
    );
  }
  return fqdn;
}

/**
 * 타입별 `--value` 를 API 의 recordContent 로 바꾼다.
 * A 는 IPv4 만, CNAME 은 값 하나를 끝 점이 있는 FQDN 으로, TXT 는 따옴표로 감싼 문자열로 보낸다.
 */
export function buildRecordList(type: DnsplusRecordsetType, values: string[]): DnsplusRecord[] {
  if (values.length === 0) {
    throw new NhnCloudCliError("--value 가 하나 이상 필요합니다.", EXIT_PARAM_ERROR);
  }
  const contents = values.map((value) => {
    const trimmed = parseRequiredArgument(value, "--value");
    if (type === "A") {
      if (!isIPv4(trimmed)) {
        throw new NhnCloudCliError(`A 레코드 값은 IPv4 주소여야 합니다: ${JSON.stringify(value)}`, EXIT_PARAM_ERROR);
      }
      return trimmed;
    }
    if (type === "CNAME") return toFqdn(trimmed);
    const unquoted = trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1) : trimmed;
    return `"${unquoted.replace(/(?<!\\)"/g, '\\"')}"`;
  });
  if (type === "CNAME" && contents.length !== 1) {
    throw new NhnCloudCliError("CNAME 레코드 값은 하나만 줄 수 있습니다.", EXIT_PARAM_ERROR);
  }
  return contents.map((recordContent) => ({ recordDisabled: false, recordContent }));
}

export function recordsetRow(recordset: DnsplusRecordset): string[] {
  return [
    formatCell(recordset.recordsetId),
    formatCell(recordset.recordsetName),
    formatCell(recordset.recordsetType),
    formatCell(recordset.recordsetTtl),
    formatCell(recordset.recordsetStatus),
    formatCell(formatRecords(recordset.recordList)),
  ];
}

export const RECORDSET_HEADERS = ["recordsetId", "recordsetName", "type", "ttl", "status", "records"];
