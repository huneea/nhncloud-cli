import type { Command } from "commander";
import { resolveIaasTokenContext, type IaasResolverOpts } from "../iaas.js";
import { NetworkClient } from "../../services/network/client.js";
import { InstanceClient } from "../../services/instance/client.js";
import type { SecurityGroupRule } from "../../services/network/types.js";
import { requireResourceInput, resolveFromList } from "../resource-resolver.js";

/**
 * profile 해석 → iaas 자격증명 로드 → region override → Keystone 토큰 교환 → NetworkClient 생성.
 * Keystone 토큰·endpoint 해석은 instance 와 공유한다 (새 토큰 발급 없음).
 * spinner 시작 *전* (파라미터 검증·자격증명 로드 단계) 에 호출한다.
 */
export async function resolveNetworkClient(
  opts: IaasResolverOpts,
): Promise<{ client: NetworkClient; profileName: string }> {
  const { profileName, tokenId, networkEndpoint } = await resolveIaasTokenContext(opts);
  return { client: new NetworkClient(tokenId, networkEndpoint), profileName };
}

export async function resolveSecurityGroupClients(
  opts: IaasResolverOpts,
): Promise<{ network: NetworkClient; instance: InstanceClient; profileName: string }> {
  const { profileName, tokenId, networkEndpoint, computeEndpoint, imageEndpoint } =
    await resolveIaasTokenContext(opts);
  return {
    network: new NetworkClient(tokenId, networkEndpoint),
    instance: new InstanceClient(tokenId, computeEndpoint, imageEndpoint),
    profileName,
  };
}

export async function resolveSecurityGroupId(
  client: Pick<NetworkClient, "listSecurityGroups">,
  value: string,
): Promise<string> {
  const input = requireResourceInput(value, "보안그룹");
  return resolveFromList(await client.listSecurityGroups(), input, "보안그룹");
}

export function formatRulePorts(rule: SecurityGroupRule): string {
  if (rule.port_range_min === null && rule.port_range_max === null) return "any";
  if (rule.port_range_min === rule.port_range_max) return String(rule.port_range_min);
  return `${rule.port_range_min ?? "any"}-${rule.port_range_max ?? "any"}`;
}

export function formatRuleRemote(rule: SecurityGroupRule): string {
  if (rule.remote_ip_prefix !== null) return rule.remote_ip_prefix;
  if (rule.remote_group_id !== null) return `sg:${rule.remote_group_id}`;
  return "any";
}

/** 보안그룹 조회 명령이 공유하는 `--region`·`--profile` 옵션을 붙인다. */
export function withOptions(command: Command): Command {
  return command
    .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
    .option("--profile <name>", "사용할 profile 이름");
}
