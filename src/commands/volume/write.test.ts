import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlockStorageClient } from "../../services/blockstorage/client.js";
import { InstanceClient } from "../../services/instance/client.js";
import type { Volume } from "../../services/blockstorage/types.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { output } from "../../formatters/table.js";
import { attachCommand } from "./attach.js";
import { detachCommand } from "./detach.js";
import { deleteCommand } from "./delete.js";
import * as helpers from "./helpers.js";

vi.mock("../../formatters/table.js", () => ({ output: vi.fn() }));
vi.mock("../../utils/spinner.js", () => ({ startSpinner: vi.fn(), stopSpinner: vi.fn() }));
vi.mock("./helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./helpers.js")>();
  return { ...actual, resolveVolumeWriteClients: vi.fn() };
});

const volumeClient = new BlockStorageClient("token", "https://example.com/v2/tenant");
const instanceClient = new InstanceClient("token", "https://compute.example.com/v2/tenant", "https://image.example.com");
const getMock = vi.spyOn(volumeClient, "get");
const deleteMock = vi.spyOn(volumeClient, "delete");
const waitMock = vi.spyOn(volumeClient, "waitForVolume");
const waitDeletedMock = vi.spyOn(volumeClient, "waitForDeleted");
const attachMock = vi.spyOn(instanceClient, "attachVolume");
const detachMock = vi.spyOn(instanceClient, "detachVolume");

function vol(overrides: Partial<Volume> = {}): Volume {
  return {
    id: "vol-1",
    name: "data",
    size: 300,
    status: "available",
    attachments: [],
    created_at: "2026-10-30T00:00:00Z",
    ...overrides,
  };
}
const attachment = (server: string) => ({ server_id: server, device: "/dev/vdb", volume_id: "vol-1", id: "vol-1" });

async function run(command: Command, args: string[]): Promise<void> {
  const program = new Command("nhncloud").exitOverride().option("--json").option("--quiet");
  program.addCommand(command);
  await program.parseAsync(["node", "nhncloud", command.name(), ...args]);
}

describe("volume write commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(helpers.resolveVolumeWriteClients).mockResolvedValue({ volumeClient, instanceClient });
    attachMock.mockResolvedValue({ id: "vol-1", volumeId: "vol-1", serverId: "srv-1", device: "" });
    detachMock.mockResolvedValue(undefined);
    deleteMock.mockResolvedValue(undefined);
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  describe("attach", () => {
    it("서버에 연결 요청을 보낸다", async () => {
      getMock.mockResolvedValue(vol());
      await run(attachCommand, ["vol-1", "--server", "srv-1"]);
      expect(attachMock).toHaveBeenCalledWith("srv-1", "vol-1");
      expect(waitMock).not.toHaveBeenCalled();
    });

    it("이미 그 서버에 연결돼 있으면 요청하지 않는다", async () => {
      getMock.mockResolvedValue(vol({ status: "in-use", attachments: [attachment("srv-1")] }));
      await run(attachCommand, ["vol-1", "--server", "srv-1"]);
      expect(attachMock).not.toHaveBeenCalled();
      expect(vi.mocked(output).mock.calls[0]?.[1].raw).toMatchObject({ action: "unchanged", applied: false });
    });

    it("다른 서버에 연결된 볼륨은 요청 전에 거절한다", async () => {
      getMock.mockResolvedValue(vol({ status: "in-use", attachments: [attachment("srv-2")] }));
      await expect(run(attachCommand, ["vol-1", "--server", "srv-1"])).rejects.toMatchObject({
        exitCode: EXIT_PARAM_ERROR,
      });
      expect(attachMock).not.toHaveBeenCalled();
    });

    it("--wait 이면 in-use 가 될 때까지 기다린다", async () => {
      getMock.mockResolvedValue(vol());
      waitMock.mockResolvedValue(vol({ status: "in-use", attachments: [attachment("srv-1")] }));
      await run(attachCommand, ["vol-1", "--server", "srv-1", "--wait", "--timeout", "10"]);
      expect(waitMock).toHaveBeenCalledWith("vol-1", expect.any(Function), { timeoutMs: 10_000, label: "연결" });
    });

    it("--server 가 없으면 입력 오류로 끝난다", async () => {
      await expect(run(attachCommand, ["vol-1"])).rejects.toThrow();
      expect(getMock).not.toHaveBeenCalled();
    });

    it("--timeout 은 --wait 없이 쓸 수 없다", async () => {
      await expect(run(attachCommand, ["vol-1", "--server", "srv-1", "--timeout", "5"])).rejects.toMatchObject({
        exitCode: EXIT_PARAM_ERROR,
      });
      expect(helpers.resolveVolumeWriteClients).not.toHaveBeenCalled();
    });
  });

  describe("detach", () => {
    it("연결이 하나면 --server 없이 그 서버에서 뗀다", async () => {
      getMock.mockResolvedValue(vol({ status: "in-use", attachments: [attachment("srv-1")] }));
      await run(detachCommand, ["vol-1", "--yes"]);
      expect(detachMock).toHaveBeenCalledWith("srv-1", "vol-1");
    });

    it("연결이 여럿이면 --server 를 요구한다", async () => {
      getMock.mockResolvedValue(vol({ status: "in-use", attachments: [attachment("srv-1"), attachment("srv-2")] }));
      await expect(run(detachCommand, ["vol-1", "--yes"])).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
      expect(detachMock).not.toHaveBeenCalled();
      await run(detachCommand, ["vol-1", "--yes", "--server", "srv-2"]);
      expect(detachMock).toHaveBeenCalledWith("srv-2", "vol-1");
    });

    it("연결되지 않은 서버를 지정하면 거절한다", async () => {
      getMock.mockResolvedValue(vol({ status: "in-use", attachments: [attachment("srv-1")] }));
      await expect(run(detachCommand, ["vol-1", "--yes", "--server", "srv-9"])).rejects.toMatchObject({
        exitCode: EXIT_PARAM_ERROR,
      });
    });

    it("연결이 없으면 거절한다", async () => {
      getMock.mockResolvedValue(vol());
      await expect(run(detachCommand, ["vol-1", "--yes"])).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    });

    it("비대화형에서 --yes 가 없으면 API 호출 전에 거절한다", async () => {
      await expect(run(detachCommand, ["vol-1"])).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
      expect(helpers.resolveVolumeWriteClients).not.toHaveBeenCalled();
    });

    it("--dry-run 이면 요청을 보내지 않는다", async () => {
      getMock.mockResolvedValue(vol({ status: "in-use", attachments: [attachment("srv-1")] }));
      await run(detachCommand, ["vol-1", "--dry-run"]);
      expect(detachMock).not.toHaveBeenCalled();
      expect(vi.mocked(output).mock.calls[0]?.[1].raw).toMatchObject({ dry_run: true, applied: false, server_id: "srv-1" });
    });

    it("--wait 이면 해제될 때까지 기다린다", async () => {
      getMock.mockResolvedValue(vol({ status: "in-use", attachments: [attachment("srv-1")] }));
      waitMock.mockResolvedValue(vol());
      await run(detachCommand, ["vol-1", "--yes", "--wait"]);
      expect(waitMock).toHaveBeenCalledWith("vol-1", expect.any(Function), { timeoutMs: 300_000, label: "연결 해제" });
      expect(vi.mocked(output).mock.calls[0]?.[1].raw).toMatchObject({ completed: true });
    });
  });

  describe("delete", () => {
    it("--yes 이면 삭제 요청을 보낸다", async () => {
      getMock.mockResolvedValue(vol());
      await run(deleteCommand, ["vol-1", "--yes"]);
      expect(deleteMock).toHaveBeenCalledWith("vol-1");
      expect(waitDeletedMock).not.toHaveBeenCalled();
    });

    it("연결된 볼륨은 detach 를 안내하며 거절한다", async () => {
      getMock.mockResolvedValue(vol({ status: "in-use", attachments: [attachment("srv-1")] }));
      await expect(run(deleteCommand, ["vol-1", "--yes"])).rejects.toThrow(/volume detach vol-1/);
      expect(deleteMock).not.toHaveBeenCalled();
    });

    it("비대화형에서 --yes 가 없으면 API 호출 전에 거절한다", async () => {
      await expect(run(deleteCommand, ["vol-1"])).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
      expect(helpers.resolveVolumeWriteClients).not.toHaveBeenCalled();
      expect(deleteMock).not.toHaveBeenCalled();
    });

    it("--dry-run 이면 삭제하지 않는다", async () => {
      getMock.mockResolvedValue(vol());
      await run(deleteCommand, ["vol-1", "--dry-run"]);
      expect(deleteMock).not.toHaveBeenCalled();
      expect(vi.mocked(output).mock.calls[0]?.[1].raw).toMatchObject({ dry_run: true, applied: false, size: 300 });
    });

    it("--wait 이면 삭제 완료까지 기다린다", async () => {
      getMock.mockResolvedValue(vol());
      waitDeletedMock.mockResolvedValue(undefined);
      await run(deleteCommand, ["vol-1", "--yes", "--wait", "--timeout", "30"]);
      expect(waitDeletedMock).toHaveBeenCalledWith("vol-1", { timeoutMs: 30_000 });
      expect(vi.mocked(output).mock.calls[0]?.[1].raw).toMatchObject({ completed: true, status: "deleted" });
    });
  });
});
