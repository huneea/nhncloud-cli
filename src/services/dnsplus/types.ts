/** DNS Plus API v1.0 응답 타입과 타입 가드 (ADR-049). */

export type DnsplusRecordsetType = "A" | "CNAME" | "TXT";

export interface DnsplusZone {
  engineId: string;
  zoneId: string;
  zoneName: string;
  zoneStatus: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  recordsetCount?: number;
}

export interface DnsplusRecord {
  recordDisabled: boolean;
  recordContent: string;
}

export interface DnsplusRecordset {
  recordsetId: string;
  recordsetName: string;
  recordsetType: string;
  recordsetTtl: number;
  recordsetStatus?: string;
  createdAt?: string;
  updatedAt?: string;
  recordList: DnsplusRecord[];
}

export interface DnsplusRecordsetCreateInput {
  recordsetName: string;
  recordsetType: DnsplusRecordsetType;
  recordsetTtl: number;
  recordList: DnsplusRecord[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

export function isDnsplusZone(value: unknown): value is DnsplusZone {
  return (
    isRecord(value) &&
    typeof value["zoneId"] === "string" &&
    typeof value["zoneName"] === "string" &&
    typeof value["zoneStatus"] === "string" &&
    typeof value["engineId"] === "string" &&
    optionalString(value["description"]) &&
    optionalString(value["createdAt"]) &&
    optionalString(value["updatedAt"]) &&
    (value["recordsetCount"] === undefined || typeof value["recordsetCount"] === "number")
  );
}

export function isDnsplusRecord(value: unknown): value is DnsplusRecord {
  return isRecord(value) && typeof value["recordDisabled"] === "boolean" && typeof value["recordContent"] === "string";
}

export function isDnsplusRecordset(value: unknown): value is DnsplusRecordset {
  return (
    isRecord(value) &&
    typeof value["recordsetId"] === "string" &&
    typeof value["recordsetName"] === "string" &&
    typeof value["recordsetType"] === "string" &&
    typeof value["recordsetTtl"] === "number" &&
    optionalString(value["recordsetStatus"]) &&
    optionalString(value["createdAt"]) &&
    optionalString(value["updatedAt"]) &&
    Array.isArray(value["recordList"]) &&
    value["recordList"].every(isDnsplusRecord)
  );
}
