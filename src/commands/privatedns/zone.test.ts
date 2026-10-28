import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { output } from "../../formatters/table.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { resolvePrivateDnsClients } from "./helpers.js";
import { zoneCommand } from "./zone.js";

vi.mock("./helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./helpers.js")>();
  return { ...actual, resolvePrivateDnsClients: vi.fn() };
});
vi.mock("../../formatters/table.js", () => ({ output: vi.fn() }));
vi.mock("../../utils/spinner.js", () => ({ startSpinner: vi.fn(), stopSpinner: vi.fn() }));

const zone = {
  id: "zone-1",
  name: "example.net.",
  description: "내부 zone",
  status: "ACTIVE",
  networks: ["vpc-a-id", "vpc-gone-id"],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  rrset_count: 3,
};
const vpcs = [
  { id: "vpc-a-id", name: "vpc-a" },
  { id: "vpc-b-id", name: "vpc-b" },
];
const soa = { id: "r-soa", name: "example.net.", type: "SOA" };
const apexNs = { id: "r-ns", name: "example.net.", type: "NS" };
const userRecord = { id: "r-a", name: "www.example.net.", type: "A" };

const dns = {
  listZones: vi.fn(),
  getZone: vi.fn(),
  createZone: vi.fn(),
  updateZone: vi.fn(),
  deleteZone: vi.fn(),
  listRecordSets: vi.fn(),
};
const network = { listVpcs: vi.fn() };

async function run(args: string[]): Promise<void> {
  const program = new Command("nhncloud").exitOverride().option("--json").option("--quiet");
  program.addCommand(zoneCommand);
  await program.parseAsync(["node", "nhncloud", "zone", ...args]);
}

function lastCall() {
  const call = vi.mocked(output).mock.calls.at(-1);
  if (!call) throw new Error("output 이 호출되지 않았습니다");
  return call[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolvePrivateDnsClients).mockResolvedValue({ dns, network, profileName: "default" } as never);
  dns.listZones.mockResolvedValue([zone]);
  dns.getZone.mockResolvedValue(zone);
  dns.updateZone.mockResolvedValue(zone);
  dns.createZone.mockResolvedValue(zone);
  dns.deleteZone.mockResolvedValue(undefined);
  dns.listRecordSets.mockResolvedValue([soa, apexNs]);
  network.listVpcs.mockResolvedValue(vpcs);
});

describe("privatedns zone", () => {
  it("list 는 레코드 수와 연결 VPC 수를 rows 에 넣는다", async () => {
    await run(["list"]);
    expect(lastCall().rows).toEqual([["zone-1", "example.net.", "ACTIVE", "3", "2", "내부 zone"]]);
    expect(lastCall().ids).toEqual(["zone-1"]);
  });

  it("list --name 은 끝 . 을 붙여 서버에 보낸다", async () => {
    await run(["list", "--name", "example.net"]);
    expect(dns.listZones).toHaveBeenCalledWith({ name: "example.net." });
  });

  it("create --dry-run 은 쓰지 않고 요청 본문을 출력한다", async () => {
    dns.listZones.mockResolvedValue([]);
    await run(["create", "--name", "example.net", "--network", "vpc-a", "--dry-run"]);
    expect(dns.createZone).not.toHaveBeenCalled();
    expect((lastCall().raw as { requests: unknown[] }).requests[0]).toEqual({
      method: "POST",
      path: "/v2.0/privatedns/zones",
      body: { zone: { name: "example.net.", networks: ["vpc-a-id"] } },
    });
  });

  it("create 는 --yes 도 --dry-run 도 없으면 자격증명 해석 전에 거부한다", async () => {
    await expect(run(["create", "--name", "example.net", "--network", "vpc-a"])).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR,
    });
    expect(resolvePrivateDnsClients).not.toHaveBeenCalled();
  });

  it("create 는 같은 이름 zone 이 있으면 요청하지 않고 기존 UUID 를 알린다", async () => {
    await expect(
      run(["create", "--name", "EXAMPLE.net", "--network", "vpc-a", "--yes"]),
    ).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR,
      message: expect.stringMatching(/zone-1.*zone update/),
    });
    expect(dns.createZone).not.toHaveBeenCalled();
  });

  it("create --yes 는 해석한 VPC UUID 로 만든다", async () => {
    dns.listZones.mockResolvedValue([]);
    await run(["create", "--name", "example.net.", "--network", "vpc-a", "--network", "vpc-b", "--yes"]);
    expect(dns.createZone).toHaveBeenCalledWith({ name: "example.net.", networks: ["vpc-a-id", "vpc-b-id"] });
  });

  it("update --description \"\" 는 설명을 비우고 현재 networks 를 유지한다", async () => {
    await run(["update", "example.net", "--description", "", "--yes"]);
    expect(dns.updateZone).toHaveBeenCalledWith("zone-1", { description: "", networks: zone.networks });
  });

  it("update --remove-network 는 현재 연결된 UUID 를 VPC 목록 없이 뺀다", async () => {
    await run(["update", "example.net", "--remove-network", "vpc-gone-id", "--yes"]);
    expect(network.listVpcs).not.toHaveBeenCalled();
    expect(dns.updateZone).toHaveBeenCalledWith("zone-1", { description: "내부 zone", networks: ["vpc-a-id"] });
  });

  it("update --add-network 는 기존 목록 뒤에 붙이고 설명이 없으면 빈 문자열을 보낸다", async () => {
    dns.getZone.mockResolvedValue({ ...zone, description: null });
    await run(["update", "example.net", "--add-network", "vpc-b", "--yes"]);
    expect(dns.updateZone).toHaveBeenCalledWith("zone-1", {
      description: "",
      networks: ["vpc-a-id", "vpc-gone-id", "vpc-b-id"],
    });
  });

  it("update 는 바꿀 옵션이 없거나 --network 와 add/remove 를 섞으면 자격증명 전에 거부한다", async () => {
    await expect(run(["update", "example.net", "--yes"])).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    await expect(
      run(["update", "example.net", "--network", "vpc-a", "--add-network", "vpc-b", "--yes"]),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(resolvePrivateDnsClients).not.toHaveBeenCalled();
  });

  it("delete 는 사용자 레코드가 남으면 --force 없이 거부한다", async () => {
    dns.listRecordSets.mockResolvedValue([soa, apexNs, userRecord]);
    await expect(run(["delete", "example.net", "--yes"])).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(dns.deleteZone).not.toHaveBeenCalled();

    await run(["delete", "example.net", "--force", "--yes"]);
    expect(dns.deleteZone).toHaveBeenCalledWith("zone-1");
  });

  it("delete 는 SOA 와 apex NS 만 있으면 --force 없이 지운다", async () => {
    await run(["delete", "example.net", "--yes"]);
    expect(dns.deleteZone).toHaveBeenCalledWith("zone-1");
    expect(lastCall().raw).toEqual({ operation: "privatedns-zone-delete", status: "succeeded", zone_id: "zone-1" });
  });

  it("delete --dry-run 도 남은 레코드를 검사하고 삭제하지 않는다", async () => {
    dns.listRecordSets.mockResolvedValue([soa, userRecord]);
    await expect(run(["delete", "example.net", "--dry-run"])).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    dns.listRecordSets.mockResolvedValue([soa, apexNs]);
    await run(["delete", "example.net", "--dry-run"]);
    expect(dns.deleteZone).not.toHaveBeenCalled();
  });
});
