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
```

`instance create --network <uuid>`에는 `network list`의 VPC id를 사용한다.
subnet id가 아니다.

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

## 에러 코드

| 상황 | exit code |
|------|-----------|
| IaaS 자격증명 누락 또는 불완전 | 4 |
| Keystone 인증 실패 | 2 |
| 미등록 region, 필수 옵션 누락, `--yes` 누락 | 3 |
| API 오류 또는 wait timeout | 1 |
