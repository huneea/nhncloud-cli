import { Command } from "commander";
import { output } from "../../formatters/table.js";
import {
  HEALTH_MONITOR_TYPES,
  type CreateHealthMonitorInput,
  type HealthMonitor,
} from "../../services/loadbalancer/lbaas-types.js";
import { parseIntegerOption, parsePositiveIntegerOption } from "../parse-options.js";
import { requireResourceInput, resolveLoadBalancerClient } from "./helpers.js";
import {
  joinIds,
  optionalInput,
  outputDeleted,
  outputDryRun,
  outputFields,
  parseEnumOption,
  requireUuidInput,
  requireWriteMode,
  resolvePoolId,
  textOrEmpty,
  withSpinner,
  type LbaasGlobalOpts,
  type WriteGlobalOpts,
} from "./lbaas-helpers.js";

interface HealthMonitorCreateOpts extends WriteGlobalOpts {
  pool: string;
  type: string;
  delay: string;
  timeout: string;
  maxRetries: string;
  urlPath?: string;
  httpMethod?: string;
  expectedCodes?: string;
  healthCheckPort?: string;
  hostHeader?: string;
}

function healthMonitorRows(monitor: HealthMonitor): [string, string][] {
  return [
    ["id", monitor.id],
    ["type", monitor.type],
    ["delay", String(monitor.delay)],
    ["timeout", String(monitor.timeout)],
    ["max_retries", String(monitor.max_retries)],
    ["pool_ids", joinIds(monitor.pools)],
    ["url_path", textOrEmpty(monitor.url_path)],
    ["http_method", textOrEmpty(monitor.http_method)],
    ["expected_codes", textOrEmpty(monitor.expected_codes)],
    ["health_check_port", textOrEmpty(monitor.health_check_port)],
  ];
}

const listCommand = new Command("list")
  .description("헬스 모니터 목록을 조회한다 (전체 필드는 --json)")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (_opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<LbaasGlobalOpts>();
    const { client } = await resolveLoadBalancerClient(opts);
    const monitors = await withSpinner("헬스 모니터 목록 조회 중...", () =>
      client.listHealthMonitors(),
    );
    output(opts, {
      headers: ["id", "type", "delay", "timeout", "max_retries", "pool_ids", "url_path"],
      rows: monitors.map((monitor) => [
        monitor.id,
        monitor.type,
        String(monitor.delay),
        String(monitor.timeout),
        String(monitor.max_retries),
        joinIds(monitor.pools),
        textOrEmpty(monitor.url_path),
      ]),
      raw: monitors,
      ids: monitors.map((monitor) => monitor.id),
    });
  });

const getCommand = new Command("get")
  .description("헬스 모니터를 UUID로 조회한다")
  .argument("<healthmonitor-id>", "헬스 모니터 UUID")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (monitorInput: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<LbaasGlobalOpts>();
    const monitorId = requireUuidInput(monitorInput, "헬스 모니터");
    const { client } = await resolveLoadBalancerClient(opts);
    const monitor = await withSpinner("헬스 모니터 조회 중...", () =>
      client.getHealthMonitor(monitorId),
    );
    outputFields(opts, healthMonitorRows(monitor), monitor, [monitor.id]);
  });

const createCommand = new Command("create")
  .description("풀에 헬스 모니터를 만든다")
  .requiredOption("--pool <pool>", "헬스 모니터를 연결할 풀 이름 또는 UUID")
  .requiredOption("--type <type>", `상태 확인 프로토콜 (${HEALTH_MONITOR_TYPES.join(", ")})`)
  .requiredOption("--delay <sec>", "상태 확인 간격 (초)")
  .requiredOption("--timeout <sec>", "상태 확인 응답 대기 시간 (초)")
  .requiredOption("--max-retries <n>", "최대 재시도 횟수")
  .option("--url-path <path>", "상태 확인 요청 URL (HTTP·HTTPS, 기본 /)")
  .option("--http-method <method>", "상태 확인 HTTP method (HTTP·HTTPS, 기본 GET)")
  .option("--expected-codes <codes>", "정상으로 볼 HTTP 응답 코드 (예: 200, 200-204)")
  .option("--health-check-port <port>", "상태 확인 포트 (0 이면 멤버 포트)")
  .option("--host-header <host>", "상태 확인 Host 헤더 (HTTP·HTTPS)")
  .option("--dry-run", "쓰기 없이 보낼 요청 본문을 출력한다")
  .option("--yes", "헬스 모니터 생성 확인")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (_opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<HealthMonitorCreateOpts>();
    const dryRun = requireWriteMode(opts, "헬스 모니터 생성");
    const poolInput = requireResourceInput(opts.pool, "풀");
    const fields: Omit<CreateHealthMonitorInput, "pool_id"> = {
      type: parseEnumOption(opts.type, HEALTH_MONITOR_TYPES, "--type"),
      delay: parsePositiveIntegerOption(opts.delay, "--delay"),
      timeout: parsePositiveIntegerOption(opts.timeout, "--timeout"),
      max_retries: parsePositiveIntegerOption(opts.maxRetries, "--max-retries"),
    };
    const urlPath = optionalInput(opts.urlPath, "--url-path");
    const httpMethod = optionalInput(opts.httpMethod, "--http-method")?.toUpperCase();
    const expectedCodes = optionalInput(opts.expectedCodes, "--expected-codes");
    const hostHeader = optionalInput(opts.hostHeader, "--host-header");
    const healthCheckPort =
      opts.healthCheckPort === undefined
        ? undefined
        : parseIntegerOption(opts.healthCheckPort, "--health-check-port", { min: 0, max: 65535 });
    if (urlPath !== undefined) fields.url_path = urlPath;
    if (httpMethod !== undefined) fields.http_method = httpMethod;
    if (expectedCodes !== undefined) fields.expected_codes = expectedCodes;
    if (healthCheckPort !== undefined) fields.health_check_port = healthCheckPort;
    if (hostHeader !== undefined) fields.host_header = hostHeader;
    const { client } = await resolveLoadBalancerClient(opts);

    const result = await withSpinner(
      dryRun ? "헬스 모니터 요청 확인 중..." : "헬스 모니터 생성 중...",
      async () => {
        const input: CreateHealthMonitorInput = {
          pool_id: await resolvePoolId(client, poolInput),
          ...fields,
        };
        if (dryRun) return { input };
        return { input, monitor: await client.createHealthMonitor(input) };
      },
    );

    if (!result.monitor) {
      outputDryRun(opts, "loadbalancer-healthmonitor-create", [
        { method: "POST", path: "/v2.0/lbaas/healthmonitors", body: { healthmonitor: result.input } },
      ]);
      return;
    }
    outputFields(opts, healthMonitorRows(result.monitor), result.monitor, [result.monitor.id]);
  });

const deleteCommand = new Command("delete")
  .description("헬스 모니터를 지운다")
  .argument("<healthmonitor-id>", "헬스 모니터 UUID")
  .option("--dry-run", "쓰기 없이 보낼 요청을 출력한다")
  .option("--yes", "헬스 모니터 삭제 확인")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (monitorInput: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<WriteGlobalOpts>();
    const dryRun = requireWriteMode(opts, "헬스 모니터 삭제");
    const monitorId = requireUuidInput(monitorInput, "헬스 모니터");
    if (dryRun) {
      outputDryRun(opts, "loadbalancer-healthmonitor-delete", [
        { method: "DELETE", path: `/v2.0/lbaas/healthmonitors/${monitorId}` },
      ]);
      return;
    }
    const { client } = await resolveLoadBalancerClient(opts);
    await withSpinner("헬스 모니터 삭제 중...", () => client.deleteHealthMonitor(monitorId));
    outputDeleted(opts, "loadbalancer-healthmonitor-delete", { healthmonitor_id: monitorId }, monitorId);
  });

export const healthMonitorCommand = new Command("healthmonitor")
  .description("Load Balancer 헬스 모니터 조회·생성·삭제")
  .addCommand(listCommand)
  .addCommand(getCommand)
  .addCommand(createCommand)
  .addCommand(deleteCommand);
