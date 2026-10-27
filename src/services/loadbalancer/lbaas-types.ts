// 리스너, 풀, 멤버, 헬스 모니터, L7 정책과 규칙의 응답·요청 타입 (ADR-048).
// 가드는 표와 이름 해석에 쓰는 필드만 검사한다. 나머지 필드는 --json 으로 그대로 보존한다.

export const LISTENER_PROTOCOLS = ["TCP", "HTTP", "HTTPS", "TERMINATED_HTTPS"] as const;
export type ListenerProtocol = (typeof LISTENER_PROTOCOLS)[number];

export const LB_ALGORITHMS = ["ROUND_ROBIN", "LEAST_CONNECTIONS", "SOURCE_IP"] as const;
export type LbAlgorithm = (typeof LB_ALGORITHMS)[number];

export const HEALTH_MONITOR_TYPES = ["TCP", "HTTP", "HTTPS"] as const;
export type HealthMonitorType = (typeof HEALTH_MONITOR_TYPES)[number];

export const L7_POLICY_ACTIONS = ["REDIRECT_TO_POOL", "REDIRECT_TO_URL", "REJECT"] as const;
export type L7PolicyAction = (typeof L7_POLICY_ACTIONS)[number];

export const L7_RULE_TYPES = ["COOKIE", "FILE_TYPE", "HEADER", "HOST_NAME", "PATH"] as const;
export type L7RuleType = (typeof L7_RULE_TYPES)[number];

export const L7_COMPARE_TYPES = ["CONTAINS", "ENDS_WITH", "STARTS_WITH", "EQUAL_TO", "REGEX"] as const;
export type L7CompareType = (typeof L7_COMPARE_TYPES)[number];

export interface IdRef {
  id: string;
}

export interface Listener {
  id: string;
  name: string;
  protocol: string;
  protocol_port: number;
  loadbalancers: IdRef[];
  default_pool_id?: string | null;
  default_tls_container_ref?: string | null;
  sni_container_refs?: string[];
  tls_version?: string | null;
  cert_expire_date?: string | null;
  connection_limit?: number;
  keepalive_timeout?: number;
  admin_state_up?: boolean;
}

export interface Pool {
  id: string;
  name: string;
  protocol: string;
  lb_algorithm: string;
  loadbalancers: IdRef[];
  listeners: IdRef[];
  members: IdRef[];
  healthmonitor_id?: string | null;
  member_port?: number;
  admin_state_up?: boolean;
}

export interface Member {
  id: string;
  address: string;
  protocol_port: number;
  name?: string;
  subnet_id?: string | null;
  weight?: number;
  operating_status?: string;
  admin_state_up?: boolean;
}

export interface HealthMonitor {
  id: string;
  type: string;
  delay: number;
  timeout: number;
  max_retries: number;
  pools: IdRef[];
  url_path?: string;
  http_method?: string;
  expected_codes?: string;
  health_check_port?: number;
  admin_state_up?: boolean;
}

export interface L7Policy {
  id: string;
  name: string;
  listener_id: string;
  action: string;
  position: number;
  rules: IdRef[];
  redirect_pool_id?: string | null;
  redirect_url?: string | null;
  admin_state_up?: boolean;
}

export interface L7Rule {
  id: string;
  type: string;
  compare_type: string;
  value: string;
  invert: boolean;
  key?: string | null;
  admin_state_up?: boolean;
}

export interface CreateListenerInput {
  loadbalancer_id: string;
  protocol: ListenerProtocol;
  protocol_port: number;
  name?: string;
  description?: string;
  default_pool_id?: string;
  default_tls_container_ref?: string;
  sni_container_refs?: string[];
  tls_version?: string;
  connection_limit?: number;
  keepalive_timeout?: number;
}

export interface CreatePoolInput {
  lb_algorithm: LbAlgorithm;
  protocol: string;
  loadbalancer_id?: string;
  listener_id?: string;
  member_port?: number;
  name?: string;
  description?: string;
}

export interface CreateMemberInput {
  address: string;
  protocol_port: number;
  subnet_id: string;
  weight?: number;
}

export interface CreateHealthMonitorInput {
  pool_id: string;
  type: HealthMonitorType;
  delay: number;
  timeout: number;
  max_retries: number;
  url_path?: string;
  http_method?: string;
  expected_codes?: string;
  health_check_port?: number;
  host_header?: string;
}

export interface CreateL7PolicyInput {
  listener_id: string;
  action: L7PolicyAction;
  name?: string;
  description?: string;
  redirect_pool_id?: string;
  redirect_url?: string;
  redirect_http_code?: number;
  position?: number;
}

export interface CreateL7RuleInput {
  type: L7RuleType;
  compare_type: L7CompareType;
  value: string;
  invert: boolean;
  key?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isIdRefArray(value: unknown): value is IdRef[] {
  return (
    Array.isArray(value) &&
    value.every((item) => isRecord(item) && isNonEmptyString(item["id"]))
  );
}

function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

export function isListener(value: unknown): value is Listener {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value["id"]) &&
    typeof value["name"] === "string" &&
    typeof value["protocol"] === "string" &&
    typeof value["protocol_port"] === "number" &&
    isIdRefArray(value["loadbalancers"]) &&
    isOptionalNullableString(value["default_pool_id"]) &&
    isOptionalNullableString(value["default_tls_container_ref"])
  );
}

export function isPool(value: unknown): value is Pool {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value["id"]) &&
    typeof value["name"] === "string" &&
    typeof value["protocol"] === "string" &&
    typeof value["lb_algorithm"] === "string" &&
    isIdRefArray(value["loadbalancers"]) &&
    isIdRefArray(value["listeners"]) &&
    isIdRefArray(value["members"]) &&
    isOptionalNullableString(value["healthmonitor_id"])
  );
}

export function isMember(value: unknown): value is Member {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value["id"]) &&
    typeof value["address"] === "string" &&
    typeof value["protocol_port"] === "number"
  );
}

export function isHealthMonitor(value: unknown): value is HealthMonitor {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value["id"]) &&
    typeof value["type"] === "string" &&
    typeof value["delay"] === "number" &&
    typeof value["timeout"] === "number" &&
    typeof value["max_retries"] === "number" &&
    isIdRefArray(value["pools"])
  );
}

export function isL7Policy(value: unknown): value is L7Policy {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value["id"]) &&
    typeof value["name"] === "string" &&
    isNonEmptyString(value["listener_id"]) &&
    typeof value["action"] === "string" &&
    typeof value["position"] === "number" &&
    isIdRefArray(value["rules"]) &&
    isOptionalNullableString(value["redirect_pool_id"]) &&
    isOptionalNullableString(value["redirect_url"])
  );
}

export function isL7Rule(value: unknown): value is L7Rule {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value["id"]) &&
    typeof value["type"] === "string" &&
    typeof value["compare_type"] === "string" &&
    typeof value["value"] === "string" &&
    typeof value["invert"] === "boolean" &&
    isOptionalNullableString(value["key"])
  );
}
