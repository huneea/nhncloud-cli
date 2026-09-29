import { Command } from "commander";
import { output, type OutputOptions } from "../../formatters/table.js";
import type { SecurityGroupRule } from "../../services/network/types.js";
import { startSpinner, stopSpinner } from "../../utils/spinner.js";
import { requireResourceInput, requireYes, resolveFromList } from "../resource-resolver.js";
import {
  formatRulePorts, formatRuleRemote, parseRuleInput, resolveSecurityGroupClients, resolveSecurityGroupId,
  toCreateRuleParams, withOptions,
} from "./helpers.js";

interface RuleOpts extends OutputOptions {
  region?: string;
  profile?: string;
}

interface RuleWriteOpts extends RuleOpts {
  direction?: string;
  protocol?: string;
  port?: string;
  portRange?: string;
  cidr?: string;
  remoteGroup?: string;
  description?: string;
  yes?: boolean;
}

const REPLACE_NOTE = "(규칙 수정 API가 없어 교체는 생성 후 삭제로 한다)";

function outputRule(opts: OutputOptions, rule: SecurityGroupRule): void {
  output(opts, {
    headers: ["field", "value"],
    rows: [["id", rule.id], ["security_group_id", rule.security_group_id], ["direction", rule.direction],
      ["ethertype", rule.ethertype], ["protocol", rule.protocol ?? "any"], ["ports", formatRulePorts(rule)],
      ["remote", formatRuleRemote(rule)], ["description", rule.description ?? ""]],
    raw: rule,
    ids: [rule.id],
  });
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
    outputRule(opts, rule);
  });

const createCommand = withOptions(new Command("create")
  .description(`보안 규칙을 생성한다 ${REPLACE_NOTE}`)
  .argument("<group>", "보안그룹 이름 또는 UUID")
  .requiredOption("--direction <direction>", "ingress 또는 egress")
  .option("--protocol <protocol>", "tcp, udp, icmp, any (기본: any)")
  .option("--port <port>", "단일 포트 (tcp·udp)")
  .option("--port-range <start-end>", "포트 범위 (예: 1000-2000, tcp·udp)")
  .option("--cidr <cidr>", "원격 IPv4 주소 또는 CIDR")
  .option("--remote-group <group>", "원격 보안그룹 이름 또는 UUID")
  .option("--description <text>", "규칙 설명"))
  .action(async (value: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<RuleWriteOpts>();
    const input = parseRuleInput(opts);
    const groupInput = requireResourceInput(value, "보안그룹");
    const remoteGroupInput = input.remoteGroup === undefined
      ? undefined : requireResourceInput(input.remoteGroup, "원격 보안그룹");
    const { network } = await resolveSecurityGroupClients(opts);
    startSpinner("보안 규칙 생성 중...");
    let rule: SecurityGroupRule;
    try {
      const groups = await network.listSecurityGroups();
      const groupId = resolveFromList(groups, groupInput, "보안그룹");
      const remoteGroupId = remoteGroupInput === undefined
        ? undefined : resolveFromList(groups, remoteGroupInput, "원격 보안그룹");
      rule = await network.createSecurityGroupRule(toCreateRuleParams(input, groupId, remoteGroupId));
    } catch (err) {
      stopSpinner(false);
      throw err;
    }
    stopSpinner(true);
    outputRule(opts, rule);
  });

const deleteCommand = withOptions(new Command("delete")
  .description(`보안 규칙을 삭제한다 ${REPLACE_NOTE}`)
  .argument("<rule-id>", "보안 규칙 UUID")
  .option("--yes", "삭제 확인"))
  .action(async (value: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<RuleWriteOpts>();
    requireYes(opts.yes, "보안 규칙 삭제");
    const ruleId = requireResourceInput(value, "보안 규칙");
    const { network } = await resolveSecurityGroupClients(opts);
    startSpinner("보안 규칙 삭제 중...");
    try {
      await network.deleteSecurityGroupRule(ruleId);
    } catch (err) {
      stopSpinner(false);
      throw err;
    }
    stopSpinner(true);
    const result = { operation: "security-group-rule-delete", status: "succeeded", security_group_rule_id: ruleId };
    output(opts, {
      headers: ["field", "value"],
      rows: Object.entries(result).map(([key, field]) => [key, field]),
      raw: result,
      ids: [ruleId],
    });
  });

export const ruleCommand = new Command("rule")
  .description("보안 규칙 조회와 변경")
  .addCommand(listCommand)
  .addCommand(getCommand)
  .addCommand(createCommand)
  .addCommand(deleteCommand);
