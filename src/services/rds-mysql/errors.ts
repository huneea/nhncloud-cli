import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR, EXIT_AUTH_ERROR } from "../../utils/exit-codes.js";
import { sanitizeForTerminal } from "../../utils/terminal.js";

/** 공식 문서의 인증 실패(80401), 권한 없음(80403) 결과 코드다 (ADR-046). */
const AUTH_RESULT_CODES: ReadonlySet<number> = new Set([80401, 80403]);

/**
 * 서버가 봉투 header 로 알린 RDS for MySQL 실패다.
 * resultCode 는 number 나 string 으로 올 수 있어 Number() 로 바꿔 인증 오류를 가른다.
 */
export class RdsMysqlApiError extends NhnCloudCliError {
  readonly resultCode: number | string;

  constructor(resultCode: number | string, resultMessage: string, httpStatus?: number) {
    const isAuthError =
      AUTH_RESULT_CODES.has(Number(resultCode)) || httpStatus === 401 || httpStatus === 403;
    super(
      `RDS for MySQL API 오류 (${sanitizeForTerminal(String(resultCode))}): ${sanitizeForTerminal(resultMessage)}`,
      isAuthError ? EXIT_AUTH_ERROR : EXIT_API_ERROR,
    );
    this.name = "RdsMysqlApiError";
    this.resultCode = resultCode;
  }
}
