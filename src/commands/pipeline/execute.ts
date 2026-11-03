import { Command } from "commander";
import { pipelineHost } from "../../api/endpoints.js";
import { output } from "../../formatters/table.js";
import { PipelineClient } from "../../services/pipeline/client.js";
import { startSpinner, stopSpinner } from "../../utils/spinner.js";
import { sanitizeForTerminal } from "../../utils/terminal.js";
import { parseRequiredArgument } from "../parse-options.js";
import {
  issuePipelineToken,
  requireWriteMode,
  resolvePipelineAppKey,
  resolvePipelineProfile,
  resolvePipelineUak,
  type PipelineExecuteOptions,
} from "./helpers.js";

export const executeCommand = new Command("execute")
  .description("Pipeline 을 수동 실행한다")
  .argument("<pipeline-name>", "실행할 Pipeline 이름")
  .option("--region <region>", "Pipeline region (kr1, kr3. 공공망은 kr1)", "kr1")
  .option("--profile <name>", "사용할 profile 이름")
  .option("--yes", "확인 없이 실행한다")
  .option("--dry-run", "실행 없이 보낼 요청을 출력한다")
  .action(async (pipelineNameArg: string, _opts: unknown, command: Command) => {
    const opts = command.optsWithGlobals<PipelineExecuteOptions>();
    // 검증 순서: 인수 → --yes/--dry-run → profile → region → appkey → (dry-run 종료) → UAK → 진행 표시 → 토큰 → 실행.
    const pipelineName = parseRequiredArgument(pipelineNameArg, "pipeline-name");
    const dryRun = requireWriteMode(opts, "pipeline execute");
    const { profileName, environment } = await resolvePipelineProfile(opts);
    const region = opts.region;
    pipelineHost(region, environment);
    const appKey = await resolvePipelineAppKey(profileName);

    if (dryRun) {
      const request = new PipelineClient("", appKey, region, environment).buildExecuteRequest(pipelineName);
      output(opts, {
        headers: ["method", "url", "region", "pipeline"],
        rows: [[request.method, request.url, request.region, sanitizeForTerminal(pipelineName)]],
        raw: { operation: "pipeline-execute", dry_run: true, requests: [{ ...request, pipelineName }] },
        ids: [],
      });
      return;
    }

    const uak = await resolvePipelineUak(profileName);
    startSpinner("Pipeline 실행 요청 중...");
    let result;
    try {
      const token = await issuePipelineToken(profileName, environment, uak);
      result = await new PipelineClient(token, appKey, region, environment).execute(pipelineName);
      stopSpinner(true);
    } catch (error) {
      stopSpinner(false);
      throw error;
    }

    const id = sanitizeForTerminal(result.lastExecutionId);
    output(opts, {
      headers: ["pipeline", "region", "lastExecutionId"],
      rows: [[sanitizeForTerminal(pipelineName), region, id]],
      raw: result,
      ids: [id],
    });
  });
