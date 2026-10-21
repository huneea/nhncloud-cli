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
