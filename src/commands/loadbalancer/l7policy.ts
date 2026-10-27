import { Command } from "commander";
import { output } from "../../formatters/table.js";
import {
  L7_COMPARE_TYPES,
  L7_POLICY_ACTIONS,
  L7_RULE_TYPES,
  type CreateL7PolicyInput,
  type CreateL7RuleInput,
  type L7Policy,
  type L7Rule,
} from "../../services/loadbalancer/lbaas-types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { parsePositiveIntegerOption } from "../parse-options.js";
import { optionalTrimmed, requireResourceInput, resolveLoadBalancerClient } from "./helpers.js";
import {
  joinIds,
  optionalInput,
  outputDeleted,
  outputDryRun,
  outputFields,
  parseEnumOption,
  requireUuidInput,
  requireWriteMode,
  resolveL7PolicyId,
  resolveListenerId,
  resolvePoolId,
  textOrEmpty,
  withSpinner,
  type LbaasGlobalOpts,
  type WriteGlobalOpts,
} from "./lbaas-helpers.js";

interface L7PolicyListOpts extends LbaasGlobalOpts {
  listener?: string;
}

interface L7PolicyCreateOpts extends WriteGlobalOpts {
  listener: string;
  action: string;
  pool?: string;
  redirectUrl?: string;
  redirectHttpCode?: string;
  position?: string;
  name?: string;
  description?: string;
}

interface L7RuleCreateOpts extends WriteGlobalOpts {
  type: string;
  compareType: string;
  value: string;
  key?: string;
  invert?: boolean;
}

function policyRows(policy: L7Policy): [string, string][] {
  return [
    ["id", policy.id],
    ["name", policy.name],
    ["listener_id", policy.listener_id],
    ["action", policy.action],
    ["position", String(policy.position)],
    ["redirect_pool_id", textOrEmpty(policy.redirect_pool_id)],
    ["redirect_url", textOrEmpty(policy.redirect_url)],
    ["rule_ids", joinIds(policy.rules)],
  ];
}

function ruleRows(rule: L7Rule): [string, string][] {
  return [
    ["id", rule.id],
    ["type", rule.type],
    ["compare_type", rule.compare_type],
    ["key", textOrEmpty(rule.key)],
    ["value", rule.value],
    ["invert", String(rule.invert)],
  ];
}

const listCommand = new Command("list")
  .description("L7 정책 목록을 조회한다 (전체 필드는 --json)")
  .option("--listener <listener>", "이 리스너의 정책만 (이름 또는 UUID)")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (_opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<L7PolicyListOpts>();
    const listenerInput =
      opts.listener === undefined ? undefined : requireResourceInput(opts.listener, "리스너");
    const { client } = await resolveLoadBalancerClient(opts);

    const policies = await withSpinner("L7 정책 목록 조회 중...", async () => {
      const all = await client.listL7Policies();
      if (listenerInput === undefined) return all;
      const listenerId = await resolveListenerId(client, listenerInput);
      return all.filter((policy) => policy.listener_id === listenerId);
    });

    output(opts, {
      headers: ["id", "name", "listener_id", "action", "position", "redirect_pool_id", "rule_count"],
      rows: policies.map((policy) => [
        policy.id,
        policy.name,
        policy.listener_id,
        policy.action,
        String(policy.position),
        textOrEmpty(policy.redirect_pool_id),
        String(policy.rules.length),
      ]),
      raw: policies,
      ids: policies.map((policy) => policy.id),
    });
  });

const getCommand = new Command("get")
  .description("L7 정책을 이름 또는 UUID로 조회한다")
  .argument("<policy>", "L7 정책 이름 또는 UUID")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (policyInput: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<LbaasGlobalOpts>();
    const input = requireResourceInput(policyInput, "L7 정책");
    const { client } = await resolveLoadBalancerClient(opts);
    const policy = await withSpinner("L7 정책 조회 중...", async () =>
      client.getL7Policy(await resolveL7PolicyId(client, input)),
    );
    outputFields(opts, policyRows(policy), policy, [policy.id]);
  });

const createCommand = new Command("create")
  .description("리스너에 L7 정책을 만든다 (규칙은 l7policy rule create 로 더한다)")
  .requiredOption("--listener <listener>", "리스너 이름 또는 UUID")
  .requiredOption("--action <action>", `정책 액션 (${L7_POLICY_ACTIONS.join(", ")})`)
  .option("--pool <pool>", "REDIRECT_TO_POOL 대상 풀 이름 또는 UUID")
  .option("--redirect-url <url>", "REDIRECT_TO_URL 대상 URL")
  .option("--redirect-http-code <code>", "REDIRECT_TO_URL 응답 코드 (301 또는 302)")
  .option("--position <n>", "정책 우선순위 (생략하면 마지막)")
  .option("--name <name>", "정책 이름")
  .option("--description <text>", "정책 설명")
  .option("--dry-run", "쓰기 없이 보낼 요청 본문을 출력한다")
  .option("--yes", "L7 정책 생성 확인")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (_opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<L7PolicyCreateOpts>();
    const dryRun = requireWriteMode(opts, "L7 정책 생성");
    const listenerInput = requireResourceInput(opts.listener, "리스너");
    const action = parseEnumOption(opts.action, L7_POLICY_ACTIONS, "--action");
    const redirectUrl = optionalInput(opts.redirectUrl, "--redirect-url");
    const poolInput = optionalInput(opts.pool, "--pool");
    if (action === "REDIRECT_TO_POOL" && poolInput === undefined) {
      throw new NhnCloudCliError("REDIRECT_TO_POOL 정책에는 --pool 이 필요합니다.", EXIT_PARAM_ERROR);
    }
    if (action === "REDIRECT_TO_URL" && redirectUrl === undefined) {
      throw new NhnCloudCliError("REDIRECT_TO_URL 정책에는 --redirect-url 이 필요합니다.", EXIT_PARAM_ERROR);
    }
    if (action !== "REDIRECT_TO_POOL" && poolInput !== undefined) {
      throw new NhnCloudCliError("--pool 은 REDIRECT_TO_POOL 정책에만 쓸 수 있습니다.", EXIT_PARAM_ERROR);
    }
    if (action !== "REDIRECT_TO_URL" && (redirectUrl !== undefined || opts.redirectHttpCode !== undefined)) {
      throw new NhnCloudCliError(
        "--redirect-url 과 --redirect-http-code 는 REDIRECT_TO_URL 정책에만 쓸 수 있습니다.",
        EXIT_PARAM_ERROR,
      );
    }
    let redirectHttpCode: number | undefined;
    if (opts.redirectHttpCode !== undefined) {
      redirectHttpCode = Number(opts.redirectHttpCode.trim());
      if (redirectHttpCode !== 301 && redirectHttpCode !== 302) {
        throw new NhnCloudCliError(
          `--redirect-http-code 는 301 또는 302 여야 합니다: ${JSON.stringify(opts.redirectHttpCode)}`,
          EXIT_PARAM_ERROR,
        );
      }
    }
    const position = parsePositiveIntegerOption(opts.position, "--position");
    const name = optionalInput(opts.name, "--name");
    const description = optionalTrimmed(opts.description);
    const { client } = await resolveLoadBalancerClient(opts);

    const result = await withSpinner(dryRun ? "L7 정책 요청 확인 중..." : "L7 정책 생성 중...", async () => {
      const input: CreateL7PolicyInput = {
        listener_id: await resolveListenerId(client, listenerInput),
        action,
      };
      if (poolInput !== undefined) input.redirect_pool_id = await resolvePoolId(client, poolInput);
      if (redirectUrl !== undefined) input.redirect_url = redirectUrl;
      if (redirectHttpCode !== undefined) input.redirect_http_code = redirectHttpCode;
      if (position !== undefined) input.position = position;
      if (name !== undefined) input.name = name;
      if (description !== undefined) input.description = description;
      if (dryRun) return { input };
      return { input, policy: await client.createL7Policy(input) };
    });

    if (!result.policy) {
      outputDryRun(opts, "loadbalancer-l7policy-create", [
        { method: "POST", path: "/v2.0/lbaas/l7policies", body: { l7policy: result.input } },
      ]);
      return;
    }
    outputFields(opts, policyRows(result.policy), result.policy, [result.policy.id]);
  });

const deleteCommand = new Command("delete")
  .description("L7 정책과 그 규칙을 지운다")
  .argument("<policy>", "L7 정책 이름 또는 UUID")
  .option("--dry-run", "쓰기 없이 보낼 요청을 출력한다")
  .option("--yes", "L7 정책 삭제 확인")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (policyInput: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<WriteGlobalOpts>();
    const dryRun = requireWriteMode(opts, "L7 정책 삭제");
    const input = requireResourceInput(policyInput, "L7 정책");
    const { client } = await resolveLoadBalancerClient(opts);

    const policyId = await withSpinner(dryRun ? "L7 정책 확인 중..." : "L7 정책 삭제 중...", async () => {
      const id = await resolveL7PolicyId(client, input);
      if (!dryRun) await client.deleteL7Policy(id);
      return id;
    });

    if (dryRun) {
      outputDryRun(opts, "loadbalancer-l7policy-delete", [
        { method: "DELETE", path: `/v2.0/lbaas/l7policies/${policyId}` },
      ]);
      return;
    }
    outputDeleted(opts, "loadbalancer-l7policy-delete", { l7policy_id: policyId }, policyId);
  });

const ruleListCommand = new Command("list")
  .description("L7 정책의 규칙 목록을 조회한다 (전체 필드는 --json)")
  .argument("<policy>", "L7 정책 이름 또는 UUID")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (policyInput: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<LbaasGlobalOpts>();
    const input = requireResourceInput(policyInput, "L7 정책");
    const { client } = await resolveLoadBalancerClient(opts);
    const rules = await withSpinner("L7 규칙 목록 조회 중...", async () =>
      client.listL7Rules(await resolveL7PolicyId(client, input)),
    );
    output(opts, {
      headers: ["id", "type", "compare_type", "key", "value", "invert"],
      rows: rules.map((rule) => [
        rule.id,
        rule.type,
        rule.compare_type,
        textOrEmpty(rule.key),
        rule.value,
        String(rule.invert),
      ]),
      raw: rules,
      ids: rules.map((rule) => rule.id),
    });
  });

const ruleGetCommand = new Command("get")
  .description("L7 규칙을 UUID로 조회한다")
  .argument("<policy>", "L7 정책 이름 또는 UUID")
  .argument("<rule-id>", "L7 규칙 UUID")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (policyInput: string, ruleInput: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<LbaasGlobalOpts>();
    const input = requireResourceInput(policyInput, "L7 정책");
    const ruleId = requireUuidInput(ruleInput, "L7 규칙");
    const { client } = await resolveLoadBalancerClient(opts);
    const rule = await withSpinner("L7 규칙 조회 중...", async () =>
      client.getL7Rule(await resolveL7PolicyId(client, input), ruleId),
    );
    outputFields(opts, ruleRows(rule), rule, [rule.id]);
  });

const ruleCreateCommand = new Command("create")
  .description("L7 정책에 규칙을 더한다 (invert 는 --invert 가 없으면 false 로 보낸다)")
  .argument("<policy>", "L7 정책 이름 또는 UUID")
  .requiredOption("--type <type>", `규칙 타입 (${L7_RULE_TYPES.join(", ")})`)
  .requiredOption("--compare-type <type>", `비교 방식 (${L7_COMPARE_TYPES.join(", ")})`)
  .requiredOption("--value <value>", "비교할 값 (HOST_NAME 이면 도메인)")
  .option("--key <key>", "HEADER·COOKIE 규칙의 이름")
  .option("--invert", "매칭 결과를 뒤집는다")
  .option("--dry-run", "쓰기 없이 보낼 요청 본문을 출력한다")
  .option("--yes", "L7 규칙 생성 확인")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (policyInput: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<L7RuleCreateOpts>();
    const dryRun = requireWriteMode(opts, "L7 규칙 생성");
    const input = requireResourceInput(policyInput, "L7 정책");
    const type = parseEnumOption(opts.type, L7_RULE_TYPES, "--type");
    const key = optionalInput(opts.key, "--key");
    const needsKey = type === "HEADER" || type === "COOKIE";
    if (needsKey && key === undefined) {
      throw new NhnCloudCliError(`${type} 규칙에는 --key 가 필요합니다.`, EXIT_PARAM_ERROR);
    }
    if (!needsKey && key !== undefined) {
      throw new NhnCloudCliError("--key 는 HEADER, COOKIE 규칙에만 쓸 수 있습니다.", EXIT_PARAM_ERROR);
    }
    const body: CreateL7RuleInput = {
      type,
      compare_type: parseEnumOption(opts.compareType, L7_COMPARE_TYPES, "--compare-type"),
      value: requireResourceInput(opts.value, "--value"),
      invert: opts.invert === true,
    };
    if (key !== undefined) body.key = key;
    const { client } = await resolveLoadBalancerClient(opts);

    const result = await withSpinner(dryRun ? "L7 규칙 요청 확인 중..." : "L7 규칙 생성 중...", async () => {
      const policyId = await resolveL7PolicyId(client, input);
      if (dryRun) return { policyId };
      return { policyId, rule: await client.createL7Rule(policyId, body) };
    });

    if (!result.rule) {
      outputDryRun(opts, "loadbalancer-l7policy-rule-create", [
        { method: "POST", path: `/v2.0/lbaas/l7policies/${result.policyId}/rules`, body: { rule: body } },
      ]);
      return;
    }
    outputFields(opts, ruleRows(result.rule), result.rule, [result.rule.id]);
  });

const ruleDeleteCommand = new Command("delete")
  .description("L7 규칙을 지운다")
  .argument("<policy>", "L7 정책 이름 또는 UUID")
  .argument("<rule-id>", "L7 규칙 UUID")
  .option("--dry-run", "쓰기 없이 보낼 요청을 출력한다")
  .option("--yes", "L7 규칙 삭제 확인")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (policyInput: string, ruleInput: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<WriteGlobalOpts>();
    const dryRun = requireWriteMode(opts, "L7 규칙 삭제");
    const input = requireResourceInput(policyInput, "L7 정책");
    const ruleId = requireUuidInput(ruleInput, "L7 규칙");
    const { client } = await resolveLoadBalancerClient(opts);

    const policyId = await withSpinner(dryRun ? "L7 규칙 확인 중..." : "L7 규칙 삭제 중...", async () => {
      const id = await resolveL7PolicyId(client, input);
      if (!dryRun) await client.deleteL7Rule(id, ruleId);
      return id;
    });

    if (dryRun) {
      outputDryRun(opts, "loadbalancer-l7policy-rule-delete", [
        { method: "DELETE", path: `/v2.0/lbaas/l7policies/${policyId}/rules/${ruleId}` },
      ]);
      return;
    }
    outputDeleted(
      opts,
      "loadbalancer-l7policy-rule-delete",
      { l7policy_id: policyId, rule_id: ruleId },
      ruleId,
    );
  });

const ruleCommand = new Command("rule")
  .description("L7 규칙 조회·생성·삭제")
  .addCommand(ruleListCommand)
  .addCommand(ruleGetCommand)
  .addCommand(ruleCreateCommand)
  .addCommand(ruleDeleteCommand);

export const l7PolicyCommand = new Command("l7policy")
  .description("Load Balancer L7 정책과 규칙 조회·생성·삭제")
  .addCommand(listCommand)
  .addCommand(getCommand)
  .addCommand(createCommand)
  .addCommand(deleteCommand)
  .addCommand(ruleCommand);
