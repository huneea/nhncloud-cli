# NKS Reference

`nks` 명령군은 NHN Kubernetes Service를 관리한다.
IaaS 자격증명으로 Keystone token을 발급하고 `container-infra` API를 호출한다.
지원 region은 `kr1`, `kr2`, `kr3`이다.

## Discovery 순서

```bash
nhncloud commands --json | jq '.commands[] | select(.path|startswith("nks"))'
nhncloud nks supports --json
nhncloud nks cluster list --json
nhncloud nks cluster get <cluster> --json
nhncloud nks nodegroup list <cluster> --json
```

클러스터 생성이나 변경 전에는 지원 Kubernetes version, flavor, network, 기존 cluster/nodegroup 상태를 먼저 조회한다.

## Cluster 조회

```bash
nhncloud nks cluster list --json
nhncloud nks cluster get <cluster> --json
nhncloud nks cluster events <cluster> --json
nhncloud nks cluster event <cluster> <event-uuid> --json
nhncloud nks cluster ipacl <cluster> --json
nhncloud nks cluster kubeconfig <cluster>
nhncloud nks cluster kubeconfig <cluster> --output ./kubeconfig
```

`events`는 `<cluster>`에 이름과 UUID를 모두 받는다.
NKS 이벤트 API 자체는 UUID만 받지만 CLI가 이름을 UUID로 해석한다.

`event` 단건 조회는 `events` 출력의 `uuid` 열 값을 넘긴다.
정수 `id`로는 조회되지 않는다.
`details`는 표에서 줄여 보여 주므로 전문은 `--json`으로 본다.

`kubeconfig`는 문자열을 stdout으로 출력하거나 `--output` 파일에 저장한다.

## Nodegroup 조회와 변경

```bash
nhncloud nks nodegroup list <cluster> --json
nhncloud nks nodegroup get <cluster> <nodegroup> --json
nhncloud nks nodegroup autoscale <cluster> <nodegroup> --json
nhncloud nks nodegroup create <cluster> --file ./nodegroup-create.json
nhncloud nks nodegroup delete <cluster> <nodegroup> --yes
nhncloud nks nodegroup stop-node <cluster> <nodegroup> --nodes node-1,node-2
nhncloud nks nodegroup start-node <cluster> <nodegroup> --nodes node-1,node-2
nhncloud nks nodegroup set-autoscale <cluster> <nodegroup> --file ./autoscale.json
nhncloud nks nodegroup set-metric-autoscale <cluster> <nodegroup> --file ./metric-autoscale.json
nhncloud nks nodegroup upgrade <cluster> <nodegroup> --kube-version v1.31.4
nhncloud nks nodegroup set-userscript <cluster> <nodegroup> --file ./userscript.sh
nhncloud nks nodegroup update-flavor <cluster> <nodegroup> --flavor <flavor-uuid>
nhncloud nks nodegroup set-fip-auto-bind <cluster> <nodegroup> --file ./fip-auto-bind.json
nhncloud nks nodegroup set-labels <cluster> <nodegroup> --file ./labels.json
```

`upgrade` 는 control plane 업그레이드에도 쓴다. 아래 "Cluster 업그레이드" 를 본다.

## Cluster 업그레이드

클러스터 버전 업그레이드에 별도 명령은 없다.
`nodegroup upgrade` 하나로 control plane 과 워커를 모두 올린다.

```bash
# 1. control plane — 노드그룹 이름을 default-master 로 지정한다
nhncloud nks nodegroup upgrade <cluster> default-master --kube-version v1.31.4

# 2. 워커 노드그룹 — 노드그룹마다 한 번씩 실행한다
nhncloud nks nodegroup upgrade <cluster> <nodegroup> --kube-version v1.31.4
```

순서는 정해져 있다.
control plane 을 먼저 올린 뒤에야 워커를 올릴 수 있다.

`default-master` 는 CLI 로 존재를 확인할 수 없다.

- `nodegroup list` 응답에 나오지 않는다.
- `nodegroup get <cluster> default-master` 는 403 으로 막혀 있다.

### 업그레이드 대상 판단

워커 노드그룹만 보면 최신인 것처럼 보인다.
control plane 이 먼저 올라가야 워커의 대상 버전이 생기기 때문이다.
그래서 `cluster get` 의 `labels` 를 함께 본다.

| 조회 대상 | `kube_version_status` | `upgradable_kube_versions` |
|---|---|---|
| 워커 노드그룹 | `LATEST` | `[]` |
| 클러스터 | `NEED_K8S_UPGRADE` | `["v1.33.4"]` |

위 값은 실측이다.
공식 문서는 `kube_version_status` 의 값 목록을 정의하지 않으므로 다른 값이 올 수 있다.

### 워커 업그레이드 중 서비스 영향 조절

두 옵션은 워커 업그레이드에만 의미가 있고 기본값은 모두 1이다.

- `--num-buffer-nodes <n>`: 축출된 파드를 다시 받아 줄 여유 노드 수. 업그레이드가 끝나면 자동 삭제되지만 그동안 인스턴스 요금이 청구된다. 0으로 두면 기존 노드만으로 재배치해야 해 실패 위험이 커진다.
- `--num-max-unavailable-nodes <n>`: 한 번에 서비스 불가 상태로 둘 노드 수. 크게 잡으면 빨라지고 가용성이 낮아진다.

### 사전 조건

- control plane 과 모든 워커 노드그룹의 Kubernetes 버전이 일치해야 한다.
- 마이너 버전 기준 한 단계씩만 올린다. 건너뛰기와 다운그레이드는 지원하지 않는다.
- 클러스터가 다른 작업으로 업데이트 중이면 업그레이드가 안 된다.
- NKS 레지스트리가 활성화되지 않은 클러스터는 업그레이드가 안 된다.
- 데몬셋 파드는 축출되지 않고, PodDisruptionBudget 설정 때문에 축출이 실패하면 업그레이드도 실패한다.

## Addon 조회와 변경

```bash
nhncloud nks addon-type list --json
nhncloud nks addon-type get <addon-type> --json
nhncloud nks addon list --k8s-version v1.30.1 --json
nhncloud nks addon get <addon> --json
nhncloud nks cluster addon list <cluster> --json
nhncloud nks cluster addon get <cluster> <addon> --json
nhncloud nks cluster addon install <cluster> --name coredns --addon-version 1.0.0 --resolve-conflicts overwrite
nhncloud nks cluster addon update <cluster> coredns --addon-version 1.0.1 --resolve-conflicts preserve
nhncloud nks cluster addon remove <cluster> coredns --yes
```

## Cluster 생성과 변경

복잡한 생성/설정 작업은 공식 API payload를 JSON 파일로 전달한다.
payload에는 민감값이 들어갈 수 있으므로 로그나 이슈에 그대로 붙이지 않는다.

```bash
nhncloud nks cluster create --file ./cluster-create.json
nhncloud nks cluster delete <cluster> --yes
nhncloud nks cluster resize <cluster> --nodegroup worker --node-count 3
nhncloud nks cluster set-ipacl <cluster> --file ./ipacl.json
nhncloud nks cluster renew-certificate <cluster> --term-of-validity 3
nhncloud nks cluster update-sgw <cluster> --ncr-sgw <uuid> --obs-sgw <uuid>
nhncloud nks cluster set-control-plane-log <cluster> --file ./control-plane-log.json
```

## JSON 출력

목록 조회는 배열 또는 목록 객체로 출력한다.
단건 조회와 설정 조회는 API raw 객체를 보존하는 쪽을 우선한다.
생성, resize, 설정 변경, 노드 action, 애드온 변경은 `{ uuid }` 응답을 반환한다.
삭제 명령은 성공 메시지만 stderr에 쓰고 stdout은 비운다.
