import type { Command } from "commander";
import { assertPrivateDnsRegion } from "../../api/endpoints.js";
import { getIaasCredential, getProfileEnvironment, resolveProfileName } from "../../config/credentials.js";
import type { OutputOptions } from "../../formatters/table.js";
import { NetworkClient } from "../../services/network/client.js";
import { PrivateDnsClient } from "../../services/privatedns/client.js";
import {
  PRIVATE_DNS_RECORD_TYPES,
  type PrivateDnsRecordSet,
  type PrivateDnsRecordType,
  type PrivateDnsZone,
  type UpdatePrivateDnsRecordSetParams,
} from "../../services/privatedns/types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { resolveIaasTokenContext, type IaasResolverOpts } from "../iaas.js";
import { requireResourceInput, resolveFromList } from "../resource-resolver.js";
import type { WriteModeOpts } from "../write-mode.js";

// Private DNS zone·레코드 세트 명령이 함께 쓰는 이름 해석·보호·병합 도우미 (ADR-050).

export interface PrivateDnsGlobalOpts extends OutputOptions {
  region?: string;
  profile?: string;
}

export interface PrivateDnsWriteOpts extends PrivateDnsGlobalOpts, WriteModeOpts {}

function paramError(message: string): NhnCloudCliError {
  return new NhnCloudCliError(message, EXIT_PARAM_ERROR);
}

/** region 은 토큰을 발급하기 전에 판정한다. 주소가 없는 region 은 API 호출 전에 거부한다 (ADR-037). */
export async function resolvePrivateDnsClients(
  opts: IaasResolverOpts,
): Promise<{ dns: PrivateDnsClient; network: NetworkClient; profileName: string }> {
  const profileName = await resolveProfileName(opts.profile);
  const region = opts.region ?? (await getIaasCredential(profileName)).region;
  const environment = await getProfileEnvironment(profileName);
  assertPrivateDnsRegion(region, environment);

  const { tokenId, networkEndpoint } = await resolveIaasTokenContext(opts);
  return {
    dns: new PrivateDnsClient(tokenId, networkEndpoint),
    network: new NetworkClient(tokenId, networkEndpoint),
    profileName,
  };
}

export function withPrivateDnsOptions(command: Command): Command {
  return command
    .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
    .option("--profile <name>", "사용할 profile 이름");
}

export function normalizeZoneName(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw paramError("Private DNS zone 이름이 비어 있습니다.");
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}

/** UUID 가 같은 zone, 아니면 대소문자를 무시해 이름이 같은 zone 하나를 고른다. */
export async function resolveZone(
  client: Pick<PrivateDnsClient, "listZones">,
  input: string,
): Promise<PrivateDnsZone> {
  const value = requireResourceInput(input, "Private DNS zone");
  const zones = await client.listZones();
  const exactId = zones.find((zone) => zone.id === value);
  if (exactId) return exactId;

  const name = normalizeZoneName(value).toLowerCase();
  const matches = zones.filter((zone) => zone.name.toLowerCase() === name);
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    throw paramError(`Private DNS zone을(를) 찾을 수 없습니다: ${JSON.stringify(value)}`);
  }
  const candidateIds = matches.map((zone) => zone.id).sort();
  throw paramError(
    `Private DNS zone 이름이 중복됩니다: ${JSON.stringify(value)} (후보 UUID: ${candidateIds.join(", ")})`,
  );
}

/** `@` 는 zone apex, 끝이 `.` 이면 FQDN, 그 밖은 zone 이름을 붙인 상대 이름이다. zoneName 은 정규화된 값이다. */
export function toRecordName(input: string, zoneName: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw paramError("레코드 세트 이름이 비어 있습니다.");
  if (trimmed === "@") return zoneName;
  if (trimmed.endsWith(".")) return trimmed;
  return `${trimmed}.${zoneName}`;
}

export function parseRecordType(value: string): PrivateDnsRecordType {
  const normalized = value.trim().toUpperCase();
  const matched = PRIVATE_DNS_RECORD_TYPES.find((type) => type === normalized);
  if (!matched) {
    throw paramError(
      `--type은 ${PRIVATE_DNS_RECORD_TYPES.join(", ")} 중 하나여야 합니다: ${JSON.stringify(value)}`,
    );
  }
  return matched;
}

/** 같은 이름에 타입이 다른 레코드 세트가 공존하므로 타입으로 좁히고, 남은 후보를 `타입:UUID` 로 보여 준다. */
export async function resolveRecordSet(
  client: Pick<PrivateDnsClient, "listRecordSets">,
  zone: PrivateDnsZone,
  input: string,
  type?: PrivateDnsRecordType,
): Promise<PrivateDnsRecordSet> {
  const value = requireResourceInput(input, "레코드 세트");
  const notFound = paramError(`레코드 세트를 찾을 수 없습니다: ${JSON.stringify(value)}`);
  const rrsets = await client.listRecordSets(zone.id);

  const exactId = rrsets.find((rrset) => rrset.id === value);
  if (exactId) {
    if (type !== undefined && exactId.type !== type) throw notFound;
    return exactId;
  }

  const name = toRecordName(value, zone.name);
  const lowerName = name.toLowerCase();
  const matches = rrsets.filter(
    (rrset) => rrset.name.toLowerCase() === lowerName && (type === undefined || rrset.type === type),
  );
  if (matches.length === 1) return matches[0];
  if (matches.length === 0) throw notFound;
  const candidates = matches.map((rrset) => `${rrset.type}:${rrset.id}`).sort();
  throw paramError(
    `이름이 같은 레코드 세트가 ${matches.length}개 있습니다: ${name} (후보: ${candidates.join(", ")}). --type 으로 고르세요.`,
  );
}

/** SOA 와 zone apex 의 NS 는 서버가 관리하는 레코드 세트다 (ADR-050). */
export function isProtectedRecordSet(
  rrset: Pick<PrivateDnsRecordSet, "name" | "type">,
  zoneName: string,
): boolean {
  if (rrset.type === "SOA") return true;
  return rrset.type === "NS" && rrset.name.toLowerCase() === zoneName.toLowerCase();
}

export function assertWritableRecordSet(
  rrset: Pick<PrivateDnsRecordSet, "name" | "type">,
  zoneName: string,
): void {
  if (isProtectedRecordSet(rrset, zoneName)) {
    throw paramError(
      `SOA 와 zone apex NS 레코드 세트는 바꾸거나 지울 수 없습니다: ${rrset.type} ${rrset.name}`,
    );
  }
}

export function countUserRecordSets(
  rrsets: Pick<PrivateDnsRecordSet, "name" | "type">[],
  zoneName: string,
): number {
  return rrsets.filter((rrset) => !isProtectedRecordSet(rrset, zoneName)).length;
}

/** PUT 은 전체 교체라서, 바꾸지 않는 필드는 현재 값으로 채운다 (ADR-050). */
export function mergeRecordSetUpdate(
  current: PrivateDnsRecordSet,
  change: { records?: string[]; ttl?: number; description?: string },
): UpdatePrivateDnsRecordSetParams {
  return {
    type: current.type,
    records: change.records
      ? change.records.map((content) => ({ content }))
      : current.records.map(({ content }) => ({ content })),
    ttl: change.ttl ?? current.ttl,
    description: change.description ?? current.description ?? "",
  };
}

/** 입력은 이미 VPC UUID 로 해석된 값이다. 빈 목록은 그 옵션을 주지 않은 것으로 본다. */
export function mergeZoneNetworks(
  current: string[],
  change: { replace?: string[]; add?: string[]; remove?: string[] },
): string[] {
  const replace = change.replace ?? [];
  const add = change.add ?? [];
  const remove = change.remove ?? [];
  if (replace.length > 0 && (add.length > 0 || remove.length > 0)) {
    throw paramError("--network는 --add-network, --remove-network와 함께 쓸 수 없습니다.");
  }

  let merged: string[];
  if (replace.length > 0) {
    merged = [...new Set(replace)];
  } else {
    const missing = remove.find((id) => !current.includes(id));
    if (missing !== undefined) throw paramError(`연결되지 않은 VPC 입니다: ${missing}`);
    merged = current.filter((id) => !remove.includes(id));
    for (const id of add) {
      if (!merged.includes(id)) merged.push(id);
    }
  }
  if (merged.length === 0) throw paramError("zone 에는 VPC 가 하나 이상 연결되어야 합니다.");
  return merged;
}

export async function resolveVpcIds(
  network: Pick<NetworkClient, "listVpcs">,
  inputs: string[],
): Promise<string[]> {
  const values = inputs.map((input) => requireResourceInput(input, "VPC"));
  if (values.length === 0) return [];
  const vpcs = await network.listVpcs();
  return values.map((value) => resolveFromList(vpcs, value, "VPC"));
}
