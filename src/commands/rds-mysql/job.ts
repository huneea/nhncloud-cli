import { Command } from "commander";
import { output } from "../../formatters/table.js";
import {
  formatCell,
  parseUuidArgument,
  type RdsMysqlCommandOptions,
  resolveRdsMysqlClient,
  withRdsMysqlOptions,
  withRdsMysqlSpinner,
} from "./helpers.js";

const getCommand = withRdsMysqlOptions(
  new Command("get").description("비동기 작업 상태를 조회한다").argument("<job-id>", "작업 ID (UUID)"),
).action(async (jobId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<RdsMysqlCommandOptions>();
  const parsedId = parseUuidArgument(jobId, "<job-id>");
  const { client } = await resolveRdsMysqlClient(opts);

  const job = await withRdsMysqlSpinner(`작업 ${parsedId} 조회 중...`, () => client.getJob(parsedId));
  const relations = (job.resourceRelations ?? []).map((r) => `${formatCell(r.resourceType)}:${formatCell(r.resourceId)}`);
  output(opts, {
    headers: ["field", "value"],
    rows: [
      ["jobId", formatCell(job.jobId)],
      ["jobStatus", formatCell(job.jobStatus)],
      ["resourceRelations", relations.length > 0 ? relations.join(",") : "-"],
      ["createdYmdt", formatCell(job.createdYmdt)],
      ["updatedYmdt", formatCell(job.updatedYmdt)],
    ],
    raw: job,
    ids: [job.jobStatus],
  });
});

export const jobCommand = new Command("job").description("비동기 작업 조회 명령").addCommand(getCommand);
