import { Command } from "commander";
import { output } from "../../formatters/table.js";
import type { PrivateDnsRecordSet } from "../../services/privatedns/types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { collectOption } from "../loadbalancer/helpers.js";
import { optionalInput, withSpinner } from "../loadbalancer/lbaas-helpers.js";
import { parseIntegerOption } from "../parse-options.js";
import { outputDryRun, requireWriteMode } from "../write-mode.js";
import {
  assertWritableRecordSet,
  mergeRecordSetUpdate,
  parseRecordType,
  resolvePrivateDnsClients,
  resolveRecordSet,
  resolveZone,
  toRecordName,
  withPrivateDnsOptions,
  type PrivateDnsGlobalOpts,
  type PrivateDnsWriteOpts,
} from "./helpers.js";

// Private DNS 레코드 세트 명령 (ADR-050).

interface RecordListOpts extends PrivateDnsGlobalOpts {
  name?: string;
  type?: string;
}

interface RecordGetOpts extends PrivateDnsGlobalOpts {
  type?: string;
}

interface RecordCreateOpts extends PrivateDnsWriteOpts {
  name: string;
  type: string;
  record: string[];
  ttl?: string;
  description?: string;
}

interface RecordUpdateOpts extends PrivateDnsWriteOpts {
  type?: string;
  record?: string[];
  ttl?: string;
  description?: string;
}

interface RecordDeleteOpts extends PrivateDnsWriteOpts {
  type?: string;
}

function paramError(message: string): NhnCloudCliError {
  return new NhnCloudCliError(message, EXIT_PARAM_ERROR);
}

function parseRecordValues(values: string[]): string[] {
  return values.map((value) => {
    const trimmed = value.trim();
    if (!trimmed) throw paramError("--record 값이 비어 있습니다.");
    return trimmed;
  });
}

function outputRecordSet(opts: PrivateDnsGlobalOpts, rrset: PrivateDnsRecordSet): void {
  output(opts, {
    headers: ["field", "value"],
    rows: [
      ["id", rrset.id],
      ["name", rrset.name],
      ["type", rrset.type],
      ["ttl", String(rrset.ttl)],
      ["records", rrset.records.map((record) => record.content).join("\n")],
      ["description", rrset.description ?? ""],
      ["zone_id", rrset.zone_id],
      ["created_at", rrset.created_at],
      ["updated_at", rrset.updated_at ?? ""],
    ],
    raw: rrset,
    ids: [rrset.id],
  });
}

const listCommand = withPrivateDnsOptions(
  new Command("list")
    .description("zone 의 레코드 세트 목록을 조회한다 (전체 필드는 --json)")
    .argument("<zone>", "zone 이름 또는 UUID")
    .option("--name <name>", "레코드 이름으로 거른다 (상대 이름, FQDN, @)")
    .option("--type <type>", "레코드 타입으로 거른다"),
).action(async (zoneInput: string, _opts: unknown, cmd: Command) => {
  const opts = cmd.optsWithGlobals<RecordListOpts>();
  const typeInput = optionalInput(opts.type, "--type");
  const type = typeInput === undefined ? undefined : parseRecordType(typeInput);
  const nameInput = optionalInput(opts.name, "--name");
  const { dns } = await resolvePrivateDnsClients(opts);

  const rrsets = await withSpinner("레코드 세트 목록 조회 중...", async () => {
    const zone = await resolveZone(dns, zoneInput);
    const name = nameInput === undefined ? undefined : toRecordName(nameInput, zone.name);
    return dns.listRecordSets(zone.id, { name, type });
  });

  output(opts, {
    headers: ["id", "name", "type", "ttl", "records", "description"],
    rows: rrsets.map((rrset) => [
      rrset.id,
      rrset.name,
      rrset.type,
      String(rrset.ttl),
      rrset.records.map((record) => record.content).join(", "),
      rrset.description ?? "",
    ]),
    raw: rrsets,
    ids: rrsets.map((rrset) => rrset.id),
  });
});

const getCommand = withPrivateDnsOptions(
  new Command("get")
    .description("레코드 세트를 UUID, FQDN, 상대 이름, @ 로 조회한다")
    .argument("<zone>", "zone 이름 또는 UUID")
    .argument("<record>", "레코드 세트 UUID, FQDN, 상대 이름, @")
    .option("--type <type>", "이름이 같은 레코드 세트가 여럿일 때 타입으로 고른다"),
).action(async (zoneInput: string, recordInput: string, _opts: unknown, cmd: Command) => {
  const opts = cmd.optsWithGlobals<RecordGetOpts>();
  const typeInput = optionalInput(opts.type, "--type");
  const type = typeInput === undefined ? undefined : parseRecordType(typeInput);
  const { dns } = await resolvePrivateDnsClients(opts);
  const rrset = await withSpinner("레코드 세트 조회 중...", async () => {
    const zone = await resolveZone(dns, zoneInput);
    return resolveRecordSet(dns, zone, recordInput, type);
  });
  outputRecordSet(opts, rrset);
});

const createCommand = withPrivateDnsOptions(
  new Command("create")
    .description("레코드 세트를 만든다 (SOA 는 만들 수 없다)")
    .argument("<zone>", "zone 이름 또는 UUID")
    .requiredOption("--name <name>", "레코드 이름 (상대 이름, FQDN, @)")
    .requiredOption("--type <type>", "레코드 타입 (A, AAAA, CNAME, MX, TXT 등)")
    .requiredOption("--record <value>", "레코드 값 (반복 지정 가능)", collectOption)
    .option("--ttl <seconds>", "TTL 초 (생략하면 서버 기본값)")
    .option("--description <text>", "레코드 세트 설명")
    .option("--dry-run", "쓰기 없이 보낼 요청 본문을 출력한다")
    .option("--yes", "레코드 세트 생성 확인"),
).action(async (zoneInput: string, _opts: unknown, cmd: Command) => {
  const opts = cmd.optsWithGlobals<RecordCreateOpts>();
  const type = parseRecordType(opts.type);
  if (type === "SOA") throw paramError("SOA 레코드 세트는 만들 수 없습니다.");
  const nameInput = optionalInput(opts.name, "--name");
  if (nameInput === undefined) throw paramError("레코드 세트 이름이 비어 있습니다.");
  const values = parseRecordValues(opts.record);
  const ttl = parseIntegerOption(opts.ttl, "--ttl", { min: 1 });
  const dryRun = requireWriteMode(opts, "레코드 세트 생성");
  const { dns } = await resolvePrivateDnsClients(opts);

  const planned = await withSpinner("레코드 세트 생성 준비 중...", async () => {
    const zone = await resolveZone(dns, zoneInput);
    const name = toRecordName(nameInput, zone.name);
    const existing = (await dns.listRecordSets(zone.id)).find(
      (rrset) => rrset.name.toLowerCase() === name.toLowerCase() && rrset.type === type,
    );
    if (existing) {
      throw paramError(
        `이미 같은 이름과 타입의 레코드 세트가 있습니다: ${existing.name} ${existing.type} (${existing.id}). 값을 바꾸려면 record update 를 쓰세요.`,
      );
    }
    return {
      zoneId: zone.id,
      body: {
        name,
        type,
        records: values.map((content) => ({ content })),
        ...(ttl === undefined ? {} : { ttl }),
        description: opts.description ?? "",
      },
    };
  });

  if (dryRun) {
    outputDryRun(opts, "privatedns-record-create", [
      {
        method: "POST",
        path: `/v2.0/privatedns/zones/${planned.zoneId}/rrsets`,
        body: { rrset: planned.body },
      },
    ]);
    return;
  }
  outputRecordSet(
    opts,
    await withSpinner("레코드 세트 생성 중...", () => dns.createRecordSet(planned.zoneId, planned.body)),
  );
});

const updateCommand = withPrivateDnsOptions(
  new Command("update")
    .description("레코드 세트의 값, TTL, 설명을 바꾼다 (준 항목만 바꾸고 나머지는 현재 값을 유지한다)")
    .argument("<zone>", "zone 이름 또는 UUID")
    .argument("<record>", "레코드 세트 UUID, FQDN, 상대 이름, @")
    .option("--type <type>", "이름이 같은 레코드 세트가 여럿일 때 대상을 타입으로 고른다 (타입 변경은 지원하지 않는다)")
    .option("--record <value>", "레코드 목록을 이 값들로 바꾼다 (반복 지정 가능)", collectOption)
    .option("--ttl <seconds>", "TTL 초")
    .option("--description <text>", "설명 (빈 문자열이면 설명을 비운다)")
    .option("--dry-run", "쓰기 없이 보낼 요청 본문을 출력한다")
    .option("--yes", "레코드 세트 수정 확인"),
).action(async (zoneInput: string, recordInput: string, _opts: unknown, cmd: Command) => {
  const opts = cmd.optsWithGlobals<RecordUpdateOpts>();
  const typeInput = optionalInput(opts.type, "--type");
  const type = typeInput === undefined ? undefined : parseRecordType(typeInput);
  const recordInputs = opts.record ?? [];
  if (recordInputs.length === 0 && opts.ttl === undefined && opts.description === undefined) {
    throw paramError("--record, --ttl, --description 중 하나는 필요합니다.");
  }
  const records = recordInputs.length === 0 ? undefined : parseRecordValues(recordInputs);
  const ttl = parseIntegerOption(opts.ttl, "--ttl", { min: 1 });
  const dryRun = requireWriteMode(opts, "레코드 세트 수정");
  const { dns } = await resolvePrivateDnsClients(opts);

  const planned = await withSpinner("레코드 세트 수정 준비 중...", async () => {
    const zone = await resolveZone(dns, zoneInput);
    const current = await resolveRecordSet(dns, zone, recordInput, type);
    assertWritableRecordSet(current, zone.name);
    return {
      zoneId: zone.id,
      rrsetId: current.id,
      body: mergeRecordSetUpdate(current, { records, ttl, description: opts.description }),
    };
  });

  if (dryRun) {
    outputDryRun(opts, "privatedns-record-update", [
      {
        method: "PUT",
        path: `/v2.0/privatedns/zones/${planned.zoneId}/rrsets/${planned.rrsetId}`,
        body: { rrset: planned.body },
      },
    ]);
    return;
  }
  outputRecordSet(
    opts,
    await withSpinner("레코드 세트 수정 중...", () =>
      dns.updateRecordSet(planned.zoneId, planned.rrsetId, planned.body),
    ),
  );
});

const deleteCommand = withPrivateDnsOptions(
  new Command("delete")
    .description("레코드 세트를 지운다 (SOA 와 zone apex NS 는 지울 수 없다)")
    .argument("<zone>", "zone 이름 또는 UUID")
    .argument("<record>", "레코드 세트 UUID, FQDN, 상대 이름, @")
    .option("--type <type>", "이름이 같은 레코드 세트가 여럿일 때 타입으로 고른다")
    .option("--dry-run", "쓰기 없이 보낼 요청을 출력한다")
    .option("--yes", "레코드 세트 삭제 확인"),
).action(async (zoneInput: string, recordInput: string, _opts: unknown, cmd: Command) => {
  const opts = cmd.optsWithGlobals<RecordDeleteOpts>();
  const typeInput = optionalInput(opts.type, "--type");
  const type = typeInput === undefined ? undefined : parseRecordType(typeInput);
  const dryRun = requireWriteMode(opts, "레코드 세트 삭제");
  const { dns } = await resolvePrivateDnsClients(opts);

  const target = await withSpinner("레코드 세트 삭제 준비 중...", async () => {
    const zone = await resolveZone(dns, zoneInput);
    const rrset = await resolveRecordSet(dns, zone, recordInput, type);
    assertWritableRecordSet(rrset, zone.name);
    return { zoneId: zone.id, rrsetId: rrset.id };
  });

  if (dryRun) {
    outputDryRun(opts, "privatedns-record-delete", [
      { method: "DELETE", path: `/v2.0/privatedns/zones/${target.zoneId}/rrsets/${target.rrsetId}` },
    ]);
    return;
  }
  await withSpinner("레코드 세트 삭제 중...", () => dns.deleteRecordSet(target.zoneId, target.rrsetId));
  output(opts, {
    headers: ["field", "value"],
    rows: [
      ["operation", "privatedns-record-delete"],
      ["status", "succeeded"],
      ["zone_id", target.zoneId],
      ["rrset_id", target.rrsetId],
    ],
    raw: {
      operation: "privatedns-record-delete",
      status: "succeeded",
      zone_id: target.zoneId,
      rrset_id: target.rrsetId,
    },
    ids: [target.rrsetId],
  });
});

export const recordCommand = new Command("record")
  .description("Private DNS 레코드 세트 조회·생성·수정·삭제")
  .addCommand(listCommand)
  .addCommand(getCommand)
  .addCommand(createCommand)
  .addCommand(updateCommand)
  .addCommand(deleteCommand);
