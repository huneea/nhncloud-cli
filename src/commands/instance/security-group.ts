import { Command } from "commander";
import { output, type OutputOptions } from "../../formatters/table.js";
import type { InstanceClient } from "../../services/instance/client.js";
import type { NetworkClient } from "../../services/network/client.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { startSpinner, stopSpinner } from "../../utils/spinner.js";
import { sanitizeForTerminal } from "../../utils/terminal.js";
import { requireResourceInput, requireYes, resolveFromList } from "../resource-resolver.js";
import { requireUniqueGroupName, resolveSecurityGroupClients, withOptions } from "../network/helpers.js";

interface SecurityGroupOpts extends OutputOptions {
  region?: string;
  profile?: string;
  yes?: boolean;
}

type Action = "add" | "remove";

const ACTIONS: Record<Action, { operation: string; label: string; spinner: string }> = {
  add: { operation: "instance-security-group-add", label: "보안그룹 연결 추가", spinner: "보안그룹 연결 추가 중..." },
  remove: { operation: "instance-security-group-remove", label: "보안그룹 연결 해제", spinner: "보안그룹 연결 해제 중..." },
};

async function isAttached(network: NetworkClient, groupId: string, instanceId: string): Promise<boolean> {
  const ports = await network.listSecurityGroupPorts(groupId);
  return ports.some((port) => port.device_id === instanceId);
}

async function requestChange(
  instance: InstanceClient,
  action: Action,
  instanceId: string,
  groupName: string,
): Promise<void> {
  if (action === "add") await instance.addSecurityGroup(instanceId, groupName);
  else await instance.removeSecurityGroup(instanceId, groupName);
}

async function runAction(action: Action, instanceArg: string, groupArg: string, opts: SecurityGroupOpts): Promise<void> {
  const { operation, label, spinner } = ACTIONS[action];
  requireYes(opts.yes, label);
  const instanceId = requireResourceInput(instanceArg, "인스턴스");
  const groupInput = requireResourceInput(groupArg, "보안그룹");
  const { network, instance } = await resolveSecurityGroupClients(opts);
  startSpinner(spinner);

  let groupId: string;
  let groupName: string;
  let requested = false;
  try {
    const groups = await network.listSecurityGroups();
    groupId = resolveFromList(groups, groupInput, "보안그룹");
    groupName = requireUniqueGroupName(groups, groupId).name;
    const attached = await isAttached(network, groupId, instanceId);
    if (action === "remove" && !attached) {
      throw new NhnCloudCliError(
        `인스턴스 ${instanceId}에 보안그룹 ${groupName}이 연결되어 있지 않습니다.`,
        EXIT_PARAM_ERROR,
      );
    }
    if (action === "remove" || !attached) {
      await requestChange(instance, action, instanceId, groupName);
      requested = true;
    }
  } catch (err) {
    stopSpinner(false);
    throw err;
  }

  // 서버가 요청을 접수한 뒤에는 사후 조회 결과와 관계없이 성공으로 끝낸다.
  // 반영이 늦을 수 있고, 실패로 끝내면 재실행한 remove 가 입력 오류를 받는다.
  let warning: string | undefined;
  if (requested) {
    const safeGroupId = sanitizeForTerminal(groupId);
    try {
      const attachedAfter = await isAttached(network, groupId, instanceId);
      if (attachedAfter !== (action === "add")) {
        warning = `경고: 요청은 접수됐지만 연결 조회에 아직 반영되지 않았습니다. network security-group ports ${safeGroupId}로 다시 확인하세요.\n`;
      }
    } catch {
      warning = `경고: 요청은 접수됐지만 연결 상태를 확인하지 못했습니다. network security-group ports ${safeGroupId}로 다시 확인하세요.\n`;
    }
  }
  stopSpinner(true);
  if (warning) process.stderr.write(warning);

  const result = {
    operation,
    status: requested ? "succeeded" : "unchanged",
    instance_id: instanceId,
    security_group_id: groupId,
    security_group_name: groupName,
  };
  output(opts, {
    headers: ["field", "value"],
    rows: Object.entries(result).map(([key, value]) => [key, value]),
    raw: result,
    ids: [instanceId],
  });
}

function actionCommand(action: Action, description: string): Command {
  return withOptions(new Command(action)
    .description(description)
    .argument("<instance-id>", "인스턴스 UUID")
    .argument("<group>", "보안그룹 이름 또는 UUID")
    .option("--yes", `${ACTIONS[action].label} 확인`))
    .action(async (instanceArg: string, groupArg: string, _opts: unknown, cmd: Command) => {
      await runAction(action, instanceArg, groupArg, cmd.optsWithGlobals<SecurityGroupOpts>());
    });
}

export const securityGroupCommand = new Command("security-group")
  .description("인스턴스의 보안그룹 연결 변경")
  .addCommand(actionCommand("add", "인스턴스에 보안그룹을 연결한다 (다른 연결은 유지한다)"))
  .addCommand(actionCommand("remove", "인스턴스에서 보안그룹 연결을 해제한다 (다른 연결은 유지한다)"));
