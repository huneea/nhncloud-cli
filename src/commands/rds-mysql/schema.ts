import { Command } from "commander";
import { output } from "../../formatters/table.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import {
  applyRdsMysqlWrite,
  checkInstanceForWrite,
  formatCell,
  parseSchemaName,
  parseUuidArgument,
  parseWaitOptions,
  type RdsMysqlCommandOptions,
  type RdsMysqlWriteOptions,
  resolveRdsMysqlClient,
  withRdsMysqlOptions,
  withRdsMysqlSpinner,
  withRdsMysqlWriteOptions,
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

interface SchemaCreateOptions extends RdsMysqlWriteOptions {
  name: string;
}

const createCommand = withRdsMysqlWriteOptions(
  new Command("create")
    .description("DB 스키마를 만든다. --yes가 없으면 미리보기만 한다")
    .argument("<db-instance-id>", "DB 인스턴스 ID (UUID)")
    .requiredOption("--name <schema>", "만들 DB 스키마 이름"),
).action(async (dbInstanceId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<SchemaCreateOptions>();
  const parsedId = parseUuidArgument(dbInstanceId, "<db-instance-id>");
  const name = parseSchemaName(opts.name);
  const wait = parseWaitOptions(opts);
  const { client } = await resolveRdsMysqlClient(opts);

  await checkInstanceForWrite(client, parsedId, false);
  const schemas = await withRdsMysqlSpinner(`DB 스키마 목록 조회 중 (${parsedId})...`, () =>
    client.listDbSchemas(parsedId),
  );
  if (schemas.some((s) => s.dbSchemaName === name)) {
    throw new NhnCloudCliError(`이미 있는 DB 스키마입니다: ${name}`, EXIT_PARAM_ERROR);
  }

  await applyRdsMysqlWrite(
    opts,
    wait,
    client,
    {
      operation: "schema-create",
      dbInstanceId: parsedId,
      target: name,
      dbUserId: null,
      authorityType: null,
      previousAuthorityType: null,
      authenticationPlugin: null,
      tlsOption: null,
      action: "create",
      applied: false,
      jobId: null,
      jobStatus: null,
    },
    () => client.createDbSchema(parsedId, name),
    `nhncloud rds-mysql schema list ${parsedId}`,
  );
});

export const schemaCommand = new Command("schema")
  .description("DB 스키마 조회와 생성 명령")
  .addCommand(listCommand)
  .addCommand(createCommand);
