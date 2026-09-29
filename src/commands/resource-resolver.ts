import { NhnCloudCliError } from "../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../utils/exit-codes.js";

export function requireResourceInput(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new NhnCloudCliError(`${label} 이름 또는 UUID가 필요합니다.`, EXIT_PARAM_ERROR);
  }
  return normalized;
}

export function requireYes(yes: boolean | undefined, operation: string): true {
  if (!yes) {
    throw new NhnCloudCliError(
      `${operation}에는 --yes 플래그가 필요합니다.`,
      EXIT_PARAM_ERROR,
    );
  }
  return true;
}

function resolvedId(resource: { id: string }, label: string): string {
  const id = resource.id.trim();
  if (!id) {
    throw new NhnCloudCliError(`${label} 조회 결과의 UUID가 비어 있습니다.`, EXIT_PARAM_ERROR);
  }
  return id;
}

export function resolveFromList<T extends { id: string; name: string }>(
  resources: T[],
  input: string,
  label: string,
): string {
  const exactId = resources.find((resource) => resource.id === input);
  if (exactId) return resolvedId(exactId, label);

  const nameMatches = resources.filter((resource) => resource.name === input);
  if (nameMatches.length === 1) return resolvedId(nameMatches[0], label);
  if (nameMatches.length === 0) {
    throw new NhnCloudCliError(
      `${label}을(를) 찾을 수 없습니다: ${JSON.stringify(input)}`,
      EXIT_PARAM_ERROR,
    );
  }

  const candidateIds = nameMatches.map((resource) => resolvedId(resource, label)).sort();
  throw new NhnCloudCliError(
    `${label} 이름이 중복됩니다: ${JSON.stringify(input)} (후보 UUID: ${candidateIds.join(", ")})`,
    EXIT_PARAM_ERROR,
  );
}
