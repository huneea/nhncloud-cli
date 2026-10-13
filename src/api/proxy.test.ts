import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import ky from "ky";
import { getGlobalDispatcher, setGlobalDispatcher } from "undici";
import type { Dispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installProxy, resolveProxySettings } from "./proxy.js";
import { getAccessToken } from "./oauth.js";
import { NhnCloudCliError } from "../utils/errors.js";
import { EXIT_API_ERROR, EXIT_PARAM_ERROR } from "../utils/exit-codes.js";

/**
 * resolveProxySettings 는 src/index.ts 의 preAction 훅에서 모든 명령 앞에 불린다.
 * 그래서 잘못된 프록시 값은 HTTP 요청이 없는 명령(skills, commands, configure, doctor)도
 * 종료 코드 3으로 끝낸다. 숨은 프록시 설정이 조용히 무시되는 것보다 바로 알리는 편이 낫고,
 * 오류 문구가 옵션이나 환경변수 이름을 알려 주므로 사용자가 고칠 수 있다(ADR-044).
 */
describe("resolveProxySettings", () => {
  const proxyA = "http://proxy-a.example:3128";
  const proxyB = "http://proxy-b.example:3128";

  it("--proxy 가 환경변수보다 우선하고 noProxy 는 환경변수에서 온다", () => {
    const settings = resolveProxySettings(proxyA, {
      HTTPS_PROXY: proxyB,
      HTTP_PROXY: proxyB,
      NO_PROXY: "localhost,.internal.example",
    });
    expect(settings).toEqual({
      httpProxy: proxyA,
      httpsProxy: proxyA,
      noProxy: "localhost,.internal.example",
    });
  });

  it("소문자 환경변수가 대문자보다 우선한다", () => {
    const settings = resolveProxySettings(undefined, {
      https_proxy: proxyA,
      HTTPS_PROXY: proxyB,
      http_proxy: proxyA,
      HTTP_PROXY: proxyB,
      no_proxy: "lower.example",
      NO_PROXY: "upper.example",
    });
    expect(settings).toEqual({ httpProxy: proxyA, httpsProxy: proxyA, noProxy: "lower.example" });
  });

  it("HTTP_PROXY 만 있으면 httpProxy 만 담는다", () => {
    expect(resolveProxySettings(undefined, { HTTP_PROXY: proxyA })).toEqual({ httpProxy: proxyA });
  });

  it("빈 문자열 옵션과 빈 환경변수는 미지정이다", () => {
    expect(resolveProxySettings("", { HTTPS_PROXY: proxyA })).toEqual({ httpsProxy: proxyA });
    expect(resolveProxySettings(undefined, { https_proxy: "", HTTPS_PROXY: proxyA })).toEqual({
      httpsProxy: proxyA,
    });
    expect(resolveProxySettings("", { HTTPS_PROXY: "", HTTP_PROXY: "", NO_PROXY: "" })).toBeUndefined();
  });

  it("프록시 값이 없거나 NO_PROXY 만 있으면 undefined 다", () => {
    expect(resolveProxySettings(undefined, {})).toBeUndefined();
    expect(resolveProxySettings(undefined, { NO_PROXY: "localhost" })).toBeUndefined();
  });

  it.each([
    ["ftp://proxy.example:21"],
    ["not a url"],
  ])("--proxy %s 를 EXIT_PARAM_ERROR 로 거절한다", (value) => {
    let caught: unknown;
    try {
      resolveProxySettings(value, {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NhnCloudCliError);
    expect((caught as NhnCloudCliError).exitCode).toBe(EXIT_PARAM_ERROR);
    expect((caught as NhnCloudCliError).message).toContain("--proxy");
  });

  it("잘못된 환경변수 값은 오류 문구에 변수 이름만 싣고 값은 싣지 않는다", () => {
    let caught: unknown;
    try {
      resolveProxySettings(undefined, { HTTPS_PROXY: "http//user:secret-pw@proxy.example" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(NhnCloudCliError);
    const error = caught as NhnCloudCliError;
    expect(error.exitCode).toBe(EXIT_PARAM_ERROR);
    expect(error.message).toContain("HTTPS_PROXY");
    expect(error.message).not.toContain("secret-pw");
  });

  it("잘못된 값은 실제로 읽은 소문자 환경변수 이름으로 알린다", () => {
    expect(() => resolveProxySettings(undefined, { http_proxy: "socks5://proxy.example:1080" })).toThrow(
      /^http_proxy 값이/,
    );
  });
});

interface ProxyRecord {
  target: string;
  authorization: string | undefined;
}

/** CONNECT 를 기록하고 로컬 대상만 이어 주는 가짜 프록시. 그 밖의 host 는 403 으로 닫아 외부로 나가지 않는다. */
function startFakeProxy(records: ProxyRecord[]): Promise<http.Server> {
  const server = http.createServer((_req, res) => {
    res.writeHead(405).end();
  });
  server.on("connect", (req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer) => {
    const target = req.url ?? "";
    const auth = req.headers["proxy-authorization"];
    records.push({ target, authorization: Array.isArray(auth) ? auth[0] : auth });

    const separator = target.lastIndexOf(":");
    const host = target.slice(0, separator);
    const port = Number(target.slice(separator + 1));
    if (host !== "127.0.0.1" || !Number.isInteger(port)) {
      clientSocket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const upstream = net.connect(port, host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length > 0) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => upstream.destroy());
  });
  return listen(server);
}

function startTarget(): Promise<http.Server> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  return listen(server);
}

function listen(server: http.Server): Promise<http.Server> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function portOf(server: http.Server): number {
  return (server.address() as AddressInfo).port;
}

function close(server: http.Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("installProxy 가짜 프록시 통합", () => {
  let originalDispatcher: Dispatcher;
  let records: ProxyRecord[];
  let proxy: http.Server;
  let target: http.Server;

  beforeEach(async () => {
    originalDispatcher = getGlobalDispatcher();
    records = [];
    proxy = await startFakeProxy(records);
    target = await startTarget();
  });

  afterEach(async () => {
    const installed = getGlobalDispatcher();
    setGlobalDispatcher(originalDispatcher);
    if (installed !== originalDispatcher) {
      await installed.destroy().catch(() => undefined);
    }
    await close(proxy);
    await close(target);
  });

  it("ky 요청이 프록시의 CONNECT 와 프록시 인증을 거친다", async () => {
    await installProxy({ httpProxy: `http://user:pw@127.0.0.1:${portOf(proxy)}` });

    const body = await ky.get(`http://127.0.0.1:${portOf(target)}/x`, { retry: 0 }).json();

    expect(body).toEqual({ ok: true });
    expect(records).toEqual([
      { target: `127.0.0.1:${portOf(target)}`, authorization: "Basic dXNlcjpwdw==" },
    ]);
  });

  it("토큰 발급 요청도 프록시를 거치고 거절되면 EXIT_API_ERROR 로 실패한다", async () => {
    await installProxy({ httpsProxy: `http://127.0.0.1:${portOf(proxy)}` });

    let caught: unknown;
    try {
      // forceRefresh=true 라 토큰 캐시를 읽거나 쓰지 않는다.
      await getAccessToken("default", "example-id", "example-secret", true);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(NhnCloudCliError);
    expect((caught as NhnCloudCliError).exitCode).toBe(EXIT_API_ERROR);
    expect(records.map((record) => record.target)).toContain("oauth.api.nhncloudservice.com:443");
  });

  it("NO_PROXY 에 걸린 host 는 프록시를 거치지 않는다", async () => {
    await installProxy({ httpProxy: `http://127.0.0.1:${portOf(proxy)}`, noProxy: "127.0.0.1" });

    const body = await ky.get(`http://127.0.0.1:${portOf(target)}/x`, { retry: 0 }).json();

    expect(body).toEqual({ ok: true });
    expect(records).toEqual([]);
  });
});
