import ky from "ky";
import { toNhnCloudCliError } from "../../api/httpError.js";
import { DEFAULT_TIMEOUT_MS } from "../../api/timeout.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR } from "../../utils/exit-codes.js";
import { toNetworkWriteError } from "./errors.js";
import type { Vpc, VpcSubnet, FloatingIp, CreateFloatingIpParams, SecurityGroup, SecurityGroupRule, SecurityGroupPort, CreateSecurityGroupRuleParams } from "./types.js";

// ── 응답 타입 가드 ─────────────────────────────────────────────────────────────

function isVpc(val: unknown): val is Vpc {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  // 출력에 쓰는 필드를 모두 검증 — 타입(required)·실측("항상 존재")과 일치, "undefined" 셀 방지.
  return (
    typeof obj["id"] === "string" &&
    typeof obj["name"] === "string" &&
    typeof obj["cidrv4"] === "string" &&
    typeof obj["state"] === "string" &&
    typeof obj["router:external"] === "boolean"
  );
}

function isVpcsResponse(val: unknown): val is { vpcs: Vpc[] } {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  return Array.isArray(obj["vpcs"]) && obj["vpcs"].every(isVpc);
}

function isSubnet(val: unknown): val is VpcSubnet {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  // vpc_id·gateway·available_ip_count 는 subnet list 의 핵심 출력값 — 모두 검증 (실측: 항상 존재).
  return (
    typeof obj["id"] === "string" &&
    typeof obj["cidr"] === "string" &&
    typeof obj["vpc_id"] === "string" &&
    typeof obj["gateway"] === "string" &&
    typeof obj["available_ip_count"] === "number"
  );
}

function isSubnetsResponse(val: unknown): val is { vpcsubnets: VpcSubnet[] } {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  return Array.isArray(obj["vpcsubnets"]) && obj["vpcsubnets"].every(isSubnet);
}

function isFloatingIp(val: unknown): val is FloatingIp {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    typeof obj["id"] === "string" &&
    typeof obj["floating_ip_address"] === "string" &&
    typeof obj["status"] === "string" &&
    typeof obj["floating_network_id"] === "string" &&
    (obj["port_id"] === null || typeof obj["port_id"] === "string") &&
    (obj["fixed_ip_address"] === null || typeof obj["fixed_ip_address"] === "string")
  );
}

function isFloatingIpsResponse(val: unknown): val is { floatingips: FloatingIp[] } {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  return Array.isArray(obj["floatingips"]) && obj["floatingips"].every(isFloatingIp);
}

function isFloatingIpResponse(val: unknown): val is { floatingip: FloatingIp } {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  return isFloatingIp((obj as Record<string, unknown>)["floatingip"]);
}

function isSecurityGroupRule(val: unknown): val is SecurityGroupRule {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    typeof obj["id"] === "string" &&
    typeof obj["security_group_id"] === "string" &&
    typeof obj["direction"] === "string" &&
    typeof obj["ethertype"] === "string" &&
    (obj["protocol"] === null || typeof obj["protocol"] === "string") &&
    (obj["port_range_min"] === null || typeof obj["port_range_min"] === "number") &&
    (obj["port_range_max"] === null || typeof obj["port_range_max"] === "number") &&
    (obj["remote_ip_prefix"] === null || typeof obj["remote_ip_prefix"] === "string") &&
    (obj["remote_group_id"] === null || typeof obj["remote_group_id"] === "string") &&
    (obj["description"] === null || typeof obj["description"] === "string") &&
    typeof obj["tenant_id"] === "string"
  );
}

function isSecurityGroup(val: unknown): val is SecurityGroup {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    typeof obj["id"] === "string" &&
    typeof obj["name"] === "string" &&
    typeof obj["description"] === "string" &&
    typeof obj["tenant_id"] === "string" &&
    Array.isArray(obj["security_group_rules"]) &&
    obj["security_group_rules"].every(isSecurityGroupRule)
  );
}

function isSecurityGroupPort(val: unknown): val is SecurityGroupPort {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  return (
    typeof obj["id"] === "string" &&
    typeof obj["name"] === "string" &&
    typeof obj["status"] === "string" &&
    typeof obj["device_owner"] === "string" &&
    typeof obj["device_id"] === "string" &&
    typeof obj["network_id"] === "string" &&
    Array.isArray(obj["fixed_ips"]) &&
    obj["fixed_ips"].every((ip: unknown) => {
      if (typeof ip !== "object" || ip === null) return false;
      const fixedIp = ip as Record<string, unknown>;
      return typeof fixedIp["subnet_id"] === "string" && typeof fixedIp["ip_address"] === "string";
    }) &&
    Array.isArray(obj["security_groups"]) &&
    obj["security_groups"].every((id: unknown) => typeof id === "string")
  );
}

/** 값이 undefined 인 키를 뺀다 — 요청 본문에 선택 필드를 null 이나 빈 값으로 보내지 않기 위함. */
function omitUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ── NetworkClient ───────────────────────────────────────────────────────────────

export class NetworkClient {
  private readonly tokenId: string;
  private readonly networkEndpoint: string;

  constructor(tokenId: string, networkEndpoint: string) {
    this.tokenId = tokenId;
    this.networkEndpoint = networkEndpoint;
  }

  private authHeaders(): Record<string, string> {
    return { "X-Auth-Token": this.tokenId };
  }

  async listSecurityGroups(): Promise<SecurityGroup[]> {
    try {
      const raw: unknown = await ky.get(`${this.networkEndpoint}/security-groups`, {
        headers: this.authHeaders(), retry: 0, timeout: DEFAULT_TIMEOUT_MS,
      }).json();
      const groups = typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>)["security_groups"] : undefined;
      if (!Array.isArray(groups) || !groups.every(isSecurityGroup)) {
        throw new NhnCloudCliError("network security-group list 응답 형식이 올바르지 않습니다 — security_groups 배열이 없습니다.", EXIT_API_ERROR);
      }
      return groups;
    } catch (err) { throw toNhnCloudCliError(err); }
  }

  async getSecurityGroup(id: string): Promise<SecurityGroup> {
    try {
      const raw: unknown = await ky.get(`${this.networkEndpoint}/security-groups/${encodeURIComponent(id)}`, {
        headers: this.authHeaders(), retry: 0, timeout: DEFAULT_TIMEOUT_MS,
      }).json();
      const group = typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>)["security_group"] : undefined;
      if (!isSecurityGroup(group)) {
        throw new NhnCloudCliError("network security-group get 응답 형식이 올바르지 않습니다 — security_group 객체가 없습니다.", EXIT_API_ERROR);
      }
      return group;
    } catch (err) { throw toNhnCloudCliError(err); }
  }

  async listSecurityGroupRules(securityGroupId: string): Promise<SecurityGroupRule[]> {
    try {
      const raw: unknown = await ky.get(`${this.networkEndpoint}/security-group-rules`, {
        headers: this.authHeaders(), searchParams: { security_group_id: securityGroupId }, retry: 0, timeout: DEFAULT_TIMEOUT_MS,
      }).json();
      const rules = typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>)["security_group_rules"] : undefined;
      if (!Array.isArray(rules) || !rules.every(isSecurityGroupRule)) {
        throw new NhnCloudCliError("network security-group rule list 응답 형식이 올바르지 않습니다 — security_group_rules 배열이 없습니다.", EXIT_API_ERROR);
      }
      return rules;
    } catch (err) { throw toNhnCloudCliError(err); }
  }

  async getSecurityGroupRule(id: string): Promise<SecurityGroupRule> {
    try {
      const raw: unknown = await ky.get(`${this.networkEndpoint}/security-group-rules/${encodeURIComponent(id)}`, {
        headers: this.authHeaders(), retry: 0, timeout: DEFAULT_TIMEOUT_MS,
      }).json();
      const rule = typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>)["security_group_rule"] : undefined;
      if (!isSecurityGroupRule(rule)) {
        throw new NhnCloudCliError("network security-group rule get 응답 형식이 올바르지 않습니다 — security_group_rule 객체가 없습니다.", EXIT_API_ERROR);
      }
      return rule;
    } catch (err) { throw toNhnCloudCliError(err); }
  }

  async listSecurityGroupPorts(securityGroupId: string): Promise<SecurityGroupPort[]> {
    try {
      const raw: unknown = await ky.get(`${this.networkEndpoint}/security-group-ports`, {
        headers: this.authHeaders(), searchParams: { security_group_id: securityGroupId }, retry: 0, timeout: DEFAULT_TIMEOUT_MS,
      }).json();
      const ports = typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>)["security_group_ports"] : undefined;
      if (!Array.isArray(ports) || !ports.every(isSecurityGroupPort)) {
        throw new NhnCloudCliError("network security-group ports 응답 형식이 올바르지 않습니다 — security_group_ports 배열이 없습니다.", EXIT_API_ERROR);
      }
      return ports;
    } catch (err) { throw toNhnCloudCliError(err); }
  }

  /** 보안그룹을 생성한다 (POST /v2.0/security-groups). 송신 규칙 두 개가 자동으로 함께 생성된다. */
  async createSecurityGroup(params: { name: string; description?: string }): Promise<SecurityGroup> {
    try {
      const raw: unknown = await ky.post(`${this.networkEndpoint}/security-groups`, {
        headers: this.authHeaders(), json: { security_group: omitUndefined(params) }, retry: 0, timeout: DEFAULT_TIMEOUT_MS,
      }).json();
      const group = typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>)["security_group"] : undefined;
      if (!isSecurityGroup(group)) {
        throw new NhnCloudCliError("network security-group create 응답 형식이 올바르지 않습니다 — security_group 객체가 없습니다.", EXIT_API_ERROR);
      }
      return group;
    } catch (err) { throw await toNetworkWriteError(err); }
  }

  /** 보안그룹 이름·설명을 변경한다 (PUT /v2.0/security-groups/{id}). */
  async updateSecurityGroup(id: string, params: { name?: string; description?: string }): Promise<SecurityGroup> {
    try {
      const raw: unknown = await ky.put(`${this.networkEndpoint}/security-groups/${encodeURIComponent(id)}`, {
        headers: this.authHeaders(), json: { security_group: omitUndefined(params) }, retry: 0, timeout: DEFAULT_TIMEOUT_MS,
      }).json();
      const group = typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>)["security_group"] : undefined;
      if (!isSecurityGroup(group)) {
        throw new NhnCloudCliError("network security-group update 응답 형식이 올바르지 않습니다 — security_group 객체가 없습니다.", EXIT_API_ERROR);
      }
      return group;
    } catch (err) { throw await toNetworkWriteError(err); }
  }

  /** 보안그룹을 삭제한다 (DELETE /v2.0/security-groups/{id}, 204 무본문). */
  async deleteSecurityGroup(id: string): Promise<void> {
    try {
      await ky.delete(`${this.networkEndpoint}/security-groups/${encodeURIComponent(id)}`, {
        headers: this.authHeaders(), retry: 0, timeout: DEFAULT_TIMEOUT_MS,
      });
    } catch (err) { throw await toNetworkWriteError(err); }
  }

  /** 보안그룹 규칙을 생성한다 (POST /v2.0/security-group-rules). ethertype 은 IPv4 로 고정한다. */
  async createSecurityGroupRule(params: CreateSecurityGroupRuleParams): Promise<SecurityGroupRule> {
    try {
      const raw: unknown = await ky.post(`${this.networkEndpoint}/security-group-rules`, {
        headers: this.authHeaders(),
        json: { security_group_rule: { ...omitUndefined(params), ethertype: "IPv4" } },
        retry: 0, timeout: DEFAULT_TIMEOUT_MS,
      }).json();
      const rule = typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>)["security_group_rule"] : undefined;
      if (!isSecurityGroupRule(rule)) {
        throw new NhnCloudCliError("network security-group rule create 응답 형식이 올바르지 않습니다 — security_group_rule 객체가 없습니다.", EXIT_API_ERROR);
      }
      return rule;
    } catch (err) { throw await toNetworkWriteError(err); }
  }

  /** 보안그룹 규칙을 삭제한다 (DELETE /v2.0/security-group-rules/{id}, 204 무본문). */
  async deleteSecurityGroupRule(id: string): Promise<void> {
    try {
      await ky.delete(`${this.networkEndpoint}/security-group-rules/${encodeURIComponent(id)}`, {
        headers: this.authHeaders(), retry: 0, timeout: DEFAULT_TIMEOUT_MS,
      });
    } catch (err) { throw await toNetworkWriteError(err); }
  }

  /** 다른 보안그룹을 원격 그룹으로 참조하는 규칙을 조회한다 (GET /v2.0/security-group-rules?remote_group_id=). */
  async listSecurityGroupRulesByRemoteGroup(remoteGroupId: string): Promise<SecurityGroupRule[]> {
    try {
      const raw: unknown = await ky.get(`${this.networkEndpoint}/security-group-rules`, {
        headers: this.authHeaders(), searchParams: { remote_group_id: remoteGroupId }, retry: 0, timeout: DEFAULT_TIMEOUT_MS,
      }).json();
      const rules = typeof raw === "object" && raw !== null
        ? (raw as Record<string, unknown>)["security_group_rules"] : undefined;
      if (!Array.isArray(rules) || !rules.every(isSecurityGroupRule)) {
        throw new NhnCloudCliError("network security-group rule list 응답 형식이 올바르지 않습니다 — security_group_rules 배열이 없습니다.", EXIT_API_ERROR);
      }
      return rules;
    } catch (err) { throw toNhnCloudCliError(err); }
  }

  /**
   * VPC 목록을 조회한다 (GET /v2.0/vpcs, NHN VPC).
   * instance 와 다른 host(networkEndpoint)지만 같은 Keystone 토큰을 쓴다.
   */
  async listVpcs(): Promise<Vpc[]> {
    const url = `${this.networkEndpoint}/vpcs`;
    try {
      const raw = await ky
        .get(url, {
          headers: this.authHeaders(),
          retry: 0,
          timeout: DEFAULT_TIMEOUT_MS,
        })
        .json();

      if (!isVpcsResponse(raw)) {
        throw new NhnCloudCliError(
          "network list 응답 형식이 올바르지 않습니다 — vpcs 배열이 없습니다.",
          EXIT_API_ERROR,
        );
      }
      return raw.vpcs;
    } catch (err) {
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * 서브넷 목록을 조회한다 (GET /v2.0/vpcsubnets, NHN VPC).
   */
  async listSubnets(): Promise<VpcSubnet[]> {
    const url = `${this.networkEndpoint}/vpcsubnets`;
    try {
      const raw = await ky
        .get(url, {
          headers: this.authHeaders(),
          retry: 0,
          timeout: DEFAULT_TIMEOUT_MS,
        })
        .json();

      if (!isSubnetsResponse(raw)) {
        throw new NhnCloudCliError(
          "network subnet list 응답 형식이 올바르지 않습니다 — vpcsubnets 배열이 없습니다.",
          EXIT_API_ERROR,
        );
      }
      return raw.vpcsubnets;
    } catch (err) {
      throw toNhnCloudCliError(err);
    }
  }

  /** Floating IP 목록을 조회한다 (GET /v2.0/floatingips). */
  async listFloatingIps(): Promise<FloatingIp[]> {
    const url = `${this.networkEndpoint}/floatingips`;
    try {
      const raw = await ky
        .get(url, { headers: this.authHeaders(), retry: 0, timeout: DEFAULT_TIMEOUT_MS })
        .json();
      if (!isFloatingIpsResponse(raw)) {
        throw new NhnCloudCliError(
          "floatingip list 응답 형식이 올바르지 않습니다 — floatingips 배열이 없습니다.",
          EXIT_API_ERROR,
        );
      }
      return raw.floatingips;
    } catch (err) {
      throw toNhnCloudCliError(err);
    }
  }

  /** Floating IP 를 발급한다 (POST /v2.0/floatingips). */
  async createFloatingIp(params: CreateFloatingIpParams): Promise<FloatingIp> {
    const url = `${this.networkEndpoint}/floatingips`;
    try {
      const raw = await ky
        .post(url, {
          headers: this.authHeaders(),
          json: { floatingip: { floating_network_id: params.floating_network_id } },
          retry: 0,
          timeout: DEFAULT_TIMEOUT_MS,
        })
        .json();
      if (!isFloatingIpResponse(raw)) {
        throw new NhnCloudCliError(
          "floatingip create 응답 형식이 올바르지 않습니다 — floatingip 객체가 없습니다.",
          EXIT_API_ERROR,
        );
      }
      return raw.floatingip;
    } catch (err) {
      throw toNhnCloudCliError(err);
    }
  }

  /** Floating IP 를 삭제한다 (DELETE /v2.0/floatingips/{id}, 무본문). */
  async deleteFloatingIp(id: string): Promise<void> {
    const url = `${this.networkEndpoint}/floatingips/${encodeURIComponent(id)}`;
    try {
      await ky.delete(url, { headers: this.authHeaders(), retry: 0, timeout: DEFAULT_TIMEOUT_MS });
    } catch (err) {
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * 외부(external) VPC id 를 찾는다 — create 의 floating_network_id 기본 소스.
   * `router:external` 은 콜론 포함 리터럴 키 — bracket 접근 필수.
   * external VPC 가 둘 이상이면 첫 매칭을 반환한다.
   * 사용자는 `--network <id>` 로 명시 지정 가능하므로 create 의 stderr 에 그 사실을 안내한다.
   */
  async findExternalNetworkId(): Promise<string | null> {
    const url = `${this.networkEndpoint}/vpcs`;
    try {
      const raw = await ky
        .get(url, {
          headers: this.authHeaders(),
          searchParams: { "router:external": "true" },
          retry: 0,
          timeout: DEFAULT_TIMEOUT_MS,
        })
        .json();
      if (typeof raw !== "object" || raw === null) return null;
      const vpcs = (raw as Record<string, unknown>)["vpcs"];
      if (!Array.isArray(vpcs)) return null;
      for (const v of vpcs) {
        if (typeof v !== "object" || v === null) continue;
        const obj = v as Record<string, unknown>;
        if (obj["router:external"] === true && typeof obj["id"] === "string") {
          return obj["id"];
        }
      }
      return null;
    } catch (err) {
      throw toNhnCloudCliError(err);
    }
  }
}
