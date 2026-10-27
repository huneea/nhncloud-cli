import ky, { HTTPError } from "ky";
import { toNhnCloudCliError } from "../../api/httpError.js";
import { DEFAULT_TIMEOUT_MS } from "../../api/timeout.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR, EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";

// key-manager(OpenStack Barbican) 의 시크릿과 certificate 컨테이너로 Load Balancer TLS 인증서를 다룬다 (ADR-048).

export type CertificateSecretName = "certificate" | "private_key" | "intermediates";

export interface ContainerSecretRef {
  name: string;
  secret_ref: string;
}

export interface CertificateContainer {
  container_ref: string;
  name: string | null;
  type: string;
  status: string;
  secret_refs: ContainerSecretRef[];
  common_name?: string | null;
  expiration?: string | null;
  created?: string;
  updated?: string;
  consumers?: { name: string; URL: string }[];
}

export interface CreateSecretInput {
  name: string;
  secret_type: "certificate" | "private";
  payload: string;
  payload_content_type: "text/plain";
}

export interface CreateContainerInput {
  type: "certificate";
  name: string;
  secret_refs: ContainerSecretRef[];
}

/** 목록 한 번에 받을 개수. 문서 기본값 10 은 페이지 이동이 잦다. */
const CONTAINER_PAGE_LIMIT = 100;
/** `next` 가 끝없이 이어지는 응답을 막는 상한. 100개씩 10만 개다. */
const CONTAINER_MAX_PAGES = 1000;

/**
 * key-manager 요청 실패. `outcomeKnown` 이 false 면 서버가 요청을 처리했는지 모른다
 * (시간 초과, 연결 오류, 응답 해석 실패). 쓰기 되돌리기가 이 값을 본다 (ADR-048).
 */
export class KeyManagerError extends NhnCloudCliError {
  constructor(
    message: string,
    exitCode: number,
    public readonly outcomeKnown: boolean,
  ) {
    super(message, exitCode);
    this.name = "KeyManagerError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isContainerSecretRef(value: unknown): value is ContainerSecretRef {
  return (
    isRecord(value) &&
    typeof value["name"] === "string" &&
    typeof value["secret_ref"] === "string"
  );
}

export function isCertificateContainer(value: unknown): value is CertificateContainer {
  if (!isRecord(value)) return false;
  return (
    typeof value["container_ref"] === "string" &&
    value["container_ref"].length > 0 &&
    (value["name"] === null || typeof value["name"] === "string") &&
    typeof value["type"] === "string" &&
    typeof value["status"] === "string" &&
    Array.isArray(value["secret_refs"]) &&
    value["secret_refs"].every(isContainerSecretRef)
  );
}

/** `.../v1/containers/<id>` 와 `.../v1/secrets/<id>` 주소의 마지막 경로 조각을 ID 로 쓴다. */
export function refId(ref: string): string {
  const trimmed = ref.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1);
}

function requireRef(raw: unknown, key: "secret_ref" | "container_ref", command: string): string {
  if (!isRecord(raw) || typeof raw[key] !== "string" || raw[key].length === 0) {
    // 2xx 응답이라 서버에는 만들어졌을 수 있다.
    throw new KeyManagerError(
      `${command} 응답 형식이 올바르지 않습니다 — ${key} 가 없습니다.`,
      EXIT_API_ERROR,
      false,
    );
  }
  return raw[key];
}

/** key-manager 403 은 IAM 계정의 key-manager 권한 부족이다 (ADR-048 실측). */
function toCertificateError(error: unknown): KeyManagerError {
  if (error instanceof KeyManagerError) return error;
  const converted = toNhnCloudCliError(error);
  const responded = error instanceof HTTPError;
  const hint =
    responded && error.response.status === 403
      ? " — key-manager 권한이 없습니다. IAM 계정에 Load Balancer 인증서(key-manager) 권한이 있는지 확인하세요."
      : "";
  return new KeyManagerError(`${converted.message}${hint}`, converted.exitCode, responded);
}

export class CertificateClient {
  private readonly tokenId: string;
  private readonly endpoint: string;

  constructor(tokenId: string, keyManagerEndpoint: string) {
    this.tokenId = tokenId;
    this.endpoint = keyManagerEndpoint;
  }

  /** `/containers` 를 끝까지 넘기며 certificate 타입 컨테이너만 돌려준다. */
  async listCertificateContainers(): Promise<CertificateContainer[]> {
    const containers: CertificateContainer[] = [];
    let offset = 0;
    for (let pageCount = 0; pageCount < CONTAINER_MAX_PAGES; pageCount += 1) {
      const raw = await this.request("get", "/containers", {
        searchParams: { limit: String(CONTAINER_PAGE_LIMIT), offset: String(offset) },
      });
      if (!isRecord(raw) || !Array.isArray(raw["containers"])) {
        throw new NhnCloudCliError(
          "loadbalancer certificate list 응답 형식이 올바르지 않습니다 — containers 배열이 없습니다.",
          EXIT_API_ERROR,
        );
      }
      const page = raw["containers"];
      if (!page.every(isCertificateContainer)) {
        throw new NhnCloudCliError(
          "loadbalancer certificate list 응답의 컨테이너 항목 형식이 예상과 다릅니다 — API 응답 필드를 확인하세요.",
          EXIT_API_ERROR,
        );
      }
      containers.push(...page.filter((item) => item.type === "certificate"));
      // 서버가 limit 를 줄여 잘라도 next 가 있으면 이어서 받는다.
      if (typeof raw["next"] !== "string" || page.length === 0) return containers;
      offset += page.length;
    }
    throw new NhnCloudCliError(
      `loadbalancer certificate list 가 ${CONTAINER_MAX_PAGES}페이지를 넘었습니다 — 응답의 next 가 끝나지 않습니다.`,
      EXIT_API_ERROR,
    );
  }

  async getContainer(id: string): Promise<CertificateContainer> {
    const normalized = id.trim();
    if (!normalized) {
      throw new NhnCloudCliError("인증서 컨테이너 ID가 필요합니다.", EXIT_PARAM_ERROR);
    }
    const raw = await this.request("get", `/containers/${encodeURIComponent(normalized)}`);
    if (!isCertificateContainer(raw)) {
      throw new NhnCloudCliError(
        "loadbalancer certificate get 응답의 컨테이너 형식이 예상과 다릅니다 — API 응답 필드를 확인하세요.",
        EXIT_API_ERROR,
      );
    }
    return raw;
  }

  async createSecret(input: CreateSecretInput): Promise<string> {
    const raw = await this.request("post", "/secrets", { json: input });
    return requireRef(raw, "secret_ref", "loadbalancer certificate upload 시크릿 생성");
  }

  async deleteSecret(secretRef: string): Promise<void> {
    await this.request("delete", `/secrets/${encodeURIComponent(refId(secretRef))}`);
  }

  async createContainer(input: CreateContainerInput): Promise<string> {
    const raw = await this.request("post", "/containers", { json: input });
    return requireRef(raw, "container_ref", "loadbalancer certificate upload 컨테이너 생성");
  }

  private async request(
    method: "get" | "post" | "delete",
    path: string,
    options: { json?: unknown; searchParams?: Record<string, string> } = {},
  ): Promise<unknown> {
    try {
      const response = await ky(`${this.endpoint}${path}`, {
        method,
        headers: { "X-Auth-Token": this.tokenId },
        ...options,
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      if (method === "delete") return undefined;
      try {
        return await response.json();
      } catch (error) {
        throw new KeyManagerError(
          `key-manager 응답을 JSON 으로 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
          EXIT_API_ERROR,
          false,
        );
      }
    } catch (error) {
      throw toCertificateError(error);
    }
  }
}
