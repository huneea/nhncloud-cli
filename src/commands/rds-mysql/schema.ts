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

const listCommand = withRdsMysqlOptions(
  new Command("list").description("DB 스키마 목록을 조회한다").argument("<db-instance-id>", "DB 인스턴스 ID (UUID)"),
).action(async (dbInstanceId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<RdsMysqlCommandOptions>();
  const parsedId = parseUuidArgument(dbInstanceId, "<db-instance-id>");
  const { client } = await resolveRdsMysqlClient(opts);

  const schemas = await withRdsMysqlSpinner(`DB 스키마 목록 조회 중 (${parsedId})...`, () =>
    client.listDbSchemas(parsedId),
  );
  output(opts, {
    headers: ["dbSchemaId", "dbSchemaName", "dbSchemaStatus", "createdYmdt"],
    rows: schemas.map((s) => [
      formatCell(s.dbSchemaId), formatCell(s.dbSchemaName), formatCell(s.dbSchemaStatus), formatCell(s.createdYmdt),
    ]),
    raw: schemas,
    ids: schemas.map((s) => s.dbSchemaName),
  });
});

export const schemaCommand = new Command("schema").description("DB 스키마 조회 명령").addCommand(listCommand);
