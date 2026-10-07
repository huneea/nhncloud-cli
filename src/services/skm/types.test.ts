import { describe, expect, it } from "vitest";
import {
  isSkmAsymmetricKeyMaterial,
  isSkmAuthDetail,
  isSkmClientInfo,
  isSkmDecryptResult,
  isSkmEncryptResult,
  isSkmKey,
  isSkmKeyStore,
  isSkmLocalKey,
  isSkmSignResult,
  isSkmStandardSignResult,
  isSkmSymmetricKey,
  isSkmVerifyResult,
} from "./types.js";

// 공식 API v1.3 가이드의 응답 예시에서 식별자와 비밀값을 placeholder 로 바꾼 값이다.
const audit = {
  creationUser: "SECURE_KEY_MANAGER",
  creationDatetime: "2025-01-25T12:00:00",
  lastChangeUser: "SECURE_KEY_MANAGER",
  lastChangeDatetime: "2025-01-30T15:00:00.000",
};

const keyStore = {
  keyStoreId: 1,
  name: "키 저장소 이름",
  description: "키 저장소 설명",
  ip4AuthUse: "Y",
  macAuthUse: "N",
  certificateAuthUse: "Y",
  ...audit,
};

const key = {
  keyId: "<key-id>",
  name: "키 이름",
  description: "키 설명",
  keyType: "SYMMETRIC_KEY",
  currentKeyValueVersion: 2,
  autoRotationPeriod: 0,
  nextAutoRotationDate: null,
  lastAccessDatetime: "2025-02-10T15:13:13.377",
  deletionDatetime: null,
  ...audit,
};

const ipv4Auth = {
  value: "192.0.2.1",
  description: "IPv4 설명",
  lastAccessDatetime: "2025-01-25T13:00:00",
  deletionDatetime: null,
  ...audit,
};

const certificateAuth = {
  name: "<certificate-name>",
  password: "<certificate-password>",
  description: "인증서 설명",
  expirationDate: "2029-07-21T10:26:47",
  lastAccessDatetime: "2025-01-25T13:00:00",
  deletionDatetime: null,
  ...audit,
};

const asymmetricKey = {
  keyType: "PrivateKey",
  key: "0x30, 0x82",
  encodedKey: "<encoded-key>",
  standardEncodedKey: "<standard-encoded-key>",
  keyVersion: 1,
};

describe("SKM 응답 가드: 공식 예시 통과", () => {
  it.each([
    ["isSkmClientInfo", isSkmClientInfo, { clientIp: "192.0.2.1", clientMacHeader: "00:00:00:00:00:00", clientSentCertificate: false }],
    ["isSkmKeyStore", isSkmKeyStore, keyStore],
    ["isSkmKey", isSkmKey, key],
    ["isSkmAuthDetail(IPv4)", isSkmAuthDetail, ipv4Auth],
    ["isSkmAuthDetail(인증서)", isSkmAuthDetail, certificateAuth],
    ["isSkmEncryptResult", isSkmEncryptResult, { ciphertext: "<ciphertext>", keyVersion: 1 }],
    ["isSkmDecryptResult", isSkmDecryptResult, { plaintext: "data", keyVersion: 1 }],
    ["isSkmLocalKey", isSkmLocalKey, { localKeyPlaintext: "<plaintext>", localKeyCiphertext: "<ciphertext>", keyVersion: 1 }],
    ["isSkmSymmetricKey", isSkmSymmetricKey, { symmetricKey: "0x00, 0x20", keyVersion: 1 }],
    ["isSkmSignResult", isSkmSignResult, { signature: "<signature>", keyVersion: 1 }],
    [
      "isSkmStandardSignResult",
      isSkmStandardSignResult,
      { signature: "<signature>", algorithm: "RSASSA-PSS", hashAlgorithm: "SHA-256", mgfAlgorithm: "MGF1-SHA-256", saltLength: 32, keyVersion: 0 },
    ],
    ["isSkmVerifyResult", isSkmVerifyResult, { result: true, keyVersion: 0 }],
    ["isSkmAsymmetricKeyMaterial", isSkmAsymmetricKeyMaterial, asymmetricKey],
  ] as const)("%s", (_name, guard, value) => {
    expect(guard(value)).toBe(true);
  });

  it("nextAutoRotationDate·deletionDatetime 이 null 인 키를 통과시킨다", () => {
    expect(isSkmKey({ ...key, nextAutoRotationDate: null, deletionDatetime: null })).toBe(true);
  });

  it("선택 필드가 모두 빠진 키 저장소와 키를 통과시킨다", () => {
    expect(isSkmKeyStore({ keyStoreId: 1, name: "키 저장소", ip4AuthUse: "Y", macAuthUse: "N", certificateAuthUse: "N" })).toBe(true);
    expect(isSkmKey({ keyId: "<key-id>", name: "키", keyType: "SECRET", currentKeyValueVersion: 1 })).toBe(true);
  });

  it("MAC 헤더 없이 호출한 confirm 응답(clientMacHeader 없음·null)을 통과시킨다", () => {
    expect(isSkmClientInfo({ clientIp: "192.0.2.1", clientSentCertificate: false })).toBe(true);
    expect(isSkmClientInfo({ clientIp: "192.0.2.1", clientMacHeader: null, clientSentCertificate: false })).toBe(true);
  });
});

describe("SKM 응답 가드: 형식 오류 거부", () => {
  it.each([
    ["clientIp 누락", isSkmClientInfo, { clientSentCertificate: false }],
    ["clientSentCertificate 문자열", isSkmClientInfo, { clientIp: "192.0.2.1", clientSentCertificate: "false" }],
    ["clientMacHeader 숫자", isSkmClientInfo, { clientIp: "192.0.2.1", clientMacHeader: 1, clientSentCertificate: false }],
    ["keyStoreId 문자열", isSkmKeyStore, { ...keyStore, keyStoreId: "1" }],
    ["ip4AuthUse 누락", isSkmKeyStore, { ...keyStore, ip4AuthUse: undefined }],
    ["description 숫자", isSkmKeyStore, { ...keyStore, description: 1 }],
    ["keyId 누락", isSkmKey, { ...key, keyId: undefined }],
    ["currentKeyValueVersion 문자열", isSkmKey, { ...key, currentKeyValueVersion: "2" }],
    ["autoRotationPeriod 문자열", isSkmKey, { ...key, autoRotationPeriod: "0" }],
    ["value·name 모두 없음", isSkmAuthDetail, { description: "설명" }],
    ["value·name 모두 null", isSkmAuthDetail, { value: null, name: null }],
    ["password 숫자", isSkmAuthDetail, { ...certificateAuth, password: 1 }],
    ["ciphertext 누락", isSkmEncryptResult, { keyVersion: 1 }],
    ["plaintext 숫자", isSkmDecryptResult, { plaintext: 1, keyVersion: 1 }],
    ["localKeyCiphertext 누락", isSkmLocalKey, { localKeyPlaintext: "<plaintext>", keyVersion: 1 }],
    ["symmetricKey 누락", isSkmSymmetricKey, { keyVersion: 1 }],
    ["keyVersion 문자열", isSkmSignResult, { signature: "<signature>", keyVersion: "1" }],
    ["saltLength 누락", isSkmStandardSignResult, { signature: "<signature>", algorithm: "RSASSA-PSS", hashAlgorithm: "SHA-256", mgfAlgorithm: "MGF1-SHA-256", keyVersion: 0 }],
    ["result 문자열", isSkmVerifyResult, { result: "true", keyVersion: 0 }],
    ["encodedKey 누락", isSkmAsymmetricKeyMaterial, { ...asymmetricKey, encodedKey: undefined }],
    ["standardEncodedKey 숫자", isSkmAsymmetricKeyMaterial, { ...asymmetricKey, standardEncodedKey: 1 }],
    ["null", isSkmKey, null],
    ["배열", isSkmKeyStore, [keyStore]],
  ] as const)("%s", (_name, guard, value) => {
    expect(guard(value)).toBe(false);
  });
});
