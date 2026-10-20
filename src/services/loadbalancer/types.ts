export type IpAclAction = "ALLOW" | "DENY";

export interface LoadBalancerIpAclGroup {
  ipacl_group_id: string;
}

export interface LoadBalancer {
  id: string;
  name: string;
  vip_address: string;
  provisioning_status: string;
  operating_status: string;
  ipacl_group_action: IpAclAction | null;
  ipacl_groups: LoadBalancerIpAclGroup[];
}

export interface IpAclGroupLoadBalancer {
  loadbalancer_id: string;
}

export interface IpAclGroup {
  id: string;
  name: string;
  action: IpAclAction;
  ipacl_target_count: string;
  loadbalancers: IpAclGroupLoadBalancer[];
}

export interface IpAclTarget {
  id: string;
  cidr_address: string;
  description: string;
  ipacl_group_id: string;
}

export interface CreateIpAclGroupInput {
  name: string;
  action: IpAclAction;
  description?: string;
}

export interface CreateIpAclGroupRequest {
  ipacl_group: CreateIpAclGroupInput;
}

export interface CreateIpAclTargetInput {
  ipacl_group_id: string;
  cidr_address: string;
  description?: string;
}

export interface CreateIpAclTargetRequest {
  ipacl_target: CreateIpAclTargetInput;
}

export interface UpdateIpAclTargetInput {
  description: string;
}

export interface UpdateIpAclTargetRequest {
  ipacl_target: UpdateIpAclTargetInput;
}

export interface IpAclGroupBinding {
  ipacl_group_id: string;
}

export interface BindIpAclGroupsRequest {
  ipacl_groups_binding: IpAclGroupBinding[];
}

export interface IpAclBinding {
  loadbalancer_id: string;
  ipacl_group_id: string;
}

export interface LoadBalancersResponse {
  loadbalancers: LoadBalancer[];
}

export interface LoadBalancerResponse {
  loadbalancer: LoadBalancer;
}

export interface IpAclGroupsResponse {
  ipacl_groups: IpAclGroup[];
}

export interface IpAclGroupResponse {
  ipacl_group: IpAclGroup;
}

export interface IpAclTargetsResponse {
  ipacl_targets: IpAclTarget[];
}

export interface IpAclTargetResponse {
  ipacl_target: IpAclTarget;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isIpAclAction(value: unknown): value is IpAclAction {
  return value === "ALLOW" || value === "DENY";
}

function isLoadBalancerIpAclGroup(value: unknown): value is LoadBalancerIpAclGroup {
  return isRecord(value) && isNonEmptyString(value["ipacl_group_id"]);
}

function isIpAclGroupLoadBalancer(value: unknown): value is IpAclGroupLoadBalancer {
  return isRecord(value) && isNonEmptyString(value["loadbalancer_id"]);
}

export function isLoadBalancer(value: unknown): value is LoadBalancer {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value["id"]) &&
    typeof value["name"] === "string" &&
    typeof value["vip_address"] === "string" &&
    typeof value["provisioning_status"] === "string" &&
    typeof value["operating_status"] === "string" &&
    (value["ipacl_group_action"] === null || isIpAclAction(value["ipacl_group_action"])) &&
    Array.isArray(value["ipacl_groups"]) &&
    value["ipacl_groups"].every(isLoadBalancerIpAclGroup)
  );
}

export function isIpAclGroup(value: unknown): value is IpAclGroup {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value["id"]) &&
    typeof value["name"] === "string" &&
    isIpAclAction(value["action"]) &&
    typeof value["ipacl_target_count"] === "string" &&
    Array.isArray(value["loadbalancers"]) &&
    value["loadbalancers"].every(isIpAclGroupLoadBalancer)
  );
}

export function isIpAclTarget(value: unknown): value is IpAclTarget {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value["id"]) &&
    typeof value["cidr_address"] === "string" &&
    typeof value["description"] === "string" &&
    isNonEmptyString(value["ipacl_group_id"])
  );
}

export function isIpAclBinding(value: unknown): value is IpAclBinding {
  return (
    isRecord(value) &&
    isNonEmptyString(value["loadbalancer_id"]) &&
    isNonEmptyString(value["ipacl_group_id"])
  );
}
