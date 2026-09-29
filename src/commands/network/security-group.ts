import { Command } from "commander";
import { output, type OutputOptions } from "../../formatters/table.js";
import type { SecurityGroup, SecurityGroupPort } from "../../services/network/types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { startSpinner, stopSpinner } from "../../utils/spinner.js";
import { requireResourceInput } from "../resource-resolver.js";
import { resolveSecurityGroupClients, resolveSecurityGroupId, withOptions } from "./helpers.js";
import { ruleCommand } from "./security-group-rule.js";

interface SecurityGroupOpts extends OutputOptions {
  region?: string;
  profile?: string;
}

function optsOf(cmd: Command): SecurityGroupOpts {
  return cmd.optsWithGlobals<SecurityGroupOpts>();
}

const listCommand = withOptions(new Command("list")
  .description("보안그룹 목록을 조회한다"))
  .action(async (_opts: unknown, cmd: Command) => {
    const opts = optsOf(cmd);
    const { network } = await resolveSecurityGroupClients(opts);
    startSpinner("보안그룹 목록 조회 중...");
    let groups: SecurityGroup[];
    try {
      groups = await network.listSecurityGroups();
    } catch (err) {
      stopSpinner(false);
      throw err;
    }
    stopSpinner(true);
    output(opts, {
      headers: ["id", "name", "description", "rules"],
      rows: groups.map((group) => [group.id, group.name, group.description, String(group.security_group_rules.length)]),
      raw: groups,
      ids: groups.map((group) => group.id),
    });
  });

const getCommand = withOptions(new Command("get")
  .description("보안그룹을 조회한다")
  .argument("<group>", "보안그룹 이름 또는 UUID"))
  .action(async (value: string, _opts: unknown, cmd: Command) => {
    const groupInput = requireResourceInput(value, "보안그룹");
    const opts = optsOf(cmd);
    const { network } = await resolveSecurityGroupClients(opts);
    startSpinner("보안그룹 조회 중...");
    let group: SecurityGroup;
    try {
      const id = await resolveSecurityGroupId(network, groupInput);
      group = await network.getSecurityGroup(id);
    } catch (err) {
      stopSpinner(false);
      throw err;
    }
    stopSpinner(true);
    output(opts, {
      headers: ["field", "value"],
      rows: [["id", group.id], ["name", group.name], ["description", group.description],
        ["tenant_id", group.tenant_id], ["rules", String(group.security_group_rules.length)]],
      raw: group,
      ids: [group.id],
    });
  });

const portsCommand = withOptions(new Command("ports")
  .description("보안그룹에 연결된 포트와 인스턴스를 조회한다 (--quiet는 인스턴스 UUID)")
  .argument("<group>", "보안그룹 이름 또는 UUID"))
  .action(async (value: string, _opts: unknown, cmd: Command) => {
    const groupInput = requireResourceInput(value, "보안그룹");
    const opts = optsOf(cmd);
    const { network, instance } = await resolveSecurityGroupClients(opts);
    startSpinner("보안그룹 연결 포트 조회 중...");
    let ports: (SecurityGroupPort & { instance_name: string | null })[];
    let warning: string | null = null;
    try {
      const id = await resolveSecurityGroupId(network, groupInput);
      const listedPorts = await network.listSecurityGroupPorts(id);
      let names = new Map<string, string>();
      if (listedPorts.some((port) => port.device_owner.startsWith("compute:"))) {
        try {
          names = new Map((await instance.list()).map((server) => [server.id, server.name]));
        } catch (err) {
          warning = err instanceof NhnCloudCliError ? err.message : "알 수 없는 오류";
        }
      }
      ports = listedPorts.map((port) => ({
        ...port,
        instance_name: port.device_owner.startsWith("compute:") ? names.get(port.device_id) ?? null : null,
      }));
    } catch (err) {
      stopSpinner(false);
      throw err;
    }
    stopSpinner(true);
    if (warning !== null) process.stderr.write(`경고: 인스턴스 이름을 조회하지 못했습니다: ${warning}\n`);
    output(opts, {
      headers: ["port_id", "device_id", "instance_name", "device_owner", "fixed_ips", "security_groups"],
      rows: ports.map((port) => [port.id, port.device_id, port.instance_name ?? "", port.device_owner,
        port.fixed_ips.map((ip) => ip.ip_address).join(","), port.security_groups.join(",")]),
      raw: ports,
      ids: [...new Set(ports.filter((port) => port.device_owner.startsWith("compute:")).map((port) => port.device_id))],
    });
  });

export const securityGroupCommand = new Command("security-group")
  .description("보안그룹 조회")
  .addCommand(listCommand)
  .addCommand(getCommand)
  .addCommand(portsCommand)
  .addCommand(ruleCommand);
