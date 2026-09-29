import { beforeEach, describe, expect, it, vi } from "vitest";
import ky, { HTTPError } from "ky";
import { NetworkClient } from "./client.js";
import { EXIT_API_ERROR, EXIT_AUTH_ERROR } from "../../utils/exit-codes.js";

vi.mock("ky", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ky")>();
  return { ...actual, default: { ...actual.default, get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() } };
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

describe("NetworkClient 보안그룹 쓰기", () => {
  const client = new NetworkClient("token", endpoint);
  const headers = { "X-Auth-Token": "token" };

  beforeEach(() => vi.clearAllMocks());

  function replyWrite(method: "post" | "put", value: unknown): void {
    vi.mocked(ky[method]).mockReturnValue({ json: async () => value } as never);
  }

  it("보안그룹 생성은 undefined 키를 뺀 본문을 POST 한다", async () => {
    replyWrite("post", { security_group: group });
    await expect(client.createSecurityGroup({ name: "web", description: undefined })).resolves.toEqual(group);
    expect(ky.post).toHaveBeenCalledWith(`${endpoint}/security-groups`, expect.objectContaining({ headers, retry: 0 }));
    expect(vi.mocked(ky.post).mock.calls[0]?.[1]?.json).toStrictEqual({ security_group: { name: "web" } });
  });

  it("보안그룹 수정은 id를 인코딩해 PUT 하고 undefined 키를 뺀다", async () => {
    replyWrite("put", { security_group: group });
    await client.updateSecurityGroup("group/1", { name: undefined, description: "d" });
    expect(ky.put).toHaveBeenCalledWith(`${endpoint}/security-groups/group%2F1`, expect.objectContaining({ headers, retry: 0 }));
    expect(vi.mocked(ky.put).mock.calls[0]?.[1]?.json).toStrictEqual({ security_group: { description: "d" } });
  });

  it("보안그룹과 규칙 삭제는 무본문 DELETE 를 보낸다", async () => {
    vi.mocked(ky.delete).mockResolvedValue({} as never);
    await client.deleteSecurityGroup("group-1");
    await client.deleteSecurityGroupRule("rule-1");
    expect(ky.delete).toHaveBeenNthCalledWith(1, `${endpoint}/security-groups/group-1`, expect.objectContaining({ headers, retry: 0 }));
    expect(ky.delete).toHaveBeenNthCalledWith(2, `${endpoint}/security-group-rules/rule-1`, expect.objectContaining({ headers, retry: 0 }));
  });

  it("규칙 생성은 ethertype IPv4 를 넣고 undefined 선택 필드를 뺀다", async () => {
    replyWrite("post", { security_group_rule: rule });
    await expect(client.createSecurityGroupRule({
      security_group_id: "group-1", direction: "ingress", protocol: "tcp",
      port_range_min: 22, port_range_max: 22, remote_ip_prefix: undefined, remote_group_id: undefined, description: undefined,
    })).resolves.toEqual(rule);
    expect(ky.post).toHaveBeenCalledWith(`${endpoint}/security-group-rules`, expect.objectContaining({ headers, retry: 0 }));
    expect(vi.mocked(ky.post).mock.calls[0]?.[1]?.json).toStrictEqual({
      security_group_rule: {
        security_group_id: "group-1", direction: "ingress", protocol: "tcp",
        port_range_min: 22, port_range_max: 22, ethertype: "IPv4",
      },
    });
  });

  it("규칙 생성 400 거부는 서버 응답을 담은 오류가 된다", async () => {
    const body = JSON.stringify({ NeutronError: { message: "Must also specify protocol if port range is given.", type: "x", detail: "" } });
    const error = new HTTPError(new Response(body, { status: 400 }), new Request(`${endpoint}/security-group-rules`), {} as never);
    vi.mocked(ky.post).mockReturnValue({ json: async () => { throw error; } } as never);
    await expect(client.createSecurityGroupRule({ security_group_id: "group-1", direction: "ingress", port_range_min: 22 }))
      .rejects.toMatchObject({
        exitCode: EXIT_API_ERROR,
        message: expect.stringContaining("서버 응답: Must also specify protocol if port range is given."),
      });
  });

  it("응답 형식이 잘못되면 API 오류로 바꾼다", async () => {
    replyWrite("post", { security_group: { id: 1 } });
    await expect(client.createSecurityGroup({ name: "web" })).rejects.toMatchObject({ exitCode: EXIT_API_ERROR });
  });

  it("원격 그룹 조회는 remote_group_id 만 searchParams 에 담는다", async () => {
    reply({ security_group_rules: [rule] });
    await expect(client.listSecurityGroupRulesByRemoteGroup("group-2")).resolves.toEqual([rule]);
    expect(ky.get).toHaveBeenCalledWith(`${endpoint}/security-group-rules`, expect.objectContaining({
      headers, retry: 0, searchParams: { remote_group_id: "group-2" },
    }));
    expect(vi.mocked(ky.get).mock.calls[0]?.[1]?.searchParams).toStrictEqual({ remote_group_id: "group-2" });
  });
});
