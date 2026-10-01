import { Command } from "commander";
import { output } from "../../formatters/table.js";
import type { SkmKey } from "../../services/skm/types.js";
import { startSpinner, stopSpinner } from "../../utils/spinner.js";
import { parseRequiredArgument } from "../parse-options.js";
import {
  formatCell,
  parseKeyNameOption,
  parseKeyStatusOption,
  parseKeyStoreId,
  parseKeyTypeOption,
  parseMacAddressOption,
  resolveSkmClient,
  type SkmCommandOptions,
  withSkmOptions,
} from "./helpers.js";

interface KeyListOptions extends SkmCommandOptions {
  type?: string;
  name?: string;
  status?: string;
}

const KEY_FIELDS: ReadonlyArray<keyof SkmKey> = [
  "keyId", "name", "description", "keyType", "currentKeyValueVersion", "autoRotationPeriod",
  "nextAutoRotationDate", "lastAccessDatetime", "deletionDatetime",
  "creationUser", "creationDatetime", "lastChangeUser", "lastChangeDatetime",
];

const listCommand = withSkmOptions(
  new Command("list")
    .description("키 저장소의 키 목록을 조회한다 (전체 필드는 --json)")
    .argument("<keystore-id>", "키 저장소 ID")
    .option("--type <type>", "키 종류 (secret|symmetric-key|asymmetric-key)")
    .option("--name <name>", "키 이름 필터 (100자 이하)")
    .option("--status <status>", "키 상태 필터 (active|inactive)"),
).action(async (keyStoreId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<KeyListOptions>();
  const parsedId = parseKeyStoreId(keyStoreId);
  const type = parseKeyTypeOption(opts.type);
  const name = parseKeyNameOption(opts.name);
  const status = parseKeyStatusOption(opts.status);
  const macAddress = parseMacAddressOption(opts.macAddress);
  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  const filter = {
    ...(type !== undefined && { type }),
    ...(name !== undefined && { name }),
    ...(status !== undefined && { status }),
  };
  startSpinner(`SKM 키 저장소 ${parsedId} 키 목록 조회 중...`);
  let keys: SkmKey[];
  try {
    keys = await client.listKeys(parsedId, filter);
  } catch (err) {
    stopSpinner(false);
    throw err;
  }
  stopSpinner(true);

  output(opts, {
    headers: ["keyId", "name", "keyType", "currentKeyValueVersion", "lastAccessDatetime", "deletionDatetime"],
    rows: keys.map((k) => [
      formatCell(k.keyId), formatCell(k.name), formatCell(k.keyType), formatCell(k.currentKeyValueVersion),
      formatCell(k.lastAccessDatetime), formatCell(k.deletionDatetime),
    ]),
    raw: keys,
    ids: keys.map((k) => formatCell(k.keyId)),
  });
});

const getCommand = withSkmOptions(
  new Command("get")
    .description("키 한 건을 조회한다")
    .argument("<keystore-id>", "키 저장소 ID")
    .argument("<key-id>", "키 ID"),
).action(async (keyStoreId: string, keyId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<SkmCommandOptions>();
  const parsedId = parseKeyStoreId(keyStoreId);
  const parsedKeyId = parseRequiredArgument(keyId, "key-id");
  const macAddress = parseMacAddressOption(opts.macAddress);
  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  startSpinner(`SKM 키 ${formatCell(parsedKeyId)} 조회 중...`);
  let key: SkmKey;
  try {
    key = await client.getKey(parsedId, parsedKeyId);
  } catch (err) {
    stopSpinner(false);
    throw err;
  }
  stopSpinner(true);

  output(opts, {
    headers: ["field", "value"],
    rows: KEY_FIELDS.map((field) => [field, formatCell(key[field])]),
    raw: key,
    ids: [formatCell(key.keyId)],
  });
});

export const keyCommand = new Command("key")
  .description("SKM 키 목록과 상세 조회")
  .addCommand(listCommand)
  .addCommand(getCommand);
