import { Command } from "commander";
import { printJson } from "../../formatters/table.js";
import type { SkmClient } from "../../services/skm/client.js";
import type { SkmAsymmetricKeyMaterial } from "../../services/skm/types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR, EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
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

/** 일반 서명 API 의 평문 한도 (245바이트). */
const MAX_SIGN_BYTES = 245;
/** 표준 스킴 서명 API 의 평문 한도 (base64 디코딩 전 64KB). */
const MAX_STANDARD_SIGN_BYTES = 65536;

interface SignInputOptions extends SkmCommandOptions {
  plaintext?: string;
  file?: string;
  standard?: boolean;
}

interface VerifyOptions extends SignInputOptions {
  signature: string;
  keyVersion?: string;
}

interface KeyVersionOptions extends SkmCommandOptions {
  keyVersion?: string;
}

/**
 * 서명·검증할 데이터를 API 가 받는 문자열로 만든다.
 * 일반 서명은 UTF-8 텍스트를 그대로, 표준 스킴은 받은 바이트를 base64 로 보낸다.
 */
function readSignPayload(opts: SignInputOptions, label: string): string {
  const input = readSkmInput(
    { text: opts.plaintext, file: opts.file },
    { textFlag: "--plaintext", label, maxBytes: opts.standard ? MAX_STANDARD_SIGN_BYTES : MAX_SIGN_BYTES },
  );
  if (opts.standard) return input.toString("base64");
  return decodeUtf8Input(input, label, "바이너리는 --standard로 서명하세요.");
}

function withSignInputOptions(command: Command): Command {
  return command
    .argument("<key-id>", "키 ID")
    .option("--plaintext <text>", "데이터 (미지정 시 --file 또는 stdin)")
    .option("--file <path>", "데이터를 읽을 파일 경로")
    .option("--standard", "표준 스킴(RSASSA-PSS)으로 처리한다 (바이너리 가능, 64KB 이하)");
}

const signCommand = withSkmOptions(
  withSignInputOptions(
    new Command("sign").description("비대칭키로 데이터에 서명한다 (일반 서명은 UTF-8 텍스트 245바이트 이하)"),
  ),
).action(async (keyId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<SignInputOptions>();
  const parsedKeyId = parseRequiredArgument(keyId, "key-id");
  const macAddress = parseMacAddressOption(opts.macAddress);
  const payload = readSignPayload(opts, "서명할 데이터");
  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  const body = await withSkmSpinner(`SKM 비대칭키 ${formatCell(parsedKeyId)}로 서명 중...`, () =>
    opts.standard ? client.signStandard(parsedKeyId, payload) : client.sign(parsedKeyId, payload),
  );
  printSkmValue(opts, body.signature, body);
});

const verifyCommand = withSkmOptions(
  withSignInputOptions(
    new Command("verify").description("비대칭키로 서명을 검증한다 (검증 실패는 종료 코드 1)"),
  )
    .requiredOption("--signature <sig>", "검증할 서명값 (base64)")
    .option("--key-version <n>", "서명한 키 버전 (--standard 검증에 필수)"),
).action(async (keyId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<VerifyOptions>();
  const parsedKeyId = parseRequiredArgument(keyId, "key-id");
  const signature = opts.signature.trim();
  if (!signature) {
    throw new NhnCloudCliError("--signature가 비어 있습니다.", EXIT_PARAM_ERROR);
  }
  const keyVersion = parseKeyVersionOption(opts.keyVersion);
  if (opts.standard && keyVersion === undefined) {
    throw new NhnCloudCliError("--standard 검증에는 --key-version이 필요합니다.", EXIT_PARAM_ERROR);
  }
  if (!opts.standard && keyVersion !== undefined) {
    throw new NhnCloudCliError("--key-version은 --standard와 함께 지정합니다.", EXIT_PARAM_ERROR);
  }
  const macAddress = parseMacAddressOption(opts.macAddress);
  const payload = readSignPayload(opts, "검증할 데이터");
  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  const body = await withSkmSpinner(`SKM 비대칭키 ${formatCell(parsedKeyId)}로 서명 검증 중...`, () =>
    keyVersion !== undefined
      ? client.verifyStandard(parsedKeyId, payload, signature, keyVersion)
      : client.verify(parsedKeyId, payload, signature),
  );

  if (opts.json) {
    printJson(body);
  } else if (!opts.quiet) {
    const verdict = body.result ? "검증 성공" : "검증 실패";
    process.stdout.write(`${verdict} (keyVersion ${body.keyVersion})\n`);
  }
  if (!body.result) {
    throw new NhnCloudCliError("서명 검증에 실패했습니다.", EXIT_API_ERROR);
  }
});

function keyMaterialCommand(
  name: string,
  description: string,
  fetch: (client: SkmClient, keyId: string, keyVersion: number | undefined) => Promise<SkmAsymmetricKeyMaterial>,
  spinnerLabel: string,
): Command {
  return withSkmOptions(
    new Command(name)
      .description(description)
      .argument("<key-id>", "키 ID")
      .option("--key-version <n>", "조회할 키 버전 (0 이상, 생략하면 버전을 지정하지 않고 요청)"),
  ).action(async (keyId: string, _opts: unknown, command: Command) => {
    const opts = command.optsWithGlobals<KeyVersionOptions>();
    const parsedKeyId = parseRequiredArgument(keyId, "key-id");
    const keyVersion = parseKeyVersionOption(opts.keyVersion);
    const macAddress = parseMacAddressOption(opts.macAddress);
    const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

    const body = await withSkmSpinner(`SKM 비대칭키 ${formatCell(parsedKeyId)} ${spinnerLabel} 조회 중...`, () =>
      fetch(client, parsedKeyId, keyVersion),
    );
    printSkmValue(opts, body.standardEncodedKey ?? body.encodedKey, body);
  });
}

const publicKeyCommand = keyMaterialCommand(
  "public-key",
  "공개키를 조회한다 (standardEncodedKey를, 없으면 encodedKey를 stdout에 출력)",
  (client, keyId, keyVersion) => client.getPublicKey(keyId, keyVersion),
  "공개키",
);

const privateKeyCommand = keyMaterialCommand(
  "private-key",
  "개인키 원문을 조회한다 (standardEncodedKey를, 없으면 encodedKey를 stdout에 출력)",
  (client, keyId, keyVersion) => client.getPrivateKey(keyId, keyVersion),
  "개인키",
);

export const asymmetricKeyCommand = new Command("asymmetric-key")
  .description("SKM 비대칭키 서명·검증과 키 조회")
  .addCommand(signCommand)
  .addCommand(verifyCommand)
  .addCommand(publicKeyCommand)
  .addCommand(privateKeyCommand);
