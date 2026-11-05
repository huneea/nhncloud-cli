import { NhnCloudCliError } from "../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../utils/exit-codes.js";
import type { CloudEnvironment } from "../config/types.js";

/** configure `--environment` 가 받는 값. 사용자에게는 일반망을 `private` 로 보인다. */
export const CONFIGURE_ENVIRONMENT_VALUES = ["private", "gov"] as const;

/** `--environment` 값을 내부 망 값으로 바꾼다. 받지 않는 값(`real` 포함)은 사용법 오류다. */
export function parseConfigureEnvironment(value: string): CloudEnvironment {
  if (value === "gov") return "gov";
  if (value === "private") return "real";
  throw new NhnCloudCliError(
    `--environment 는 ${CONFIGURE_ENVIRONMENT_VALUES.join(" 또는 ")} 이어야 합니다 (받은 값: ${value}).`,
    EXIT_PARAM_ERROR,
  );
}

/** 사용자에게 보이는 망 이름. */
export function describeEnvironment(environment: CloudEnvironment): string {
  return environment === "gov" ? "공공망(gov)" : "일반망(private)";
}

/**
 * configure 가 쓸 망을 정한다(ADR-037).
 * 기존 profile 과 다른 망을 요청하면 아무것도 저장하기 전에 사용법 오류로 멈춘다. 망을 옮기는 대신 새 profile 을 만든다.
 */
export function resolveConfigureEnvironment(
  profileName: string,
  stored: CloudEnvironment | undefined,
  requested: CloudEnvironment | undefined,
): CloudEnvironment {
  if (stored !== undefined && requested !== undefined && stored !== requested) {
    throw new NhnCloudCliError(
      `profile "${profileName}" 은 ${describeEnvironment(stored)} profile 입니다. ` +
        `${describeEnvironment(requested)} 으로 바꿀 수 없습니다. 다른 망은 새 profile 이름으로 설정하세요.`,
      EXIT_PARAM_ERROR,
    );
  }
  return stored ?? requested ?? "real";
}
