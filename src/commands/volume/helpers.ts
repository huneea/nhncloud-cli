import type { Command } from "commander";
import { resolveIaasTokenContext, type IaasResolverOpts } from "../iaas.js";
import { BlockStorageClient } from "../../services/blockstorage/client.js";
import type { Volume } from "../../services/blockstorage/types.js";
import { InstanceClient } from "../../services/instance/client.js";
import type { OutputOptions } from "../../formatters/table.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { sanitizeForTerminal } from "../../utils/terminal.js";
import { parseIntegerOption } from "../parse-options.js";

/**
 * profile 해석 → iaas 자격증명 로드 → region override → Keystone 토큰 교환 → BlockStorageClient 생성.
 * Keystone 토큰·endpoint 해석은 instance/network 와 공유한다 (새 토큰 발급 없음).
 * spinner 시작 *전* (파라미터 검증·자격증명 로드 단계) 에 호출한다.
 */
export async function resolveVolumeClient(
  opts: IaasResolverOpts,
): Promise<{ client: BlockStorageClient; profileName: string }> {
  const { profileName, tokenId, blockStorageEndpoint } = await resolveIaasTokenContext(opts);
  return { client: new BlockStorageClient(tokenId, blockStorageEndpoint), profileName };
}

// ── 쓰기 명령 공통 (attach / detach / delete) ──────────────────────────────

export interface VolumeWriteOptions extends OutputOptions, IaasResolverOpts {
  yes?: boolean;
  dryRun?: boolean;
  wait?: boolean;
  timeout?: string;
}

const DEFAULT_WAIT_TIMEOUT_SEC = 300;

/** 쓰기 명령에 --region, --profile, --wait, --timeout 을 붙인다. */
export function withVolumeWriteOptions(command: Command): Command {
  return command
    .option("--wait", "작업이 끝날 때까지 기다린다")
    .option("--timeout <sec>", `--wait 대기 상한 (초, 기본 ${DEFAULT_WAIT_TIMEOUT_SEC})`)
    .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
    .option("--profile <name>", "사용할 profile 이름");
}

/** 되돌릴 수 없는 명령에 --yes, --dry-run 을 붙인다. */
export function withVolumeSafetyOptions(command: Command): Command {
  return command
    .option("--yes", "확인 없이 실행한다 (비대화형 필수)")
    .option("--dry-run", "요청을 보내지 않고 할 일만 보여준다");
}

/** --timeout 은 --wait 와 함께만 받는다. 자격증명 취득 전에 부른다. */
export function parseWaitOptions(opts: { wait?: boolean; timeout?: string }): { wait: boolean; timeoutMs: number } {
  const wait = opts.wait === true;
  if (opts.timeout !== undefined && !wait) {
    throw new NhnCloudCliError("--timeout 은 --wait 와 함께 씁니다.", EXIT_PARAM_ERROR);
  }
  const timeoutSec = parseIntegerOption(opts.timeout, "--timeout", { min: 1, max: 3600 }) ?? DEFAULT_WAIT_TIMEOUT_SEC;
  return { wait, timeoutMs: timeoutSec * 1000 };
}

/** 비대화형(TTY 아님)에서 --yes 도 --dry-run 도 없으면 API 호출 전에 거부한다. */
export function requireYesWhenNonInteractive(opts: VolumeWriteOptions, operation: string): void {
  if (opts.dryRun || opts.yes || process.stdin.isTTY) return;
  throw new NhnCloudCliError(
    `비대화형 환경에서 ${operation}에는 --yes 플래그가 필요합니다. 할 일만 보려면 --dry-run 을 쓰세요.`,
    EXIT_PARAM_ERROR,
  );
}

/** 대상 볼륨을 보여 주고 TTY 에서 확인을 받는다. 거절하면 false. --yes 이면 묻지 않는다. */
export async function confirmVolumeWrite(
  opts: VolumeWriteOptions,
  volume: Volume,
  message: string,
): Promise<boolean> {
  process.stderr.write(`${describeVolume(volume)}\n`);
  if (opts.yes) return true;
  const { confirm } = await import("@inquirer/prompts");
  return confirm({ message, default: false });
}

export function attachedServerIds(volume: Volume): string[] {
  return volume.attachments.filter((a) => typeof a === "object" && a !== null).map((a) => String(a.server_id));
}

export function describeVolume(volume: Volume): string {
  const servers = attachedServerIds(volume);
  return [
    `  id:      ${sanitizeForTerminal(volume.id)}`,
    `  이름:    ${sanitizeForTerminal(volume.name ?? "")}`,
    `  크기:    ${volume.size} GB`,
    `  상태:    ${sanitizeForTerminal(volume.status)}`,
    `  연결 서버: ${servers.length > 0 ? servers.map(sanitizeForTerminal).join(", ") : "(없음)"}`,
  ].join("\n");
}

/** profile 해석 → Keystone 토큰 → Block Storage 와 Compute 클라이언트. 같은 토큰을 공유한다. */
export async function resolveVolumeWriteClients(
  opts: IaasResolverOpts,
): Promise<{ volumeClient: BlockStorageClient; instanceClient: InstanceClient }> {
  const { tokenId, blockStorageEndpoint, computeEndpoint, imageEndpoint } = await resolveIaasTokenContext(opts);
  return {
    volumeClient: new BlockStorageClient(tokenId, blockStorageEndpoint),
    instanceClient: new InstanceClient(tokenId, computeEndpoint, imageEndpoint),
  };
}

export interface VolumeWriteResult {
  operation: "attach" | "detach" | "delete";
  volume_id: string;
  volume_name: string | null;
  size: number;
  server_id: string | null;
  action: "request" | "unchanged";
  applied: boolean;
  dry_run: boolean;
  /** --wait 로 끝까지 확인했을 때만 true */
  completed: boolean;
  status: string;
}

export function writeResultRows(r: VolumeWriteResult): string[][] {
  return [
    ["operation", r.operation],
    ["volume_id", r.volume_id],
    ["volume_name", r.volume_name ?? ""],
    ["size", String(r.size)],
    ["server_id", r.server_id ?? ""],
    ["action", r.action],
    ["applied", String(r.applied)],
    ["dry_run", String(r.dry_run)],
    ["completed", String(r.completed)],
    ["status", r.status],
  ];
}
