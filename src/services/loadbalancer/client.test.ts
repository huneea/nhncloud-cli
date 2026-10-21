import { beforeEach, describe, expect, it, vi } from "vitest";
import ky, { HTTPError } from "ky";
import { LoadBalancerClient } from "./client.js";
import {
  EXIT_API_ERROR,
  EXIT_AUTH_ERROR,
  EXIT_PARAM_ERROR,
} from "../../utils/exit-codes.js";

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

const loadBalancer = {
  id: "lb-1",
  name: "public-lb",
  vip_address: "192.0.2.10",
  provisioning_status: "ACTIVE",
  operating_status: "ONLINE",
  ipacl_group_action: "DENY",
  ipacl_groups: [{ ipacl_group_id: "group-1" }],
};

const ipAclGroup = {
  id: "group-1",
  name: "blocked-networks",
  action: "DENY",
  ipacl_target_count: "1",
  loadbalancers: [{ loadbalancer_id: "lb-1" }],
};

const ipAclTarget = {
  id: "target-1",
  cidr_address: "198.51.100.0/24",
  description: "example network",
  ipacl_group_id: "group-1",
};

function mockJsonResponse(response: unknown): void {
  vi.mocked(ky.get).mockReturnValue({
    json: async () => response,
  } as never);
}

function mockPostJsonResponse(response: unknown): void {
  vi.mocked(ky.post).mockReturnValue({
    json: async () => response,
  } as never);
}

function mockPutJsonResponse(response: unknown): void {
  vi.mocked(ky.put).mockReturnValue({
    json: async () => response,
  } as never);
}

describe("LoadBalancerClient", () => {
  beforeEach(() => vi.resetAllMocks());

  it("Load Balancer 목록 URL과 query, 인증·재시도·timeout 정책을 적용한다", async () => {
    mockJsonResponse({ loadbalancers: [] });

    const client = new LoadBalancerClient("token-id", "https://example.com/v2.0");
    await client.listLoadBalancers({ name: "public-lb" });

    expect(ky.get).toHaveBeenCalledWith(
      "https://example.com/v2.0/lbaas/loadbalancers",
      {
        headers: { "X-Auth-Token": "token-id" },
        searchParams: { name: "public-lb" },
        retry: 0,
        timeout: 30_000,
      },
    );
  });

  it("Load Balancer 단건을 반환하고 경로 식별자를 인코딩한다", async () => {
    mockJsonResponse({ loadbalancer: loadBalancer });

    const client = new LoadBalancerClient("token-id", "https://example.com/v2.0");
    const result = await client.getLoadBalancer("lb/id with space");

    expect(result).toEqual(loadBalancer);
    expect(ky.get).toHaveBeenCalledWith(
      "https://example.com/v2.0/lbaas/loadbalancers/lb%2Fid%20with%20space",
      expect.objectContaining({
        headers: { "X-Auth-Token": "token-id" },
        retry: 0,
        timeout: 30_000,
      }),
    );
  });

  it("Load Balancer 목록과 nullable IP ACL action을 반환한다", async () => {
    const withoutIpAcl = {
      ...loadBalancer,
      ipacl_group_action: null,
      ipacl_groups: [],
    };
    mockJsonResponse({ loadbalancers: [withoutIpAcl] });

    const client = new LoadBalancerClient("token-id", "https://example.com/v2.0");
    const result = await client.listLoadBalancers();

    expect(result).toEqual([withoutIpAcl]);
    expect(result[0].ipacl_group_action).toBeNull();
  });

  it("IP ACL이 연결되지 않아 ipacl_group_action 칸이 없는 응답도 목록과 단건에서 통과한다", async () => {
    const { ipacl_group_action: _omitted, ...withoutAction } = {
      ...loadBalancer,
      ipacl_groups: [],
    };
    const client = new LoadBalancerClient("token-id", "https://example.com/v2.0");

    mockJsonResponse({ loadbalancers: [withoutAction] });
    const list = await client.listLoadBalancers();
    expect(list).toEqual([withoutAction]);
    expect(list[0].ipacl_group_action).toBeUndefined();

    mockJsonResponse({ loadbalancer: withoutAction });
    await expect(client.getLoadBalancer("lb-1")).resolves.toEqual(withoutAction);
  });

  it("IP ACL 그룹 목록을 반환하고 문자열 target count를 보존한다", async () => {
    mockJsonResponse({ ipacl_groups: [ipAclGroup] });

    const client = new LoadBalancerClient("token-id", "https://example.com/v2.0");
    const result = await client.listIpAclGroups({ name: "blocked-networks" });

    expect(result).toEqual([ipAclGroup]);
    expect(result[0].ipacl_target_count).toBe("1");
    expect(ky.get).toHaveBeenCalledWith(
      "https://example.com/v2.0/lbaas/ipacl-groups",
      expect.objectContaining({
        searchParams: { name: "blocked-networks" },
        headers: { "X-Auth-Token": "token-id" },
        retry: 0,
        timeout: 30_000,
      }),
    );
  });

  it("IP ACL 그룹 단건을 반환하고 경로 식별자를 인코딩한다", async () => {
    mockJsonResponse({ ipacl_group: ipAclGroup });

    const client = new LoadBalancerClient("token-id", "https://example.com/v2.0");
    const result = await client.getIpAclGroup("group/id");

    expect(result).toEqual(ipAclGroup);
    expect(ky.get).toHaveBeenCalledWith(
      "https://example.com/v2.0/lbaas/ipacl-groups/group%2Fid",
      expect.objectContaining({
        headers: { "X-Auth-Token": "token-id" },
        retry: 0,
        timeout: 30_000,
      }),
    );
  });

  it("IP ACL 대상 목록과 필수 group query를 반환한다", async () => {
    mockJsonResponse({ ipacl_targets: [ipAclTarget] });

    const client = new LoadBalancerClient("token-id", "https://example.com/v2.0");
    const result = await client.listIpAclTargets({ ipacl_group_id: "group-1" });

    expect(result).toEqual([ipAclTarget]);
    expect(ky.get).toHaveBeenCalledWith(
      "https://example.com/v2.0/lbaas/ipacl-targets",
      {
        headers: { "X-Auth-Token": "token-id" },
        searchParams: { ipacl_group_id: "group-1" },
        retry: 0,
        timeout: 30_000,
      },
    );
  });

  it.each([
    ["Load Balancer", { loadbalancers: [] }, (client: LoadBalancerClient) => client.listLoadBalancers()],
    ["IP ACL 그룹", { ipacl_groups: [] }, (client: LoadBalancerClient) => client.listIpAclGroups()],
    [
      "IP ACL 대상",
      { ipacl_targets: [] },
      (client: LoadBalancerClient) => client.listIpAclTargets({ ipacl_group_id: "group-1" }),
    ],
  ])("%s 빈 목록은 빈 배열을 반환한다", async (_label, response, request) => {
    mockJsonResponse(response);

    const client = new LoadBalancerClient("token-id", "https://example.com/v2.0");
    await expect(request(client)).resolves.toEqual([]);
  });

  it.each([
    ["loadbalancers", (client: LoadBalancerClient) => client.listLoadBalancers()],
    ["ipacl_groups", (client: LoadBalancerClient) => client.listIpAclGroups()],
    [
      "ipacl_targets",
      (client: LoadBalancerClient) => client.listIpAclTargets({ ipacl_group_id: "group-1" }),
    ],
  ])("%s 배열 키 누락과 항목 형식 오류를 구분한다", async (key, request) => {
    const client = new LoadBalancerClient("token-id", "https://example.com/v2.0");

    mockJsonResponse({ unexpected: [] });
    await expect(request(client)).rejects.toMatchObject({
      message: expect.stringContaining(`${key} 배열이 없습니다`),
      exitCode: EXIT_API_ERROR,
    });

    mockJsonResponse({ [key]: [null] });
    await expect(request(client)).rejects.toMatchObject({
      message: expect.stringContaining("항목 형식이 예상과 다릅니다"),
      exitCode: EXIT_API_ERROR,
    });
  });

  it("중첩 참조 배열의 null·비객체 항목과 빈 식별자를 거부한다", async () => {
    const client = new LoadBalancerClient("token-id", "https://example.com/v2.0");

    mockJsonResponse({
      loadbalancers: [{ ...loadBalancer, ipacl_groups: [null] }],
    });
    await expect(client.listLoadBalancers()).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });

    mockJsonResponse({
      ipacl_groups: [{ ...ipAclGroup, loadbalancers: ["lb-1"] }],
    });
    await expect(client.listIpAclGroups()).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });

    mockJsonResponse({
      ipacl_targets: [{ ...ipAclTarget, id: "" }],
    });
    await expect(
      client.listIpAclTargets({ ipacl_group_id: "group-1" }),
    ).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
    });
  });

  it("HTTP 401 오류를 EXIT_AUTH_ERROR로 변환한다", async () => {
    const response = new Response(null, { status: 401, statusText: "Unauthorized" });
    const request = new Request("https://example.com/v2.0/lbaas/loadbalancers");
    const error = new HTTPError(response, request, {} as never);
    vi.mocked(ky.get).mockReturnValue({
      json: async () => {
        throw error;
      },
    } as never);

    const client = new LoadBalancerClient("token-id", "https://example.com/v2.0");
    await expect(client.listLoadBalancers()).rejects.toMatchObject({
      exitCode: EXIT_AUTH_ERROR,
    });
  });

  it("IP ACL 그룹 생성 payload와 응답 wrapper를 처리한다", async () => {
    mockPostJsonResponse({ ipacl_group: ipAclGroup });
    const client = new LoadBalancerClient("token-id", "https://example.com/v2.0");

    await expect(
      client.createIpAclGroup({
        name: "blocked-networks",
        action: "DENY",
        description: "blocked",
      }),
    ).resolves.toEqual(ipAclGroup);
    expect(ky.post).toHaveBeenCalledWith(
      "https://example.com/v2.0/lbaas/ipacl-groups",
      {
        headers: { "X-Auth-Token": "token-id" },
        json: {
          ipacl_group: {
            name: "blocked-networks",
            action: "DENY",
            description: "blocked",
          },
        },
        retry: 0,
        timeout: 30_000,
      },
    );
  });

  it("IP ACL 그룹과 대상 생성 응답의 wrapper·항목 오류를 구분한다", async () => {
    const client = new LoadBalancerClient("token-id", "https://example.com/v2.0");

    mockPostJsonResponse({ unexpected: ipAclGroup });
    await expect(
      client.createIpAclGroup({ name: "blocked", action: "DENY" }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("ipacl_group 객체가 없습니다"),
      exitCode: EXIT_API_ERROR,
    });

    mockPostJsonResponse({ ipacl_group: null });
    await expect(
      client.createIpAclGroup({ name: "blocked", action: "DENY" }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("항목 형식이 예상과 다릅니다"),
      exitCode: EXIT_API_ERROR,
    });

    mockPostJsonResponse({ ipacl_target: null });
    await expect(
      client.createIpAclTarget({
        ipacl_group_id: "group-1",
        cidr_address: "198.51.100.0/24",
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("항목 형식이 예상과 다릅니다"),
      exitCode: EXIT_API_ERROR,
    });
  });

  it("IP ACL 그룹 삭제는 빈 본문을 JSON 파싱하지 않고 식별자를 인코딩한다", async () => {
    vi.mocked(ky.delete).mockResolvedValue({} as never);
    const client = new LoadBalancerClient("token-id", "https://example.com/v2.0");

    await expect(client.deleteIpAclGroup("group/id")).resolves.toBeUndefined();
    expect(ky.delete).toHaveBeenCalledWith(
      "https://example.com/v2.0/lbaas/ipacl-groups/group%2Fid",
      {
        headers: { "X-Auth-Token": "token-id" },
        retry: 0,
        timeout: 30_000,
      },
    );
  });

  it("IP ACL 대상 단건 조회와 생성 payload를 처리한다", async () => {
    const client = new LoadBalancerClient("token-id", "https://example.com/v2.0");

    mockJsonResponse({ ipacl_target: ipAclTarget });
    await expect(client.getIpAclTarget("target/id")).resolves.toEqual(ipAclTarget);
    expect(ky.get).toHaveBeenCalledWith(
      "https://example.com/v2.0/lbaas/ipacl-targets/target%2Fid",
      expect.objectContaining({
        headers: { "X-Auth-Token": "token-id" },
        retry: 0,
        timeout: 30_000,
      }),
    );

    mockPostJsonResponse({ ipacl_target: ipAclTarget });
    await expect(
      client.createIpAclTarget({
        ipacl_group_id: "group-1",
        cidr_address: "198.51.100.0/24",
        description: "example network",
      }),
    ).resolves.toEqual(ipAclTarget);
    expect(ky.post).toHaveBeenCalledWith(
      "https://example.com/v2.0/lbaas/ipacl-targets",
      {
        headers: { "X-Auth-Token": "token-id" },
        json: {
          ipacl_target: {
            ipacl_group_id: "group-1",
            cidr_address: "198.51.100.0/24",
            description: "example network",
          },
        },
        retry: 0,
        timeout: 30_000,
      },
    );
  });

  it("IP ACL 대상 설명 변경은 description만 PUT하고 식별자를 인코딩한다", async () => {
    const client = new LoadBalancerClient("token-id", "https://example.com/v2.0");
    const updated = { ...ipAclTarget, description: "new" };
    vi.mocked(ky.put).mockReturnValue({ json: async () => ({ ipacl_target: updated }) } as never);

    await expect(
      client.updateIpAclTarget("target/id", { description: "new" }),
    ).resolves.toEqual(updated);
    expect(ky.put).toHaveBeenCalledWith(
      "https://example.com/v2.0/lbaas/ipacl-targets/target%2Fid",
      {
        headers: { "X-Auth-Token": "token-id" },
        json: { ipacl_target: { description: "new" } },
        retry: 0,
        timeout: 30_000,
      },
    );

    vi.mocked(ky.put).mockReturnValue({ json: async () => ({ ipacl_target: null }) } as never);
    await expect(
      client.updateIpAclTarget("target-1", { description: "x" }),
    ).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
    await expect(
      client.updateIpAclTarget(" ", { description: "x" }),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
  });

  it("IP ACL 대상 삭제는 빈 본문을 JSON 파싱하지 않는다", async () => {
    vi.mocked(ky.delete).mockResolvedValue({} as never);
    const client = new LoadBalancerClient("token-id", "https://example.com/v2.0");

    await expect(client.deleteIpAclTarget("target-1")).resolves.toBeUndefined();
    expect(ky.delete).toHaveBeenCalledWith(
      "https://example.com/v2.0/lbaas/ipacl-targets/target-1",
      {
        headers: { "X-Auth-Token": "token-id" },
        retry: 0,
        timeout: 30_000,
      },
    );
  });

  it("IP ACL binding 순서와 빈 배열을 보존하고 응답 항목을 검증한다", async () => {
    const client = new LoadBalancerClient("token-id", "https://example.com/v2.0");
    const bindings = [
      { loadbalancer_id: "lb-1", ipacl_group_id: "group-2" },
      { loadbalancer_id: "lb-1", ipacl_group_id: "group-1" },
    ];

    mockPutJsonResponse(bindings);
    await expect(
      client.bindIpAclGroups("lb/id", ["group-2", "group-1"]),
    ).resolves.toEqual(bindings);
    expect(ky.put).toHaveBeenCalledWith(
      "https://example.com/v2.0/lbaas/loadbalancers/lb%2Fid/bind_ipacl_groups",
      {
        headers: { "X-Auth-Token": "token-id" },
        json: {
          ipacl_groups_binding: [
            { ipacl_group_id: "group-2" },
            { ipacl_group_id: "group-1" },
          ],
        },
        retry: 0,
        timeout: 30_000,
      },
    );

    mockPutJsonResponse([]);
    await expect(client.bindIpAclGroups("lb-1", [])).resolves.toEqual([]);
    expect(ky.put).toHaveBeenLastCalledWith(
      "https://example.com/v2.0/lbaas/loadbalancers/lb-1/bind_ipacl_groups",
      expect.objectContaining({ json: { ipacl_groups_binding: [] } }),
    );

    mockPutJsonResponse([{ loadbalancer_id: "lb-1", ipacl_group_id: "" }]);
    await expect(client.bindIpAclGroups("lb-1", ["group-1"])).rejects.toMatchObject({
      message: expect.stringContaining("binding 항목 형식이 예상과 다릅니다"),
      exitCode: EXIT_API_ERROR,
    });
  });

  it("쓰기 path의 빈 식별자를 HTTP 호출 전에 거부한다", async () => {
    const client = new LoadBalancerClient("token-id", "https://example.com/v2.0");

    await expect(client.deleteIpAclGroup(" ")).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR,
    });
    await expect(client.getIpAclTarget("")).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR,
    });
    await expect(client.deleteIpAclTarget(" ")).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR,
    });
    await expect(client.bindIpAclGroups("", [])).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR,
    });
    await expect(client.bindIpAclGroups("lb-1", [" "])).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR,
    });

    expect(ky.get).not.toHaveBeenCalled();
    expect(ky.delete).not.toHaveBeenCalled();
    expect(ky.put).not.toHaveBeenCalled();
  });

  it("쓰기 HTTP 401 오류를 EXIT_AUTH_ERROR로 변환한다", async () => {
    const response = new Response(null, { status: 401, statusText: "Unauthorized" });
    const request = new Request("https://example.com/v2.0/lbaas/ipacl-groups");
    const error = new HTTPError(response, request, {} as never);
    vi.mocked(ky.post).mockReturnValue({
      json: async () => {
        throw error;
      },
    } as never);
    const client = new LoadBalancerClient("token-id", "https://example.com/v2.0");

    await expect(
      client.createIpAclGroup({ name: "blocked", action: "DENY" }),
    ).rejects.toMatchObject({
      exitCode: EXIT_AUTH_ERROR,
    });
  });
});
