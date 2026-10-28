import { keyManagerHost } from "../../api/endpoints.js";
import { output, type OutputOptions } from "../../formatters/table.js";
import {
  CertificateClient,
  refId,
  type CertificateContainer,
} from "../../services/loadbalancer/certificate-client.js";
import type { LoadBalancerClient } from "../../services/loadbalancer/client.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { startSpinner, stopSpinner } from "../../utils/spinner.js";
import { resolveIaasTokenContext, type IaasResolverOpts } from "../iaas.js";
import { requireResourceInput, resolveFromList } from "../resource-resolver.js";
import type { WriteModeOpts } from "../write-mode.js";

export { requireWriteMode, outputDryRun, type PlannedRequest } from "../write-mode.js";

// 리스너, 풀, 멤버, 헬스 모니터, L7, 인증서 명령이 함께 쓰는 해석·출력 도우미 (ADR-048).

export interface LbaasGlobalOpts extends OutputOptions {
  region?: string;
  profile?: string;
}

export interface WriteGlobalOpts extends LbaasGlobalOpts, WriteModeOpts {}

export function parseEnumOption<T extends string>(
  value: string,
  allowed: readonly T[],
  flag: string,
): T {
  const normalized = value.trim().toUpperCase();
  const matched = allowed.find((item) => item === normalized);
  if (!matched) {
    throw new NhnCloudCliError(
      `${flag}은(는) ${allowed.join(", ")} 중 하나여야 합니다: ${JSON.stringify(value)}`,
      EXIT_PARAM_ERROR,
    );
  }
  return matched;
}

/** 선택 옵션의 값이 비었으면 자격증명을 읽기 전에 입력 오류로 끝낸다. */
export function optionalInput(value: string | undefined, flag: string): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed) {
    throw new NhnCloudCliError(`${flag} 값이 비어 있습니다.`, EXIT_PARAM_ERROR);
  }
  return trimmed;
}

export async function withSpinner<T>(text: string, run: () => Promise<T>): Promise<T> {
  startSpinner(text);
  try {
    const result = await run();
    stopSpinner(true);
    return result;
  } catch (error) {
    stopSpinner(false);
    throw error;
  }
}

export function outputFields(
  opts: OutputOptions,
  rows: [string, string][],
  raw: unknown,
  ids: string[],
): void {
  output(opts, { headers: ["field", "value"], rows, raw, ids });
}

export function outputDeleted(
  opts: OutputOptions,
  operation: string,
  fields: Record<string, string>,
  id: string,
): void {
  const result = { operation, status: "succeeded", ...fields };
  outputFields(
    opts,
    Object.entries(result).map(([key, value]) => [key, value]),
    result,
    [id],
  );
}

export function joinIds(items: { id: string }[] | undefined): string {
  return (items ?? []).map((item) => item.id).join(", ");
}

export function textOrEmpty(value: string | number | boolean | null | undefined): string {
  return value === undefined || value === null ? "" : String(value);
}

/** 이름이 없는 리소스(멤버, 헬스 모니터, L7 규칙)는 UUID 만 받는다. */
export function requireUuidInput(value: string, label: string): string {
  return requireResourceInput(value, `${label} UUID`);
}

export async function resolveListenerId(
  client: Pick<LoadBalancerClient, "listListeners">,
  value: string,
): Promise<string> {
  const input = requireResourceInput(value, "리스너");
  return resolveFromList(await client.listListeners(), input, "리스너");
}

export async function resolvePoolId(
  client: Pick<LoadBalancerClient, "listPools">,
  value: string,
): Promise<string> {
  const input = requireResourceInput(value, "풀");
  return resolveFromList(await client.listPools(), input, "풀");
}

export async function resolveL7PolicyId(
  client: Pick<LoadBalancerClient, "listL7Policies">,
  value: string,
): Promise<string> {
  const input = requireResourceInput(value, "L7 정책");
  return resolveFromList(await client.listL7Policies(), input, "L7 정책");
}

/** key-manager 주소는 Keystone 캐시에 두지 않고 region 과 망으로 만든다 (ADR-048). */
export async function resolveCertificateClient(
  opts: IaasResolverOpts,
): Promise<CertificateClient> {
  const { tokenId, region, environment } = await resolveIaasTokenContext(opts);
  return new CertificateClient(tokenId, `https://${keyManagerHost(region, environment)}/v1`);
}

function isContainerRefInput(value: string): boolean {
  return /^https:\/\//.test(value);
}

export function certificateContainerId(container: CertificateContainer): string {
  return refId(container.container_ref);
}

/** 컨테이너 이름, UUID, container_ref 주소를 container_ref 로 바꾼다. 주소는 조회하지 않고 그대로 쓴다. */
export async function resolveCertificateRefs(
  resolveClient: () => Promise<Pick<CertificateClient, "listCertificateContainers">>,
  values: string[],
): Promise<string[]> {
  const inputs = values.map((value) => requireResourceInput(value, "인증서"));
  if (inputs.every(isContainerRefInput)) return inputs;

  const containers = await (await resolveClient()).listCertificateContainers();
  const resources = containers.map((container) => ({
    id: certificateContainerId(container),
    name: container.name ?? "",
    ref: container.container_ref,
  }));
  return inputs.map((input) => {
    if (isContainerRefInput(input)) return input;
    const id = resolveFromList(resources, input, "인증서");
    const matched = resources.find((resource) => resource.id === id);
    if (!matched) {
      throw new NhnCloudCliError(`인증서를 찾을 수 없습니다: ${JSON.stringify(input)}`, EXIT_PARAM_ERROR);
    }
    return matched.ref;
  });
}
