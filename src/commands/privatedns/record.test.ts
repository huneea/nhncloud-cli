import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { output } from "../../formatters/table.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { resolvePrivateDnsClients } from "./helpers.js";
import { recordCommand } from "./record.js";

vi.mock("./helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./helpers.js")>();
  return { ...actual, resolvePrivateDnsClients: vi.fn() };
});
vi.mock("../../formatters/table.js", () => ({ output: vi.fn() }));
vi.mock("../../utils/spinner.js", () => ({ startSpinner: vi.fn(), stopSpinner: vi.fn() }));

const zone = {
  id: "zone-1",
  name: "example.net.",
  description: null,
  status: "ACTIVE",
  networks: [],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};
const www = {
  id: "r-www",
  name: "www.example.net.",
  type: "A",
  ttl: 300,
  description: "웹",
  zone_id: "zone-1",
  records: [{ content: "10.0.0.1" }, { content: "10.0.0.2" }],
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};
const apexNs = { ...www, id: "r-ns", name: "example.net.", type: "NS", description: null };

const dns = {
  listZones: vi.fn(),
  listRecordSets: vi.fn(),
  createRecordSet: vi.fn(),
  updateRecordSet: vi.fn(),
  deleteRecordSet: vi.fn(),
};

async function run(args: string[]): Promise<void> {
  const program = new Command("nhncloud").exitOverride().option("--json").option("--quiet");
  program.addCommand(recordCommand);
  await program.parseAsync(["node", "nhncloud", "record", ...args]);
}

function lastCall() {
  const call = vi.mocked(output).mock.calls.at(-1);
  if (!call) throw new Error("output 이 호출되지 않았습니다");
  return call[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolvePrivateDnsClients).mockResolvedValue({ dns, profileName: "default" } as never);
  dns.listZones.mockResolvedValue([zone]);
  dns.listRecordSets.mockResolvedValue([www, apexNs]);
  dns.createRecordSet.mockResolvedValue(www);
  dns.updateRecordSet.mockResolvedValue(www);
  dns.deleteRecordSet.mockResolvedValue(undefined);
});

describe("privatedns record", () => {
  it("list 는 records 를 쉼표로 이어 rows 에 넣는다", async () => {
    await run(["list", "example.net"]);
    expect(lastCall().rows[0]).toEqual(["r-www", "www.example.net.", "A", "300", "10.0.0.1, 10.0.0.2", "웹"]);
  });

  it("create --dry-run 은 FQDN 본문을 출력하고 ttl 키를 빼며 쓰지 않는다", async () => {
    dns.listRecordSets.mockResolvedValue([]);
    await run([
      "create", "example.net", "--name", "www", "--type", "a",
      "--record", "10.0.0.1", "--record", "10.0.0.2", "--dry-run",
    ]);
    expect(dns.createRecordSet).not.toHaveBeenCalled();
    const body = (lastCall().raw as { requests: { body: unknown }[] }).requests[0].body;
    expect(body).toEqual({
      rrset: {
        name: "www.example.net.",
        type: "A",
        records: [{ content: "10.0.0.1" }, { content: "10.0.0.2" }],
        description: "",
      },
    });
    expect(body).not.toHaveProperty("rrset.ttl");
  });

  it("create 는 같은 이름과 타입이 있으면 요청하지 않고 기존 UUID 를 알린다", async () => {
    await expect(
      run(["create", "example.net", "--name", "www", "--type", "A", "--record", "10.0.0.9", "--yes"]),
    ).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR,
      message: expect.stringMatching(/r-www.*record update/),
    });
    expect(dns.createRecordSet).not.toHaveBeenCalled();
  });

  it("create --type SOA 는 자격증명 해석 전에 거부한다", async () => {
    await expect(
      run(["create", "example.net", "--name", "@", "--type", "SOA", "--record", "x", "--yes"]),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(resolvePrivateDnsClients).not.toHaveBeenCalled();
  });

  it("create 는 빈 --record 를 거부한다", async () => {
    await expect(
      run(["create", "example.net", "--name", "x", "--type", "A", "--record", "  ", "--yes"]),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(resolvePrivateDnsClients).not.toHaveBeenCalled();
  });

  it("update 응답의 updated_at 이 null 이면 빈 문자열로 출력한다", async () => {
    dns.updateRecordSet.mockResolvedValue({ ...www, updated_at: null });
    await run(["update", "example.net", "www", "--ttl", "600", "--yes"]);
    expect(lastCall().rows).toContainEqual(["updated_at", ""]);
  });

  it("update --ttl 은 현재 records 와 설명을 보존한다", async () => {
    await run(["update", "example.net", "www", "--ttl", "600", "--yes"]);
    expect(dns.updateRecordSet).toHaveBeenCalledWith("zone-1", "r-www", {
      type: "A",
      records: [{ content: "10.0.0.1" }, { content: "10.0.0.2" }],
      ttl: 600,
      description: "웹",
    });
  });

  it("update 에 바꿀 옵션이 없으면 자격증명 해석 전에 거부한다", async () => {
    await expect(run(["update", "example.net", "www", "--yes"])).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR,
    });
    expect(resolvePrivateDnsClients).not.toHaveBeenCalled();
  });

  it("update --description \"\" 는 설명을 비우고 현재 records·ttl 을 유지한다", async () => {
    await run(["update", "example.net", "www", "--description", "", "--yes"]);
    expect(dns.updateRecordSet).toHaveBeenCalledWith("zone-1", "r-www", {
      type: "A",
      records: [{ content: "10.0.0.1" }, { content: "10.0.0.2" }],
      ttl: 300,
      description: "",
    });
  });

  it("delete 는 apex NS 를 지우지 않는다", async () => {
    await expect(run(["delete", "example.net", "@", "--type", "NS", "--yes"])).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR,
    });
    expect(dns.deleteRecordSet).not.toHaveBeenCalled();
  });

  it("delete --yes 는 레코드 세트를 지우고 결과를 출력한다", async () => {
    await run(["delete", "example.net", "www", "--yes"]);
    expect(dns.deleteRecordSet).toHaveBeenCalledWith("zone-1", "r-www");
    expect(lastCall().raw).toEqual({
      operation: "privatedns-record-delete",
      status: "succeeded",
      zone_id: "zone-1",
      rrset_id: "r-www",
    });
  });
});
