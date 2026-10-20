import { getAccessToken } from "../api/oauth.js";
import { getIaasToken } from "../api/keystone.js";
import { LogncrashClient } from "../services/logncrash/client.js";
import { NcrClient } from "../services/ncr/client.js";
import { NcsClient } from "../services/ncs/client.js";
import { NhnCloudCliError } from "../utils/errors.js";
import { EXIT_AUTH_ERROR } from "../utils/exit-codes.js";
import type { UserAccessKey, IaasCredential, CloudEnvironment } from "../config/types.js";

/**
 * UAK 로 OAuth 토큰 발급을 시도해 유효성을 검증한다.
 *
 * - 성공: true
 * - 401/403 인증 실패: false
 * - 그 외 네트워크 에러 등: throw (검증 자체 불가)
 *
 * 캐시를 반드시 우회한다 (forceRefresh=true).
 * configure 재실행 시 틀린 UAK 가 캐시 히트로 false-positive 통과하는 버그를 방지.
 *
 * 이 파일의 검증은 모두 profile 의 망(environment) 주소로만 요청한다(ADR-037).
 */
export async function verifyUserAccessKey(uak: UserAccessKey, environment: CloudEnvironment = "real"): Promise<boolean> {
  try {
    // profile 키는 임시 값 — 캐시 우회(forceRefresh=true)이므로 캐시에 저장되지 않음
    await getAccessToken("__verify__", uak.id, uak.secret, true, environment);
    return true;
  } catch (err) {
    if (err instanceof NhnCloudCliError && err.exitCode === EXIT_AUTH_ERROR) {
      return false;
    }
    throw err;
  }
}

/**
 * iaas 자격증명으로 Keystone 토큰 발급을 시도해 유효성을 검증한다.
 *
 * - 성공: true
 * - 401/403 인증 실패: false
 * - 그 외 에러: throw
 *
 * forceRefresh=true 로 캐시를 반드시 우회한다.
 * "__verify__" profile 로 호출해도 junk 캐시 파일이 디스크에 남지 않는다.
 */
export async function verifyIaas(iaas: IaasCredential, environment: CloudEnvironment = "real"): Promise<boolean> {
  try {
    await getIaasToken("__verify__", iaas, true, environment);
    return true;
  } catch (err) {
    if (err instanceof NhnCloudCliError && err.exitCode === EXIT_AUTH_ERROR) {
      return false;
    }
    throw err;
  }
}

/**
 * NCR appkey 와 공통 UAK 로 레지스트리 목록 조회를 시도해 유효성을 검증한다.
 *
 * - 성공(0건 포함): true
 * - 401/403 인증 실패: false
 * - 그 외 에러: throw
 *
 * 인증 secret 은 공통 UAK 이므로 uak 를 함께 넘긴다(ADR-016).
 *
 * region 은 kr1 을 가정한다 — configure 에 ncr region 입력 통로가 없기 때문.
 * kr2/kr3 의 NCR 만 쓰는 사용자는 이 검증이 의미 없으므로, 첫 `ncr list --region kr2`
 * 호출이 사실상의 검증이 된다(flow.md 의 연결 테스트 한계 참조).
 */
export async function verifyNcr(uak: UserAccessKey, appkey: string, environment: CloudEnvironment = "real"): Promise<boolean> {
  if (!appkey) return false;

  const client = new NcrClient(uak.id, uak.secret, "kr1", environment);
  try {
    await client.listRegistries(appkey);
    return true;
  } catch (err) {
    if (err instanceof NhnCloudCliError && err.exitCode === EXIT_AUTH_ERROR) {
      return false;
    }
    throw err;
  }
}

/**
 * NCS appkey 와 공통 UAK 로 설계도(template) 목록 조회를 시도해 유효성을 검증한다.
 *
 * - 성공(0건 포함): true
 * - 401/403 인증 실패: false
 * - 그 외 에러: throw
 *
 * NCS 는 NCR(정적 UAK, ADR-016)과 달리 OAuth 토큰 인증이다(ADR-020) — Deploy 와 같은
 * UAK client_credentials 토큰을 재사용하므로, NcsClient 를 만들기 전에 OAuth 토큰
 * 교환이 먼저 필요하다(exemplar 는 verifyNcr 가 아니라 verifyUserAccessKey).
 *
 * 캐시를 반드시 우회한다(forceRefresh=true, "__verify__" profile) — 그렇지 않으면
 * 틀린 UAK 인데도 옛 유효 토큰 캐시 히트로 false-positive 가 발생한다
 * (verifyUserAccessKey 와 동일한 사유).
 *
 * region 은 kr1 을 가정한다 — configure 에 ncs region 입력 통로가 없기 때문
 * (verifyNcr 과 동일한 한계).
 */
export async function verifyNcs(uak: UserAccessKey, appkey: string, environment: CloudEnvironment = "real"): Promise<boolean> {
  if (!appkey) return false;

  try {
    const token = await getAccessToken("__verify__", uak.id, uak.secret, true, environment);
    const client = new NcsClient(token, "kr1", appkey, environment);
    await client.listTemplates({ size: 1 });
    return true;
  } catch (err) {
    if (err instanceof NhnCloudCliError && err.exitCode === EXIT_AUTH_ERROR) {
      return false;
    }
    throw err;
  }
}

/**
 * logncrash appkey와 공통 UAK OAuth 토큰으로 짧은 범위 검색을 시도한다.
 *
 * - 성공 또는 빈 결과: true
 * - 401/403 인증 실패: false
 * - 그 외 에러: throw
 */
export async function verifyLogncrash(uak: UserAccessKey, appkey: string, environment: CloudEnvironment = "real"): Promise<boolean> {
  if (!appkey) return false;

  const now = new Date();
  const oneMinuteAgo = new Date(now.getTime() - 60_000);

  try {
    const token = await getAccessToken("__verify__", uak.id, uak.secret, true, environment);
    const client = new LogncrashClient(appkey, token, environment);
    await client.cursorSearch({
      query: "*",
      from: oneMinuteAgo.toISOString(),
      to: now.toISOString(),
      pageSize: 1,
    });
    return true;
  } catch (err) {
    if (err instanceof NhnCloudCliError && err.exitCode === EXIT_AUTH_ERROR) {
      return false;
    }
    throw err;
  }
}
