import { Command } from "commander";
import { startSpinner, stopSpinner } from "../../utils/spinner.js";
import { output, type OutputOptions } from "../../formatters/table.js";
import { createDeployClient, requireCoordinate, resolveDeployAppKey } from "./helpers.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";

interface BinariesGlobalOpts extends OutputOptions {
  binaryGroup?: string;
  pageNum?: string;
  pageSize?: string;
  sortKey?: string;
  sortDirection?: string;
  keyword?: string;
  artifactId?: string;
  profile?: string;
}

/**
 * 옵션 문자열을 양의 정수로 파싱. 양의 정수 표기(`[1-9]\d*`)만 허용한다.
 * 정규식 사전 검증으로 빈 문자열·소수·지수 표기(`1e2`)·공백을 일관되게 거른다
 * (`Number()` 만으로는 `"1e2"`→100, `""`→0 이 새어 들어온다).
 */
function parsePositiveInt(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new NhnCloudCliError(
      `${flag} 는 1 이상의 정수여야 합니다 (입력: ${JSON.stringify(value)}).`,
      EXIT_PARAM_ERROR,
    );
  }
  return Number(value);
}

export const binariesCommand = new Command("binaries")
  .description("특정 바이너리 그룹의 바이너리 목록을 조회한다")
  .requiredOption("--binary-group <key>", "조회할 바이너리 그룹 key (binary-groups 로 확인)")
  .option("--page-num <n>", "페이지 번호 (1 이상)")
  .option("--page-size <n>", "페이지 크기 (1 이상)")
  .option("--sort-key <k>", "정렬 기준 (예: UPLOAD_DATE)")
  .option("--sort-direction <d>", "정렬 방향 (예: DESC)")
  .option("--keyword <text>", "바이너리 버전 검색 키워드")
  .option("--artifact-id <id>", "조회할 아티팩트 ID (artifacts 로 확인)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (_opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<BinariesGlobalOpts>();

    // ── 1. 입력 검증 (spinner 전, 자격증명 resolve 전 — fail-fast) ──
    const binaryGroupKey = parsePositiveInt(opts.binaryGroup, "--binary-group");
    if (binaryGroupKey === undefined) {
      // requiredOption 이 존재는 보장하므로 사실상 도달 불가 — 타입 narrowing 용
      throw new NhnCloudCliError("--binary-group 이 필요합니다.", EXIT_PARAM_ERROR);
    }
    const pageNum = parsePositiveInt(opts.pageNum, "--page-num");
    const pageSize = parsePositiveInt(opts.pageSize, "--page-size");
    const artifactId = requireCoordinate(opts.artifactId, "--artifact-id");

    // ── 2. 인증 체인 + appKey 해석 (spinner 시작 전) ──
    const { client, profileName } = await createDeployClient(opts.profile);
    const appKey = await resolveDeployAppKey(profileName);

    // ── 3. API 호출 (spinner 내부, try/catch + leak 방지) ──
    startSpinner("바이너리 목록 조회 중...");

    let result;
    try {
      result = await client.binaries(appKey, artifactId, binaryGroupKey, {
        pageNum,
        pageSize,
        sortKey: opts.sortKey,
        sortDirection: opts.sortDirection,
        keyword: opts.keyword,
      });
    } catch (err) {
      stopSpinner(false);
      throw err;
    }
    stopSpinner(true);

    // ── 4. 출력 (0건도 output() 한 경로로 — 7-2; binarySize 단위는 bytes 헤더 명시) ──
    output(opts, {
      headers: ["binaryKey", "version", "binaryName", "size(bytes)", "uploadDate", "uploader"],
      // 가드는 binaryKey·binarySize 만 검증 — 나머지 필드는 응답에서 누락 시 "undefined" 가
      // 표에 박히지 않게 ?? "" 로 방어한다 (타입 정합성 실측은 후속 이슈).
      rows: result.binaries.map((b) => [
        String(b.binaryKey),
        b.version ?? "",
        b.binaryName ?? "",
        String(b.binarySize),
        b.uploadDate ?? "",
        b.uploader ?? "",
      ]),
      // raw 에 totalCount 포함 → --json 으로 페이지 정보 확인 가능
      raw: result,
      ids: result.binaries.map((b) => String(b.binaryKey)),
    });
  });
