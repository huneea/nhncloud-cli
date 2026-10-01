import { Command } from "commander";
import type { SkmCreatedKey } from "../../services/skm/types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { MAX_JSON_INPUT_BYTES } from "../../utils/limits.js";
import { parseRequiredArgument } from "../parse-options.js";
import { requireYes } from "../resource-resolver.js";
import {
  formatCell,
  outputSkmWriteResult,
  parseKeyNameOption,
  parseKeyStoreId,
  parseKeyTypeOption,
  parseMacAddressOption,
  resolveKeyStoreName,
  resolveSkmClient,
  type SkmCommandOptions,
  withSkmOptions,
  withSkmSpinner,
} from "./helpers.js";
import { decodeUtf8Input, readSkmInput } from "./input.js";

interface KeyCreateOptions extends SkmCommandOptions {
  type: string;
  name: string;
  description?: string;
  value?: string;
  file?: string;
}

interface KeyDeleteOptions extends SkmCommandOptions {
  yes?: boolean;
}

export const createCommand = withSkmOptions(
  new Command("create")
    .description("키 저장소에 키를 만든다 (기밀 데이터 값은 --value, --file, 표준 입력 중 하나)")
    .argument("<keystore-id>", "키 저장소 ID")
    .requiredOption("--type <type>", "키 종류 (secret|symmetric-key|asymmetric-key)")
    .requiredOption("--name <name>", "키 이름 (100자 이하)")
    .option("--description <text>", "키 설명")
    .option("--value <value>", "기밀 데이터 값 (--type secret 전용)")
    .option("--file <path>", "기밀 데이터 값을 읽을 파일 (--type secret 전용)"),
).action(async (keyStoreId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<KeyCreateOptions>();
  const parsedId = parseKeyStoreId(keyStoreId);
  // --type, --name 은 requiredOption 이라 parser 가 undefined 를 돌려주지 않는다.
  const type = parseKeyTypeOption(opts.type)!;
  const name = parseKeyNameOption(opts.name)!;
  // 키 설명은 공식 문서에 길이 한도가 없어 검사하지 않는다.
  const description = opts.description?.trim() || undefined;
  const macAddress = parseMacAddressOption(opts.macAddress);

  let secretValue: string | undefined;
  if (type === "SECRET") {
    const input = readSkmInput(
      { text: opts.value, file: opts.file },
      { textFlag: "--value", label: "기밀 데이터", maxBytes: MAX_JSON_INPUT_BYTES },
    );
    secretValue = decodeUtf8Input(input, "기밀 데이터", "바이너리는 base64로 인코딩해 전달하세요.");
  } else if (opts.value !== undefined || opts.file !== undefined) {
    throw new NhnCloudCliError("--value와 --file은 --type secret에서만 씁니다.", EXIT_PARAM_ERROR);
  }

  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  const created = await withSkmSpinner(`SKM 키 ${formatCell(name)} 생성 중...`, async (): Promise<SkmCreatedKey> => {
    const keyStoreName = await resolveKeyStoreName(client, parsedId);
    if (secretValue !== undefined) {
      return client.createSecret(keyStoreName, name, description, secretValue);
    }
    if (type === "SYMMETRIC_KEY") {
      return client.createSymmetricKey(keyStoreName, name, description);
    }
    return client.createAsymmetricKey(keyStoreName, name, description);
  });

  outputSkmWriteResult(
    opts,
    { keyId: created.keyId, keyStatus: created.keyStatus, keyStoreId: parsedId, name },
    [formatCell(created.keyId)],
  );
});

export const deleteCommand = withSkmOptions(
  new Command("delete")
    .description("키 삭제를 예약한다 (7일 뒤 삭제, 그 전에는 콘솔에서 취소 가능)")
    .argument("<key-id>", "키 ID")
    .option("--yes", "삭제 예약 확인"),
).action(async (keyId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<KeyDeleteOptions>();
  requireYes(opts.yes, "키 삭제 예약");
  const parsedKeyId = parseRequiredArgument(keyId, "key-id");
  const macAddress = parseMacAddressOption(opts.macAddress);
  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  const deletion = await withSkmSpinner(`SKM 키 ${formatCell(parsedKeyId)} 삭제 예약 중...`, () =>
    client.scheduleKeyDeletion(parsedKeyId),
  );

  outputSkmWriteResult(
    opts,
    {
      operation: "key-delete-scheduled",
      status: "succeeded",
      keyId: deletion.keyId,
      deletionDateTime: deletion.deletionDateTime,
    },
    [formatCell(deletion.keyId)],
  );
});

export const purgeCommand = withSkmOptions(
  new Command("purge")
    .description("키를 즉시 삭제한다 (삭제 예약된 키만, 되돌릴 수 없음)")
    .argument("<key-id>", "키 ID")
    .option("--yes", "즉시 삭제 확인"),
).action(async (keyId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<KeyDeleteOptions>();
  requireYes(opts.yes, "키 즉시 삭제");
  const parsedKeyId = parseRequiredArgument(keyId, "key-id");
  const macAddress = parseMacAddressOption(opts.macAddress);
  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  const deletion = await withSkmSpinner(`SKM 키 ${formatCell(parsedKeyId)} 즉시 삭제 중...`, () =>
    client.deleteKeyNow(parsedKeyId),
  );

  outputSkmWriteResult(
    opts,
    { operation: "key-purge", status: "succeeded", keyId: deletion.keyId, deletionDateTime: deletion.deletionDateTime },
    [formatCell(deletion.keyId)],
  );
});
