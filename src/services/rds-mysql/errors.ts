import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR, EXIT_AUTH_ERROR } from "../../utils/exit-codes.js";
import { sanitizeForTerminal } from "../../utils/terminal.js";

/**
 * 인증 실패와 권한 없음 결과 코드다 (ADR-046).
 * 문서는 80401·80403 을 싣지만, 실호출에서 잘못된 UAK 는 HTTP 200 과 resultCode 401 로 왔다.
 */
const AUTH_RESULT_CODES: ReadonlySet<number> = new Set([80401, 80403, 401, 403]);

/**
 * 앱키가 없거나 RDS for MySQL 이 인식하지 못하는 값이면 HTTP 200 봉투에 resultCode 500 이 온다 (ADR-046).
 * 서버 오류와 구분되지 않아 원인을 단정하지 않고 확인할 곳만 알린다.
 * 쓰기 요청은 사전 조회를 거친 뒤라 앱키가 원인일 가능성이 낮아 조회 요청에만 붙인다.
 */
const APPKEY_HINT_RESULT_CODE = 500;
const APPKEY_HINT =
  "앱키가 잘못돼도 이 오류가 올 수 있습니다. 모든 명령이 같은 오류로 끝나면 profile 의 rds-mysql.appkey 가 RDS for MySQL 서비스나 프로젝트 통합 앱키인지 확인하세요.";

/**
 * 서버가 봉투 header 로 알린 RDS for MySQL 실패다.
 * resultCode 는 number 나 string 으로 올 수 있어 Number() 로 바꿔 인증 오류를 가른다.
 */
export class RdsMysqlApiError extends NhnCloudCliError {
  readonly resultCode: number | string;
  /** 봉투를 HTTP 오류 응답 본문에서 읽었으면 그 상태 코드다. HTTP 200 봉투 실패면 undefined 다. */
  readonly httpStatus?: number;
  /** 안내 줄을 뺀 한 줄 문구다. 다른 문장 안에 넣을 때 쓴다. */
  readonly summary: string;

  constructor(
    resultCode: number | string,
    resultMessage: string,
    httpStatus?: number,
    opts: { readRequest?: boolean } = {},
  ) {
    const isAuthError =
      AUTH_RESULT_CODES.has(Number(resultCode)) || httpStatus === 401 || httpStatus === 403;
    const summary = `RDS for MySQL API 오류 (${sanitizeForTerminal(String(resultCode))}): ${sanitizeForTerminal(resultMessage)}`;
    const appkeyHint =
      opts.readRequest === true && httpStatus === undefined && Number(resultCode) === APPKEY_HINT_RESULT_CODE
        ? `\n${APPKEY_HINT}`
        : "";
    super(`${summary}${appkeyHint}`, isAuthError ? EXIT_AUTH_ERROR : EXIT_API_ERROR);
    this.name = "RdsMysqlApiError";
    this.resultCode = resultCode;
    this.httpStatus = httpStatus;
    this.summary = summary;
  }
}
