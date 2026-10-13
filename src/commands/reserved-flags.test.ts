import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command } from "commander";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * root program(`src/index.ts`)이 소유한 플래그 목록이다.
 *
 * commander 는 기본 설정에서 root 옵션을 서브커맨드 인수 위치에서도 해석한다.
 * 그래서 서브커맨드가 같은 이름의 옵션을 정의하면 root 가 먼저 값을 가져가고,
 * 서브커맨드 action 은 아예 실행되지 않는다.
 *
 * 이슈 #76 이 그 사례다. `nks nodegroup upgrade <c> <ng> --version v1.31.4` 가
 * root 의 `.version("0.13.0")` 에 가로채여 CLI 버전만 출력하고 exit 0 으로 끝났다.
 * 오류 메시지가 없어 조용히 실패했다.
 *
 * 충돌은 옵션 이름을 바꿔서 피한다.
 * `enablePositionalOptions()` 는 충돌을 없애지만 `instance list --json` 같은 전역 옵션 후치 사용을 전부 깨뜨린다.
 * root `.version()` 의 플래그를 `-V, --cli-version` 으로 바꾸면 `nhncloud --version` 자체가 사라진다.
 * 이슈 #76 에서 세 방식을 모두 측정했고, 옵션 이름을 바꾸는 방식만 다른 동작을 깨뜨리지 않았다.
 *
 * root 에 옵션을 추가하면 이 목록도 함께 갱신한다.
 */
const RESERVED_ROOT_FLAGS = [
  "-V",
  "--version",
  "-h",
  "--help",
  "--json",
  "--quiet",
  "--no-color",
  "--request-timeout",
  "--proxy",
];

function flagsOf(command: Command): string[] {
  return command.options.flatMap((option) => [option.short, option.long].filter((flag): flag is string => Boolean(flag)));
}

interface Offender {
  path: string;
  flag: string;
}

function collectOffenders(command: Command, prefix: string, found: Offender[]): void {
  const path = prefix ? `${prefix} ${command.name()}` : command.name();

  for (const flag of flagsOf(command)) {
    if (RESERVED_ROOT_FLAGS.includes(flag)) {
      found.push({ path, flag });
    }
  }

  for (const sub of command.commands) {
    collectOffenders(sub, path, found);
  }
}

const COMMANDS_DIR = fileURLToPath(new URL(".", import.meta.url));

// 커맨드 모듈은 실행 시점에 훑는다. 새 파일이 추가돼도 이 테스트를 고칠 필요가 없게 하기 위해서다.
async function exportedCommands(): Promise<{ source: string; command: Command }[]> {
  const entries = await readdir(COMMANDS_DIR, { recursive: true, withFileTypes: true });
  const collected: { source: string; command: Command }[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) continue;

    const source = join(entry.parentPath, entry.name);
    const module = (await import(pathToFileURL(source).href)) as Record<string, unknown>;
    for (const value of Object.values(module)) {
      if (value instanceof Command) {
        collected.push({ source: relative(COMMANDS_DIR, source), command: value });
      }
    }
  }

  return collected;
}

// 명령 모듈 전체를 동적으로 import 해 비용이 크다. 병렬 실행 부하에서 기본 5초를 넘을 수 있어
// 한 번만 수집하고 수집 단계에만 넉넉한 시간 상한을 준다.
const IMPORT_TIMEOUT_MS = 30_000;

describe("서브커맨드 옵션과 root 예약 플래그 충돌", () => {
  let commands: { source: string; command: Command }[] = [];

  beforeAll(async () => {
    commands = await exportedCommands();
  }, IMPORT_TIMEOUT_MS);

  it("검사 대상 커맨드를 실제로 수집한다", () => {
    // 훑기가 아무것도 못 잡으면 아래 검사가 공허하게 통과하므로 하한을 고정한다.
    expect(commands.length).toBeGreaterThan(20);
  });

  it("어떤 서브커맨드도 root 예약 플래그를 재정의하지 않는다", () => {
    const offenders: Offender[] = [];

    for (const { source, command } of commands) {
      const found: Offender[] = [];
      collectOffenders(command, "", found);
      offenders.push(...found.map((entry) => ({ ...entry, path: `${source}: ${entry.path}` })));
    }

    expect(offenders).toEqual([]);
  });
});

describe("이슈 #76 회귀 — nks 버전 옵션이 action 까지 도달한다", () => {
  async function runUpgrade(argv: string[]): Promise<Record<string, unknown>> {
    const { nodegroupCommand } = await import("./nks/nodegroup.js");
    const upgrade = nodegroupCommand.commands.find((sub) => sub.name() === "upgrade");
    expect(upgrade).toBeDefined();

    // 실제 API 호출 없이 옵션 파싱 결과만 본다.
    let captured: Record<string, unknown> | undefined;
    const probe = new Command("upgrade")
      .argument("<cluster>")
      .argument("<nodegroup>");
    for (const option of upgrade!.options) {
      probe.addOption(option);
    }
    probe.action((_cluster: string, _nodegroup: string, opts: Record<string, unknown>) => {
      captured = opts;
    });

    const root = new Command("nhncloud").version("0.13.0").exitOverride();
    root.addCommand(probe.exitOverride());
    await root.parseAsync(["node", "nhncloud", ...argv]);

    expect(captured).toBeDefined();
    return captured!;
  }

  it("공백 구분 형식이 root --version 에 가로채이지 않는다", async () => {
    const opts = await runUpgrade(["upgrade", "cluster-1", "default-worker", "--kube-version", "v1.31.4"]);
    expect(opts["kubeVersion"]).toBe("v1.31.4");
  });

  it("= 구분 형식도 같은 값으로 파싱된다", async () => {
    const opts = await runUpgrade(["upgrade", "cluster-1", "default-worker", "--kube-version=v1.31.4"]);
    expect(opts["kubeVersion"]).toBe("v1.31.4");
  });
});
