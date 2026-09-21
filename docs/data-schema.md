# Data Schema: nhncloud-cli

## 파일 위치

```
~/.nhncloud/
  credentials.json   # 서비스별 appkey/secret (비밀): mode 0600
  config.json        # 기본 profile·출력 설정 (비밀 아님)

${XDG_DATA_HOME}/nhncloud-cli/             # XDG_DATA_HOME이 절대 경로일 때
~/.local/share/nhncloud-cli/               # XDG_DATA_HOME이 없거나 상대 경로일 때
  skills/
    {packageVersion}-{contentDigestHex}/
      SKILL.md
      references/...
      .nhncloud-skill.json

~/.claude/skills/
  nhncloud-cli -> <dataRoot>/skills/{packageVersion}-{contentDigestHex}/
```

자격증명과 설정을 분리한다 (AWS 방식).
비밀 파일은 owner-only 권한으로 생성한다.
`XDG_DATA_HOME`은 사용자별 애플리케이션 데이터의 기준 디렉터리를 지정하는 환경 변수이며, 설정되지 않으면 표준 기본값인 `~/.local/share`를 사용한다.

## 공개 스킬 매니페스트

`.nhncloud-skill.json`은 관리 저장소의 버전과 콘텐츠 정합성을 판정하는 메타데이터다.
외부 파일이므로 읽을 때 모든 필드를 타입 가드로 검증한다.

```typescript
interface NhnCloudSkillManifest {
  schemaVersion: 1;
  skillName: "nhncloud-cli";
  packageName: "@bifos/nhncloud-cli";
  packageVersion: string;
  contentDigest: `sha256:${string}`;
  installedAt: string;
  managedBy: "@bifos/nhncloud-cli";
}
```

콘텐츠 해시는 다음 계약으로 계산한다.

1. `.nhncloud-skill.json`을 제외한 `SKILL.md`와 `references/` 아래 정규 파일만 포함한다.
2. 심볼릭 링크와 정규 파일이 아닌 항목은 거부한다.
3. 상대 경로는 `/` 구분자로 정규화하고 코드 포인트 순으로 정렬한다.
4. 해시 입력은 UTF-8 바이트 `nhncloud-skill-content-v1\0`으로 시작한다.
5. 각 파일의 상대 경로와 콘텐츠는 unsigned 64-bit big-endian 길이로 경계를 구분한다.
6. 길이는 실제 UTF-8 바이트 길이로 계산하고 줄바꿈과 파일 내용은 정규화하지 않는다.

관리 저장소 이름은 패키지 버전과 전체 SHA-256 hex를 사용한다.
같은 저장소가 있으면 매니페스트와 실제 콘텐츠를 검증한 뒤 재사용한다.
새 저장소와 활성 링크는 각각 같은 파일시스템의 임시 경로에서 완성한 후 `rename`으로 교체한다.

`--force`로 사용자 항목이나 손상된 관리 저장소를 교체할 때는 같은 상위 디렉터리에 UTC 시각이 포함된 백업을 남긴다.
`uninstall`은 `~/.claude/skills/nhncloud-cli` 활성 링크만 제거하고 관리 저장소는 보존한다.

## credentials.json

profile 아래에 **profile 공통 UAK 와 서비스별 자격증명 블록**을 둔다 ([[adr-004]]).
UAK 는 개인/계정 단위라 OAuth 쓰는 서비스가 공유하고, 서비스별 블록은 프로젝트 appkey 같은 서비스 고유 값만 둔다.

```json
{
  "version": 1,
  "profiles": {
    "default": {
      "userAccessKey": {
        "id": "<user-access-key-id>",
        "secret": "<secret-access-key>"
      },
      "deploy": {
        "appkey": "<appkey>"
      },
      "logncrash": {
        "appkey": "<appkey>"
      },
      "ncr": {
        "appkey": "<appkey>"
      },
      "ncs": {
        "appkey": "<appkey>"
      },
      "apigateway": {
        "appkey": "<appkey>"
      },
      "iaas": {
        "tenantId": "<tenant-id>",
        "username": "<account-email>",
        "password": "<api-password>",
        "region": "kr1"
      }
    },
    "public-project": {
      "environment": "gov",
      "userAccessKey": { "id": "<uak-id>", "secret": "<uak-secret>" },
      "deploy": { "appkey": "<appkey>" }
    }
  }
}
```

- `userAccessKey`: profile 공통 개인 UAK. deploy·ncs·logncrash 검색·apigateway 등 OAuth 서비스가 공유 ([[adr-007]], [[adr-024]], [[adr-027]])
  - OAuth 로 교환한 `access_token` 을 `X-NHN-AUTHORIZATION: Bearer` 로 사용
- `deploy`: appkey 만. 인증 토큰은 `userAccessKey` OAuth 를 재사용한다(secret 불요, [[adr-033]])
  - 배포 좌표(`artifactId` 등)는 자격증명이 아니라 명령 옵션으로 받는다
- `logncrash`: appkey(path)만 저장한다. 검색 인증은 `userAccessKey` OAuth 토큰을 재사용한다. 기존 `secret` 필드는 마이그레이션 후 읽지 않는다 ([[adr-024]])
- `ncr`: Management API 경로에 넣을 appkey만 저장한다. 인증은 공통 UAK 정적 헤더를 사용하고 OAuth 토큰으로 교환하지 않는다 ([[adr-016]])
- `ncs`: appkey(path)만. 인증 토큰은 `userAccessKey` OAuth 를 재사용한다(secret 불요, [[adr-020]])
- `apigateway`: appkey(path)만. 인증 토큰은 `userAccessKey` OAuth 를 재사용하며 헤더 이름이 `X-NHN-Authorization` 이다(secret 불요, [[adr-027]])
- `iaas`: OpenStack Keystone 자격증명. instance 등 IaaS 서비스가 공유 ([[adr-010]])
  - `password` 는 NHN 콘솔 IAM 에서 별도 발급하는 API 비밀번호 (로그인 비밀번호가 아님)
  - `region`: `kr1` / `kr2` / `kr3` / `jp1` 중 하나. 명령의 `--region` 으로 override
- 예약 키 `userAccessKey`와 `environment` 외 키는 서비스명 = 서비스별 블록
- `environment: "gov"`: 공공망 profile에만 명시한다. 생략한 기존 profile은 일반망을 사용한다. 현재 공공망 endpoint 선택 대상은 OAuth, Deploy, NCR, IaaS다([[adr-037]]).

## config.json

```json
{
  "version": 1,
  "defaultProfile": "default"
}
```

- `defaultProfile`: `--profile` 미지정 시 사용할 profile
- CLI 동작 설정만 둔다. 자격증명은 credentials.json, 배포 좌표는 명령 옵션이다 ([[adr-033]])
- `deploy.targets` 는 폐지됐다. 남아 있으면 읽지 않고 경고로 옮기는 방법을 알린다

## 토큰 캐시

```
~/.nhncloud/cache/user-access-token-<profile>.json   # { accessToken, expiresAt, credentialHash }: mode 0600
~/.nhncloud/cache/iaas-token-<profile>-<region>.json   # { tokenId, expiresAt, credentialHash, computeEndpoint, imageEndpoint, networkEndpoint, blockStorageEndpoint, nksEndpoint }: mode 0600
```

- user-access-token: OAuth `access_token` 을 만료시각과 함께 저장한다 ([[adr-007]]).
  deploy·ncs·logncrash 검색·apigateway가 같은 계정 토큰이라 이 캐시를 공유한다
  ([[adr-020]], [[adr-024]], [[adr-027]]).
- iaas: Keystone token 과 region 별 정적 host 맵으로 구성한 compute·image·network·blockStorage·nks endpoint 캐시 ([[adr-005]], [[adr-010]], [[adr-013]], [[adr-019]])
- `credentialHash`: 발급 자격 배열을 `JSON.stringify`한 값의 SHA-256 지문이다. OAuth는 `[environment, uakId, uakSecret]`, IaaS는 `[environment, tenantId, username, password]`를 사용한다. 현재 자격이나 망 선택이 다르면 캐시를 무효화하고 다시 발급한다([[adr-021]], [[adr-037]]).
- 만료 전 재사용, 만료 시 재발급한다. logncrash 검색도 같은 user-access-token 캐시를 쓴다.

## profile 해석 순서

1. `--profile <name>` 옵션
2. 환경변수 `NHNCLOUD_PROFILE`
3. `config.json` 의 `defaultProfile`
4. 위 모두 없으면 `"default"`

자격증명 파일 손상과 존재하지 않는 profile은 원인을 보존한
`NhnCloudCliError(EXIT_CONFIG_ERROR)`로 종료한다.
NCR, NCS, API Gateway와 Deploy의 서비스 블록이나 필수 appkey가 없으면
같은 종료 코드와 함께 해당 서비스의 `configure` 명령을 안내한다.

## 캐시 범위

- logncrash search·export, deploy, ncs와 apigateway: 공통 OAuth access_token만 캐시한다. 검색 결과와 서비스 응답은 캐시하지 않는다.
- instance, network, volume, floatingip, loadbalancer와 nks: Keystone token과 compute·image·network·blockStorage·nks endpoint를 region별로 캐시한다.
- 목록성 데이터 캐시는 필요 시 후속 도입
