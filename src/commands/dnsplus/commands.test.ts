import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { DnsplusClient } from "../../services/dnsplus/client.js";
import type { DnsplusRecordset, DnsplusZone } from "../../services/dnsplus/types.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { configureCommanderExitCodes } from "../commander-errors.js";
import { resolveDnsplusClient } from "./helpers.js";
import { recordsetCommand } from "./recordset.js";
import { zoneCommand } from "./zone.js";

vi.mock("./helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./helpers.js")>();
  return { ...actual, resolveDnsplusClient: vi.fn() };
});
vi.mock("../../utils/spinner.js", () => ({ startSpinner: vi.fn(), stopSpinner: vi.fn() }));

const ZONE_ID = "11111111-2222-3333-4444-555555555555";
const RS_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const zone: DnsplusZone = {
  engineId: "engine-1",
  zoneId: ZONE_ID,
  zoneName: "example.com.",
  zoneStatus: "USE",
  description: "테스트",
  recordsetCount: 2,
};
const existing: DnsplusRecordset = {
  recordsetId: RS_ID,
  recordsetName: "www.example.com.",
  recordsetType: "A",
  recordsetTtl: 300,
  recordList: [{ recordDisabled: false, recordContent: "192.0.2.10" }],
};

const client = new DnsplusClient("test-appkey");
const listZones = vi.spyOn(client, "listZones");
const listRecordsets = vi.spyOn(client, "listRecordsets");
const createRecordset = vi.spyOn(client, "createRecordset");
const deleteRecordsets = vi.spyOn(client, "deleteRecordsets");

function program(): Command {
  const root = new Command("nhncloud")
    .exitOverride()
    .option("--json")
    .option("--quiet")
    .addCommand(zoneCommand)
    .addCommand(recordsetCommand);
  configureCommanderExitCodes(root);
  return root;
}

async function run(...args: string[]): Promise<void> {
  await program().parseAsync(["node", "nhncloud", ...args]);
}

describe("dnsplus 명령", () => {
  let stdoutWrite: MockInstance<typeof process.stdout.write>;
  const stdout = (): string => stdoutWrite.mock.calls.map((call) => String(call[0])).join("");

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.mocked(resolveDnsplusClient).mockResolvedValue(client);
    listZones.mockResolvedValue([zone]);
    listRecordsets.mockResolvedValue([existing]);
    createRecordset.mockResolvedValue({ ...existing, recordsetId: "new-id", recordsetName: "api.example.com." });
    deleteRecordsets.mockResolvedValue(undefined);
  });
  afterEach(() => stdoutWrite.mockRestore());

  describe("zone", () => {
    it("zone list 는 이름 검색을 API 에 넘긴다", async () => {
      await run("zone", "list", "--name", "example", "--json");

      expect(listZones).toHaveBeenCalledWith({ searchZoneName: "example" });
      expect(JSON.parse(stdout())).toEqual([zone]);
    });

    it("zone get 은 이름을 FQDN 으로 맞춰 정확히 같은 존만 고른다", async () => {
      listZones.mockResolvedValue([{ ...zone, zoneName: "sub.example.com.", zoneId: "z2" }, zone]);

      await run("zone", "get", "Example.com", "--json");

      expect(listZones).toHaveBeenCalledWith({ searchZoneName: "example.com." });
      expect(JSON.parse(stdout()).zoneId).toBe(ZONE_ID);
    });

    it("zone get 은 UUID 를 ID 필터로 조회한다", async () => {
      await run("zone", "get", ZONE_ID, "--quiet");

      expect(listZones).toHaveBeenCalledWith({ zoneIdList: [ZONE_ID] });
      expect(stdout().trim()).toBe(ZONE_ID);
    });

    it("없는 존은 입력 오류다", async () => {
      listZones.mockResolvedValue([]);

      await expect(run("zone", "get", "none.example.")).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    });
  });

  describe("recordset 조회", () => {
    it("list 는 존을 해석한 뒤 타입 필터를 넘긴다", async () => {
      await run("recordset", "list", "--zone", "example.com", "--type", "a", "--json");

      expect(listRecordsets).toHaveBeenCalledWith(ZONE_ID, { recordsetTypeList: ["A"] });
      expect(JSON.parse(stdout())).toEqual([existing]);
    });

    it("get 은 이름이 정확히 같은 레코드 세트를 돌려준다", async () => {
      listRecordsets.mockResolvedValue([existing, { ...existing, recordsetName: "www.example.com.x.", recordsetId: "x" }]);

      await run("recordset", "get", "WWW.example.com", "--zone", "example.com", "--json");

      expect(JSON.parse(stdout()).recordsetId).toBe(RS_ID);
    });

    it("get 은 이름이 같은 타입이 여럿이면 --type 을 요구한다", async () => {
      listRecordsets.mockResolvedValue([existing, { ...existing, recordsetType: "TXT", recordsetId: "t1" }]);

      await expect(run("recordset", "get", "www.example.com", "--zone", "example.com")).rejects.toThrow("--type");
      await run("recordset", "get", "www.example.com", "--zone", "example.com", "--type", "TXT", "--quiet");
      expect(stdout().trim()).toBe("t1");
    });

    it("--zone 이 없으면 입력 오류 종료 코드다", async () => {
      await expect(run("recordset", "list")).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    });
  });

  describe("recordset create", () => {
    const base = ["recordset", "create", "--zone", "example.com", "--name", "api.example.com", "--type", "A", "--value", "192.0.2.20"];

    it("--yes 도 --dry-run 도 없으면 API 호출 전에 입력 오류다", async () => {
      await expect(run(...base)).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
      expect(resolveDnsplusClient).not.toHaveBeenCalled();
    });

    it("--dry-run 은 조회만 하고 보낼 요청을 출력한다(앱키는 가린다)", async () => {
      listRecordsets.mockResolvedValue([]);

      await run(...base, "--dry-run", "--json");

      expect(createRecordset).not.toHaveBeenCalled();
      const out = JSON.parse(stdout());
      expect(out.dry_run).toBe(true);
      expect(out.requests[0]).toEqual({
        method: "POST",
        path: `/dnsplus/v1.0/appkeys/<appkey>/zones/${ZONE_ID}/recordsets`,
        body: {
          recordset: {
            recordsetName: "api.example.com.",
            recordsetType: "A",
            recordsetTtl: 300,
            recordList: [{ recordDisabled: false, recordContent: "192.0.2.20" }],
          },
        },
      });
    });

    it("--yes 는 정규화한 FQDN 과 TTL 로 만든다", async () => {
      listRecordsets.mockResolvedValue([]);

      await run(...base, "--ttl", "60", "--yes", "--json");

      expect(createRecordset).toHaveBeenCalledWith(ZONE_ID, {
        recordsetName: "api.example.com.",
        recordsetType: "A",
        recordsetTtl: 60,
        recordList: [{ recordDisabled: false, recordContent: "192.0.2.20" }],
      });
      expect(JSON.parse(stdout()).recordsetId).toBe("new-id");
    });

    it("같은 이름이 있으면(타입이 달라도) 덮지 않고 멈춘다", async () => {
      listRecordsets.mockResolvedValue([{ ...existing, recordsetName: "api.example.com.", recordsetType: "TXT" }]);

      await expect(run(...base, "--yes")).rejects.toMatchObject({
        exitCode: EXIT_PARAM_ERROR,
        message: expect.stringContaining("이미 있어"),
      });
      expect(createRecordset).not.toHaveBeenCalled();
    });

    it("TTL 범위를 벗어나거나 존 밖의 이름이면 API 호출 전에 입력 오류다", async () => {
      await expect(run(...base, "--ttl", "5", "--yes")).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
      expect(resolveDnsplusClient).not.toHaveBeenCalled();

      listRecordsets.mockResolvedValue([]);
      await expect(
        run("recordset", "create", "--zone", "example.com", "--name", "a.other.com", "--type", "A", "--value", "192.0.2.1", "--yes"),
      ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
      expect(createRecordset).not.toHaveBeenCalled();
    });
  });

  describe("recordset delete", () => {
    it("--yes 도 --dry-run 도 없으면 입력 오류다", async () => {
      await expect(run("recordset", "delete", RS_ID, "--zone", "example.com")).rejects.toMatchObject({
        exitCode: EXIT_PARAM_ERROR,
      });
      expect(resolveDnsplusClient).not.toHaveBeenCalled();
    });

    it("--dry-run 은 지울 요청만 출력한다", async () => {
      await run("recordset", "delete", RS_ID, "--zone", "example.com", "--dry-run", "--json");

      expect(deleteRecordsets).not.toHaveBeenCalled();
      expect(JSON.parse(stdout()).requests[0].method).toBe("DELETE");
    });

    it("--yes 는 찾은 레코드 세트 하나만 지운다", async () => {
      await run("recordset", "delete", "www.example.com", "--zone", "example.com", "--yes", "--json");

      expect(deleteRecordsets).toHaveBeenCalledWith(ZONE_ID, [RS_ID]);
      expect(JSON.parse(stdout())).toMatchObject({ status: "succeeded", recordsetId: RS_ID });
    });

    it("ID 로 지정할 때 --type 이 레코드 세트의 타입과 다르면 지우지 않는다", async () => {
      await expect(
        run("recordset", "delete", RS_ID, "--zone", "example.com", "--type", "TXT", "--yes"),
      ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR, message: expect.stringContaining("--type TXT") });
      expect(deleteRecordsets).not.toHaveBeenCalled();

      await run("recordset", "delete", RS_ID, "--zone", "example.com", "--type", "A", "--yes", "--quiet");
      expect(deleteRecordsets).toHaveBeenCalledWith(ZONE_ID, [RS_ID]);
    });

    it("SOA 는 지우지 않는다", async () => {
      listRecordsets.mockResolvedValue([{ ...existing, recordsetType: "SOA" }]);

      await expect(
        run("recordset", "delete", "www.example.com", "--zone", "example.com", "--yes"),
      ).rejects.toThrow("SOA");
      expect(deleteRecordsets).not.toHaveBeenCalled();
    });
  });
});
