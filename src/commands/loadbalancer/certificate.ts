import { Command } from "commander";
import { output } from "../../formatters/table.js";
import {
  KeyManagerError,
  refId,
  type CertificateClient,
  type CertificateContainer,
  type CertificateSecretName,
  type ContainerSecretRef,
  type CreateSecretInput,
} from "../../services/loadbalancer/certificate-client.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR, EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { decodeUtf8Input, readInputSource } from "../input-source.js";
import { requireResourceInput } from "./helpers.js";
import {
  certificateContainerId,
  outputDryRun,
  outputFields,
  requireWriteMode,
  resolveCertificateClient,
  resolveCertificateRefs,
  textOrEmpty,
  withSpinner,
  type LbaasGlobalOpts,
  type WriteGlobalOpts,
} from "./lbaas-helpers.js";

// Load Balancer TLS 인증서: key-manager 시크릿과 certificate 컨테이너 (ADR-048).

interface CertificateUploadOpts extends WriteGlobalOpts {
  name: string;
  certificateFile: string;
  privateKeyFile: string;
  intermediatesFile?: string;
}

/** 서버 인증서와 체인을 합친 PEM 도 이 안에 든다. 한도는 서버가 다시 판정한다. */
const PEM_MAX_BYTES = 64 * 1024;

interface PemSecret {
  name: CertificateSecretName;
  file: string;
  secret: CreateSecretInput;
}

function readPem(file: string, label: string): string {
  const bytes = readInputSource({ file }, { fileFlag: "--file", label, maxBytes: PEM_MAX_BYTES });
  return decodeUtf8Input(bytes, label, "PEM 형식 파일을 지정하세요.");
}

function requirePemBlock(pem: string, pattern: RegExp, label: string, file: string): void {
  if (!pattern.test(pem)) {
    throw new NhnCloudCliError(`${label} 파일이 PEM 형식이 아닙니다: ${file}`, EXIT_PARAM_ERROR);
  }
}

/** 인증서 파일에 개인 키를 합쳐 두면 개인 키가 certificate 시크릿으로 한 번 더 올라간다. */
function rejectPrivateKeyBlock(pem: string, label: string, file: string): void {
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(pem)) {
    throw new NhnCloudCliError(
      `${label} 파일에 개인 키가 들어 있습니다. 개인 키는 --private-key-file 로 따로 지정하세요: ${file}`,
      EXIT_PARAM_ERROR,
    );
  }
}

function loadPemSecrets(opts: CertificateUploadOpts, name: string): PemSecret[] {
  const certificate = readPem(opts.certificateFile, "인증서");
  requirePemBlock(certificate, /-----BEGIN CERTIFICATE-----/, "인증서", opts.certificateFile);
  rejectPrivateKeyBlock(certificate, "인증서", opts.certificateFile);

  const privateKey = readPem(opts.privateKeyFile, "개인 키");
  requirePemBlock(privateKey, /-----BEGIN [A-Z ]*PRIVATE KEY-----/, "개인 키", opts.privateKeyFile);
  if (/OPENSSH PRIVATE KEY/.test(privateKey)) {
    throw new NhnCloudCliError(
      `OpenSSH 형식 개인 키는 쓸 수 없습니다. PKCS#1 또는 PKCS#8 PEM 으로 바꿔 지정하세요: ${opts.privateKeyFile}`,
      EXIT_PARAM_ERROR,
    );
  }
  if (/ENCRYPTED PRIVATE KEY|Proc-Type:\s*4,ENCRYPTED/.test(privateKey)) {
    throw new NhnCloudCliError(
      `개인 키가 암호화돼 있습니다. 비밀번호를 제거한 키를 지정하세요: ${opts.privateKeyFile}`,
      EXIT_PARAM_ERROR,
    );
  }

  const secrets: PemSecret[] = [
    {
      name: "certificate",
      file: opts.certificateFile,
      secret: { name: `${name}-certificate`, secret_type: "certificate", payload: certificate, payload_content_type: "text/plain" },
    },
    {
      name: "private_key",
      file: opts.privateKeyFile,
      secret: { name: `${name}-private-key`, secret_type: "private", payload: privateKey, payload_content_type: "text/plain" },
    },
  ];
  if (opts.intermediatesFile !== undefined) {
    const intermediates = readPem(opts.intermediatesFile, "체인 인증서");
    requirePemBlock(intermediates, /-----BEGIN CERTIFICATE-----/, "체인 인증서", opts.intermediatesFile);
    rejectPrivateKeyBlock(intermediates, "체인 인증서", opts.intermediatesFile);
    secrets.push({
      name: "intermediates",
      file: opts.intermediatesFile,
      secret: { name: `${name}-intermediates`, secret_type: "certificate", payload: intermediates, payload_content_type: "text/plain" },
    });
  }
  return secrets;
}

/** payload 는 어떤 출력에도 내지 않는다. 파일 경로와 바이트 수로 바꾼다. */
function redactSecret(item: PemSecret): Record<string, unknown> {
  return {
    ...item.secret,
    payload: `<${item.file} ${Buffer.byteLength(item.secret.payload, "utf-8")} bytes>`,
  };
}

function outcomeKnown(error: unknown): boolean {
  return error instanceof KeyManagerError && error.outcomeKnown;
}

/**
 * 시크릿을 만든 뒤 컨테이너로 묶는다. 중간에 실패하면 이번에 만든 시크릿을 지운다 (ADR-048).
 * - 시크릿 생성 결과를 모르면(시간 초과 등) 그 이름의 시크릿이 남았을 수 있다고 알린다.
 * - 컨테이너 생성 결과를 모르면 컨테이너가 시크릿을 참조할 수 있어 지우지 않고 ref 를 알린다.
 * - 지우기까지 실패하면 남은 secret_ref 를 오류에 적는다.
 */
export async function uploadCertificate(
  client: Pick<CertificateClient, "createSecret" | "createContainer" | "deleteSecret">,
  name: string,
  secrets: PemSecret[],
): Promise<{ container_ref: string; secret_refs: ContainerSecretRef[] }> {
  const created: ContainerSecretRef[] = [];
  let pending: string | undefined;
  try {
    for (const item of secrets) {
      pending = `시크릿 ${item.secret.name}`;
      created.push({ name: item.name, secret_ref: await client.createSecret(item.secret) });
    }
    pending = `컨테이너 ${name}`;
    const containerRef = await client.createContainer({ type: "certificate", name, secret_refs: created });
    return { container_ref: containerRef, secret_refs: created };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const exitCode = error instanceof NhnCloudCliError ? error.exitCode : EXIT_API_ERROR;
    const containerUncertain = pending === `컨테이너 ${name}` && !outcomeKnown(error);
    const notes: string[] = [];
    if (!outcomeKnown(error)) {
      notes.push(`${pending} 생성 결과를 알 수 없어 만들어졌을 수 있습니다. key-manager 에서 이름으로 확인하세요`);
    }
    if (containerUncertain) {
      if (created.length > 0) {
        notes.push(`컨테이너가 참조할 수 있어 시크릿을 지우지 않았습니다. 남은 시크릿: ${created.map((item) => item.secret_ref).join(", ")}`);
      }
    } else {
      const leftovers: string[] = [];
      for (const item of created) {
        try {
          await client.deleteSecret(item.secret_ref);
        } catch {
          leftovers.push(item.secret_ref);
        }
      }
      if (leftovers.length > 0) {
        notes.push(`만든 시크릿을 지우지 못했습니다. 남은 시크릿: ${leftovers.join(", ")}`);
      }
    }
    if (notes.length === 0) throw error;
    throw new NhnCloudCliError(`${reason} — ${notes.join(". ")}`, exitCode);
  }
}

function containerRows(container: CertificateContainer): [string, string][] {
  return [
    ["id", certificateContainerId(container)],
    ["name", textOrEmpty(container.name)],
    ["container_ref", container.container_ref],
    ["status", container.status],
    ["common_name", textOrEmpty(container.common_name)],
    ["expiration", textOrEmpty(container.expiration)],
    ["secret_names", container.secret_refs.map((item) => item.name).join(", ")],
    ["consumer_count", String(container.consumers?.length ?? 0)],
  ];
}

const listCommand = new Command("list")
  .description("Load Balancer 에 쓸 수 있는 인증서(certificate 컨테이너) 목록을 조회한다")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (_opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<LbaasGlobalOpts>();
    const client = await resolveCertificateClient(opts);
    const containers = await withSpinner("인증서 목록 조회 중...", () =>
      client.listCertificateContainers(),
    );
    output(opts, {
      headers: ["id", "name", "status", "common_name", "expiration"],
      rows: containers.map((container) => [
        certificateContainerId(container),
        textOrEmpty(container.name),
        container.status,
        textOrEmpty(container.common_name),
        textOrEmpty(container.expiration),
      ]),
      raw: containers,
      ids: containers.map((container) => certificateContainerId(container)),
    });
  });

const getCommand = new Command("get")
  .description("인증서 컨테이너를 이름, UUID 또는 container_ref 로 조회한다 (시크릿 내용은 조회하지 않는다)")
  .argument("<certificate>", "인증서 컨테이너 이름, UUID 또는 container_ref 주소")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (certificateInput: string, _opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<LbaasGlobalOpts>();
    const input = requireResourceInput(certificateInput, "인증서");
    const client = await resolveCertificateClient(opts);
    const container = await withSpinner("인증서 조회 중...", async () => {
      const [ref] = await resolveCertificateRefs(async () => client, [input]);
      return client.getContainer(refId(ref ?? input));
    });
    outputFields(opts, containerRows(container), container, [certificateContainerId(container)]);
  });

const uploadCommand = new Command("upload")
  .description("PEM 인증서와 개인 키를 key-manager 에 올려 certificate 컨테이너를 만든다")
  .requiredOption("--name <name>", "인증서 컨테이너 이름")
  .requiredOption("--certificate-file <path>", "서버 인증서 PEM 파일 (체인을 이어 붙여도 된다)")
  .requiredOption("--private-key-file <path>", "비밀번호를 제거한 개인 키 PEM 파일")
  .option("--intermediates-file <path>", "체인 인증서 PEM 파일")
  .option("--dry-run", "쓰기 없이 보낼 요청을 출력한다 (payload 는 바이트 수만)")
  .option("--yes", "인증서 업로드 확인")
  .option("--region <region>", "region override (기본: iaas 자격증명의 region)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (_opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<CertificateUploadOpts>();
    const dryRun = requireWriteMode(opts, "인증서 업로드");
    const name = requireResourceInput(opts.name, "--name");
    const secrets = loadPemSecrets(opts, name);

    if (dryRun) {
      outputDryRun(opts, "loadbalancer-certificate-upload", [
        ...secrets.map((item) => ({ method: "POST" as const, path: "/v1/secrets", body: redactSecret(item) })),
        {
          method: "POST",
          path: "/v1/containers",
          body: {
            type: "certificate",
            name,
            secret_refs: secrets.map((item) => ({ name: item.name, secret_ref: `<${item.name} secret_ref>` })),
          },
        },
      ]);
      return;
    }

    const client = await resolveCertificateClient(opts);
    const result = await withSpinner("인증서 업로드 중...", async () => {
      // 같은 이름이 둘이면 listener create --certificate <name> 이 이름 중복으로 실패한다.
      const existing = (await client.listCertificateContainers()).filter((item) => item.name === name);
      if (existing.length > 0) {
        throw new NhnCloudCliError(
          `같은 이름의 인증서가 이미 있습니다: ${JSON.stringify(name)} (UUID: ${existing.map(certificateContainerId).join(", ")})`,
          EXIT_PARAM_ERROR,
        );
      }
      return uploadCertificate(client, name, secrets);
    });
    const raw = { operation: "loadbalancer-certificate-upload", status: "succeeded", name, ...result };
    outputFields(
      opts,
      [
        ["operation", raw.operation],
        ["status", raw.status],
        ["name", name],
        ["id", refId(result.container_ref)],
        ["container_ref", result.container_ref],
        ["secret_names", result.secret_refs.map((item) => item.name).join(", ")],
      ],
      raw,
      [refId(result.container_ref)],
    );
  });

export const certificateCommand = new Command("certificate")
  .description("Load Balancer TLS 인증서(key-manager certificate 컨테이너) 조회·업로드")
  .addCommand(listCommand)
  .addCommand(getCommand)
  .addCommand(uploadCommand);
