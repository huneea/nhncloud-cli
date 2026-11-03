import { getAccessToken } from "../../api/oauth.js";
import { getProfileEnvironment, getUserAccessKey, resolveProfileName } from "../../config/credentials.js";
import type { CloudEnvironment } from "../../config/types.js";
import { type OutputOptions } from "../../formatters/table.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { resolveServiceAppKey } from "../service-appkey.js";

export interface PipelineExecuteOptions extends OutputOptions {
  profile?: string;
  region: string;
  yes?: boolean;
  dryRun?: boolean;
}

/** `--dry-run` 이면 true, 아니면 `--yes` 를 API 호출 전에 요구한다 (ADR-048·049 와 같은 규칙). */
export function requireWriteMode(opts: { yes?: boolean; dryRun?: boolean }, operation: string): boolean {
  if (opts.dryRun) return true;
  if (!opts.yes) {
    throw new NhnCloudCliError(
      `${operation}에는 --yes 플래그가 필요합니다. 보낼 요청만 보려면 --dry-run 을 쓰세요.`,
      EXIT_PARAM_ERROR,
    );
  }
  return false;
}

export async function resolvePipelineProfile(opts: {
  profile?: string;
}): Promise<{ profileName: string; environment: CloudEnvironment }> {
  const profileName = await resolveProfileName(opts.profile);
  const environment = await getProfileEnvironment(profileName);
  return { profileName, environment };
}

/** profile 의 `pipeline.appkey` 만 읽는다. `--app-key` 옵션은 없다 (ADR-029). */
export async function resolvePipelineAppKey(profileName: string): Promise<string> {
  return resolveServiceAppKey(
    "pipeline",
    profileName,
    "Pipeline appkey가 없습니다. nhncloud configure --pipeline-appkey <key>로 설정하세요.",
  );
}

/** 공통 UAK OAuth 토큰을 발급받는다 (ADR-007). UAK 가 없으면 기존 오류를 그대로 쓴다. */
export async function issuePipelineToken(profileName: string, environment: CloudEnvironment): Promise<string> {
  const uak = await getUserAccessKey(profileName);
  return getAccessToken(profileName, uak.id, uak.secret, false, environment);
}
