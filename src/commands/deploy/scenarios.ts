import { Command } from "commander";
import { startSpinner, stopSpinner } from "../../utils/spinner.js";
import { output, type OutputOptions } from "../../formatters/table.js";
import { createDeployClient, requireCoordinate, resolveDeployAppKey } from "./helpers.js";

interface ScenariosOptions extends OutputOptions {
  artifactId?: string;
  serverGroupId?: string;
  profile?: string;
}

export const scenariosCommand = new Command("scenarios")
  .description("서버그룹 시나리오 목록을 조회한다")
  .option("--artifact-id <id>", "아티팩트 ID")
  .option("--server-group-id <id>", "서버그룹 ID")
  .option("--profile <name>", "사용할 profile 이름")
  .action(async (_opts: unknown, cmd: Command) => {
    const opts = cmd.optsWithGlobals<ScenariosOptions>();
    const artifactId = requireCoordinate(opts.artifactId, "--artifact-id");
    const serverGroupId = requireCoordinate(opts.serverGroupId, "--server-group-id");
    const { client, profileName } = await createDeployClient(opts.profile);
    const appKey = await resolveDeployAppKey(profileName);

    startSpinner("시나리오 목록 조회 중...");
    let scenarios;
    try {
      scenarios = await client.scenarios(appKey, artifactId, serverGroupId);
    } catch (err) {
      stopSpinner(false);
      throw err;
    }
    stopSpinner(true);

    output(opts, {
      headers: ["scenarioId", "scenarioName"],
      rows: scenarios.map((scenario) => [String(scenario.scenarioId), scenario.scenarioName]),
      raw: scenarios,
      ids: scenarios.map((scenario) => String(scenario.scenarioId)),
    });
  });
