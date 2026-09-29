import { isIP } from "node:net";
import { resolveIaasTokenContext, type IaasResolverOpts } from "../iaas.js";
import { LoadBalancerClient } from "../../services/loadbalancer/client.js";
import type {
  IpAclAction,
  IpAclGroup,
  LoadBalancer,
} from "../../services/loadbalancer/types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { requireResourceInput, resolveFromList } from "../resource-resolver.js";

export { requireResourceInput } from "../resource-resolver.js";
export { requireYes } from "../resource-resolver.js";

type LoadBalancerResolverClient = Pick<
  LoadBalancerClient,
  "listLoadBalancers" | "listIpAclGroups"
>;

export function optionalTrimmed(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.trim();
}

export function parseIpAclAction(value: string): IpAclAction {
  if (value !== "ALLOW" && value !== "DENY") {
    throw new NhnCloudCliError(
      `--action은 ALLOW 또는 DENY여야 합니다: ${JSON.stringify(value)}`,
      EXIT_PARAM_ERROR,
    );
  }
  return value;
}

export function collectOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function requireResourceInputs(values: string[], label: string): string[] {
  if (values.length === 0) {
    throw new NhnCloudCliError(`${label}을(를) 한 개 이상 지정해야 합니다.`, EXIT_PARAM_ERROR);
  }
  return values.map((value) => requireResourceInput(value, label));
}

export function parseIpOrCidr(value: string): string {
  const normalized = value.trim();
  const parts = normalized.split("/");
  const address = parts[0] ?? "";
  const version = isIP(address);
  if (version === 0 || parts.length > 2) {
    throw new NhnCloudCliError(
      `--cidr은 IP 주소 또는 CIDR이어야 합니다: ${JSON.stringify(value)}`,
      EXIT_PARAM_ERROR,
    );
  }
  if (parts.length === 2) {
    const prefix = parts[1] ?? "";
    const maxPrefix = version === 4 ? 32 : 128;
    if (!/^\d+$/.test(prefix) || Number(prefix) > maxPrefix) {
      throw new NhnCloudCliError(
        `--cidr prefix가 올바르지 않습니다: ${JSON.stringify(value)}`,
        EXIT_PARAM_ERROR,
      );
    }
  }
  return normalized;
}

export async function resolveLoadBalancerId(
  client: Pick<LoadBalancerResolverClient, "listLoadBalancers">,
  value: string,
): Promise<string> {
  const input = requireResourceInput(value, "Load Balancer");
  const resources: LoadBalancer[] = await client.listLoadBalancers();
  return resolveFromList(resources, input, "Load Balancer");
}

export async function resolveIpAclGroupId(
  client: Pick<LoadBalancerResolverClient, "listIpAclGroups">,
  value: string,
): Promise<string> {
  const input = requireResourceInput(value, "IP ACL 그룹");
  const resources: IpAclGroup[] = await client.listIpAclGroups();
  return resolveFromList(resources, input, "IP ACL 그룹");
}

export async function resolveIpAclGroups(
  client: Pick<LoadBalancerResolverClient, "listIpAclGroups">,
  values: string[],
): Promise<IpAclGroup[]> {
  const inputs = requireResourceInputs(values, "IP ACL 그룹");
  const resources = await client.listIpAclGroups();
  return inputs.map((input) => {
    const id = resolveFromList(resources, input, "IP ACL 그룹");
    const group = resources.find((resource) => resource.id === id);
    if (!group) {
      throw new NhnCloudCliError(
        `IP ACL 그룹 조회 결과에서 UUID를 찾을 수 없습니다: ${JSON.stringify(id)}`,
        EXIT_PARAM_ERROR,
      );
    }
    return group;
  });
}

export async function resolveLoadBalancerClient(
  opts: IaasResolverOpts,
): Promise<{ client: LoadBalancerClient; profileName: string }> {
  const { profileName, tokenId, networkEndpoint } = await resolveIaasTokenContext(opts);
  return {
    client: new LoadBalancerClient(tokenId, networkEndpoint),
    profileName,
  };
}
