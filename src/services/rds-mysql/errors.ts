import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR, EXIT_AUTH_ERROR } from "../../utils/exit-codes.js";
import { sanitizeForTerminal } from "../../utils/terminal.js";

/**
 * 인증 실패와 권한 없음 결과 코드다 (ADR-046).
 * 문서는 80401·80403 을 싣지만, 실호출에서 잘못된 UAK 는 HTTP 200 과 resultCode 401 로 왔다.
 */
const AUTH_RESULT_CODES: ReadonlySet<number> = new Set([80401, 80403, 401, 403]);


/**
 * 서버가 봉투 header 로 알린 RDS for MySQL 실패다.
 * resultCode 는 number 나 string 으로 올 수 있어 Number() 로 바꿔 인증 오류를 가른다.
 */
export class RdsMysqlApiError extends NhnCloudCliError {
  readonly resultCode: number | string;
  /** 봉투를 HTTP 오류 응답 본문에서 읽었으면 그 상태 코드다. HTTP 200 봉투 실패면 undefined 다. */
  readonly httpStatus?: number;

  constructor(resultCode: number | string, resultMessage: string, httpStatus?: number) {
    const isAuthError =
      AUTH_RESULT_CODES.has(Number(resultCode)) || httpStatus === 401 || httpStatus === 403;
    super(
      `RDS for MySQL API 오류 (${sanitizeForTerminal(String(resultCode))}): ${sanitizeForTerminal(resultMessage)}`,
      isAuthError ? EXIT_AUTH_ERROR : EXIT_API_ERROR,
    );
    this.name = "RdsMysqlApiError";
    this.resultCode = resultCode;
    this.httpStatus = httpStatus;
  }
}
