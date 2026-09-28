import { Command } from "commander";
import { output, type OutputOptions } from "../../formatters/table.js";
import type { SecurityGroupRule } from "../../services/network/types.js";
import { startSpinner, stopSpinner } from "../../utils/spinner.js";
import { requireResourceInput } from "../resource-resolver.js";
import { formatRulePorts, formatRuleRemote, resolveSecurityGroupClients, resolveSecurityGroupId } from "./helpers.js";

interface RuleOpts extends OutputOptions {
  region?: string;
  profile?: string;
}

function withOptions(command: Command): Command {
  return command
    .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
    .option("--profile <name>", "사용할 profile 이름");
}

const listCommand = withOptions(new Command("list")
  .description("보안그룹 규칙 목록을 조회한다")
  .argument("<group>", "보안그룹 이름 또는 UUID"))
  .action(async (value: string, _opts: unknown, cmd: Command) => {
    const groupInput = requireResourceInput(value, "보안그룹");
    const opts = cmd.optsWithGlobals<RuleOpts>();
    const { network } = await resolveSecurityGroupClients(opts);
    startSpinner("보안그룹 규칙 목록 조회 중...");
    let rules: SecurityGroupRule[];
    try {
      const id = await resolveSecurityGroupId(network, groupInput);
      rules = await network.listSecurityGroupRules(id);
    } catch (err) {
      stopSpinner(false);
      throw err;
    }
    stopSpinner(true);
    output(opts, {
      headers: ["id", "direction", "ethertype", "protocol", "ports", "remote", "description"],
      rows: rules.map((rule) => [rule.id, rule.direction, rule.ethertype, rule.protocol ?? "any",
        formatRulePorts(rule), formatRuleRemote(rule), rule.description ?? ""]),
      raw: rules,
      ids: rules.map((rule) => rule.id),
    });
  });

const getCommand = withOptions(new Command("get")
  .description("보안 규칙을 조회한다")
  .argument("<rule-id>", "보안 규칙 UUID"))
  .action(async (value: string, _opts: unknown, cmd: Command) => {
    const ruleId = requireResourceInput(value, "보안 규칙");
    const opts = cmd.optsWithGlobals<RuleOpts>();
    const { network } = await resolveSecurityGroupClients(opts);
    startSpinner("보안 규칙 조회 중...");
    let rule: SecurityGroupRule;
    try {
      rule = await network.getSecurityGroupRule(ruleId);
    } catch (err) {
      stopSpinner(false);
      throw err;
    }
    stopSpinner(true);
    output(opts, {
      headers: ["field", "value"],
      rows: [["id", rule.id], ["security_group_id", rule.security_group_id], ["direction", rule.direction],
        ["ethertype", rule.ethertype], ["protocol", rule.protocol ?? "any"], ["ports", formatRulePorts(rule)],
        ["remote", formatRuleRemote(rule)], ["description", rule.description ?? ""]],
      raw: rule,
      ids: [rule.id],
    });
  });

export const ruleCommand = new Command("rule")
  .description("보안 규칙 조회")
  .addCommand(listCommand)
  .addCommand(getCommand);
