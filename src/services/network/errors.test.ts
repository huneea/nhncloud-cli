import { describe, expect, it } from "vitest";
import { HTTPError } from "ky";
import { toNhnCloudCliError } from "../../api/httpError.js";
import { EXIT_API_ERROR, EXIT_AUTH_ERROR } from "../../utils/exit-codes.js";
import { toNetworkWriteError } from "./errors.js";

function makeHttpError(status: number, body?: string): HTTPError {
  const response = new Response(body, { status });
  return new HTTPError(response, new Request("https://example.com/v2.0/security-group-rules"), {} as never);
}

function neutron(message: string): string {
  return JSON.stringify({ NeutronError: { message, type: "SecurityGroupRuleInvalid", detail: "" } });
}

const REASON = "Only remote_ip_prefix or remote_group_id may be provided.";

describe("toNetworkWriteError", () => {
  it("400 응답의 서버 거부 사유를 붙이고 API 오류 종료 코드를 유지한다", async () => {
    const result = await toNetworkWriteError(makeHttpError(400, neutron(REASON)));
    expect(result.message).toContain(`서버 응답: ${REASON}`);
    expect(result.exitCode).toBe(EXIT_API_ERROR);
  });

  it("409 응답도 서버 거부 사유를 붙인다", async () => {
    const result = await toNetworkWriteError(makeHttpError(409, neutron("Security group is in use.")));
    expect(result.message).toContain("서버 응답: Security group is in use.");
    expect(result.exitCode).toBe(EXIT_API_ERROR);
  });

  it("404 응답은 본문에 message가 있어도 공용 변환 결과를 그대로 쓴다", async () => {
    const err = makeHttpError(404, neutron("Security group rule does not exist."));
    const result = await toNetworkWriteError(err);
    expect(result.message).toBe(toNhnCloudCliError(makeHttpError(404)).message);
    expect(result.message).not.toContain("서버 응답:");
  });

  it("403 응답은 인증 오류 종료 코드를 유지한다", async () => {
    const result = await toNetworkWriteError(makeHttpError(403, neutron(REASON)));
    expect(result.exitCode).toBe(EXIT_AUTH_ERROR);
    expect(result.message).not.toContain("서버 응답:");
  });

  it.each([
    ["JSON이 아닌 본문", "not-json"],
    ["NeutronError가 없는 본문", JSON.stringify({ other: 1 })],
    ["message가 문자열이 아닌 본문", JSON.stringify({ NeutronError: { message: 3 } })],
  ])("400 %s이면 공용 변환 결과와 같다", async (_name, body) => {
    const result = await toNetworkWriteError(makeHttpError(400, body));
    expect(result.message).toBe(toNhnCloudCliError(makeHttpError(400)).message);
  });

  it("message 안의 ANSI escape를 ?로 바꾼다", async () => {
    const result = await toNetworkWriteError(makeHttpError(400, neutron("bad \u001b[31mred")));
    expect(result.message).not.toContain("\u001b");
    expect(result.message).toContain("?[31m");
  });
});
