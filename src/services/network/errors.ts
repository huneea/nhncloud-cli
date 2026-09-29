import { HTTPError } from "ky";
import { toNhnCloudCliError } from "../../api/httpError.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { sanitizeForTerminal } from "../../utils/terminal.js";

/** 서버가 거부 사유를 본문에 담아 돌려주는 상태 코드. 그 밖의 상태 코드는 공용 변환 결과를 쓴다. */
const REJECTION_STATUSES = new Set([400, 409]);

/**
 * 쓰기 요청의 HTTP 오류를 NhnCloudCliError 로 변환한다.
 * 400·409 응답은 NeutronError.message(거부 사유)를 정제해 덧붙이고, 종료 코드는 공용 변환 결과를 유지한다.
 * 본문이 JSON 이 아니거나 message 가 없으면 공용 변환 결과를 그대로 쓴다.
 */
export async function toNetworkWriteError(err: unknown): Promise<NhnCloudCliError> {
  const base = toNhnCloudCliError(err);
  if (!(err instanceof HTTPError) || !REJECTION_STATUSES.has(err.response.status)) {
    return base;
  }

  let reason: string | null = null;
  try {
    const body: unknown = await err.response.json();
    const neutron = typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)["NeutronError"] : undefined;
    const message = typeof neutron === "object" && neutron !== null
      ? (neutron as Record<string, unknown>)["message"] : undefined;
    if (typeof message === "string") reason = message;
  } catch {
    // 본문이 비어 있거나 JSON 이 아니면 공용 변환 결과를 쓴다.
  }
  if (reason === null) return base;

  return new NhnCloudCliError(
    `${base.message}\n서버 응답: ${sanitizeForTerminal(reason)}`,
    base.exitCode,
  );
}
