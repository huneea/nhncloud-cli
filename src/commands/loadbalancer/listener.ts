import { Command } from "commander";
import { output } from "../../formatters/table.js";
import {
  LISTENER_PROTOCOLS,
  type CreateListenerInput,
  type Listener,
} from "../../services/loadbalancer/lbaas-types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { parseIntegerOption, parsePositiveIntegerOption } from "../parse-options.js";
import {
  collectOption,
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
  requireWriteMode,
  resolveCertificateClient,
  resolveCertificateRefs,
  resolveListenerId,
  resolvePoolId,
  textOrEmpty,
  withSpinner,
  type LbaasGlobalOpts,
  type WriteGlobalOpts,
} from "./lbaas-helpers.js";

interface ListenerListOpts extends LbaasGlobalOpts {
  loadbalancer?: string;
}

interface ListenerCreateOpts extends WriteGlobalOpts {
  loadbalancer: string;
  protocol: string;
  port: string;
  name?: string;
  description?: string;
  defaultPool?: string;
  certificate?: string;
  sniCertificate?: string[];
  tlsVersion?: string;
  connectionLimit?: string;
  keepaliveTimeout?: string;
}

const listCommand = new Command("list")
  .description("리스너 목록을 조회한다 (전체 필드는 --json)")
  .option("--loadbalancer <loadbalancer>", "이 Load Balancer의 리스너만 (이름 또는 UUID)")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (_opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<ListenerListOpts>();
    const loadBalancerInput =
      opts.loadbalancer === undefined
        ? undefined
        : requireResourceInput(opts.loadbalancer, "Load Balancer");
    const { client } = await resolveLoadBalancerClient(opts);

    const listeners = await withSpinner("리스너 목록 조회 중...", async () => {
      const all = await client.listListeners();
      if (loadBalancerInput === undefined) return all;
      const loadBalancerId = await resolveLoadBalancerId(client, loadBalancerInput);
      return all.filter((listener) =>
        listener.loadbalancers.some((item) => item.id === loadBalancerId),
      );
    });

    output(opts, {
      headers: ["id", "name", "protocol", "protocol_port", "loadbalancer_ids", "default_pool_id", "cert_expire_date"],
      rows: listeners.map((listener) => [
        listener.id,
        listener.name,
        listener.protocol,
        String(listener.protocol_port),
        joinIds(listener.loadbalancers),
        textOrEmpty(listener.default_pool_id),
        textOrEmpty(listener.cert_expire_date),
      ]),
      raw: listeners,
      ids: listeners.map((listener) => listener.id),
    });
  });

function listenerRows(listener: Listener): [string, string][] {
  return [
    ["id", listener.id],
    ["name", listener.name],
    ["protocol", listener.protocol],
    ["protocol_port", String(listener.protocol_port)],
    ["loadbalancer_ids", joinIds(listener.loadbalancers)],
    ["default_pool_id", textOrEmpty(listener.default_pool_id)],
    ["default_tls_container_ref", textOrEmpty(listener.default_tls_container_ref)],
    ["sni_container_refs", (listener.sni_container_refs ?? []).join(", ")],
    ["tls_version", textOrEmpty(listener.tls_version)],
    ["cert_expire_date", textOrEmpty(listener.cert_expire_date)],
  ];
}

const getCommand = new Command("get")
  .description("리스너를 이름 또는 UUID로 조회한다")
  .argument("<listener>", "리스너 이름 또는 UUID")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (listenerInput: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<LbaasGlobalOpts>();
    const input = requireResourceInput(listenerInput, "리스너");
    const { client } = await resolveLoadBalancerClient(opts);
    const listener = await withSpinner("리스너 조회 중...", async () =>
      client.getListener(await resolveListenerId(client, input)),
    );
    outputFields(opts, listenerRows(listener), listener, [listener.id]);
  });

const createCommand = new Command("create")
  .description("리스너를 만든다 (TERMINATED_HTTPS 는 --certificate 필수)")
  .requiredOption("--loadbalancer <loadbalancer>", "Load Balancer 이름 또는 UUID")
  .requiredOption("--protocol <protocol>", `리스너 프로토콜 (${LISTENER_PROTOCOLS.join(", ")})`)
  .requiredOption("--port <port>", "리스너 포트 (1~65535)")
  .option("--name <name>", "리스너 이름")
  .option("--description <text>", "리스너 설명")
  .option("--default-pool <pool>", "기본 풀 이름 또는 UUID")
  .option("--certificate <certificate>", "기본 TLS 인증서 (컨테이너 이름, UUID 또는 container_ref 주소)")
  .option("--sni-certificate <certificate>", "SNI 인증서 (반복 지정 가능)", collectOption)
  .option("--tls-version <version>", "최소 TLS 버전 (예: TLSv1.2, TERMINATED_HTTPS 만)")
  .option("--connection-limit <n>", "리스너 connection limit")
  .option("--keepalive-timeout <sec>", "keepalive timeout (초)")
  .option("--dry-run", "쓰기 없이 보낼 요청 본문을 출력한다")
  .option("--yes", "리스너 생성 확인")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (_opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<ListenerCreateOpts>();
    const dryRun = requireWriteMode(opts, "리스너 생성");
    const loadBalancerInput = requireResourceInput(opts.loadbalancer, "Load Balancer");
    const protocol = parseEnumOption(opts.protocol, LISTENER_PROTOCOLS, "--protocol");
    const port = parseIntegerOption(opts.port, "--port", { min: 1, max: 65535 });
    const certificateInput = optionalInput(opts.certificate, "--certificate");
    const sniInputs = (opts.sniCertificate ?? []).map((value) => requireResourceInput(value, "--sni-certificate"));
    const defaultPoolInput = optionalInput(opts.defaultPool, "--default-pool");
    const tlsVersion = optionalInput(opts.tlsVersion, "--tls-version");
    if (protocol === "TERMINATED_HTTPS" && certificateInput === undefined) {
      throw new NhnCloudCliError(
        "TERMINATED_HTTPS 리스너에는 --certificate 가 필요합니다.",
        EXIT_PARAM_ERROR,
      );
    }
    if (
      protocol !== "TERMINATED_HTTPS" &&
      (certificateInput !== undefined || sniInputs.length > 0 || tlsVersion !== undefined)
    ) {
      throw new NhnCloudCliError(
        "--certificate, --sni-certificate, --tls-version 은 TERMINATED_HTTPS 리스너에만 쓸 수 있습니다.",
        EXIT_PARAM_ERROR,
      );
    }
    const connectionLimit = parsePositiveIntegerOption(opts.connectionLimit, "--connection-limit");
    const keepaliveTimeout = parsePositiveIntegerOption(opts.keepaliveTimeout, "--keepalive-timeout");
    const name = optionalInput(opts.name, "--name");
    const description = optionalTrimmed(opts.description);
    const { client } = await resolveLoadBalancerClient(opts);

    const result = await withSpinner(dryRun ? "리스너 요청 확인 중..." : "리스너 생성 중...", async () => {
      const input: CreateListenerInput = {
        loadbalancer_id: await resolveLoadBalancerId(client, loadBalancerInput),
        protocol,
        protocol_port: port,
      };
      if (name !== undefined) input.name = name;
      if (description !== undefined) input.description = description;
      if (defaultPoolInput !== undefined) {
        input.default_pool_id = await resolvePoolId(client, defaultPoolInput);
      }
      if (certificateInput !== undefined) {
        const [defaultRef, ...sniRefs] = await resolveCertificateRefs(
          () => resolveCertificateClient(opts),
          [certificateInput, ...sniInputs],
        );
        input.default_tls_container_ref = defaultRef;
        if (sniRefs.length > 0) input.sni_container_refs = sniRefs;
      }
      if (tlsVersion !== undefined) input.tls_version = tlsVersion;
      if (connectionLimit !== undefined) input.connection_limit = connectionLimit;
      if (keepaliveTimeout !== undefined) input.keepalive_timeout = keepaliveTimeout;
      if (dryRun) return { input };
      return { input, listener: await client.createListener(input) };
    });

    if (!result.listener) {
      outputDryRun(opts, "loadbalancer-listener-create", [
        { method: "POST", path: "/v2.0/lbaas/listeners", body: { listener: result.input } },
      ]);
      return;
    }
    outputFields(opts, listenerRows(result.listener), result.listener, [result.listener.id]);
  });

const deleteCommand = new Command("delete")
  .description("리스너를 지운다")
  .argument("<listener>", "리스너 이름 또는 UUID")
  .option("--dry-run", "쓰기 없이 보낼 요청을 출력한다")
  .option("--yes", "리스너 삭제 확인")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (listenerInput: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<WriteGlobalOpts>();
    const dryRun = requireWriteMode(opts, "리스너 삭제");
    const input = requireResourceInput(listenerInput, "리스너");
    const { client } = await resolveLoadBalancerClient(opts);

    const listenerId = await withSpinner(dryRun ? "리스너 확인 중..." : "리스너 삭제 중...", async () => {
      const id = await resolveListenerId(client, input);
      if (!dryRun) await client.deleteListener(id);
      return id;
    });

    if (dryRun) {
      outputDryRun(opts, "loadbalancer-listener-delete", [
        { method: "DELETE", path: `/v2.0/lbaas/listeners/${listenerId}` },
      ]);
      return;
    }
    outputDeleted(opts, "loadbalancer-listener-delete", { listener_id: listenerId }, listenerId);
  });

export const listenerCommand = new Command("listener")
  .description("Load Balancer 리스너 조회·생성·삭제")
  .addCommand(listCommand)
  .addCommand(getCommand)
  .addCommand(createCommand)
  .addCommand(deleteCommand);
