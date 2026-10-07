import type { Command } from "commander";
import { getAccessToken } from "../../api/oauth.js";
import { getProfileEnvironment, getUserAccessKey, resolveProfileName } from "../../config/credentials.js";
import { printJson, type OutputOptions } from "../../formatters/table.js";
import { SkmClient } from "../../services/skm/client.js";
import type { SkmAuthDetail, SkmAuthType, SkmKeyStatusFilter, SkmKeyType } from "../../services/skm/types.js";
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
 * --json 은 응답 그대로, --quiet 은 원문 뒤에 줄바꿈 하나, 기본 출력은 터미널 제어 문자만 치환한다.
 * 입력은 끝 줄바꿈을 지우지 않으므로 --quiet 출력을 다른 skm 명령에 넘기면 줄바꿈까지 데이터가 된다.
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
