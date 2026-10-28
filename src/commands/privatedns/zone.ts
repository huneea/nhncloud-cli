import { Command } from "commander";
import { output } from "../../formatters/table.js";
import type { PrivateDnsZone } from "../../services/privatedns/types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { collectOption } from "../loadbalancer/helpers.js";
import { optionalInput, withSpinner } from "../loadbalancer/lbaas-helpers.js";
import { outputDryRun, requireWriteMode } from "../write-mode.js";
import {
  countUserRecordSets,
  mergeZoneNetworks,
  normalizeZoneName,
  resolvePrivateDnsClients,
  resolveVpcIds,
  resolveZone,
  withPrivateDnsOptions,
  type PrivateDnsGlobalOpts,
  type PrivateDnsWriteOpts,
} from "./helpers.js";

// Private DNS zone 명령 (ADR-049).

interface ZoneListOpts extends PrivateDnsGlobalOpts {
  name?: string;
}

interface ZoneCreateOpts extends PrivateDnsWriteOpts {
  name: string;
  network: string[];
  description?: string;
}

interface ZoneUpdateOpts extends PrivateDnsWriteOpts {
  description?: string;
  network?: string[];
  addNetwork?: string[];
  removeNetwork?: string[];
}

interface ZoneDeleteOpts extends PrivateDnsWriteOpts {
  force?: boolean;
}

function paramError(message: string): NhnCloudCliError {
  return new NhnCloudCliError(message, EXIT_PARAM_ERROR);
}

function outputZone(opts: PrivateDnsGlobalOpts, zone: PrivateDnsZone): void {
  output(opts, {
    headers: ["field", "value"],
    rows: [
      ["id", zone.id],
      ["name", zone.name],
      ["status", zone.status],
      ["description", zone.description ?? ""],
      ["networks", zone.networks.join(", ")],
      ["rrset_count", zone.rrset_count === undefined ? "" : String(zone.rrset_count)],
      ["created_at", zone.created_at],
      ["updated_at", zone.updated_at],
    ],
    raw: zone,
    ids: [zone.id],
  });
}

const listCommand = withPrivateDnsOptions(
  new Command("list")
    .description("Private DNS zone 목록을 조회한다 (전체 필드는 --json)")
    .option("--name <name>", "zone 이름으로 거른다 (끝의 . 는 생략 가능)"),
).action(async (_opts: unknown, cmd: Command) => {
  const opts = cmd.optsWithGlobals<ZoneListOpts>();
  const nameInput = optionalInput(opts.name, "--name");
  const name = nameInput === undefined ? undefined : normalizeZoneName(nameInput);
  const { dns } = await resolvePrivateDnsClients(opts);
  const zones = await withSpinner("zone 목록 조회 중...", () => dns.listZones({ name }));

  output(opts, {
    headers: ["id", "name", "status", "records", "vpcs", "description"],
    rows: zones.map((zone) => [
      zone.id,
      zone.name,
      zone.status,
      zone.rrset_count === undefined ? "" : String(zone.rrset_count),
      String(zone.networks.length),
      zone.description ?? "",
    ]),
    raw: zones,
    ids: zones.map((zone) => zone.id),
  });
});

const getCommand = withPrivateDnsOptions(
  new Command("get").description("zone 을 이름 또는 UUID로 조회한다").argument("<zone>", "zone 이름 또는 UUID"),
).action(async (zoneInput: string, _opts: unknown, cmd: Command) => {
  const opts = cmd.optsWithGlobals<PrivateDnsGlobalOpts>();
  const { dns } = await resolvePrivateDnsClients(opts);
  const zone = await withSpinner("zone 조회 중...", async () =>
    dns.getZone((await resolveZone(dns, zoneInput)).id),
  );
  outputZone(opts, zone);
});

const createCommand = withPrivateDnsOptions(
  new Command("create")
    .description("zone 을 만든다 (생성 직후 상태는 BUILD 이며 기다리지 않는다)")
    .requiredOption("--name <name>", "zone 이름 (끝의 . 는 생략 가능)")
    .requiredOption("--network <vpc>", "연결할 VPC 이름 또는 UUID (반복 지정 가능)", collectOption)
    .option("--description <text>", "zone 설명")
    .option("--dry-run", "쓰기 없이 보낼 요청 본문을 출력한다")
    .option("--yes", "zone 생성 확인"),
).action(async (_opts: unknown, cmd: Command) => {
  const opts = cmd.optsWithGlobals<ZoneCreateOpts>();
  const dryRun = requireWriteMode(opts, "Private DNS zone 생성");
  const name = normalizeZoneName(opts.name);
  const { dns, network } = await resolvePrivateDnsClients(opts);

  const planned = await withSpinner("zone 생성 준비 중...", async () => {
    const existing = (await dns.listZones({ name })).find(
      (zone) => zone.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing) {
      throw paramError(
        `이미 같은 이름의 zone 이 있습니다: ${existing.name} (${existing.id}). 설정을 바꾸려면 zone update 를 쓰세요.`,
      );
    }
    const networks = [...new Set(await resolveVpcIds(network, opts.network))];
    return { name, networks, ...(opts.description === undefined ? {} : { description: opts.description }) };
  });

  if (dryRun) {
    outputDryRun(opts, "privatedns-zone-create", [
      { method: "POST", path: "/v2.0/privatedns/zones", body: { zone: planned } },
    ]);
    return;
  }
  outputZone(opts, await withSpinner("zone 생성 중...", () => dns.createZone(planned)));
});

const updateCommand = withPrivateDnsOptions(
  new Command("update")
    .description("zone 설명과 연결 VPC 를 바꾼다 (준 항목만 바꾸고 나머지는 현재 값을 유지한다)")
    .argument("<zone>", "zone 이름 또는 UUID")
    .option("--description <text>", "zone 설명 (빈 문자열이면 설명을 비운다)")
    .option("--network <vpc>", "연결 VPC 목록을 이 값들로 바꾼다 (반복 지정 가능)", collectOption)
    .option("--add-network <vpc>", "VPC 를 추가로 연결한다 (반복 지정 가능)", collectOption)
    .option("--remove-network <vpc>", "VPC 연결을 끊는다 (반복 지정 가능)", collectOption)
    .option("--dry-run", "쓰기 없이 보낼 요청 본문을 출력한다")
    .option("--yes", "zone 수정 확인"),
).action(async (zoneInput: string, _opts: unknown, cmd: Command) => {
  const opts = cmd.optsWithGlobals<ZoneUpdateOpts>();
  const replaceInputs = opts.network ?? [];
  const addInputs = opts.addNetwork ?? [];
  const removeInputs = opts.removeNetwork ?? [];
  if (
    opts.description === undefined &&
    replaceInputs.length === 0 &&
    addInputs.length === 0 &&
    removeInputs.length === 0
  ) {
    throw paramError("--description, --network, --add-network, --remove-network 중 하나는 필요합니다.");
  }
  if (replaceInputs.length > 0 && (addInputs.length > 0 || removeInputs.length > 0)) {
    throw paramError("--network는 --add-network, --remove-network와 함께 쓸 수 없습니다.");
  }
  const dryRun = requireWriteMode(opts, "Private DNS zone 수정");
  const { dns, network } = await resolvePrivateDnsClients(opts);

  const planned = await withSpinner("zone 수정 준비 중...", async () => {
    const zone = await dns.getZone((await resolveZone(dns, zoneInput)).id);
    // 이미 지워진 VPC 의 UUID 가 zone 에 남아 있어도 뺄 수 있도록 현재 연결 UUID 는 목록 조회 없이 쓴다.
    const attachedRemovals = removeInputs.filter((value) => zone.networks.includes(value.trim()));
    const namedRemovals = removeInputs.filter((value) => !zone.networks.includes(value.trim()));
    const networks = mergeZoneNetworks(zone.networks, {
      replace: await resolveVpcIds(network, replaceInputs),
      add: await resolveVpcIds(network, addInputs),
      remove: [...attachedRemovals.map((value) => value.trim()), ...(await resolveVpcIds(network, namedRemovals))],
    });
    const description = opts.description === undefined ? (zone.description ?? "") : opts.description;
    return { zoneId: zone.id, body: { description, networks } };
  });

  if (dryRun) {
    outputDryRun(opts, "privatedns-zone-update", [
      { method: "PUT", path: `/v2.0/privatedns/zones/${planned.zoneId}`, body: { zone: planned.body } },
    ]);
    return;
  }
  outputZone(opts, await withSpinner("zone 수정 중...", () => dns.updateZone(planned.zoneId, planned.body)));
});

const deleteCommand = withPrivateDnsOptions(
  new Command("delete")
    .description("zone 을 지운다 (SOA, apex NS 외 레코드 세트가 남아 있으면 --force 가 필요하다)")
    .argument("<zone>", "zone 이름 또는 UUID")
    .option("--force", "레코드 세트가 남아 있어도 zone 과 함께 지운다")
    .option("--dry-run", "쓰기 없이 보낼 요청을 출력한다")
    .option("--yes", "zone 삭제 확인"),
).action(async (zoneInput: string, _opts: unknown, cmd: Command) => {
  const opts = cmd.optsWithGlobals<ZoneDeleteOpts>();
  const dryRun = requireWriteMode(opts, "Private DNS zone 삭제");
  const { dns } = await resolvePrivateDnsClients(opts);

  const zone = await withSpinner("zone 삭제 준비 중...", async () => {
    const target = await resolveZone(dns, zoneInput);
    const remaining = countUserRecordSets(await dns.listRecordSets(target.id), target.name);
    if (remaining > 0 && !opts.force) {
      throw paramError(
        `zone 에 레코드 세트 ${remaining}개가 남아 있습니다(SOA, apex NS 제외). 지우려면 --force 를 함께 주세요.`,
      );
    }
    return target;
  });

  if (dryRun) {
    outputDryRun(opts, "privatedns-zone-delete", [
      { method: "DELETE", path: `/v2.0/privatedns/zones/${zone.id}` },
    ]);
    return;
  }
  await withSpinner("zone 삭제 중...", () => dns.deleteZone(zone.id));
  output(opts, {
    headers: ["field", "value"],
    rows: [
      ["operation", "privatedns-zone-delete"],
      ["status", "succeeded"],
      ["zone_id", zone.id],
    ],
    raw: { operation: "privatedns-zone-delete", status: "succeeded", zone_id: zone.id },
    ids: [zone.id],
  });
});

export const zoneCommand = new Command("zone")
  .description("Private DNS zone 조회·생성·수정·삭제")
  .addCommand(listCommand)
  .addCommand(getCommand)
  .addCommand(createCommand)
  .addCommand(updateCommand)
  .addCommand(deleteCommand);
