import { describe, expect, it } from "vitest";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import {
  formatFieldValue,
  hasLossyNumber,
  parseFieldName,
  parseSecretObject,
  type PatchChange,
  planSecretPatch,
  serializeSecretObject,
  tryParseSecretObject,
  verifySecretPatch,
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

describe("serializeSecretObject", () => {
  it("한 줄 원문은 한 줄로 쓴다", () => {
    expect(serializeSecretObject({ a: "1", b: 2 }, '{ "a": "0", "b": 2 }')).toBe('{"a":"1","b":2}');
  });

  it("끝 줄바꿈만 있는 한 줄 원문도 한 줄로 쓴다", () => {
    expect(serializeSecretObject({ a: "1" }, '{"a":"0"}\n')).toBe('{"a":"1"}');
  });

  it("네 칸 들여쓰기와 끝 줄바꿈을 따른다", () => {
    expect(serializeSecretObject({ a: "1", b: "2" }, '{\n    "a": "1"\n}\n')).toBe(
      '{\n    "a": "1",\n    "b": "2"\n}\n',
    );
  });

  it("탭 들여쓰기 원문은 탭으로 쓰고 끝 줄바꿈이 없으면 붙이지 않는다", () => {
    expect(serializeSecretObject({ a: "1" }, '{\n\t"a": "0"\n}')).toBe('{\n\t"a": "1"\n}');
  });
});

describe("planSecretPatch", () => {
  const before = { db: "old", port: 5432 };
  const set = (value: string, replace = false): PatchChange => ({ kind: "set", value, replace });

  it("없는 필드는 끝에 붙인다", () => {
    const { action, after } = planSecretPatch(before, "user", set("u"));
    expect(action).toBe("added");
    expect(Object.keys(after)).toEqual(["db", "port", "user"]);
    expect(after).toEqual({ db: "old", port: 5432, user: "u" });
  });

  it("교체는 필드 자리를 지킨다", () => {
    const { action, after } = planSecretPatch(before, "db", set("new", true));
    expect(action).toBe("replaced");
    expect(Object.keys(after)).toEqual(["db", "port"]);
    expect(after).toEqual({ db: "new", port: 5432 });
  });

  it("같은 값은 replace 없이 unchanged다", () => {
    expect(planSecretPatch(before, "db", set("old"))).toEqual({ action: "unchanged", after: before });
  });

  it("값이 다른 기존 필드에 replace가 없으면 매개변수 오류다", () => {
    expect(() => planSecretPatch(before, "db", set("new"))).toThrow(
      expect.objectContaining({
        message: '필드 "db"가 이미 있습니다. 값을 바꾸려면 --replace를 붙이세요.',
        exitCode: EXIT_PARAM_ERROR,
      }),
    );
  });

  it("문자열이 아닌 기존 값은 같은 표기의 문자열과 다른 값으로 본다", () => {
    expect(() => planSecretPatch(before, "port", set("5432"))).toThrow(expect.objectContaining({ exitCode: EXIT_PARAM_ERROR }));
  });

  it("삭제는 필드를 빼고, 없는 필드 삭제는 unchanged다", () => {
    expect(planSecretPatch(before, "db", { kind: "delete" })).toEqual({ action: "deleted", after: { port: 5432 } });
    expect(planSecretPatch(before, "none", { kind: "delete" })).toEqual({ action: "unchanged", after: before });
  });

  it("__proto__ 필드를 더하면 자기 속성이 되고 프로토타입은 그대로다", () => {
    const { action, after } = planSecretPatch(before, "__proto__", set("x"));
    expect(action).toBe("added");
    expect(Object.hasOwn(after, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(after)).toBe(Object.prototype);
    expect(JSON.stringify(after)).toBe('{"db":"old","port":5432,"__proto__":"x"}');
  });
});

describe("verifySecretPatch", () => {
  const before = { db: "old", port: 5432, opts: { a: [1] } };
  const set: PatchChange = { kind: "set", value: "new", replace: true };

  it("필드 값과 다른 필드가 기대와 같으면 둘 다 참이다", () => {
    expect(verifySecretPatch(before, { db: "new", port: 5432, opts: { a: [1] } }, "db", set)).toEqual({
      fieldVerified: true,
      othersVerified: true,
    });
  });

  it("필드 값이 다르면 fieldVerified만 거짓이다", () => {
    expect(verifySecretPatch(before, { db: "other", port: 5432, opts: { a: [1] } }, "db", set)).toEqual({
      fieldVerified: false,
      othersVerified: true,
    });
  });

  it("문자열이 아닌 필드 값은 일치로 보지 않는다", () => {
    expect(verifySecretPatch(before, { db: ["new"], port: 5432, opts: { a: [1] } }, "db", set).fieldVerified).toBe(false);
  });

  it("다른 필드 값이 바뀌면 othersVerified가 거짓이다", () => {
    expect(verifySecretPatch(before, { db: "new", port: 5433, opts: { a: [1] } }, "db", set)).toEqual({
      fieldVerified: true,
      othersVerified: false,
    });
    expect(verifySecretPatch(before, { db: "new", port: 5432, opts: { a: [2] } }, "db", set).othersVerified).toBe(false);
  });

  it("다른 필드가 더해지거나 빠지면 othersVerified가 거짓이다", () => {
    expect(
      verifySecretPatch(before, { db: "new", port: 5432, opts: { a: [1] }, extra: "x" }, "db", set).othersVerified,
    ).toBe(false);
    expect(verifySecretPatch(before, { db: "new", port: 5432 }, "db", set).othersVerified).toBe(false);
  });

  it("다시 조회한 값이 JSON 객체가 아니면 둘 다 거짓이다", () => {
    expect(verifySecretPatch(before, null, "db", set)).toEqual({ fieldVerified: false, othersVerified: false });
  });

  it("삭제는 필드가 없어야 참이다", () => {
    const remove: PatchChange = { kind: "delete" };
    expect(verifySecretPatch(before, { port: 5432, opts: { a: [1] } }, "db", remove)).toEqual({
      fieldVerified: true,
      othersVerified: true,
    });
    expect(verifySecretPatch(before, before, "db", remove).fieldVerified).toBe(false);
  });
});
