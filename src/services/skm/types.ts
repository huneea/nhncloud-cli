/**
 * Secure Key Manager API v1.3 응답 타입 (ADR-039).
 * 일반망과 공공망 응답 형식이 같다.
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
  standardEncodedKey: string;
  keyVersion: number;
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
    hasStrings(value, ["keyType", "key", "encodedKey", "standardEncodedKey"]) &&
    hasNumbers(value, ["keyVersion"])
  );
}
