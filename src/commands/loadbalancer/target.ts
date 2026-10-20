import { Command } from "commander";
import { output, type OutputOptions } from "../../formatters/table.js";
import type {
  IpAclGroup,
  IpAclTarget,
} from "../../services/loadbalancer/types.js";
import { EXIT_API_ERROR } from "../../utils/exit-codes.js";
import { startSpinner, stopSpinner } from "../../utils/spinner.js";
import { sanitizeForTerminal } from "../../utils/terminal.js";
import {
  collectOption,
  normalizeCidrForCompare,
  optionalTrimmed,
  parseIpOrCidr,
  requireResourceInput,
  requireYes,
  resolveIpAclGroupId,
  resolveLoadBalancerClient,
} from "./helpers.js";
import {
  rebindIpAclSnapshots,
  skippedRebindResult,
  snapshotIpAclBindings,
  type IpAclRebindResult,
} from "./rebind.js";

interface TargetGlobalOpts extends OutputOptions {
  region?: string;
  profile?: string;
  cidr?: string[];
  description?: string;
  rebind?: boolean;
  dryRun?: boolean;
  yes?: boolean;
}

interface TargetWriteResult {
  operation: "ipacl-target-add" | "ipacl-target-remove";
  status: "succeeded" | "partial";
  target: {
    id: string;
    ipacl_group_id: string;
  };
  rebind: IpAclRebindResult;
}

interface TargetSummary {
  id: string;
  cidr_address: string;
  ipacl_group_id: string;
}

interface DuplicateCidr {
  cidr_address: string;
  target_id: string | null;
}

interface TargetAddResult {
  operation: "ipacl-target-add";
  status: "succeeded" | "partial" | "unchanged";
  /** 이번 호출에서 처음 만든 대상. 만든 것이 없으면 null. 단일 --cidr 출력과 호환하려고 유지한다. */
  target: { id: string; ipacl_group_id: string } | null;
  targets: TargetSummary[];
  skipped_duplicates: DuplicateCidr[];
  rebind: IpAclRebindResult;
}

interface TargetAddPlan {
  create: string[];
  duplicates: DuplicateCidr[];
}

/** 입력 CIDR을 그룹의 기존 대상, 그리고 입력 안의 반복과 비교해 만들 것과 건너뛸 것으로 나눈다. */
function planTargetAdd(inputs: string[], existing: IpAclTarget[]): TargetAddPlan {
  const existingByCidr = new Map<string, string>();
  for (const item of existing) {
    existingByCidr.set(normalizeCidrForCompare(item.cidr_address), item.id);
  }
  const seen = new Set<string>();
  const create: string[] = [];
  const duplicates: DuplicateCidr[] = [];
  for (const cidr of inputs) {
    const key = normalizeCidrForCompare(cidr);
    if (seen.has(key)) {
      duplicates.push({ cidr_address: cidr, target_id: existingByCidr.get(key) ?? null });
      continue;
    }
    seen.add(key);
    const existingId = existingByCidr.get(key);
    if (existingId === undefined) create.push(cidr);
    else duplicates.push({ cidr_address: cidr, target_id: existingId });
  }
  return { create, duplicates };
}

function outputTargetAddResult(opts: OutputOptions, result: TargetAddResult): void {
  const rows: Array<[string, string]> = [
    ["operation", result.operation],
    ["status", result.status],
    ["ipacl_group_id", result.targets[0]?.ipacl_group_id ?? ""],
    ["created", result.targets.map((item) => `${item.cidr_address} (${item.id})`).join(", ")],
    [
      "skipped_duplicates",
      result.skipped_duplicates
        .map((item) => (item.target_id === null ? item.cidr_address : `${item.cidr_address} (${item.target_id})`))
        .join(", "),
    ],
    ["rebind_skipped", String(result.rebind.skipped)],
    ["rebind_succeeded", String(result.rebind.succeeded.length)],
    ["rebind_failed", String(result.rebind.failed.length)],
  ];
  output(opts, {
    headers: ["field", "value"],
    rows,
    raw: result,
    ids: result.targets.map((item) => item.id),
  });
}

function writeDuplicateNotice(duplicates: DuplicateCidr[]): void {
  for (const item of duplicates) {
    const where = item.target_id === null ? "입력에 중복되어" : `이미 그룹에 있어 (대상 ${sanitizeForTerminal(item.target_id)})`;
    process.stderr.write(`안내: ${sanitizeForTerminal(item.cidr_address)} 는 ${where} 추가하지 않았습니다.\n`);
  }
}

function outputTargetWriteResult(
  opts: OutputOptions,
  result: TargetWriteResult,
): void {
  output(opts, {
    headers: ["field", "value"],
    rows: [
      ["operation", result.operation],
      ["status", result.status],
      ["target_id", result.target.id],
      ["ipacl_group_id", result.target.ipacl_group_id],
      ["rebind_skipped", String(result.rebind.skipped)],
      ["rebind_succeeded", String(result.rebind.succeeded.length)],
      ["rebind_failed", String(result.rebind.failed.length)],
    ],
    raw: result,
    ids: [result.target.id],
  });
}

function writeTargetWarnings(
  group: IpAclGroup,
  rebind: IpAclRebindResult,
): void {
  if (rebind.skipped) {
    process.stderr.write(
      "경고: --no-rebind로 재바인딩을 생략했습니다. 데이터 영역에 규칙이 즉시 반영되지 않을 수 있습니다.\n",
    );
  }
  process.stderr.write(
    "안내: IP ACL 대상 변경이 데이터 영역에 반영되기까지 약 10~20초가 걸릴 수 있습니다.\n",
  );
  if (group.action === "ALLOW") {
    process.stderr.write(
      "경고: ALLOW 그룹 대상에는 Load Balancer가 속한 VPC의 private CIDR을 사용해야 합니다.\n",
    );
  }
  if (rebind.failed.length > 0) {
    process.stderr.write(
      `경고: ${rebind.failed.length}개 Load Balancer 재바인딩이 실패했습니다. 아래 명령으로 복구하세요.\n`,
    );
    for (const failure of rebind.failed) {
      process.stderr.write(`${sanitizeForTerminal(failure.retry_command)}\n`);
      process.stderr.write(`  오류: ${sanitizeForTerminal(failure.error)}\n`);
    }
  }
}

function targetWriteResult(
  operation: TargetWriteResult["operation"],
  target: Pick<IpAclTarget, "id" | "ipacl_group_id">,
  rebind: IpAclRebindResult,
): TargetWriteResult {
  return {
    operation,
    status: rebind.failed.length === 0 ? "succeeded" : "partial",
    target: {
      id: target.id,
      ipacl_group_id: target.ipacl_group_id,
    },
    rebind,
  };
}

const listCommand = new Command("list")
  .description("IP ACL 대상 목록을 조회한다")
  .argument("<group>", "IP ACL 그룹 이름 또는 UUID")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (groupInput: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<TargetGlobalOpts>();
    const input = requireResourceInput(groupInput, "IP ACL 그룹");
    const { client } = await resolveLoadBalancerClient(opts);

    startSpinner("IP ACL 대상 목록 조회 중...");
    let targets: IpAclTarget[];
    let success = false;
    try {
      const groupId = await resolveIpAclGroupId(client, input);
      targets = await client.listIpAclTargets({ ipacl_group_id: groupId });
      success = true;
    } catch (error) {
      stopSpinner(false);
      throw error;
    } finally {
      if (success) stopSpinner(true);
    }

    output(opts, {
      headers: ["id", "cidr_address", "description", "ipacl_group_id"],
      rows: targets.map((target) => [
        target.id,
        target.cidr_address,
        target.description,
        target.ipacl_group_id,
      ]),
      raw: targets,
      ids: targets.map((target) => target.id),
    });
  });

const addCommand = new Command("add")
  .description("IP ACL 대상을 추가하고 연결된 Load Balancer를 재바인딩한다 (이미 있는 CIDR은 건너뛴다)")
  .argument("<group>", "IP ACL 그룹 이름 또는 UUID")
  .requiredOption("--cidr <ip-or-cidr>", "추가할 IP 주소 또는 CIDR (반복 지정 가능)", collectOption)
  .option("--description <text>", "IP ACL 대상 설명 (모든 --cidr에 같은 값을 쓴다)")
  .option("--dry-run", "쓰기 없이 추가할 대상과 건너뛸 중복을 출력한다")
  .option("--no-rebind", "대상 추가 후 Load Balancer 재바인딩 생략")
  .option("--yes", "대상 추가 확인")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (groupInput: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<TargetGlobalOpts>();
    if (!opts.dryRun) requireYes(opts.yes, "IP ACL 대상 추가");
    const parsedGroup = requireResourceInput(groupInput, "IP ACL 그룹");
    const parsedCidrs = (opts.cidr ?? []).map((value) => parseIpOrCidr(value));
    const parsedDescription = optionalTrimmed(opts.description);
    const { client } = await resolveLoadBalancerClient(opts);

    startSpinner(
      opts.dryRun
        ? "IP ACL 대상 추가 내용 확인 중..."
        : "IP ACL 대상 추가와 Load Balancer 재바인딩 중...",
    );
    let group: IpAclGroup;
    let plan: TargetAddPlan;
    const created: IpAclTarget[] = [];
    let rebind: IpAclRebindResult = skippedRebindResult();
    try {
      const groupId = await resolveIpAclGroupId(client, parsedGroup);
      group = await client.getIpAclGroup(groupId);
      plan = planTargetAdd(
        parsedCidrs,
        await client.listIpAclTargets({ ipacl_group_id: group.id }),
      );
      if (!opts.dryRun && plan.create.length > 0) {
        const snapshots = opts.rebind === false
          ? []
          : await snapshotIpAclBindings(
              client,
              group.loadbalancers.map((item) => item.loadbalancer_id),
            );
        for (const cidr of plan.create) {
          created.push(
            await client.createIpAclTarget({
              ipacl_group_id: group.id,
              cidr_address: cidr,
              ...(parsedDescription === undefined ? {} : { description: parsedDescription }),
            }),
          );
        }
        rebind = opts.rebind === false
          ? skippedRebindResult()
          : await rebindIpAclSnapshots(client, snapshots, {
              profile: opts.profile,
              region: opts.region,
            });
      }
    } catch (error) {
      stopSpinner(false);
      if (created.length > 0) {
        process.stderr.write(
          `경고: 대상 ${created.length}개를 만든 뒤 실패했습니다. 만든 대상: ${created
            .map((item) => `${sanitizeForTerminal(item.cidr_address)} (${sanitizeForTerminal(item.id)})`)
            .join(", ")}\n`,
        );
      }
      throw error;
    }
    stopSpinner(true);

    if (opts.dryRun) {
      output(opts, {
        headers: ["field", "value"],
        rows: [
          ["operation", "ipacl-target-add"],
          ["dry_run", "true"],
          ["ipacl_group_id", group.id],
          ["would_create", plan.create.join(", ")],
          [
            "skipped_duplicates",
            plan.duplicates.map((item) => item.cidr_address).join(", "),
          ],
          ["loadbalancers_to_rebind", String(opts.rebind === false ? 0 : group.loadbalancers.length)],
        ],
        raw: {
          operation: "ipacl-target-add",
          dry_run: true,
          ipacl_group_id: group.id,
          would_create: plan.create.map((cidr_address) => ({
            cidr_address,
            ...(parsedDescription === undefined ? {} : { description: parsedDescription }),
          })),
          skipped_duplicates: plan.duplicates,
          loadbalancers_to_rebind: opts.rebind === false
            ? []
            : group.loadbalancers.map((item) => item.loadbalancer_id),
        },
        ids: [],
      });
      writeDuplicateNotice(plan.duplicates);
      return;
    }

    const targets = created.map((item) => ({
      id: item.id,
      cidr_address: item.cidr_address,
      ipacl_group_id: item.ipacl_group_id,
    }));
    const first = targets[0];
    const result: TargetAddResult = {
      operation: "ipacl-target-add",
      status: created.length === 0 ? "unchanged" : rebind.failed.length === 0 ? "succeeded" : "partial",
      target: first === undefined ? null : { id: first.id, ipacl_group_id: first.ipacl_group_id },
      targets,
      skipped_duplicates: plan.duplicates,
      rebind,
    };
    outputTargetAddResult(opts, result);
    writeDuplicateNotice(plan.duplicates);
    if (created.length === 0) return;
    writeTargetWarnings(group, rebind);
    if (result.status === "partial") process.exitCode = EXIT_API_ERROR;
  });

const updateCommand = new Command("update")
  .description("IP ACL 대상의 설명을 바꾼다 (CIDR은 바꿀 수 없으니 삭제 후 다시 추가한다)")
  .argument("<target-id>", "IP ACL 대상 UUID")
  .requiredOption("--description <text>", "새 설명 (빈 문자열이면 설명을 지운다)")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (targetInput: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<TargetGlobalOpts>();
    const parsedTargetId = requireResourceInput(targetInput, "IP ACL 대상");
    const description = optionalTrimmed(opts.description) ?? "";
    const { client } = await resolveLoadBalancerClient(opts);

    startSpinner("IP ACL 대상 설명 변경 중...");
    let updated: IpAclTarget;
    try {
      updated = await client.updateIpAclTarget(parsedTargetId, { description });
    } catch (error) {
      stopSpinner(false);
      throw error;
    }
    stopSpinner(true);

    const result = {
      operation: "ipacl-target-update",
      status: "succeeded",
      target: {
        id: updated.id,
        cidr_address: updated.cidr_address,
        description: updated.description,
        ipacl_group_id: updated.ipacl_group_id,
      },
    };
    output(opts, {
      headers: ["field", "value"],
      rows: [
        ["operation", result.operation],
        ["status", result.status],
        ["target_id", updated.id],
        ["cidr_address", updated.cidr_address],
        ["description", updated.description],
        ["ipacl_group_id", updated.ipacl_group_id],
      ],
      raw: result,
      ids: [updated.id],
    });
  });

const removeCommand = new Command("remove")
  .alias("delete")
  .description("IP ACL 대상을 삭제하고 연결된 Load Balancer를 재바인딩한다 (별칭: delete)")
  .argument("<target-id>", "삭제할 IP ACL 대상 UUID")
  .option("--no-rebind", "대상 삭제 후 Load Balancer 재바인딩 생략")
  .option("--yes", "대상 삭제 확인")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (targetInput: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<TargetGlobalOpts>();
    requireYes(opts.yes, "IP ACL 대상 삭제");
    const parsedTargetId = requireResourceInput(targetInput, "IP ACL 대상");
    const { client } = await resolveLoadBalancerClient(opts);

    startSpinner("IP ACL 대상 삭제와 Load Balancer 재바인딩 중...");
    let group: IpAclGroup;
    let target: IpAclTarget;
    let rebind: IpAclRebindResult;
    try {
      target = await client.getIpAclTarget(parsedTargetId);
      group = await client.getIpAclGroup(target.ipacl_group_id);
      const snapshots = opts.rebind === false
        ? []
        : await snapshotIpAclBindings(
            client,
            group.loadbalancers.map((item) => item.loadbalancer_id),
          );
      await client.deleteIpAclTarget(target.id);
      rebind = opts.rebind === false
        ? skippedRebindResult()
        : await rebindIpAclSnapshots(client, snapshots, {
            profile: opts.profile,
            region: opts.region,
          });
    } catch (error) {
      stopSpinner(false);
      throw error;
    }
    stopSpinner(true);

    const result = targetWriteResult("ipacl-target-remove", target, rebind);
    outputTargetWriteResult(opts, result);
    writeTargetWarnings(group, rebind);
    if (result.status === "partial") process.exitCode = EXIT_API_ERROR;
  });

export const targetCommand = new Command("target").description("IP ACL 대상 조회·관리");
targetCommand.addCommand(listCommand);
targetCommand.addCommand(addCommand);
targetCommand.addCommand(updateCommand);
targetCommand.addCommand(removeCommand);
