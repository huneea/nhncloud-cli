import { readFileSync, statSync } from "node:fs";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";

export interface StdinSource {
  isTTY: boolean | undefined;
  read: () => Buffer;
}

export const processStdin: StdinSource = {
  get isTTY() {
    return process.stdin.isTTY;
  },
  read: () => readFileSync(0),
};

export interface SkmInputSpec {
  /** 직접 값을 받는 옵션 이름. 예: "--plaintext" */
  textFlag: string;
  /** 파일 경로를 받는 옵션 이름. 기본 "--file" */
  fileFlag?: string;
  /** 오류 문구에 쓰는 이름. 예: "암호화할 데이터" */
  label: string;
  maxBytes: number;
}

function assertWithinLimit(size: number, spec: SkmInputSpec): void {
  if (size > spec.maxBytes) {
    throw new NhnCloudCliError(
      `${spec.label}가 너무 큽니다: ${size}바이트 (한도 ${spec.maxBytes}바이트).`,
      EXIT_PARAM_ERROR,
    );
  }
}

function readInputFile(file: string, spec: SkmInputSpec): Buffer {
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(file);
  } catch (e) {
    const reason = (e as NodeJS.ErrnoException).code ?? (e instanceof Error ? e.message : String(e));
    throw new NhnCloudCliError(`${spec.label} 파일을 읽을 수 없습니다: ${file} (${reason})`, EXIT_PARAM_ERROR);
  }
  if (!stat.isFile()) {
    throw new NhnCloudCliError(`${spec.label} 파일이 일반 파일이 아닙니다: ${file}`, EXIT_PARAM_ERROR);
  }
  assertWithinLimit(stat.size, spec);
  return readFileSync(file);
}

function readStdin(stdin: StdinSource, spec: SkmInputSpec): Buffer {
  try {
    return stdin.read();
  } catch (e) {
    const reason = (e as NodeJS.ErrnoException).code ?? (e instanceof Error ? e.message : String(e));
    throw new NhnCloudCliError(`${spec.label}를 표준 입력에서 읽을 수 없습니다 (${reason}).`, EXIT_PARAM_ERROR);
  }
}

/**
 * textFlag 값 > --file > stdin 순으로 읽어 Buffer 로 돌려준다.
 * 받은 바이트를 그대로 쓰므로 끝 줄바꿈도 지우지 않는다.
 */
export function readSkmInput(
  source: { text?: string; file?: string },
  spec: SkmInputSpec,
  stdin: StdinSource = processStdin,
): Buffer {
  const fileFlag = spec.fileFlag ?? "--file";
  if (source.text !== undefined && source.file !== undefined) {
    throw new NhnCloudCliError(`${spec.textFlag}와 ${fileFlag}은 함께 지정할 수 없습니다.`, EXIT_PARAM_ERROR);
  }

  let input: Buffer;
  if (source.text !== undefined) {
    input = Buffer.from(source.text, "utf-8");
  } else if (source.file !== undefined) {
    input = readInputFile(source.file, spec);
  } else if (!stdin.isTTY) {
    input = readStdin(stdin, spec);
  } else {
    throw new NhnCloudCliError(
      `${spec.label}가 필요합니다. ${spec.textFlag} <값>, ${fileFlag} <경로>, 표준 입력(파이프) 중 하나로 전달하세요.`,
      EXIT_PARAM_ERROR,
    );
  }

  // 파일은 읽는 사이 커질 수 있어 읽은 길이로 한 번 더 확인한다.
  assertWithinLimit(input.length, spec);
  if (input.length === 0) {
    throw new NhnCloudCliError(`${spec.label}가 비어 있습니다.`, EXIT_PARAM_ERROR);
  }
  return input;
}

/**
 * UTF-8 로 엄격 디코딩한다. 잘못된 바이트를 U+FFFD 로 바꿔 보내지 않도록 요청 전에 거부한다.
 * 입력 바이트를 보존하려고 앞쪽 BOM 도 지우지 않는다.
 */
export function decodeUtf8Input(input: Buffer, label: string, hint: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input);
  } catch {
    throw new NhnCloudCliError(`${label}는 UTF-8 텍스트여야 합니다. ${hint}`, EXIT_PARAM_ERROR);
  }
}
