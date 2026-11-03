import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR, EXIT_AUTH_ERROR } from "../../utils/exit-codes.js";
import { sanitizeForTerminal } from "../../utils/terminal.js";

/** 잘못된 앱키에 오는 결과 코드다. 문서 예시는 `4010001`(Invalid appKey) 하나뿐이다 (ADR-049). */
const AUTH_RESULT_CODES: ReadonlySet<number> = new Set([4010001]);

/** 서버가 봉투 header 로 알린 DNS Plus 실패다. HTTP 상태는 항상 200 이라 결과 코드로만 가른다. */
export class DnsplusApiError extends NhnCloudCliError {
  readonly resultCode: number | string;

  constructor(resultCode: number | string, resultMessage: string) {
    super(
      `DNS Plus API 오류 (${sanitizeForTerminal(String(resultCode))}): ${sanitizeForTerminal(resultMessage.trim())}`,
      AUTH_RESULT_CODES.has(Number(resultCode)) ? EXIT_AUTH_ERROR : EXIT_API_ERROR,
    );
    this.name = "DnsplusApiError";
    this.resultCode = resultCode;
  }
}
