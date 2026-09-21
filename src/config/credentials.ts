import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import chalk from "chalk";
import { NhnCloudCliError } from "../utils/errors.js";
import { EXIT_CONFIG_ERROR, EXIT_PARAM_ERROR } from "../utils/exit-codes.js";
import type { Credentials, Config, ServiceCredential, UserAccessKey, IaasCredential, CloudEnvironment } from "./types.js";

const CREDENTIALS_PATH = join(homedir(), ".nhncloud", "credentials.json");
const CONFIG_PATH = join(homedir(), ".nhncloud", "config.json");

function isCredentials(value: unknown): value is Credentials {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return obj["version"] === 1 && typeof obj["profiles"] === "object" && obj["profiles"] !== null;
}

function isConfig(value: unknown): value is Config {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return obj["version"] === 1;
}

function isUserAccessKey(value: unknown): value is UserAccessKey {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj["id"] === "string" &&
    obj["id"].length > 0 &&
    typeof obj["secret"] === "string" &&
    obj["secret"].length > 0
  );
}

async function loadCredentials(): Promise<Credentials> {
  let raw: string;
  try {
    raw = await readFile(CREDENTIALS_PATH, "utf-8");
  } catch {
    throw new NhnCloudCliError(
      `자격증명 파일을 찾을 수 없습니다: ${CREDENTIALS_PATH}\n` +
        "nhncloud configure 를 실행해 자격증명을 설정하거나, 다음 형식으로 파일을 생성하세요:\n" +
        JSON.stringify(
          {
            version: 1,
            profiles: {
              default: {
                userAccessKey: { id: "<uak-id>", secret: "<uak-secret>" },
                logncrash: { appkey: "<appkey>" },
              },
            },
          },
          null,
          2,
        ),
      EXIT_CONFIG_ERROR,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new NhnCloudCliError(
      `자격증명 파일 파싱 오류: ${CREDENTIALS_PATH} — 올바른 JSON 형식인지 확인하세요.`,
      EXIT_CONFIG_ERROR,
    );
  }

  if (!isCredentials(parsed)) {
    throw new NhnCloudCliError(
      `자격증명 파일 형식 오류: ${CREDENTIALS_PATH} — version: 1 과 profiles 필드가 필요합니다.`,
      EXIT_CONFIG_ERROR,
    );
  }

  return parsed;
}

/**
 * config.json 을 파싱해 `unknown` 으로 돌려준다. 파일이 없으면 null.
 * 스키마를 아직 모르는 값을 봐야 하는 곳(폐지된 블록 경고)이 있어 스키마 검사와 분리한다.
 */
async function readConfigJson(): Promise<unknown> {
  let raw: string;
  try {
    raw = await readFile(CONFIG_PATH, "utf-8");
  } catch {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new NhnCloudCliError(
      `설정 파일 파싱 오류: ${CONFIG_PATH} — 올바른 JSON 형식인지 확인하세요.`,
      EXIT_CONFIG_ERROR,
    );
  }
}

async function loadConfig(): Promise<Config | null> {
  const parsed = await readConfigJson();
  if (!isConfig(parsed)) {
    return null;
  }

  return parsed;
}

/**
 * userAccessKey 가 설정된 profile 이름 목록을 반환한다.
 * `loadCredentialsOrEmpty` 재사용 — 자격증명 파일이 없으면 빈 배열(설정 전 최초 configure 시나리오),
 * 파일이 손상(JSON 파싱 오류)됐으면 조용히 넘기지 않고 NhnCloudCliError 를 rethrow 한다.
 * configure 대화형의 UAK 재사용 프롬프트 전용 — 비대화형 경로는 이 함수를 타지 않는다.
 */
export async function listProfilesWithUak(): Promise<string[]> {
  const credentials = await loadCredentialsOrEmpty();
  return Object.entries(credentials.profiles)
    .filter(([, profile]) => isUserAccessKey(profile["userAccessKey"]))
    .map(([name]) => name);
}

/**
 * profile 이름을 결정한다.
 * 우선순위: --profile 옵션 > NHNCLOUD_PROFILE env > config.defaultProfile > "default"
 */
export async function resolveProfileName(cliProfile?: string): Promise<string> {
  if (cliProfile) return cliProfile;

  const envProfile = process.env["NHNCLOUD_PROFILE"];
  if (envProfile) return envProfile;

  const config = await loadConfig();
  if (config?.defaultProfile) return config.defaultProfile;

  return "default";
}

/**
 * 지정 profile 의 공통 UAK (userAccessKey) 를 반환한다.
 * 없으면 nhncloud configure 안내와 함께 EXIT_CONFIG_ERROR 를 던진다.
 */
export async function getUserAccessKey(profileName: string): Promise<UserAccessKey> {
  const credentials = await loadCredentials();

  const profile = credentials.profiles[profileName];
  if (!profile) {
    throw new NhnCloudCliError(
      `profile "${profileName}" 을 찾을 수 없습니다.\n` +
        `${CREDENTIALS_PATH} 에서 profiles.${profileName} 블록을 추가하거나 nhncloud configure 를 실행하세요.`,
      EXIT_CONFIG_ERROR,
    );
  }

  const uak = profile["userAccessKey"];
  if (!isUserAccessKey(uak)) {
    throw new NhnCloudCliError(
      `profile "${profileName}" 에 userAccessKey 가 없거나 불완전합니다.\n` +
        `nhncloud configure 를 실행해 UAK id/secret 을 설정하세요.`,
      EXIT_CONFIG_ERROR,
    );
  }

  return uak;
}

/** 기존 profile 은 일반망으로 해석하며, 알 수 없는 값은 요청 전에 거부한다. */
export async function getProfileEnvironment(profileName: string, allowMissing = false): Promise<CloudEnvironment> {
  const credentials = allowMissing ? await loadCredentialsOrEmpty() : await loadCredentials();
  const profile = credentials.profiles[profileName];
  if (!profile) {
    if (allowMissing) return "real";
    throw new NhnCloudCliError(`profile "${profileName}" 을 찾을 수 없습니다.`, EXIT_CONFIG_ERROR);
  }
  const environment = profile.environment;
  if (environment !== undefined && environment !== "gov") {
    throw new NhnCloudCliError(`profile "${profileName}" 의 environment 는 gov 이어야 합니다. 일반망은 이 필드를 생략하세요.`, EXIT_CONFIG_ERROR);
  }
  return environment ?? "real";
}

/** 공공망 endpoint가 확인되지 않은 서비스로 공공망 자격증명을 보내지 않는다. */
export async function requireRealEnvironment(profileName: string, service: string): Promise<void> {
  if (await getProfileEnvironment(profileName) === "gov") {
    throw new NhnCloudCliError(`${service}의 공공망 API endpoint는 아직 지원하지 않습니다.`, EXIT_CONFIG_ERROR);
  }
}

/**
 * 지정 profile 의 서비스 자격증명 블록을 반환한다.
 * 해당 블록이 없으면 설정 안내 메시지와 함께 EXIT_CONFIG_ERROR 를 던진다.
 * userAccessKey / iaas 블록은 이 함수로 읽지 않는다 (전용 함수 사용).
 */
export async function getServiceCredential(
  service: string,
  profileName: string,
): Promise<ServiceCredential> {
  const cred = await getOptionalServiceCredential(service, profileName);
  if (!cred) {
    throw new NhnCloudCliError(
      `profile "${profileName}" 에 "${service}" 자격증명이 없습니다.\n` +
        `${CREDENTIALS_PATH} 에서 profiles.${profileName}.${service} 블록을 추가하세요.\n` +
        `예시: { "appkey": "<appkey>" }`,
      EXIT_CONFIG_ERROR,
    );
  }

  return cred;
}

/**
 * 지정 profile 의 서비스 자격증명 블록을 반환한다.
 * profile 은 있지만 해당 블록만 없으면 undefined 를 반환한다.
 * 파일 오류와 profile 부재 오류는 기존 조회 경계 그대로 던진다.
 */
export async function getOptionalServiceCredential(
  service: string,
  profileName: string,
): Promise<ServiceCredential | undefined> {
  if (service === "userAccessKey" || service === "iaas" || service === "environment") {
    throw new NhnCloudCliError(
      `"${service}" 는 서비스 자격증명이 아닙니다 — 전용 getter 를 사용하세요.`,
      EXIT_PARAM_ERROR,
    );
  }

  const credentials = await loadCredentials();

  const profile = credentials.profiles[profileName];
  if (!profile) {
    throw new NhnCloudCliError(
      `profile "${profileName}" 을 찾을 수 없습니다.\n` +
        `${CREDENTIALS_PATH} 에서 profiles.${profileName} 블록을 추가하세요.`,
      EXIT_CONFIG_ERROR,
    );
  }

  return profile[service] as ServiceCredential | undefined;
}

/**
 * 파일이 없으면 빈 구조를 반환하는 credentials 로더 (쓰기 경로 전용).
 */
async function loadCredentialsOrEmpty(): Promise<Credentials> {
  try {
    const raw = await readFile(CREDENTIALS_PATH, "utf-8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new NhnCloudCliError(
        `자격증명 파일 파싱 오류: ${CREDENTIALS_PATH} — 올바른 JSON 형식인지 확인하세요.`,
        EXIT_CONFIG_ERROR,
      );
    }
    if (isCredentials(parsed)) return parsed;
    return { version: 1, profiles: {} };
  } catch (err) {
    if (err instanceof NhnCloudCliError) throw err;
    return { version: 1, profiles: {} };
  }
}

/**
 * credentials.json 을 mode 0600 으로 저장한다. 디렉터리가 없으면 자동 생성.
 */
async function saveCredentials(creds: Credentials): Promise<void> {
  await mkdir(dirname(CREDENTIALS_PATH), { recursive: true, mode: 0o700 });
  await writeFile(CREDENTIALS_PATH, JSON.stringify(creds, null, 2), {
    encoding: "utf-8",
    mode: 0o600,
  });
}

/**
 * 지정 profile 의 공통 UAK 를 머지 저장한다.
 * 같은 profile 의 다른 서비스 블록과 다른 profile 은 보존된다.
 */
export async function setUserAccessKey(
  profileName: string,
  uak: UserAccessKey,
): Promise<void> {
  const creds = await loadCredentialsOrEmpty();
  const profile = creds.profiles[profileName] ?? {};
  creds.profiles[profileName] = { ...profile, userAccessKey: uak };
  await saveCredentials(creds);
}

/**
 * 지정 profile 의 서비스 자격증명 블록을 머지 저장한다.
 * 같은 profile 의 다른 서비스 블록과 다른 profile 은 보존된다.
 */
export async function setServiceCredential(
  profileName: string,
  service: string,
  cred: ServiceCredential,
): Promise<void> {
  const creds = await loadCredentialsOrEmpty();
  const profile = creds.profiles[profileName] ?? {};
  creds.profiles[profileName] = { ...profile, [service]: cred };
  await saveCredentials(creds);
}

function isIaasCredential(value: unknown): value is IaasCredential {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj["tenantId"] === "string" &&
    obj["tenantId"].length > 0 &&
    typeof obj["username"] === "string" &&
    obj["username"].length > 0 &&
    typeof obj["password"] === "string" &&
    obj["password"].length > 0 &&
    typeof obj["region"] === "string" &&
    obj["region"].length > 0
  );
}

/**
 * 지정 profile 의 iaas 자격증명 블록을 반환한다.
 * 없거나 필드 누락 시 nhncloud configure 안내와 함께 EXIT_CONFIG_ERROR 를 던진다.
 */
export async function getIaasCredential(profileName: string): Promise<IaasCredential> {
  const credentials = await loadCredentials();

  const profile = credentials.profiles[profileName];
  if (!profile) {
    throw new NhnCloudCliError(
      `profile "${profileName}" 을 찾을 수 없습니다.\n` +
        `${CREDENTIALS_PATH} 에서 profiles.${profileName} 블록을 추가하거나 nhncloud configure 를 실행하세요.`,
      EXIT_CONFIG_ERROR,
    );
  }

  const iaas = profile["iaas"];
  if (!isIaasCredential(iaas)) {
    throw new NhnCloudCliError(
      `profile "${profileName}" 에 iaas 자격증명이 없거나 불완전합니다.\n` +
        "nhncloud configure 를 실행해 tenantId / username / password / region 을 설정하세요.\n" +
        "password 는 NHN Cloud 콘솔 IAM 의 API 비밀번호입니다 (로그인 비밀번호가 아닙니다).",
      EXIT_CONFIG_ERROR,
    );
  }

  return iaas;
}

/**
 * 지정 profile 의 iaas 자격증명 블록을 머지 저장한다.
 * 같은 profile 의 다른 서비스 블록과 다른 profile 은 보존된다.
 */
export async function setIaasCredential(
  profileName: string,
  iaas: IaasCredential,
): Promise<void> {
  const creds = await loadCredentialsOrEmpty();
  const profile = creds.profiles[profileName] ?? {};
  creds.profiles[profileName] = { ...profile, iaas };
  await saveCredentials(creds);
}

/** 폐지된 블록. 읽지 않고 경고만 하려고 형태만 남긴다 (ADR-033). */
interface LegacyDeployConfig {
  targets?: Record<string, unknown>;
}

function isLegacyDeployConfig(value: unknown): value is LegacyDeployConfig {
  if (typeof value !== "object" || value === null) return false;
  const targets = (value as Record<string, unknown>)["targets"];
  return targets === undefined || (typeof targets === "object" && targets !== null);
}

/**
 * config.json 에 폐지된 deploy.targets 가 남아 있으면 stderr 로 한 줄 경고한다 (ADR-033).
 *
 * 값을 읽어 쓰지 않고, 파일을 자동으로 고치지도 않는다 —
 * appkey 는 자격증명이라 CLI 가 0600 파일을 임의로 쓰는 것보다 사용자가 확인하고 옮기는 편이 안전하다.
 * `--quiet` 에서도 낸다. stderr 이므로 `--json` stdout 계약은 그대로다.
 * target 이름은 담지 않는다 — 사용자 리소스 식별자라 CI 출력이나 로그에 남는다.
 */
export async function warnLegacyDeployTargets(): Promise<void> {
  // 경고는 부수 기능이다. 손상된 config.json 때문에 이 hook 이 먼저 죽으면
  // 좌표 누락(종료 코드 3)이 config 오류로 뒤바뀐다 — 파싱 실패는 조용히 넘긴다.
  // 삼키는 것은 readConfigJson 의 파싱 오류 하나뿐이다. 파일 부재는 그 함수가 이미 null 로 돌려준다.
  // deploy 가 config.json 에서 읽는 값은 defaultProfile 뿐이라 이 정보는 경고에 필요 없고,
  // --profile 을 주지 않았다면 뒤따르는 resolveProfileName 이 같은 오류를 제자리에서 낸다.
  let parsed: unknown;
  try {
    parsed = await readConfigJson();
  } catch (err) {
    if (err instanceof NhnCloudCliError && err.exitCode === EXIT_CONFIG_ERROR) return;
    throw err;
  }
  if (typeof parsed !== "object" || parsed === null) return;

  const deploy = (parsed as Record<string, unknown>)["deploy"];
  if (!isLegacyDeployConfig(deploy)) return;
  if (!deploy.targets || Object.keys(deploy.targets).length === 0) return;

  process.stderr.write(
    chalk.yellow(
      "경고: config.json 의 deploy.targets 는 더 이상 사용되지 않습니다. " +
        "appkey 는 nhncloud configure --deploy-appkey 로 옮기고, " +
        "나머지 좌표는 --artifact-id 등 옵션으로 넘기세요.\n",
    ),
  );
}
