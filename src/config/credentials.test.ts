import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { EXIT_CONFIG_ERROR } from "../utils/exit-codes.js";

const home = vi.hoisted(() => ({ dir: "" }));
vi.mock("node:os", async (orig) => {
  const actual = await orig<typeof import("node:os")>();
  return { ...actual, homedir: () => home.dir };
});

// SUT 는 정적 import 금지 — home.dir set 후 동적 로드해야 CONFIG_PATH 가 temp dir 로 굳는다.
let credentials: typeof import("./credentials.js");
let configPath: string;
let credentialsPath: string;

beforeAll(async () => {
  home.dir = await mkdtemp(path.join(tmpdir(), "ncc-config-"));
  await mkdir(path.join(home.dir, ".nhncloud"), { recursive: true });
  configPath = path.join(home.dir, ".nhncloud", "config.json");
  credentialsPath = path.join(home.dir, ".nhncloud", "credentials.json");
  credentials = await import("./credentials.js");
});
afterAll(async () => {
  await rm(home.dir, { recursive: true, force: true });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(configPath, { force: true });
  await rm(credentialsPath, { force: true });
});

async function writeConfig(value: unknown): Promise<void> {
  await writeFile(configPath, JSON.stringify(value), "utf-8");
}

async function writeCredentials(value: unknown): Promise<void> {
  await writeFile(credentialsPath, JSON.stringify(value), "utf-8");
}

/** stderr 를 가로채 경고 출력만 모은다. */
function captureStderr(): { chunks: string[] } {
  const chunks: string[] = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  });
  return { chunks };
}

describe("getOptionalServiceCredential", () => {
  it("서비스 블록이 있으면 값을 반환한다", async () => {
    await writeCredentials({
      version: 1,
      profiles: {
        default: {
          ncr: { appkey: "<appkey>" },
        },
      },
    });

    await expect(credentials.getOptionalServiceCredential("ncr", "default")).resolves.toEqual({
      appkey: "<appkey>",
    });
  });

  it("profile은 있고 서비스 블록만 없으면 undefined를 반환한다", async () => {
    await writeCredentials({ version: 1, profiles: { default: {} } });

    await expect(
      credentials.getOptionalServiceCredential("ncr", "default"),
    ).resolves.toBeUndefined();
  });

  it("profile이 없으면 기존 profile 오류와 EXIT_CONFIG_ERROR를 보존한다", async () => {
    await writeCredentials({ version: 1, profiles: { default: {} } });

    await expect(
      credentials.getOptionalServiceCredential("ncr", "missing"),
    ).rejects.toMatchObject({
      exitCode: EXIT_CONFIG_ERROR,
      message: expect.stringContaining('profile "missing" 을 찾을 수 없습니다.'),
    });
  });

  it("손상된 credentials.json은 기존 파싱 오류와 EXIT_CONFIG_ERROR를 보존한다", async () => {
    await writeFile(credentialsPath, "{ broken", "utf-8");

    await expect(
      credentials.getOptionalServiceCredential("ncr", "default"),
    ).rejects.toMatchObject({
      exitCode: EXIT_CONFIG_ERROR,
      message: expect.stringContaining("자격증명 파일 파싱 오류"),
    });
  });

  it("getServiceCredential의 서비스 블록 누락 오류 문구는 유지된다", async () => {
    await writeCredentials({ version: 1, profiles: { default: {} } });

    await expect(credentials.getServiceCredential("ncr", "default")).rejects.toMatchObject({
      exitCode: EXIT_CONFIG_ERROR,
      message:
        'profile "default" 에 "ncr" 자격증명이 없습니다.\n' +
        `${credentialsPath} 에서 profiles.default.ncr 블록을 추가하세요.\n` +
        '예시: { "appkey": "<appkey>" }',
    });
  });
});

describe("getProfileEnvironment", () => {
  it("기존 profile은 일반망, gov 표기는 공공망으로 해석한다", async () => {
    await writeCredentials({ version: 1, profiles: { old: {}, public: { environment: "gov" } } });
    await expect(credentials.getProfileEnvironment("old")).resolves.toBe("real");
    await expect(credentials.getProfileEnvironment("public")).resolves.toBe("gov");
  });

  it("새 profile의 configure 검증에는 일반망 기본값을 반환한다", async () => {
    await writeCredentials({ version: 1, profiles: {} });
    await expect(credentials.getProfileEnvironment("new", true)).resolves.toBe("real");
  });

  it("알 수 없는 환경값은 호출 전에 거부한다", async () => {
    await writeCredentials({ version: 1, profiles: { bad: { environment: "other" } } });
    await expect(credentials.getProfileEnvironment("bad")).rejects.toMatchObject({ exitCode: EXIT_CONFIG_ERROR });
  });

  it("지원하지 않는 서비스는 공공망 profile에서 요청 전에 거부한다", async () => {
    await writeCredentials({ version: 1, profiles: { public: { environment: "gov" } } });
    await expect(credentials.requireRealEnvironment("public", "NCS")).rejects.toMatchObject({ exitCode: EXIT_CONFIG_ERROR });
  });
});

describe("warnLegacyDeployTargets", () => {
  it("deploy.targets 에 항목이 있으면 stderr 로 경고하고 계속 진행한다", async () => {
    await writeConfig({
      version: 1,
      deploy: { targets: { legacyTarget: { appKey: "<appkey>", artifactId: "1" } } },
    });
    const { chunks } = captureStderr();

    await expect(credentials.warnLegacyDeployTargets()).resolves.toBeUndefined();

    expect(chunks.join("")).toMatch(/deploy\.targets 는 더 이상 사용되지 않습니다/);
    expect(chunks.join("")).toMatch(/configure --deploy-appkey/);
    expect(chunks.join("")).toMatch(/--artifact-id/);
  });

  it("경고에 target 이름을 담지 않는다", async () => {
    await writeConfig({ version: 1, deploy: { targets: { legacyTarget: {} } } });
    const { chunks } = captureStderr();

    await credentials.warnLegacyDeployTargets();

    expect(chunks.join("")).not.toContain("legacyTarget");
  });

  it.each([
    ["deploy 블록 자체가 없으면", { version: 1 }],
    ["targets 가 없으면", { version: 1, deploy: {} }],
    ["targets 가 비어 있으면", { version: 1, deploy: { targets: {} } }],
    ["deploy 가 객체가 아니면", { version: 1, deploy: "legacy" }],
    ["targets 가 객체가 아니면", { version: 1, deploy: { targets: "legacy" } }],
    ["최상위가 객체가 아니면", ["legacy"]],
  ])("%s 경고하지 않는다", async (_label, config) => {
    await writeConfig(config);
    const { chunks } = captureStderr();

    await credentials.warnLegacyDeployTargets();

    expect(chunks).toEqual([]);
  });

  it("config.json 이 없으면 조용히 지나간다", async () => {
    const { chunks } = captureStderr();

    await expect(credentials.warnLegacyDeployTargets()).resolves.toBeUndefined();

    expect(chunks).toEqual([]);
  });

  it("--quiet 에서도 경고를 낸다 (마이그레이션 안내를 CI 가 삼키지 않게)", async () => {
    await writeConfig({ version: 1, deploy: { targets: { legacyTarget: {} } } });
    const { setQuiet } = await import("../utils/spinner.js");
    const { chunks } = captureStderr();

    setQuiet(true);
    try {
      await credentials.warnLegacyDeployTargets();
    } finally {
      setQuiet(false);
    }

    expect(chunks.join("")).toMatch(/deploy\.targets 는 더 이상 사용되지 않습니다/);
  });

  it("손상된 config.json 은 조용히 넘긴다 (경고가 좌표 검증을 가로막지 않게)", async () => {
    await writeFile(configPath, "{ broken", "utf-8");
    const { chunks } = captureStderr();

    await expect(credentials.warnLegacyDeployTargets()).resolves.toBeUndefined();

    expect(chunks).toEqual([]);
  });

  it("config.json 을 자동으로 고치지 않는다", async () => {
    const original = JSON.stringify({ version: 1, deploy: { targets: { legacyTarget: {} } } });
    await writeFile(configPath, original, "utf-8");
    captureStderr();

    await credentials.warnLegacyDeployTargets();

    const { readFile } = await import("node:fs/promises");
    await expect(readFile(configPath, "utf-8")).resolves.toBe(original);
  });
});
