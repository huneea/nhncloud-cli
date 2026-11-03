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

interface DetachOpts extends VolumeWriteOptions {
  server?: string;
}

/** 뗄 서버를 정한다. --server 가 없으면 연결이 하나일 때만 그 서버를 쓴다. */
export function pickDetachServer(volume: Volume, requested: string | undefined): string {
  const servers = attachedServerIds(volume);
  if (servers.length === 0) {
    throw new NhnCloudCliError(`볼륨 ${volume.id} 는 어떤 서버에도 연결되어 있지 않습니다.`, EXIT_PARAM_ERROR);
  }
  if (requested !== undefined) {
    if (!servers.includes(requested)) {
      throw new NhnCloudCliError(
        `볼륨 ${volume.id} 는 서버 ${requested} 에 연결되어 있지 않습니다 (연결 서버: ${servers.join(", ")}).`,
        EXIT_PARAM_ERROR,
      );
    }
    return requested;
  }
  if (servers.length > 1) {
    throw new NhnCloudCliError(
      `볼륨 ${volume.id} 가 여러 서버에 연결되어 있어 --server 가 필요합니다 (연결 서버: ${servers.join(", ")}).`,
      EXIT_PARAM_ERROR,
    );
  }
  return servers[0] as string;
}

export const detachCommand = withVolumeSafetyOptions(
  withVolumeWriteOptions(
    new Command("detach")
      .description("볼륨을 서버에서 떼어 낸다")
      .argument("<volume-id>", "볼륨 ID")
      .option("--server <server-id>", "뗄 서버 ID (연결이 하나면 생략 가능)"),
  ),
).action(async (volumeId: string, _opts: unknown, cmd: Command) => {
  const opts = cmd.optsWithGlobals<DetachOpts>();

  // ── 1. 옵션 검증 (자격증명 취득 전) ──
  const { wait, timeoutMs } = parseWaitOptions(opts);
  requireYesWhenNonInteractive(opts, "볼륨 연결 해제");

  // ── 2. 자격증명 + 현재 상태 조회 + 대상 서버 결정 ──
  const { volumeClient, instanceClient } = await resolveVolumeWriteClients(opts);
  let volume: Volume = await volumeClient.get(volumeId);
  const serverId = pickDetachServer(volume, opts.server);

  const make = (v: Volume, applied: boolean, completed: boolean): VolumeWriteResult => ({
    operation: "detach",
    volume_id: v.id,
    volume_name: v.name,
    size: v.size,
    server_id: serverId,
    action: "request",
    applied,
    dry_run: opts.dryRun === true,
    completed,
    status: v.status,
  });

  // ── 3. 미리보기 / 확인 ──
  if (opts.dryRun) {
    process.stderr.write(chalk.yellow(`[dry-run] 서버 ${serverId} 에서 볼륨 ${volume.id} 를 떼는 요청을 보내지 않았습니다.\n`));
    output(opts, { headers: ["field", "value"], rows: writeResultRows(make(volume, false, false)), raw: make(volume, false, false), ids: [volume.id] });
    return;
  }
  const ok = await confirmVolumeWrite(opts, volume, `서버 ${serverId} 에서 이 볼륨을 떼시겠습니까?`);
  if (!ok) {
    process.stderr.write(chalk.yellow("연결 해제가 취소되었습니다.\n"));
    return;
  }

  // ── 4. 해제 요청 ──
  startSpinner("볼륨 연결 해제 중...");
  try {
    await instanceClient.detachVolume(serverId, volumeId);
    if (wait) {
      volume = await volumeClient.waitForVolume(
        volumeId,
        (v) => !attachedServerIds(v).includes(serverId) && v.status !== "detaching",
        { timeoutMs, label: "연결 해제" },
      );
    }
  } catch (err) {
    stopSpinner(false);
    throw err;
  }
  stopSpinner(true);

  process.stderr.write(
    chalk.green(wait ? `볼륨 연결 해제 완료 (volume: ${volumeId})\n` : `볼륨 연결 해제 요청 완료 (volume: ${volumeId})\n`),
  );
  const result = make(volume, true, wait);
  output(opts, { headers: ["field", "value"], rows: writeResultRows(result), raw: result, ids: [volume.id] });
});
