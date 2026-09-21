import {
  resolveProfileName,
  getUserAccessKey,
  getProfileEnvironment,
} from "../../config/credentials.js";
import { getAccessToken } from "../../api/oauth.js";
import { DeployClient } from "../../services/deploy/client.js";
import { resolveServiceAppKey } from "../service-appkey.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";

/**
 * profile 해석 → UAK 로드 → access_token 교환 → DeployClient 생성.
 * spinner 시작 *전* (파라미터 검증·자격증명 로드 단계) 에 호출한다.
 */
export async function createDeployClient(
  profileOpt?: string,
): Promise<{ client: DeployClient; profileName: string }> {
  const profileName = await resolveProfileName(profileOpt);
  const uak = await getUserAccessKey(profileName);
  const environment = await getProfileEnvironment(profileName);
  const accessToken = await getAccessToken(profileName, uak.id, uak.secret, false, environment);
  return { client: new DeployClient(accessToken, environment), profileName };
}

/**
 * profile 의 deploy.appkey 에서 appKey 를 해석한다.
 * 없으면 EXIT_CONFIG_ERROR + 설정 안내 (빈문자열 fallback 금지).
 *
 * profileName 은 `createDeployClient` 의 반환값을 그대로 넘긴다 —
 * 여기서 다시 `resolveProfileName` 을 부르면 두 해석이 갈릴 수 있다.
 */
export async function resolveDeployAppKey(profileName: string): Promise<string> {
  return resolveServiceAppKey(
    "deploy",
    profileName,
      "Deploy appKey 가 없습니다.\n" +
        "nhncloud configure --deploy-appkey <key> 를 실행해 설정하세요.",
  );
}

/**
 * 필수 좌표 옵션이 비어 있으면 입력 오류로 거부한다 (ADR-033).
 * spinner 시작·네트워크 호출 *전* 에 호출한다 — 빈 값으로 API 를 부르면
 * 서버 오류로 나타나 원인을 찾기 어렵다.
 */
export function requireCoordinate(value: string | undefined, flag: string): string {
  if (!value) {
    throw new NhnCloudCliError(`${flag} 가 필요합니다.`, EXIT_PARAM_ERROR);
  }
  return value;
}
