import { NhnCloudCliError } from "../utils/errors.js";
import { EXIT_API_ERROR, EXIT_PARAM_ERROR } from "../utils/exit-codes.js";
import type { CloudEnvironment } from "../config/types.js";

/**
 * 일반망 서비스 endpoint. 공공망은 공식 주소가 확인된 서비스만 별도 등록한다.
 */
const ENDPOINTS: Record<string, string> = {
  logncrash: "https://api-lncs-search.nhncloudservice.com",
  "logncrash-collector": "https://api-logncrash.nhncloudservice.com",
  deploy: "https://api-deploy.nhncloudservice.com",
  skm: "https://api-keymanager.nhncloudservice.com",
};
const GOV_ENDPOINTS: Record<string, string> = {
  deploy: "https://api-tcd.gov-nhncloudservice.com",
  skm: "https://api-keymanager.gov-nhncloudservice.com",
};

/**
 * 서비스명에 해당하는 엔드포인트를 반환한다.
 * 미등록 서비스는 NhnCloudCliError 를 던진다.
 */
export function endpointFor(service: string, environment: CloudEnvironment = "real"): string {
  const endpoints = environment === "gov" ? GOV_ENDPOINTS : ENDPOINTS;
  const endpoint = endpoints[service];
  if (!endpoint) {
    throw new NhnCloudCliError(
      `등록되지 않은 서비스입니다: "${service}". 지원 서비스: ${Object.keys(endpoints).join(", ")}`,
      EXIT_API_ERROR,
    );
  }
  return endpoint;
}

// ── Instance (OpenStack Nova v2 호환) ─────────────────────────────────────────

/**
 * Keystone v2 토큰 발급 엔드포인트 (ADR-010).
 */
export function keystoneIdentityUrl(environment: CloudEnvironment = "real"): string {
  return `https://api-identity-infrastructure.${environment === "gov" ? "gov-" : ""}nhncloudservice.com/v2.0/tokens`;
}

const GOV_IAAS_REGIONS = ["kr1", "kr2"];

function govIaasHost(region: string, service: string): string {
  if (!GOV_IAAS_REGIONS.includes(region)) {
    throw new NhnCloudCliError(`지원하지 않는 공공망 IaaS region 입니다: "${region}". 사용 가능한 region: ${GOV_IAAS_REGIONS.join(", ")}`, EXIT_PARAM_ERROR);
  }
  return `${region}-api-${service}-infrastructure.gov-nhncloudservice.com`;
}

/**
 * region → instance(compute) API host 맵 (ADR-010, ADR-005).
 * compute·image·network 세 IaaS host 맵의 region key 집합은 서로 일치해야 한다.
 */
const INSTANCE_HOST: Record<string, string> = {
  kr1: "kr1-api-instance-infrastructure.nhncloudservice.com",
  kr2: "kr2-api-instance-infrastructure.nhncloudservice.com",
  kr3: "kr3-api-instance-infrastructure.nhncloudservice.com",
  jp1: "jp1-api-instance-infrastructure.nhncloudservice.com",
};

/**
 * region → image(Glance v2) API host 맵 (ADR-013, ADR-005 연장).
 * image 서비스는 compute 와 다른 host 지만 같은 Keystone 토큰을 재사용한다.
 * compute·image·network 세 IaaS host 맵의 region key 집합은 서로 일치해야 한다.
 * 실측 확정 (2026-06-09): kr1/kr2 를 Keystone serviceCatalog publicURL 로 확인.
 * kr3/jp1 은 같은 host 패턴으로 추가.
 * Glance v2 경로는 tenant segment 없음 — GET /v2/images → 200, /v2/{tenantId}/images → 404 (실측 확정).
 */
const IMAGE_HOST: Record<string, string> = {
  kr1: "kr1-api-image-infrastructure.nhncloudservice.com",
  kr2: "kr2-api-image-infrastructure.nhncloudservice.com",
  kr3: "kr3-api-image-infrastructure.nhncloudservice.com",
  jp1: "jp1-api-image-infrastructure.nhncloudservice.com",
};

/**
 * region → network(NHN VPC) API host 맵 (ADR-013, ADR-005 연장).
 * network 서비스는 compute·image 와 다른 host 지만 같은 Keystone 토큰을 재사용한다.
 * NHN VPC 는 raw Neutron(/v2.0/networks)이 아니라 NHN 고유 /v2.0/vpcs·/v2.0/vpcsubnets 다.
 * compute·image·network 세 IaaS host 맵의 region key 집합은 서로 일치해야 한다.
 * 실측 확정 (2026-06-11): kr1/kr2 를 Keystone serviceCatalog publicURL 로 확인 (neutron 서비스).
 * kr3/jp1 은 같은 host 패턴으로 추가.
 * NHN VPC 경로는 tenant segment 없음 — GET /v2.0/vpcs → 200 (실측 확정).
 */
const NETWORK_HOST: Record<string, string> = {
  kr1: "kr1-api-network-infrastructure.nhncloudservice.com",
  kr2: "kr2-api-network-infrastructure.nhncloudservice.com",
  kr3: "kr3-api-network-infrastructure.nhncloudservice.com",
  jp1: "jp1-api-network-infrastructure.nhncloudservice.com",
};

/**
 * region → Block Storage(Cinder volumev2) API host 맵 (ADR-013, ADR-005 연장).
 * block storage 는 compute 와 다른 host 지만 같은 Keystone 토큰을 재사용한다.
 * 경로는 compute 와 동일하게 /v2/{tenantId}/... 형태(tenant 포함) — image(Glance)와 다르다.
 * host 패턴은 NHN Cloud docs 기준 **추론**(serviceCatalog publicURL 실측 미완) — 첫 호출 200 으로 확인 예정 (1-27). image/network 의 실측 확정과 톤 구분.
 * region key 집합은 INSTANCE_HOST(및 IMAGE/NETWORK_HOST)와 일치해야 한다 (모두 IaaS region).
 */
const BLOCKSTORAGE_HOST: Record<string, string> = {
  kr1: "kr1-api-block-storage-infrastructure.nhncloudservice.com",
  kr2: "kr2-api-block-storage-infrastructure.nhncloudservice.com",
  kr3: "kr3-api-block-storage-infrastructure.nhncloudservice.com",
  jp1: "jp1-api-block-storage-infrastructure.nhncloudservice.com",
};

/** IaaS region 목록 — compute·image·network·blockstorage 공통. region 추가 시 네 host 맵을 함께 갱신한다. */
const IAAS_REGIONS = Object.keys(INSTANCE_HOST).join(", ");

/**
 * region → NKS(container-infra) API host 맵 (ADR-019).
 * 공식 NKS Public API 문서가 endpoint 를 제시한 kr1/kr2/kr3 만 지원한다.
 * jp1 은 기존 IaaS host 패턴으로 유추하지 않고, 공식 문서 또는 200 실측 후 추가한다.
 */
const NKS_HOST: Record<string, string> = {
  kr1: "kr1-api-kubernetes-infrastructure.nhncloudservice.com",
  kr2: "kr2-api-kubernetes-infrastructure.nhncloudservice.com",
  kr3: "kr3-api-kubernetes-infrastructure.nhncloudservice.com",
};

// ── NCR (NHN Container Registry, Harbor 기반) ──────────────────────────────────

/**
 * region → NCR Management API host 맵 (ADR-016, ADR-005 연장).
 * NCR region 은 IaaS region 과 별개 축 — 단일 소스 NCR_HOST.
 * jp1 등은 host 패턴 실측 전까지 추가하지 않는다(kr1~kr3 만 검증).
 * 실측 pending(ADR-016): host 패턴 첫 200 응답으로 확정.
 */
const NCR_HOST: Record<string, string> = {
  kr1: "kr1-ncr.api.nhncloudservice.com",
  kr2: "kr2-ncr.api.nhncloudservice.com",
  kr3: "kr3-ncr.api.nhncloudservice.com",
};

/**
 * region 에 해당하는 NCR Management API host 를 반환한다.
 * 미등록 region 은 사용 가능한 region 목록 안내와 함께 EXIT_PARAM_ERROR 를 던진다.
 */
export function ncrHost(region: string, environment: CloudEnvironment = "real"): string {
  if (environment === "gov") {
    if (region !== "kr1") throw new NhnCloudCliError(`지원하지 않는 공공망 NCR region 입니다: "${region}". 사용 가능한 region: kr1`, EXIT_PARAM_ERROR);
    return "kr1-ncr.api.gov-nhncloudservice.com";
  }
  const host = NCR_HOST[region];
  if (!host) {
    throw new NhnCloudCliError(
      `지원하지 않는 NCR region 입니다: "${region}". 사용 가능한 region: ${Object.keys(NCR_HOST).join(", ")}`,
      EXIT_PARAM_ERROR,
    );
  }
  return host;
}

/**
 * region 에 해당하는 instance API host 를 반환한다.
 * 미등록 region 은 사용 가능한 region 목록 안내와 함께 EXIT_PARAM_ERROR 를 던진다.
 */
export function instanceHost(region: string, environment: CloudEnvironment = "real"): string {
  if (environment === "gov") return govIaasHost(region, "instance");
  const host = INSTANCE_HOST[region];
  if (!host) {
    throw new NhnCloudCliError(
      `지원하지 않는 region 입니다: "${region}". 사용 가능한 region: ${IAAS_REGIONS}`,
      EXIT_PARAM_ERROR,
    );
  }
  return host;
}

/**
 * region 에 해당하는 image API host 를 반환한다.
 * 미등록 region 은 EXIT_PARAM_ERROR.
 */
export function imageHost(region: string, environment: CloudEnvironment = "real"): string {
  if (environment === "gov") return govIaasHost(region, "image");
  const host = IMAGE_HOST[region];
  if (!host) {
    throw new NhnCloudCliError(
      `지원하지 않는 region 입니다: "${region}". 사용 가능한 region: ${IAAS_REGIONS}`,
      EXIT_PARAM_ERROR,
    );
  }
  return host;
}

/**
 * region 에 해당하는 network API host 를 반환한다.
 * 미등록 region 은 EXIT_PARAM_ERROR.
 */
export function networkHost(region: string, environment: CloudEnvironment = "real"): string {
  if (environment === "gov") return govIaasHost(region, "network");
  const host = NETWORK_HOST[region];
  if (!host) {
    throw new NhnCloudCliError(
      `지원하지 않는 region 입니다: "${region}". 사용 가능한 region: ${IAAS_REGIONS}`,
      EXIT_PARAM_ERROR,
    );
  }
  return host;
}

/**
 * region 에 해당하는 Block Storage API host 를 반환한다.
 * 미등록 region 은 EXIT_PARAM_ERROR.
 */
export function blockStorageHost(region: string, environment: CloudEnvironment = "real"): string {
  if (environment === "gov") return govIaasHost(region, "block-storage");
  const host = BLOCKSTORAGE_HOST[region];
  if (!host) {
    throw new NhnCloudCliError(
      `지원하지 않는 region 입니다: "${region}". 사용 가능한 region: ${IAAS_REGIONS}`,
      EXIT_PARAM_ERROR,
    );
  }
  return host;
}

/**
 * region 에 해당하는 NKS(container-infra) API host 를 반환한다.
 * 미등록 region 은 EXIT_PARAM_ERROR.
 */
export function nksHost(region: string, environment: CloudEnvironment = "real"): string {
  if (environment === "gov") return govIaasHost(region, "kubernetes");
  const host = NKS_HOST[region];
  if (!host) {
    throw new NhnCloudCliError(
      `지원하지 않는 NKS region 입니다: "${region}". 사용 가능한 region: ${Object.keys(NKS_HOST).join(", ")}`,
      EXIT_PARAM_ERROR,
    );
  }
  return host;
}

// ── NCS (NHN Container Service) ────────────────────────────────────────────────

/**
 * region → NCS API host 맵 (ADR-020).
 * 공식 NCS Public API 문서가 제시한 region 은 kr1(판교)·kr3(광주)뿐이다 — kr2·jp1 은 없다.
 */
const NCS_HOST: Record<string, string> = {
  kr1: "kr1-ncs.api.nhncloudservice.com",
  kr3: "kr3-ncs.api.nhncloudservice.com",
};

/**
 * region 에 해당하는 NCS API host 를 반환한다.
 * 미등록 region 은 사용 가능한 region 목록 안내와 함께 EXIT_PARAM_ERROR 를 던진다.
 */
export function ncsHost(region: string): string {
  const host = NCS_HOST[region];
  if (!host) {
    throw new NhnCloudCliError(
      `지원하지 않는 NCS region 입니다: "${region}". 사용 가능한 region: ${Object.keys(NCS_HOST).join(", ")}`,
      EXIT_PARAM_ERROR,
    );
  }
  return host;
}

// ── API Gateway ──────────────────────────────────────────────────────────────

/**
 * region → API Gateway API host 맵 (ADR-027).
 * kr1·kr2·kr3 모두 실제 호출로 확인된 host 만 등록한다.
 */
const APIGATEWAY_HOST: Record<string, string> = {
  kr1: "kr1-apigateway.api.nhncloudservice.com",
  kr2: "kr2-apigateway.api.nhncloudservice.com",
  kr3: "kr3-apigateway.api.nhncloudservice.com",
};

/**
 * region 에 해당하는 API Gateway API host 를 반환한다.
 * 미등록 region 은 사용 가능한 region 목록 안내와 함께 EXIT_PARAM_ERROR 를 던진다.
 */
export function apigatewayHost(region: string): string {
  const host = APIGATEWAY_HOST[region];
  if (!host) {
    throw new NhnCloudCliError(
      `지원하지 않는 API Gateway region 입니다: "${region}". 사용 가능한 region: ${Object.keys(APIGATEWAY_HOST).join(", ")}`,
      EXIT_PARAM_ERROR,
    );
  }
  return host;
}
