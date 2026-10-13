import { NhnCloudCliError } from "../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../utils/exit-codes.js";

/** undici EnvHttpProxyAgent 에 넘길 프록시 설정. 값이 있는 키만 담는다. */
export interface ProxySettings {
  httpProxy?: string;
  httpsProxy?: string;
  noProxy?: string;
}

interface SourcedValue {
  source: string;
  value: string;
}

/** 빈 문자열은 미지정으로 본다. `HTTPS_PROXY= nhncloud ...` 처럼 셸에서 비운 경우를 걸러 낸다. */
function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === "" ? undefined : value;
}

/** 소문자 환경변수를 대문자보다 먼저 읽는다. 값을 읽은 환경변수 이름도 함께 돌려준다. */
function readEnvPair(env: NodeJS.ProcessEnv, lower: string, upper: string): SourcedValue | undefined {
  const lowerValue = nonEmpty(env[lower]);
  if (lowerValue !== undefined) {
    return { source: lower, value: lowerValue };
  }
  const upperValue = nonEmpty(env[upper]);
  if (upperValue !== undefined) {
    return { source: upper, value: upperValue };
  }
  return undefined;
}

/**
 * 프록시 URL 형식을 검사한다.
 * 오류 문구에는 값을 싣지 않는다. URL 의 사용자 정보에 비밀번호가 들어 있을 수 있다(ADR-044).
 */
function validateProxyUrl({ source, value }: SourcedValue): string {
  let protocol: string | undefined;
  try {
    protocol = new URL(value).protocol;
  } catch {
    protocol = undefined;
  }
  if (protocol !== "http:" && protocol !== "https:") {
    throw new NhnCloudCliError(
      `${source} 값이 프록시 URL 형식이 아닙니다. http:// 또는 https:// 로 시작하는 URL 을 지정하세요.`,
      EXIT_PARAM_ERROR,
    );
  }
  return value;
}

/** --proxy 와 환경변수에서 프록시 설정을 만든다. 프록시 값이 하나도 없으면 undefined. */
export function resolveProxySettings(
  option: string | undefined,
  env: NodeJS.ProcessEnv,
): ProxySettings | undefined {
  const noProxy = readEnvPair(env, "no_proxy", "NO_PROXY")?.value;
  const optionValue = nonEmpty(option);

  let settings: ProxySettings;
  if (optionValue !== undefined) {
    const proxy = validateProxyUrl({ source: "--proxy", value: optionValue });
    settings = { httpProxy: proxy, httpsProxy: proxy };
  } else {
    const https = readEnvPair(env, "https_proxy", "HTTPS_PROXY");
    const http = readEnvPair(env, "http_proxy", "HTTP_PROXY");
    if (https === undefined && http === undefined) {
      return undefined;
    }
    settings = {};
    if (https !== undefined) {
      settings.httpsProxy = validateProxyUrl(https);
    }
    if (http !== undefined) {
      settings.httpProxy = validateProxyUrl(http);
    }
  }

  if (noProxy !== undefined) {
    settings.noProxy = noProxy;
  }
  return settings;
}

/**
 * undici EnvHttpProxyAgent 를 전역 dispatcher 로 설치한다.
 * Node 내장 fetch 와 그 위의 ky 가 이 dispatcher 를 쓰므로 요청 지점을 고치지 않는다(ADR-044).
 * undici 는 프록시를 쓸 때만 읽어 프록시가 없는 명령의 시작 시간을 늘리지 않는다.
 */
export async function installProxy(settings: ProxySettings): Promise<void> {
  const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");
  const options: ProxySettings = {};
  if (settings.httpProxy !== undefined) options.httpProxy = settings.httpProxy;
  if (settings.httpsProxy !== undefined) options.httpsProxy = settings.httpsProxy;
  if (settings.noProxy !== undefined) options.noProxy = settings.noProxy;
  setGlobalDispatcher(new EnvHttpProxyAgent(options));
}
