# Phase 01. SKM endpoint, configure --skm-appkey와 service client

**Execution profile**: standard

## 목표

Secure Key Manager(SKM) API v1.3을 호출하는 `SkmClient`와 타입 가드를 만든다.
profile에 `skm.appkey`를 저장하는 `configure --skm-appkey`와 일반망·공공망 endpoint를 추가한다.

**범위 외**: Commander 명령은 Phase 02와 03이 만든다. 사용자 가이드는 Phase 04다.
실제 API를 호출하지 않는다. 키 저장소·키·인증 정보의 생성·수정·삭제 API와 기밀 데이터 수정(PUT) API는 만들지 않는다.

## 컨텍스트

- endpoint 맵: `src/api/endpoints.ts`의 `ENDPOINTS`, `GOV_ENDPOINTS`, `endpointFor(service, environment)`.
- 응답 봉투: `src/api/envelope.ts`의 `NhnEnvelope<T>`, `unwrap(res)`, `NhnEnvelopeError`. 성공 판정은 `header.isSuccessful`만 쓴다(ADR-006).
- HTTP 오류 변환: `src/api/httpError.ts`의 `toNhnCloudCliError(err)`. 401·403은 `EXIT_AUTH_ERROR`, 그 외는 `EXIT_API_ERROR`다. 응답 본문은 메시지에 담지 않는다.
- 타임아웃: `src/api/timeout.ts`의 `DEFAULT_TIMEOUT_MS`. 다른 client처럼 요청마다 `retry: 0, timeout: DEFAULT_TIMEOUT_MS`를 준다.
- 따라 할 client: `src/services/apigateway/client.ts`(`X-NHN-Authorization: Bearer` 헤더, appkey를 `encodeURIComponent`로 경로에 넣음).
- 테스트 mock 선례: `src/services/network/client.test.ts` 6~9행의 부분 mock(`importOriginal`로 실제 `HTTPError`를 유지하고 `default.get/post`만 `vi.fn()`). `vi.mock("ky")` 전체 mock은 `HTTPError`까지 바꿔 `instanceof`가 깨진다(`src/services/ncr/client.test.ts`의 주석 참고). `HTTPError` 생성 예는 같은 파일 130행의 `new HTTPError(new Response(body, { status }), new Request(url), {} as never)`다.
- 오류 본문 파싱 선례: `src/services/network/errors.ts`(`err.response.json()`을 시도하고 실패하면 기본 변환으로 폴백).
- 환경 타입: `src/config/types.ts`의 `CloudEnvironment = "real" | "gov"`.
- configure: `src/commands/configure.ts`. `ConfigureOptions`, `saveAndVerify(...)`, `runNonInteractive`, 옵션 정의, `hasFlag` 계산. `apigateway`가 비대화형 flag 전용 서비스의 선례다. 대화형 마법사는 `apigateway`를 묻지 않고 `saveAndVerify`에 `undefined`를 넘긴다.

공식 응답 예제(일반망 <https://docs.nhncloud.com/ko/Security/Secure%20Key%20Manager/ko/api-guide-v1.3/>, 공공망 <https://docs.gov-nhncloud.com/ko/Security/Secure%20Key%20Manager/ko/api-guide-v1.3-gov/>)는 두 망이 같다.
모든 응답은 `{ "header": { "resultCode": 0, "resultMessage": "success", "isSuccessful": true }, "body": { ... } }`이다.

**근거 문서**: `docs/adr/039-skm-client-auth-and-secret-output.md`, `docs/adr/037-gov-profile-endpoints.md`, `docs/data-schema.md`의 「credentials.json」 절, `docs/flow.md`의 「Secure Key Manager」 절

## 의도 메모

- 키 목록 응답에는 전체 개수가 없다. `pageSize=100`으로 요청하고 받은 개수가 100보다 적으면 멈춘다.
  서버가 `pageNumber`를 무시해 같은 페이지를 반복하는 경우를 막기 위해, 이번 페이지 첫 `keyId`가 직전 페이지 첫 `keyId`와 같으면 `EXIT_API_ERROR`로 끝낸다.
- 실패 응답이 HTTP 4xx·5xx로 오면서 본문에 봉투가 있을 수 있다. `toNhnCloudCliError`는 본문을 버리므로, SKM client는 본문의 `header.resultMessage`를 오류 메시지에 담는다.
  HTTP 200과 `isSuccessful: false` 조합은 `unwrap`이 처리한다.
- 비밀값 가리기는 출력 정책이라 client가 하지 않는다. client는 응답 그대로 반환한다.
- configure는 SKM 연결 테스트를 추가하지 않는다. 공통 UAK 검증은 기존대로 수행한다.

## 작업 항목

### 1. `src/api/endpoints.ts`에 SKM endpoint 추가

- `ENDPOINTS.skm = "https://api-keymanager.nhncloudservice.com"`
- `GOV_ENDPOINTS.skm = "https://api-keymanager.gov-nhncloudservice.com"`

`src/api/gov-endpoints.test.ts`에 `endpointFor("skm")`과 `endpointFor("skm", "gov")`가 위 값을 반환하는지 확인하는 케이스를 추가한다.

### 2. `src/services/skm/types.ts` 신규

```ts
export type SkmKeyType = "SECRET" | "SYMMETRIC_KEY" | "ASYMMETRIC_KEY";
export type SkmKeyStatusFilter = "active" | "inactive";
export type SkmAuthType = "ipv4" | "mac" | "certificate";

export interface SkmClientInfo { clientIp: string; clientMacHeader?: string | null; clientSentCertificate: boolean; }
export interface SkmKeyStore {
  keyStoreId: number; name: string; description?: string | null;
  ip4AuthUse: string; macAuthUse: string; certificateAuthUse: string;
  creationUser?: string | null; creationDatetime?: string | null;
  lastChangeUser?: string | null; lastChangeDatetime?: string | null;
}
export interface SkmKey {
  keyId: string; name: string; description?: string | null; keyType: string;
  currentKeyValueVersion: number; autoRotationPeriod?: number | null; nextAutoRotationDate?: string | null;
  lastAccessDatetime?: string | null; deletionDatetime?: string | null;
  creationUser?: string | null; creationDatetime?: string | null;
  lastChangeUser?: string | null; lastChangeDatetime?: string | null;
}
export interface SkmAuthDetail {
  value?: string; name?: string; password?: string | null; description?: string | null;
  expirationDate?: string | null; lastAccessDatetime?: string | null; deletionDatetime?: string | null;
  creationUser?: string | null; creationDatetime?: string | null;
  lastChangeUser?: string | null; lastChangeDatetime?: string | null;
}
export interface SkmEncryptResult { ciphertext: string; keyVersion: number; }
export interface SkmDecryptResult { plaintext: string; keyVersion: number; }
export interface SkmLocalKey { localKeyPlaintext: string; localKeyCiphertext: string; keyVersion: number; }
export interface SkmSymmetricKey { symmetricKey: string; keyVersion: number; }
export interface SkmSignResult { signature: string; keyVersion: number; }
export interface SkmStandardSignResult extends SkmSignResult {
  algorithm: string; hashAlgorithm: string; mgfAlgorithm: string; saltLength: number;
}
export interface SkmVerifyResult { result: boolean; keyVersion: number; }
export interface SkmAsymmetricKeyMaterial {
  keyType: string; key: string; encodedKey: string; standardEncodedKey: string; keyVersion: number;
}
```

타입마다 `isSkmClientInfo`처럼 `is<타입명>(value: unknown): value is <타입>` 가드를 export한다.

- 위 선언에서 `?`가 없는 필드만 타입을 검사한다. `SkmClientInfo.clientMacHeader`는 MAC 헤더 없이 호출하면 빠지거나 `null`일 수 있어 선택 필드로 둔다.
- `?` 필드는 있으면 선언 타입이나 `null`인지만 검사한다. 없어도 통과한다.
- `SkmAuthDetail`은 `value`와 `name` 중 하나가 문자열이어야 한다. IPv4·MAC은 `value`, 인증서는 `name`을 쓴다.
- 이중 단언(`as unknown as`)을 쓰지 않는다. `typeof value === "object" && value !== null` 뒤 `Record<string, unknown>`로 좁힌다.

### 3. `src/services/skm/client.ts` 신규

```ts
export class SkmClient {
  constructor(accessToken: string, environment: CloudEnvironment, appKey: string, macAddress?: string);
  confirm(): Promise<SkmClientInfo>;
  listKeyStores(): Promise<SkmKeyStore[]>;
  getKeyStore(keyStoreId: number): Promise<SkmKeyStore>;
  listKeys(keyStoreId: number, filter?: { type?: SkmKeyType; name?: string; status?: SkmKeyStatusFilter }): Promise<SkmKey[]>;
  getKey(keyStoreId: number, keyId: string): Promise<SkmKey>;
  listAuths(keyStoreId: number, type: SkmAuthType): Promise<string[]>;
  getAuth(keyStoreId: number, type: SkmAuthType, value: string): Promise<SkmAuthDetail[]>;
  getSecret(keyId: string): Promise<string>;
  encrypt(keyId: string, plaintext: string): Promise<SkmEncryptResult>;
  decrypt(keyId: string, ciphertext: string): Promise<SkmDecryptResult>;
  createLocalKey(keyId: string): Promise<SkmLocalKey>;
  getSymmetricKey(keyId: string, keyVersion?: number): Promise<SkmSymmetricKey>;
  sign(keyId: string, plaintext: string): Promise<SkmSignResult>;
  verify(keyId: string, plaintext: string, signature: string): Promise<SkmVerifyResult>;
  signStandard(keyId: string, plaintextBase64: string): Promise<SkmStandardSignResult>;
  verifyStandard(keyId: string, plaintextBase64: string, signature: string, keyVersion: number): Promise<SkmVerifyResult>;
  getPrivateKey(keyId: string, keyVersion?: number): Promise<SkmAsymmetricKeyMaterial>;
  getPublicKey(keyId: string, keyVersion?: number): Promise<SkmAsymmetricKeyMaterial>;
}
```

- base URL: `` `${endpointFor("skm", environment)}/keymanager/v1.3/appkey/${encodeURIComponent(appKey)}` ``. 경로의 `keyId`와 인증 정보 `value`는 `encodeURIComponent`를 거친다.
- 헤더: 항상 `"X-NHN-Authorization": \`Bearer ${accessToken}\``. `macAddress`가 있으면 `"X-TOAST-CLIENT-MAC-ADDR": macAddress`를 더한다.
- 공통 private 메서드 하나가 ky 호출, 오류 변환, `unwrap`, 가드 검사를 맡는다. 가드가 실패하면 `` new NhnCloudCliError(`Secure Key Manager 응답 형식 오류: ${필드명}`, EXIT_API_ERROR) ``를 던진다.
- ky가 `HTTPError`를 던지면 `err.response.clone().json()`을 시도한다. 결과의 `header.resultMessage`가 문자열이면 `` `API 호출 실패 (${status}): ${resultMessage}` ``로 `NhnCloudCliError`를 만든다. 종료 코드는 401·403이면 `EXIT_AUTH_ERROR`, 아니면 `EXIT_API_ERROR`다. 본문 파싱이 실패하거나 봉투가 아니면 `toNhnCloudCliError(err)`를 던진다.

| 메서드 | HTTP | 경로(base 뒤) | 요청 | 반환 |
|---|---|---|---|---|
| `confirm` | GET | `/confirm` | | body |
| `listKeyStores` | GET | `/keystores` | `searchParams: { detail: "true" }` | `body.keyStoreList` |
| `getKeyStore` | GET | `/keystores/{keyStoreId}` | | body |
| `listKeys` | GET | `/keystores/{keyStoreId}/keys` | `detail: "true"`, `pageNumber`, `pageSize: 100`, 값이 있을 때만 `type`, `name`, `status` | 모든 페이지의 `body.keyList` |
| `getKey` | GET | `/keystores/{keyStoreId}/keys/{keyId}` | | body |
| `listAuths` | GET | `/keystores/{keyStoreId}/{ips\|macs\|certificates}` | | `body.ipv4List` / `macList` / `certificateList` (문자열 배열) |
| `getAuth` | GET | `listAuths`와 같은 경로 | `searchParams: { value }` | 같은 필드의 `SkmAuthDetail` 배열 |
| `getSecret` | GET | `/secrets/{keyId}` | | `body.secret` |
| `encrypt` | POST | `/symmetric-keys/{keyId}/encrypt` | `json: { plaintext }` | body |
| `decrypt` | POST | `/symmetric-keys/{keyId}/decrypt` | `json: { ciphertext }` | body |
| `createLocalKey` | POST | `/symmetric-keys/{keyId}/create-local-key` | 본문 없음 | body |
| `getSymmetricKey` | GET | `/symmetric-keys/{keyId}/symmetric-key` | `keyVersion`이 있을 때만 searchParams | body |
| `sign` | POST | `/asymmetric-keys/{keyId}/sign` | `json: { plaintext }` | body |
| `verify` | POST | `/asymmetric-keys/{keyId}/verify` | `json: { plaintext, signature }` | body |
| `signStandard` | POST | `/asymmetric-keys/{keyId}/sign-standard` | `json: { plaintext, algorithm: "RSASSA-PSS" }` | body |
| `verifyStandard` | POST | `/asymmetric-keys/{keyId}/verify-standard` | `json: { plaintext, signature, algorithm: "RSASSA-PSS", keyVersion }` | body |
| `getPrivateKey` | GET | `/asymmetric-keys/{keyId}/privateKey` | `keyVersion`이 있을 때만 searchParams | body |
| `getPublicKey` | GET | `/asymmetric-keys/{keyId}/publicKey` | `keyVersion`이 있을 때만 searchParams | body |

`SkmAuthType`과 경로·응답 필드 대응은 `ipv4 → ips / ipv4List`, `mac → macs / macList`, `certificate → certificates / certificateList`다.

### 4. `src/commands/configure.ts`에 `--skm-appkey` 추가

`apigateway`와 같은 방식으로 다룬다.

- `ConfigureOptions`에 `skmAppkey?: string`.
- `.option("--skm-appkey <key>", "Secure Key Manager appkey (비대화형)")`를 `--apigateway-appkey` 다음에 둔다. `hasFlag`에 `opts.skmAppkey !== undefined`를 더한다.
- `runNonInteractive`: 빈 값이면 `--skm-appkey 값은 비어 있을 수 없습니다.`를 `EXIT_PARAM_ERROR`로 던진다. trim한 값으로 `skm: ServiceCredential | undefined`를 만든다.
- 모든 값이 없을 때의 오류 문구 `--ncr-appkey, --ncs-appkey, --apigateway-appkey, 또는 --deploy-appkey`를 `--ncr-appkey, --ncs-appkey, --apigateway-appkey, --skm-appkey, 또는 --deploy-appkey`로 바꾸고 조건에 `!skm`을 더한다.
- `saveAndVerify`에 `skm: ServiceCredential | undefined` 인수를 `apigateway` 다음에 추가하고 `setServiceCredential(profileName, "skm", skm)`으로 저장한다. 대화형 경로의 세 호출(`runInteractive` 안 334·347·353행 부근)은 그 자리에 `undefined`를 넘긴다.

### 5. 테스트

`src/services/skm/client.test.ts` 신규. ky mock은 `src/services/network/client.test.ts`의 부분 mock을 따르고, 응답은 `{ json: async () => body }`를 돌려주는 `mockKyResponse`(`src/services/apigateway/client.test.ts`)로 만든다.

- `environment`가 `"real"`이면 `https://api-keymanager.nhncloudservice.com/keymanager/v1.3/appkey/test-appkey/confirm`, `"gov"`이면 공공망 host로 GET한다.
- `macAddress`를 주면 헤더에 `X-TOAST-CLIENT-MAC-ADDR`가 있고, 주지 않으면 없다. `X-NHN-Authorization`은 항상 `Bearer <token>`이다.
- `listKeys`: 첫 응답 100건, 둘째 응답 3건이면 `ky.get`을 2회 부르고 103건을 반환한다. 두 번째 호출의 `pageNumber`는 2다. 필터를 주면 `type`, `name`, `status`가 searchParams에 실린다.
- `listKeys`: 두 페이지의 첫 `keyId`가 같고 둘 다 100건이면 `EXIT_API_ERROR`를 던진다.
- `getAuth(1, "certificate", "cert1")`이 `/keystores/1/certificates`에 `value=cert1`로 요청하고 `certificateList`를 반환한다.
- `verifyStandard`가 `algorithm: "RSASSA-PSS"`와 `keyVersion`을 본문에 담는다.
- `header.isSuccessful: false`면 `NhnEnvelopeError`, 가드 실패(`body.secret`이 숫자)면 `Secure Key Manager 응답 형식 오류`를 담은 `EXIT_API_ERROR`.
- `ky.get`이 `new HTTPError(new Response(JSON.stringify({ header: { isSuccessful: false, resultCode: -1, resultMessage: "Forbidden client" } }), { status: 403 }), new Request(url), {} as never)`를 던지면 메시지에 `Forbidden client`가 있고 종료 코드는 `EXIT_AUTH_ERROR`다.
- 본문이 JSON이 아닌 status 500 `HTTPError`면 `toNhnCloudCliError`와 같은 `API 호출 실패 (500)` 메시지와 `EXIT_API_ERROR`다.
- `confirm` 응답에 `clientMacHeader`가 없어도 통과한다.

`src/services/skm/types.test.ts` 신규: 공식 예제 JSON(`docs` 응답 예시 값을 placeholder로 바꾼 것)이 각 가드를 통과하는지, 필수 필드가 빠지거나 타입이 틀리면 실패하는지. `nextAutoRotationDate: null`, `deletionDatetime: null`인 키가 통과하는지.

`src/commands/configure.test.ts`에 기존 `--apigateway-appkey 단독 호출이 apigateway 자격증명으로 저장된다` 케이스와 같은 방식으로 추가:

- `--skm-appkey skm-appkey --no-verify`가 `skm` 블록에 `{ appkey: "skm-appkey" }`를 저장한다.
- `--skm-appkey "  "`는 `EXIT_PARAM_ERROR`다.

## 검증

```bash
node_modules/.bin/vitest run src/services/skm/types.test.ts src/services/skm/client.test.ts src/api/gov-endpoints.test.ts src/commands/configure.test.ts
pnpm tsc --noEmit
pnpm test
pnpm run build
node dist/index.js commands --json | grep -c -- "--skm-appkey"   # 1
git diff --check
```

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/api/endpoints.ts` | 수정 |
| `src/api/gov-endpoints.test.ts` | 수정 |
| `src/services/skm/types.ts` | 신규 |
| `src/services/skm/types.test.ts` | 신규 |
| `src/services/skm/client.ts` | 신규 |
| `src/services/skm/client.test.ts` | 신규 |
| `src/commands/configure.ts` | 수정 |
| `src/commands/configure.test.ts` | 수정 |
