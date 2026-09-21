import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT_CONFIG_ERROR, EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import {
  collectAppKeyOptionPaths,
  collectArgumentPaths,
  collectOptionPaths,
} from "../appkey-option.test-helper.js";

const mocks = vi.hoisted(() => ({
  resolveProfileName: vi.fn(),
  getUserAccessKey: vi.fn(),
  getProfileEnvironment: vi.fn(),
  getOptionalServiceCredential: vi.fn(),
  getAccessToken: vi.fn(),
  artifacts: vi.fn(),
  scenarios: vi.fn(),
  startSpinner: vi.fn(),
}));

vi.mock("../../config/credentials.js", () => ({
  resolveProfileName: mocks.resolveProfileName,
  getUserAccessKey: mocks.getUserAccessKey,
  getProfileEnvironment: mocks.getProfileEnvironment,
  getOptionalServiceCredential: mocks.getOptionalServiceCredential,
}));
vi.mock("../../api/oauth.js", () => ({ getAccessToken: mocks.getAccessToken }));
vi.mock("../../utils/spinner.js", () => ({
  startSpinner: mocks.startSpinner,
  stopSpinner: vi.fn(),
  setQuiet: vi.fn(),
}));
vi.mock("../../services/deploy/client.js", () => ({
  DeployClient: class {
    artifacts = mocks.artifacts;
    scenarios = mocks.scenarios;
  },
}));

import { artifactsCommand } from "./artifacts.js";
import { binariesCommand } from "./binaries.js";
import { binaryGroupsCommand } from "./binary-groups.js";
import { downloadCommand } from "./download.js";
import { historiesCommand } from "./histories.js";
import { runCommand } from "./run.js";
import { serverGroupsCommand } from "./server-groups.js";
import { scenariosCommand } from "./scenarios.js";
import { uploadCommand } from "./upload.js";
import { resolveDeployAppKey } from "./helpers.js";

const leafCommands = [
  artifactsCommand,
  binariesCommand,
  binaryGroupsCommand,
  downloadCommand,
  historiesCommand,
  runCommand,
  serverGroupsCommand,
  scenariosCommand,
  uploadCommand,
];

describe("deploy 명령 옵션", () => {
  it("모든 하위 명령에서 --app-key 를 노출하지 않는다", () => {
    expect(leafCommands.flatMap((command) => collectAppKeyOptionPaths(command))).toEqual(
      [],
    );
  });

  it("좌표 옵션 --artifact-id 는 그대로 남는다", () => {
    // 좌표(artifactId 등)는 여전히 target 과 옵션에서 읽는다 — appkey 만 profile 로 옮겼다.
    expect(
      leafCommands.flatMap((command) => collectOptionPaths(command, "--artifact-id")),
    ).toEqual([
      "binaries",
      "binary-groups",
      "download",
      "histories",
      "run",
      "server-groups",
      "scenarios",
      "upload",
    ]);
  });

  it("--app-key 를 넘기면 알 수 없는 옵션으로 거부한다", () => {
    // Commander 는 unknown option 을 자체 에러로 처리한다 — 종료·출력은 테스트에서 가로챈다.
    // copyInheritedSettings 는 exitOverride·configureOutput 을 덮으므로 쓰지 않는다.
    const command = new Command("artifacts")
      .exitOverride()
      .configureOutput({ writeErr: () => {}, writeOut: () => {} });
    artifactsCommand.options.forEach((option) => command.addOption(option));

    expect(() => command.parse(["--app-key", "k"], { from: "user" })).toThrow(
      expect.objectContaining({ code: "commander.unknownOption" }),
    );
  });
});

/**
 * 하위 명령을 실제로 실행한다.
 * action 핸들러는 공개 API 로 꺼낼 수 없어 import 한 원본 명령을 그대로 붙이고,
 * `optsWithGlobals` 가 읽는 전역 옵션만 최소로 재현한 부모를 씌운다.
 * 종료는 exitOverride 로 가로채 vitest 프로세스가 죽지 않게 한다.
 *
 * 이 함수는 import 한 명령 객체를 변형한다. 피할 수 없다 —
 * commander 의 `addCommand` 는 복제하지 않고 같은 참조를 담고 `parent` 도 덮는다.
 * 실측으로 확인했다: `parent.commands[0] === command` 다.
 * 다만 걸어 두는 설정(exitOverride·출력 억제)이 idempotent 하고 이 파일의 모든 호출이
 * 같은 값을 걸어서 실제로 새지 않는다. 진짜 격리에는 명령 팩토리 export 가 필요하고
 * 그것은 8개 명령과 index.ts 를 함께 바꾸는 별도 작업이다.
 */
async function parseLeaf(command: Command, args: string[], globals: string[] = []): Promise<void> {
  const silent = { writeErr: () => {}, writeOut: () => {} };
  command.exitOverride().configureOutput(silent);
  const parent = new Command("deploy")
    .exitOverride()
    .configureOutput(silent)
    .option("--json", "JSON 출력")
    .option("--quiet", "식별자만 출력");
  parent.addCommand(command);

  await parent.parseAsync([...globals, command.name(), ...args], { from: "user" });
}

/** parseLeaf 를 한 번만 실행해 던진 오류를 돌려준다 — 두 번 부르면 action 이 두 번 돈다. */
async function captureLeafError(
  command: Command,
  args: string[],
  globals: string[] = [],
): Promise<unknown> {
  try {
    await parseLeaf(command, args, globals);
  } catch (err) {
    return err;
  }
  throw new Error("오류를 던질 것으로 기대했는데 정상 종료했다.");
}

describe("deploy 명령 위치 인수", () => {
  it("9개 명령 모두 위치 인수를 노출하지 않는다", () => {
    expect(leafCommands.flatMap((command) => collectArgumentPaths(command))).toEqual([]);
  });
});

describe("deploy 좌표 옵션 검증", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.resolveProfileName.mockResolvedValue("p");
    mocks.getUserAccessKey.mockResolvedValue({ id: "<uak-id>", secret: "<uak-secret>" });
    mocks.getProfileEnvironment.mockResolvedValue("real");
    mocks.getOptionalServiceCredential.mockResolvedValue({ appkey: "<appkey>" });
    mocks.getAccessToken.mockResolvedValue("access-token");
  });

  const requiresArtifactId: Array<[string, Command, string[]]> = [
    ["binaries", binariesCommand, ["--binary-group", "1"]],
    ["binary-groups", binaryGroupsCommand, []],
    // -o 를 이미 있는 파일로 둔다 — 좌표 검증이 assertWritable 뒤로 되돌아가면
    // 덮어쓰기 거부 문구가 먼저 나와 이 케이스가 실패한다 (순서 고정).
    [
      "download",
      downloadCommand,
      ["--binary-group", "1", "--binary-key", "1", "-o", "package.json"],
    ],
    ["histories", historiesCommand, []],
    ["server-groups", serverGroupsCommand, []],
    ["scenarios", scenariosCommand, []],
    // --file 을 없는 경로로 둔다 — 좌표 검증이 파일 가드 뒤로 되돌아가면
    // "읽을 수 없습니다" 가 먼저 나와 이 케이스가 실패한다 (순서 고정).
    ["upload", uploadCommand, ["--file", "no-such-file.bin", "--binary-group", "1"]],
  ];

  it.each(requiresArtifactId)(
    "%s 는 --artifact-id 없이 부르면 EXIT_PARAM_ERROR 로 거부한다",
    async (_name, command, args) => {
      const err = await captureLeafError(command, args);

      expect(err).toMatchObject({ exitCode: EXIT_PARAM_ERROR });
      expect(err).toMatchObject({ message: expect.stringContaining("--artifact-id 가 필요합니다") });
    },
  );

  it.each([
    ["--artifact-id", []],
    ["--server-group-id", ["--artifact-id", "1"]],
    ["--scenario-ids", ["--artifact-id", "1", "--server-group-id", "2"]],
  ])("run 은 %s 가 없으면 EXIT_PARAM_ERROR 로 거부한다", async (flag, args) => {
    const err = await captureLeafError(runCommand, args);

    expect(err).toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(err).toMatchObject({ message: expect.stringContaining(`${flag} 가 필요합니다`) });
  });

  it("scenarios 는 --server-group-id 없이 호출하면 입력 오류로 거부한다", async () => {
    const err = await captureLeafError(scenariosCommand, ["--artifact-id", "1"]);
    expect(err).toMatchObject({ exitCode: EXIT_PARAM_ERROR, message: expect.stringContaining("--server-group-id") });
  });

  it("좌표 검증은 spinner 시작과 인증 체인보다 앞선다", async () => {
    await expect(parseLeaf(historiesCommand, [])).rejects.toThrow(
      expect.objectContaining({ exitCode: EXIT_PARAM_ERROR }),
    );

    expect(mocks.startSpinner).not.toHaveBeenCalled();
    expect(mocks.resolveProfileName).not.toHaveBeenCalled();
    expect(mocks.getAccessToken).not.toHaveBeenCalled();
  });

  it("artifacts 는 좌표 없이 동작한다", async () => {
    mocks.artifacts.mockResolvedValue({ artifactId: "1" });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(parseLeaf(artifactsCommand, [], ["--json"])).resolves.toBeUndefined();

    expect(mocks.artifacts).toHaveBeenCalledWith("<appkey>");
    stdout.mockRestore();
  });

  it("gov profile은 공공망 OAuth 선택을 전달한다", async () => {
    mocks.getProfileEnvironment.mockResolvedValue("gov");
    mocks.artifacts.mockResolvedValue({ artifacts: [] });
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await parseLeaf(artifactsCommand, [], ["--json"]);

    expect(mocks.getAccessToken).toHaveBeenCalledWith("p", "<uak-id>", "<uak-secret>", false, "gov");
  });

  it.each([
    ["기본", [], "sample scenario"],
    ["JSON", ["--json"], '"scenarioId": 7'],
    ["quiet", ["--quiet"], "7\n"],
  ])("scenarios %s 출력은 시나리오를 보여준다", async (_name, globals, expected) => {
    mocks.scenarios.mockResolvedValue([{ scenarioId: 7, scenarioName: "sample scenario" }]);
    const chunks: string[] = [];
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      chunks.push(String(chunk));
      return true;
    });
    try {
      await parseLeaf(scenariosCommand, ["--artifact-id", "1", "--server-group-id", "2"], globals);
      expect(chunks.join("")).toContain(expected);
    } finally {
      stdout.mockRestore();
    }
  });
});

describe("resolveDeployAppKey", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("profile 의 deploy.appkey 를 반환한다", async () => {
    mocks.getOptionalServiceCredential.mockResolvedValue({ appkey: "<appkey>" });

    await expect(resolveDeployAppKey("resolved-profile")).resolves.toBe("<appkey>");
    expect(mocks.getOptionalServiceCredential).toHaveBeenCalledWith("deploy", "resolved-profile");
  });

  it.each([undefined, ""])("appkey 가 %j 이면 EXIT_CONFIG_ERROR 와 설정 안내", async (appkey) => {
    mocks.getOptionalServiceCredential.mockResolvedValue({ appkey });

    await expect(resolveDeployAppKey("resolved-profile")).rejects.toThrow(
      expect.objectContaining({ exitCode: EXIT_CONFIG_ERROR }),
    );
    await expect(resolveDeployAppKey("resolved-profile")).rejects.toThrow(
      /configure --deploy-appkey/,
    );
  });

  it("deploy 블록 부재(EXIT_CONFIG_ERROR)는 설정 안내로 바꾼다", async () => {
    mocks.getOptionalServiceCredential.mockResolvedValue(undefined);

    await expect(resolveDeployAppKey("p")).rejects.toThrow(/configure --deploy-appkey/);
  });

  it("EXIT_CONFIG_ERROR 가 아닌 오류는 원인을 보존해 rethrow 한다", async () => {
    const cause = new NhnCloudCliError("자격증명 파일 파싱 실패", EXIT_PARAM_ERROR);
    mocks.getOptionalServiceCredential.mockRejectedValue(cause);

    await expect(resolveDeployAppKey("p")).rejects.toBe(cause);
  });

  it("NhnCloudCliError 가 아닌 오류도 그대로 rethrow 한다", async () => {
    const cause = new SyntaxError("Unexpected token in JSON");
    mocks.getOptionalServiceCredential.mockRejectedValue(cause);

    await expect(resolveDeployAppKey("p")).rejects.toBe(cause);
  });
});
