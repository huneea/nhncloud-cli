/**
 * Pipeline 수동 실행 응답 body (Pipeline API v1.1).
 * 공식 문서에 필드 타입이 없어 후속 자동화가 쓰는 lastExecutionId 만 필수로 본다.
 */
export interface PipelineExecuteResult {
  appkey?: string;
  region?: string;
  pipelineName?: string;
  reason?: unknown;
  lastExecutionId: string;
}

export function isPipelineExecuteResult(value: unknown): value is PipelineExecuteResult {
  if (typeof value !== "object" || value === null) return false;
  const id = (value as Record<string, unknown>).lastExecutionId;
  return typeof id === "string" && id.length > 0;
}
