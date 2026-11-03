import { sanitizeMultilineForTerminal } from "../../utils/terminal.js";
import { cell } from "./helpers.js";

/**
 * 배포 실행 응답의 서버별 결과.
 * taskResult 의 항목 형식은 공식 문서에 "..." 로만 있어 unknown 으로 받는다.
 */
export interface DeployServerResult {
  hostname?: unknown;
  status?: unknown;
  taskResult?: unknown;
}

export interface DeployRunEntry {
  deployKey?: unknown;
  deployStatus?: unknown;
  deployResult?: DeployServerResult[];
  deployResultLocation?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRunEntry(value: unknown): value is DeployRunEntry {
  if (!isObject(value)) return false;
  if (!("deployKey" in value) && !("deployStatus" in value)) return false;
  const servers = value["deployResult"];
  return servers === undefined || servers === null || (Array.isArray(servers) && servers.every(isObject));
}

/**
 * 배포 실행 응답 body 를 배포 단위 목록으로 바꾼다.
 * 일반 서버 그룹은 객체 하나, Autoscale 서버 그룹은 목록이다(공식 문서).
 * 모양을 알 수 없으면 undefined 를 돌려 호출부가 원본을 그대로 보이게 한다.
 */
export function normalizeRunResult(body: unknown): DeployRunEntry[] | undefined {
  const list = Array.isArray(body) ? body : [body];
  if (list.length === 0 || !list.every(isRunEntry)) return undefined;
  return list;
}

/** 문서의 deployStatus 는 success, fail, deploying 이다. 실패 계열만 true */
export function isFailedStatus(status: unknown): boolean {
  return typeof status === "string" && /^fail/i.test(status);
}

export function failedDeployKeys(entries: DeployRunEntry[]): string[] {
  return entries.filter((entry) => isFailedStatus(entry.deployStatus)).map((entry) => cell(entry.deployKey));
}

export function runResultRows(entries: DeployRunEntry[]): string[][] {
  return entries.flatMap((entry) => {
    const servers = entry.deployResult ?? [];
    if (servers.length === 0) return [[cell(entry.deployKey), cell(entry.deployStatus), "", ""]];
    return servers.map((server) => [
      cell(entry.deployKey),
      cell(entry.deployStatus),
      cell(server.hostname),
      cell(server.status),
    ]);
  });
}

function renderTask(task: unknown): string {
  const raw = typeof task === "string" ? task : JSON.stringify(task, null, 2);
  return sanitizeMultilineForTerminal(raw ?? String(task));
}

/**
 * 서버별 Task 결과를 읽을 수 있는 글로 만든다.
 * 문자열 항목은 그대로, 객체 항목은 들여쓴 JSON 으로 보인다. 형식이 문서에 없어 필드를 골라내지 않는다.
 */
export function renderTaskDetails(entries: DeployRunEntry[]): string {
  const blocks: string[] = [];
  for (const entry of entries) {
    for (const server of entry.deployResult ?? []) {
      const tasks = Array.isArray(server.taskResult) ? server.taskResult : [];
      if (tasks.length === 0) continue;
      const header = `[${cell(server.hostname) || "?"}] deployKey=${cell(entry.deployKey)} status=${cell(server.status)} 태스크 결과`;
      const body = tasks.map((task, index) => `${index + 1}. ${renderTask(task)}`).join("\n");
      blocks.push(`${header}\n${body}`);
    }
    if (entry.deployResultLocation !== undefined && entry.deployResultLocation !== null) {
      blocks.push(`콘솔 결과: ${cell(entry.deployResultLocation)}`);
    }
  }
  return blocks.length === 0 ? "" : `${blocks.join("\n\n")}\n`;
}
