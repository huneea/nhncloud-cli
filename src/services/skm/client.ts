import ky, { HTTPError } from "ky";
import { endpointFor } from "../../api/endpoints.js";
import { unwrap, unwrapHeader, type NhnEnvelope } from "../../api/envelope.js";
import { toNhnCloudCliError } from "../../api/httpError.js";
import { DEFAULT_TIMEOUT_MS } from "../../api/timeout.js";
import type { CloudEnvironment } from "../../config/types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR, EXIT_AUTH_ERROR } from "../../utils/exit-codes.js";
import { sanitizeForTerminal } from "../../utils/terminal.js";
import {
  isSkmAsymmetricKeyMaterial,
  isSkmAuthAdded,
  isSkmAuthDeletion,
  isSkmAuthDetail,
  isSkmClientInfo,
  isSkmCreatedKey,
  isSkmCreatedKeyStore,
  isSkmDecryptResult,
  isSkmDeletion,
  isSkmEncryptResult,
  isSkmKey,
  isSkmKeyStore,
  isSkmLocalKey,
  isSkmSignResult,
  isSkmStandardSignResult,
  isSkmSymmetricKey,
  isSkmUpdatedSecret,
  isSkmVerifyResult,
  type SkmAsymmetricKeyMaterial,
  type SkmAuthAdded,
  type SkmAuthDeletion,
  type SkmAuthDetail,
  type SkmAuthType,
  type SkmClientInfo,
  type SkmCreatedKey,
  type SkmCreatedKeyStore,
  type SkmDecryptResult,
  type SkmDeletion,
  type SkmEncryptResult,
  type SkmKey,
  type SkmKeyStatusFilter,
  type SkmKeyStore,
  type SkmKeyStoreInput,
  type SkmKeyType,
  type SkmLocalKey,
  type SkmSignResult,
  type SkmStandardSignResult,
  type SkmSymmetricKey,
  type SkmUpdatedSecret,
  type SkmVerifyResult,
} from "./types.js";

/** 키 목록 응답에는 전체 개수가 없어, 받은 개수가 이 값보다 적으면 마지막 페이지로 본다. */
const KEY_PAGE_SIZE = 100;

/** RSASSA-PSS 표준 서명·검증 API 의 algorithm 값. */
const STANDARD_SIGN_ALGORITHM = "RSASSA-PSS";

const AUTH_PATHS: Record<SkmAuthType, { path: string; field: string }> = {
  ipv4: { path: "ips", field: "ipv4List" },
  mac: { path: "macs", field: "macList" },
  certificate: { path: "certificates", field: "certificateList" },
};

/** 인증 정보 쓰기 API 경로 조각. 조회 API 의 IPv4 경로(ips)와 이름이 다르다. */
const AUTH_WRITE_PATH: Record<SkmAuthType, string> = {
  ipv4: "ipv4s",
  mac: "macs",
  certificate: "certificates",
};

type HttpMethod = "get" | "post" | "put" | "delete";

type Guard<T> = (value: unknown) => value is T;

interface RequestOptions {
  searchParams?: Record<string, string | number>;
  json?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** 성공 판정에 쓰는 header.isSuccessful 이 있는 봉투인지 검사한다 (ADR-006). */
function isEnvelope(value: unknown): value is NhnEnvelope<unknown> {
  if (!isRecord(value)) return false;
  const header = value["header"];
  return isRecord(header) && typeof header["isSuccessful"] === "boolean";
}

function arrayOf<T>(guard: Guard<T>): Guard<T[]> {
  return (value: unknown): value is T[] => Array.isArray(value) && value.every(guard);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** description 이 없으면 빈 문자열 대신 요청 본문에서 키를 뺀다. */
function withDescription(body: Record<string, unknown>, description: string | undefined): Record<string, unknown> {
  return description === undefined ? body : { ...body, description };
}

/** 인증서 삭제 API 는 대상을 name, IPv4·MAC 삭제 API 는 value 로 받는다. */
function authDeletionBody(type: SkmAuthType, keyStoreName: string, value: string): Record<string, unknown> {
  return type === "certificate" ? { keyStoreName, name: value } : { keyStoreName, value };
}

function keyStoreBody(input: SkmKeyStoreInput): Record<string, unknown> {
  const { name, description, ip4AuthUse, macAuthUse, certificateAuthUse, authMode } = input;
  return withDescription({ name, ip4AuthUse, macAuthUse, certificateAuthUse, authMode }, description);
}

function keyVersionParams(keyVersion: number | undefined): RequestOptions {
  return keyVersion === undefined ? {} : { searchParams: { keyVersion } };
}

/**
 * HTTP 4xx·5xx 응답 본문에 봉투가 있으면 header.resultMessage 를 담아 변환한다.
 * 본문이 JSON 이 아니거나 봉투가 아니면 공용 변환 결과를 쓴다.
 */
async function toSkmError(err: unknown): Promise<NhnCloudCliError> {
  if (!(err instanceof HTTPError)) return toNhnCloudCliError(err);

  let resultMessage: string | null = null;
  try {
    const body: unknown = await err.response.clone().json();
    const header = isRecord(body) ? body["header"] : undefined;
    const message = isRecord(header) ? header["resultMessage"] : undefined;
    if (typeof message === "string") resultMessage = message;
  } catch {
    // 본문이 비어 있거나 JSON 이 아니면 공용 변환 결과를 쓴다.
  }
  if (resultMessage === null) return toNhnCloudCliError(err);

  const status = err.response.status;
  return new NhnCloudCliError(
    `API 호출 실패 (${status}): ${sanitizeForTerminal(resultMessage)}`,
    status === 401 || status === 403 ? EXIT_AUTH_ERROR : EXIT_API_ERROR,
  );
}

/**
 * Secure Key Manager API v1.3 클라이언트 (ADR-039).
 * 인증은 URL 의 appkey 와 공통 UAK OAuth 토큰이다. 비밀값 가리기는 출력 단계가 맡으므로 응답을 그대로 반환한다.
 */
export class SkmClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(accessToken: string, environment: CloudEnvironment, appKey: string, macAddress?: string) {
    this.baseUrl = `${endpointFor("skm", environment)}/keymanager/v1.3/appkey/${encodeURIComponent(appKey)}`;
    this.headers = { "X-NHN-Authorization": `Bearer ${accessToken}` };
    if (macAddress !== undefined) {
      this.headers["X-TOAST-CLIENT-MAC-ADDR"] = macAddress;
    }
  }

  /**
   * 요청을 보내고 봉투 형태인지만 확인해 반환한다. 성공 판정은 호출부가 한다.
   * 쓰기 요청도 중복 실행을 막으려고 재시도하지 않는다.
   */
  private async send(method: HttpMethod, path: string, options: RequestOptions): Promise<NhnEnvelope<unknown>> {
    let response: unknown;
    try {
      response = await ky[method](`${this.baseUrl}${path}`, {
        headers: this.headers,
        ...options,
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      }).json<unknown>();
    } catch (err) {
      throw await toSkmError(err);
    }

    if (!isEnvelope(response)) {
      throw new NhnCloudCliError("Secure Key Manager 응답 형식 오류: header", EXIT_API_ERROR);
    }
    return response;
  }

  /**
   * 요청을 보내고 봉투를 벗긴 뒤 body 또는 body[field] 를 가드로 검사해 반환한다.
   * field 가 null 이면 body 전체를 검사한다.
   */
  private async request<T>(
    method: HttpMethod,
    path: string,
    field: string | null,
    guard: Guard<T>,
    options: RequestOptions = {},
  ): Promise<T> {
    const body = unwrap(await this.send(method, path, options));
    const value = field === null ? body : isRecord(body) ? body[field] : undefined;
    if (!guard(value)) {
      throw new NhnCloudCliError(`Secure Key Manager 응답 형식 오류: ${field ?? "body"}`, EXIT_API_ERROR);
    }
    return value;
  }

  /**
   * body 가 null 이거나 없는 응답(키 저장소 수정·삭제)은 검사할 필드가 없어 헤더만 본다 (ADR-040).
   * isSuccessful 이 false 면 unwrapHeader 가 NhnEnvelopeError 를 던진다.
   */
  private async requestHeaderOnly(method: "put" | "delete", path: string, options: RequestOptions = {}): Promise<void> {
    unwrapHeader(await this.send(method, path, options));
  }

  private keyPath(prefix: string, keyId: string, action: string): string {
    return `/${prefix}/${encodeURIComponent(keyId)}/${action}`;
  }

  /** 호출 클라이언트의 IP·MAC·인증서 전송 여부를 확인한다. */
  confirm(): Promise<SkmClientInfo> {
    return this.request("get", "/confirm", null, isSkmClientInfo);
  }

  listKeyStores(): Promise<SkmKeyStore[]> {
    return this.request("get", "/keystores", "keyStoreList", arrayOf(isSkmKeyStore), {
      searchParams: { detail: "true" },
    });
  }

  getKeyStore(keyStoreId: number): Promise<SkmKeyStore> {
    return this.request("get", `/keystores/${keyStoreId}`, null, isSkmKeyStore);
  }

  /**
   * 모든 페이지의 키를 모은다.
   * 서버가 pageNumber 를 무시하면 같은 페이지가 반복되므로, 첫 keyId 가 직전 페이지와 같으면 중단한다.
   */
  async listKeys(
    keyStoreId: number,
    filter: { type?: SkmKeyType; name?: string; status?: SkmKeyStatusFilter } = {},
  ): Promise<SkmKey[]> {
    const keys: SkmKey[] = [];
    let previousFirstKeyId: string | undefined;
    for (let pageNumber = 1; ; pageNumber++) {
      const searchParams: Record<string, string | number> = { detail: "true", pageNumber, pageSize: KEY_PAGE_SIZE };
      if (filter.type) searchParams["type"] = filter.type;
      if (filter.name) searchParams["name"] = filter.name;
      if (filter.status) searchParams["status"] = filter.status;

      const page = await this.request("get", `/keystores/${keyStoreId}/keys`, "keyList", arrayOf(isSkmKey), {
        searchParams,
      });
      const firstKeyId = page[0]?.keyId;
      if (firstKeyId !== undefined && firstKeyId === previousFirstKeyId) {
        throw new NhnCloudCliError(
          `Secure Key Manager 응답 형식 오류: ${pageNumber} 페이지가 직전 페이지와 같은 키로 시작합니다.`,
          EXIT_API_ERROR,
        );
      }
      keys.push(...page);
      if (page.length < KEY_PAGE_SIZE) return keys;
      previousFirstKeyId = firstKeyId;
    }
  }

  getKey(keyStoreId: number, keyId: string): Promise<SkmKey> {
    return this.request("get", `/keystores/${keyStoreId}/keys/${encodeURIComponent(keyId)}`, null, isSkmKey);
  }

  listAuths(keyStoreId: number, type: SkmAuthType): Promise<string[]> {
    const { path, field } = AUTH_PATHS[type];
    return this.request("get", `/keystores/${keyStoreId}/${path}`, field, arrayOf(isString));
  }

  getAuth(keyStoreId: number, type: SkmAuthType, value: string): Promise<SkmAuthDetail[]> {
    const { path, field } = AUTH_PATHS[type];
    return this.request("get", `/keystores/${keyStoreId}/${path}`, field, arrayOf(isSkmAuthDetail), {
      searchParams: { value },
    });
  }

  getSecret(keyId: string): Promise<string> {
    return this.request("get", `/secrets/${encodeURIComponent(keyId)}`, "secret", isString);
  }

  encrypt(keyId: string, plaintext: string): Promise<SkmEncryptResult> {
    return this.request("post", this.keyPath("symmetric-keys", keyId, "encrypt"), null, isSkmEncryptResult, {
      json: { plaintext },
    });
  }

  decrypt(keyId: string, ciphertext: string): Promise<SkmDecryptResult> {
    return this.request("post", this.keyPath("symmetric-keys", keyId, "decrypt"), null, isSkmDecryptResult, {
      json: { ciphertext },
    });
  }

  createLocalKey(keyId: string): Promise<SkmLocalKey> {
    return this.request("post", this.keyPath("symmetric-keys", keyId, "create-local-key"), null, isSkmLocalKey);
  }

  getSymmetricKey(keyId: string, keyVersion?: number): Promise<SkmSymmetricKey> {
    return this.request(
      "get",
      this.keyPath("symmetric-keys", keyId, "symmetric-key"),
      null,
      isSkmSymmetricKey,
      keyVersionParams(keyVersion),
    );
  }

  sign(keyId: string, plaintext: string): Promise<SkmSignResult> {
    return this.request("post", this.keyPath("asymmetric-keys", keyId, "sign"), null, isSkmSignResult, {
      json: { plaintext },
    });
  }

  verify(keyId: string, plaintext: string, signature: string): Promise<SkmVerifyResult> {
    return this.request("post", this.keyPath("asymmetric-keys", keyId, "verify"), null, isSkmVerifyResult, {
      json: { plaintext, signature },
    });
  }

  signStandard(keyId: string, plaintextBase64: string): Promise<SkmStandardSignResult> {
    return this.request(
      "post",
      this.keyPath("asymmetric-keys", keyId, "sign-standard"),
      null,
      isSkmStandardSignResult,
      { json: { plaintext: plaintextBase64, algorithm: STANDARD_SIGN_ALGORITHM } },
    );
  }

  verifyStandard(
    keyId: string,
    plaintextBase64: string,
    signature: string,
    keyVersion: number,
  ): Promise<SkmVerifyResult> {
    return this.request("post", this.keyPath("asymmetric-keys", keyId, "verify-standard"), null, isSkmVerifyResult, {
      json: { plaintext: plaintextBase64, signature, algorithm: STANDARD_SIGN_ALGORITHM, keyVersion },
    });
  }

  getPrivateKey(keyId: string, keyVersion?: number): Promise<SkmAsymmetricKeyMaterial> {
    return this.request(
      "get",
      this.keyPath("asymmetric-keys", keyId, "privateKey"),
      null,
      isSkmAsymmetricKeyMaterial,
      keyVersionParams(keyVersion),
    );
  }

  getPublicKey(keyId: string, keyVersion?: number): Promise<SkmAsymmetricKeyMaterial> {
    return this.request(
      "get",
      this.keyPath("asymmetric-keys", keyId, "publicKey"),
      null,
      isSkmAsymmetricKeyMaterial,
      keyVersionParams(keyVersion),
    );
  }

  createSecret(
    keyStoreName: string,
    name: string,
    description: string | undefined,
    secretValue: string,
  ): Promise<SkmCreatedKey> {
    return this.request("post", "/keys/secrets/create", null, isSkmCreatedKey, {
      json: withDescription({ keyStoreName, name, secretValue }, description),
    });
  }

  /** 자동 회전 주기의 단위가 문서에 없어 항상 0(자동 회전 안 함)을 보낸다 (ADR-040). */
  createSymmetricKey(keyStoreName: string, name: string, description: string | undefined): Promise<SkmCreatedKey> {
    return this.request("post", "/keys/symmetric-keys/create", null, isSkmCreatedKey, {
      json: withDescription({ keyStoreName, name, autoRotationPeriod: 0 }, description),
    });
  }

  /** 자동 회전 주기의 단위가 문서에 없어 항상 0(자동 회전 안 함)을 보낸다 (ADR-040). */
  createAsymmetricKey(keyStoreName: string, name: string, description: string | undefined): Promise<SkmCreatedKey> {
    return this.request("post", "/keys/asymmetric-keys/create", null, isSkmCreatedKey, {
      json: withDescription({ keyStoreName, name, autoRotationPeriod: 0 }, description),
    });
  }

  updateSecret(keyId: string, secretValue: string): Promise<SkmUpdatedSecret> {
    return this.request("put", `/secrets/${encodeURIComponent(keyId)}`, null, isSkmUpdatedSecret, {
      json: { secretValue },
    });
  }

  /** 7일 뒤 삭제를 예약한다. */
  scheduleKeyDeletion(keyId: string): Promise<SkmDeletion> {
    return this.request("put", this.keyPath("keys", keyId, "delete"), null, isSkmDeletion);
  }

  /** 삭제 예약된 키를 즉시 삭제한다. 되돌릴 수 없다. */
  deleteKeyNow(keyId: string): Promise<SkmDeletion> {
    return this.request("delete", `/keys/${encodeURIComponent(keyId)}`, null, isSkmDeletion);
  }

  createKeyStore(input: SkmKeyStoreInput): Promise<SkmCreatedKeyStore> {
    return this.request("post", "/keystores", null, isSkmCreatedKeyStore, { json: keyStoreBody(input) });
  }

  /** 전체 교체 API 라 주지 않은 값은 호출부가 현재 값으로 채워 넘긴다 (ADR-040). */
  updateKeyStore(keyStoreId: number, input: SkmKeyStoreInput): Promise<void> {
    return this.requestHeaderOnly("put", `/keystores/${keyStoreId}`, { json: keyStoreBody(input) });
  }

  deleteKeyStore(keyStoreId: number): Promise<void> {
    return this.requestHeaderOnly("delete", `/keystores/${keyStoreId}`);
  }

  addAuth(
    type: "ipv4" | "mac",
    keyStoreName: string,
    value: string,
    description: string | undefined,
  ): Promise<SkmAuthAdded> {
    return this.request("post", `/auths/${AUTH_WRITE_PATH[type]}`, null, isSkmAuthAdded, {
      json: withDescription({ keyStoreName, value }, description),
    });
  }

  addCertificate(
    keyStoreName: string,
    name: string,
    password: string,
    lifeTime: number,
    description: string | undefined,
  ): Promise<SkmAuthAdded> {
    return this.request("post", `/auths/${AUTH_WRITE_PATH.certificate}`, null, isSkmAuthAdded, {
      json: withDescription({ keyStoreName, name, password, lifeTime }, description),
    });
  }

  /** 7일 뒤 삭제를 예약한다. */
  scheduleAuthDeletion(type: SkmAuthType, keyStoreName: string, value: string): Promise<SkmAuthDeletion> {
    return this.request("put", `/auths/${AUTH_WRITE_PATH[type]}/delete`, null, isSkmAuthDeletion, {
      json: authDeletionBody(type, keyStoreName, value),
    });
  }

  /** 삭제 예약된 인증 정보를 즉시 삭제한다. 되돌릴 수 없다. */
  deleteAuthNow(type: SkmAuthType, keyStoreName: string, value: string): Promise<SkmAuthDeletion> {
    return this.request("post", `/auths/${AUTH_WRITE_PATH[type]}/delete`, null, isSkmAuthDeletion, {
      json: authDeletionBody(type, keyStoreName, value),
    });
  }
}
