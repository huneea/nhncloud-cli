import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { RdsMysqlClient } from "../../services/rds-mysql/client.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { configureCommanderExitCodes } from "../commander-errors.js";
import { formatCell, resolveRdsMysqlClient } from "./helpers.js";
import { instanceCommand } from "./instance.js";
import { jobCommand } from "./job.js";
import { schemaCommand } from "./schema.js";
import { userCommand } from "./user.js";

vi.mock("./helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./helpers.js")>();
  return { ...actual, resolveRdsMysqlClient: vi.fn() };
});
vi.mock("../../utils/spinner.js", () => ({ startSpinner: vi.fn(), stopSpinner: vi.fn() }));

const INSTANCE_ID = "11111111-2222-3333-4444-555555555555";
const JOB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

const client = new RdsMysqlClient("appkey", "uak-id", "uak-secret", "kr1", "real");
const listDbUsers = vi.spyOn(client, "listDbUsers");
const listDbSchemas = vi.spyOn(client, "listDbSchemas");
const getDbInstance = vi.spyOn(client, "getDbInstance");
const getJob = vi.spyOn(client, "getJob");

function program(): Command {
  const root = new Command("nhncloud")
    .exitOverride()
    .option("--json")
    .option("--quiet")
    .addCommand(instanceCommand)
    .addCommand(schemaCommand)
    .addCommand(userCommand)
    .addCommand(jobCommand);
  configureCommanderExitCodes(root);
  return root;
}

async function run(...args: string[]): Promise<void> {
  await program().parseAsync(["node", "nhncloud", ...args]);
}

describe("rds-mysql 조회 명령", () => {
  let stdoutWrite: MockInstance<typeof process.stdout.write>;
  const stdout = (): string => stdoutWrite.mock.calls.map((call) => String(call[0])).join("");

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.mocked(resolveRdsMysqlClient).mockResolvedValue({ client, profileName: "default" });
    listDbUsers.mockResolvedValue([
      { dbUserId: "u1", dbUserName: "app", host: "%", authorityType: "CRUD", dbUserStatus: "STABLE" },
      { dbUserId: "u2", dbUserName: "ro", host: "10.0.0.%", authorityType: "READ", dbUserStatus: "STABLE" },
    ]);
    listDbSchemas.mockResolvedValue([]);
    getDbInstance.mockResolvedValue({
      dbInstanceId: INSTANCE_ID, dbInstanceName: "db1", dbInstanceStatus: "AVAILABLE", dbVersion: "MYSQL_V8033",
    });
    getJob.mockResolvedValue({
      jobId: JOB_ID,
      jobStatus: "COMPLETED",
      resourceRelations: [
        { resourceType: "DB_USER", resourceId: "u1" },
        { resourceType: "DB_INSTANCE", resourceId: INSTANCE_ID },
      ],
    });
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
  });

  it("user list --quiet은 dbUserId를 줄마다 출력한다", async () => {
    await run("--quiet", "user", "list", INSTANCE_ID);
    expect(listDbUsers).toHaveBeenCalledWith(INSTANCE_ID);
    expect(stdout()).toBe("u1\nu2\n");
  });

  it("user list --json은 배열을 그대로 출력한다", async () => {
    await run("--json", "user", "list", INSTANCE_ID);
    expect(JSON.parse(stdout())).toEqual([
      { dbUserId: "u1", dbUserName: "app", host: "%", authorityType: "CRUD", dbUserStatus: "STABLE" },
      { dbUserId: "u2", dbUserName: "ro", host: "10.0.0.%", authorityType: "READ", dbUserStatus: "STABLE" },
    ]);
  });

  it("instance get은 UUID가 아니면 EXIT_PARAM_ERROR로 끝나고 client를 만들지 않는다", async () => {
    await expect(run("instance", "get", "not-a-uuid")).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(resolveRdsMysqlClient).not.toHaveBeenCalled();
    expect(getDbInstance).not.toHaveBeenCalled();
  });

  it("instance get은 앞뒤 공백이 붙은 UUID도 거른다", async () => {
    await expect(run("instance", "get", ` ${INSTANCE_ID}`)).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(resolveRdsMysqlClient).not.toHaveBeenCalled();
  });

  it("job get --quiet은 jobStatus를 출력한다", async () => {
    await run("--quiet", "job", "get", JOB_ID);
    expect(getJob).toHaveBeenCalledWith(JOB_ID);
    expect(stdout()).toBe("COMPLETED\n");
  });

  it("job get의 table은 resourceRelations를 resourceType:resourceId로 잇는다", async () => {
    await run("job", "get", JOB_ID);
    expect(stdout()).toContain(`DB_USER:u1,DB_INSTANCE:${INSTANCE_ID}`);
  });

  it("instance get의 table과 --json 출력에는 header가 없다", async () => {
    await run("instance", "get", INSTANCE_ID);
    const table = stdout();
    expect(table).toContain("dbInstanceName");
    expect(table).toContain("db1");
    expect(table).not.toContain("header");

    stdoutWrite.mockClear();
    await run("--json", "instance", "get", INSTANCE_ID);
    const json = JSON.parse(stdout()) as Record<string, unknown>;
    expect(json).toEqual({
      dbInstanceId: INSTANCE_ID, dbInstanceName: "db1", dbInstanceStatus: "AVAILABLE", dbVersion: "MYSQL_V8033",
    });
    expect(json).not.toHaveProperty("header");
  });

  it("schema list의 빈 배열은 table 모드에서 결과 없음을 출력하고 성공한다", async () => {
    await run("schema", "list", INSTANCE_ID);
    expect(stdout()).toBe("결과 없음\n");
  });
});

describe("formatCell", () => {
  it("null과 undefined는 -로 쓴다", () => {
    expect(formatCell(null)).toBe("-");
    expect(formatCell(undefined)).toBe("-");
  });

  it("배열은 쉼표로 잇는다", () => {
    expect(formatCell(["a", "b"])).toBe("a,b");
  });

  it("제어 문자를 치환한다", () => {
    expect(formatCell("a\u001b[31mred")).not.toContain("\u001b");
  });
});
