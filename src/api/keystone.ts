import ky from "ky";
import { credentialFingerprint, readIaasToken, writeIaasToken } from "../cache/token-store.js";
import { keystoneIdentityUrl, instanceHost, imageHost, networkHost, blockStorageHost, nksHost } from "./endpoints.js";
import { toNhnCloudCliError } from "./httpError.js";
import { DEFAULT_TIMEOUT_MS } from "./timeout.js";
import { NhnCloudCliError } from "../utils/errors.js";
import { EXIT_API_ERROR } from "../utils/exit-codes.js";
import type { IaasCredential, CloudEnvironment } from "../config/types.js";

/**
 * Keystone v2 /tokens 응답 구조 (최소 필드).
 */
interface KeystoneTokenResponse {
  access: {
    token: {
      id: string;
      expires: string; // ISO 8601
    };
  };
}

export interface IaasTokenEndpoints {
  tokenId: string;
  computeEndpoint: string;
  imageEndpoint: string;
  networkEndpoint: string;
  blockStorageEndpoint: string;
  nksEndpoint: string;
}

function isKeystoneTokenResponse(val: unknown): val is KeystoneTokenResponse {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  if (typeof obj["access"] !== "object" || obj["access"] === null) return false;
  const access = obj["access"] as Record<string, unknown>;
  if (typeof access["token"] !== "object" || access["token"] === null) return false;
  const token = access["token"] as Record<string, unknown>;
  return typeof token["id"] === "string" && typeof token["expires"] === "string";
}

/**
 * iaas Keystone v2 토큰을 반환한다.
 *
 * - forceRefresh=false(기본): profile+region 캐시가 유효하면 재사용한다.
 * - forceRefresh=true: 캐시 읽기·쓰기 모두 건너뛴다.
 *   configure verify 등 junk 캐시를 남기지 않아야 하는 경우에 사용.
 */
export async function getIaasToken(
  profile: string,
  iaas: IaasCredential,
  forceRefresh = false,
  environment: CloudEnvironment = "real",
): Promise<IaasTokenEndpoints> {
  const credentialHash = credentialFingerprint(
    JSON.stringify([environment, iaas.tenantId, iaas.username, iaas.password]),
  );

  // 캐시 확인 (forceRefresh 시 건너뜀)
  if (!forceRefresh) {
    const cached = await readIaasToken(profile, iaas.region, credentialHash);
    if (cached !== null) {
      return {
        tokenId: cached.tokenId,
        computeEndpoint: cached.computeEndpoint,
        imageEndpoint: cached.imageEndpoint,
        networkEndpoint: cached.networkEndpoint,
        blockStorageEndpoint: cached.blockStorageEndpoint,
        nksEndpoint: cached.nksEndpoint,
      };
    }
  }

  // region → host 검증 (미등록 region 은 EXIT_PARAM_ERROR)
  const host = instanceHost(iaas.region, environment);
  const computeEndpoint = `https://${host}/v2/${encodeURIComponent(iaas.tenantId)}`;

  // image(Glance v2): 같은 토큰 재사용, host 만 다르다.
  // 실측 확정 (2026-06-09): tenant segment 없음 — GET /v2/images → 200, /v2/{tenantId}/images → 404.
  const imageEndpoint = `https://${imageHost(iaas.region, environment)}/v2`;

  // network(NHN VPC): 같은 토큰 재사용, host 만 다르다.
  // 실측 확정 (2026-06-11): tenant segment 없음 — GET /v2.0/vpcs → 200 (serviceCatalog neutron 확인).
  const networkEndpoint = `https://${networkHost(iaas.region, environment)}/v2.0`;

  // block storage(Cinder volumev2): 같은 토큰 재사용, host 만 다르고 경로는 compute 와 동일(tenant 포함).
  // docs 확정, 첫 호출 200 으로 확인 예정 (1-27).
  const blockStorageEndpoint = `https://${blockStorageHost(iaas.region, environment)}/v2/${encodeURIComponent(iaas.tenantId)}`;

  // NKS(container-infra): 같은 Keystone 토큰 재사용, tenant segment 없이 /v1.
  const nksEndpoint = `https://${nksHost(iaas.region, environment)}/v1`;

  // Keystone v2 토큰 발급
  let raw: unknown;
  try {
    raw = await ky
      .post(keystoneIdentityUrl(environment), {
        json: {
          auth: {
            tenantId: iaas.tenantId,
            passwordCredentials: {
              username: iaas.username,
              password: iaas.password,
            },
          },
        },
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      })
      .json();
  } catch (err) {
    throw toNhnCloudCliError(err);
  }

  if (!isKeystoneTokenResponse(raw)) {
    throw new NhnCloudCliError(
      "Keystone 응답 형식이 올바르지 않습니다 — access.token.id / expires 필드가 없습니다.",
      EXIT_API_ERROR,
    );
  }

  const tokenId = raw.access.token.id;
  const expiresAt = raw.access.token.expires;

  // forceRefresh 시 캐시에 저장하지 않음 (임시 검증 용도)
  if (!forceRefresh) {
    await writeIaasToken(profile, iaas.region, { tokenId, expiresAt, credentialHash, computeEndpoint, imageEndpoint, networkEndpoint, blockStorageEndpoint, nksEndpoint });
  }

  return { tokenId, computeEndpoint, imageEndpoint, networkEndpoint, blockStorageEndpoint, nksEndpoint };
}
