import { Command } from "commander";
import type { SkmAuthAdded, SkmKeyStoreInput } from "../../services/skm/types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { parsePositiveIntegerOption } from "../parse-options.js";
import { requireYes } from "../resource-resolver.js";
import {
  formatCell,
  outputSkmWriteResult,
  parseAuthListOption,
  parseAuthModeOption,
  parseAuthTypeOption,
  parseAuthValue,
  parseDescriptionOption,
  parseKeyNameOption,
  parseKeyStoreId,
  parseMacAddressOption,
  resolveKeyStoreName,
  resolveSkmClient,
  type SkmCommandOptions,
  withSkmOptions,
  withSkmSpinner,
  withTypeOption,
} from "./helpers.js";
import { decodeUtf8Input, readSkmInput } from "./input.js";

interface KeyStoreCreateOptions extends SkmCommandOptions {
  name: string;
  auth: string;
  authMode: string;
  description?: string;
}

interface KeyStoreUpdateOptions extends SkmCommandOptions {
  authMode: string;
  name?: string;
  description?: string;
  auth?: string;
}

interface KeyStoreDeleteOptions extends SkmCommandOptions {
  yes?: boolean;
}

interface AuthAddOptions extends SkmCommandOptions {
  type: string;
  description?: string;
  lifeTime?: string;
  password?: string;
  passwordFile?: string;
}

interface AuthDeleteOptions extends SkmCommandOptions {
  type: string;
  yes?: boolean;
}

const DESCRIPTION_MAX_LENGTH = 1000;
const PASSWORD_MAX_BYTES = 1024;
const LOCKOUT_WARNING = "(실행 위치가 키를 쓰지 못하게 될 수 있음, 먼저 skm confirm으로 확인)";

export const createCommand = withSkmOptions(
  new Command("create")
    .description("키 저장소를 만든다")
    .requiredOption("--name <name>", "키 저장소 이름 (100자 이하)")
    .requiredOption("--auth <list>", "사용할 인증 (ipv4,mac,certificate 중 하나 이상을 쉼표로)")
    .option("--auth-mode <mode>", "인증 결합 방식 (and|or)", "and")
    .option("--description <text>", "키 저장소 설명 (1000자 이하)"),
).action(async (_opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<KeyStoreCreateOptions>();
  // --name 은 requiredOption 이라 parser 가 undefined 를 돌려주지 않는다.
  const name = parseKeyNameOption(opts.name)!;
  const auths = parseAuthListOption(opts.auth);
  const authMode = parseAuthModeOption(opts.authMode);
  const description = parseDescriptionOption(opts.description, DESCRIPTION_MAX_LENGTH);
  const macAddress = parseMacAddressOption(opts.macAddress);
  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  const input: SkmKeyStoreInput = { name, ...auths, authMode };
  if (description !== undefined) input.description = description;
  const created = await withSkmSpinner(`SKM 키 저장소 ${formatCell(name)} 생성 중...`, () =>
    client.createKeyStore(input),
  );

  outputSkmWriteResult(opts, { ...created }, [String(created.keyStoreId)]);
});

export const updateCommand = withSkmOptions(
  new Command("update")
    .description(`키 저장소를 수정한다. 주지 않은 항목은 현재 값을 유지한다 ${LOCKOUT_WARNING}`)
    .argument("<keystore-id>", "키 저장소 ID")
    .requiredOption("--auth-mode <mode>", "인증 결합 방식 (and|or). 조회 응답에 없어 매번 지정한다")
    .option("--name <name>", "키 저장소 이름 (100자 이하)")
    .option("--description <text>", "키 저장소 설명 (1000자 이하)")
    .option("--auth <list>", "사용할 인증 (ipv4,mac,certificate 중 하나 이상을 쉼표로)"),
).action(async (keyStoreId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<KeyStoreUpdateOptions>();
  const parsedId = parseKeyStoreId(keyStoreId);
  const authMode = parseAuthModeOption(opts.authMode);
  const name = parseKeyNameOption(opts.name);
  const description = parseDescriptionOption(opts.description, DESCRIPTION_MAX_LENGTH);
  const auths = opts.auth === undefined ? undefined : parseAuthListOption(opts.auth);
  const macAddress = parseMacAddressOption(opts.macAddress);
  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  // 수정 API 는 전체 교체라 현재 값을 읽어 주지 않은 항목을 채운다. 읽은 뒤의 다른 변경은 덮인다 (ADR-040).
  const current = await withSkmSpinner(`SKM 키 저장소 ${parsedId} 조회 중...`, () => client.getKeyStore(parsedId));
  const currentDescription = typeof current.description === "string" ? current.description : undefined;
  const yesNo = (value: string): "Y" | "N" => (value === "Y" ? "Y" : "N");
  const input: SkmKeyStoreInput = {
    name: name ?? current.name,
    ...(auths ?? {
      ip4AuthUse: yesNo(current.ip4AuthUse),
      macAuthUse: yesNo(current.macAuthUse),
      certificateAuthUse: yesNo(current.certificateAuthUse),
    }),
    authMode,
  };
  const nextDescription = description ?? currentDescription;
  if (nextDescription !== undefined) input.description = nextDescription;
  if (input.ip4AuthUse === "N" && input.macAuthUse === "N" && input.certificateAuthUse === "N") {
    throw new NhnCloudCliError("키 저장소 인증은 하나 이상 켜야 합니다.", EXIT_PARAM_ERROR);
  }

  await withSkmSpinner(`SKM 키 저장소 ${parsedId} 수정 중...`, () => client.updateKeyStore(parsedId, input));

  outputSkmWriteResult(
    opts,
    { operation: "keystore-update", status: "succeeded", keyStoreId: parsedId, ...input },
    [String(parsedId)],
  );
});

export const deleteCommand = withSkmOptions(
  new Command("delete")
    .description("키 저장소를 삭제(비활성화)한다")
    .argument("<keystore-id>", "키 저장소 ID")
    .option("--yes", "삭제 확인"),
).action(async (keyStoreId: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<KeyStoreDeleteOptions>();
  requireYes(opts.yes, "키 저장소 삭제");
  const parsedId = parseKeyStoreId(keyStoreId);
  const macAddress = parseMacAddressOption(opts.macAddress);
  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  await withSkmSpinner(`SKM 키 저장소 ${parsedId} 삭제 중...`, () => client.deleteKeyStore(parsedId));

  outputSkmWriteResult(
    opts,
    { operation: "keystore-delete", status: "succeeded", keyStoreId: parsedId },
    [String(parsedId)],
  );
});

/**
 * 인증서 추가에 필요한 유효 기간과 비밀번호를 읽는다.
 * 비밀번호만 끝의 줄바꿈 하나를 지운다 (docs/flow.md 「Secure Key Manager 쓰기」).
 */
function readCertificateOptions(opts: AuthAddOptions): { lifeTime: number; password: string } {
  if (opts.lifeTime === undefined) {
    throw new NhnCloudCliError("인증서 추가에는 --life-time이 필요합니다.", EXIT_PARAM_ERROR);
  }
  const lifeTime = parsePositiveIntegerOption(opts.lifeTime, "--life-time");
  const input = readSkmInput(
    { text: opts.password, file: opts.passwordFile },
    { textFlag: "--password", fileFlag: "--password-file", label: "인증서 비밀번호", maxBytes: PASSWORD_MAX_BYTES },
  );
  const password = decodeUtf8Input(input, "인증서 비밀번호", "파일 인코딩을 확인하세요.").replace(/\r?\n$/, "");
  if (!password) {
    throw new NhnCloudCliError("인증서 비밀번호가 비어 있습니다.", EXIT_PARAM_ERROR);
  }
  return { lifeTime, password };
}

/** IPv4·MAC 추가에 인증서 전용 옵션이 섞이면 표준 입력을 읽기 전에 거부한다. */
function rejectCertificateOptions(opts: AuthAddOptions): void {
  if (opts.lifeTime !== undefined || opts.password !== undefined || opts.passwordFile !== undefined) {
    throw new NhnCloudCliError("--life-time과 --password는 --type certificate에서만 씁니다.", EXIT_PARAM_ERROR);
  }
}

/** 응답 전체를 펼치지 않는다. 서버가 다른 필드를 덧붙여도 출력에 나가지 않게 알려진 필드만 고른다. */
function authAddedFields(added: SkmAuthAdded): Record<string, unknown> {
  return { value: added.value, name: added.name, description: added.description };
}

export const authAddCommand = withTypeOption(
  withSkmOptions(
    new Command("add")
      .description("키 저장소에 인증 정보를 추가한다 (인증서 비밀번호는 --password, --password-file, 표준 입력 중 하나)")
      .argument("<keystore-id>", "키 저장소 ID")
      .argument("<value>", "IPv4·MAC 값 또는 인증서 이름")
      .option("--description <text>", "인증 정보 설명 (1000자 이하)")
      .option("--life-time <days>", "인증서 유효 기간(일) (--type certificate 전용, 필수)")
      .option("--password <pw>", "인증서 비밀번호 (--type certificate 전용)")
      .option("--password-file <path>", "인증서 비밀번호를 읽을 파일 (--type certificate 전용)"),
  ),
).action(async (keyStoreId: string, value: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<AuthAddOptions>();
  const parsedId = parseKeyStoreId(keyStoreId);
  const type = parseAuthTypeOption(opts.type);
  const parsedValue = parseAuthValue(type, value);
  const description = parseDescriptionOption(opts.description, DESCRIPTION_MAX_LENGTH);
  const macAddress = parseMacAddressOption(opts.macAddress);

  if (type !== "certificate") rejectCertificateOptions(opts);
  const target = type === "certificate" ? { type, ...readCertificateOptions(opts) } : { type };

  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  const added = await withSkmSpinner(`SKM ${type} 인증 정보 ${formatCell(parsedValue)} 추가 중...`, async () => {
    const keyStoreName = await resolveKeyStoreName(client, parsedId);
    if (target.type === "certificate") {
      return client.addCertificate(keyStoreName, parsedValue, target.password, target.lifeTime, description);
    }
    return client.addAuth(target.type, keyStoreName, parsedValue, description);
  });

  outputSkmWriteResult(
    opts,
    { operation: "auth-add", type, keyStoreId: parsedId, ...authAddedFields(added) },
    [formatCell(parsedValue)],
  );
});

export const authDeleteCommand = withTypeOption(
  withSkmOptions(
    new Command("delete")
      .description(`인증 정보 삭제를 예약한다 (7일 뒤 삭제) ${LOCKOUT_WARNING}`)
      .argument("<keystore-id>", "키 저장소 ID")
      .argument("<value>", "IPv4·MAC 값 또는 인증서 이름")
      .option("--yes", "삭제 예약 확인"),
  ),
).action(async (keyStoreId: string, value: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<AuthDeleteOptions>();
  requireYes(opts.yes, "인증 정보 삭제 예약");
  const parsedId = parseKeyStoreId(keyStoreId);
  const type = parseAuthTypeOption(opts.type);
  const parsedValue = parseAuthValue(type, value);
  const macAddress = parseMacAddressOption(opts.macAddress);
  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  const deletion = await withSkmSpinner(`SKM ${type} 인증 정보 ${formatCell(parsedValue)} 삭제 예약 중...`, async () => {
    const keyStoreName = await resolveKeyStoreName(client, parsedId);
    return client.scheduleAuthDeletion(type, keyStoreName, parsedValue);
  });

  outputSkmWriteResult(
    opts,
    {
      operation: "auth-delete-scheduled",
      type,
      keyStoreId: parsedId,
      value: deletion.value,
      name: deletion.name,
      deletionDateTime: deletion.deletionDateTime,
    },
    [formatCell(parsedValue)],
  );
});

export const authPurgeCommand = withTypeOption(
  withSkmOptions(
    new Command("purge")
      .description(`인증 정보를 즉시 삭제한다 (삭제 예약된 것만, 되돌릴 수 없음) ${LOCKOUT_WARNING}`)
      .argument("<keystore-id>", "키 저장소 ID")
      .argument("<value>", "IPv4·MAC 값 또는 인증서 이름")
      .option("--yes", "즉시 삭제 확인"),
  ),
).action(async (keyStoreId: string, value: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<AuthDeleteOptions>();
  requireYes(opts.yes, "인증 정보 즉시 삭제");
  const parsedId = parseKeyStoreId(keyStoreId);
  const type = parseAuthTypeOption(opts.type);
  const parsedValue = parseAuthValue(type, value);
  const macAddress = parseMacAddressOption(opts.macAddress);
  const { client } = await resolveSkmClient({ profile: opts.profile, macAddress });

  const deletion = await withSkmSpinner(`SKM ${type} 인증 정보 ${formatCell(parsedValue)} 즉시 삭제 중...`, async () => {
    const keyStoreName = await resolveKeyStoreName(client, parsedId);
    return client.deleteAuthNow(type, keyStoreName, parsedValue);
  });

  outputSkmWriteResult(
    opts,
    {
      operation: "auth-purge",
      type,
      keyStoreId: parsedId,
      value: deletion.value,
      name: deletion.name,
      deletionDateTime: deletion.deletionDateTime,
    },
    [formatCell(parsedValue)],
  );
});
