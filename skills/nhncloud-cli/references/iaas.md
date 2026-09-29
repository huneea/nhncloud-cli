# IaaS Reference

`instance`, `network`, `volume`, `floatingip`은 IaaS 자격증명과 Keystone token을 공유한다.
region이 중요하면 `--region <region>`을 명시한다.
공공망 profile에는 `"environment": "gov"`를 명시한다.
공식 문서에 endpoint가 있는 공공망 IaaS region은 `kr1`과 `kr2`다.

## IaaS 설정

`nhncloud configure`에서 IaaS 자격증명을 저장하거나 flag로 입력한다.

```bash
NHNCLOUD_IAAS_PASSWORD=<password> nhncloud configure \
  --iaas-tenant-id <tenant-id> \
  --iaas-username <username> \
  --iaas-region kr1 \
  --no-verify
```

`--iaas-password`는 NHN Cloud 로그인 비밀번호가 아니라 IAM API 비밀번호다.
`--iaas-username`은 계정 이메일 또는 IAM 계정 ID다.

## Discovery 순서

인스턴스 생성 전에는 조회 명령으로 id를 확인한다.

```bash
nhncloud commands --json | jq '.commands[] | select(.path|test("^(instance|network|volume|floatingip)"))'
nhncloud instance images --json
nhncloud instance flavors --detail --json
nhncloud network list --json
nhncloud instance keypairs --json
nhncloud instance availability-zones --json
```

생성/삭제/attach 전에는 profile과 region을 명시한다.

## Instance 조회와 생성

```bash
nhncloud instance list --json
nhncloud instance get <instance-id> --json
nhncloud instance create \
  --name web \
  --flavor <flavor-id> \
  --image <image-id> \
  --network <network-uuid> \
  --wait --json
```

`instance create --wait --quiet`는 ACTIVE 상태와 IP 할당을 기다린 뒤 IP를 출력한다.
GPU flavor 등 일부 flavor는 `--boot-volume-size <gb>`가 필요할 수 있다.
`--user-data <path>`는 cloud-init user-data를 base64로 인코딩해 주입하며, 인코딩 후 65535 byte 한도가 있다.

## Instance 작업

```bash
nhncloud instance delete <instance-id> --yes
nhncloud instance start <instance-id>
nhncloud instance stop <instance-id>
nhncloud instance reboot <instance-id> --hard
nhncloud instance resize <instance-id> --flavor <flavor-id>
nhncloud instance resize-confirm <instance-id>
nhncloud instance resize-revert <instance-id>
```

`resize` 후에는 `VERIFY_RESIZE`에서 멈춘다.
`resize-confirm`으로 확정하거나 `resize-revert`로 롤백한다.

## Keypair

```bash
nhncloud instance keypairs --json
nhncloud instance keypair get <name> --json
nhncloud instance keypair create <name> --output ./key.pem
nhncloud instance keypair delete <name>
```

`--public-key` 없이 생성하면 private key는 생성 시 한 번만 반환된다.
자동화에서는 `--output`으로 mode 0600 파일 저장을 권장한다.

## Network

```bash
nhncloud network list --json
nhncloud network subnet list --json
nhncloud network security-group list --json
nhncloud network security-group get <group> --json
nhncloud network security-group rule list <group> --json
nhncloud network security-group rule get <rule-id> --json
nhncloud network security-group ports <group> --json
nhncloud network security-group ports <group> --quiet   # 연결된 인스턴스 UUID
```

`instance create --network <uuid>`에는 `network list`의 VPC id를 사용한다.
subnet id가 아니다.

보안그룹 조회의 `<group>`에는 이름 또는 UUID를 지정한다.
이름이 중복되면 후보 UUID를 보여 주고 종료 코드 3으로 끝난다.
한 포트에 보안그룹이 여러 개면 모든 그룹의 허용 규칙이 함께 적용된다.
공유 그룹의 규칙을 바꾸면 그 그룹을 쓰는 모든 포트에 영향을 주므로 먼저 `ports`로 연결 대상을 확인한다.
`ports`의 `instance_name`은 Compute 인스턴스 목록에서 얻는다.
인스턴스 조회가 실패하면 이름 칸은 비어 있고 stderr에 경고가 남는다.

### 보안그룹 변경

```bash
nhncloud network security-group create --name <name> --description "<설명>"
nhncloud network security-group update <group> --name <new-name> --description "<설명>"
nhncloud network security-group delete <group> --yes
nhncloud network security-group rule create <group> --direction ingress --protocol tcp --port 22 --cidr <admin-cidr>
nhncloud network security-group rule delete <rule-id> --yes
nhncloud instance security-group add <instance-id> <group> --yes
nhncloud instance security-group remove <instance-id> <group> --yes
```

- 그룹을 만들면 송신 기본 규칙(IPv4, IPv6)이 자동으로 포함된다.
- `rule create`의 `--direction`은 `ingress` 또는 `egress`이고 필수다.
- `--protocol`은 `tcp`, `udp`, `icmp`, `any` 중 하나다.
- 포트(`--port` 또는 `--port-range <start-end>`)는 `tcp`와 `udp`에만 지정할 수 있다.
- `--cidr`(IPv4 주소나 CIDR)와 `--remote-group` 중 하나만 쓴다. 함께 지정하면 거부된다.
- 규칙 수정 API가 없다. 규칙을 교체하려면 새 규칙을 먼저 만들고 옛 규칙을 지운다.
  두 단계라 중간에 실패하면 두 규칙이 함께 남거나 허용이 빠질 수 있으므로, 각 단계 뒤 `rule list`로 확인한다.
- 그룹 삭제는 연결된 포트가 있으면 거부된다.
  다른 그룹 규칙이 삭제할 그룹을 원격 그룹으로 참조하고 있어도 삭제는 진행되고 경고만 남는다.
- 인스턴스 연결 변경(`add`, `remove`)은 같은 이름의 그룹이 둘 이상이면 요청 전에 거부된다.
  한쪽 이름을 `update --name`으로 먼저 바꾼다.
- 연결 변경 뒤 `경고: 요청은 접수됐지만 ...`이 stderr에 나오면 요청은 접수된 것이다.
  다시 실행하지 말고 `network security-group ports <group>`으로 반영을 확인한다. 이때 종료 코드는 0이다.

#### 공유 그룹을 쓰는 개발 DB를 전용 그룹으로 분리

```bash
nhncloud network security-group ports <shared-group> --json          # 공유 그룹을 쓰는 인스턴스 확인
nhncloud network security-group rule list <shared-group> --json      # 옮길 규칙 확인
nhncloud network security-group create --name dev-db --description "개발 DB 전용" --quiet
nhncloud network security-group rule create dev-db --direction ingress --protocol tcp --port 22 --cidr <admin-cidr>
nhncloud network security-group rule create dev-db --direction ingress --protocol tcp --port 5432 --remote-group <app-group>
nhncloud instance security-group add <db-instance-id> dev-db --yes
nhncloud instance security-group remove <db-instance-id> <shared-group> --yes
nhncloud network security-group ports dev-db
```

- SSH 관리 경로를 새 그룹에 먼저 넣고 새 그룹을 연결한 뒤에 공유 그룹을 해제해야, 해제하는 사이에 접근이 끊기지 않는다.
- 송신 규칙은 그룹 생성 시 기본 규칙으로 보존되므로 따로 만들지 않는다.
- 복구: `nhncloud instance security-group add <db-instance-id> <shared-group> --yes`로 공유 그룹을 다시 연결한다.

## Volume

```bash
nhncloud volume list --json
nhncloud volume get <volume-id> --json
nhncloud volume create --size 50 --name my-volume
nhncloud volume create --size 50 --volume-type "General SSD" --availability-zone kr-pub-a
nhncloud instance volumes <instance-id> --json
nhncloud instance volume attach <instance-id> --volume <volume-id>
nhncloud instance volume detach <instance-id> <volume-id>
```

`volume create`, `attach`, `detach`는 쓰기 작업이다.
`--availability-zone <az>`에는 `instance availability-zones`의 `zoneName`을 지정한다.
인스턴스와 같은 AZ에 볼륨을 만들어 attach 시 AZ 불일치 400을 피할 수 있다.
`attach`는 `--volume <id>` 플래그를 쓰고, `detach`는 `<instanceId> <volumeId>` 위치 인수를 쓴다.

## Floating IP

```bash
nhncloud floatingip list --json
nhncloud floatingip create --json
nhncloud floatingip create --network <network-uuid> --json
nhncloud floatingip delete <floatingip-id> --yes
```

`floatingip create --quiet`는 발급된 Floating IP id를 출력한다.
`floatingip associate`는 instance→port_id 매핑 경로 미확정으로 아직 제공하지 않는다.
