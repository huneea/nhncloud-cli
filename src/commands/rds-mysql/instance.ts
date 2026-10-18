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

const listCommand = withRdsMysqlOptions(new Command("list").description("DB 인스턴스 목록을 조회한다")).action(
  async (_opts: unknown, command: Command) => {
    const opts = command.optsWithGlobals<RdsMysqlCommandOptions>();
    const { client } = await resolveRdsMysqlClient(opts);

    const instances = await withRdsMysqlSpinner("DB 인스턴스 목록 조회 중...", () => client.listDbInstances());
    output(opts, {
      headers: ["dbInstanceId", "dbInstanceName", "dbVersion", "dbInstanceType", "dbInstanceStatus", "progressStatus"],
      rows: instances.map((i) => [
        formatCell(i.dbInstanceId), formatCell(i.dbInstanceName), formatCell(i.dbVersion),
        formatCell(i.dbInstanceType), formatCell(i.dbInstanceStatus), formatCell(i.progressStatus),
      ]),
      raw: instances,
      ids: instances.map((i) => i.dbInstanceId),
    });
  },
);

const getCommand = withRdsMysqlOptions(
  new Command("get").description("DB 인스턴스 상세를 조회한다").argument("<db-instance-id>", "DB 인스턴스 ID (UUID)"),
).action(async (dbInstanceId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<RdsMysqlCommandOptions>();
  const parsedId = parseUuidArgument(dbInstanceId, "<db-instance-id>");
  const { client } = await resolveRdsMysqlClient(opts);

  const instance = await withRdsMysqlSpinner(`DB 인스턴스 ${parsedId} 조회 중...`, () => client.getDbInstance(parsedId));
  output(opts, {
    headers: ["field", "value"],
    rows: Object.entries(instance).map(([key, value]) => [formatCell(key), formatCell(value)]),
    raw: instance,
    ids: [instance.dbInstanceId],
  });
});

export const instanceCommand = new Command("instance")
  .description("DB 인스턴스 조회 명령")
  .addCommand(listCommand)
  .addCommand(getCommand);
