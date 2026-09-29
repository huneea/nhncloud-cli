import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { NetworkClient } from "../../services/network/client.js";
import { InstanceClient } from "../../services/instance/client.js";
import type { SecurityGroup, SecurityGroupPort, SecurityGroupRule } from "../../services/network/types.js";
import { output } from "../../formatters/table.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR, EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { formatRulePorts, resolveSecurityGroupClients } from "./helpers.js";
import { securityGroupCommand } from "./security-group.js";

vi.mock("./helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./helpers.js")>();
  return { ...actual, resolveSecurityGroupClients: vi.fn() };
});
vi.mock("../../formatters/table.js", () => ({ output: vi.fn() }));
vi.mock("../../utils/spinner.js", () => ({ startSpinner: vi.fn(), stopSpinner: vi.fn() }));

const rule: SecurityGroupRule = {
  id: "rule-1", security_group_id: "group-1", direction: "ingress", ethertype: "IPv4",
  protocol: null, port_range_min: null, port_range_max: null, remote_ip_prefix: null,
  remote_group_id: null, description: null, tenant_id: "tenant-1",
};
const group: SecurityGroup = {
  id: "group-1", name: "default", description: "standard", tenant_id: "tenant-1",
  security_group_rules: [rule, { ...rule, id: "rule-2" }],
};
const computePort: SecurityGroupPort = {
  id: "port-1", name: "", status: "ACTIVE", device_owner: "compute:az", device_id: "server-1",
  network_id: "network-1", fixed_ips: [{ subnet_id: "subnet-1", ip_address: "192.0.2.1" }],
  security_groups: ["group-1", "group-2"],
};
const network = new NetworkClient("token", "https://example.com/v2.0");
const instance = new InstanceClient("token", "https://example.com/v2/tenant-1", "https://example.com/v2");
const listGroups = vi.spyOn(network, "listSecurityGroups");
const getGroup = vi.spyOn(network, "getSecurityGroup");
const listRules = vi.spyOn(network, "listSecurityGroupRules");
const getRule = vi.spyOn(network, "getSecurityGroupRule");
const listPorts = vi.spyOn(network, "listSecurityGroupPorts");
const listServers = vi.spyOn(instance, "list");
const createGroup = vi.spyOn(network, "createSecurityGroup");
const updateGroup = vi.spyOn(network, "updateSecurityGroup");
const deleteGroup = vi.spyOn(network, "deleteSecurityGroup");
const createRule = vi.spyOn(network, "createSecurityGroupRule");
const deleteRule = vi.spyOn(network, "deleteSecurityGroupRule");
const listRulesByRemote = vi.spyOn(network, "listSecurityGroupRulesByRemoteGroup");

function program(): Command {
  return new Command("nhncloud").exitOverride().option("--json").option("--quiet").addCommand(securityGroupCommand);
}

async function run(...args: string[]): Promise<void> {
  await program().parseAsync(["node", "nhncloud", ...args]);
}

describe("network security-group 명령", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveSecurityGroupClients).mockResolvedValue({ network, instance, profileName: "default" });
    listGroups.mockResolvedValue([group]);
  });

  it("list는 규칙 수와 그룹 ID를 출력한다", async () => {
    await run("--json", "security-group", "list", "--region", "kr1", "--profile", "test");
    expect(resolveSecurityGroupClients).toHaveBeenCalledWith(expect.objectContaining({
      json: true, region: "kr1", profile: "test",
    }));
    expect(output).toHaveBeenCalledWith(expect.any(Object), {
      headers: ["id", "name", "description", "rules"],
      rows: [["group-1", "default", "standard", "2"]], raw: [group], ids: ["group-1"],
    });
  });

  it("get은 이름을 UUID로 바꾸고, 중복 이름이면 상세 API를 호출하지 않는다", async () => {
    getGroup.mockResolvedValue(group);
    await run("security-group", "get", "default");
    expect(getGroup).toHaveBeenCalledWith("group-1");
    expect(output).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      headers: ["field", "value"], raw: group, ids: ["group-1"],
    }));

    listGroups.mockResolvedValue([group, { ...group, id: "group-2" }]);
    getGroup.mockClear();
    await expect(run("security-group", "get", "default")).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(getGroup).not.toHaveBeenCalled();
  });

  it("rule list와 get은 nullable 값, 포트 범위, 원격 그룹을 표시한다", async () => {
    const port22 = { ...rule, id: "rule-2", protocol: "tcp", port_range_min: 22, port_range_max: 22,
      remote_ip_prefix: "192.0.2.0/24", description: "ssh" };
    const range = { ...rule, id: "rule-3", port_range_min: 1000, port_range_max: 2000,
      remote_group_id: "remote-1" };
    listRules.mockResolvedValue([rule, port22, range]);
    await run("security-group", "rule", "list", "default");
    expect(listRules).toHaveBeenCalledWith("group-1");
    expect(output).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      rows: [
        ["rule-1", "ingress", "IPv4", "any", "any", "any", ""],
        ["rule-2", "ingress", "IPv4", "tcp", "22", "192.0.2.0/24", "ssh"],
        ["rule-3", "ingress", "IPv4", "any", "1000-2000", "sg:remote-1", ""],
      ],
    }));
    getRule.mockResolvedValue(range);
    await run("security-group", "rule", "get", "rule-3");
    expect(getRule).toHaveBeenCalledWith("rule-3");
    expect(output).toHaveBeenLastCalledWith(expect.any(Object), expect.objectContaining({
      headers: ["field", "value"], ids: ["rule-3"], raw: range,
    }));
  });

  it("ports는 compute 인스턴스만 이름을 붙이고 UUID를 중복 제거한다", async () => {
    listPorts.mockResolvedValue([computePort, { ...computePort, id: "port-2" },
      { ...computePort, id: "port-3", device_owner: "trunk:subport", device_id: "trunk-1" }]);
    listServers.mockResolvedValue([{ id: "server-1", name: "web" }] as never);
    await run("--quiet", "security-group", "ports", "default");
    expect(listServers).toHaveBeenCalledTimes(1);
    expect(output).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      ids: ["server-1"],
      raw: [expect.objectContaining({ instance_name: "web" }), expect.objectContaining({ instance_name: "web" }),
        expect.objectContaining({ instance_name: null })],
    }));
  });

  it("인스턴스 목록 실패는 경고만 남기고 포트를 출력한다", async () => {
    listPorts.mockResolvedValue([computePort]);
    listServers.mockRejectedValue(new NhnCloudCliError("조회 실패", EXIT_API_ERROR));
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await run("security-group", "ports", "default");
      expect(write).toHaveBeenCalledWith("경고: 인스턴스 이름을 조회하지 못했습니다: 조회 실패\n");
      expect(output).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
        raw: [expect.objectContaining({ instance_name: null })],
      }));
    } finally {
      write.mockRestore();
    }
  });

  it("compute 포트가 없으면 인스턴스 목록을 호출하지 않는다", async () => {
    listPorts.mockResolvedValue([{ ...computePort, device_owner: "trunk:subport" }]);
    await run("security-group", "ports", "default");
    expect(listServers).not.toHaveBeenCalled();
  });

  it("빈 그룹 인수는 client 해석 전에 거부한다", async () => {
    await expect(run("security-group", "ports", " ")).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(resolveSecurityGroupClients).not.toHaveBeenCalled();
  });
});

describe("network security-group 쓰기 명령", () => {
  const webGroup: SecurityGroup = { ...group, id: "group-2", name: "web", security_group_rules: [] };
  let stderr: MockInstance<typeof process.stderr.write>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveSecurityGroupClients).mockResolvedValue({ network, instance, profileName: "default" });
    listGroups.mockResolvedValue([group, webGroup]);
    listPorts.mockResolvedValue([]);
    listRulesByRemote.mockResolvedValue([]);
    deleteGroup.mockResolvedValue(undefined);
    deleteRule.mockResolvedValue(undefined);
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderr.mockRestore();
  });

  function stderrText(): string {
    return stderr.mock.calls.map((call) => String(call[0])).join("");
  }

  it("delete는 --yes가 없으면 client 해석 전에 거부한다", async () => {
    await expect(run("security-group", "delete", "default")).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR, message: "보안그룹 삭제에는 --yes 플래그가 필요합니다.",
    });
    expect(resolveSecurityGroupClients).not.toHaveBeenCalled();
  });

  it("delete는 연결 포트가 있으면 삭제하지 않고 해제 방법을 안내한다", async () => {
    listPorts.mockResolvedValue([computePort, { ...computePort, id: "port-2", device_id: "server-2" }]);
    await expect(run("security-group", "delete", "default", "--yes")).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR,
      message: expect.stringContaining("instance security-group remove"),
    });
    await expect(run("security-group", "delete", "default", "--yes")).rejects.toThrow(
      "보안그룹이 포트 2개에 연결되어 있어 삭제할 수 없습니다. 먼저 instance security-group remove로 연결을 해제하세요: server-1, server-2",
    );
    expect(deleteGroup).not.toHaveBeenCalled();
  });

  it("delete는 다른 그룹 규칙이 참조하면 삭제 뒤 경고를 남기고 결과를 출력한다", async () => {
    listRulesByRemote.mockResolvedValue([{ ...rule, id: "rule-9", security_group_id: "group-2", remote_group_id: "group-1" }]);
    await run("security-group", "delete", "default", "--yes");
    expect(deleteGroup).toHaveBeenCalledWith("group-1");
    expect(stderrText()).toContain("경고: 다른 보안그룹 규칙 1개가 이 그룹을 원격 그룹으로 참조했습니다: group-2/rule-9\n");
    const result = { operation: "security-group-delete", status: "succeeded", security_group_id: "group-1" };
    expect(output).toHaveBeenCalledWith(expect.any(Object), {
      headers: ["field", "value"],
      rows: [["operation", "security-group-delete"], ["status", "succeeded"], ["security_group_id", "group-1"]],
      raw: result, ids: ["group-1"],
    });
  });

  it("delete는 자기 그룹 규칙만 참조하면 경고하지 않는다", async () => {
    listRulesByRemote.mockResolvedValue([{ ...rule, id: "rule-self", security_group_id: "group-1", remote_group_id: "group-1" }]);
    await run("security-group", "delete", "default", "--yes");
    expect(deleteGroup).toHaveBeenCalledWith("group-1");
    expect(stderrText()).not.toContain("경고");
  });

  it("delete는 서버가 remote_group_id 필터를 무시해도 삭제 대상을 참조하는 규칙만 센다", async () => {
    listRulesByRemote.mockResolvedValue([
      { ...rule, id: "rule-a", security_group_id: "group-2", remote_group_id: "group-1" },
      { ...rule, id: "rule-b", security_group_id: "group-2", remote_group_id: "group-3" },
      { ...rule, id: "rule-c", security_group_id: "group-2", remote_group_id: null },
      { ...rule, id: "rule-d", security_group_id: "group-1", remote_group_id: "group-1" },
    ]);
    await run("security-group", "delete", "default", "--yes");
    expect(stderrText()).toContain("경고: 다른 보안그룹 규칙 1개가 이 그룹을 원격 그룹으로 참조했습니다: group-2/rule-a\n");
  });

  it("delete는 참조 규칙 조회가 실패해도 삭제를 진행하고 확인 실패를 경고한다", async () => {
    listRulesByRemote.mockRejectedValue(new NhnCloudCliError("조회 실패", EXIT_API_ERROR));
    await run("security-group", "delete", "default", "--yes");
    expect(deleteGroup).toHaveBeenCalledWith("group-1");
    expect(stderrText()).toContain("경고: 다른 보안그룹 규칙의 원격 그룹 참조를 확인하지 못했습니다. 삭제는 진행했습니다.\n");
    expect(output).toHaveBeenCalled();
  });

  it("create는 공백 이름을 client 해석 전에 거부하고, 이름을 trim해 보낸다", async () => {
    await expect(run("security-group", "create", "--name", "  ")).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR, message: "--name은 비어 있을 수 없습니다.",
    });
    expect(resolveSecurityGroupClients).not.toHaveBeenCalled();

    createGroup.mockResolvedValue(webGroup);
    await run("security-group", "create", "--name", " web ", "--description", "front");
    expect(createGroup).toHaveBeenCalledWith({ name: "web", description: "front" });
    expect(output).toHaveBeenCalledWith(expect.any(Object), {
      headers: ["field", "value"],
      rows: [["id", "group-2"], ["name", "web"], ["description", "standard"], ["rules", "0"]],
      raw: webGroup, ids: ["group-2"],
    });
  });

  it("update는 옵션이 없으면 client 해석 전에 거부하고, 그룹 이름을 UUID로 바꿔 보낸다", async () => {
    await expect(run("security-group", "update", "default")).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR, message: "--name 또는 --description 중 하나는 필요합니다.",
    });
    expect(resolveSecurityGroupClients).not.toHaveBeenCalled();

    updateGroup.mockResolvedValue(group);
    await run("security-group", "update", "default", "--description", "");
    expect(updateGroup).toHaveBeenCalledWith("group-1", { name: undefined, description: "" });
  });

  it("rule create는 --remote-group을 UUID로 바꿔 remote_group_id로 보낸다", async () => {
    const created = { ...rule, id: "rule-new", protocol: "tcp", port_range_min: 22, port_range_max: 22, remote_group_id: "group-2" };
    createRule.mockResolvedValue(created);
    await run("security-group", "rule", "create", "default", "--direction", "ingress",
      "--protocol", "tcp", "--port", "22", "--remote-group", "web");
    expect(createRule).toHaveBeenCalledWith({
      security_group_id: "group-1", direction: "ingress", protocol: "tcp",
      port_range_min: 22, port_range_max: 22, remote_group_id: "group-2",
    });
    expect(output).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      headers: ["field", "value"], raw: created, ids: ["rule-new"],
    }));
  });

  it("rule create는 --cidr와 --remote-group을 함께 주면 client 해석 전에 거부한다", async () => {
    await expect(run("security-group", "rule", "create", "default", "--direction", "ingress",
      "--cidr", "10.0.0.0/8", "--remote-group", "web")).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(resolveSecurityGroupClients).not.toHaveBeenCalled();
    expect(createRule).not.toHaveBeenCalled();
  });

  it("rule delete는 --yes가 없으면 거부하고, 있으면 삭제 결과를 출력한다", async () => {
    await expect(run("security-group", "rule", "delete", "rule-1")).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR, message: "보안 규칙 삭제에는 --yes 플래그가 필요합니다.",
    });
    expect(resolveSecurityGroupClients).not.toHaveBeenCalled();

    await run("security-group", "rule", "delete", "rule-1", "--yes");
    expect(deleteRule).toHaveBeenCalledWith("rule-1");
    expect(output).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      raw: { operation: "security-group-rule-delete", status: "succeeded", security_group_rule_id: "rule-1" },
      ids: ["rule-1"],
    }));
  });
});

describe("formatRulePorts", () => {
  const base: SecurityGroupRule = {
    id: "rule-1", security_group_id: "sg-1", direction: "ingress", ethertype: "IPv4",
    protocol: "tcp", port_range_min: null, port_range_max: null,
    remote_ip_prefix: null, remote_group_id: null, description: null, tenant_id: "tenant-1",
  };

  it("한쪽 경계만 있으면 비어 있는 쪽을 any 로 표시한다", () => {
    expect(formatRulePorts({ ...base, port_range_min: 22 })).toBe("22-any");
    expect(formatRulePorts({ ...base, port_range_max: 443 })).toBe("any-443");
  });

  it("양쪽이 모두 없거나 같거나 다른 경우를 구분한다", () => {
    expect(formatRulePorts(base)).toBe("any");
    expect(formatRulePorts({ ...base, port_range_min: 22, port_range_max: 22 })).toBe("22");
    expect(formatRulePorts({ ...base, port_range_min: 1000, port_range_max: 2000 })).toBe("1000-2000");
  });
});
