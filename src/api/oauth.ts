import ky from "ky";
import { credentialFingerprint, readToken, writeToken } from "../cache/token-store.js";
import { toNhnCloudCliError } from "./httpError.js";
import { DEFAULT_TIMEOUT_MS } from "./timeout.js";
import type { CloudEnvironment } from "../config/types.js";

const OAUTH_ENDPOINT: Record<CloudEnvironment, string> = {
  real: "https://oauth.api.nhncloudservice.com/oauth2/token/create",
  gov: "https://oauth.api.gov-nhncloudservice.com/oauth2/token/create",
};

interface TokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

function isTokenResponse(val: unknown): val is TokenResponse {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    typeof obj["access_token"] === "string" && typeof obj["expires_in"] === "number"
  );
}

/**
 * Deploy API 용 access_token 을 반환한다.
 *
 * - forceRefresh=false(기본): 캐시 토큰이 유효하면 재사용한다.
 * - forceRefresh=true: 캐시를 건너뛰고 OAuth 직접 호출. 토큰을 캐시에 저장하지 않는다.
 *   configure verify 등 캐시를 우회해야 하는 경우에 사용.
 */
export async function getAccessToken(
  profile: string,
  uakId: string,
  uakSecret: string,
  forceRefresh = false,
  environment: CloudEnvironment = "real",
): Promise<string> {
  const credentialHash = credentialFingerprint(JSON.stringify([environment, uakId, uakSecret]));

  // 캐시 확인 (forceRefresh 시 건너뜀)
  if (!forceRefresh) {
    const cached = await readToken(profile, credentialHash);
    if (cached !== null) {
      return cached.accessToken;
    }
  }

  // OAuth 교환
  const basicCredential = Buffer.from(`${uakId}:${uakSecret}`).toString("base64");

  let raw: unknown;
  try {
    raw = await ky
      .post(OAUTH_ENDPOINT[environment], {
        headers: {
          Authorization: `Basic ${basicCredential}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      })
      .json();
  } catch (err) {
    throw toNhnCloudCliError(err);
  }

  if (!isTokenResponse(raw)) {
    throw toNhnCloudCliError(new Error("OAuth 응답 형식이 올바르지 않습니다."));
  }

  // forceRefresh 시 캐시에 저장하지 않음 (임시 검증 용도)
  if (!forceRefresh) {
    const expiresAt = new Date(Date.now() + raw.expires_in * 1000);
    await writeToken(profile, raw.access_token, expiresAt, credentialHash);
  }

  return raw.access_token;
}
