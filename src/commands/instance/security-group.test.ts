import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { NetworkClient } from "../../services/network/client.js";
import { InstanceClient } from "../../services/instance/client.js";
import type { SecurityGroup, SecurityGroupPort } from "../../services/network/types.js";
import { output } from "../../formatters/table.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR, EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { resolveSecurityGroupClients } from "../network/helpers.js";
import { securityGroupCommand } from "./security-group.js";

vi.mock("../network/helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../network/helpers.js")>();
  return { ...actual, resolveSecurityGroupClients: vi.fn() };
});
vi.mock("../../formatters/table.js", () => ({ output: vi.fn() }));
vi.mock("../../utils/spinner.js", () => ({ startSpinner: vi.fn(), stopSpinner: vi.fn() }));

const web: SecurityGroup = { id: "group-web", name: "web", description: "", tenant_id: "tenant-1", security_group_rules: [] };
const other: SecurityGroup = { ...web, id: "group-other", name: "default" };
const port = (deviceId: string): SecurityGroupPort => ({
  id: `port-${deviceId}`, name: "", status: "ACTIVE", device_owner: "compute:az", device_id: deviceId,
  network_id: "network-1", fixed_ips: [], security_groups: ["group-web"],
});
const attached = [port("server-1"), port("server-2")];
const detached = [port("server-2")];

const network = new NetworkClient("token", "https://example.com/v2.0");
const instance = new InstanceClient("token", "https://example.com/v2/tenant-1", "https://example.com/v2");
const listGroups = vi.spyOn(network, "listSecurityGroups");
const listPorts = vi.spyOn(network, "listSecurityGroupPorts");
const addGroup = vi.spyOn(instance, "addSecurityGroup");
const removeGroup = vi.spyOn(instance, "removeSecurityGroup");

function program(): Command {
  return new Command("nhncloud").exitOverride().option("--json").option("--quiet").addCommand(securityGroupCommand);
}

async function run(...args: string[]): Promise<void> {
  await program().parseAsync(["node", "nhncloud", ...args]);
}

function expectResult(status: string, operation = "instance-security-group-add"): void {
  const raw = {
    operation, status, instance_id: "server-1", security_group_id: "group-web", security_group_name: "web",
  };
  expect(output).toHaveBeenCalledWith(expect.any(Object), {
    headers: ["field", "value"], rows: Object.entries(raw), raw, ids: ["server-1"],
  });
}

describe("instance security-group 명령", () => {
  let stderr: MockInstance<typeof process.stderr.write>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveSecurityGroupClients).mockResolvedValue({ network, instance, profileName: "default" });
    listGroups.mockResolvedValue([web, other]);
    addGroup.mockResolvedValue();
    removeGroup.mockResolvedValue();
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    stderr.mockRestore();
  });

  function stderrText(): string {
    return stderr.mock.calls.map((call) => String(call[0])).join("");
  }

  it("--yes가 없으면 client를 해석하기 전에 거부한다", async () => {
    await expect(run("security-group", "add", "server-1", "web")).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR, message: "보안그룹 연결 추가에는 --yes 플래그가 필요합니다.",
    });
    await expect(run("security-group", "remove", "server-1", "web")).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR, message: "보안그룹 연결 해제에는 --yes 플래그가 필요합니다.",
    });
    expect(resolveSecurityGroupClients).not.toHaveBeenCalled();
  });

  it("UUID로 지정한 그룹과 같은 이름의 그룹이 있으면 서버 액션을 요청하지 않는다", async () => {
    const twin: SecurityGroup = { ...web, id: "group-twin" };
    listGroups.mockResolvedValue([web, twin, other]);
    const failure = run("security-group", "add", "server-1", "group-web", "--yes");
    await expect(failure).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    await expect(failure).rejects.toThrow(/인스턴스 연결을 변경할 수 없습니다.*group-twin, group-web.*network security-group update/);
    expect(addGroup).not.toHaveBeenCalled();
  });

  it("add는 이미 연결돼 있으면 요청하지 않고 unchanged를 출력한다", async () => {
    listPorts.mockResolvedValue(attached);
    await run("security-group", "add", "server-1", "web", "--yes");
    expect(addGroup).not.toHaveBeenCalled();
    expectResult("unchanged");
    expect(stderrText()).toBe("");
  });

  it("add는 그룹 이름으로 서버 액션을 요청하고 사후 조회에 반영되면 경고하지 않는다", async () => {
    listPorts.mockResolvedValueOnce(detached).mockResolvedValueOnce(attached);
    await run("security-group", "add", "server-1", "group-web", "--yes");
    expect(addGroup).toHaveBeenCalledWith("server-1", "web");
    expect(listPorts).toHaveBeenCalledWith("group-web");
    expectResult("succeeded");
    expect(stderrText()).toBe("");
  });

  it("add 후 사후 조회에 반영되지 않으면 경고 한 줄을 쓰고 성공으로 끝낸다", async () => {
    listPorts.mockResolvedValue(detached);
    await expect(run("security-group", "add", "server-1", "web", "--yes")).resolves.toBeUndefined();
    expect(stderrText()).toBe(
      "경고: 요청은 접수됐지만 연결 조회에 아직 반영되지 않았습니다. network security-group ports group-web로 다시 확인하세요.\n",
    );
    expectResult("succeeded");
  });

  it("add 후 사후 조회가 실패해도 경고를 쓰고 성공으로 끝낸다", async () => {
    listPorts.mockResolvedValueOnce(detached)
      .mockRejectedValueOnce(new NhnCloudCliError("API 호출 실패 (503): Request failed with status code 503 Service Unavailable", EXIT_API_ERROR));
    await expect(run("security-group", "add", "server-1", "web", "--yes")).resolves.toBeUndefined();
    expect(stderrText()).toContain("경고: 요청은 접수됐지만 연결 상태를 확인하지 못했습니다.");
    expect(stderrText()).toContain("network security-group ports group-web로 다시 확인하세요.");
    expectResult("succeeded");
  });

  it("remove는 연결돼 있으면 해제를 요청한다", async () => {
    listPorts.mockResolvedValueOnce(attached).mockResolvedValueOnce(detached);
    await run("security-group", "remove", "server-1", "web", "--yes");
    expect(removeGroup).toHaveBeenCalledWith("server-1", "web");
    expectResult("succeeded", "instance-security-group-remove");
    expect(stderrText()).toBe("");
  });

  it("remove는 연결돼 있지 않으면 요청하지 않고 입력 오류로 끝낸다", async () => {
    listPorts.mockResolvedValue(detached);
    await expect(run("security-group", "remove", "server-1", "web", "--yes")).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR, message: "인스턴스 server-1에 보안그룹 web이 연결되어 있지 않습니다.",
    });
    expect(removeGroup).not.toHaveBeenCalled();
    expect(output).not.toHaveBeenCalled();
  });

  it("서버 액션이 API 오류로 실패하면 그대로 전파한다", async () => {
    listPorts.mockResolvedValue(detached);
    addGroup.mockRejectedValue(new NhnCloudCliError("API 호출 실패 (409): Request failed with status code 409 Conflict", EXIT_API_ERROR));
    await expect(run("security-group", "add", "server-1", "web", "--yes")).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR, message: "API 호출 실패 (409): Request failed with status code 409 Conflict",
    });
    expect(output).not.toHaveBeenCalled();
  });

  it("공백뿐인 인스턴스 ID는 client를 해석하기 전에 거부한다", async () => {
    await expect(run("security-group", "add", " ", "web", "--yes")).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR, message: "인스턴스 이름 또는 UUID가 필요합니다.",
    });
    expect(resolveSecurityGroupClients).not.toHaveBeenCalled();
  });
});
