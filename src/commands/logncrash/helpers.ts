import { getAccessToken } from "../../api/oauth.js";
import {
  getServiceCredential,
  getUserAccessKey,
  resolveProfileName,
  requireRealEnvironment,
} from "../../config/credentials.js";
import { LogncrashClient } from "../../services/logncrash/client.js";
import {
  assertAvailableSearchToken,
  availableTokenStatus,
} from "../../services/logncrash/token.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_CONFIG_ERROR } from "../../utils/exit-codes.js";

/**
 * profile → Log & Crash appkey → 공통 UAK → 공통 OAuth cache 순서로
 * Search v3 읽기 client를 만든다. collector send는 이 helper를 사용하지 않는다.
 */
export async function resolveLogncrashClient(profile?: string): Promise<LogncrashClient> {
  const profileName = await resolveProfileName(profile);
  await requireRealEnvironment(profileName, "Log & Crash");
  const credential = await getServiceCredential("logncrash", profileName);
  if (typeof credential.appkey !== "string" || credential.appkey.length === 0) {
    throw new NhnCloudCliError(
      `profile "${profileName}"의 logncrash 자격증명에 appkey가 없습니다. nhncloud configure로 appkey를 설정하세요.`,
      EXIT_CONFIG_ERROR,
    );
  }

  const uak = await getUserAccessKey(profileName);
  const accessToken = await getAccessToken(profileName, uak.id, uak.secret);
  return new LogncrashClient(credential.appkey, accessToken);
}

export async function preflightLogncrashSearchToken(client: LogncrashClient): Promise<void> {
  const result = await client.availableToken();
  assertAvailableSearchToken(availableTokenStatus(result.availableToken));
}
