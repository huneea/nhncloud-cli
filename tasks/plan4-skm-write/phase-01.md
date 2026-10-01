# Phase 01. SkmClient 쓰기 메서드와 응답 가드

**Execution profile**: deep

## 목표

`SkmClient`에 키·키 저장소·인증 정보 생성, 수정, 삭제와 기밀 데이터 수정 메서드를 추가한다.
본문이 `null`인 응답(키 저장소 수정·삭제)을 헤더만으로 판정하는 요청 경로를 만든다.

**범위 외**: Commander 명령은 Phase 02와 03이다. 문서는 Phase 04다. 실제 API를 호출하지 않는다.

## 컨텍스트

- 수정할 client: `src/services/skm/client.ts`.
  - private `request<T>(method: "get" | "post", path, field: string | null, guard: Guard<T>, options: RequestOptions = {})`가 ky 호출, `toSkmError`, `isEnvelope`, `unwrap`, 가드 검사를 맡는다.
  - `RequestOptions`는 `{ searchParams?, json? }`, 보조 함수 `isRecord`, `isString`, `arrayOf`, `keyPath(prefix, keyId, action)`가 같은 파일에 있다.
- 응답 봉투: `src/api/envelope.ts`의 `unwrap`(body 필수)과 `unwrapHeader`(헤더만 검사, `isSuccessful: false`면 `NhnEnvelopeError`).
- 타입과 가드: `src/services/skm/types.ts`. 기존 가드 작성 방식(필수 필드만 타입 검사, `?` 필드는 없음·`null`·선언 타입 허용, 이중 단언 금지)을 따른다.
- 테스트: `src/services/skm/client.test.ts`(ky 부분 mock, `mockKyResponse`, `HTTPError` 생성 예), `src/services/skm/types.test.ts`.

공식 응답 예제(<https://docs.nhncloud.com/ko/Security/Secure%20Key%20Manager/ko/api-guide-v1.3/>, 공공망 문서 동일)에서 옮긴 요청·응답이다.

| 메서드 | HTTP | 경로(base 뒤) | 요청 본문 | 응답 body |
|---|---|---|---|---|
| `createSecret(keyStoreName, name, description, secretValue)` | POST | `/keys/secrets/create` | `{ keyStoreName, name, description, secretValue }` | `{ keyId, keyStatus }` |
| `createSymmetricKey(keyStoreName, name, description)` | POST | `/keys/symmetric-keys/create` | `{ keyStoreName, name, description, autoRotationPeriod: 0 }` | `{ keyId, keyStatus }` |
| `createAsymmetricKey(keyStoreName, name, description)` | POST | `/keys/asymmetric-keys/create` | `{ keyStoreName, name, description, autoRotationPeriod: 0 }` | `{ keyId, keyStatus }` |
| `updateSecret(keyId, secretValue)` | PUT | `/secrets/{keyId}` | `{ secretValue }` | `{ keyId, name, description, secretValue, creationUser, creationDatetime, lastChangeUser, lastChangeDatetime }` |
| `scheduleKeyDeletion(keyId)` | PUT | `/keys/{keyId}/delete` | 없음 | `{ keyId, deletionDateTime }` |
| `deleteKeyNow(keyId)` | DELETE | `/keys/{keyId}` | 없음 | `{ keyId, deletionDateTime }` |
| `createKeyStore(input)` | POST | `/keystores` | `{ name, description, ip4AuthUse, macAuthUse, certificateAuthUse, authMode }` | `{ keyStoreId, name, description, ip4AuthUse, macAuthUse, certificateAuthUse, authMode }` |
| `updateKeyStore(keyStoreId, input)` | PUT | `/keystores/{keyStoreId}` | 위와 같음 | `null` |
| `deleteKeyStore(keyStoreId)` | DELETE | `/keystores/{keyStoreId}` | 없음 | `null` |
| `addAuth(type, keyStoreName, value, description)` (ipv4·mac) | POST | `/auths/{ipv4s\|macs}` | `{ keyStoreName, value, description }` | `{ value, description }` |
| `addCertificate(keyStoreName, name, password, lifeTime, description)` | POST | `/auths/certificates` | `{ keyStoreName, name, password, lifeTime, description }` | `{ name, description }` |
| `scheduleAuthDeletion(type, keyStoreName, value)` | PUT | `/auths/{ipv4s\|macs\|certificates}/delete` | ipv4·mac `{ keyStoreName, value }`, certificate `{ keyStoreName, name: value }` | `{ value 또는 name, deletionDateTime }` |
| `deleteAuthNow(type, keyStoreName, value)` | POST | `/auths/{ipv4s\|macs\|certificates}/delete` | 위와 같음 | 위와 같음 |

경로의 `auths` 조각은 조회 API(`/keystores/{id}/ips`)와 다르다. `ipv4 → ipv4s`, `mac → macs`, `certificate → certificates`다.

**근거 문서**: `docs/adr/040-skm-write-commands.md`, `docs/adr/039-skm-client-auth-and-secret-output.md`, `docs/flow.md`의 「Secure Key Manager 쓰기」 절

## 의도 메모

- `description`이 `undefined`면 요청 본문에서 키를 뺀다. 빈 문자열을 대신 보내지 않는다.
- 키 저장소 수정·삭제는 `unwrapHeader`로 판정한다. 응답 body가 `null`이거나 빠질 수 있고 검사할 필드가 없어서 헤더만 본다.
- 쓰기 요청은 재시도하지 않는다(`retry: 0` 유지).
- 기밀 데이터 수정 응답의 `secretValue`는 client가 그대로 반환한다. 출력에서 빼는 일은 Phase 02 명령이 한다.

## 작업 항목

### 1. `src/services/skm/types.ts`에 타입과 가드 추가

```ts
export type SkmAuthMode = "AND" | "OR";
export interface SkmKeyStoreInput {
  name: string; description?: string;
  ip4AuthUse: "Y" | "N"; macAuthUse: "Y" | "N"; certificateAuthUse: "Y" | "N";
  authMode: SkmAuthMode;
}
export interface SkmCreatedKey { keyId: string; keyStatus: string; }
export interface SkmCreatedKeyStore {
  keyStoreId: number; name: string; description?: string | null;
  ip4AuthUse: string; macAuthUse: string; certificateAuthUse: string; authMode?: string | null;
}
export interface SkmUpdatedSecret {
  keyId: string; name: string; description?: string | null; secretValue?: string | null;
  creationUser?: string | null; creationDatetime?: string | null;
  lastChangeUser?: string | null; lastChangeDatetime?: string | null;
}
export interface SkmDeletion { keyId: string; deletionDateTime: string; }
export interface SkmAuthAdded { value?: string | null; name?: string | null; description?: string | null; }
export interface SkmAuthDeletion { value?: string | null; name?: string | null; deletionDateTime: string; }
```

가드 `isSkmCreatedKey`, `isSkmCreatedKeyStore`, `isSkmUpdatedSecret`, `isSkmDeletion`, `isSkmAuthAdded`, `isSkmAuthDeletion`을 export한다.
`SkmAuthAdded`와 `SkmAuthDeletion`은 `value`와 `name` 중 하나가 문자열이어야 한다(`isSkmAuthDetail`과 같은 규칙).

### 2. `src/services/skm/client.ts` 확장

- `request`의 `method` 타입을 `"get" | "post" | "put" | "delete"`로 넓힌다.
- 헤더만 검사하는 private `requestHeaderOnly(method: "put" | "delete", path: string, options?: RequestOptions): Promise<void>`를 추가한다. ky 호출과 오류 변환은 `request`와 같은 코드를 공유한다(공통 부분을 private 함수로 뽑는다). 봉투가 아니면 `Secure Key Manager 응답 형식 오류: header`, `isSuccessful: false`면 `unwrapHeader`가 던지는 `NhnEnvelopeError`다.
- 위 표의 메서드 13개를 추가한다. `field`는 모두 `null`(body 전체)이다. 반환 타입은 순서대로 `SkmCreatedKey`(3개), `SkmUpdatedSecret`, `SkmDeletion`(2개), `SkmCreatedKeyStore`, `void`(2개), `SkmAuthAdded`(2개), `SkmAuthDeletion`(2개)이다.
- 쓰기 경로용 대응 상수 `AUTH_WRITE_PATH: Record<SkmAuthType, string> = { ipv4: "ipv4s", mac: "macs", certificate: "certificates" }`를 둔다.
- `addAuth`의 `type` 인수는 `"ipv4" | "mac"`만 받는다(타입으로 제한).

### 3. 테스트

`src/services/skm/client.test.ts`에 추가:

- `createSecret`이 `/keys/secrets/create`에 `{ keyStoreName, name, secretValue }`를 POST하고, `description`이 `undefined`면 본문에 `description` 키가 없다.
- `createSymmetricKey`·`createAsymmetricKey`가 각 경로에 `autoRotationPeriod: 0`을 담는다.
- `updateSecret`이 `ky.put`으로 `/secrets/<keyId>`를 호출한다.
- `scheduleKeyDeletion`은 `ky.put` `/keys/<keyId>/delete`, `deleteKeyNow`는 `ky.delete` `/keys/<keyId>`다.
- `updateKeyStore`가 `{ header: { isSuccessful: true, ... }, body: null }`에 resolve하고, `isSuccessful: false`면 `NhnEnvelopeError`로 reject한다.
- `deleteKeyStore`가 `ky.delete` `/keystores/7`을 호출하고 `body: null`에 resolve한다.
- `scheduleAuthDeletion("certificate", "store", "cert1")`이 `ky.put` `/auths/certificates/delete`에 `{ keyStoreName: "store", name: "cert1" }`를 보내고, `deleteAuthNow("ipv4", "store", "10.0.0.1")`은 `ky.post` `/auths/ipv4s/delete`에 `{ keyStoreName: "store", value: "10.0.0.1" }`를 보낸다.
- `deleteKeyNow`가 status 400과 봉투 본문을 가진 `HTTPError`를 받으면 메시지에 서버 `resultMessage`가 있다.

ky 부분 mock에 `put`과 `delete`를 추가한다.

`src/services/skm/types.test.ts`에 추가: 위 표 응답 예제가 각 가드를 통과하고, 필수 필드(`keyId`, `deletionDateTime`, `keyStoreId`)가 빠지면 실패한다. `SkmAuthDeletion`은 `name`만 있어도 통과하고 `value`·`name`이 모두 없으면 실패한다.

## 검증

```bash
node_modules/.bin/vitest run src/services/skm/client.test.ts src/services/skm/types.test.ts
pnpm tsc --noEmit
pnpm test
pnpm run build
git diff --check
```

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/services/skm/types.ts` | 수정 |
| `src/services/skm/types.test.ts` | 수정 |
| `src/services/skm/client.ts` | 수정 |
| `src/services/skm/client.test.ts` | 수정 |
