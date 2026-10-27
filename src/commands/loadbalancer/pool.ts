import { isIP } from "node:net";
import { Command } from "commander";
import { output } from "../../formatters/table.js";
import {
  LB_ALGORITHMS,
  type CreateMemberInput,
  type CreatePoolInput,
  type Member,
  type Pool,
} from "../../services/loadbalancer/lbaas-types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { parseIntegerOption, parseNonNegativeIntegerOption } from "../parse-options.js";
import {
  optionalTrimmed,
  requireResourceInput,
  resolveLoadBalancerClient,
  resolveLoadBalancerId,
} from "./helpers.js";
import {
  joinIds,
  optionalInput,
  outputDeleted,
  outputDryRun,
  outputFields,
  parseEnumOption,
  requireUuidInput,
  requireWriteMode,
  resolveListenerId,
  resolvePoolId,
  textOrEmpty,
  withSpinner,
  type LbaasGlobalOpts,
  type WriteGlobalOpts,
} from "./lbaas-helpers.js";

interface PoolListOpts extends LbaasGlobalOpts {
  loadbalancer?: string;
}

interface PoolCreateOpts extends WriteGlobalOpts {
  loadbalancer?: string;
  listener?: string;
  protocol: string;
  lbAlgorithm: string;
  memberPort?: string;
  name?: string;
  description?: string;
}

interface MemberCreateOpts extends WriteGlobalOpts {
  address: string;
  port: string;
  subnet: string;
  weight?: string;
}

function parsePort(value: string, flag: string): number {
  return parseIntegerOption(value, flag, { min: 1, max: 65535 });
}

const listCommand = new Command("list")
  .description("풀 목록을 조회한다 (전체 필드는 --json)")
  .option("--loadbalancer <loadbalancer>", "이 Load Balancer의 풀만 (이름 또는 UUID)")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (_opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<PoolListOpts>();
    const loadBalancerInput =
      opts.loadbalancer === undefined
        ? undefined
        : requireResourceInput(opts.loadbalancer, "Load Balancer");
    const { client } = await resolveLoadBalancerClient(opts);

    const pools = await withSpinner("풀 목록 조회 중...", async () => {
      const all = await client.listPools();
      if (loadBalancerInput === undefined) return all;
      const loadBalancerId = await resolveLoadBalancerId(client, loadBalancerInput);
      return all.filter((pool) => pool.loadbalancers.some((item) => item.id === loadBalancerId));
    });

    output(opts, {
      headers: ["id", "name", "protocol", "lb_algorithm", "member_count", "listener_ids", "healthmonitor_id"],
      rows: pools.map((pool) => [
        pool.id,
        pool.name,
        pool.protocol,
        pool.lb_algorithm,
        String(pool.members.length),
        joinIds(pool.listeners),
        textOrEmpty(pool.healthmonitor_id),
      ]),
      raw: pools,
      ids: pools.map((pool) => pool.id),
    });
  });

function poolRows(pool: Pool): [string, string][] {
  return [
    ["id", pool.id],
    ["name", pool.name],
    ["protocol", pool.protocol],
    ["lb_algorithm", pool.lb_algorithm],
    ["member_port", textOrEmpty(pool.member_port)],
    ["loadbalancer_ids", joinIds(pool.loadbalancers)],
    ["listener_ids", joinIds(pool.listeners)],
    ["member_ids", joinIds(pool.members)],
    ["healthmonitor_id", textOrEmpty(pool.healthmonitor_id)],
  ];
}

const getCommand = new Command("get")
  .description("풀을 이름 또는 UUID로 조회한다")
  .argument("<pool>", "풀 이름 또는 UUID")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (poolInput: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<LbaasGlobalOpts>();
    const input = requireResourceInput(poolInput, "풀");
    const { client } = await resolveLoadBalancerClient(opts);
    const pool = await withSpinner("풀 조회 중...", async () =>
      client.getPool(await resolvePoolId(client, input)),
    );
    outputFields(opts, poolRows(pool), pool, [pool.id]);
  });

const createCommand = new Command("create")
  .description("풀을 만든다 (--loadbalancer 와 --listener 중 하나 필수)")
  .requiredOption("--protocol <protocol>", "멤버 프로토콜 (예: HTTP, TCP)")
  .requiredOption("--lb-algorithm <algorithm>", `로드 밸런싱 방식 (${LB_ALGORITHMS.join(", ")})`)
  .option("--loadbalancer <loadbalancer>", "풀을 둘 Load Balancer 이름 또는 UUID")
  .option("--listener <listener>", "풀을 기본 풀로 연결할 리스너 이름 또는 UUID")
  .option("--member-port <port>", "멤버 수신 포트 (1~65535)")
  .option("--name <name>", "풀 이름")
  .option("--description <text>", "풀 설명")
  .option("--dry-run", "쓰기 없이 보낼 요청 본문을 출력한다")
  .option("--yes", "풀 생성 확인")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (_opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<PoolCreateOpts>();
    const dryRun = requireWriteMode(opts, "풀 생성");
    const loadBalancerInput = optionalInput(opts.loadbalancer, "--loadbalancer");
    const listenerInput = optionalInput(opts.listener, "--listener");
    if ((loadBalancerInput === undefined) === (listenerInput === undefined)) {
      throw new NhnCloudCliError(
        "--loadbalancer 와 --listener 중 하나만 지정해야 합니다.",
        EXIT_PARAM_ERROR,
      );
    }
    const protocol = requireResourceInput(opts.protocol, "--protocol").toUpperCase();
    const lbAlgorithm = parseEnumOption(opts.lbAlgorithm, LB_ALGORITHMS, "--lb-algorithm");
    const memberPort = opts.memberPort === undefined ? undefined : parsePort(opts.memberPort, "--member-port");
    const name = optionalInput(opts.name, "--name");
    const description = optionalTrimmed(opts.description);
    const { client } = await resolveLoadBalancerClient(opts);

    const result = await withSpinner(dryRun ? "풀 요청 확인 중..." : "풀 생성 중...", async () => {
      const input: CreatePoolInput = { lb_algorithm: lbAlgorithm, protocol };
      if (loadBalancerInput !== undefined) {
        input.loadbalancer_id = await resolveLoadBalancerId(client, loadBalancerInput);
      }
      if (listenerInput !== undefined) {
        input.listener_id = await resolveListenerId(client, listenerInput);
      }
      if (memberPort !== undefined) input.member_port = memberPort;
      if (name !== undefined) input.name = name;
      if (description !== undefined) input.description = description;
      if (dryRun) return { input };
      return { input, pool: await client.createPool(input) };
    });

    if (!result.pool) {
      outputDryRun(opts, "loadbalancer-pool-create", [
        { method: "POST", path: "/v2.0/lbaas/pools", body: { pool: result.input } },
      ]);
      return;
    }
    outputFields(opts, poolRows(result.pool), result.pool, [result.pool.id]);
  });

const deleteCommand = new Command("delete")
  .description("풀을 지운다")
  .argument("<pool>", "풀 이름 또는 UUID")
  .option("--dry-run", "쓰기 없이 보낼 요청을 출력한다")
  .option("--yes", "풀 삭제 확인")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (poolInput: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<WriteGlobalOpts>();
    const dryRun = requireWriteMode(opts, "풀 삭제");
    const input = requireResourceInput(poolInput, "풀");
    const { client } = await resolveLoadBalancerClient(opts);

    const poolId = await withSpinner(dryRun ? "풀 확인 중..." : "풀 삭제 중...", async () => {
      const id = await resolvePoolId(client, input);
      if (!dryRun) await client.deletePool(id);
      return id;
    });

    if (dryRun) {
      outputDryRun(opts, "loadbalancer-pool-delete", [
        { method: "DELETE", path: `/v2.0/lbaas/pools/${poolId}` },
      ]);
      return;
    }
    outputDeleted(opts, "loadbalancer-pool-delete", { pool_id: poolId }, poolId);
  });

function memberRows(member: Member): [string, string][] {
  return [
    ["id", member.id],
    ["address", member.address],
    ["protocol_port", String(member.protocol_port)],
    ["subnet_id", textOrEmpty(member.subnet_id)],
    ["weight", textOrEmpty(member.weight)],
    ["operating_status", textOrEmpty(member.operating_status)],
  ];
}

const memberListCommand = new Command("list")
  .description("풀의 멤버 목록을 조회한다 (전체 필드는 --json)")
  .argument("<pool>", "풀 이름 또는 UUID")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (poolInput: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<LbaasGlobalOpts>();
    const input = requireResourceInput(poolInput, "풀");
    const { client } = await resolveLoadBalancerClient(opts);
    const members = await withSpinner("멤버 목록 조회 중...", async () =>
      client.listMembers(await resolvePoolId(client, input)),
    );
    output(opts, {
      headers: ["id", "address", "protocol_port", "weight", "operating_status"],
      rows: members.map((member) => [
        member.id,
        member.address,
        String(member.protocol_port),
        textOrEmpty(member.weight),
        textOrEmpty(member.operating_status),
      ]),
      raw: members,
      ids: members.map((member) => member.id),
    });
  });

const memberGetCommand = new Command("get")
  .description("풀의 멤버를 UUID로 조회한다")
  .argument("<pool>", "풀 이름 또는 UUID")
  .argument("<member-id>", "멤버 UUID")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (poolInput: string, memberInput: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<LbaasGlobalOpts>();
    const input = requireResourceInput(poolInput, "풀");
    const memberId = requireUuidInput(memberInput, "멤버");
    const { client } = await resolveLoadBalancerClient(opts);
    const member = await withSpinner("멤버 조회 중...", async () =>
      client.getMember(await resolvePoolId(client, input), memberId),
    );
    outputFields(opts, memberRows(member), member, [member.id]);
  });

const memberCreateCommand = new Command("create")
  .description("풀에 멤버를 더한다")
  .argument("<pool>", "풀 이름 또는 UUID")
  .requiredOption("--address <ip>", "멤버 IP 주소")
  .requiredOption("--port <port>", "멤버 포트 (1~65535)")
  .requiredOption("--subnet <subnet-id>", "멤버의 서브넷 UUID")
  .option("--weight <n>", "멤버 가중치")
  .option("--dry-run", "쓰기 없이 보낼 요청 본문을 출력한다")
  .option("--yes", "멤버 추가 확인")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (poolInput: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<MemberCreateOpts>();
    const dryRun = requireWriteMode(opts, "멤버 추가");
    const input = requireResourceInput(poolInput, "풀");
    const address = opts.address.trim();
    if (isIP(address) === 0) {
      throw new NhnCloudCliError(
        `--address 는 IP 주소여야 합니다: ${JSON.stringify(opts.address)}`,
        EXIT_PARAM_ERROR,
      );
    }
    const body: CreateMemberInput = {
      address,
      protocol_port: parsePort(opts.port, "--port"),
      subnet_id: requireUuidInput(opts.subnet, "서브넷"),
    };
    const weight = parseNonNegativeIntegerOption(opts.weight, "--weight");
    if (weight !== undefined) body.weight = weight;
    const { client } = await resolveLoadBalancerClient(opts);

    const result = await withSpinner(dryRun ? "멤버 요청 확인 중..." : "멤버 추가 중...", async () => {
      const poolId = await resolvePoolId(client, input);
      if (dryRun) return { poolId };
      return { poolId, member: await client.createMember(poolId, body) };
    });

    if (!result.member) {
      outputDryRun(opts, "loadbalancer-pool-member-create", [
        { method: "POST", path: `/v2.0/lbaas/pools/${result.poolId}/members`, body: { member: body } },
      ]);
      return;
    }
    outputFields(opts, memberRows(result.member), result.member, [result.member.id]);
  });

const memberDeleteCommand = new Command("delete")
  .description("풀에서 멤버를 뺀다")
  .argument("<pool>", "풀 이름 또는 UUID")
  .argument("<member-id>", "멤버 UUID")
  .option("--dry-run", "쓰기 없이 보낼 요청을 출력한다")
  .option("--yes", "멤버 삭제 확인")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (poolInput: string, memberInput: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<WriteGlobalOpts>();
    const dryRun = requireWriteMode(opts, "멤버 삭제");
    const input = requireResourceInput(poolInput, "풀");
    const memberId = requireUuidInput(memberInput, "멤버");
    const { client } = await resolveLoadBalancerClient(opts);

    const poolId = await withSpinner(dryRun ? "멤버 확인 중..." : "멤버 삭제 중...", async () => {
      const id = await resolvePoolId(client, input);
      if (!dryRun) await client.deleteMember(id, memberId);
      return id;
    });

    if (dryRun) {
      outputDryRun(opts, "loadbalancer-pool-member-delete", [
        { method: "DELETE", path: `/v2.0/lbaas/pools/${poolId}/members/${memberId}` },
      ]);
      return;
    }
    outputDeleted(
      opts,
      "loadbalancer-pool-member-delete",
      { pool_id: poolId, member_id: memberId },
      memberId,
    );
  });

const memberCommand = new Command("member")
  .description("풀 멤버 조회·추가·삭제")
  .addCommand(memberListCommand)
  .addCommand(memberGetCommand)
  .addCommand(memberCreateCommand)
  .addCommand(memberDeleteCommand);

export const poolCommand = new Command("pool")
  .description("Load Balancer 풀과 멤버 조회·생성·삭제")
  .addCommand(listCommand)
  .addCommand(getCommand)
  .addCommand(createCommand)
  .addCommand(deleteCommand)
  .addCommand(memberCommand);
