import ky from "ky";
import { toNhnCloudCliError } from "../../api/httpError.js";
import { DEFAULT_TIMEOUT_MS } from "../../api/timeout.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR, EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import {
  isIpAclBinding,
  isIpAclGroup,
  isIpAclTarget,
  isLoadBalancer,
  type BindIpAclGroupsRequest,
  type CreateIpAclGroupInput,
  type CreateIpAclGroupRequest,
  type CreateIpAclTargetInput,
  type CreateIpAclTargetRequest,
  type IpAclBinding,
  type IpAclGroup,
  type IpAclTarget,
  type LoadBalancer,
  type UpdateIpAclTargetInput,
  type UpdateIpAclTargetRequest,
} from "./types.js";
import {
  isHealthMonitor,
  isL7Policy,
  isL7Rule,
  isListener,
  isMember,
  isPool,
  type CreateHealthMonitorInput,
  type CreateL7PolicyInput,
  type CreateL7RuleInput,
  type CreateListenerInput,
  type CreateMemberInput,
  type CreatePoolInput,
  type HealthMonitor,
  type L7Policy,
  type L7Rule,
  type Listener,
  type Member,
  type Pool,
} from "./lbaas-types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requireNonEmptyId(id: string, label: string): string {
  const normalized = id.trim();
  if (!normalized) {
    throw new NhnCloudCliError(`${label}가 필요합니다.`, EXIT_PARAM_ERROR);
  }
  return normalized;
}

function readArrayField<T>(
  response: unknown,
  key: string,
  itemGuard: (item: unknown) => item is T,
  missingKeyMessage: string,
  invalidItemMessage: string,
): T[] {
  if (!isRecord(response) || !Array.isArray(response[key])) {
    throw new NhnCloudCliError(missingKeyMessage, EXIT_API_ERROR);
  }

  const items = response[key];
  if (!items.every(itemGuard)) {
    throw new NhnCloudCliError(invalidItemMessage, EXIT_API_ERROR);
  }
  return items;
}

function readObjectField<T>(
  response: unknown,
  key: string,
  itemGuard: (item: unknown) => item is T,
  missingKeyMessage: string,
  invalidItemMessage: string,
): T {
  if (!isRecord(response) || !(key in response)) {
    throw new NhnCloudCliError(missingKeyMessage, EXIT_API_ERROR);
  }

  const item = response[key];
  if (!itemGuard(item)) {
    throw new NhnCloudCliError(invalidItemMessage, EXIT_API_ERROR);
  }
  return item;
}

function encodeId(id: string, label: string): string {
  return encodeURIComponent(requireNonEmptyId(id, label));
}

function readResource<T>(
  raw: unknown,
  key: string,
  guard: (item: unknown) => item is T,
  command: string,
  label: string,
): T {
  return readObjectField(
    raw,
    key,
    guard,
    `${command} 응답 형식이 올바르지 않습니다 — ${key} 객체가 없습니다.`,
    `${command} 응답의 ${label} 항목 형식이 예상과 다릅니다 — API 응답 필드를 확인하세요.`,
  );
}

export class LoadBalancerClient {
  private readonly tokenId: string;
  private readonly endpoint: string;

  constructor(tokenId: string, networkEndpoint: string) {
    this.tokenId = tokenId;
    this.endpoint = `${networkEndpoint}/lbaas`;
  }

  private authHeaders(): Record<string, string> {
    return { "X-Auth-Token": this.tokenId };
  }

  async listLoadBalancers(query?: Record<string, string>): Promise<LoadBalancer[]> {
    const raw = await this.getJson("/loadbalancers", query);
    return readArrayField(
      raw,
      "loadbalancers",
      isLoadBalancer,
      "loadbalancer list 응답 형식이 올바르지 않습니다 — loadbalancers 배열이 없습니다.",
      "loadbalancer list 응답의 Load Balancer 항목 형식이 예상과 다릅니다 — API 응답 필드를 확인하세요.",
    );
  }

  async getLoadBalancer(id: string): Promise<LoadBalancer> {
    const raw = await this.getJson(`/loadbalancers/${encodeURIComponent(id)}`);
    return readObjectField(
      raw,
      "loadbalancer",
      isLoadBalancer,
      "loadbalancer get 응답 형식이 올바르지 않습니다 — loadbalancer 객체가 없습니다.",
      "loadbalancer get 응답의 Load Balancer 항목 형식이 예상과 다릅니다 — API 응답 필드를 확인하세요.",
    );
  }

  async listIpAclGroups(query?: Record<string, string>): Promise<IpAclGroup[]> {
    const raw = await this.getJson("/ipacl-groups", query);
    return readArrayField(
      raw,
      "ipacl_groups",
      isIpAclGroup,
      "loadbalancer ipacl list 응답 형식이 올바르지 않습니다 — ipacl_groups 배열이 없습니다.",
      "loadbalancer ipacl list 응답의 IP ACL 그룹 항목 형식이 예상과 다릅니다 — API 응답 필드를 확인하세요.",
    );
  }

  async getIpAclGroup(id: string): Promise<IpAclGroup> {
    const raw = await this.getJson(`/ipacl-groups/${encodeURIComponent(id)}`);
    return readObjectField(
      raw,
      "ipacl_group",
      isIpAclGroup,
      "loadbalancer ipacl get 응답 형식이 올바르지 않습니다 — ipacl_group 객체가 없습니다.",
      "loadbalancer ipacl get 응답의 IP ACL 그룹 항목 형식이 예상과 다릅니다 — API 응답 필드를 확인하세요.",
    );
  }

  async listIpAclTargets(query: { ipacl_group_id: string }): Promise<IpAclTarget[]> {
    const raw = await this.getJson("/ipacl-targets", query);
    return readArrayField(
      raw,
      "ipacl_targets",
      isIpAclTarget,
      "loadbalancer ipacl target list 응답 형식이 올바르지 않습니다 — ipacl_targets 배열이 없습니다.",
      "loadbalancer ipacl target list 응답의 IP ACL 대상 항목 형식이 예상과 다릅니다 — API 응답 필드를 확인하세요.",
    );
  }

  async createIpAclGroup(input: CreateIpAclGroupInput): Promise<IpAclGroup> {
    const request: CreateIpAclGroupRequest = { ipacl_group: input };
    const raw = await this.postJson("/ipacl-groups", request);
    return readObjectField(
      raw,
      "ipacl_group",
      isIpAclGroup,
      "loadbalancer ipacl create 응답 형식이 올바르지 않습니다 — ipacl_group 객체가 없습니다.",
      "loadbalancer ipacl create 응답의 IP ACL 그룹 항목 형식이 예상과 다릅니다 — API 응답 필드를 확인하세요.",
    );
  }

  async deleteIpAclGroup(id: string): Promise<void> {
    const normalizedId = requireNonEmptyId(id, "IP ACL 그룹 ID");
    await this.deleteNoContent(`/ipacl-groups/${encodeURIComponent(normalizedId)}`);
  }

  async getIpAclTarget(id: string): Promise<IpAclTarget> {
    const normalizedId = requireNonEmptyId(id, "IP ACL 대상 ID");
    const raw = await this.getJson(`/ipacl-targets/${encodeURIComponent(normalizedId)}`);
    return readObjectField(
      raw,
      "ipacl_target",
      isIpAclTarget,
      "loadbalancer ipacl target get 응답 형식이 올바르지 않습니다 — ipacl_target 객체가 없습니다.",
      "loadbalancer ipacl target get 응답의 IP ACL 대상 항목 형식이 예상과 다릅니다 — API 응답 필드를 확인하세요.",
    );
  }

  async createIpAclTarget(input: CreateIpAclTargetInput): Promise<IpAclTarget> {
    const request: CreateIpAclTargetRequest = { ipacl_target: input };
    const raw = await this.postJson("/ipacl-targets", request);
    return readObjectField(
      raw,
      "ipacl_target",
      isIpAclTarget,
      "loadbalancer ipacl target add 응답 형식이 올바르지 않습니다 — ipacl_target 객체가 없습니다.",
      "loadbalancer ipacl target add 응답의 IP ACL 대상 항목 형식이 예상과 다릅니다 — API 응답 필드를 확인하세요.",
    );
  }

  async updateIpAclTarget(
    id: string,
    input: UpdateIpAclTargetInput,
  ): Promise<IpAclTarget> {
    const normalizedId = requireNonEmptyId(id, "IP ACL 대상 ID");
    const request: UpdateIpAclTargetRequest = { ipacl_target: input };
    const raw = await this.putJson(
      `/ipacl-targets/${encodeURIComponent(normalizedId)}`,
      request,
    );
    return readObjectField(
      raw,
      "ipacl_target",
      isIpAclTarget,
      "loadbalancer ipacl target update 응답 형식이 올바르지 않습니다 — ipacl_target 객체가 없습니다.",
      "loadbalancer ipacl target update 응답의 IP ACL 대상 항목 형식이 예상과 다릅니다 — API 응답 필드를 확인하세요.",
    );
  }

  async deleteIpAclTarget(id: string): Promise<void> {
    const normalizedId = requireNonEmptyId(id, "IP ACL 대상 ID");
    await this.deleteNoContent(`/ipacl-targets/${encodeURIComponent(normalizedId)}`);
  }

  async bindIpAclGroups(
    loadBalancerId: string,
    ipAclGroupIds: string[],
  ): Promise<IpAclBinding[]> {
    const normalizedLoadBalancerId = requireNonEmptyId(
      loadBalancerId,
      "Load Balancer ID",
    );
    const request: BindIpAclGroupsRequest = {
      ipacl_groups_binding: ipAclGroupIds.map((id) => ({
        ipacl_group_id: requireNonEmptyId(id, "IP ACL 그룹 ID"),
      })),
    };
    const raw = await this.putJson(
      `/loadbalancers/${encodeURIComponent(normalizedLoadBalancerId)}/bind_ipacl_groups`,
      request,
    );
    if (!Array.isArray(raw)) {
      throw new NhnCloudCliError(
        "loadbalancer set-ipacl 응답 형식이 올바르지 않습니다 — binding 배열이 없습니다.",
        EXIT_API_ERROR,
      );
    }
    if (!raw.every(isIpAclBinding)) {
      throw new NhnCloudCliError(
        "loadbalancer set-ipacl 응답의 binding 항목 형식이 예상과 다릅니다 — API 응답 필드를 확인하세요.",
        EXIT_API_ERROR,
      );
    }
    return raw;
  }

  async listListeners(): Promise<Listener[]> {
    return this.listResource("/listeners", "listeners", isListener, "loadbalancer listener list", "리스너");
  }

  async getListener(id: string): Promise<Listener> {
    return this.getResource(`/listeners/${encodeId(id, "리스너 ID")}`, "listener", isListener, "loadbalancer listener get", "리스너");
  }

  async createListener(input: CreateListenerInput): Promise<Listener> {
    const raw = await this.postJson("/listeners", { listener: input });
    return readResource(raw, "listener", isListener, "loadbalancer listener create", "리스너");
  }

  async deleteListener(id: string): Promise<void> {
    await this.deleteNoContent(`/listeners/${encodeId(id, "리스너 ID")}`);
  }

  async listPools(): Promise<Pool[]> {
    return this.listResource("/pools", "pools", isPool, "loadbalancer pool list", "풀");
  }

  async getPool(id: string): Promise<Pool> {
    return this.getResource(`/pools/${encodeId(id, "풀 ID")}`, "pool", isPool, "loadbalancer pool get", "풀");
  }

  async createPool(input: CreatePoolInput): Promise<Pool> {
    const raw = await this.postJson("/pools", { pool: input });
    return readResource(raw, "pool", isPool, "loadbalancer pool create", "풀");
  }

  async deletePool(id: string): Promise<void> {
    await this.deleteNoContent(`/pools/${encodeId(id, "풀 ID")}`);
  }

  async listMembers(poolId: string): Promise<Member[]> {
    return this.listResource(`/pools/${encodeId(poolId, "풀 ID")}/members`, "members", isMember, "loadbalancer pool member list", "멤버");
  }

  async getMember(poolId: string, memberId: string): Promise<Member> {
    return this.getResource(
      `/pools/${encodeId(poolId, "풀 ID")}/members/${encodeId(memberId, "멤버 ID")}`,
      "member",
      isMember,
      "loadbalancer pool member get",
      "멤버",
    );
  }

  async createMember(poolId: string, input: CreateMemberInput): Promise<Member> {
    const raw = await this.postJson(`/pools/${encodeId(poolId, "풀 ID")}/members`, { member: input });
    return readResource(raw, "member", isMember, "loadbalancer pool member create", "멤버");
  }

  async deleteMember(poolId: string, memberId: string): Promise<void> {
    await this.deleteNoContent(`/pools/${encodeId(poolId, "풀 ID")}/members/${encodeId(memberId, "멤버 ID")}`);
  }

  async listHealthMonitors(): Promise<HealthMonitor[]> {
    return this.listResource("/healthmonitors", "healthmonitors", isHealthMonitor, "loadbalancer healthmonitor list", "헬스 모니터");
  }

  async getHealthMonitor(id: string): Promise<HealthMonitor> {
    return this.getResource(
      `/healthmonitors/${encodeId(id, "헬스 모니터 ID")}`,
      "healthmonitor",
      isHealthMonitor,
      "loadbalancer healthmonitor get",
      "헬스 모니터",
    );
  }

  async createHealthMonitor(input: CreateHealthMonitorInput): Promise<HealthMonitor> {
    const raw = await this.postJson("/healthmonitors", { healthmonitor: input });
    return readResource(raw, "healthmonitor", isHealthMonitor, "loadbalancer healthmonitor create", "헬스 모니터");
  }

  async deleteHealthMonitor(id: string): Promise<void> {
    await this.deleteNoContent(`/healthmonitors/${encodeId(id, "헬스 모니터 ID")}`);
  }

  async listL7Policies(): Promise<L7Policy[]> {
    return this.listResource("/l7policies", "l7policies", isL7Policy, "loadbalancer l7policy list", "L7 정책");
  }

  async getL7Policy(id: string): Promise<L7Policy> {
    return this.getResource(`/l7policies/${encodeId(id, "L7 정책 ID")}`, "l7policy", isL7Policy, "loadbalancer l7policy get", "L7 정책");
  }

  async createL7Policy(input: CreateL7PolicyInput): Promise<L7Policy> {
    const raw = await this.postJson("/l7policies", { l7policy: input });
    return readResource(raw, "l7policy", isL7Policy, "loadbalancer l7policy create", "L7 정책");
  }

  async deleteL7Policy(id: string): Promise<void> {
    await this.deleteNoContent(`/l7policies/${encodeId(id, "L7 정책 ID")}`);
  }

  async listL7Rules(policyId: string): Promise<L7Rule[]> {
    return this.listResource(`/l7policies/${encodeId(policyId, "L7 정책 ID")}/rules`, "rules", isL7Rule, "loadbalancer l7policy rule list", "L7 규칙");
  }

  async getL7Rule(policyId: string, ruleId: string): Promise<L7Rule> {
    return this.getResource(
      `/l7policies/${encodeId(policyId, "L7 정책 ID")}/rules/${encodeId(ruleId, "L7 규칙 ID")}`,
      "rule",
      isL7Rule,
      "loadbalancer l7policy rule get",
      "L7 규칙",
    );
  }

  async createL7Rule(policyId: string, input: CreateL7RuleInput): Promise<L7Rule> {
    const raw = await this.postJson(`/l7policies/${encodeId(policyId, "L7 정책 ID")}/rules`, { rule: input });
    return readResource(raw, "rule", isL7Rule, "loadbalancer l7policy rule create", "L7 규칙");
  }

  async deleteL7Rule(policyId: string, ruleId: string): Promise<void> {
    await this.deleteNoContent(
      `/l7policies/${encodeId(policyId, "L7 정책 ID")}/rules/${encodeId(ruleId, "L7 규칙 ID")}`,
    );
  }

  private async listResource<T>(
    path: string,
    key: string,
    guard: (item: unknown) => item is T,
    command: string,
    label: string,
  ): Promise<T[]> {
    const raw = await this.getJson(path);
    return readArrayField(
      raw,
      key,
      guard,
      `${command} 응답 형식이 올바르지 않습니다 — ${key} 배열이 없습니다.`,
      `${command} 응답의 ${label} 항목 형식이 예상과 다릅니다 — API 응답 필드를 확인하세요.`,
    );
  }

  private async getResource<T>(
    path: string,
    key: string,
    guard: (item: unknown) => item is T,
    command: string,
    label: string,
  ): Promise<T> {
    const raw = await this.getJson(path);
    return readResource(raw, key, guard, command, label);
  }

  private async getJson(path: string, searchParams?: Record<string, string>): Promise<unknown> {
    const url = `${this.endpoint}${path}`;
    try {
      return await ky
        .get(url, {
          headers: this.authHeaders(),
          searchParams,
          retry: 0,
          timeout: DEFAULT_TIMEOUT_MS,
        })
        .json();
    } catch (error) {
      throw toNhnCloudCliError(error);
    }
  }

  private async postJson(path: string, json: unknown): Promise<unknown> {
    const url = `${this.endpoint}${path}`;
    try {
      return await ky
        .post(url, {
          headers: this.authHeaders(),
          json,
          retry: 0,
          timeout: DEFAULT_TIMEOUT_MS,
        })
        .json();
    } catch (error) {
      throw toNhnCloudCliError(error);
    }
  }

  private async putJson(path: string, json: unknown): Promise<unknown> {
    const url = `${this.endpoint}${path}`;
    try {
      return await ky
        .put(url, {
          headers: this.authHeaders(),
          json,
          retry: 0,
          timeout: DEFAULT_TIMEOUT_MS,
        })
        .json();
    } catch (error) {
      throw toNhnCloudCliError(error);
    }
  }

  private async deleteNoContent(path: string): Promise<void> {
    const url = `${this.endpoint}${path}`;
    try {
      await ky.delete(url, {
        headers: this.authHeaders(),
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
    } catch (error) {
      throw toNhnCloudCliError(error);
    }
  }
}
