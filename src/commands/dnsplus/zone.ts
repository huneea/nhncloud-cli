import { Command } from "commander";
import { output } from "../../formatters/table.js";
import {
  formatCell,
  resolveDnsplusClient,
  resolveZone,
  withDnsplusOptions,
  withDnsplusSpinner,
  type DnsplusCommandOptions,
} from "./helpers.js";

interface ZoneListOptions extends DnsplusCommandOptions {
  name?: string;
}

const listCommand = withDnsplusOptions(
  new Command("list")
    .description("DNS Zone 목록을 조회한다")
    .option("--name <name>", "존 이름에 포함된 문자열로 검색한다"),
).action(async (_opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<ZoneListOptions>();
  const client = await resolveDnsplusClient(opts);
  const search = opts.name?.trim();
  const zones = await withDnsplusSpinner("DNS Zone 목록 조회 중...", () =>
    client.listZones(search ? { searchZoneName: search } : {}),
  );
  output(opts, {
    headers: ["zoneId", "zoneName", "status", "recordsets", "description"],
    rows: zones.map((zone) => [
      formatCell(zone.zoneId),
      formatCell(zone.zoneName),
      formatCell(zone.zoneStatus),
      formatCell(zone.recordsetCount),
      formatCell(zone.description),
    ]),
    raw: zones,
    ids: zones.map((zone) => zone.zoneId),
  });
});

// 공식 API 에 존 단건 조회가 없어 목록에서 ID 로 걸러 낸다 (ADR-049).
const getCommand = withDnsplusOptions(
  new Command("get").description("DNS Zone 하나를 조회한다").argument("<zone>", "존 ID(UUID) 또는 존 이름"),
).action(async (zoneInput: string, _opts: unknown, command: Command) => {
  const opts = command.optsWithGlobals<DnsplusCommandOptions>();
  const client = await resolveDnsplusClient(opts);
  const zone = await resolveZone(client, zoneInput);
  output(opts, {
    headers: ["field", "value"],
    rows: [
      ["zoneId", formatCell(zone.zoneId)],
      ["zoneName", formatCell(zone.zoneName)],
      ["zoneStatus", formatCell(zone.zoneStatus)],
      ["engineId", formatCell(zone.engineId)],
      ["recordsetCount", formatCell(zone.recordsetCount)],
      ["description", formatCell(zone.description)],
      ["createdAt", formatCell(zone.createdAt)],
      ["updatedAt", formatCell(zone.updatedAt)],
    ],
    raw: zone,
    ids: [zone.zoneId],
  });
});

export const zoneCommand = new Command("zone")
  .description("DNS Plus 존 조회 명령")
  .addCommand(listCommand)
  .addCommand(getCommand);

