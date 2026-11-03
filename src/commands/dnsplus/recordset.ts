import { Command } from "commander";
import { output } from "../../formatters/table.js";
import { DnsplusClient } from "../../services/dnsplus/client.js";
import type { DnsplusRecordset, DnsplusZone } from "../../services/dnsplus/types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { collectOption, parseIntegerOption, parseRequiredArgument } from "../parse-options.js";
import {
  buildRecordList,
  DEFAULT_TTL,
  formatCell,
  formatRecords,
  isUuid,
  MAX_TTL,
  MIN_TTL,
  parseRecordsetName,
  parseRecordsetType,
  RECORDSET_HEADERS,
  recordsetRow,
  requireWriteMode,
  resolveDnsplusClient,
  resolveZone,
  toFqdn,
  withDnsplusOptions,
  withDnsplusSpinner,
  withDnsplusWriteOptions,
  type DnsplusCommandOptions,
  type DnsplusWriteOptions,
} from "./helpers.js";

interface ZoneOption extends DnsplusCommandOptions {
  zone: string;
}

interface RecordsetListOptions extends ZoneOption {
  name?: string;
  type?: string;
}

interface RecordsetSelectOptions extends ZoneOption {
  type?: string;
}

interface RecordsetCreateOptions extends ZoneOption, DnsplusWriteOptions {
  name: string;
  type: string;
  value: string[];
  ttl: string;
}

interface RecordsetDeleteOptions extends RecordsetSelectOptions, DnsplusWriteOptions {}

const ZONE_FLAG = "--zone <zone>";
const ZONE_DESCRIPTION = "대상 존 ID(UUID) 또는 존 이름";

/** 레코드 세트 ID 나 이름으로 존 안의 레코드 세트를 찾는다. 이름은 대소문자 없이 정확히 같은 것만 받는다. */
async function findRecordsets(
  client: DnsplusClient,
  zone: DnsplusZone,
  input: string,
  type: string | undefined,
): Promise<DnsplusRecordset[]> {
  const value = parseRequiredArgument(input, "<recordset>");
  const typeFilter = type === undefined ? undefined : parseRecordsetType(type);
  if (isUuid(value)) {
    const found = await withDnsplusSpinner("레코드 세트 조회 중...", () =>
      client.listRecordsets(zone.zoneId, { recordsetIdList: [value] }),
    );
    const byId = found.filter((recordset) => recordset.recordsetId === value);
    // ID 가 가리키는 레코드 세트의 타입이 --type 과 다르면 지우거나 읽기 전에 입력 오류로 끝낸다.
    if (typeFilter !== undefined && byId.some((recordset) => recordset.recordsetType !== typeFilter)) {
      throw new NhnCloudCliError(
        `레코드 세트 ${value} 의 타입이 --type ${typeFilter} 와 다릅니다.`,
        EXIT_PARAM_ERROR,
      );
    }
    return byId;
  }
  const fqdn = toFqdn(value);
  const found = await withDnsplusSpinner("레코드 세트 조회 중...", () =>
    client.listRecordsets(zone.zoneId, { searchRecordsetName: fqdn }),
  );
  return found.filter(
    (recordset) =>
      recordset.recordsetName.toLowerCase() === fqdn &&
      (typeFilter === undefined || recordset.recordsetType === typeFilter),
  );
}

function requireSingle(matches: DnsplusRecordset[], input: string): DnsplusRecordset {
  if (matches.length === 0) {
    throw new NhnCloudCliError(`레코드 세트를 찾을 수 없습니다: ${input}`, EXIT_PARAM_ERROR);
  }
  if (matches.length > 1) {
    const types = matches.map((recordset) => `${recordset.recordsetType}(${recordset.recordsetId})`).join(", ");
    throw new NhnCloudCliError(
      `이름이 같은 레코드 세트가 여럿입니다: ${types}. --type 이나 레코드 세트 ID 로 지정하세요.`,
      EXIT_PARAM_ERROR,
    );
  }
  return matches[0] as DnsplusRecordset;
}

const listCommand = withDnsplusOptions(
  new Command("list")
    .description("존의 레코드 세트 목록을 조회한다")
    .requiredOption(ZONE_FLAG, ZONE_DESCRIPTION)
    .option("--name <name>", "레코드 세트 이름에 포함된 문자열로 검색한다")
    .option("--type <type>", "레코드 세트 타입으로 거른다 (A, CNAME, TXT)"),
).action(async (_opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<RecordsetListOptions>();
  const type = opts.type === undefined ? undefined : parseRecordsetType(opts.type);
  const client = await resolveDnsplusClient(opts);
  const zone = await resolveZone(client, opts.zone);
  const search = opts.name?.trim();
  const recordsets = await withDnsplusSpinner("레코드 세트 목록 조회 중...", () =>
    client.listRecordsets(zone.zoneId, {
      ...(search ? { searchRecordsetName: search } : {}),
      ...(type ? { recordsetTypeList: [type] } : {}),
    }),
  );
  output(opts, {
    headers: RECORDSET_HEADERS,
    rows: recordsets.map(recordsetRow),
    raw: recordsets,
    ids: recordsets.map((recordset) => recordset.recordsetId),
  });
});

const getCommand = withDnsplusOptions(
  new Command("get")
    .description("레코드 세트를 조회한다")
    .argument("<recordset>", "레코드 세트 ID(UUID) 또는 이름")
    .requiredOption(ZONE_FLAG, ZONE_DESCRIPTION)
    .option("--type <type>", "이름이 같은 레코드 세트가 여럿일 때 타입을 지정한다"),
).action(async (input: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<RecordsetSelectOptions>();
  const client = await resolveDnsplusClient(opts);
  const zone = await resolveZone(client, opts.zone);
  const recordset = requireSingle(await findRecordsets(client, zone, input, opts.type), input);
  output(opts, {
    headers: ["field", "value"],
    rows: [
      ["recordsetId", formatCell(recordset.recordsetId)],
      ["recordsetName", formatCell(recordset.recordsetName)],
      ["recordsetType", formatCell(recordset.recordsetType)],
      ["recordsetTtl", formatCell(recordset.recordsetTtl)],
      ["recordsetStatus", formatCell(recordset.recordsetStatus)],
      ["records", formatCell(formatRecords(recordset.recordList))],
      ["createdAt", formatCell(recordset.createdAt)],
      ["updatedAt", formatCell(recordset.updatedAt)],
    ],
    raw: recordset,
    ids: [recordset.recordsetId],
  });
});

const createCommand = withDnsplusWriteOptions(
  new Command("create")
    .description("레코드 세트를 만든다 (A, CNAME, TXT). 같은 이름이 있으면 덮지 않고 멈춘다")
    .requiredOption(ZONE_FLAG, ZONE_DESCRIPTION)
    .requiredOption("--name <name>", "레코드 세트 이름 (존 안의 FQDN, 끝 점은 생략 가능)")
    .requiredOption("--type <type>", "레코드 세트 타입 (A, CNAME, TXT)")
    .option("--value <value>", "레코드 값 (반복 지정 가능, CNAME 은 하나)", collectOption, [] as string[])
    .option("--ttl <seconds>", `TTL 초 (${MIN_TTL}~${MAX_TTL})`, String(DEFAULT_TTL)),
).action(async (_opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<RecordsetCreateOptions>();
  const type = parseRecordsetType(opts.type);
  const recordList = buildRecordList(type, opts.value);
  const ttl = parseIntegerOption(opts.ttl, "--ttl", { min: MIN_TTL, max: MAX_TTL });
  const dryRun = requireWriteMode(opts, "recordset create");

  const client = await resolveDnsplusClient(opts);
  const zone = await resolveZone(client, opts.zone);
  const recordsetName = parseRecordsetName(opts.name, zone.zoneName);

  const existing = await withDnsplusSpinner("같은 이름의 레코드 세트 확인 중...", () =>
    client.listRecordsets(zone.zoneId, { searchRecordsetName: recordsetName }),
  );
  const clash = existing.filter((recordset) => recordset.recordsetName.toLowerCase() === recordsetName);
  if (clash.length > 0) {
    const found = clash.map((recordset) => `${recordset.recordsetType}(${recordset.recordsetId})`).join(", ");
    throw new NhnCloudCliError(
      `같은 이름의 레코드 세트가 이미 있어 만들지 않습니다: ${recordsetName} ${found}`,
      EXIT_PARAM_ERROR,
    );
  }

  const body = { recordsetName, recordsetType: type, recordsetTtl: ttl, recordList };
  if (dryRun) {
    const request = {
      method: "POST",
      path: DnsplusClient.displayPath(`/zones/${zone.zoneId}/recordsets`),
      body: { recordset: body },
    };
    output(opts, {
      headers: ["method", "path", "body"],
      rows: [[request.method, request.path, JSON.stringify(request.body, null, 2)]],
      raw: { operation: "recordset-create", dry_run: true, requests: [request] },
      ids: [],
    });
    return;
  }

  const created = await withDnsplusSpinner(`레코드 세트 생성 중 (${recordsetName})...`, () =>
    client.createRecordset(zone.zoneId, body),
  );
  output(opts, {
    headers: RECORDSET_HEADERS,
    rows: [recordsetRow(created)],
    raw: created,
    ids: [created.recordsetId],
  });
});

const deleteCommand = withDnsplusWriteOptions(
  new Command("delete")
    .description("레코드 세트 하나를 지운다")
    .argument("<recordset>", "레코드 세트 ID(UUID) 또는 이름")
    .requiredOption(ZONE_FLAG, ZONE_DESCRIPTION)
    .option("--type <type>", "이름이 같은 레코드 세트가 여럿일 때 타입을 지정한다"),
).action(async (input: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<RecordsetDeleteOptions>();
  const dryRun = requireWriteMode(opts, "recordset delete");

  const client = await resolveDnsplusClient(opts);
  const zone = await resolveZone(client, opts.zone);
  const recordset = requireSingle(await findRecordsets(client, zone, input, opts.type), input);
  if (recordset.recordsetType === "SOA") {
    throw new NhnCloudCliError("SOA 레코드 세트는 지울 수 없습니다.", EXIT_PARAM_ERROR);
  }

  if (dryRun) {
    const request = {
      method: "DELETE",
      path: DnsplusClient.displayPath(`/zones/${zone.zoneId}/recordsets?recordsetIdList=${recordset.recordsetId}`),
    };
    output(opts, {
      headers: ["method", "path", "body"],
      rows: [[request.method, request.path, ""]],
      raw: { operation: "recordset-delete", dry_run: true, requests: [request] },
      ids: [],
    });
    return;
  }

  await withDnsplusSpinner(`레코드 세트 삭제 중 (${recordset.recordsetName})...`, () =>
    client.deleteRecordsets(zone.zoneId, [recordset.recordsetId]),
  );
  const result = {
    operation: "recordset-delete",
    status: "succeeded",
    zoneId: zone.zoneId,
    recordsetId: recordset.recordsetId,
    recordsetName: recordset.recordsetName,
    recordsetType: recordset.recordsetType,
  };
  output(opts, {
    headers: ["field", "value"],
    rows: Object.entries(result).map(([key, value]) => [key, formatCell(value)]),
    raw: result,
    ids: [recordset.recordsetId],
  });
});

export const recordsetCommand = new Command("recordset")
  .description("DNS Plus 레코드 세트 조회·생성·삭제 명령")
  .addCommand(listCommand)
  .addCommand(getCommand)
  .addCommand(createCommand)
  .addCommand(deleteCommand);
