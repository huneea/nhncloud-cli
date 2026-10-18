import { Command } from "commander";
import { toNhnCloudCliError } from "../../api/httpError.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR, EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
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
import { decodeUtf8Input, readInputSource } from "../input-source.js";
import {
  assertNoLossyNumber,
  formatFieldValue,
  parseFieldName,
  parseSecretObject,
  type PatchChange,
  planSecretPatch,
  serializeSecretObject,
  tryParseSecretObject,
  verifySecretPatch,
} from "./secret-json.js";

interface SecretUpdateOptions extends SkmCommandOptions {
  value?: string;
  file?: string;
}

interface SecretPatchOptions extends SkmCommandOptions {
  file?: string;
  replace?: boolean;
  delete?: boolean;
  yes?: boolean;
}

interface SecretGetOptions extends SkmCommandOptions {
  field?: string;
}

const getCommand = withSkmOptions(
  new Command("get")
    .description("기밀 데이터를 조회한다 (원문을 stdout에 출력, --field로 JSON 객체의 필드 하나만)")
    .argument("<key-id>", "키 ID")
    .option("--field <name>", "JSON 객체 값에서 이 필드의 값만 출력한다"),
).action(async (keyId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<SecretGetOptions>();
  const parsedKeyId = parseRequiredArgument(keyId, "key-id");
  const macAddress = parseMacAddressOption(opts.macAddress);
  const field = opts.field === undefined ? undefined : parseFieldName(opts.field, "--field");
  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  const secret = await withSkmSpinner(`SKM 기밀 데이터 ${formatCell(parsedKeyId)} 조회 중...`, () =>
    client.getSecret(parsedKeyId),
  );
  if (field === undefined) {
    printSkmValue(opts, secret, { secret });
    return;
  }

  const object = parseSecretObject(secret, "--field");
  if (!Object.hasOwn(object, field)) {
    throw new NhnCloudCliError(`기밀 데이터에 필드 ${JSON.stringify(field)}가 없습니다.`, EXIT_PARAM_ERROR);
  }
  const value = object[field];
  if (typeof value !== "string") assertNoLossyNumber(secret, "--field");
  printSkmValue(opts, formatFieldValue(value), { keyId: parsedKeyId, field, value });
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
  const input = readInputSource(
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

const patchCommand = withSkmOptions(
  new Command("patch")
    .description("JSON 객체 기밀 데이터의 필드 하나를 더하거나 바꾸거나 지운다 (기본은 미리보기, --yes로 반영)")
    .argument("<key-id>", "키 ID")
    .argument("<field>", "필드 이름 (최상위 키)")
    .option("--file <path>", "필드에 넣을 값을 읽을 파일 (없으면 표준 입력)")
    .option("--replace", "이미 있는 필드의 값을 바꾼다")
    .option("--delete", "필드를 지운다")
    .option("--yes", "미리보기 대신 반영한다"),
).action(async (keyId: string, field: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<SecretPatchOptions>();
  const parsedKeyId = parseRequiredArgument(keyId, "key-id");
  const parsedField = parseFieldName(field, "<field>");
  const macAddress = parseMacAddressOption(opts.macAddress);
  if (opts.delete && opts.replace) {
    throw new NhnCloudCliError("--delete와 --replace는 함께 지정할 수 없습니다.", EXIT_PARAM_ERROR);
  }
  if (opts.delete && opts.file !== undefined) {
    throw new NhnCloudCliError("--delete와 --file은 함께 지정할 수 없습니다.", EXIT_PARAM_ERROR);
  }

  let change: PatchChange;
  if (opts.delete) {
    change = { kind: "delete" };
  } else {
    const label = "필드에 넣을 데이터";
    const input = readInputSource({ file: opts.file }, { label, maxBytes: MAX_JSON_INPUT_BYTES });
    const value = decodeUtf8Input(input, label, "바이너리는 base64로 인코딩해 전달하세요.");
    if (value.endsWith("\n")) {
      process.stderr.write(
        "경고: 필드에 넣을 데이터가 줄바꿈으로 끝납니다. 줄바꿈도 값에 들어갑니다. 빼려면 printf '%s'로 넘기세요.\n",
      );
    }
    change = { kind: "set", value, replace: opts.replace === true };
  }

  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });
  const id = formatCell(parsedKeyId);
  const current = await withSkmSpinner(`SKM 기밀 데이터 ${id} 조회 중...`, () => client.getSecret(parsedKeyId));
  const before = parseSecretObject(current, "secret patch");
  assertNoLossyNumber(current, "secret patch");
  const { action, after } = planSecretPatch(before, parsedField, change);

  // 값과 해시는 어떤 출력에도 내지 않는다 (ADR-045).
  const report = (applied: boolean, verified: { fieldVerified: boolean; othersVerified: boolean } | null): void => {
    const result: Record<string, unknown> = {
      keyId: parsedKeyId,
      field: parsedField,
      action,
      applied,
      fieldVerified: verified?.fieldVerified ?? null,
      othersVerified: verified?.othersVerified ?? null,
    };
    outputSkmWriteResult(opts, result, [action]);
  };

  if (!opts.yes || action === "unchanged") {
    report(false, null);
    if (!opts.yes && action !== "unchanged") {
      process.stderr.write("미리보기입니다. 반영하려면 --yes를 붙이세요.\n");
    }
    return;
  }

  // PUT 응답에 실린 전체 값은 쓰지 않는다 (ADR-040).
  try {
    await withSkmSpinner(`SKM 기밀 데이터 ${id} 수정 중...`, () =>
      client.updateSecret(parsedKeyId, serializeSecretObject(after, current)),
    );
  } catch (err) {
    const e = toNhnCloudCliError(err);
    throw new NhnCloudCliError(
      `기밀 데이터 수정 요청이 실패했습니다: ${e.message} 반영됐는지는 같은 명령을 --yes 없이 다시 실행해 action으로 확인하세요.`,
      e.exitCode,
    );
  }

  let fetchedText: string;
  try {
    fetchedText = await withSkmSpinner(`SKM 기밀 데이터 ${id} 다시 조회 중...`, () => client.getSecret(parsedKeyId));
  } catch (err) {
    const e = toNhnCloudCliError(err);
    report(true, null);
    throw new NhnCloudCliError(
      `기밀 데이터는 바꿨지만 다시 조회하지 못해 검증하지 못했습니다: ${e.message} skm secret get으로 현재 값을 확인하세요.`,
      EXIT_API_ERROR,
    );
  }

  const verified = verifySecretPatch(before, tryParseSecretObject(fetchedText), parsedField, change);
  report(true, verified);
  const mismatched = [
    ...(verified.fieldVerified ? [] : [`필드 ${JSON.stringify(parsedField)}`]),
    ...(verified.othersVerified ? [] : ["다른 필드"]),
  ];
  if (mismatched.length > 0) {
    throw new NhnCloudCliError(
      `반영 뒤 다시 조회한 기밀 데이터가 기대와 다릅니다 (${mismatched.join(", ")}). 다른 쓰기가 끼어들었거나 승인 기능 때문에 변경이 대기 중일 수 있습니다. skm secret get으로 현재 값을 확인하세요.`,
      EXIT_API_ERROR,
    );
  }
});

export const secretCommand = new Command("secret")
  .description("SKM 기밀 데이터 조회와 수정")
  .addCommand(getCommand)
  .addCommand(updateCommand)
  .addCommand(patchCommand);
