import { Command } from "commander";
import { startSpinner, stopSpinner } from "../../utils/spinner.js";
import { output, type OutputOptions } from "../../formatters/table.js";
import { cell, createDeployClient, listField, requireCoordinate, resolveDeployAppKey } from "./helpers.js";

interface ServerGroupsGlobalOpts extends OutputOptions {
  artifactId?: string;
  profile?: string;
}

export const serverGroupsCommand = new Command("server-groups")
  .description("서버그룹 목록을 조회한다")
  .option("--artifact-id <id>", "조회할 아티팩트 ID (artifacts 로 확인)")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (_opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<ServerGroupsGlobalOpts>();

    // ── 1. 입력 검증 (spinner 전, 자격증명 resolve 전 — fail-fast) ──
    const artifactId = requireCoordinate(opts.artifactId, "--artifact-id");

    // ── 2. 인증 체인 + appKey 해석 (spinner 시작 전) ──
    const { client, profileName } = await createDeployClient(opts.profile);
    const appKey = await resolveDeployAppKey(profileName);

    // ── 3. API 호출 (spinner 내부, try/catch + leak 방지) ──
    startSpinner("서버그룹 목록 조회 중...");

    let result: Record<string, unknown>;
    try {
      result = await client.serverGroups(appKey, artifactId);
    } catch (err) {
      stopSpinner(false);
      throw err;
    }

    stopSpinner(true);

    // ── 4. 출력 ──
    // --json 은 응답 원본({ serverGroups }), 표와 --quiet 는 serverGroups 배열의 행이다.
    const serverGroups = listField(result, "serverGroups");
    output(opts, {
      headers: ["id", "name", "osType", "serverCount", "description"],
      rows: serverGroups.map((item) => [
        cell(item["id"]),
        cell(item["name"]),
        cell(item["osType"]),
        cell(item["serverCount"]),
        cell(item["description"]),
      ]),
      raw: result,
      ids: serverGroups.map((item) => cell(item["id"])).filter(Boolean),
    });
  });
