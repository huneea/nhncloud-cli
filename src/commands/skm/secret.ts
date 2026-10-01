import { Command } from "commander";
import { parseRequiredArgument } from "../parse-options.js";
import {
  formatCell,
  parseMacAddressOption,
  printSkmValue,
  resolveSkmClient,
  type SkmCommandOptions,
  withSkmOptions,
  withSkmSpinner,
} from "./helpers.js";

const getCommand = withSkmOptions(
  new Command("get")
    .description("기밀 데이터를 조회한다 (원문을 stdout에 출력)")
    .argument("<key-id>", "키 ID"),
).action(async (keyId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<SkmCommandOptions>();
  const parsedKeyId = parseRequiredArgument(keyId, "key-id");
  const macAddress = parseMacAddressOption(opts.macAddress);
  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  const secret = await withSkmSpinner(`SKM 기밀 데이터 ${formatCell(parsedKeyId)} 조회 중...`, () =>
    client.getSecret(parsedKeyId),
  );
  printSkmValue(opts, secret, { secret });
});

export const secretCommand = new Command("secret")
  .description("SKM 기밀 데이터 조회")
  .addCommand(getCommand);
