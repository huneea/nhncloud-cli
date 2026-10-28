import { output, type OutputOptions } from "../formatters/table.js";
import { NhnCloudCliError } from "../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../utils/exit-codes.js";

// Load Balancer 와 Private DNS 쓰기 명령이 함께 쓰는 확인·미리보기 도우미 (ADR-048, ADR-049).

export interface WriteModeOpts {
  yes?: boolean;
  dryRun?: boolean;
}

export interface PlannedRequest {
  method: "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
}

/** `--dry-run` 이면 true, 아니면 `--yes` 를 API 호출 전에 요구한다. */
export function requireWriteMode(opts: WriteModeOpts, operation: string): boolean {
  if (opts.dryRun) return true;
  if (!opts.yes) {
    throw new NhnCloudCliError(
      `${operation}에는 --yes 플래그가 필요합니다. 보낼 요청만 보려면 --dry-run 을 쓰세요.`,
      EXIT_PARAM_ERROR,
    );
  }
  return false;
}

export function outputDryRun(
  opts: OutputOptions,
  operation: string,
  requests: PlannedRequest[],
): void {
  output(opts, {
    headers: ["method", "path", "body"],
    rows: requests.map((request) => [
      request.method,
      request.path,
      request.body === undefined ? "" : JSON.stringify(request.body, null, 2),
    ]),
    raw: { operation, dry_run: true, requests },
    ids: [],
  });
}
