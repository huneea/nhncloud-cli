import { Command } from "commander";
import { MAX_JSON_INPUT_BYTES } from "../../utils/limits.js";
import { parseRequiredArgument } from "../parse-options.js";
import {
  formatCell,
  outputSkmWriteResult,
  parseMacAddressOption,
  printSkmValue,
  resolveSkmClient,
  type SkmCommandOptions,
  withSkmOptions,
  withSkmSpinner,
} from "./helpers.js";
import { decodeUtf8Input, readSkmInput } from "./input.js";

interface SecretUpdateOptions extends SkmCommandOptions {
  value?: string;
  file?: string;
}

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

const updateCommand = withSkmOptions(
  new Command("update")
    .description("기밀 데이터 값을 바꾼다 (값은 --value, --file, 표준 입력 중 하나)")
    .argument("<key-id>", "키 ID")
    .option("--value <value>", "새 기밀 데이터 값")
    .option("--file <path>", "새 기밀 데이터 값을 읽을 파일"),
).action(async (keyId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<SecretUpdateOptions>();
  const parsedKeyId = parseRequiredArgument(keyId, "key-id");
  const macAddress = parseMacAddressOption(opts.macAddress);
  const input = readSkmInput(
    { text: opts.value, file: opts.file },
    { textFlag: "--value", label: "기밀 데이터", maxBytes: MAX_JSON_INPUT_BYTES },
  );
  const secretValue = decodeUtf8Input(input, "기밀 데이터", "바이너리는 base64로 인코딩해 전달하세요.");
  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  const updated = await withSkmSpinner(`SKM 기밀 데이터 ${formatCell(parsedKeyId)} 수정 중...`, () =>
    client.updateSecret(parsedKeyId, secretValue),
  );

  // 응답에 담겨 오는 새 값은 어떤 출력 형식에도 내지 않는다 (ADR-040).
  const { secretValue: _omitted, ...result } = updated;
  outputSkmWriteResult(opts, result, [formatCell(updated.keyId)]);
});

export const secretCommand = new Command("secret")
  .description("SKM 기밀 데이터 조회와 수정")
  .addCommand(getCommand)
  .addCommand(updateCommand);
