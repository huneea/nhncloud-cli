import { isIP } from "node:net";
import type { Command } from "commander";
import { getAccessToken } from "../../api/oauth.js";
import { getProfileEnvironment, getUserAccessKey, resolveProfileName } from "../../config/credentials.js";
import { output, printJson, type OutputOptions } from "../../formatters/table.js";
import { SkmClient } from "../../services/skm/client.js";
import type {
  SkmAuthDetail,
  SkmAuthMode,
  SkmAuthType,
  SkmKeyStatusFilter,
  SkmKeyStoreInput,
  SkmKeyType,
} from "../../services/skm/types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { startSpinner, stopSpinner } from "../../utils/spinner.js";
import { sanitizeForTerminal, sanitizeMultilineForTerminal } from "../../utils/terminal.js";
import { parseNonNegativeIntegerOption, parseRequiredArgument } from "../parse-options.js";
import { resolveServiceAppKey } from "../service-appkey.js";

export interface SkmCommandOptions extends OutputOptions {
  profile?: string;
  macAddress?: string;
}

const MAC_ADDRESS_PATTERN = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;
const KEY_NAME_MAX_LENGTH = 100;
const KEY_TYPES: Record<string, SkmKeyType> = {
  secret: "SECRET",
  "symmetric-key": "SYMMETRIC_KEY",
  "asymmetric-key": "ASYMMETRIC_KEY",
};
const AUTH_TYPES: readonly SkmAuthType[] = ["ipv4", "mac", "certificate"];

/** 모든 skm 명령에 --profile, --mac-address 를 붙인다. */
export function withSkmOptions(command: Command): Command {
  return command
    .option("--mac-address <mac>", "키 저장소 MAC 인증에 쓸 클라이언트 MAC 주소 (X-TOAST-CLIENT-MAC-ADDR)")
    .option("--profile <name>", "사용할 profile 이름");
}

/** 인증 정보 명령의 --type 필수 옵션을 붙인다. */
export function withTypeOption(command: Command): Command {
  return command.requiredOption("--type <type>", "인증 정보 종류 (ipv4|mac|certificate)");
}

/** 콜론 구분 MAC 주소만 받는다. 하이픈 구분은 서버가 같은 값으로 보는지 문서에 없어 거부한다. */
export function parseMacAddressOption(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (!MAC_ADDRESS_PATTERN.test(value)) {
    throw new NhnCloudCliError(
      `--mac-address는 aa:bb:cc:dd:ee:ff 형식이어야 합니다 (입력: ${JSON.stringify(value)}).`,
      EXIT_PARAM_ERROR,
    );
  }
  return value.toLowerCase();
}

export function parseKeyStoreId(value: string): number {
  return parseNonNegativeIntegerOption(parseRequiredArgument(value, "keystore-id"), "<keystore-id>");
}

export function parseAuthTypeOption(value: string): SkmAuthType {
  const found = AUTH_TYPES.find((type) => type === value);
  if (!found) {
    throw new NhnCloudCliError(
      `--type은 ipv4, mac, certificate 중 하나여야 합니다 (입력: ${JSON.stringify(value)}).`,
      EXIT_PARAM_ERROR,
    );
  }
  return found;
}

/** "ipv4,mac,certificate" 중 하나 이상을 받아 Y/N 세 값으로 바꾼다. */
export function parseAuthListOption(
  value: string,
): Pick<SkmKeyStoreInput, "ip4AuthUse" | "macAuthUse" | "certificateAuthUse"> {
  const items = value.split(",").map((item) => item.trim());
  if (items.some((item) => !AUTH_TYPES.some((type) => type === item))) {
    throw new NhnCloudCliError(
      `--auth는 ipv4, mac, certificate를 쉼표로 나열해야 합니다 (입력: ${JSON.stringify(value)}).`,
      EXIT_PARAM_ERROR,
    );
  }
  const flag = (type: SkmAuthType): "Y" | "N" => (items.includes(type) ? "Y" : "N");
  return { ip4AuthUse: flag("ipv4"), macAuthUse: flag("mac"), certificateAuthUse: flag("certificate") };
}

export function parseAuthModeOption(value: string): SkmAuthMode {
  const upper = value.toUpperCase();
  if (upper !== "AND" && upper !== "OR") {
    throw new NhnCloudCliError(
      `--auth-mode는 and 또는 or여야 합니다 (입력: ${JSON.stringify(value)}).`,
      EXIT_PARAM_ERROR,
    );
  }
  return upper;
}

/** trim 한 설명을 돌려준다. 비면 보내지 않도록 undefined 다. */
export function parseDescriptionOption(value: string | undefined, maxLength: number): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) {
    throw new NhnCloudCliError(`--description은 ${maxLength}자 이하여야 합니다.`, EXIT_PARAM_ERROR);
  }
  return trimmed;
}

/**
 * 인증 정보 값을 검증한다. ipv4 는 IPv4 주소나 CIDR 대역(키 저장소가 대역으로도 등록한다),
 * mac 은 --mac-address 와 같은 콜론 형식을 소문자로, certificate 는 trim 한 이름을 돌려준다.
 */
function isIpv4OrCidr(value: string): boolean {
  const [address, prefix, ...rest] = value.split("/");
  if (rest.length > 0 || address === undefined || isIP(address) !== 4) return false;
  return prefix === undefined || /^(\d|[12]\d|3[0-2])$/.test(prefix);
}

export function parseAuthValue(type: SkmAuthType, value: string): string {
  if (type === "ipv4") {
    if (!isIpv4OrCidr(value)) {
      throw new NhnCloudCliError(
        `IPv4 주소나 CIDR 대역 형식이 아닙니다 (입력: ${JSON.stringify(value)}).`,
        EXIT_PARAM_ERROR,
      );
    }
    return value;
  }
  if (type === "mac") {
    if (!MAC_ADDRESS_PATTERN.test(value)) {
      throw new NhnCloudCliError(
        `MAC 주소는 aa:bb:cc:dd:ee:ff 형식이어야 합니다 (입력: ${JSON.stringify(value)}).`,
        EXIT_PARAM_ERROR,
      );
    }
    return value.toLowerCase();
  }
  const name = value.trim();
  if (!name) {
    throw new NhnCloudCliError("인증서 이름이 비어 있습니다.", EXIT_PARAM_ERROR);
  }
  return name;
}

export function parseKeyTypeOption(value: string | undefined): SkmKeyType | undefined {
  if (value === undefined) return undefined;
  const found = Object.hasOwn(KEY_TYPES, value) ? KEY_TYPES[value] : undefined;
  if (!found) {
    throw new NhnCloudCliError(
      `--type은 secret, symmetric-key, asymmetric-key 중 하나여야 합니다 (입력: ${JSON.stringify(value)}).`,
      EXIT_PARAM_ERROR,
    );
  }
  return found;
}

export function parseKeyStatusOption(value: string | undefined): SkmKeyStatusFilter | undefined {
  if (value === undefined) return undefined;
  if (value !== "active" && value !== "inactive") {
    throw new NhnCloudCliError(
      `--status는 active 또는 inactive여야 합니다 (입력: ${JSON.stringify(value)}).`,
      EXIT_PARAM_ERROR,
    );
  }
  return value;
}

export function parseKeyNameOption(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) {
    throw new NhnCloudCliError("--name은 비어 있을 수 없습니다.", EXIT_PARAM_ERROR);
  }
  if (trimmed.length > KEY_NAME_MAX_LENGTH) {
    throw new NhnCloudCliError(`--name은 ${KEY_NAME_MAX_LENGTH}자 이하여야 합니다.`, EXIT_PARAM_ERROR);
  }
  return trimmed;
}

/**
 * profile → skm appkey → 공통 UAK → environment → OAuth token → SkmClient.
 * appkey 를 토큰 발급보다 먼저 확인해, appkey 가 없으면 네트워크 요청 없이 끝낸다.
 */
export async function resolveSkmClient(opts: {
  profile?: string;
  macAddress?: string;
}): Promise<{ client: SkmClient; profileName: string }> {
  const profileName = await resolveProfileName(opts.profile);
  const appKey = await resolveServiceAppKey(
    "skm",
    profileName,
    "Secure Key Manager appkey가 없습니다. nhncloud configure --skm-appkey <key>로 설정하세요.",
  );
  const uak = await getUserAccessKey(profileName);
  const environment = await getProfileEnvironment(profileName);
  const accessToken = await getAccessToken(profileName, uak.id, uak.secret, false, environment);
  return { client: new SkmClient(accessToken, environment, appKey, opts.macAddress), profileName };
}

/** 인증서 비밀번호는 어떤 출력 형식에도 원문으로 나가지 않는다 (ADR-039). */
export function maskAuthDetail(detail: SkmAuthDetail): SkmAuthDetail {
  if (typeof detail.password !== "string") return detail;
  return { ...detail, password: "***" };
}

export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "-";
  return sanitizeForTerminal(String(value));
}

/**
 * 비밀값을 받으려고 부른 명령의 출력 (ADR-039).
 * --json 은 응답 그대로, --quiet 은 파이프로 넘길 원문, 기본 출력은 터미널 제어 문자만 치환한다.
 */
export function printSkmValue(opts: OutputOptions, value: string, raw: unknown): void {
  if (opts.json) {
    printJson(raw);
  } else if (opts.quiet) {
    process.stdout.write(value + "\n");
  } else {
    process.stdout.write(sanitizeMultilineForTerminal(value) + "\n");
  }
}

/** 키 저장소 ID 로 이름을 조회한다. 키 생성·인증 정보 API 는 이름을 받는다 (ADR-040). */
export async function resolveKeyStoreName(client: SkmClient, keyStoreId: number): Promise<string> {
  const keyStore = await client.getKeyStore(keyStoreId);
  return keyStore.name;
}

/** 쓰기 결과를 field/value 로 출력한다. ids 는 --quiet 출력이다. */
export function outputSkmWriteResult(opts: OutputOptions, result: Record<string, unknown>, ids: string[]): void {
  output(opts, {
    headers: ["field", "value"],
    rows: Object.entries(result).map(([key, value]) => [key, formatCell(value)]),
    raw: result,
    ids,
  });
}

export function parseKeyVersionOption(value: string | undefined): number | undefined {
  return parseNonNegativeIntegerOption(value, "--key-version");
}

/** spinner 를 켜고 SKM 호출 하나를 기다린다. 실패하면 spinner 를 실패로 끝내고 오류를 그대로 던진다. */
export async function withSkmSpinner<T>(text: string, call: () => Promise<T>): Promise<T> {
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
