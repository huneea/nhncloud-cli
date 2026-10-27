import { beforeEach, describe, expect, it, vi } from "vitest";
import ky from "ky";
import { LoadBalancerClient } from "./client.js";
import { EXIT_API_ERROR, EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";

vi.mock("ky", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ky")>();
  return {
    ...actual,
    default: {
      ...actual.default,
      delete: vi.fn(),
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
    },
  };
});

// 공공망 실측(2026-10-27) 응답의 필드 구성을 가짜 값으로 옮긴 고정값이다.
// 공식 문서에 없는 필드(loadbalancer_type, workflow_status, cert_expire_date 등)가 붙고,
// IP ACL 이 없는 Load Balancer 는 ipacl_group_action 칸이 없다.
const govLoadBalancer = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "gov-lb",
  description: "",
  provider: "haproxy",
  listeners: [{ id: "22222222-2222-4222-8222-222222222222" }],
  pools: [{ id: "33333333-3333-4333-8333-333333333333" }],
  ipacl_groups: [],
  vip_port_id: "44444444-4444-4444-8444-444444444444",
  vip_address: "192.0.2.10",
  vip_subnet_id: "55555555-5555-4555-8555-555555555555",
  provisioning_status: "ACTIVE",
  operating_status: "ONLINE",
  admin_state_up: true,
  tenant_id: "tenant-id",
  loadbalancer_type: "shared",
  engine_version: "v2",
  workflow_status: "SUCCESS",
  delete_protection: false,
  apply_subnet_host_routes: false,
};

const govListener = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "gov-lb:TERMINATED_HTTPS:443",
  description: "",
  protocol: "TERMINATED_HTTPS",
  loadbalancers: [{ id: govLoadBalancer.id }],
  tenant_id: "tenant-id",
  protocol_port: 443,
  connection_limit: 2000,
  default_pool_id: "33333333-3333-4333-8333-333333333333",
  admin_state_up: true,
  default_tls_container_ref: "https://kr1-api-key-manager-infrastructure.gov-nhncloudservice.com/v1/containers/66666666-6666-4666-8666-666666666666",
  sni_container_refs: [],
  keepalive_timeout: 300,
  keepalive_enable: true,
  proxy_protocol: false,
  tls_version: "TLSv1.2",
  cert_expire_date: "2027-01-01 00:00:00",
};

// TCP 리스너는 default_tls_container_ref, cert_expire_date, default_pool_id 칸이 없을 수 있다.
const {
  default_tls_container_ref: _ref,
  cert_expire_date: _expire,
  default_pool_id: _pool,
  ...govListenerBase
} = govListener;
const govTcpListener = {
  ...govListenerBase,
  id: "77777777-7777-4777-8777-777777777777",
  name: "gov-lb:TCP:8080",
  protocol: "TCP",
  protocol_port: 8080,
  tls_version: "",
};

const govPool = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "gov-pool",
  description: "",
  protocol: "HTTP",
  loadbalancers: [{ id: govLoadBalancer.id }],
  listeners: [],
  members: [{ id: "88888888-8888-4888-8888-888888888888" }],
  tenant_id: "tenant-id",
  lb_algorithm: "ROUND_ROBIN",
  admin_state_up: true,
  member_port: 80,
  healthmonitor_id: "99999999-9999-4999-8999-999999999999",
};

const govMember = {
  name: "",
  weight: 1,
  admin_state_up: true,
  subnet_id: null,
  tenant_id: "tenant-id",
  address: "192.0.2.20",
  protocol_port: 80,
  id: "88888888-8888-4888-8888-888888888888",
  operating_status: "ACTIVE",
};

const govHealthMonitor = {
  id: "99999999-9999-4999-8999-999999999999",
  tenant_id: "tenant-id",
  delay: 30,
  pools: [{ id: govPool.id }],
  timeout: 5,
  type: "TCP",
  admin_state_up: true,
  health_check_port: 0,
  max_retries: 2,
};

const govL7Policy = {
  redirect_pool_id: govPool.id,
  description: "",
  admin_state_up: true,
  rules: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
  tenant_id: "tenant-id",
  listener_id: govListener.id,
  action: "REDIRECT_TO_POOL",
  position: 1,
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "service-a",
};

const govL7Rule = {
  compare_type: "EQUAL_TO",
  admin_state_up: true,
  tenant_id: "tenant-id",
  invert: false,
  value: "service-a.example.com",
  key: "",
  type: "HOST_NAME",
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

const endpoint = "https://example.com/v2.0";

function mockGet(response: unknown): void {
  vi.mocked(ky.get).mockReturnValue({ json: async () => response } as never);
}

function mockPost(response: unknown): void {
  vi.mocked(ky.post).mockReturnValue({ json: async () => response } as never);
}

describe("LoadBalancerClient 공공망 응답", () => {
  beforeEach(() => vi.resetAllMocks());

  it("공공망 Load Balancer 목록과 단건의 추가 필드와 빠진 ipacl_group_action 을 통과시킨다", async () => {
    const client = new LoadBalancerClient("token-id", endpoint);

    mockGet({ loadbalancers: [govLoadBalancer] });
    await expect(client.listLoadBalancers()).resolves.toEqual([govLoadBalancer]);

    mockGet({ loadbalancer: govLoadBalancer });
    await expect(client.getLoadBalancer(govLoadBalancer.id)).resolves.toEqual(govLoadBalancer);
  });

  it.each([
    ["listListeners", "/lbaas/listeners", { listeners: [govListener, govTcpListener] }],
    ["listPools", "/lbaas/pools", { pools: [govPool] }],
    ["listHealthMonitors", "/lbaas/healthmonitors", { healthmonitors: [govHealthMonitor] }],
    ["listL7Policies", "/lbaas/l7policies", { l7policies: [govL7Policy] }],
  ] as const)("%s 가 공공망 목록 응답을 통과시키고 경로를 쓴다", async (method, path, response) => {
    mockGet(response);
    const client = new LoadBalancerClient("token-id", endpoint);

    const result = await client[method]();

    expect(result).toEqual(Object.values(response)[0]);
    expect(ky.get).toHaveBeenCalledWith(
      `${endpoint}${path}`,
      expect.objectContaining({ headers: { "X-Auth-Token": "token-id" }, retry: 0 }),
    );
  });

  it("풀 멤버와 L7 규칙은 상위 리소스 경로 아래에서 조회한다", async () => {
    const client = new LoadBalancerClient("token-id", endpoint);

    mockGet({ members: [govMember] });
    await expect(client.listMembers(govPool.id)).resolves.toEqual([govMember]);
    expect(ky.get).toHaveBeenLastCalledWith(
      `${endpoint}/lbaas/pools/${govPool.id}/members`,
      expect.anything(),
    );

    mockGet({ member: govMember });
    await expect(client.getMember(govPool.id, govMember.id)).resolves.toEqual(govMember);
    expect(ky.get).toHaveBeenLastCalledWith(
      `${endpoint}/lbaas/pools/${govPool.id}/members/${govMember.id}`,
      expect.anything(),
    );

    mockGet({ rules: [govL7Rule] });
    await expect(client.listL7Rules(govL7Policy.id)).resolves.toEqual([govL7Rule]);
    expect(ky.get).toHaveBeenLastCalledWith(
      `${endpoint}/lbaas/l7policies/${govL7Policy.id}/rules`,
      expect.anything(),
    );

    mockGet({ rule: govL7Rule });
    await expect(client.getL7Rule(govL7Policy.id, govL7Rule.id)).resolves.toEqual(govL7Rule);
  });

  it("단건 조회는 응답 키 이름의 객체를 꺼낸다", async () => {
    const client = new LoadBalancerClient("token-id", endpoint);

    mockGet({ listener: govListener });
    await expect(client.getListener(govListener.id)).resolves.toEqual(govListener);
    mockGet({ pool: govPool });
    await expect(client.getPool(govPool.id)).resolves.toEqual(govPool);
    mockGet({ healthmonitor: govHealthMonitor });
    await expect(client.getHealthMonitor(govHealthMonitor.id)).resolves.toEqual(govHealthMonitor);
    mockGet({ l7policy: govL7Policy });
    await expect(client.getL7Policy(govL7Policy.id)).resolves.toEqual(govL7Policy);
  });

  it("목록 배열이 없거나 항목 형식이 다르면 API 오류로 끝난다", async () => {
    const client = new LoadBalancerClient("token-id", endpoint);

    mockGet({});
    await expect(client.listListeners()).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
      message: expect.stringContaining("listeners 배열이 없습니다"),
    });

    mockGet({ listeners: [{ ...govListener, protocol_port: "443" }] });
    await expect(client.listListeners()).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
      message: expect.stringContaining("리스너 항목 형식이 예상과 다릅니다"),
    });
  });

  it("빈 식별자는 요청 전에 입력 오류로 막는다", async () => {
    const client = new LoadBalancerClient("token-id", endpoint);

    await expect(client.getListener("  ")).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    await expect(client.deleteMember("pool-1", "")).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(ky.get).not.toHaveBeenCalled();
    expect(ky.delete).not.toHaveBeenCalled();
  });
});

describe("LoadBalancerClient 쓰기 요청", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([
    [
      "createListener",
      "/lbaas/listeners",
      "listener",
      { loadbalancer_id: govLoadBalancer.id, protocol: "TERMINATED_HTTPS", protocol_port: 443 },
      govListener,
    ],
    [
      "createPool",
      "/lbaas/pools",
      "pool",
      { loadbalancer_id: govLoadBalancer.id, protocol: "HTTP", lb_algorithm: "ROUND_ROBIN" },
      govPool,
    ],
    [
      "createHealthMonitor",
      "/lbaas/healthmonitors",
      "healthmonitor",
      { pool_id: govPool.id, type: "TCP", delay: 30, timeout: 5, max_retries: 2 },
      govHealthMonitor,
    ],
    [
      "createL7Policy",
      "/lbaas/l7policies",
      "l7policy",
      { listener_id: govListener.id, action: "REDIRECT_TO_POOL", redirect_pool_id: govPool.id },
      govL7Policy,
    ],
  ] as const)("%s 는 리소스 키로 감싼 본문을 POST 한다", async (method, path, key, input, response) => {
    mockPost({ [key]: response });
    const client = new LoadBalancerClient("token-id", endpoint);

    const create = client[method] as (body: unknown) => Promise<unknown>;
    await expect(create.call(client, input)).resolves.toEqual(response);
    expect(ky.post).toHaveBeenCalledWith(
      `${endpoint}${path}`,
      expect.objectContaining({ json: { [key]: input }, retry: 0 }),
    );
  });

  it("멤버와 L7 규칙 생성은 상위 리소스 경로에 POST 한다", async () => {
    const client = new LoadBalancerClient("token-id", endpoint);

    mockPost({ member: govMember });
    const member = { address: "192.0.2.20", protocol_port: 80, subnet_id: "subnet-1" };
    await client.createMember(govPool.id, member);
    expect(ky.post).toHaveBeenLastCalledWith(
      `${endpoint}/lbaas/pools/${govPool.id}/members`,
      expect.objectContaining({ json: { member } }),
    );

    mockPost({ rule: govL7Rule });
    const rule = { type: "HOST_NAME", compare_type: "EQUAL_TO", value: "service-a.example.com", invert: false } as const;
    await client.createL7Rule(govL7Policy.id, rule);
    expect(ky.post).toHaveBeenLastCalledWith(
      `${endpoint}/lbaas/l7policies/${govL7Policy.id}/rules`,
      expect.objectContaining({ json: { rule } }),
    );
  });

  it("삭제는 리소스 경로에 DELETE 를 보낸다", async () => {
    vi.mocked(ky.delete).mockResolvedValue(new Response(null, { status: 204 }) as never);
    const client = new LoadBalancerClient("token-id", endpoint);

    await client.deleteListener("listener-1");
    await client.deletePool("pool-1");
    await client.deleteMember("pool-1", "member-1");
    await client.deleteHealthMonitor("hm-1");
    await client.deleteL7Policy("policy-1");
    await client.deleteL7Rule("policy-1", "rule-1");

    expect(vi.mocked(ky.delete).mock.calls.map(([url]) => url)).toEqual([
      `${endpoint}/lbaas/listeners/listener-1`,
      `${endpoint}/lbaas/pools/pool-1`,
      `${endpoint}/lbaas/pools/pool-1/members/member-1`,
      `${endpoint}/lbaas/healthmonitors/hm-1`,
      `${endpoint}/lbaas/l7policies/policy-1`,
      `${endpoint}/lbaas/l7policies/policy-1/rules/rule-1`,
    ]);
  });
});
