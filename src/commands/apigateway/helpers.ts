import { readFile, stat } from "node:fs/promises";
import { getAccessToken } from "../../api/oauth.js";
import {
  getUserAccessKey,
  resolveProfileName,
  requireRealEnvironment,
} from "../../config/credentials.js";
import { ApiGatewayClient } from "../../services/apigateway/client.js";
import type {
  Resource,
  WrittenStageResource,
} from "../../services/apigateway/types.js";
import { resolveServiceAppKey } from "../service-appkey.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { sanitizeForTerminal } from "../../utils/terminal.js";
import type { output } from "../../formatters/table.js";
import { MAX_JSON_INPUT_BYTES } from "../../utils/limits.js";

function fileErrorReason(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (typeof code === "string") return code;
  }
  return error instanceof Error ? error.message : String(error);
}

export function requireYes(yes: boolean | undefined, operation: string): true {
  if (!yes) {
    throw new NhnCloudCliError(
      `${operation}에는 --yes 플래그가 필요합니다.`,
      EXIT_PARAM_ERROR,
    );
  }
  return true;
}

/** 플러그인 설정 JSON을 검증 전 unknown 값으로 읽는다. */
export async function readPluginConfigFile(path: string): Promise<unknown> {
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(path);
  } catch (error) {
    const reason = fileErrorReason(error);
    throw new NhnCloudCliError(
      `플러그인 설정 파일을 읽을 수 없습니다: ${JSON.stringify(path)} (${JSON.stringify(reason)}).`,
      EXIT_PARAM_ERROR,
    );
  }

  if (!fileStat.isFile()) {
    const reason = fileStat.isDirectory() ? "EISDIR" : "EINVAL";
    throw new NhnCloudCliError(
      `플러그인 설정 경로가 일반 파일이 아닙니다: ${JSON.stringify(path)} (${reason}).`,
      EXIT_PARAM_ERROR,
    );
  }
  if (fileStat.size > MAX_JSON_INPUT_BYTES) {
    throw new NhnCloudCliError(
      `플러그인 설정 파일이 너무 큽니다 (${fileStat.size} 바이트). 허용 상한은 ${MAX_JSON_INPUT_BYTES} 바이트입니다.`,
      EXIT_PARAM_ERROR,
    );
  }

  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (error) {
    const reason = fileErrorReason(error);
    throw new NhnCloudCliError(
      `플러그인 설정 파일을 읽을 수 없습니다: ${JSON.stringify(path)} (${JSON.stringify(reason)}).`,
      EXIT_PARAM_ERROR,
    );
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    const reason = sanitizeForTerminal(
      error instanceof Error ? error.message : String(error),
    );
    throw new NhnCloudCliError(
      `플러그인 설정 JSON 형식이 올바르지 않습니다: ${JSON.stringify(path)} (${reason}).`,
      EXIT_PARAM_ERROR,
    );
  }
}

/** 대상 경로와 구분자 기준 하위 경로를 dry-run 영향 범위로 모은다. */
export function collectAffectedPaths(resources: Resource[], targetPath: string): Resource[] {
  if (targetPath === "/") return resources;
  const childPrefix = `${targetPath}/`;
  return resources.filter(
    (resource) => resource.path === targetPath || resource.path.startsWith(childPrefix),
  );
}

/** 반영·롤백 응답의 출력 형태. `output` 의 계약이 바뀌면 tsc 가 여기서 잡는다. */
export function writtenStageResourceOutput(
  resources: WrittenStageResource[],
): Parameters<typeof output>[1] {
  return {
    headers: ["stageResourceId", "path", "methodType", "methodName", "plugins"],
    rows: resources.map((resource) => [
      sanitizeForTerminal(resource.stageResourceId),
      sanitizeForTerminal(resource.path),
      resource.methodType == null ? "-" : sanitizeForTerminal(resource.methodType),
      resource.methodName == null ? "-" : sanitizeForTerminal(resource.methodName),
      String(resource.stageResourcePluginList?.length ?? 0),
    ]),
    raw: resources,
    ids: resources.map((resource) => sanitizeForTerminal(resource.stageResourceId)),
  };
}

/** profile 의 apigateway.appkey에서 appKey를 해석한다. */
export async function resolveApiGatewayAppKey(profileName: string): Promise<string> {
  return resolveServiceAppKey(
    "apigateway",
    profileName,
    "API Gateway appKey가 없습니다. nhncloud configure --apigateway-appkey <key>로 설정하세요.",
  );
}

/** profile → 공통 UAK → OAuth token → appKey → API Gateway client 순서로 해석한다. */
export async function resolveApiGatewayClient(opts: {
  profile?: string;
  region?: string;
}): Promise<{ client: ApiGatewayClient; profileName: string }> {
  const profileName = await resolveProfileName(opts.profile);
  await requireRealEnvironment(profileName, "API Gateway");
  const uak = await getUserAccessKey(profileName);
  const accessToken = await getAccessToken(profileName, uak.id, uak.secret);
  const appKey = await resolveApiGatewayAppKey(profileName);
  return {
    client: new ApiGatewayClient(accessToken, opts.region ?? "kr1", appKey),
    profileName,
  };
}
