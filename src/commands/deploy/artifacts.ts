import { Command } from "commander";
import { startSpinner, stopSpinner } from "../../utils/spinner.js";
import { output, type OutputOptions } from "../../formatters/table.js";
import { cell, createDeployClient, listField, resolveDeployAppKey } from "./helpers.js";

interface ArtifactsGlobalOpts extends OutputOptions {
  name?: string;
  profile?: string;
}

export const artifactsCommand = new Command("artifacts")
  .description("아티팩트 목록을 조회한다")
  .option("--name <artifactName>", "아티팩트 이름으로 검색")
  .option("--profile <name>", "사용할 profile 이름")
  // 이 명령은 좌표가 필요 없다 — appKey 하나로 조회한다 (ADR-033).
  .action(async (_opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<ArtifactsGlobalOpts>();

    // ── 1. 인증 체인 + appKey 해석 (spinner 시작 전) ──
    const { client, profileName } = await createDeployClient(opts.profile);
    const appKey = await resolveDeployAppKey(profileName);

    // ── 2. API 호출 (spinner 내부, try/catch + leak 방지) ──
    startSpinner("아티팩트 목록 조회 중...");

    let result: Record<string, unknown>;
    try {
      result = await client.artifacts(appKey, opts.name);
    } catch (err) {
      stopSpinner(false);
      throw err;
    }

    stopSpinner(true);

    // ── 3. 출력 ──
    // --json 은 응답 원본({ artifacts }), 표와 --quiet 는 artifacts 배열의 행이다.
    const artifacts = listField(result, "artifacts");
    output(opts, {
      headers: ["id", "name", "applicationType", "lastDeployDate", "description"],
      rows: artifacts.map((item) => [
        cell(item["id"]),
        cell(item["name"]),
        cell(item["applicationType"]),
        cell(item["lastDeployDate"]),
        cell(item["description"]),
      ]),
      raw: result,
      ids: artifacts.map((item) => cell(item["id"])).filter(Boolean),
    });
  });
