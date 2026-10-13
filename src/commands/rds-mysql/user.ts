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
  new Command("list")
    .description("DB 사용자 목록을 조회한다. 권한은 인스턴스의 모든 스키마에 적용된다")
    .argument("<db-instance-id>", "DB 인스턴스 ID (UUID)"),
).action(async (dbInstanceId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<RdsMysqlCommandOptions>();
  const parsedId = parseUuidArgument(dbInstanceId, "<db-instance-id>");
  const { client } = await resolveRdsMysqlClient(opts);

  const users = await withRdsMysqlSpinner(`DB 사용자 목록 조회 중 (${parsedId})...`, () =>
    client.listDbUsers(parsedId),
  );
  output(opts, {
    headers: [
      "dbUserId", "dbUserName", "host", "authorityType", "dbUserStatus", "authenticationPlugin", "tlsOption",
    ],
    rows: users.map((u) => [
      formatCell(u.dbUserId), formatCell(u.dbUserName), formatCell(u.host), formatCell(u.authorityType),
      formatCell(u.dbUserStatus), formatCell(u.authenticationPlugin), formatCell(u.tlsOption),
    ]),
    raw: users,
    ids: users.map((u) => u.dbUserId),
  });
});

export const userCommand = new Command("user").description("DB 사용자 조회 명령").addCommand(listCommand);
