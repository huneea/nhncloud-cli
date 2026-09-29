import { beforeEach, describe, expect, it, vi } from "vitest";
import ky, { HTTPError } from "ky";
import { NetworkClient } from "./client.js";
import { EXIT_API_ERROR, EXIT_AUTH_ERROR } from "../../utils/exit-codes.js";

vi.mock("ky", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ky")>();
  return { ...actual, default: { ...actual.default, get: vi.fn() } };
});

const endpoint = "https://kr1-api-network-infrastructure.nhncloudservice.com/v2.0";
const rule = {
  id: "rule-1", security_group_id: "group-1", direction: "ingress", ethertype: "IPv4",
  protocol: null, port_range_min: null, port_range_max: null, remote_ip_prefix: null,
  remote_group_id: null, description: null, tenant_id: "tenant-1",
};
const group = { id: "group-1", name: "default", description: "", tenant_id: "tenant-1", security_group_rules: [rule] };
const port = {
  id: "port-1", name: "", status: "ACTIVE", device_owner: "compute:az", device_id: "server-1",
  network_id: "network-1", fixed_ips: [{ subnet_id: "subnet-1", ip_address: "192.0.2.1" }],
  security_groups: ["group-1"],
};

function reply(value: unknown): void {
  vi.mocked(ky.get).mockReturnValue({ json: async () => value } as never);
}

describe("NetworkClient 보안그룹 조회", () => {
  beforeEach(() => vi.clearAllMocks());

  it("다섯 요청 모두 버전이 중복되지 않은 URL과 올바른 응답 키를 쓴다", async () => {
    const client = new NetworkClient("token", endpoint);
    const cases = [
      { invoke: () => client.listSecurityGroups(), path: "/security-groups", body: { security_groups: [group] } },
      { invoke: () => client.getSecurityGroup("group-1"), path: "/security-groups/group-1", body: { security_group: group } },
      { invoke: () => client.listSecurityGroupRules("group-1"), path: "/security-group-rules", body: { security_group_rules: [rule] } },
      { invoke: () => client.getSecurityGroupRule("rule-1"), path: "/security-group-rules/rule-1", body: { security_group_rule: rule } },
      { invoke: () => client.listSecurityGroupPorts("group-1"), path: "/security-group-ports", body: { security_group_ports: [port] } },
    ];
    for (const testCase of cases) {
      reply(testCase.body);
      await testCase.invoke();
      expect(ky.get).toHaveBeenLastCalledWith(endpoint + testCase.path, expect.objectContaining({
        headers: { "X-Auth-Token": "token" }, retry: 0,
      }));
      expect(vi.mocked(ky.get).mock.lastCall?.[0]).not.toContain("/v2.0/v2.0");
    }
    expect(vi.mocked(ky.get).mock.calls[2]?.[1]).toMatchObject({ searchParams: { security_group_id: "group-1" } });
    expect(vi.mocked(ky.get).mock.calls[4]?.[1]).toMatchObject({ searchParams: { security_group_id: "group-1" } });
    expect(vi.mocked(ky.get).mock.calls[2]?.[1]).not.toHaveProperty("searchParams.limit");
  });

  it("nullable 규칙 필드는 통과시키고 잘못된 필드는 거부한다", async () => {
    const client = new NetworkClient("token", endpoint);
    reply({ security_group_rules: [rule] });
    await expect(client.listSecurityGroupRules("group-1")).resolves.toEqual([rule]);
    reply({ security_group_rules: [{ ...rule, protocol: 6 }] });
    await expect(client.listSecurityGroupRules("group-1")).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
    reply({ security_group_ports: [{ ...port, security_groups: [3] }] });
    await expect(client.listSecurityGroupPorts("group-1")).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });

  it("HTTP 403과 500을 각 종료 코드로 변환한다", async () => {
    const client = new NetworkClient("token", endpoint);
    for (const [status, exitCode] of [[403, EXIT_AUTH_ERROR], [500, EXIT_API_ERROR]]) {
      const response = new Response(null, { status });
      const error = new HTTPError(response, new Request(endpoint + "/security-groups"), {} as never);
      vi.mocked(ky.get).mockReturnValue({ json: async () => { throw error; } } as never);
      await expect(client.listSecurityGroups()).rejects.toMatchObject({ exitCode });
    }
  });

  it("공공망 endpoint를 그대로 사용한다", async () => {
    const govEndpoint = "https://kr1-api-network-infrastructure.gov-nhncloudservice.com/v2.0";
    reply({ security_groups: [] });
    await new NetworkClient("token", govEndpoint).listSecurityGroups();
    expect(ky.get).toHaveBeenCalledWith(govEndpoint + "/security-groups", expect.any(Object));
  });
});
