import { describe, expect, it } from "vitest";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import {
  formatFieldValue,
  hasLossyNumber,
  parseFieldName,
  parseSecretObject,
  tryParseSecretObject,
} from "./secret-json.js";

describe("tryParseSecretObject", () => {
  it("JSON 객체만 돌려준다", () => {
    expect(tryParseSecretObject('{"a":"1"}')).toEqual({ a: "1" });
    for (const text of ["[]", "null", '"s"', "1", "not json"]) {
      expect(tryParseSecretObject(text)).toBeNull();
    }
  });
});

describe("parseSecretObject", () => {
  it("깨진 원문의 오류 문구에 원문을 싣지 않는다", () => {
    let error: unknown;
    try {
      parseSecretObject('{"pw":"p@ss', "--field");
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect((error as Error).message).toContain("--field");
    expect((error as Error).message).not.toContain("p@ss");
  });
});

describe("hasLossyNumber", () => {
  it("안전한 숫자와 문자열 안의 긴 숫자는 통과시킨다", () => {
    expect(hasLossyNumber('{"a":1,"b":-2.5,"c":9007199254740991,"d":"12345678901234567890"}')).toBe(false);
  });

  it.each([
    '{"id":12345678901234567890}',
    '{"x":0.12345678901234567}',
    '{"x":1e400}',
    '{"x":-0}',
  ])("정밀도를 잃는 숫자를 찾는다: %s", (text) => {
    expect(hasLossyNumber(text)).toBe(true);
  });

  it("이스케이프된 따옴표 뒤의 문자열 안을 숫자로 읽지 않는다", () => {
    expect(hasLossyNumber('{"s":"a\\"1e400\\"","n":1}')).toBe(false);
  });
});

describe("formatFieldValue", () => {
  it("문자열은 그대로, 그 밖은 JSON 표기로 낸다", () => {
    expect(formatFieldValue("v")).toBe("v");
    expect(formatFieldValue({ k: 1 })).toBe('{"k":1}');
    expect(formatFieldValue(true)).toBe("true");
    expect(formatFieldValue(null)).toBe("null");
  });
});

describe("parseFieldName", () => {
  it("빈 문자열은 거절하고 공백은 지우지 않는다", () => {
    expect(() => parseFieldName("", "--field")).toThrow(/비어 있을 수 없습니다/);
    expect(parseFieldName(" a ", "--field")).toBe(" a ");
  });
});
