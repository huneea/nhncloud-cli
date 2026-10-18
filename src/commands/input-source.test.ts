import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EXIT_PARAM_ERROR } from "../utils/exit-codes.js";
import { decodeUtf8Input, readInputSource, type InputSourceSpec, type StdinSource } from "./input-source.js";

const spec: InputSourceSpec = { textFlag: "--plaintext", label: "암호화할 데이터", maxBytes: 3 };
const ttyStdin: StdinSource = {
  isTTY: true,
  read: () => {
    throw new Error("TTY stdin을 읽으면 안 된다");
  },
};
const pipedStdin = (data: Buffer): StdinSource => ({ isTTY: false, read: () => data });

describe("readInputSource", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "skm-input-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("직접 준 값은 끝 줄바꿈까지 그대로 Buffer로 돌려준다", () => {
    const input = readInputSource({ text: "a\n" }, spec, ttyStdin);
    expect(input).toEqual(Buffer.from([0x61, 0x0a]));
  });

  it("직접 값과 --file을 함께 주면 거부한다", () => {
    const file = join(dir, "in.txt");
    writeFileSync(file, "a");
    expect(() => readInputSource({ text: "a", file }, spec, ttyStdin)).toThrow(
      expect.objectContaining({
        message: "--plaintext와 --file은 함께 지정할 수 없습니다.",
        exitCode: EXIT_PARAM_ERROR,
      }),
    );
  });

  it("없는 파일은 읽을 수 없다는 오류로 거부한다", () => {
    const file = join(dir, "missing.txt");
    expect(() => readInputSource({ file }, spec, ttyStdin)).toThrow(
      expect.objectContaining({
        message: `암호화할 데이터 파일을 읽을 수 없습니다: ${file} (ENOENT)`,
        exitCode: EXIT_PARAM_ERROR,
      }),
    );
  });

  it("디렉터리 경로는 일반 파일이 아니라고 거부한다", () => {
    expect(() => readInputSource({ file: dir }, spec, ttyStdin)).toThrow(
      expect.objectContaining({
        message: `암호화할 데이터 파일이 일반 파일이 아닙니다: ${dir}`,
        exitCode: EXIT_PARAM_ERROR,
      }),
    );
  });

  it("한도를 넘는 파일은 읽기 전에 거부한다", () => {
    const file = join(dir, "big.txt");
    writeFileSync(file, "abcd");
    expect(() => readInputSource({ file }, spec, ttyStdin)).toThrow(
      expect.objectContaining({
        message: "암호화할 데이터가 너무 큽니다: 4바이트 (한도 3바이트).",
        exitCode: EXIT_PARAM_ERROR,
      }),
    );
  });

  it("한도를 넘는 직접 값과 stdin도 거부한다", () => {
    const expected = expect.objectContaining({
      message: "암호화할 데이터가 너무 큽니다: 4바이트 (한도 3바이트).",
      exitCode: EXIT_PARAM_ERROR,
    });
    expect(() => readInputSource({ text: "abcd" }, spec, ttyStdin)).toThrow(expected);
    expect(() => readInputSource({}, spec, pipedStdin(Buffer.from("abcd")))).toThrow(expected);
  });

  it("한도와 같은 크기의 파일은 내용 그대로 돌려준다", () => {
    const file = join(dir, "ok.bin");
    const content = Buffer.from([0x00, 0xff, 0x0a]);
    writeFileSync(file, content);
    expect(readInputSource({ file }, spec, ttyStdin)).toEqual(content);
  });

  it("파이프 stdin은 read() 결과를 그대로 돌려준다", () => {
    const content = Buffer.from("x\n");
    expect(readInputSource({}, spec, pipedStdin(content))).toEqual(content);
  });

  it("stdin 읽기가 시스템 오류로 실패하면 오류 코드를 담아 매개변수 오류로 바꾼다", () => {
    const failingStdin: StdinSource = {
      isTTY: false,
      read: () => {
        throw Object.assign(new Error("x"), { code: "EAGAIN" });
      },
    };
    expect(() => readInputSource({}, spec, failingStdin)).toThrow(
      expect.objectContaining({
        message: "암호화할 데이터를 표준 입력에서 읽을 수 없습니다 (EAGAIN).",
        exitCode: EXIT_PARAM_ERROR,
      }),
    );
  });

  it("입력이 없고 stdin이 TTY면 전달 방법을 안내하며 거부한다", () => {
    expect(() => readInputSource({}, spec, ttyStdin)).toThrow(
      expect.objectContaining({
        message:
          "암호화할 데이터가 필요합니다. --plaintext <값>, --file <경로>, 표준 입력(파이프) 중 하나로 전달하세요.",
        exitCode: EXIT_PARAM_ERROR,
      }),
    );
  });

  it("textFlag가 없으면 입력 없음 오류에 파일과 표준 입력만 안내한다", () => {
    const fileOnlySpec: InputSourceSpec = { label: "필드에 넣을 데이터", maxBytes: 3 };
    let error: unknown;
    try {
      readInputSource({}, fileOnlySpec, ttyStdin);
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({
      message: "필드에 넣을 데이터가 필요합니다. --file <경로>나 표준 입력(파이프)으로 전달하세요.",
      exitCode: EXIT_PARAM_ERROR,
    });
    expect((error as Error).message).not.toContain("undefined");
  });

  it("fileFlag를 주면 함께 지정 오류와 입력 없음 오류에 그 옵션 이름을 쓴다", () => {
    const passwordSpec: InputSourceSpec = {
      textFlag: "--password", fileFlag: "--password-file", label: "인증서 비밀번호", maxBytes: 3,
    };
    const file = join(dir, "pw.txt");
    writeFileSync(file, "a");
    expect(() => readInputSource({ text: "a", file }, passwordSpec, ttyStdin)).toThrow(
      expect.objectContaining({
        message: "--password와 --password-file은 함께 지정할 수 없습니다.",
        exitCode: EXIT_PARAM_ERROR,
      }),
    );
    expect(() => readInputSource({}, passwordSpec, ttyStdin)).toThrow(
      expect.objectContaining({
        message:
          "인증서 비밀번호가 필요합니다. --password <값>, --password-file <경로>, 표준 입력(파이프) 중 하나로 전달하세요.",
        exitCode: EXIT_PARAM_ERROR,
      }),
    );
  });

  it("빈 stdin과 빈 직접 값은 비어 있다고 거부한다", () => {
    const expected = expect.objectContaining({ message: "암호화할 데이터가 비어 있습니다.", exitCode: EXIT_PARAM_ERROR });
    expect(() => readInputSource({}, spec, pipedStdin(Buffer.alloc(0)))).toThrow(expected);
    expect(() => readInputSource({ text: "" }, spec, ttyStdin)).toThrow(expected);
  });
});

describe("decodeUtf8Input", () => {
  it("UTF-8이 아닌 바이트는 hint와 함께 거부한다", () => {
    expect(() => decodeUtf8Input(Buffer.from([0xff]), "암호화할 데이터", "바이너리는 base64로 인코딩해 전달하세요.")).toThrow(
      expect.objectContaining({
        message: "암호화할 데이터는 UTF-8 텍스트여야 합니다. 바이너리는 base64로 인코딩해 전달하세요.",
        exitCode: EXIT_PARAM_ERROR,
      }),
    );
  });

  it("UTF-8 텍스트는 그대로 디코딩한다", () => {
    expect(decodeUtf8Input(Buffer.from("한글"), "데이터", "")).toBe("한글");
  });

  it("앞쪽 BOM을 지우지 않는다", () => {
    expect(decodeUtf8Input(Buffer.from([0xef, 0xbb, 0xbf, 0x61]), "데이터", "")).toBe("﻿a");
  });
});
