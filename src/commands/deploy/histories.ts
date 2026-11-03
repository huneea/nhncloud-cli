import { Command } from "commander";
import { startSpinner, stopSpinner } from "../../utils/spinner.js";
import { output, type OutputOptions } from "../../formatters/table.js";
import { cell, createDeployClient, requireCoordinate, resolveDeployAppKey } from "./helpers.js";
import { parseIntegerOption, parsePositiveIntegerOption } from "../parse-options.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import type { DeployHistory, DeployHistoryPage } from "../../services/deploy/types.js";
import {
  HISTORY_RESULTS,
  MAX_PAGE_SIZE,
  MAX_SCAN_PAGES,
  matchesResult,
  parseResultOption,
  resolveHistoryRange,
  scanHistories,
} from "./history-query.js";

interface HistoriesGlobalOpts extends OutputOptions {
  artifactId?: string;
  serverGroupId?: string;
  from?: string;
  to?: string;
  pageNum?: string;
  pageSize?: string;
  all?: boolean;
  result?: string;
  deployKey?: string;
  profile?: string;
}

function serverGroupLabel(history: DeployHistory): string {
  const name = cell(history.serverGroupName);
  const id = cell(history.serverGroupId);
  if (name && id) return `${name} (${id})`;
  return name || id;
}

export const historiesCommand = new Command("histories")
  .description("배포 이력을 조회한다 (서버별 결과와 Task 로그는 공개 API 가 없어 제공하지 않는다)")
  .option("--artifact-id <id>", "조회할 아티팩트 ID (artifacts 로 확인)")
  .option("--server-group-id <id>", "이 서버 그룹의 이력만 조회 (server-groups 로 확인)")
  .option("--from <yyyy-MM-dd>", "조회 시작일 (생략 시 --to 의 1개월 전, 둘 다 생략 시 최근 1개월)")
  .option("--to <yyyy-MM-dd>", "조회 종료일 (생략 시 오늘). 기간은 1년보다 짧아야 한다")
  .option("--page-num <n>", "페이지 번호 (기본 1)")
  .option("--page-size <n>", `페이지당 건수 (기본 20, 최대 ${MAX_PAGE_SIZE})`)
  .option("--all", "기간 안의 모든 페이지를 모은다")
  .option("--result <result>", `실행 결과로 필터링한다 (${HISTORY_RESULTS.join("|")}). API 에 결과 필터가 없어 받은 행을 CLI 가 필터링한다`)
  .option("--deploy-key <key>", "이 배포 키의 이력 한 건만 찾는다 (기간 안의 페이지를 차례로 찾는다)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (_opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<HistoriesGlobalOpts>();

    // ── 1. 입력 검증 (spinner 전, 자격증명 resolve 전 — fail-fast) ──
    const artifactId = requireCoordinate(opts.artifactId, "--artifact-id");
    const serverGroupId = parsePositiveIntegerOption(opts.serverGroupId, "--server-group-id");
    const pageNum = parsePositiveIntegerOption(opts.pageNum, "--page-num");
    const pageSize = parseIntegerOption(opts.pageSize, "--page-size", { min: 1, max: MAX_PAGE_SIZE });
    const deployKey = parsePositiveIntegerOption(opts.deployKey, "--deploy-key");
    const result = parseResultOption(opts.result);
    const range = resolveHistoryRange(opts.from, opts.to);
    const scan = opts.all === true || deployKey !== undefined;
    if (scan && pageNum !== undefined) {
      throw new NhnCloudCliError(
        "--page-num 은 --all 이나 --deploy-key 와 함께 쓸 수 없습니다.",
        EXIT_PARAM_ERROR,
      );
    }

    // ── 2. 인증 체인 + appKey 해석 (spinner 시작 전) ──
    const { client, profileName } = await createDeployClient(opts.profile);
    const appKey = await resolveDeployAppKey(profileName);

    // ── 3. API 호출 (spinner 내부, try/catch + leak 방지) ──
    startSpinner("배포 이력 조회 중...");

    const params = { serverGroupId, ...range, pageSize };
    let page: DeployHistoryPage;
    let complete = true;
    try {
      if (scan) {
        const scanned = await scanHistories(client, appKey, artifactId, params, (history) =>
          deployKey !== undefined && history.deployKey === deployKey,
        );
        page = scanned;
        complete = scanned.complete;
      } else {
        page = await client.histories(appKey, artifactId, { ...params, pageNum });
      }
    } catch (err) {
      stopSpinner(false);
      throw err;
    }

    stopSpinner(true);

    if (!complete) {
      process.stderr.write(
        `경고: ${MAX_SCAN_PAGES} 페이지까지만 모았습니다. --from/--to 로 기간을 줄여 다시 조회하세요.\n`,
      );
    }

    let rows = page.deployHistories.filter((history) => matchesResult(history, result));
    if (deployKey !== undefined) {
      rows = rows.filter((history) => history.deployKey === deployKey);
      if (rows.length === 0) {
        throw new NhnCloudCliError(
          `배포 키 ${deployKey} 의 이력을 찾을 수 없습니다. 기간(기본 최근 1개월)을 --from/--to 로 넓혀 보세요.`,
          EXIT_PARAM_ERROR,
        );
      }
    }

    // ── 4. 출력 ──
    // --json 은 응답 모양({ totalCount, deployHistories })을 유지한다. totalCount 는 API 가 준 기간 전체 건수다.
    output(opts, {
      headers: ["deployKey", "executeDate", "serverGroup", "scenario", "binaryVersion", "result", "executeUser"],
      rows: rows.map((history) => [
        cell(history.deployKey),
        cell(history.executeDate),
        serverGroupLabel(history),
        cell(history.scenarioName),
        cell(history.binaryVersion),
        cell(history.totalResult),
        cell(history.executeUser),
      ]),
      raw: { totalCount: page.totalCount, deployHistories: rows },
      ids: rows.map((history) => String(history.deployKey)),
    });

    if (!opts.json && !opts.quiet && !scan && page.deployHistories.length < page.totalCount) {
      const current = pageNum ?? 1;
      process.stderr.write(
        `전체 ${page.totalCount}건 중 ${current}페이지를 표시했습니다. 다음 페이지는 --page-num ${current + 1}, 전체는 --all 로 조회합니다.\n`,
      );
    }
  });
