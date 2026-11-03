import { Command } from "commander";
import chalk from "chalk";
import { startSpinner, stopSpinner } from "../../utils/spinner.js";
import { output } from "../../formatters/table.js";
import {
  attachedServerIds,
  confirmVolumeWrite,
  parseWaitOptions,
  requireYesWhenNonInteractive,
  resolveVolumeWriteClients,
  withVolumeSafetyOptions,
  withVolumeWriteOptions,
  writeResultRows,
  type VolumeWriteOptions,
  type VolumeWriteResult,
} from "./helpers.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import type { Volume } from "../../services/blockstorage/types.js";

/** 연결된 볼륨은 삭제하지 않는다. 서버를 알려 detach 를 안내한다. */
export function assertDeletable(volume: Volume): void {
  const servers = attachedServerIds(volume);
  if (servers.length > 0 || volume.status === "in-use") {
    const where = servers.length > 0 ? ` (연결 서버: ${servers.join(", ")})` : "";
    throw new NhnCloudCliError(
      `볼륨 ${volume.id} 가 서버에 연결되어 있어 삭제할 수 없습니다${where}. 먼저 nhncloud volume detach ${volume.id} 로 연결을 해제하세요.`,
      EXIT_PARAM_ERROR,
    );
  }
}

export const deleteCommand = withVolumeSafetyOptions(
  withVolumeWriteOptions(new Command("delete").description("볼륨을 삭제한다 (되돌릴 수 없음)").argument("<volume-id>", "볼륨 ID")),
).action(async (volumeId: string, _opts: unknown, cmd: Command) => {
  const opts = cmd.optsWithGlobals<VolumeWriteOptions>();

  // ── 1. 옵션 검증 (자격증명 취득 전) ──
  const { wait, timeoutMs } = parseWaitOptions(opts);
  requireYesWhenNonInteractive(opts, "볼륨 삭제");

  // ── 2. 자격증명 + 현재 상태 조회 + 연결 여부 거절 ──
  const { volumeClient } = await resolveVolumeWriteClients(opts);
  const volume = await volumeClient.get(volumeId);
  assertDeletable(volume);

  const make = (applied: boolean, completed: boolean): VolumeWriteResult => ({
    operation: "delete",
    volume_id: volume.id,
    volume_name: volume.name,
    size: volume.size,
    server_id: null,
    action: "request",
    applied,
    dry_run: opts.dryRun === true,
    completed,
    status: completed ? "deleted" : volume.status,
  });

  // ── 3. 미리보기 / 확인 ──
  if (opts.dryRun) {
    process.stderr.write(chalk.yellow(`[dry-run] 볼륨 ${volume.id} 삭제 요청을 보내지 않았습니다.\n`));
    output(opts, { headers: ["field", "value"], rows: writeResultRows(make(false, false)), raw: make(false, false), ids: [volume.id] });
    return;
  }
  const ok = await confirmVolumeWrite(opts, volume, "이 볼륨을 삭제하시겠습니까? 되돌릴 수 없습니다.");
  if (!ok) {
    process.stderr.write(chalk.yellow("삭제가 취소되었습니다.\n"));
    return;
  }

  // ── 4. 삭제 요청 ──
  startSpinner("볼륨 삭제 중...");
  try {
    await volumeClient.delete(volumeId);
    if (wait) await volumeClient.waitForDeleted(volumeId, { timeoutMs });
  } catch (err) {
    stopSpinner(false);
    throw err;
  }
  stopSpinner(true);

  process.stderr.write(chalk.green(wait ? `볼륨 삭제 완료 (volume: ${volumeId})\n` : `볼륨 삭제 요청 완료 (volume: ${volumeId})\n`));
  const result = make(true, wait);
  output(opts, { headers: ["field", "value"], rows: writeResultRows(result), raw: result, ids: [volume.id] });
});
