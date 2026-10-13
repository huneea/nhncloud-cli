import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";

export type SecretObject = Record<string, unknown>;

const NUMBER_LITERAL = /-?\d+(\.\d+)?([eE][+-]?\d+)?/y;
const MAX_SIGNIFICANT_DIGITS = 15;

/** JSON 객체(배열·null 제외)면 그 객체를, 아니면 null 을 돌려준다. 던지지 않는다. */
export function tryParseSecretObject(text: string): SecretObject | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  return parsed as SecretObject;
}

/** tryParseSecretObject 가 null 이면 오류를 던진다. JSON.parse 의 오류 문구와 원문은 싣지 않는다. */
export function parseSecretObject(text: string, usage: string): SecretObject {
  const object = tryParseSecretObject(text);
  if (object === null) {
    throw new NhnCloudCliError(`기밀 데이터 값이 JSON 객체가 아니어서 ${usage}를 쓸 수 없습니다.`, EXIT_PARAM_ERROR);
  }
  return object;
}

function isLossyLiteral(literal: string): boolean {
  const value = Number(literal);
  if (!Number.isFinite(value) || Object.is(value, -0)) return true;
  if (/^-?\d+$/.test(literal)) return !Number.isSafeInteger(value);
  const mantissa = literal.replace(/^-/, "").replace(/[eE].*$/, "").replace(".", "");
  return mantissa.replace(/^0+/, "").replace(/0+$/, "").length > MAX_SIGNIFICANT_DIGITS;
}

/** 원문의 숫자 리터럴 가운데 JSON.parse 뒤 다시 쓰면 값이 바뀌는 것이 있는가. */
export function hasLossyNumber(text: string): boolean {
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      i += 1;
      while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      i += 1;
      continue;
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      NUMBER_LITERAL.lastIndex = i;
      const match = NUMBER_LITERAL.exec(text);
      if (match === null) {
        i += 1;
        continue;
      }
      if (isLossyLiteral(match[0])) return true;
      i += match[0].length;
      continue;
    }
    i += 1;
  }
  return false;
}

/** 정밀도를 잃는 숫자가 있으면 오류를 던진다. */
export function assertNoLossyNumber(text: string, usage: string): void {
  if (hasLossyNumber(text)) {
    throw new NhnCloudCliError(
      `기밀 데이터에 다시 쓰면 값이 바뀌는 숫자가 있어 ${usage}를 쓸 수 없습니다. 전체 값은 secret get과 secret update로 다루세요.`,
      EXIT_PARAM_ERROR,
    );
  }
}

/** 문자열이면 그대로, 그 밖의 값은 JSON.stringify 결과를 돌려준다. */
export function formatFieldValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** 빈 문자열이면 오류를 던지고, 아니면 그대로 돌려준다. */
export function parseFieldName(value: string, label: string): string {
  if (value === "") {
    throw new NhnCloudCliError(`${label}는 비어 있을 수 없습니다.`, EXIT_PARAM_ERROR);
  }
  return value;
}
