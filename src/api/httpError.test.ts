import { afterEach, describe, it, expect } from "vitest";
import { HTTPError, TimeoutError } from "ky";
import { readHttpErrorBody, toNhnCloudCliError } from "./httpError.js";
import { setRequestTimeoutMs } from "./timeout.js";
import { NhnCloudCliError } from "../utils/errors.js";
import { EXIT_API_ERROR, EXIT_AUTH_ERROR } from "../utils/exit-codes.js";

/** HTTPError 실제 인스턴스 생성 헬퍼 (instanceof 분기를 올바르게 타기 위한 필수 패턴) */
function makeHttpError(status: number): HTTPError {
  return new HTTPError(
    new Response(null, { status }),
    new Request("https://example.com"),
    {} as never,
  );
}

describe("toNhnCloudCliError", () => {
  afterEach(() => {
    setRequestTimeoutMs(30_000);
  });

  it("401 → EXIT_AUTH_ERROR", () => {
    const result = toNhnCloudCliError(makeHttpError(401));
    expect(result).toBeInstanceOf(NhnCloudCliError);
    expect(result.exitCode).toBe(EXIT_AUTH_ERROR);
  });

  it("403 → EXIT_AUTH_ERROR", () => {
    const result = toNhnCloudCliError(makeHttpError(403));
    expect(result).toBeInstanceOf(NhnCloudCliError);
    expect(result.exitCode).toBe(EXIT_AUTH_ERROR);
  });

  it("404 → EXIT_API_ERROR (AUTH 아님을 명시 — code-review-pitfalls 2-2 근거 박제)", () => {
    const result = toNhnCloudCliError(makeHttpError(404));
    expect(result).toBeInstanceOf(NhnCloudCliError);
    expect(result.exitCode).toBe(EXIT_API_ERROR);
  });

  it("500 → EXIT_API_ERROR", () => {
    const result = toNhnCloudCliError(makeHttpError(500));
    expect(result).toBeInstanceOf(NhnCloudCliError);
    expect(result.exitCode).toBe(EXIT_API_ERROR);
  });

  it("TimeoutError → 현재 상한과 조정 옵션을 안내한다", () => {
    const error = new TimeoutError(new Request("https://example.com"));
    const result = toNhnCloudCliError(error);

    expect(result.exitCode).toBe(EXIT_API_ERROR);
    expect(result.message).toContain("30초");
    expect(result.message).toContain("--request-timeout");
    expect(result.message).toContain(error.message);
  });

  it("TimeoutError 안내는 변경한 현재 상한을 반영한다", () => {
    setRequestTimeoutMs(120_000);

    const result = toNhnCloudCliError(
      new TimeoutError(new Request("https://example.com")),
    );

    expect(result.exitCode).toBe(EXIT_API_ERROR);
    expect(result.message).toContain("120초");
  });

  it("비-HTTP raw Error → NhnCloudCliError(err.message, EXIT_API_ERROR) 로 wrap (원형 보존 아님)", () => {
    const err = new Error("ECONNREFUSED");
    const result = toNhnCloudCliError(err);
    // httpError.ts:25-27 의 실제 동작: new NhnCloudCliError(err.message, EXIT_API_ERROR)
    // instanceof NhnCloudCliError 단언이 아니라 exitCode 로 고정 (HTTPError 분기를 못 타 AUTH 아닌 API_ERROR)
    expect(result.exitCode).toBe(EXIT_API_ERROR);
    expect(result.message).toBe("ECONNREFUSED");
  });

  it("이미 NhnCloudCliError 인스턴스면 그대로 passthrough (httpError.ts:12-14)", () => {
    const original = new NhnCloudCliError("already", EXIT_AUTH_ERROR);
    const result = toNhnCloudCliError(original);
    expect(result).toBe(original); // 같은 객체 참조
  });
});

describe("readHttpErrorBody", () => {
  function makeBodyError(body: string): HTTPError {
    return new HTTPError(
      new Response(body, { status: 400 }),
      new Request("https://example.com"),
      {} as never,
    );
  }

  it("JSON 본문을 객체로 돌려준다", async () => {
    expect(await readHttpErrorBody(makeBodyError('{"a":1}'))).toEqual({ a: 1 });
  });

  it("JSON 이 아닌 본문이면 undefined 를 돌려준다", async () => {
    expect(await readHttpErrorBody(makeBodyError("not json"))).toBeUndefined();
  });

  it("빈 본문이면 undefined 를 돌려준다", async () => {
    expect(await readHttpErrorBody(makeBodyError(""))).toBeUndefined();
  });

  it("같은 오류를 두 번 읽어도 두 번 다 본문을 돌려준다", async () => {
    const err = makeBodyError('{"a":1}');
    expect(await readHttpErrorBody(err)).toEqual({ a: 1 });
    expect(await readHttpErrorBody(err)).toEqual({ a: 1 });
  });
});

describe("toNhnCloudCliError 연결 실패 원인", () => {
  it("fetch 실패의 cause 메시지를 괄호로 덧붙인다", () => {
    const err = new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:9") });
    const result = toNhnCloudCliError(err);
    expect(result.message).toBe("fetch failed (connect ECONNREFUSED 127.0.0.1:9)");
    expect(result.exitCode).toBe(EXIT_API_ERROR);
  });

  it("cause 의 제어 문자를 터미널 출력 전에 치환한다", () => {
    const err = new TypeError("fetch failed", { cause: new Error("bad\x1b[31m proxy") });
    expect(toNhnCloudCliError(err).message).toBe("fetch failed (bad?[31m proxy)");
  });

  it("cause 가 없으면 메시지가 그대로다", () => {
    const result = toNhnCloudCliError(new TypeError("fetch failed"));
    expect(result.message).toBe("fetch failed");
    expect(result.exitCode).toBe(EXIT_API_ERROR);
  });

  it("cause 가 Error 가 아니면 메시지가 그대로다", () => {
    const result = toNhnCloudCliError(new TypeError("fetch failed", { cause: "ECONNREFUSED" }));
    expect(result.message).toBe("fetch failed");
  });

  it("cause 메시지가 비었거나 본 메시지와 같으면 덧붙이지 않는다", () => {
    expect(toNhnCloudCliError(new Error("x", { cause: new Error("") })).message).toBe("x");
    expect(toNhnCloudCliError(new Error("x", { cause: new Error("x") })).message).toBe("x");
  });
});
