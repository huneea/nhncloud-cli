import { Command } from "commander";
import { output } from "../../formatters/table.js";
import type { RdsMysqlClient } from "../../services/rds-mysql/client.js";
import type { RdsMysqlDbUser, RdsMysqlDbUserUpdateInput } from "../../services/rds-mysql/types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import {
  applyRdsMysqlWrite,
  checkInstanceForWrite,
  formatCell,
  outputRdsMysqlWriteResult,
  parseAuthorityOption,
  parseAuthPluginOption,
  parseDbUserHost,
  parseDbUserName,
  parseTlsOption,
  parseUuidArgument,
  parseWaitOptions,
  type RdsMysqlCommandOptions,
  type RdsMysqlWriteOptions,
  type RdsMysqlWriteResult,
  readDbUserPassword,
  resolveRdsMysqlClient,
  withRdsMysqlOptions,
  withRdsMysqlSpinner,
  withRdsMysqlWriteOptions,
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

function listDbUsers(client: RdsMysqlClient, dbInstanceId: string): Promise<RdsMysqlDbUser[]> {
  return withRdsMysqlSpinner(`DB 사용자 목록 조회 중 (${dbInstanceId})...`, () => client.listDbUsers(dbInstanceId));
}

async function findDbUser(client: RdsMysqlClient, dbInstanceId: string, dbUserId: string): Promise<RdsMysqlDbUser> {
  const user = (await listDbUsers(client, dbInstanceId)).find((u) => u.dbUserId === dbUserId);
  if (user === undefined) {
    throw new NhnCloudCliError(
      `DB 사용자를 찾을 수 없습니다: ${dbUserId}. nhncloud rds-mysql user list ${dbInstanceId}로 dbUserId를 확인하세요.`,
      EXIT_PARAM_ERROR,
    );
  }
  return user;
}

function userTarget(name: string, host: string): string {
  return `'${name}'@'${host}'`;
}

interface UserCreateOptions extends RdsMysqlWriteOptions {
  name: string;
  host: string;
  authority: string;
  authPlugin?: string;
  tls?: string;
  passwordFile?: string;
}

const createCommand = withRdsMysqlWriteOptions(
  new Command("create")
    .description(
      "DB 사용자를 만든다. 비밀번호는 --password-file이나 표준 입력으로 받고, 권한은 인스턴스의 모든 스키마에 적용된다. --yes가 없으면 미리보기만 한다",
    )
    .argument("<db-instance-id>", "DB 인스턴스 ID (UUID)")
    .requiredOption("--name <user>", "만들 DB 사용자 이름")
    .requiredOption("--host <host>", "접속 허용 host (% 로 범위 지정, 예: 10.0.0.%)")
    .requiredOption("--authority <type>", "권한 (read|crud|ddl|all), 인스턴스의 모든 스키마에 적용")
    .option("--auth-plugin <plugin>", "인증 플러그인 (native|caching-sha2|sha256)")
    .option("--tls <option>", "TLS 옵션 (none|ssl|x509)")
    .option("--password-file <path>", "비밀번호를 읽을 파일. 없으면 표준 입력에서 읽는다"),
).action(async (dbInstanceId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<UserCreateOptions>();
  const parsedId = parseUuidArgument(dbInstanceId, "<db-instance-id>");
  const name = parseDbUserName(opts.name);
  const host = parseDbUserHost(opts.host);
  const authorityType = parseAuthorityOption(opts.authority);
  const authPlugin = parseAuthPluginOption(opts.authPlugin);
  const tls = parseTlsOption(opts.tls);
  const wait = parseWaitOptions(opts);
  const password = readDbUserPassword(opts.passwordFile);
  const { client } = await resolveRdsMysqlClient(opts);

  await checkInstanceForWrite(client, parsedId, authPlugin !== undefined || tls !== undefined);
  const target = userTarget(name, host);
  const users = await listDbUsers(client, parsedId);
  if (users.some((u) => u.dbUserName === name && u.host === host)) {
    throw new NhnCloudCliError(`이미 있는 DB 사용자입니다: ${target}`, EXIT_PARAM_ERROR);
  }

  // 비밀번호는 요청 본문에만 넣고 결과 객체에는 두지 않는다 (ADR-047).
  await applyRdsMysqlWrite(
    opts,
    wait,
    client,
    {
      operation: "user-create",
      dbInstanceId: parsedId,
      target,
      dbUserId: null,
      authorityType,
      previousAuthorityType: null,
      authenticationPlugin: authPlugin ?? null,
      tlsOption: tls ?? null,
      action: "create",
      applied: false,
      jobId: null,
      jobStatus: null,
    },
    () =>
      client.createDbUser(parsedId, {
        dbUserName: name,
        dbPassword: password,
        host,
        authorityType,
        ...(authPlugin === undefined ? {} : { authenticationPlugin: authPlugin }),
        ...(tls === undefined ? {} : { tlsOption: tls }),
      }),
    `nhncloud rds-mysql user list ${parsedId}`,
  );
});

interface UserUpdateOptions extends RdsMysqlWriteOptions {
  authority: string;
}

const updateCommand = withRdsMysqlWriteOptions(
  new Command("update")
    .description("DB 사용자 권한을 바꾼다. --yes가 없으면 미리보기만 한다")
    .argument("<db-instance-id>", "DB 인스턴스 ID (UUID)")
    .argument("<db-user-id>", "DB 사용자 ID (UUID)")
    .requiredOption("--authority <type>", "권한 (read|crud|ddl|all), 인스턴스의 모든 스키마에 적용"),
).action(async (dbInstanceId: string, dbUserId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<UserUpdateOptions>();
  const parsedId = parseUuidArgument(dbInstanceId, "<db-instance-id>");
  const parsedUserId = parseUuidArgument(dbUserId, "<db-user-id>");
  const authorityType = parseAuthorityOption(opts.authority);
  const wait = parseWaitOptions(opts);
  const { client } = await resolveRdsMysqlClient(opts);

  const instance = await checkInstanceForWrite(client, parsedId, false);
  const user = await findDbUser(client, parsedId, parsedUserId);
  // 생략 필드 동작이 문서에 없어 현재 인증 플러그인과 TLS 옵션을 함께 보낸다. 비밀번호는 보내지 않는다 (ADR-047).
  const body: RdsMysqlDbUserUpdateInput = { authorityType };
  if (instance.supportAuthenticationPlugin !== false) {
    if (typeof user.authenticationPlugin === "string") body.authenticationPlugin = user.authenticationPlugin;
    if (typeof user.tlsOption === "string") body.tlsOption = user.tlsOption;
  }

  const unchanged = user.authorityType === authorityType;
  const result: RdsMysqlWriteResult = {
    operation: "user-update",
    dbInstanceId: parsedId,
    target: userTarget(user.dbUserName, user.host),
    dbUserId: parsedUserId,
    authorityType,
    previousAuthorityType: user.authorityType,
    authenticationPlugin: body.authenticationPlugin ?? null,
    tlsOption: body.tlsOption ?? null,
    action: unchanged ? "unchanged" : "update",
    applied: false,
    jobId: null,
    jobStatus: null,
  };

  if (unchanged) {
    outputRdsMysqlWriteResult(opts, result);
    process.stderr.write(`권한이 이미 ${authorityType}라 요청하지 않았습니다.\n`);
    return;
  }
  if (user.authorityType === "CUSTOM") {
    process.stderr.write("경고: 현재 권한이 CUSTOM입니다. 바꾸면 다시 CUSTOM으로 되돌릴 수 없습니다.\n");
  }

  await applyRdsMysqlWrite(
    opts,
    wait,
    client,
    result,
    () => client.updateDbUser(parsedId, parsedUserId, body),
    `nhncloud rds-mysql user list ${parsedId}`,
  );
});

const deleteCommand = withRdsMysqlWriteOptions(
  new Command("delete")
    .description("DB 사용자를 지운다. --yes가 없으면 미리보기만 한다")
    .argument("<db-instance-id>", "DB 인스턴스 ID (UUID)")
    .argument("<db-user-id>", "DB 사용자 ID (UUID)"),
).action(async (dbInstanceId: string, dbUserId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<RdsMysqlWriteOptions>();
  const parsedId = parseUuidArgument(dbInstanceId, "<db-instance-id>");
  const parsedUserId = parseUuidArgument(dbUserId, "<db-user-id>");
  const wait = parseWaitOptions(opts);
  const { client } = await resolveRdsMysqlClient(opts);

  await checkInstanceForWrite(client, parsedId, false);
  const user = await findDbUser(client, parsedId, parsedUserId);

  await applyRdsMysqlWrite(
    opts,
    wait,
    client,
    {
      operation: "user-delete",
      dbInstanceId: parsedId,
      target: userTarget(user.dbUserName, user.host),
      dbUserId: parsedUserId,
      authorityType: user.authorityType,
      previousAuthorityType: null,
      authenticationPlugin: null,
      tlsOption: null,
      action: "delete",
      applied: false,
      jobId: null,
      jobStatus: null,
    },
    () => client.deleteDbUser(parsedId, parsedUserId),
    `nhncloud rds-mysql user list ${parsedId}`,
  );
});

export const userCommand = new Command("user")
  .description("DB 사용자 조회와 생성, 권한 변경, 삭제 명령")
  .addCommand(listCommand)
  .addCommand(createCommand)
  .addCommand(updateCommand)
  .addCommand(deleteCommand);
