import { Command } from "commander";
import { output } from "../../formatters/table.js";
import type { SkmAuthDetail, SkmKeyStore } from "../../services/skm/types.js";
import { startSpinner, stopSpinner } from "../../utils/spinner.js";
import {
  formatCell,
  maskAuthDetail,
  parseAuthTypeOption,
  parseKeyStoreId,
  parseMacAddressOption,
  resolveSkmClient,
  type SkmCommandOptions,
  withSkmOptions,
} from "./helpers.js";
import { parseRequiredArgument } from "../parse-options.js";

interface AuthOptions extends SkmCommandOptions {
  type: string;
}

async function withSpinner<T>(message: string, task: () => Promise<T>): Promise<T> {
  startSpinner(message);
  try {
    const result = await task();
    stopSpinner(true);
    return result;
  } catch (err) {
    stopSpinner(false);
    throw err;
  }
}

const KEYSTORE_FIELDS: ReadonlyArray<keyof SkmKeyStore> = [
  "keyStoreId", "name", "description", "ip4AuthUse", "macAuthUse", "certificateAuthUse",
  "creationUser", "creationDatetime", "lastChangeUser", "lastChangeDatetime",
];

const listCommand = withSkmOptions(new Command("list").description("키 저장소 목록을 조회한다 (전체 필드는 --json)"))
  .action(async (_opts: unknown, command: Command) => {
    const opts = command.optsWithGlobals<SkmCommandOptions>();
    const macAddress = parseMacAddressOption(opts.macAddress);
    const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

    const stores = await withSpinner("SKM 키 저장소 목록 조회 중...", () => client.listKeyStores());
    output(opts, {
      headers: ["keyStoreId", "name", "ip4AuthUse", "macAuthUse", "certificateAuthUse", "lastChangeDatetime"],
      rows: stores.map((s) => [
        formatCell(s.keyStoreId), formatCell(s.name), formatCell(s.ip4AuthUse), formatCell(s.macAuthUse),
        formatCell(s.certificateAuthUse), formatCell(s.lastChangeDatetime),
      ]),
      raw: stores,
      ids: stores.map((s) => String(s.keyStoreId)),
    });
  });

const getCommand = withSkmOptions(
  new Command("get").description("키 저장소 한 건을 조회한다").argument("<keystore-id>", "키 저장소 ID"),
).action(async (keyStoreId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<SkmCommandOptions>();
  const parsedId = parseKeyStoreId(keyStoreId);
  const macAddress = parseMacAddressOption(opts.macAddress);
  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  const store = await withSpinner(`SKM 키 저장소 ${parsedId} 조회 중...`, () => client.getKeyStore(parsedId));
  output(opts, {
    headers: ["field", "value"],
    rows: KEYSTORE_FIELDS.map((field) => [field, formatCell(store[field])]),
    raw: store,
    ids: [String(store.keyStoreId)],
  });
});

function withTypeOption(command: Command): Command {
  return command.requiredOption("--type <type>", "인증 정보 종류 (ipv4|mac|certificate)");
}

const authListCommand = withTypeOption(
  withSkmOptions(
    new Command("list").description("키 저장소 인증 정보 값 목록을 조회한다").argument("<keystore-id>", "키 저장소 ID"),
  ),
).action(async (keyStoreId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<AuthOptions>();
  const parsedId = parseKeyStoreId(keyStoreId);
  const type = parseAuthTypeOption(opts.type);
  const macAddress = parseMacAddressOption(opts.macAddress);
  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  const values = await withSpinner(`SKM ${type} 인증 정보 목록 조회 중...`, () => client.listAuths(parsedId, type));
  output(opts, {
    headers: ["value"],
    rows: values.map((v) => [formatCell(v)]),
    raw: values,
    ids: values.map((v) => formatCell(v)),
  });
});

const authGetCommand = withTypeOption(
  withSkmOptions(
    new Command("get")
      .description("키 저장소 인증 정보 상세를 조회한다 (인증서 비밀번호는 가린다)")
      .argument("<keystore-id>", "키 저장소 ID")
      .argument("<value>", "IPv4·MAC 값 또는 인증서 이름"),
  ),
).action(async (keyStoreId: string, value: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<AuthOptions>();
  const parsedId = parseKeyStoreId(keyStoreId);
  const parsedValue = parseRequiredArgument(value, "value");
  const type = parseAuthTypeOption(opts.type);
  const macAddress = parseMacAddressOption(opts.macAddress);
  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  const details = await withSpinner(`SKM ${type} 인증 정보 조회 중...`, () =>
    client.getAuth(parsedId, type, parsedValue),
  );
  const masked: SkmAuthDetail[] = details.map(maskAuthDetail);
  const keys = masked.map((d) => formatCell(d.value ?? d.name));
  output(opts, {
    headers: ["value", "description", "expirationDate", "lastAccessDatetime", "deletionDatetime", "lastChangeDatetime"],
    rows: masked.map((d, i) => [
      keys[i] ?? "-", formatCell(d.description), formatCell(d.expirationDate),
      formatCell(d.lastAccessDatetime), formatCell(d.deletionDatetime), formatCell(d.lastChangeDatetime),
    ]),
    raw: masked,
    ids: keys,
  });
});

const authCommand = new Command("auth")
  .description("키 저장소 IPv4·MAC·인증서 인증 정보 조회")
  .addCommand(authListCommand)
  .addCommand(authGetCommand);

export const keystoreCommand = new Command("keystore")
  .description("SKM 키 저장소와 인증 정보 조회")
  .addCommand(listCommand)
  .addCommand(getCommand)
  .addCommand(authCommand);
