import { Command } from "commander";
import { readFileSync, statSync } from "node:fs";
import { startSpinner, stopSpinner } from "../../utils/spinner.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR, EXIT_CONFIG_ERROR } from "../../utils/exit-codes.js";
import { resolveProfileName, getServiceCredential, requireRealEnvironment } from "../../config/credentials.js";
import { LogncrashClient } from "../../services/logncrash/client.js";
import type { OutputOptions } from "../../formatters/table.js";
import type { LogLevel } from "../../services/logncrash/types.js";

/** 단일 로그(JSON) 한도 — collector 스펙 8MB (원본 byte 기준, 인코딩 없음). */
const MAX_LOG_BYTES = 8 * 1024 * 1024;

const VALID_LEVELS: readonly LogLevel[] = ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"];

interface SendGlobalOpts extends OutputOptions {
  body?: string;
  file?: string;
  level?: string;
  appVersion?: string;
  source?: string;
  type?: string;
  host?: string;
  profile?: string;
}

/** --body > --file > stdin 순으로 로그 본문을 해석한다. 셋 다 없으면 EXIT_PARAM_ERROR. */
function resolveBody(opts: SendGlobalOpts): string {
  if (opts.body !== undefined) return opts.body;

  if (opts.file !== undefined) {
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(opts.file);
    } catch (e) {
      const reason = (e as NodeJS.ErrnoException).code ?? (e instanceof Error ? e.message : String(e));
      throw new NhnCloudCliError(`로그 파일을 읽을 수 없습니다: ${opts.file} (${reason})`, EXIT_PARAM_ERROR);
    }
    if (!stat.isFile()) {
      throw new NhnCloudCliError(`로그 파일이 일반 파일이 아닙니다: ${opts.file}`, EXIT_PARAM_ERROR);
    }
    if (stat.size > MAX_LOG_BYTES) {
      throw new NhnCloudCliError(
        `로그 파일이 너무 큽니다: ${stat.size} 바이트 (한도 ${MAX_LOG_BYTES} 바이트).`,
        EXIT_PARAM_ERROR,
      );
    }
    return readFileSync(opts.file, "utf-8");
  }

  // stdin (파이프 입력)
  if (!process.stdin.isTTY) {
    return readFileSync(0, "utf-8");
  }

  throw new NhnCloudCliError(
    "로그 본문이 필요합니다. --body <text> 또는 --file <path> 또는 표준입력(파이프)으로 전달하세요.",
    EXIT_PARAM_ERROR,
  );
}

export const sendCommand = new Command("send")
  .description("로그 한 건을 Log & Crash 로 전송한다 (--body / --file / stdin)")
  .option("--body <text>", "로그 메시지 본문 (미지정 시 --file 또는 stdin)")
  .option("--file <path>", "로그 본문을 읽을 파일 경로")
  .option("--level <level>", "로그 레벨 (DEBUG/INFO/WARN/ERROR/FATAL)")
  .option("--app-version <ver>", "projectVersion (미지정 시 기본 '1.0.0')")
  .option("--source <source>", "logSource (collector 기본 'http')")
  .option("--type <type>", "logType (collector 기본 'log')")
  .option("--host <host>", "로그를 보낸 host 식별")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (_opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<SendGlobalOpts>();

    // ── 1. 본문 해석 + 크기 한도 검증 (spinner 전, 자격증명 전 — fail-fast) ──
    const body = resolveBody(opts);
    const bytes = Buffer.byteLength(body, "utf-8");
    if (bytes === 0) {
      throw new NhnCloudCliError("로그 본문이 비어 있습니다.", EXIT_PARAM_ERROR);
    }
    if (bytes > MAX_LOG_BYTES) {
      throw new NhnCloudCliError(
        `로그 본문이 너무 큽니다: ${bytes} 바이트 (한도 ${MAX_LOG_BYTES} 바이트).`,
        EXIT_PARAM_ERROR,
      );
    }

    // ── 2. 레벨 검증 (선택 옵션, 지정 시에만) ──
    let logLevel: LogLevel | undefined;
    if (opts.level !== undefined) {
      const upper = opts.level.toUpperCase();
      if (!VALID_LEVELS.includes(upper as LogLevel)) {
        throw new NhnCloudCliError(
          `--level 은 ${VALID_LEVELS.join("/")} 중 하나여야 합니다 (입력: ${opts.level}).`,
          EXIT_PARAM_ERROR,
        );
      }
      logLevel = upper as LogLevel;
    }

    // ── 3. 자격증명 로드 — appkey 만 사용 (secret 불요, ADR-014) ──
    const profileName = await resolveProfileName(opts.profile);
    await requireRealEnvironment(profileName, "Log & Crash");
    const cred = await getServiceCredential("logncrash", profileName);
    if (!cred.appkey) {
      throw new NhnCloudCliError(
        `profile "${profileName}" 의 logncrash 자격증명에 appkey 가 없습니다.\ncredentials.json 에 "appkey": "<appkey>" 를 추가하세요.`,
        EXIT_CONFIG_ERROR,
      );
    }
    // collector send 는 검색용 access token을 쓰지 않는다(ADR-014). 생성자 두 번째 인자는 생략한다.
    const client = new LogncrashClient(cred.appkey);

    // ── 4. 전송 (spinner 내부, try/catch + leak 방지) ──
    startSpinner("로그 전송 중...");
    try {
      await client.send({
        body,
        projectVersion: opts.appVersion ?? "1.0.0",
        logLevel,
        logSource: opts.source,
        logType: opts.type,
        host: opts.host,
      });
    } catch (err) {
      stopSpinner(false);
      throw err;
    }
    stopSpinner(true, "로그를 전송했습니다.");

    // 부수효과 명령 — 성공은 stderr(spinner). --json 일 때만 stdout 에 최소 페이로드를 emit 해
    // 자동화가 성공/메타를 stdout 으로 판정할 수 있게 한다. --quiet 면 stdout 은 비운다.
    // appkey 는 페이로드에 넣지 않는다 — stdout/CI 로그에 식별자가 남지 않도록 (개인 식별 정보 정책).
    if (opts.json) {
      process.stdout.write(JSON.stringify({ ok: true, bytes }) + "\n");
    }
  });
