import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { collectCommandCatalog, createCommandsCommand } from "./commands.js";
import { executeCommand as pipelineExecuteCommand } from "./pipeline/execute.js";

function buildProgram(): Command {
  const program = new Command("nhncloud")
    .option("--json", "JSON 형식으로 출력")
    .option("--quiet", "최소 출력");

  const nksClusterList = new Command("list")
    .description("NKS 클러스터 목록을 조회한다")
    .option("--region <region>", "region override")
    .option("--profile <name>", "profile name");
  const nksCluster = new Command("cluster")
    .description("NKS 클러스터 관련 명령")
    .addCommand(nksClusterList);
  const nks = new Command("nks").description("NHN Kubernetes Service 관련 명령");
  nks.addCommand(nksCluster);

  const ncrImages = new Command("images")
    .description("레지스트리의 이미지(repository) 목록을 조회한다")
    .argument("<registry>", "레지스트리 이름")
    .option("--app-key <key>", "NCR appKey");
  const ncr = new Command("ncr").description("NHN Container Registry 관련 명령");
  ncr.addCommand(ncrImages);

  const instanceList = new Command("list")
    .description("인스턴스 목록을 조회한다")
    .option("--region <region>", "region override");
  const instance = new Command("instance").description("Compute 인스턴스 관련 명령");
  instance.addCommand(instanceList);

  program.addCommand(nks);
  program.addCommand(ncr);
  program.addCommand(instance);
  program.addCommand(createCommandsCommand(program));

  return program;
}

describe("collectCommandCatalog", () => {
  it("nested command path를 포함한다", () => {
    const catalog = collectCommandCatalog(buildProgram());
    const paths = catalog.commands.map((command) => command.path);

    expect(paths).toContain("nks cluster list");
    expect(paths).toContain("ncr images");
    expect(paths).toContain("instance list");
  });

  it("description, arguments, options를 포함한다", () => {
    const catalog = collectCommandCatalog(buildProgram());
    const ncrImages = catalog.commands.find((command) => command.path === "ncr images");

    expect(ncrImages).toMatchObject({
      description: "레지스트리의 이미지(repository) 목록을 조회한다",
      arguments: ["registry"],
      options: ["--app-key <key>"],
    });
  });

  it("pipeline execute 는 인수와 옵션을 노출하고 --app-key 는 없다", () => {
    const program = buildProgram();
    program.addCommand(new Command("pipeline").addCommand(pipelineExecuteCommand));

    const entry = collectCommandCatalog(program).commands.find((command) => command.path === "pipeline execute");

    expect(entry).toBeDefined();
    expect(entry?.arguments).toEqual(["pipeline-name"]);
    const flags = entry?.options.join(" ") ?? "";
    for (const flag of ["--region", "--profile", "--yes", "--dry-run"]) expect(flags).toContain(flag);
    expect(flags).not.toContain("--app-key");
  });

  it("help pseudo-command를 포함하지 않는다", () => {
    const catalog = collectCommandCatalog(buildProgram());

    expect(catalog.commands.some((command) => command.path === "help")).toBe(false);
  });

  it("commands 자기 자신을 metadata command로 포함한다", () => {
    const catalog = collectCommandCatalog(buildProgram());

    expect(catalog.commands.find((command) => command.path === "commands")).toMatchObject({
      metadata: true,
    });
  });
});

describe("commands command", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("--json 출력은 JSON parse 가능하다", async () => {
    const program = buildProgram();
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "nhncloud", "--json", "commands"]);

    const stdout = write.mock.calls.map((call) => String(call[0])).join("");
    const parsed = JSON.parse(stdout);

    expect(parsed.commands.some((command: { path: string }) => command.path === "nks cluster list"))
      .toBe(true);
  });

  it("table 출력은 command path를 포함한다", async () => {
    const program = buildProgram();
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await program.parseAsync(["node", "nhncloud", "commands"]);

    const stdout = write.mock.calls.map((call) => String(call[0])).join("");

    expect(stdout).toContain("nks cluster list");
  });
});
