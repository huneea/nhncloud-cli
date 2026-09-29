import { describe, expect, it } from "vitest";
import { EXIT_PARAM_ERROR } from "../utils/exit-codes.js";
import { requireResourceInput, resolveFromList } from "./resource-resolver.js";

describe("공용 리소스 해석", () => {
  const resources = [
    { id: "id-b", name: "shared" },
    { id: "id-a", name: "shared" },
    { id: "id-c", name: "unique" },
    { id: "id-d", name: "id-c" },
  ];

  it("이름보다 일치하는 UUID를 우선한다", () => {
    expect(resolveFromList(resources, "id-c", "보안그룹")).toBe("id-c");
  });

  it("단일 이름을 UUID로 해석한다", () => {
    expect(resolveFromList(resources, "unique", "보안그룹")).toBe("id-c");
  });

  it("없는 이름과 중복 이름은 입력 오류로 거부한다", () => {
    expect(() => resolveFromList(resources, "missing", "보안그룹")).toThrowError(/찾을 수 없습니다/);
    expect(() => resolveFromList(resources, "missing", "보안그룹")).toThrowError(
      expect.objectContaining({ exitCode: EXIT_PARAM_ERROR }),
    );
    expect(() => resolveFromList(resources, "shared", "보안그룹")).toThrowError(
      expect.objectContaining({ exitCode: EXIT_PARAM_ERROR, message: expect.stringContaining("id-a, id-b") }),
    );
  });

  it("입력은 trim하고 공백만 있으면 거부한다", () => {
    expect(requireResourceInput("  a  ", "보안그룹")).toBe("a");
    expect(() => requireResourceInput("   ", "보안그룹")).toThrowError(
      expect.objectContaining({ exitCode: EXIT_PARAM_ERROR }),
    );
  });
});
