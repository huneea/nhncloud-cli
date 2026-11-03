import { Command } from "commander";
import chalk from "chalk";
import { startSpinner, stopSpinner } from "../../utils/spinner.js";
import { output } from "../../formatters/table.js";
import {
  attachedServerIds,
  parseWaitOptions,
  resolveVolumeWriteClients,
  withVolumeWriteOptions,
  writeResultRows,
  type VolumeWriteOptions,
  type VolumeWriteResult,
} from "./helpers.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import type { Volume } from "../../services/blockstorage/types.js";

interface AttachOpts extends VolumeWriteOptions {
  server: string; // requiredOption — Commander 가 존재 보장
}

export const attachCommand = withVolumeWriteOptions(
  new Command("attach")
    .description("볼륨을 서버에 연결한다")
    .argument("<volume-id>", "볼륨 ID")
    .requiredOption("--server <server-id>", "연결할 서버(인스턴스) ID — 필수"),
).action(async (volumeId: string, _opts: unknown, cmd: Command) => {
  const opts = cmd.optsWithGlobals<AttachOpts>();

  // ── 1. 옵션 검증 (자격증명 취득 전) ──
  const { wait, timeoutMs } = parseWaitOptions(opts);

  // ── 2. 자격증명 + 현재 상태 조회 ──
  const { volumeClient, instanceClient } = await resolveVolumeWriteClients(opts);
  let volume: Volume = await volumeClient.get(volumeId);

  const base = {
    operation: "attach" as const,
    volume_id: volume.id,
    size: volume.size,
    server_id: opts.server,
  };

  // 이미 그 서버에 붙어 있으면 요청하지 않는다.
  if (attachedServerIds(volume).includes(opts.server)) {
    process.stderr.write(chalk.yellow(`볼륨이 이미 서버에 연결되어 있어 요청하지 않습니다 (server: ${opts.server})\n`));
    const result: VolumeWriteResult = {
      ...base,
      volume_name: volume.name,
      action: "unchanged",
      applied: false,
      dry_run: false,
      completed: true,
      status: volume.status,
    };
    output(opts, { headers: ["field", "value"], rows: writeResultRows(result), raw: result, ids: [volume.id] });
    return;
  }

  // 다른 서버에 붙어 있으면 Compute 의 400/409 를 받기 전에 거절한다.
  const attached = attachedServerIds(volume);
  if (attached.length > 0) {
    throw new NhnCloudCliError(
      `볼륨 ${volume.id} 는 이미 다른 서버에 연결되어 있습니다 (연결 서버: ${attached.join(", ")}). 먼저 nhncloud volume detach ${volume.id} 로 연결을 해제하세요.`,
      EXIT_PARAM_ERROR,
    );
  }

  // ── 3. 연결 요청 ──
  startSpinner("볼륨 연결 중...");
  try {
    await instanceClient.attachVolume(opts.server, volumeId);
    if (wait) {
      volume = await volumeClient.waitForVolume(
        volumeId,
        (v) => v.status === "in-use" && attachedServerIds(v).includes(opts.server),
        { timeoutMs, label: "연결" },
      );
    }
  } catch (err) {
    stopSpinner(false);
    throw err;
  }
  stopSpinner(true);

  process.stderr.write(
    chalk.green(wait ? `볼륨 연결 완료 (volume: ${volumeId})\n` : `볼륨 연결 요청 완료 (volume: ${volumeId})\n`),
  );
  const result: VolumeWriteResult = {
    ...base,
    volume_name: volume.name,
    action: "request",
    applied: true,
    dry_run: false,
    completed: wait,
    status: volume.status,
  };
  output(opts, { headers: ["field", "value"], rows: writeResultRows(result), raw: result, ids: [volume.id] });
});
