/**
 * Secure Key Manager API v1.3 응답 타입 (ADR-039).
 * 일반망과 공공망 응답 형식이 같다. 비대칭키 조회의 standardEncodedKey 만 공공망 문서에 있다.
 */

export type SkmKeyType = "SECRET" | "SYMMETRIC_KEY" | "ASYMMETRIC_KEY";
export type SkmKeyStatusFilter = "active" | "inactive";
export type SkmAuthType = "ipv4" | "mac" | "certificate";

export interface SkmClientInfo {
  clientIp: string;
  /** MAC 헤더 없이 호출하면 빠지거나 null 이다. */
  clientMacHeader?: string | null;
  clientSentCertificate: boolean;
}

export interface SkmKeyStore {
  keyStoreId: number;
  name: string;
  description?: string | null;
  ip4AuthUse: string;
  macAuthUse: string;
  certificateAuthUse: string;
  creationUser?: string | null;
  creationDatetime?: string | null;
  lastChangeUser?: string | null;
  lastChangeDatetime?: string | null;
}

export interface SkmKey {
  keyId: string;
  name: string;
  description?: string | null;
  keyType: string;
  currentKeyValueVersion: number;
  autoRotationPeriod?: number | null;
  nextAutoRotationDate?: string | null;
  lastAccessDatetime?: string | null;
  deletionDatetime?: string | null;
  creationUser?: string | null;
  creationDatetime?: string | null;
  lastChangeUser?: string | null;
  lastChangeDatetime?: string | null;
}

/** IPv4·MAC 인증 정보는 value, 인증서 인증 정보는 name 을 쓴다. */
export interface SkmAuthDetail {
  value?: string;
  name?: string;
  password?: string | null;
  description?: string | null;
  expirationDate?: string | null;
  lastAccessDatetime?: string | null;
  deletionDatetime?: string | null;
  creationUser?: string | null;
  creationDatetime?: string | null;
  lastChangeUser?: string | null;
  lastChangeDatetime?: string | null;
}

export interface SkmEncryptResult {
  ciphertext: string;
  keyVersion: number;
}

export interface SkmDecryptResult {
  plaintext: string;
  keyVersion: number;
}

export interface SkmLocalKey {
  localKeyPlaintext: string;
  localKeyCiphertext: string;
  keyVersion: number;
}

export interface SkmSymmetricKey {
  symmetricKey: string;
  keyVersion: number;
}

export interface SkmSignResult {
  signature: string;
  keyVersion: number;
}

export interface SkmStandardSignResult extends SkmSignResult {
  algorithm: string;
  hashAlgorithm: string;
  mgfAlgorithm: string;
  saltLength: number;
}

export interface SkmVerifyResult {
  result: boolean;
  keyVersion: number;
}

export interface SkmAsymmetricKeyMaterial {
  keyType: string;
  key: string;
  encodedKey: string;
  /** PKCS#8 형식. 공공망 문서에만 있고 일반망 문서의 응답에는 없다. */
  standardEncodedKey?: string | null;
  keyVersion: number;
}

export type SkmAuthMode = "AND" | "OR";

/** 키 저장소 생성·수정 요청 본문이다. 수정 API 는 전체 교체라 모든 값을 보낸다 (ADR-040). */
export interface SkmKeyStoreInput {
  name: string;
  description?: string;
  ip4AuthUse: "Y" | "N";
  macAuthUse: "Y" | "N";
  certificateAuthUse: "Y" | "N";
  authMode: SkmAuthMode;
}

export interface SkmCreatedKey {
  keyId: string;
  keyStatus: string;
}

export interface SkmCreatedKeyStore {
  keyStoreId: number;
  name: string;
  description?: string | null;
  ip4AuthUse: string;
  macAuthUse: string;
  certificateAuthUse: string;
  authMode?: string | null;
}

/** 기밀 데이터 수정 응답이다. secretValue 를 출력에서 빼는 일은 명령이 맡는다 (ADR-040). */
export interface SkmUpdatedSecret {
  keyId: string;
  name: string;
  description?: string | null;
  secretValue?: string | null;
  creationUser?: string | null;
  creationDatetime?: string | null;
  lastChangeUser?: string | null;
  lastChangeDatetime?: string | null;
}

export interface SkmDeletion {
  keyId: string;
  deletionDateTime: string;
}

/** IPv4·MAC 등록 응답은 value, 인증서 등록 응답은 name 을 쓴다. */
export interface SkmAuthAdded {
  value?: string | null;
  name?: string | null;
  description?: string | null;
}

/** IPv4·MAC 삭제 응답은 value, 인증서 삭제 응답은 name 을 쓴다. */
export interface SkmAuthDeletion {
  value?: string | null;
  name?: string | null;
  deletionDateTime: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasStrings(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => typeof obj[key] === "string");
}

function hasNumbers(obj: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => typeof obj[key] === "number");
}

/** 선택 필드는 없거나 null 이거나 선언 타입이어야 한다. */
function hasOptional(
  obj: Record<string, unknown>,
  keys: readonly string[],
  type: "string" | "number",
): boolean {
  return keys.every((key) => obj[key] === undefined || obj[key] === null || typeof obj[key] === type);
}

const AUDIT_FIELDS = ["creationUser", "creationDatetime", "lastChangeUser", "lastChangeDatetime"] as const;

export function isSkmClientInfo(value: unknown): value is SkmClientInfo {
  if (!isRecord(value)) return false;
  return (
    typeof value["clientIp"] === "string" &&
    typeof value["clientSentCertificate"] === "boolean" &&
    hasOptional(value, ["clientMacHeader"], "string")
  );
}

export function isSkmKeyStore(value: unknown): value is SkmKeyStore {
  if (!isRecord(value)) return false;
  return (
    typeof value["keyStoreId"] === "number" &&
    hasStrings(value, ["name", "ip4AuthUse", "macAuthUse", "certificateAuthUse"]) &&
    hasOptional(value, ["description", ...AUDIT_FIELDS], "string")
  );
}

export function isSkmKey(value: unknown): value is SkmKey {
  if (!isRecord(value)) return false;
  return (
    hasStrings(value, ["keyId", "name", "keyType"]) &&
    typeof value["currentKeyValueVersion"] === "number" &&
    hasOptional(value, ["autoRotationPeriod"], "number") &&
    hasOptional(
      value,
      ["description", "nextAutoRotationDate", "lastAccessDatetime", "deletionDatetime", ...AUDIT_FIELDS],
      "string",
    )
  );
}

export function isSkmAuthDetail(value: unknown): value is SkmAuthDetail {
  if (!isRecord(value)) return false;
  return (
    (typeof value["value"] === "string" || typeof value["name"] === "string") &&
    hasOptional(
      value,
      [
        "value", "name", "password", "description", "expirationDate",
        "lastAccessDatetime", "deletionDatetime", ...AUDIT_FIELDS,
      ],
      "string",
    )
  );
}

export function isSkmEncryptResult(value: unknown): value is SkmEncryptResult {
  return isRecord(value) && hasStrings(value, ["ciphertext"]) && hasNumbers(value, ["keyVersion"]);
}

export function isSkmDecryptResult(value: unknown): value is SkmDecryptResult {
  return isRecord(value) && hasStrings(value, ["plaintext"]) && hasNumbers(value, ["keyVersion"]);
}

export function isSkmLocalKey(value: unknown): value is SkmLocalKey {
  return (
    isRecord(value) &&
    hasStrings(value, ["localKeyPlaintext", "localKeyCiphertext"]) &&
    hasNumbers(value, ["keyVersion"])
  );
}

export function isSkmSymmetricKey(value: unknown): value is SkmSymmetricKey {
  return isRecord(value) && hasStrings(value, ["symmetricKey"]) && hasNumbers(value, ["keyVersion"]);
}

export function isSkmSignResult(value: unknown): value is SkmSignResult {
  return isRecord(value) && hasStrings(value, ["signature"]) && hasNumbers(value, ["keyVersion"]);
}

export function isSkmStandardSignResult(value: unknown): value is SkmStandardSignResult {
  return (
    isRecord(value) &&
    hasStrings(value, ["signature", "algorithm", "hashAlgorithm", "mgfAlgorithm"]) &&
    hasNumbers(value, ["keyVersion", "saltLength"])
  );
}

export function isSkmVerifyResult(value: unknown): value is SkmVerifyResult {
  return isRecord(value) && typeof value["result"] === "boolean" && hasNumbers(value, ["keyVersion"]);
}

export function isSkmAsymmetricKeyMaterial(value: unknown): value is SkmAsymmetricKeyMaterial {
  return (
    isRecord(value) &&
    hasStrings(value, ["keyType", "key", "encodedKey"]) &&
    hasOptional(value, ["standardEncodedKey"], "string") &&
    hasNumbers(value, ["keyVersion"])
  );
}

export function isSkmCreatedKey(value: unknown): value is SkmCreatedKey {
  return isRecord(value) && hasStrings(value, ["keyId", "keyStatus"]);
}

export function isSkmCreatedKeyStore(value: unknown): value is SkmCreatedKeyStore {
  if (!isRecord(value)) return false;
  return (
    typeof value["keyStoreId"] === "number" &&
    hasStrings(value, ["name", "ip4AuthUse", "macAuthUse", "certificateAuthUse"]) &&
    hasOptional(value, ["description", "authMode"], "string")
  );
}

export function isSkmUpdatedSecret(value: unknown): value is SkmUpdatedSecret {
  if (!isRecord(value)) return false;
  return (
    hasStrings(value, ["keyId", "name"]) &&
    hasOptional(value, ["description", "secretValue", ...AUDIT_FIELDS], "string")
  );
}

export function isSkmDeletion(value: unknown): value is SkmDeletion {
  return isRecord(value) && hasStrings(value, ["keyId", "deletionDateTime"]);
}

/** value 와 name 중 하나는 문자열이어야 한다 (isSkmAuthDetail 과 같은 규칙). */
function hasAuthIdentifier(obj: Record<string, unknown>): boolean {
  return (
    (typeof obj["value"] === "string" || typeof obj["name"] === "string") &&
    hasOptional(obj, ["value", "name"], "string")
  );
}

export function isSkmAuthAdded(value: unknown): value is SkmAuthAdded {
  return isRecord(value) && hasAuthIdentifier(value) && hasOptional(value, ["description"], "string");
}

export function isSkmAuthDeletion(value: unknown): value is SkmAuthDeletion {
  return isRecord(value) && hasAuthIdentifier(value) && hasStrings(value, ["deletionDateTime"]);
}
