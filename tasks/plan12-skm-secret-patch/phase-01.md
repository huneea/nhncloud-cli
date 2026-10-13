# Phase 01. 전역 `--proxy` 와 프록시 환경변수를 모든 HTTP 요청에 적용

**Execution profile**: standard

## 목표

전역 옵션 `--proxy <url>` 과 `HTTPS_PROXY`·`HTTP_PROXY`·`NO_PROXY` 를 해석해 undici `EnvHttpProxyAgent` 를 Node fetch 의 전역 dispatcher 로 설치한다.
프록시로만 외부에 나갈 수 있는 서버에서 토큰 발급부터 모든 요청이 프록시를 거치게 하는 것이 목적이다.

**범위 외**: SKM `secret get --field`(phase 02)와 `secret patch`(phase 03). 환경변수로 UAK·appkey 받기, 토큰 캐시 끄기, `doctor` 보고서에 프록시 항목 추가는 이번 계획에서 하지 않는다.

## 컨텍스트

- 전역 옵션과 그 해석은 `src/index.ts` 의 `program.option(...)` 과 `program.hook("preAction", ...)` 이 소유한다. `--request-timeout` 이 같은 자리에서 옵션 > 환경변수 > 기본값 순으로 해석되고, 빈 문자열은 미지정으로 본다. 이 패턴을 따른다.
- 요청은 모두 `ky` 를 거친다(`src/api/oauth.ts`, `src/api/keystone.ts`, `src/services/*/client.ts`). `ky` 는 Node 내장 fetch 를 쓰고, 내장 fetch 는 undici 패키지의 `setGlobalDispatcher` 가 설치한 dispatcher 를 쓴다. 요청 지점은 고치지 않는다.
- HTTP 오류 변환은 `src/api/httpError.ts` 의 `toNhnCloudCliError` 다. fetch 의 연결 실패는 `TypeError("fetch failed")` 이고 원인은 `err.cause` 에 있다. 지금은 `fetch failed` 만 보인다.
- 루트 옵션 이름은 `src/commands/reserved-flags.test.ts` 의 `RESERVED_ROOT_FLAGS` 에 함께 적어야 하위 명령과의 충돌을 테스트가 잡는다.
- CI 는 Node 20 에서도 돈다(사전 확인은 22, 24 만). 구현 뒤 로컬 Node 에서 가짜 프록시 통합 테스트가 통과하는지 보고, 가능하면 Node 20.x 로도 돌린다. Node 20 에서 undici 7 dispatcher 가 내장 fetch 에 적용되지 않아 테스트가 실패하면 `PHASE_BLOCKED: Node 20 에서 전역 dispatcher 가 적용되지 않는다` 를 출력하고 멈춘다.
- 사전 확인한 사실: undici 7.29.1 의 `EnvHttpProxyAgent` 와 `ProxyAgent` 를 `setGlobalDispatcher` 로 설치하면 Node 22.18, 22.23, 24.15 에서 `ky.get` 이 프록시의 `CONNECT host:port` 를 거쳤고, URL 의 사용자 정보가 `Proxy-Authorization: Basic ...` 으로 갔다. undici 6.x 의 `EnvHttpProxyAgent` 는 생성할 때 stderr 에 `[UNDICI-EHPA] Warning: EnvHttpProxyAgent is experimental` 을 낸다.

**근거 문서**: `docs/adr/044-http-proxy-global-dispatcher.md`, `docs/flow.md` 의 「공통 실행 흐름」 절, `docs/code-architecture.md` 의 「인증과 endpoint 조합」 절

## 의도 메모

- 요청마다 `dispatcher` 를 넘기지 않는다. 새 client 가 빠뜨려도 드러나지 않는다(ADR-044).
- undici 6.x 를 쓰지 않는다. 실험 기능 경고가 `--json` 자동화의 stderr 에 섞인다.
- 프록시 값이 없으면 dispatcher 를 바꾸지 않는다. 프록시를 쓰지 않는 사용자의 동작이 그대로여야 한다.
- preAction 은 모든 명령 앞에서 돈다. 환경변수 값이 잘못되면 HTTP 요청이 없는 명령(`skills`, `commands`, `configure`, `doctor`)도 종료 코드 3으로 끝난다. 이 동작을 받아들인다. 숨은 프록시 설정이 조용히 무시되는 것보다 바로 알리는 편이 낫고, 오류 문구가 환경변수 이름을 알려 주므로 사용자가 고칠 수 있다. 이 동작을 ADR-044 「적용 범위」, `common.md` 「프록시」 절, `proxy.test.ts` 에 적는다.
- 오류 문구에 프록시 URL 값을 싣지 않는다. 사용자 정보(비밀번호)가 들어 있을 수 있다. 옵션이나 환경변수 이름만 쓴다.
- `undici` 는 프록시를 설치할 때만 동적 `import("undici")` 로 읽는다. 프록시를 쓰지 않는 명령의 시작 시간을 늘리지 않는다.
- 테스트는 실제 외부 host 에 연결하지 않는다. 가짜 프록시가 CONNECT 를 거절하거나 로컬 대상 서버로만 이어 준다.

## 작업 항목

### 1. `package.json`, `pnpm-lock.yaml`: undici 의존성과 Node 하한

- `dependencies` 에 `"undici": "^7.29.1"` 을 더한다. `pnpm add undici@^7.29.1` 로 lockfile 을 함께 갱신한다.
- `engines.node` 를 `">=20"` 에서 `">=20.18.1"` 로 올린다(undici 7 의 `engines`).
- worktree 에서 `pnpm install`·`pnpm add` 가 esbuild 실행 승인 때문에 막히면 `AGENTS.md` 의 「빌드와 검증」 절을 따른다. lockfile 갱신이 끝내 막히면 `PHASE_BLOCKED: pnpm 으로 undici 를 설치할 수 없다` 를 출력하고 멈춘다.

### 2. `src/api/proxy.ts` 신규: 프록시 설정 해석과 설치

```ts
export interface ProxySettings {
  httpProxy?: string;
  httpsProxy?: string;
  noProxy?: string;
}

/** --proxy 와 환경변수에서 프록시 설정을 만든다. 프록시 값이 하나도 없으면 undefined. */
export function resolveProxySettings(option: string | undefined, env: NodeJS.ProcessEnv): ProxySettings | undefined;

/** undici EnvHttpProxyAgent 를 전역 dispatcher 로 설치한다. undici 는 여기서 동적으로 읽는다. */
export async function installProxy(settings: ProxySettings): Promise<void>;
```

`resolveProxySettings` 규칙:

- `option` 이 빈 문자열이면 미지정으로 본다. 환경변수도 빈 문자열은 없는 것으로 본다.
- `noProxy` 는 `env.no_proxy ?? env.NO_PROXY` 다(빈 문자열 제외).
- `option` 이 있으면 `{ httpProxy: option, httpsProxy: option, noProxy }` 다.
- 없으면 `httpsProxy = env.https_proxy ?? env.HTTPS_PROXY`, `httpProxy = env.http_proxy ?? env.HTTP_PROXY` 다(소문자 먼저, 빈 문자열 제외). 둘 다 없으면 `undefined` 를 돌려준다. `NO_PROXY` 만 있으면 `undefined` 다.
- 쓰기로 고른 값마다 `new URL(value)` 이 성공하고 `protocol` 이 `http:` 또는 `https:` 인지 검사한다. 아니면 값을 읽은 출처 이름(`--proxy`, `https_proxy`, `HTTPS_PROXY`, `http_proxy`, `HTTP_PROXY` 중 실제로 읽은 것)으로 다음 오류를 던진다. 값은 싣지 않는다.
  `NhnCloudCliError(\`${source} 값이 프록시 URL 형식이 아닙니다. http:// 또는 https:// 로 시작하는 URL 을 지정하세요.\`, EXIT_PARAM_ERROR)`

`installProxy` 는 `const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");` 뒤 `setGlobalDispatcher(new EnvHttpProxyAgent(options))` 를 부른다.
`options` 에는 `settings` 에서 값이 있는 키만 담는다. 넘긴 값만으로 동작을 설명할 수 있게 하려는 것이다.

### 3. `src/index.ts`: 전역 옵션과 preAction

- `--request-timeout` 옵션 다음에 `.option("--proxy <url>", "HTTP 요청에 쓸 프록시 URL. HTTPS_PROXY·HTTP_PROXY 보다 우선하고 NO_PROXY 는 그대로 따른다")` 를 더한다.
- `program.hook("preAction", ...)` 을 `async` 로 바꾸고, opts 타입에 `proxy?: string` 을 더한다. 타임아웃 해석 바로 뒤, chalk·spinner 설정보다 앞에서 `const proxySettings = resolveProxySettings(opts.proxy, process.env);` 로 해석한다(잘못된 값은 여기서 종료 코드 3). 훅 끝에서 `if (proxySettings) await installProxy(proxySettings);` 를 부른다.
- `program.parseAsync()` 는 이미 쓰고 있어 async 훅이 기다려진다.

### 4. `src/api/httpError.ts`: 연결 실패 원인 덧붙이기

`toNhnCloudCliError` 의 `err instanceof Error` 분기에서, `err.cause` 가 `Error` 이고 그 `message` 가 비어 있지 않으며 `err.message` 와 다르면 메시지를 `\`${err.message} (${sanitizeForTerminal(err.cause.message)})\`` 로 만든다. 종료 코드는 `EXIT_API_ERROR` 그대로다. `sanitizeForTerminal` 은 `src/utils/terminal.ts` 에 있다.

### 5. `src/commands/reserved-flags.test.ts`: 예약 플래그

`RESERVED_ROOT_FLAGS` 끝에 `"--proxy"` 를 더한다.

### 6. `src/api/proxy.test.ts` 신규

- `resolveProxySettings` 단위 테스트
  - 옵션이 환경변수보다 우선하고 `noProxy` 는 환경변수에서 온다.
  - 소문자 환경변수가 대문자보다 우선한다.
  - 빈 문자열 옵션과 빈 환경변수는 미지정이다. 아무것도 없거나 `NO_PROXY` 만 있으면 `undefined` 다.
  - `ftp://proxy.example:21` 과 `not a url` 은 `EXIT_PARAM_ERROR` 로 거절한다.
  - 잘못된 값 `http//user:secret-pw@proxy.example` 을 `HTTPS_PROXY` 로 주면 오류 문구에 `HTTPS_PROXY` 는 있고 `secret-pw` 는 없다.
- 가짜 프록시 통합 테스트. `node:http` 서버 하나를 프록시로 띄워 `connect` 이벤트에서 `req.url` 과 `proxy-authorization` 헤더를 기록한다. 대상이 로컬이면 `net.connect` 로 이어 주고(`HTTP/1.1 200 Connection Established\r\n\r\n`), 그 밖의 host 는 `HTTP/1.1 403 Forbidden\r\n\r\n` 로 닫는다. 각 테스트 뒤 `getGlobalDispatcher()` 로 저장해 둔 원래 dispatcher 를 `setGlobalDispatcher` 로 되돌리고 서버를 닫는다.
  - 정상: `installProxy({ httpProxy: "http://user:pw@127.0.0.1:<프록시 포트>" })` 뒤 `ky.get("http://127.0.0.1:<대상 포트>/x").json()` 이 대상 응답을 받고, 프록시가 `CONNECT 127.0.0.1:<대상 포트>` 와 `Basic dXNlcjpwdw==` 를 기록한다.
  - 토큰 발급: `installProxy({ httpsProxy: "http://127.0.0.1:<프록시 포트>" })` 뒤 `getAccessToken("default", "example-id", "example-secret", true)` 가 `NhnCloudCliError`(`EXIT_API_ERROR`)로 실패하고, 프록시가 `CONNECT oauth.api.nhncloudservice.com:443` 을 기록한다. `forceRefresh=true` 라 토큰 캐시를 읽거나 쓰지 않는다.
  - `NO_PROXY`: `installProxy({ httpProxy: <프록시>, noProxy: "127.0.0.1" })` 뒤 로컬 대상 요청이 성공하고 프록시 기록이 비어 있다.

### 7. `src/api/httpError.test.ts`: 원인 덧붙이기 테스트

- `new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:9") })` 가 `fetch failed (connect ECONNREFUSED 127.0.0.1:9)` 메시지와 `EXIT_API_ERROR` 가 된다.
- `cause` 가 없거나 `Error` 가 아니면 메시지가 그대로다.

### 8. 사용자 문서

- `docs/adr/044-http-proxy-global-dispatcher.md` 「적용 범위」 에 잘못된 프록시 값은 HTTP 요청이 없는 명령에서도 종료 코드 3이라는 것을 더한다(변경 파일에 `docs/adr/044-http-proxy-global-dispatcher.md` 포함).

- `README.md` 「빠른 시작」 의 `Node.js 20 이상이 필요해요.` 를 `Node.js 20.18.1 이상이 필요해요.` 로 바꾼다. 「문제가 생기면」 절이나 「더 알아보기」 절 가까이에 프록시 한 줄 안내(예: `프록시를 거쳐야 하면 --proxy http://proxy.example:3128 또는 HTTPS_PROXY 를 지정해요.`)를 README 의 해요체로 더한다.
- `skills/nhncloud-cli/references/common.md` 의 「요청 타임아웃」 절 뒤에 「프록시」 절을 더한다. 예시 값은 `http://proxy.example:3128` 만 쓴다. 우선순위(`--proxy` > 소문자 환경변수 > 대문자 환경변수), `NO_PROXY` 는 `--proxy` 에도 적용된다는 것, `HTTPS_PROXY` 가 없으면 HTTPS 요청에도 `HTTP_PROXY` 를 쓴다는 것, 잘못된 값은 API 호출 전에 종료 코드 3이고 오류에 값이 나오지 않는다는 것, 프록시 연결 실패는 종료 코드 1이며 괄호 안에 원인이 붙는다는 것을 적는다. 프록시 인증은 `http://user:password@proxy.example:3128` 형식이며 셸 이력에 남지 않게 환경변수로 넘기라고 적는다.

## 검증

```bash
node_modules/.bin/vitest run src/api/proxy.test.ts src/api/httpError.test.ts src/commands/reserved-flags.test.ts
pnpm tsc --noEmit
pnpm test
pnpm run build
node dist/index.js --proxy ftp://proxy.example skm confirm; test $? -eq 3
T=$(mktemp -d) && mkdir -p "$T/.nhncloud" && printf '%s' '{"version":1,"profiles":{"default":{"userAccessKey":{"id":"example-id","secret":"example-secret"},"skm":{"appkey":"example-appkey"}}}}' > "$T/.nhncloud/credentials.json" && chmod 600 "$T/.nhncloud/credentials.json" && HOME="$T" node dist/index.js --proxy http://127.0.0.1:9 skm confirm 2> "$T/err"; test $? -eq 1 && grep -q "127.0.0.1:9" "$T/err"
T=$(mktemp -d) && mkdir -p "$T/.nhncloud" && printf '%s' '{"version":1,"profiles":{"default":{"userAccessKey":{"id":"example-id","secret":"example-secret"},"skm":{"appkey":"example-appkey"}}}}' > "$T/.nhncloud/credentials.json" && chmod 600 "$T/.nhncloud/credentials.json" && HOME="$T" HTTPS_PROXY=http://127.0.0.1:9 node dist/index.js skm confirm 2> "$T/err"; test $? -eq 1 && grep -q "127.0.0.1:9" "$T/err"
node dist/index.js skm confirm --help | grep -q -- '--proxy'
pnpm verify:package
node scripts/check-pii.mjs
git diff --check
```

- `commands --json` 카탈로그는 루트 전역 옵션을 싣지 않는다(`--request-timeout` 도 없다). 그래서 `--proxy` 는 하위 명령 도움말의 전역 옵션 목록으로 확인한다.
- 두 번째와 세 번째 CLI 명령은 닫힌 로컬 포트(9)를 프록시로 주므로 외부로 나가지 않는다. 종료 코드 1과 stderr 의 `127.0.0.1:9` 가 요청이 프록시 주소로 갔다는 근거다.
- `pnpm test` 가 esbuild 승인 문제로 돌지 않으면 `node_modules/.bin/vitest run`, `pnpm tsc` 대신 `node_modules/.bin/tsc --noEmit`, 빌드는 `node_modules/.bin/tsup` 을 쓴다.

## 변경 파일

| 파일 | 변경 |
|---|---|
| `package.json` | 수정 |
| `pnpm-lock.yaml` | 수정 |
| `src/api/proxy.ts` | 신규 |
| `src/api/proxy.test.ts` | 신규 |
| `src/index.ts` | 수정 |
| `src/api/httpError.ts` | 수정 |
| `src/api/httpError.test.ts` | 수정 |
| `src/commands/reserved-flags.test.ts` | 수정 |
| `README.md` | 수정 |
| `skills/nhncloud-cli/references/common.md` | 수정 |
| `docs/adr/044-http-proxy-global-dispatcher.md` | 수정 |
