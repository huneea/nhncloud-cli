import { isIP } from "node:net";
import type { Command } from "commander";
import { resolveIaasTokenContext, type IaasResolverOpts } from "../iaas.js";
import { NetworkClient } from "../../services/network/client.js";
import { InstanceClient } from "../../services/instance/client.js";
import type { CreateSecurityGroupRuleParams, SecurityGroupRule } from "../../services/network/types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { parseIntegerOption } from "../parse-options.js";
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

export interface ParsedRuleInput {
  direction: "ingress" | "egress";
  protocol?: string;
  portRangeMin?: number;
  portRangeMax?: number;
  cidr?: string;
  /** 해석 전 이름 또는 UUID */
  remoteGroup?: string;
  description?: string;
}

const RULE_PROTOCOLS = ["tcp", "udp", "icmp", "any"];
const PORT_RANGE = { min: 1, max: 65535 };
const CIDR_PREFIX_PATTERN = /^(\d|[12]\d|3[0-2])$/;

function paramError(message: string): never {
  throw new NhnCloudCliError(message, EXIT_PARAM_ERROR);
}

function parsePortRange(value: string): [number, number] {
  const formatError = `--port-range는 시작-끝 형식이며 시작이 끝보다 클 수 없습니다: ${JSON.stringify(value)}`;
  const parts = value.split("-");
  if (parts.length !== 2 || !parts[0] || !parts[1]) paramError(formatError);
  const min = parseIntegerOption(parts[0], "--port-range", PORT_RANGE);
  const max = parseIntegerOption(parts[1], "--port-range", PORT_RANGE);
  if (min > max) paramError(formatError);
  return [min, max];
}

function isIpv4OrCidr(value: string): boolean {
  const parts = value.split("/");
  if (parts.length > 2 || isIP(parts[0] ?? "") !== 4) return false;
  return parts.length === 1 || CIDR_PREFIX_PATTERN.test(parts[1] ?? "");
}

/** 보안 규칙 생성 옵션을 API 호출 전에 검증한다. 모든 오류는 EXIT_PARAM_ERROR 다. */
export function parseRuleInput(opts: {
  direction?: string; protocol?: string; port?: string; portRange?: string;
  cidr?: string; remoteGroup?: string; description?: string;
}): ParsedRuleInput {
  const { direction, protocol } = opts;
  if (direction !== "ingress" && direction !== "egress") {
    paramError(`--direction은 ingress 또는 egress여야 합니다: ${JSON.stringify(direction)}`);
  }
  if (protocol !== undefined && !RULE_PROTOCOLS.includes(protocol)) {
    paramError(`--protocol은 tcp, udp, icmp, any 중 하나여야 합니다: ${JSON.stringify(protocol)}`);
  }
  if (opts.port !== undefined && opts.portRange !== undefined) {
    paramError("--port와 --port-range는 함께 지정할 수 없습니다.");
  }
  let portRangeMin: number | undefined;
  let portRangeMax: number | undefined;
  if (opts.port !== undefined || opts.portRange !== undefined) {
    if (protocol !== "tcp" && protocol !== "udp") {
      paramError("포트는 --protocol tcp 또는 udp와 함께 지정합니다.");
    }
    if (opts.port !== undefined) {
      portRangeMin = parseIntegerOption(opts.port, "--port", PORT_RANGE);
      portRangeMax = portRangeMin;
    } else if (opts.portRange !== undefined) {
      [portRangeMin, portRangeMax] = parsePortRange(opts.portRange);
    }
  }
  if (opts.cidr !== undefined && opts.remoteGroup !== undefined) {
    paramError("--cidr와 --remote-group은 함께 지정할 수 없습니다.");
  }
  if (opts.cidr !== undefined && !isIpv4OrCidr(opts.cidr)) {
    paramError(`--cidr는 IPv4 주소 또는 CIDR이어야 합니다: ${JSON.stringify(opts.cidr)}`);
  }
  return {
    direction, protocol, portRangeMin, portRangeMax,
    cidr: opts.cidr, remoteGroup: opts.remoteGroup, description: opts.description,
  };
}

/** 검증한 규칙 입력을 생성 요청으로 옮긴다. `any` 는 protocol 키를 빼서 모든 프로토콜을 뜻하게 한다. */
export function toCreateRuleParams(
  input: ParsedRuleInput,
  securityGroupId: string,
  remoteGroupId: string | undefined,
): CreateSecurityGroupRuleParams {
  const params: CreateSecurityGroupRuleParams = { security_group_id: securityGroupId, direction: input.direction };
  if (input.protocol !== undefined && input.protocol !== "any") params.protocol = input.protocol;
  if (input.portRangeMin !== undefined) params.port_range_min = input.portRangeMin;
  if (input.portRangeMax !== undefined) params.port_range_max = input.portRangeMax;
  if (input.cidr !== undefined) params.remote_ip_prefix = input.cidr;
  if (remoteGroupId !== undefined) params.remote_group_id = remoteGroupId;
  if (input.description !== undefined) params.description = input.description;
  return params;
}
