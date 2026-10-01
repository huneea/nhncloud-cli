import { Command } from "commander";
import { output } from "../../formatters/table.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { MAX_JSON_INPUT_BYTES } from "../../utils/limits.js";
import { parseRequiredArgument } from "../parse-options.js";
import {
  formatCell,
  parseKeyVersionOption,
  parseMacAddressOption,
  printSkmValue,
  resolveSkmClient,
  type SkmCommandOptions,
  withSkmOptions,
  withSkmSpinner,
} from "./helpers.js";
import { decodeUtf8Input, readSkmInput } from "./input.js";

/** 대칭키 암호화 API 의 평문 한도 (32KB). */
const MAX_ENCRYPT_BYTES = 32768;

interface EncryptOptions extends SkmCommandOptions {
  plaintext?: string;
  file?: string;
}

interface DecryptOptions extends SkmCommandOptions {
  ciphertext?: string;
  file?: string;
}

interface KeyVersionOptions extends SkmCommandOptions {
  keyVersion?: string;
}

const encryptCommand = withSkmOptions(
  new Command("encrypt")
    .description("대칭키로 데이터를 암호화한다 (--plaintext / --file / stdin, UTF-8 텍스트 32KB 이하)")
    .argument("<key-id>", "키 ID")
    .option("--plaintext <text>", "암호화할 데이터")
    .option("--file <path>", "암호화할 데이터를 읽을 파일 경로"),
).action(async (keyId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<EncryptOptions>();
  const parsedKeyId = parseRequiredArgument(keyId, "key-id");
  const macAddress = parseMacAddressOption(opts.macAddress);
  const label = "암호화할 데이터";
  const input = readSkmInput(
    { text: opts.plaintext, file: opts.file },
    { textFlag: "--plaintext", label, maxBytes: MAX_ENCRYPT_BYTES },
  );
  const plaintext = decodeUtf8Input(input, label, "바이너리는 base64로 인코딩해 전달하세요.");
  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  const body = await withSkmSpinner(`SKM 대칭키 ${formatCell(parsedKeyId)}로 암호화 중...`, () =>
    client.encrypt(parsedKeyId, plaintext),
  );
  printSkmValue(opts, body.ciphertext, body);
});

const decryptCommand = withSkmOptions(
  new Command("decrypt")
    .description("대칭키로 암호문을 복호화한다 (--ciphertext / --file / stdin, 평문을 stdout에 출력)")
    .argument("<key-id>", "키 ID")
    .option("--ciphertext <text>", "복호화할 암호문 (base64)")
    .option("--file <path>", "복호화할 암호문을 읽을 파일 경로"),
).action(async (keyId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<DecryptOptions>();
  const parsedKeyId = parseRequiredArgument(keyId, "key-id");
  const macAddress = parseMacAddressOption(opts.macAddress);
  const label = "복호화할 암호문";
  const input = readSkmInput(
    { text: opts.ciphertext, file: opts.file },
    { textFlag: "--ciphertext", label, maxBytes: MAX_JSON_INPUT_BYTES },
  );
  // 암호문은 base64 라 앞뒤 공백과 파일 끝 줄바꿈은 값이 아니다.
  const ciphertext = decodeUtf8Input(input, label, "암호문은 base64 문자열입니다.").trim();
  if (!ciphertext) {
    throw new NhnCloudCliError(`${label}이 비어 있습니다.`, EXIT_PARAM_ERROR);
  }
  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  const body = await withSkmSpinner(`SKM 대칭키 ${formatCell(parsedKeyId)}로 복호화 중...`, () =>
    client.decrypt(parsedKeyId, ciphertext),
  );
  printSkmValue(opts, body.plaintext, body);
});

const getCommand = withSkmOptions(
  new Command("get")
    .description("대칭키 원문을 조회한다 (원문을 stdout에 출력)")
    .argument("<key-id>", "키 ID")
    .option("--key-version <n>", "조회할 키 버전 (0 이상, 미지정 시 최신)"),
).action(async (keyId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<KeyVersionOptions>();
  const parsedKeyId = parseRequiredArgument(keyId, "key-id");
  const keyVersion = parseKeyVersionOption(opts.keyVersion);
  const macAddress = parseMacAddressOption(opts.macAddress);
  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  const body = await withSkmSpinner(`SKM 대칭키 ${formatCell(parsedKeyId)} 조회 중...`, () =>
    client.getSymmetricKey(parsedKeyId, keyVersion),
  );
  printSkmValue(opts, body.symmetricKey, body);
});

const createLocalKeyCommand = withSkmOptions(
  new Command("create-local-key")
    .description("로컬 암호화에 쓸 데이터 키를 만든다 (평문 키는 이 응답에서만 받을 수 있다)")
    .argument("<key-id>", "키 ID"),
).action(async (keyId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<SkmCommandOptions>();
  const parsedKeyId = parseRequiredArgument(keyId, "key-id");
  const macAddress = parseMacAddressOption(opts.macAddress);
  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  const body = await withSkmSpinner(`SKM 대칭키 ${formatCell(parsedKeyId)}로 로컬 키 생성 중...`, () =>
    client.createLocalKey(parsedKeyId),
  );
  output(opts, {
    headers: ["field", "value"],
    rows: [
      ["localKeyPlaintext", formatCell(body.localKeyPlaintext)],
      ["localKeyCiphertext", formatCell(body.localKeyCiphertext)],
      ["keyVersion", formatCell(body.keyVersion)],
    ],
    raw: body,
    ids: [body.localKeyPlaintext, body.localKeyCiphertext],
  });
});

export const symmetricKeyCommand = new Command("symmetric-key")
  .description("SKM 대칭키 암복호화와 키 조회")
  .addCommand(encryptCommand)
  .addCommand(decryptCommand)
  .addCommand(getCommand)
  .addCommand(createLocalKeyCommand);
