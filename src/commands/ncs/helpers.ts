import { readFileSync, statSync } from "node:fs";
import { resolveProfileName, getUserAccessKey, requireRealEnvironment } from "../../config/credentials.js";
import { getAccessToken } from "../../api/oauth.js";
import { NcsClient } from "../../services/ncs/client.js";
import { resolveServiceAppKey } from "../service-appkey.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { MAX_JSON_INPUT_BYTES } from "../../utils/limits.js";
const NCS_RFC3339_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/;
const NCS_RELATIVE_TIME_PATTERN = /^(\d+)(m|h|d)$/;
const NCS_TIME_EXAMPLES =
  "시간대 포함 RFC3339(예: 2026-05-01T00:00:00+09:00) 또는 상대시간(예: 30m, 1h, 2d, now)";

function ncsTimeError(option: "--from" | "--to", value: string, detail?: string): NhnCloudCliError {
  const suffix = detail ? ` ${detail}` : "";
  return new NhnCloudCliError(
    `${option} 시간 형식 오류: ${JSON.stringify(value)}. ${NCS_TIME_EXAMPLES}을 사용하세요.${suffix}`,
    EXIT_PARAM_ERROR,
  );
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function formatNcsUtcTime(
  timestamp: number,
  option: "--from" | "--to",
  input: string,
): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(timestamp) || Number.isNaN(date.getTime())) {
    throw ncsTimeError(option, input, "유효한 Date 범위를 벗어났습니다.");
  }

  const iso = date.toISOString();
  const secondPrecision = iso.replace(/\.\d{3}Z$/, "Z");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(secondPrecision)) {
    throw ncsTimeError(option, input, "UTC 연도가 지원 범위를 벗어났습니다.");
  }
  return secondPrecision;
}

function parseNcsAbsoluteTime(
  input: string,
  option: "--from" | "--to",
): { value: string; timestamp: number } {
  const match = NCS_RFC3339_PATTERN.exec(input);
  if (!match) throw ncsTimeError(option, input);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[10] === undefined ? 0 : Number(match[10]);
  const offsetMinute = match[11] === undefined ? 0 : Number(match[11]);

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    throw ncsTimeError(option, input, "날짜·시각·시간대 오프셋을 확인하세요.");
  }

  const parsedTimestamp = Date.parse(input);
  const timestamp = Math.floor(parsedTimestamp / 1000) * 1000;
  return {
    value: formatNcsUtcTime(timestamp, option, input),
    timestamp,
  };
}

function parseNcsTime(
  input: string,
  option: "--from" | "--to",
  baseTimestamp: number,
): { value: string; timestamp: number } {
  const trimmed = input.trim();
  if (trimmed === "now") {
    return {
      value: formatNcsUtcTime(baseTimestamp, option, input),
      timestamp: Math.floor(baseTimestamp / 1000) * 1000,
    };
  }

  const relativeMatch = NCS_RELATIVE_TIME_PATTERN.exec(trimmed);
  if (relativeMatch) {
    const amount = Number(relativeMatch[1]);
    const unitMs = relativeMatch[2] === "m"
      ? 60_000
      : relativeMatch[2] === "h"
        ? 3_600_000
        : 86_400_000;
    const deltaMs = amount * unitMs;
    if (!Number.isSafeInteger(amount) || !Number.isSafeInteger(deltaMs)) {
      throw ncsTimeError(option, input, "상대시간이 안전한 정수 범위를 벗어났습니다.");
    }
    const timestamp = baseTimestamp - deltaMs;
    return {
      value: formatNcsUtcTime(timestamp, option, input),
      timestamp: Math.floor(timestamp / 1000) * 1000,
    };
  }

  return parseNcsAbsoluteTime(trimmed, option);
}

/**
 * NCS workload logs·events 시간 필터를 API가 수용하는 UTC 초 단위 `Z` 문자열로 정규화한다.
 * 두 상대시간은 호출마다 한 번 캡처한 같은 기준 시각을 사용한다(ADR-023).
 */
export function normalizeNcsTimeRange(
  from?: string,
  to?: string,
  now?: Date,
): { from?: string; to?: string } {
  if (from === undefined && to === undefined) return {};

  const baseTimestamp = (now ?? new Date()).getTime();
  if (!Number.isFinite(baseTimestamp)) {
    throw new NhnCloudCliError(
      `NCS 시간 정규화 기준 시각이 유효하지 않습니다. ${NCS_TIME_EXAMPLES}을 사용하세요.`,
      EXIT_PARAM_ERROR,
    );
  }

  const normalizedFrom = from === undefined
    ? undefined
    : parseNcsTime(from, "--from", baseTimestamp);
  const normalizedTo = to === undefined
    ? undefined
    : parseNcsTime(to, "--to", baseTimestamp);

  if (
    normalizedFrom !== undefined &&
    normalizedTo !== undefined &&
    normalizedFrom.timestamp > normalizedTo.timestamp
  ) {
    throw new NhnCloudCliError(
      `--from 시간이 --to 시간보다 늦습니다. ${NCS_TIME_EXAMPLES}을 사용하세요.`,
      EXIT_PARAM_ERROR,
    );
  }

  return {
    ...(normalizedFrom === undefined ? {} : { from: normalizedFrom.value }),
    ...(normalizedTo === undefined ? {} : { to: normalizedTo.value }),
  };
}

/**
 * NCS appKey 를 해석한다.
 * 없으면 EXIT_CONFIG_ERROR + 설정 안내(2-4 회피 — 빈문자열 fallback 금지).
 *
 * 안내 문구 주의: `configure` 마법사(대화형 ncs 블록 또는 `--ncs-appkey` 비대화형 플래그)로
 * ncs.appkey 를 설정할 수 있다(src/commands/configure.ts).
 */
export async function resolveNcsAppKey(profileName: string): Promise<string> {
  return resolveServiceAppKey(
    "ncs",
    profileName,
      "NCS appKey 가 없습니다. nhncloud configure --ncs-appkey <key> 를 실행해 설정하세요.",
  );
}

/**
 * profile 해석 → 공통 UAK 로드 → Deploy OAuth 토큰(profile 캐시 재사용) 발급 → appKey 해석 → NcsClient 생성.
 * spinner 시작 *전* (파라미터 검증·자격증명 로드 단계) 에 호출한다.
 */
export async function resolveNcsClient(opts: {
  profile?: string;
  region?: string;
}): Promise<{ client: NcsClient; profileName: string }> {
  const profileName = await resolveProfileName(opts.profile);
  await requireRealEnvironment(profileName, "NCS");
  const uak = await getUserAccessKey(profileName);
  const accessToken = await getAccessToken(profileName, uak.id, uak.secret);
  const appKey = await resolveNcsAppKey(profileName);
  const region = opts.region ?? "kr1";
  return { client: new NcsClient(accessToken, region, appKey), profileName };
}

/**
 * `--file <json>` 로 지정된 경로를 읽어 JSON 으로 파싱한다 (ADR-019 NKS 선례 — 복잡한 생성 입력은 파일 기반).
 * 순수 함수 — stdout/stderr 출력이나 confirm 로직을 섞지 않는다(io-throw-bundled-untestable 회피).
 * 읽기 전에 statSync 로 errno·파일유형·크기를 차단한다 (deploy/upload.ts 선례,
 * pitfall file-input-no-stat-guard — PR#8 지적 재발 방지). 파일 읽기 실패·디렉터리·크기초과·
 * JSON.parse 실패 모두 EXIT_PARAM_ERROR 로 통일한다.
 */
export function readJsonPayload(filePath: string): unknown {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(filePath);
  } catch (err) {
    const reason =
      (err as NodeJS.ErrnoException).code ?? (err instanceof Error ? err.message : String(err));
    throw new NhnCloudCliError(
      `파일을 읽을 수 없습니다: ${filePath} (${reason})`,
      EXIT_PARAM_ERROR,
    );
  }
  if (!stat.isFile()) {
    throw new NhnCloudCliError(`--file 이 일반 파일이 아닙니다: ${filePath}`, EXIT_PARAM_ERROR);
  }
  if (stat.size > MAX_JSON_INPUT_BYTES) {
    throw new NhnCloudCliError(
      `--file 이 너무 큽니다 (${stat.size} 바이트). JSON spec 한도 ${MAX_JSON_INPUT_BYTES} 바이트.`,
      EXIT_PARAM_ERROR,
    );
  }

  const raw = readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new NhnCloudCliError(
      `JSON 파싱에 실패했습니다: ${filePath} (${detail})`,
      EXIT_PARAM_ERROR,
    );
  }
}

/**
 * id/historyId 등 인수 공통 검증 — 빈값/공백 거절(1-3 회피: spinner 시작 전 검증).
 * template.ts·workload.ts·malware.ts 가 공유하는 공용 함수라 helpers.ts 로 둔다
 * (code-review LOW dedup — workload.ts·malware.ts 동일 함수 중복 정의 해소).
 */
export function requireNonEmpty(value: string, label: string): void {
  if (!value.trim()) {
    throw new NhnCloudCliError(`${label} 인수가 비어있습니다.`, EXIT_PARAM_ERROR);
  }
}

/**
 * 비대화형에서는 --yes 필수, TTY 에서는 @inquirer/prompts confirm 으로 확인한다
 * (floatingip delete 패턴 재사용). template.ts·workload.ts 양쪽의 delete 커맨드가 공유하는
 * 공용 함수라 helpers.ts 로 둔다(code-review FIX — template.ts 전용 export 비대칭 해소).
 */
export async function confirmDestructive(
  message: string,
  yes: boolean | undefined,
): Promise<boolean> {
  const isTTY = process.stdin.isTTY;

  if (!isTTY && !yes) {
    throw new NhnCloudCliError(
      "비대화형 환경에서는 --yes 플래그가 필요합니다.",
      EXIT_PARAM_ERROR,
    );
  }

  if (isTTY && !yes) {
    const { confirm } = await import("@inquirer/prompts");
    return confirm({ message, default: false });
  }

  return true;
}
