import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { output } from "../../formatters/table.js";
import { CertificateClient, KeyManagerError } from "../../services/loadbalancer/certificate-client.js";
import { LoadBalancerClient } from "../../services/loadbalancer/client.js";
import { EXIT_API_ERROR, EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { certificateCommand, uploadCertificate } from "./certificate.js";
import { healthMonitorCommand } from "./healthmonitor.js";
import { resolveLoadBalancerClient } from "./helpers.js";
import { l7PolicyCommand } from "./l7policy.js";
import { resolveCertificateClient } from "./lbaas-helpers.js";
import { listenerCommand } from "./listener.js";
import { poolCommand } from "./pool.js";

vi.mock("./helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./helpers.js")>();
  return { ...actual, resolveLoadBalancerClient: vi.fn() };
});
vi.mock("./lbaas-helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lbaas-helpers.js")>();
  return { ...actual, resolveCertificateClient: vi.fn() };
});
vi.mock("../../formatters/table.js", () => ({ output: vi.fn() }));
vi.mock("../../utils/spinner.js", () => ({ startSpinner: vi.fn(), stopSpinner: vi.fn() }));

const loadBalancer = {
  id: "lb-1",
  name: "web-lb",
  vip_address: "192.0.2.10",
  provisioning_status: "ACTIVE",
  operating_status: "ONLINE",
  ipacl_groups: [],
};
const listener = {
  id: "listener-1",
  name: "web-https",
  protocol: "TERMINATED_HTTPS",
  protocol_port: 443,
  loadbalancers: [{ id: "lb-1" }],
};
const otherListener = { ...listener, id: "listener-2", name: "other", loadbalancers: [{ id: "lb-2" }] };
const pool = {
  id: "pool-1",
  name: "web-pool",
  protocol: "HTTP",
  lb_algorithm: "ROUND_ROBIN",
  loadbalancers: [{ id: "lb-1" }],
  listeners: [],
  members: [],
};
const policy = {
  id: "policy-1",
  name: "service-a",
  listener_id: "listener-1",
  action: "REDIRECT_TO_POOL",
  position: 1,
  rules: [],
};
const certRef = "https://kr1-api-key-manager-infrastructure.nhncloudservice.com/v1/containers/cert-1";

const client = new LoadBalancerClient("token-id", "https://example.com/v2.0");
const certificateClient = new CertificateClient("token-id", "https://example.com/v1");

function programWith(...commands: Command[]): Command {
  const program = new Command("nhncloud").exitOverride().option("--json").option("--quiet");
  for (const command of commands) program.addCommand(command);
  return program;
}

async function run(command: Command, args: string[]): Promise<void> {
  await programWith(command).parseAsync(["node", "nhncloud", ...args]);
}

function lastRaw(): Record<string, unknown> {
  const call = vi.mocked(output).mock.calls.at(-1);
  if (!call) throw new Error("output 이 호출되지 않았습니다");
  return call[1].raw as Record<string, unknown>;
}

const tempDir = mkdtempSync(join(tmpdir(), "nhncloud-lb-cert-"));
const certFile = join(tempDir, "cert.pem");
const keyFile = join(tempDir, "key.pem");
const encryptedKeyFile = join(tempDir, "encrypted.pem");
const opensshKeyFile = join(tempDir, "openssh.pem");
const bundledFile = join(tempDir, "bundled.pem");
const keyBody = "-----BEGIN PRIVATE KEY-----\nSECRET-KEY-MATERIAL\n-----END PRIVATE KEY-----\n";
writeFileSync(certFile, "-----BEGIN CERTIFICATE-----\nCERT\n-----END CERTIFICATE-----\n");
writeFileSync(keyFile, keyBody);
writeFileSync(opensshKeyFile, "-----BEGIN OPENSSH PRIVATE KEY-----\nX\n-----END OPENSSH PRIVATE KEY-----\n");
writeFileSync(bundledFile, `-----BEGIN CERTIFICATE-----\nCERT\n-----END CERTIFICATE-----\n${keyBody}`);
writeFileSync(encryptedKeyFile, "-----BEGIN ENCRYPTED PRIVATE KEY-----\nX\n-----END ENCRYPTED PRIVATE KEY-----\n");
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.mocked(resolveLoadBalancerClient).mockResolvedValue({ client, profileName: "default" });
  vi.mocked(resolveCertificateClient).mockResolvedValue(certificateClient);
  vi.spyOn(client, "listLoadBalancers").mockResolvedValue([loadBalancer]);
  vi.spyOn(client, "listListeners").mockResolvedValue([listener, otherListener]);
  vi.spyOn(client, "listPools").mockResolvedValue([pool]);
  vi.spyOn(client, "listL7Policies").mockResolvedValue([policy]);
});

describe("loadbalancer listener", () => {
  it("--yes 와 --dry-run 이 모두 없으면 API 호출 전에 입력 오류로 끝난다", async () => {
    const create = vi.spyOn(client, "createListener");
    await expect(
      run(listenerCommand, ["listener", "create", "--loadbalancer", "web-lb", "--protocol", "HTTP", "--port", "80"]),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(resolveLoadBalancerClient).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("--dry-run 은 이름을 UUID 로 바꾼 요청 본문만 출력하고 만들지 않는다", async () => {
    const create = vi.spyOn(client, "createListener");
    await run(listenerCommand, [
      "listener", "create",
      "--loadbalancer", "web-lb",
      "--protocol", "terminated_https",
      "--port", "443",
      "--default-pool", "web-pool",
      "--certificate", certRef,
      "--tls-version", "TLSv1.2",
      "--dry-run",
    ]);

    expect(create).not.toHaveBeenCalled();
    expect(resolveCertificateClient).not.toHaveBeenCalled();
    expect(lastRaw()).toEqual({
      operation: "loadbalancer-listener-create",
      dry_run: true,
      requests: [
        {
          method: "POST",
          path: "/v2.0/lbaas/listeners",
          body: {
            listener: {
              loadbalancer_id: "lb-1",
              protocol: "TERMINATED_HTTPS",
              protocol_port: 443,
              default_pool_id: "pool-1",
              default_tls_container_ref: certRef,
              tls_version: "TLSv1.2",
            },
          },
        },
      ],
    });
  });

  it("인증서 이름은 key-manager 목록에서 container_ref 로 바꿔 --yes 로 만든다", async () => {
    vi.spyOn(certificateClient, "listCertificateContainers").mockResolvedValue([
      { container_ref: certRef, name: "web-cert", type: "certificate", status: "ACTIVE", secret_refs: [] },
    ]);
    const create = vi.spyOn(client, "createListener").mockResolvedValue(listener);

    await run(listenerCommand, [
      "listener", "create", "--loadbalancer", "lb-1", "--protocol", "TERMINATED_HTTPS",
      "--port", "443", "--certificate", "web-cert", "--sni-certificate", "cert-1", "--yes",
    ]);

    expect(create).toHaveBeenCalledWith({
      loadbalancer_id: "lb-1",
      protocol: "TERMINATED_HTTPS",
      protocol_port: 443,
      default_tls_container_ref: certRef,
      sni_container_refs: [certRef],
    });
  });

  it("TERMINATED_HTTPS 에 인증서가 없거나 다른 프로토콜에 인증서가 있으면 입력 오류다", async () => {
    await expect(
      run(listenerCommand, ["listener", "create", "--loadbalancer", "lb-1", "--protocol", "TERMINATED_HTTPS", "--port", "443", "--dry-run"]),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    await expect(
      run(listenerCommand, ["listener", "create", "--loadbalancer", "lb-1", "--protocol", "HTTP", "--port", "80", "--certificate", certRef, "--dry-run"]),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    await expect(
      run(listenerCommand, ["listener", "create", "--loadbalancer", "lb-1", "--protocol", "UDP", "--port", "80", "--dry-run"]),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
  });

  it("--dry-run 과 --yes 를 함께 주면 --dry-run 이 이겨 만들지 않는다", async () => {
    const create = vi.spyOn(client, "createListener");
    await run(listenerCommand, [
      "listener", "create", "--loadbalancer", "lb-1", "--protocol", "HTTP", "--port", "80", "--dry-run", "--yes",
    ]);
    expect(create).not.toHaveBeenCalled();
    expect(lastRaw()).toMatchObject({ dry_run: true });
  });

  it("빈 선택 옵션은 자격증명을 읽기 전에 입력 오류로 끝난다", async () => {
    await expect(
      run(listenerCommand, ["listener", "create", "--loadbalancer", "lb-1", "--protocol", "HTTP", "--port", "80", "--default-pool", " ", "--dry-run"]),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(resolveLoadBalancerClient).not.toHaveBeenCalled();
  });

  it("--yes 가 없을 때 오류 문구가 --dry-run 을 안내한다", async () => {
    await expect(
      run(listenerCommand, ["listener", "delete", "web-https"]),
    ).rejects.toMatchObject({ message: expect.stringContaining("--dry-run") });
  });

  it("list --loadbalancer 는 그 Load Balancer 의 리스너만 남긴다", async () => {
    await run(listenerCommand, ["listener", "list", "--loadbalancer", "web-lb"]);
    expect(lastRaw()).toEqual([listener]);
  });

  it("delete --yes 는 이름을 해석해 지우고 구조화 결과를 낸다", async () => {
    const remove = vi.spyOn(client, "deleteListener").mockResolvedValue();
    await run(listenerCommand, ["listener", "delete", "web-https", "--yes"]);
    expect(remove).toHaveBeenCalledWith("listener-1");
    expect(lastRaw()).toEqual({
      operation: "loadbalancer-listener-delete",
      status: "succeeded",
      listener_id: "listener-1",
    });
  });
});

describe("loadbalancer pool", () => {
  it("--loadbalancer 와 --listener 는 하나만 받는다", async () => {
    await expect(
      run(poolCommand, ["pool", "create", "--protocol", "HTTP", "--lb-algorithm", "ROUND_ROBIN", "--dry-run"]),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    await expect(
      run(poolCommand, [
        "pool", "create", "--protocol", "HTTP", "--lb-algorithm", "ROUND_ROBIN",
        "--loadbalancer", "lb-1", "--listener", "listener-1", "--dry-run",
      ]),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
  });

  it("delete --dry-run 은 풀을 해석만 하고 지우지 않는다", async () => {
    const remove = vi.spyOn(client, "deletePool");
    await run(poolCommand, ["pool", "delete", "web-pool", "--dry-run"]);
    expect(remove).not.toHaveBeenCalled();
    expect(lastRaw()).toMatchObject({ requests: [{ method: "DELETE", path: "/v2.0/lbaas/pools/pool-1" }] });
  });

  it("create --dry-run 은 풀 본문을 출력한다", async () => {
    await run(poolCommand, [
      "pool", "create", "--protocol", "http", "--lb-algorithm", "least_connections",
      "--listener", "web-https", "--member-port", "8080", "--name", "api", "--dry-run",
    ]);
    expect(lastRaw()).toMatchObject({
      requests: [
        {
          method: "POST",
          path: "/v2.0/lbaas/pools",
          body: {
            pool: {
              lb_algorithm: "LEAST_CONNECTIONS",
              protocol: "HTTP",
              listener_id: "listener-1",
              member_port: 8080,
              name: "api",
            },
          },
        },
      ],
    });
  });

  it("member create 는 IP 가 아닌 주소를 요청 전에 막고, --yes 면 풀 경로로 보낸다", async () => {
    await expect(
      run(poolCommand, ["pool", "member", "create", "web-pool", "--address", "web01", "--port", "80", "--subnet", "subnet-1", "--yes"]),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });

    const create = vi.spyOn(client, "createMember").mockResolvedValue({
      id: "member-1",
      address: "192.0.2.20",
      protocol_port: 80,
    });
    await run(poolCommand, [
      "pool", "member", "create", "web-pool", "--address", "192.0.2.20", "--port", "80",
      "--subnet", "subnet-1", "--weight", "2", "--yes",
    ]);
    expect(create).toHaveBeenCalledWith("pool-1", {
      address: "192.0.2.20",
      protocol_port: 80,
      subnet_id: "subnet-1",
      weight: 2,
    });
  });
});

describe("loadbalancer healthmonitor", () => {
  it("create --dry-run 은 풀을 해석한 본문을 출력한다", async () => {
    await run(healthMonitorCommand, [
      "healthmonitor", "create", "--pool", "web-pool", "--type", "http", "--delay", "30",
      "--timeout", "5", "--max-retries", "3", "--url-path", "/health", "--expected-codes", "200-204",
      "--dry-run",
    ]);
    expect(lastRaw()).toMatchObject({
      requests: [
        {
          method: "POST",
          path: "/v2.0/lbaas/healthmonitors",
          body: {
            healthmonitor: {
              pool_id: "pool-1",
              type: "HTTP",
              delay: 30,
              timeout: 5,
              max_retries: 3,
              url_path: "/health",
              expected_codes: "200-204",
            },
          },
        },
      ],
    });
  });

  it("delete --dry-run 은 자격증명을 읽지 않고 요청만 출력한다", async () => {
    await run(healthMonitorCommand, ["healthmonitor", "delete", "hm-1", "--dry-run"]);
    expect(resolveLoadBalancerClient).not.toHaveBeenCalled();
    expect(lastRaw()).toMatchObject({
      requests: [{ method: "DELETE", path: "/v2.0/lbaas/healthmonitors/hm-1" }],
    });
  });
});

describe("loadbalancer l7policy", () => {
  it("REDIRECT_TO_POOL 은 --pool 이 필요하고 다른 액션에는 --pool 을 받지 않는다", async () => {
    await expect(
      run(l7PolicyCommand, ["l7policy", "create", "--listener", "web-https", "--action", "REDIRECT_TO_POOL", "--dry-run"]),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    await expect(
      run(l7PolicyCommand, ["l7policy", "create", "--listener", "web-https", "--action", "REJECT", "--pool", "web-pool", "--dry-run"]),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
  });

  it("create --yes 는 리스너와 풀을 UUID 로 바꿔 만든다", async () => {
    const create = vi.spyOn(client, "createL7Policy").mockResolvedValue(policy);
    await run(l7PolicyCommand, [
      "l7policy", "create", "--listener", "web-https", "--action", "redirect_to_pool",
      "--pool", "web-pool", "--position", "1", "--name", "service-a", "--yes",
    ]);
    expect(create).toHaveBeenCalledWith({
      listener_id: "listener-1",
      action: "REDIRECT_TO_POOL",
      redirect_pool_id: "pool-1",
      position: 1,
      name: "service-a",
    });
  });

  it("rule create 는 --invert 가 없으면 invert:false 를 명시해 보낸다", async () => {
    await run(l7PolicyCommand, [
      "l7policy", "rule", "create", "service-a", "--type", "HOST_NAME",
      "--compare-type", "EQUAL_TO", "--value", "a.example.com", "--dry-run",
    ]);
    expect(lastRaw()).toMatchObject({
      requests: [
        {
          method: "POST",
          path: "/v2.0/lbaas/l7policies/policy-1/rules",
          body: { rule: { type: "HOST_NAME", compare_type: "EQUAL_TO", value: "a.example.com", invert: false } },
        },
      ],
    });

    const create = vi.spyOn(client, "createL7Rule").mockResolvedValue({
      id: "rule-1", type: "HEADER", compare_type: "EQUAL_TO", value: "v", invert: true, key: "X-Env",
    });
    await run(l7PolicyCommand, [
      "l7policy", "rule", "create", "policy-1", "--type", "HEADER", "--compare-type", "EQUAL_TO",
      "--value", "v", "--key", "X-Env", "--invert", "--yes",
    ]);
    expect(create).toHaveBeenCalledWith("policy-1", {
      type: "HEADER", compare_type: "EQUAL_TO", value: "v", invert: true, key: "X-Env",
    });
  });

  it("--position 0 은 입력 오류다", async () => {
    await expect(
      run(l7PolicyCommand, ["l7policy", "create", "--listener", "web-https", "--action", "REJECT", "--position", "0", "--dry-run"]),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
  });

  it("HEADER·COOKIE 규칙은 --key 가 필요하다", async () => {
    await expect(
      run(l7PolicyCommand, ["l7policy", "rule", "create", "policy-1", "--type", "COOKIE", "--compare-type", "EQUAL_TO", "--value", "v", "--dry-run"]),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
  });
});

describe("loadbalancer certificate", () => {
  it("upload --dry-run 은 payload 를 파일 경로와 바이트 수로 가리고 자격증명을 읽지 않는다", async () => {
    await run(certificateCommand, [
      "certificate", "upload", "--name", "web", "--certificate-file", certFile,
      "--private-key-file", keyFile, "--dry-run",
    ]);

    expect(resolveCertificateClient).not.toHaveBeenCalled();
    const raw = lastRaw();
    expect(JSON.stringify(raw)).not.toContain("SECRET-KEY-MATERIAL");
    expect(raw).toMatchObject({
      operation: "loadbalancer-certificate-upload",
      requests: [
        { method: "POST", path: "/v1/secrets", body: { name: "web-certificate", secret_type: "certificate" } },
        {
          method: "POST",
          path: "/v1/secrets",
          body: {
            name: "web-private-key",
            secret_type: "private",
            payload: `<${keyFile} ${Buffer.byteLength(keyBody)} bytes>`,
          },
        },
        {
          method: "POST",
          path: "/v1/containers",
          body: { type: "certificate", name: "web", secret_refs: [{ name: "certificate" }, { name: "private_key" }] },
        },
      ],
    });
  });

  it("암호화된 키, OpenSSH 키, 개인 키를 합친 인증서 파일, PEM 이 아닌 파일은 요청 전에 막는다", async () => {
    for (const [cert, key] of [[certFile, opensshKeyFile], [bundledFile, keyFile]]) {
      await expect(
        run(certificateCommand, [
          "certificate", "upload", "--name", "web", "--certificate-file", cert,
          "--private-key-file", key, "--yes",
        ]),
      ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    }
    await expect(
      run(certificateCommand, [
        "certificate", "upload", "--name", "web", "--certificate-file", certFile,
        "--private-key-file", encryptedKeyFile, "--yes",
      ]),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    await expect(
      run(certificateCommand, [
        "certificate", "upload", "--name", "web", "--certificate-file", keyFile,
        "--private-key-file", keyFile, "--yes",
      ]),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(resolveCertificateClient).not.toHaveBeenCalled();
  });

  it("같은 이름의 인증서가 있으면 업로드하지 않는다", async () => {
    vi.spyOn(certificateClient, "listCertificateContainers").mockResolvedValue([
      { container_ref: certRef, name: "web", type: "certificate", status: "ACTIVE", secret_refs: [] },
    ]);
    const createSecret = vi.spyOn(certificateClient, "createSecret");
    await expect(
      run(certificateCommand, [
        "certificate", "upload", "--name", "web", "--certificate-file", certFile,
        "--private-key-file", keyFile, "--yes",
      ]),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR, message: expect.stringContaining("cert-1") });
    expect(createSecret).not.toHaveBeenCalled();
  });

  it("get 은 container_ref 주소를 목록 조회 없이 UUID 로 바꿔 조회한다", async () => {
    const list = vi.spyOn(certificateClient, "listCertificateContainers");
    const get = vi.spyOn(certificateClient, "getContainer").mockResolvedValue({
      container_ref: certRef, name: "web", type: "certificate", status: "ACTIVE", secret_refs: [],
    });
    await run(certificateCommand, ["certificate", "get", certRef]);
    expect(list).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith("cert-1");
  });

  it("upload --yes 는 결과에 payload 를 내지 않는다", async () => {
    vi.spyOn(certificateClient, "listCertificateContainers").mockResolvedValue([]);
    vi.spyOn(certificateClient, "createSecret")
      .mockResolvedValueOnce("https://example.com/v1/secrets/s-cert")
      .mockResolvedValueOnce("https://example.com/v1/secrets/s-key");
    vi.spyOn(certificateClient, "createContainer").mockResolvedValue("https://example.com/v1/containers/c-1");

    await run(certificateCommand, [
      "certificate", "upload", "--name", "web", "--certificate-file", certFile,
      "--private-key-file", keyFile, "--yes",
    ]);

    const raw = lastRaw();
    expect(JSON.stringify(raw)).not.toContain("SECRET-KEY-MATERIAL");
    expect(raw).toMatchObject({ status: "succeeded", container_ref: "https://example.com/v1/containers/c-1" });
  });
});

describe("uploadCertificate", () => {
  const secrets = [
    { name: "certificate" as const, file: "c.pem", secret: { name: "w-certificate", secret_type: "certificate" as const, payload: "c", payload_content_type: "text/plain" as const } },
    { name: "private_key" as const, file: "k.pem", secret: { name: "w-private-key", secret_type: "private" as const, payload: "k", payload_content_type: "text/plain" as const } },
  ];

  it("컨테이너 생성이 실패하면 이번에 만든 시크릿을 지우고 원래 오류를 던진다", async () => {
    const failure = new KeyManagerError("API 호출 실패 (500)", EXIT_API_ERROR, true);
    const fake = {
      createSecret: vi.fn().mockResolvedValueOnce("ref-1").mockResolvedValueOnce("ref-2"),
      createContainer: vi.fn().mockRejectedValue(failure),
      deleteSecret: vi.fn().mockResolvedValue(undefined),
    };

    await expect(uploadCertificate(fake, "w", secrets)).rejects.toBe(failure);
    expect(fake.deleteSecret.mock.calls).toEqual([["ref-1"], ["ref-2"]]);
  });

  it("컨테이너 생성 결과를 모르면 시크릿을 지우지 않고 남은 ref 를 알린다", async () => {
    const fake = {
      createSecret: vi.fn().mockResolvedValueOnce("ref-1").mockResolvedValueOnce("ref-2"),
      createContainer: vi.fn().mockRejectedValue(new KeyManagerError("HTTP 요청이 30초 상한을 초과했습니다", EXIT_API_ERROR, false)),
      deleteSecret: vi.fn(),
    };

    await expect(uploadCertificate(fake, "w", secrets)).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
      message: expect.stringMatching(/컨테이너 w 생성 결과를 알 수 없어.*남은 시크릿: ref-1, ref-2/),
    });
    expect(fake.deleteSecret).not.toHaveBeenCalled();
  });

  it("시크릿 생성 결과를 모르면 앞서 만든 시크릿은 지우고 그 이름을 알린다", async () => {
    const fake = {
      createSecret: vi.fn().mockResolvedValueOnce("ref-1").mockRejectedValueOnce(new KeyManagerError("연결 실패", EXIT_API_ERROR, false)),
      createContainer: vi.fn(),
      deleteSecret: vi.fn().mockResolvedValue(undefined),
    };

    await expect(uploadCertificate(fake, "w", secrets)).rejects.toMatchObject({
      message: expect.stringContaining("시크릿 w-private-key 생성 결과를 알 수 없어"),
    });
    expect(fake.deleteSecret.mock.calls).toEqual([["ref-1"]]);
  });

  it("시크릿 일부만 지우지 못하면 그 ref 만 알린다", async () => {
    const fake = {
      createSecret: vi.fn().mockResolvedValueOnce("ref-1").mockResolvedValueOnce("ref-2"),
      createContainer: vi.fn().mockRejectedValue(new KeyManagerError("API 호출 실패 (400)", EXIT_API_ERROR, true)),
      deleteSecret: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("network")),
    };

    const message = await uploadCertificate(fake, "w", secrets).then(
      () => "",
      (caught: unknown) => (caught as Error).message,
    );
    expect(message).toContain("남은 시크릿: ref-2");
    expect(message).not.toContain("ref-1");
  });

  it("시크릿 삭제도 실패하면 남은 secret_ref 를 오류에 적는다", async () => {
    const fake = {
      createSecret: vi.fn().mockResolvedValueOnce("ref-1").mockRejectedValueOnce(new KeyManagerError("API 호출 실패 (400)", EXIT_API_ERROR, true)),
      createContainer: vi.fn(),
      deleteSecret: vi.fn().mockRejectedValue(new Error("network")),
    };

    await expect(uploadCertificate(fake, "w", secrets)).rejects.toMatchObject({
      exitCode: EXIT_API_ERROR,
      message: expect.stringContaining("남은 시크릿: ref-1"),
    });
    expect(fake.createContainer).not.toHaveBeenCalled();
  });
});
