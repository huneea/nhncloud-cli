import { describe, expect, it } from "vitest";
import { EXIT_PARAM_ERROR } from "../utils/exit-codes.js";
import { parseConfigureEnvironment, resolveConfigureEnvironment } from "./configure-environment.js";

describe("parseConfigureEnvironment", () => {
  it("private 는 일반망(real), gov 는 공공망으로 받고 나머지는 사용법 오류다", () => {
    expect(parseConfigureEnvironment("private")).toBe("real");
    expect(parseConfigureEnvironment("gov")).toBe("gov");
    for (const value of ["real", "GOV", ""]) {
      expect(() => parseConfigureEnvironment(value)).toThrow(expect.objectContaining({ exitCode: EXIT_PARAM_ERROR }));
    }
  });
});

describe("resolveConfigureEnvironment", () => {
  it("기존 profile 과 다른 망은 거부하고, 같거나 새 profile 이면 망을 정한다", () => {
    expect(() => resolveConfigureEnvironment("p", "real", "gov")).toThrow(
      expect.objectContaining({ exitCode: EXIT_PARAM_ERROR }),
    );
    expect(() => resolveConfigureEnvironment("p", "gov", "real")).toThrow(
      expect.objectContaining({ exitCode: EXIT_PARAM_ERROR }),
    );
    expect(resolveConfigureEnvironment("p", "gov", "gov")).toBe("gov");
    expect(resolveConfigureEnvironment("p", "gov", undefined)).toBe("gov");
    expect(resolveConfigureEnvironment("p", undefined, "gov")).toBe("gov");
    expect(resolveConfigureEnvironment("p", undefined, undefined)).toBe("real");
  });
});
