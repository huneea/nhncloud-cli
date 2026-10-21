import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { output } from "../../formatters/table.js";
import { LoadBalancerClient } from "../../services/loadbalancer/client.js";
import type {
  IpAclGroup,
  IpAclTarget,
  LoadBalancer,
} from "../../services/loadbalancer/types.js";
import { EXIT_API_ERROR } from "../../utils/exit-codes.js";
import { startSpinner } from "../../utils/spinner.js";
import {
  resolveIpAclGroupId,
  resolveLoadBalancerClient,
} from "./helpers.js";
import { configureGlobalOptionsHelp } from "../help.js";
import { targetCommand } from "./target.js";

vi.mock("./helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./helpers.js")>();
  return {
    ...actual,
    resolveIpAclGroupId: vi.fn(),
    resolveLoadBalancerClient: vi.fn(),
  };
});

vi.mock("../../formatters/table.js", () => ({ output: vi.fn() }));
vi.mock("../../utils/spinner.js", () => ({
  startSpinner: vi.fn(),
  stopSpinner: vi.fn(),
}));

const target: IpAclTarget = {
  id: "target-1",
  cidr_address: "10.0.0.0/24",
  description: "internal",
  ipacl_group_id: "group-1",
};

const group: IpAclGroup = {
  id: "group-1",
  name: "office",
  action: "ALLOW",
  ipacl_target_count: "1",
  loadbalancers: [
    { loadbalancer_id: "lb-b" },
    { loadbalancer_id: "lb-a" },
  ],
};

function loadBalancer(id: string, groupIds = ["group-1"]): LoadBalancer {
  return {
    id,
    name: id,
    vip_address: "192.0.2.10",
    provisioning_status: "ACTIVE",
    operating_status: "ONLINE",
    ipacl_group_action: "ALLOW",
    ipacl_groups: groupIds.map((ipacl_group_id) => ({ ipacl_group_id })),
  };
}

const client = new LoadBalancerClient("token-id", "https://example.com/v2.0");
const getGroupMock = vi.spyOn(client, "getIpAclGroup");
const getTargetMock = vi.spyOn(client, "getIpAclTarget");
const getLoadBalancerMock = vi.spyOn(client, "getLoadBalancer");
const listTargetsMock = vi.spyOn(client, "listIpAclTargets");
const updateTargetMock = vi.spyOn(client, "updateIpAclTarget");
const createTargetMock = vi.spyOn(client, "createIpAclTarget");
const deleteTargetMock = vi.spyOn(client, "deleteIpAclTarget");
const bindGroupsMock = vi.spyOn(client, "bindIpAclGroups");

function programWithTarget(): Command {
  const root = new Command("nhncloud")
    .exitOverride()
    .option("--json")
    .option("--quiet");
  const loadbalancer = new Command("loadbalancer");
  const ipacl = new Command("ipacl");
  ipacl.addCommand(targetCommand);
  loadbalancer.addCommand(ipacl);
  root.addCommand(loadbalancer);
  return root;
}

describe("loadbalancer IP ACL 대상 쓰기 명령", () => {
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.mocked(resolveLoadBalancerClient).mockResolvedValue({
      client,
      profileName: "default",
    });
    vi.mocked(resolveIpAclGroupId).mockResolvedValue("group-1");
    getGroupMock.mockResolvedValue(group);
    getTargetMock.mockResolvedValue(target);
    getLoadBalancerMock.mockImplementation(async (id) => loadBalancer(id));
    listTargetsMock.mockResolvedValue([]);
    updateTargetMock.mockResolvedValue({ ...target, description: "updated" });
    createTargetMock.mockResolvedValue(target);
    deleteTargetMock.mockResolvedValue();
    bindGroupsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    stderr.mockRestore();
    process.exitCode = undefined;
  });

  it("--yes와 CIDR을 credential·spinner·client보다 먼저 검증한다", async () => {
    await expect(
      programWithTarget().parseAsync([
        "node",
        "nhncloud",
        "loadbalancer",
        "ipacl",
        "target",
        "add",
        "office",
        "--cidr",
        "10.0.0.0/24",
      ]),
    ).rejects.toThrow("--yes");

    await expect(
      programWithTarget().parseAsync([
        "node",
        "nhncloud",
        "loadbalancer",
        "ipacl",
        "target",
        "add",
        "office",
        "--cidr",
        "10.0.0.0/99",
        "--yes",
      ]),
    ).rejects.toThrow("prefix");

    expect(resolveLoadBalancerClient).not.toHaveBeenCalled();
    expect(resolveIpAclGroupId).not.toHaveBeenCalled();
    expect(startSpinner).not.toHaveBeenCalled();
    expect(createTargetMock).not.toHaveBeenCalled();
  });

  it("remove의 --yes와 빈 target ID도 credential 전에 거부한다", async () => {
    await expect(
      programWithTarget().parseAsync([
        "node",
        "nhncloud",
        "loadbalancer",
        "ipacl",
        "target",
        "remove",
        "target-1",
      ]),
    ).rejects.toThrow("--yes");
    await expect(
      programWithTarget().parseAsync([
        "node",
        "nhncloud",
        "loadbalancer",
        "ipacl",
        "target",
        "remove",
        " ",
        "--yes",
      ]),
    ).rejects.toThrow("이름 또는 UUID");

    expect(resolveLoadBalancerClient).not.toHaveBeenCalled();
    expect(startSpinner).not.toHaveBeenCalled();
    expect(getTargetMock).not.toHaveBeenCalled();
    expect(deleteTargetMock).not.toHaveBeenCalled();
  });

  it("모든 snapshot을 완료한 뒤 대상을 한 번 추가하고 순차 재바인딩한다", async () => {
    await programWithTarget().parseAsync([
      "node",
      "nhncloud",
      "--json",
      "loadbalancer",
      "ipacl",
      "target",
      "add",
      "office",
      "--cidr",
      "10.0.0.0/24",
      "--description",
      " internal ",
      "--yes",
    ]);

    expect(getLoadBalancerMock.mock.calls.map(([id]) => id)).toEqual(["lb-a", "lb-b"]);
    expect(createTargetMock).toHaveBeenCalledTimes(1);
    expect(createTargetMock).toHaveBeenCalledWith({
      ipacl_group_id: "group-1",
      cidr_address: "10.0.0.0/24",
      description: "internal",
    });
    const lastSnapshotOrder = Math.max(
      ...getLoadBalancerMock.mock.invocationCallOrder,
    );
    expect(lastSnapshotOrder).toBeLessThan(
      createTargetMock.mock.invocationCallOrder[0] ?? 0,
    );
    expect(createTargetMock.mock.invocationCallOrder[0]).toBeLessThan(
      bindGroupsMock.mock.invocationCallOrder[0] ?? 0,
    );
    expect(bindGroupsMock.mock.calls.map(([id]) => id)).toEqual(["lb-a", "lb-b"]);
    expect(output).toHaveBeenCalledWith(
      expect.objectContaining({ json: true }),
      expect.objectContaining({
        raw: expect.objectContaining({
          operation: "ipacl-target-add",
          status: "succeeded",
          target: { id: "target-1", ipacl_group_id: "group-1" },
        }),
        ids: ["target-1"],
      }),
    );
  });

  it("snapshot이 실패하면 대상을 변경하지 않는다", async () => {
    getLoadBalancerMock.mockRejectedValueOnce(new Error("snapshot failed"));

    await expect(
      programWithTarget().parseAsync([
        "node",
        "nhncloud",
        "loadbalancer",
        "ipacl",
        "target",
        "add",
        "office",
        "--cidr",
        "10.0.0.1",
        "--yes",
      ]),
    ).rejects.toThrow("snapshot failed");

    expect(createTargetMock).not.toHaveBeenCalled();
    expect(bindGroupsMock).not.toHaveBeenCalled();
  });

  it("remove는 target ID로 소속 그룹을 조회한 뒤 삭제한다", async () => {
    await programWithTarget().parseAsync([
      "node",
      "nhncloud",
      "loadbalancer",
      "ipacl",
      "target",
      "remove",
      "target-1",
      "--yes",
    ]);

    expect(getTargetMock).toHaveBeenCalledWith("target-1");
    expect(resolveIpAclGroupId).not.toHaveBeenCalled();
    expect(getGroupMock).toHaveBeenCalledWith("group-1");
    expect(deleteTargetMock).toHaveBeenCalledTimes(1);
    expect(deleteTargetMock).toHaveBeenCalledWith("target-1");
    expect(Math.max(...getLoadBalancerMock.mock.invocationCallOrder)).toBeLessThan(
      deleteTargetMock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("재바인딩 부분 실패 결과를 먼저 출력하고 후속 대상을 계속 처리한다", async () => {
    bindGroupsMock.mockImplementation(async (id) => {
      if (id === "lb-a") throw new Error("bad\n\u001b[31m");
      return [];
    });

    await programWithTarget().parseAsync([
      "node",
      "nhncloud",
      "--json",
      "loadbalancer",
      "ipacl",
      "target",
      "remove",
      "target-1",
      "--yes",
    ]);

    expect(deleteTargetMock).toHaveBeenCalledTimes(1);
    expect(bindGroupsMock.mock.calls.map(([id]) => id)).toEqual(["lb-a", "lb-b"]);
    expect(output).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        raw: {
          operation: "ipacl-target-remove",
          status: "partial",
          target: { id: "target-1", ipacl_group_id: "group-1" },
          rebind: expect.objectContaining({
            skipped: false,
            failed: [
              expect.objectContaining({
                loadbalancer_id: "lb-a",
                retry_argv: [
                  "nhncloud",
                  "loadbalancer",
                  "set-ipacl",
                  "lb-a",
                  "--group",
                  "group-1",
                  "--yes",
                  "--json",
                ],
              }),
            ],
          }),
        },
      }),
    );
    expect(vi.mocked(output).mock.invocationCallOrder[0]).toBeLessThan(
      stderr.mock.invocationCallOrder[0] ?? 0,
    );
    expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining("\n\u001b"));
    expect(stderr.mock.calls.flat().join("")).toContain("bad??[31m");
    expect(process.exitCode).toBe(EXIT_API_ERROR);
  });

  it("--no-rebind는 재바인딩을 생략하고 quiet target ID 계약을 유지한다", async () => {
    await programWithTarget().parseAsync([
      "node",
      "nhncloud",
      "--quiet",
      "loadbalancer",
      "ipacl",
      "target",
      "add",
      "office",
      "--cidr",
      "10.0.0.8",
      "--no-rebind",
      "--yes",
    ]);

    expect(getLoadBalancerMock).not.toHaveBeenCalled();
    expect(bindGroupsMock).not.toHaveBeenCalled();
    expect(output).toHaveBeenCalledWith(
      expect.objectContaining({ quiet: true }),
      expect.objectContaining({
        raw: expect.objectContaining({
          rebind: { skipped: true, succeeded: [], failed: [] },
        }),
        ids: ["target-1"],
      }),
    );
    const warning = stderr.mock.calls.flat().join("");
    expect(warning).toContain("--no-rebind");
    expect(warning).toContain("private CIDR");
    expect(process.exitCode).toBeUndefined();
  });

  function addArgs(...extra: string[]): string[] {
    return ["node", "nhncloud", "--json", "loadbalancer", "ipacl", "target", "add", "office", ...extra];
  }

  it("--cidr를 여러 번 주면 모두 만들고 재바인딩은 한 번만 한다", async () => {
    createTargetMock
      .mockResolvedValueOnce({ ...target, id: "t-1", cidr_address: "203.0.113.5" })
      .mockResolvedValueOnce({ ...target, id: "t-2", cidr_address: "203.0.113.0/24" });

    await programWithTarget().parseAsync(
      addArgs("--cidr", "203.0.113.5", "--cidr", "203.0.113.0/24", "--yes"),
    );

    expect(createTargetMock.mock.calls.map(([input]) => input.cidr_address)).toEqual([
      "203.0.113.5",
      "203.0.113.0/24",
    ]);
    expect(bindGroupsMock.mock.calls.map(([id]) => id)).toEqual(["lb-a", "lb-b"]);
    expect(output).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        raw: expect.objectContaining({
          status: "succeeded",
          target: { id: "t-1", ipacl_group_id: "group-1" },
          targets: [
            expect.objectContaining({ id: "t-1", cidr_address: "203.0.113.5" }),
            expect.objectContaining({ id: "t-2", cidr_address: "203.0.113.0/24" }),
          ],
          skipped_duplicates: [],
        }),
        ids: ["t-1", "t-2"],
      }),
    );
  });

  it("이미 있는 CIDR과 입력 안의 반복은 더하지 않고 알린다", async () => {
    listTargetsMock.mockResolvedValue([
      { ...target, id: "exist-1", cidr_address: "203.0.113.5/32" },
    ]);
    createTargetMock.mockResolvedValue({ ...target, id: "t-new", cidr_address: "203.0.113.9" });

    await programWithTarget().parseAsync(
      addArgs("--cidr", "203.0.113.5", "--cidr", "203.0.113.9", "--cidr", "203.0.113.9", "--yes"),
    );

    expect(createTargetMock).toHaveBeenCalledTimes(1);
    expect(createTargetMock).toHaveBeenCalledWith(
      expect.objectContaining({ cidr_address: "203.0.113.9" }),
    );
    expect(output).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        raw: expect.objectContaining({
          skipped_duplicates: [
            { cidr_address: "203.0.113.5", target_id: "exist-1" },
            { cidr_address: "203.0.113.9", target_id: null },
          ],
        }),
      }),
    );
    const notice = stderr.mock.calls.flat().join("");
    expect(notice).toContain("203.0.113.5 는 이미 그룹에 있어");
    expect(notice).toContain("203.0.113.9 는 입력에 중복되어");
  });

  it("모두 중복이면 만들지도 재바인딩하지도 않고 unchanged로 끝낸다", async () => {
    listTargetsMock.mockResolvedValue([
      { ...target, id: "exist-1", cidr_address: "203.0.113.5/32" },
    ]);

    await programWithTarget().parseAsync(addArgs("--cidr", "203.0.113.5/32", "--yes"));

    expect(createTargetMock).not.toHaveBeenCalled();
    expect(getLoadBalancerMock).not.toHaveBeenCalled();
    expect(bindGroupsMock).not.toHaveBeenCalled();
    expect(output).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        raw: expect.objectContaining({
          status: "unchanged",
          target: { id: "exist-1", ipacl_group_id: "group-1" },
          targets: [],
          rebind: { skipped: false, succeeded: [], failed: [] },
        }),
        ids: ["exist-1"],
      }),
    );
    expect(process.exitCode).toBeUndefined();
  });

  it("--dry-run은 --yes 없이도 쓰지 않고 계획만 출력한다", async () => {
    listTargetsMock.mockResolvedValue([
      { ...target, id: "exist-1", cidr_address: "203.0.113.5/32" },
    ]);

    await programWithTarget().parseAsync(
      addArgs("--cidr", "203.0.113.5", "--cidr", "203.0.113.9", "--description", "office-vpn", "--dry-run"),
    );

    expect(createTargetMock).not.toHaveBeenCalled();
    expect(getLoadBalancerMock).not.toHaveBeenCalled();
    expect(bindGroupsMock).not.toHaveBeenCalled();
    expect(output).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        raw: {
          operation: "ipacl-target-add",
          dry_run: true,
          ipacl_group_id: "group-1",
          would_create: [{ cidr_address: "203.0.113.9", description: "office-vpn" }],
          skipped_duplicates: [{ cidr_address: "203.0.113.5", target_id: "exist-1" }],
          loadbalancers_to_rebind: ["lb-a", "lb-b"],
        },
        ids: [],
      }),
    );
  });

  it("여러 대상을 만드는 중 실패하면 만든 대상으로 재바인딩하고 partial로 끝낸다", async () => {
    createTargetMock
      .mockResolvedValueOnce({ ...target, id: "t-1", cidr_address: "203.0.113.5" })
      .mockRejectedValueOnce(new Error("create failed"));

    await programWithTarget().parseAsync(
      addArgs("--cidr", "203.0.113.5", "--cidr", "203.0.113.9", "--cidr", "203.0.113.10", "--yes"),
    );

    expect(createTargetMock).toHaveBeenCalledTimes(2);
    expect(bindGroupsMock.mock.calls.map(([id]) => id)).toEqual(["lb-a", "lb-b"]);
    expect(output).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        raw: expect.objectContaining({
          status: "partial",
          targets: [expect.objectContaining({ id: "t-1" })],
          failed_creates: [{ cidr_address: "203.0.113.9", error: "create failed" }],
          not_attempted: ["203.0.113.10"],
        }),
        ids: ["t-1"],
      }),
    );
    expect(stderr.mock.calls.flat().join("")).toContain("같은 명령을 다시 실행하면 이미 만든 대상은 건너뜁니다");
    expect(process.exitCode).toBe(EXIT_API_ERROR);
  });

  it("첫 대상부터 만들지 못하면 재바인딩 없이 오류를 던진다", async () => {
    createTargetMock.mockRejectedValueOnce(new Error("create failed"));

    await expect(
      programWithTarget().parseAsync(addArgs("--cidr", "203.0.113.5", "--cidr", "203.0.113.9", "--yes")),
    ).rejects.toThrow("create failed");

    expect(bindGroupsMock).not.toHaveBeenCalled();
  });

  it("서버 필터가 놓친 다른 그룹의 대상은 중복으로 보지 않는다", async () => {
    listTargetsMock.mockResolvedValue([
      { ...target, id: "other-1", cidr_address: "203.0.113.5/32", ipacl_group_id: "group-2" },
    ]);
    createTargetMock.mockResolvedValue({ ...target, id: "t-1", cidr_address: "203.0.113.5" });

    await programWithTarget().parseAsync(addArgs("--cidr", "203.0.113.5", "--yes"));

    expect(createTargetMock).toHaveBeenCalledTimes(1);
  });

  it("--dry-run은 만들 대상이 없으면 재바인딩할 LB도 비운다", async () => {
    listTargetsMock.mockResolvedValue([
      { ...target, id: "exist-1", cidr_address: "203.0.113.5/32" },
    ]);

    await programWithTarget().parseAsync(addArgs("--cidr", "203.0.113.5", "--dry-run"));

    expect(output).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        raw: expect.objectContaining({ loadbalancers_to_rebind: [] }),
      }),
    );
  });

  it("모두 중복이어도 --no-rebind를 쓴 경우에만 rebind.skipped가 true다", async () => {
    listTargetsMock.mockResolvedValue([
      { ...target, id: "exist-1", cidr_address: "203.0.113.5/32" },
    ]);

    await programWithTarget().parseAsync(addArgs("--cidr", "203.0.113.5", "--no-rebind", "--yes"));

    expect(output).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        raw: expect.objectContaining({ rebind: { skipped: true, succeeded: [], failed: [] } }),
      }),
    );
  });

  it("update는 설명만 바꾸고 재바인딩하지 않으며 --yes도 요구하지 않는다", async () => {
    await programWithTarget().parseAsync([
      "node", "nhncloud", "--json", "loadbalancer", "ipacl", "target", "update",
      "target-1", "--description", " updated ",
    ]);

    expect(updateTargetMock).toHaveBeenCalledWith("target-1", { description: "updated" });
    expect(bindGroupsMock).not.toHaveBeenCalled();
    expect(output).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        raw: {
          operation: "ipacl-target-update",
          status: "succeeded",
          target: {
            id: "target-1",
            cidr_address: "10.0.0.0/24",
            description: "updated",
            ipacl_group_id: "group-1",
          },
        },
        ids: ["target-1"],
      }),
    );
  });

  it("update는 빈 target ID를 credential 전에 거부한다", async () => {
    await expect(
      programWithTarget().parseAsync([
        "node", "nhncloud", "loadbalancer", "ipacl", "target", "update", " ",
        "--description", "x",
      ]),
    ).rejects.toThrow("이름 또는 UUID");
    expect(resolveLoadBalancerClient).not.toHaveBeenCalled();
    expect(updateTargetMock).not.toHaveBeenCalled();
  });

  it("delete 별칭은 remove와 같이 --yes를 요구하고 대상을 삭제한다", async () => {
    await expect(
      programWithTarget().parseAsync([
        "node", "nhncloud", "loadbalancer", "ipacl", "target", "delete", "target-1",
      ]),
    ).rejects.toThrow("--yes");

    await programWithTarget().parseAsync([
      "node", "nhncloud", "loadbalancer", "ipacl", "target", "delete", "target-1", "--yes",
    ]);
    expect(deleteTargetMock).toHaveBeenCalledWith("target-1");
  });

  it("add/remove leaf help가 전역·지역·쓰기 안전 옵션을 노출한다", () => {
    const root = new Command("nhncloud").option("--json").option("--quiet");
    const loadbalancer = new Command("loadbalancer");
    const ipacl = new Command("ipacl");
    ipacl.addCommand(targetCommand);
    loadbalancer.addCommand(ipacl);
    root.addCommand(loadbalancer);
    configureGlobalOptionsHelp(loadbalancer);

    const cases: Array<[string, string[]]> = [
      [
        "add",
        [
          "--json",
          "--quiet",
          "--region",
          "--profile",
          "--cidr",
          "--description",
          "--yes",
          "--no-rebind",
          "--dry-run",
        ],
      ],
      ["update", ["--json", "--quiet", "--region", "--profile", "--description"]],
      [
        "remove",
        ["--json", "--quiet", "--region", "--profile", "--yes", "--no-rebind"],
      ],
    ];
    for (const [name, flags] of cases) {
      const command = targetCommand.commands.find(
        (candidate) => candidate.name() === name,
      );
      if (!command) throw new Error(`명령을 찾을 수 없습니다: ${name}`);
      const help = command.helpInformation();
      for (const flag of flags) expect(help, name).toContain(flag);
    }
  });
});
