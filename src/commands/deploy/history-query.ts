import type { DeployClient } from "../../services/deploy/client.js";
import type { DeployHistory, DeployHistoryPage, DeployHistoryParams } from "../../services/deploy/types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";

/** `--result` 로 고를 수 있는 값. API 응답의 totalResult 와 대소문자 무시로 비교한다 */
export const HISTORY_RESULTS = ["success", "fail", "running"] as const;
export type HistoryResult = (typeof HISTORY_RESULTS)[number];

/** 페이지당 건수 API 기본값(공식 문서) */
export const DEFAULT_PAGE_SIZE = 20;
/** 페이지당 건수 상한. 문서에는 없고 실측(2026-11)에서 101 이상은 요청 오류였다 */
export const MAX_PAGE_SIZE = 100;
/** 여러 페이지를 모을 때 한 번에 받는 건수 */
export const SCAN_PAGE_SIZE = MAX_PAGE_SIZE;
/** 응답이 끝나지 않을 때 끊는 페이지 수. 1년 범위에서도 닿지 않을 만큼 크게 둔다 */
export const MAX_SCAN_PAGES = 1000;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** yyyy-MM-dd 를 UTC 자정 Date 로 읽는다. 형식이 틀리거나 없는 날짜면 입력 오류다 */
export function parseDateOption(value: string, flag: string): Date {
  const match = DATE_PATTERN.exec(value);
  const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : undefined;
  if (!match || !date || formatDate(date) !== value) {
    throw new NhnCloudCliError(
      `${flag} 는 yyyy-MM-dd 형식의 날짜여야 합니다 (입력: ${JSON.stringify(value)}).`,
      EXIT_PARAM_ERROR,
    );
  }
  return date;
}

export function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** 로컬 시간대의 오늘을 UTC 자정 Date 로 만든다. API 기본값 「현재일」 과 맞추려는 것이다 */
export function localToday(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/** 같은 일자의 n개월 전·후. 그 달에 없는 일자면 그 달 말일로 맞춘다 */
function addMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)));
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * 조회 기간을 정한다.
 * 둘 다 없으면 쿼리를 보내지 않아 API 기본값(최근 1개월)을 쓴다.
 * 하나만 있으면 빠진 쪽을 채운다: 종료일은 오늘, 시작일은 종료일의 1개월 전이다.
 * API 의 시작일 기본값은 「오늘 - 1개월」 이라 과거 종료일만 주면 시작일이 더 늦어지기 때문이다.
 * 시작일이 종료일보다 늦거나 기간이 1년에 닿으면 요청 전에 거부한다.
 */
export function resolveHistoryRange(
  fromOpt: string | undefined,
  toOpt: string | undefined,
  today: Date = localToday(),
): { from?: string; to?: string } {
  if (fromOpt === undefined && toOpt === undefined) return {};

  const to = toOpt !== undefined ? parseDateOption(toOpt, "--to") : today;
  const from = fromOpt !== undefined ? parseDateOption(fromOpt, "--from") : addMonths(to, -1);

  if (from.getTime() > to.getTime()) {
    throw new NhnCloudCliError(
      `--from(${formatDate(from)}) 이 --to(${formatDate(to)}) 보다 늦습니다.`,
      EXIT_PARAM_ERROR,
    );
  }
  // 실측(2026-11): 종료일의 1년 전과 같거나 이른 시작일은 API 가 거부한다(시작 2025-11-03·종료 2026-11-03 은 거부, 시작 2025-11-04 는 허용).
  if (from.getTime() <= addMonths(to, -12).getTime()) {
    throw new NhnCloudCliError(
      `배포 이력 조회 기간은 1년보다 짧아야 합니다 (${formatDate(from)} ~ ${formatDate(to)}). --from 은 ${formatDate(addDays(addMonths(to, -12), 1))} 부터 쓸 수 있습니다.`,
      EXIT_PARAM_ERROR,
    );
  }
  return { from: formatDate(from), to: formatDate(to) };
}

export function parseResultOption(value: string | undefined): HistoryResult | undefined {
  if (value === undefined) return undefined;
  const normalized = value.toLowerCase();
  if (!(HISTORY_RESULTS as readonly string[]).includes(normalized)) {
    throw new NhnCloudCliError(
      `--result 는 ${HISTORY_RESULTS.join(", ")} 중 하나여야 합니다 (입력: ${JSON.stringify(value)}).`,
      EXIT_PARAM_ERROR,
    );
  }
  return normalized as HistoryResult;
}

export function matchesResult(history: DeployHistory, result: HistoryResult | undefined): boolean {
  return result === undefined || history.totalResult.toLowerCase() === result;
}

/**
 * 기간 안의 배포 이력을 페이지 단위로 모은다.
 * stop 이 true 를 돌려주면 남은 페이지를 받지 않는다(--deploy-key 로 한 건을 찾을 때).
 * totalCount 는 첫 페이지 응답 값을 그대로 쓴다.
 */
export async function scanHistories(
  client: Pick<DeployClient, "histories">,
  appKey: string,
  artifactId: string,
  params: Omit<DeployHistoryParams, "pageNum">,
  stop: (history: DeployHistory) => boolean = () => false,
): Promise<DeployHistoryPage & { complete: boolean }> {
  const pageSize = params.pageSize ?? SCAN_PAGE_SIZE;
  const collected: DeployHistory[] = [];
  let totalCount = 0;

  for (let pageNum = 1; pageNum <= MAX_SCAN_PAGES; pageNum++) {
    const page = await client.histories(appKey, artifactId, { ...params, pageNum, pageSize });
    if (pageNum === 1) totalCount = page.totalCount;
    for (const history of page.deployHistories) {
      collected.push(history);
      if (stop(history)) return { totalCount, deployHistories: collected, complete: true };
    }
    if (page.deployHistories.length < pageSize || collected.length >= totalCount) {
      return { totalCount, deployHistories: collected, complete: true };
    }
  }
  return { totalCount, deployHistories: collected, complete: false };
}
