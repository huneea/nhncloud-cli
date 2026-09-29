import { Command } from "commander";
import { output, type OutputOptions } from "../../formatters/table.js";
import type { SecurityGroup, SecurityGroupRule } from "../../services/network/types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { startSpinner, stopSpinner } from "../../utils/spinner.js";
import { sanitizeForTerminal } from "../../utils/terminal.js";
import { requireResourceInput, requireYes } from "../resource-resolver.js";
import { resolveSecurityGroupClients, resolveSecurityGroupId, withOptions } from "./helpers.js";

interface ManageOpts extends OutputOptions {
  region?: string;
  profile?: string;
  name?: string;
  description?: string;
  yes?: boolean;
}

function parseName(value: string): string {
  const name = value.trim();
  if (!name) throw new NhnCloudCliError("--name은 비어 있을 수 없습니다.", EXIT_PARAM_ERROR);
  return name;
}

function outputGroup(opts: OutputOptions, group: SecurityGroup): void {
  output(opts, {
    headers: ["field", "value"],
    rows: [["id", group.id], ["name", group.name], ["description", group.description],
      ["rules", String(group.security_group_rules.length)]],
    raw: group,
    ids: [group.id],
  });
}

export const createCommand = withOptions(new Command("create")
  .description("보안그룹을 생성한다 (송신 규칙 두 개가 함께 생성된다)")
  .requiredOption("--name <name>", "보안그룹 이름")
  .option("--description <text>", "보안그룹 설명"))
  .action(async (_opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<ManageOpts>();
    const params = { name: parseName(opts.name ?? ""), description: opts.description };
    const { network } = await resolveSecurityGroupClients(opts);
    startSpinner("보안그룹 생성 중...");
    let group: SecurityGroup;
    try {
      group = await network.createSecurityGroup(params);
    } catch (err) {
      stopSpinner(false);
      throw err;
    }
    stopSpinner(true);
    outputGroup(opts, group);
  });

export const updateCommand = withOptions(new Command("update")
  .description("보안그룹 이름이나 설명을 변경한다")
  .argument("<group>", "보안그룹 이름 또는 UUID")
  .option("--name <name>", "새 이름")
  .option("--description <text>", "새 설명"))
  .action(async (value: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<ManageOpts>();
    if (opts.name === undefined && opts.description === undefined) {
      throw new NhnCloudCliError("--name 또는 --description 중 하나는 필요합니다.", EXIT_PARAM_ERROR);
    }
    const params = {
      name: opts.name === undefined ? undefined : parseName(opts.name),
      description: opts.description,
    };
    const groupInput = requireResourceInput(value, "보안그룹");
    const { network } = await resolveSecurityGroupClients(opts);
    startSpinner("보안그룹 변경 중...");
    let group: SecurityGroup;
    try {
      const id = await resolveSecurityGroupId(network, groupInput);
      group = await network.updateSecurityGroup(id, params);
    } catch (err) {
      stopSpinner(false);
      throw err;
    }
    stopSpinner(true);
    outputGroup(opts, group);
  });

export const deleteCommand = withOptions(new Command("delete")
  .description("보안그룹을 삭제한다 (포트에 연결된 그룹은 거부한다)")
  .argument("<group>", "보안그룹 이름 또는 UUID")
  .option("--yes", "삭제 확인"))
  .action(async (value: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<ManageOpts>();
    requireYes(opts.yes, "보안그룹 삭제");
    const groupInput = requireResourceInput(value, "보안그룹");
    const { network } = await resolveSecurityGroupClients(opts);
    startSpinner("보안그룹 삭제 중...");
    let id: string;
    let referencingRules: SecurityGroupRule[];
    try {
      const groupId = await resolveSecurityGroupId(network, groupInput);
      id = groupId;
      const ports = await network.listSecurityGroupPorts(groupId);
      if (ports.length > 0) {
        const deviceIds = [...new Set(ports.map((port) => port.device_id).filter((deviceId) => deviceId !== ""))];
        throw new NhnCloudCliError(
          `보안그룹이 포트 ${ports.length}개에 연결되어 있어 삭제할 수 없습니다. `
            + `먼저 instance security-group remove로 연결을 해제하세요: ${deviceIds.join(", ")}`,
          EXIT_PARAM_ERROR,
        );
      }
      // 서버가 remote_group_id 쿼리를 적용하는지 확인하지 못해 응답을 다시 거른다.
      referencingRules = (await network.listSecurityGroupRulesByRemoteGroup(groupId)).filter(
        (rule) => rule.remote_group_id === groupId && rule.security_group_id !== groupId,
      );
      await network.deleteSecurityGroup(groupId);
    } catch (err) {
      stopSpinner(false);
      throw err;
    }
    stopSpinner(true);
    if (referencingRules.length > 0) {
      const refs = referencingRules.map((rule) => sanitizeForTerminal(`${rule.security_group_id}/${rule.id}`));
      process.stderr.write(
        `경고: 다른 보안그룹 규칙 ${referencingRules.length}개가 이 그룹을 원격 그룹으로 참조했습니다: ${refs.join(", ")}\n`,
      );
    }
    const result = { operation: "security-group-delete", status: "succeeded", security_group_id: id };
    output(opts, {
      headers: ["field", "value"],
      rows: Object.entries(result).map(([key, field]) => [key, field]),
      raw: result,
      ids: [id],
    });
  });
