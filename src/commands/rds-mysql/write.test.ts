import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { RdsMysqlClient } from "../../services/rds-mysql/client.js";
import { RdsMysqlApiError } from "../../services/rds-mysql/errors.js";
import type { RdsMysqlDbInstanceDetail } from "../../services/rds-mysql/types.js";
import { EXIT_API_ERROR, EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { configureCommanderExitCodes } from "../commander-errors.js";
import { processStdin } from "../input-source.js";
import { resolveRdsMysqlClient } from "./helpers.js";
import { schemaCommand } from "./schema.js";
import { userCommand } from "./user.js";

vi.mock("./helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./helpers.js")>();
  return { ...actual, resolveRdsMysqlClient: vi.fn() };
});
vi.mock("../../utils/spinner.js", () => ({ startSpinner: vi.fn(), stopSpinner: vi.fn() }));

const INSTANCE_ID = "11111111-2222-3333-4444-555555555555";
const USER_ID = "66666666-7777-8888-9999-000000000000";
const JOB_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PASSWORD = "s3cret-pass";

const client = new RdsMysqlClient("appkey", "uak-id", "uak-secret", "kr1", "real");
const getDbInstance = vi.spyOn(client, "getDbInstance");
const listDbUsers = vi.spyOn(client, "listDbUsers");
const listDbSchemas = vi.spyOn(client, "listDbSchemas");
const createDbSchema = vi.spyOn(client, "createDbSchema");
const createDbUser = vi.spyOn(client, "createDbUser");
const updateDbUser = vi.spyOn(client, "updateDbUser");
const deleteDbUser = vi.spyOn(client, "deleteDbUser");
const waitForJob = vi.spyOn(client, "waitForJob");

const stdinIsTty = vi.spyOn(processStdin, "isTTY", "get");
const stdinRead = vi.spyOn(processStdin, "read");

const INSTANCE: RdsMysqlDbInstanceDetail = {
  dbInstanceId: INSTANCE_ID,
  dbInstanceName: "db1",
  dbInstanceStatus: "AVAILABLE",
  progressStatus: "NONE",
  supportAuthenticationPlugin: true,
};

function program(): Command {
  const root = new Command("nhncloud")
    .exitOverride()
    .option("--json")
    .option("--quiet")
    .addCommand(schemaCommand)
    .addCommand(userCommand);
  configureCommanderExitCodes(root);
  return root;
}

async function run(...args: string[]): Promise<void> {
  await program().parseAsync(["node", "nhncloud", ...args]);
}

function pipeStdin(text: string): void {
  stdinIsTty.mockReturnValue(undefined);
  stdinRead.mockReturnValue(Buffer.from(text, "utf-8"));
}

const CREATE_ARGS = ["user", "create", INSTANCE_ID, "--name", "app", "--host", "10.0.0.%", "--authority", "crud"];

describe("rds-mysql 쓰기 명령 (ADR-047)", () => {
  let stdoutWrite: MockInstance<typeof process.stdout.write>;
  let stderrWrite: MockInstance<typeof process.stderr.write>;
  const stdout = (): string => stdoutWrite.mock.calls.map((call) => String(call[0])).join("");
  const stderr = (): string => stderrWrite.mock.calls.map((call) => String(call[0])).join("");

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrWrite = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.mocked(resolveRdsMysqlClient).mockResolvedValue({ client, profileName: "default" });
    getDbInstance.mockResolvedValue(INSTANCE);
    listDbSchemas.mockResolvedValue([{ dbSchemaId: "s1", dbSchemaName: "orders", dbSchemaStatus: "STABLE" }]);
    listDbUsers.mockResolvedValue([
      {
        dbUserId: USER_ID,
        dbUserName: "app",
        host: "%",
        authorityType: "CRUD",
        dbUserStatus: "STABLE",
        authenticationPlugin: "NATIVE",
        tlsOption: "SSL",
      },
    ]);
    createDbSchema.mockResolvedValue(JOB_ID);
    createDbUser.mockResolvedValue(JOB_ID);
    updateDbUser.mockResolvedValue(JOB_ID);
    deleteDbUser.mockResolvedValue(JOB_ID);
    waitForJob.mockResolvedValue({ outcome: "completed", job: { jobId: JOB_ID, jobStatus: "COMPLETED" } });
    pipeStdin(`${PASSWORD}\n`);
  });

  afterEach(() => {
    stdoutWrite.mockRestore();
    stderrWrite.mockRestore();
  });

  describe("미리보기", () => {
    it("user create를 --yes 없이 실행하면 요청하지 않고 applied가 false이며 비밀번호를 어디에도 내지 않는다", async () => {
      await run("--json", ...CREATE_ARGS);

      expect(createDbUser).not.toHaveBeenCalled();
      const result = JSON.parse(stdout()) as Record<string, unknown>;
      expect(result).toMatchObject({ operation: "user-create", target: "'app'@'10.0.0.%'", applied: false, jobId: null });
      expect(stdout()).not.toContain(PASSWORD);
      expect(stderr()).not.toContain(PASSWORD);
      expect(stderr()).toContain("미리보기입니다. 요청하지 않았습니다. 반영하려면 --yes를 붙입니다.");
    });

    it("progressStatus가 NONE이 아니면 경고하고 미리보기는 성공한다", async () => {
      getDbInstance.mockResolvedValue({ ...INSTANCE, progressStatus: "CREATING_USER" });
      await run("schema", "create", INSTANCE_ID, "--name", "billing");

      expect(stderr()).toContain("다른 작업이 진행 중입니다");
      expect(stderr()).toContain("progressStatus=CREATING_USER");
      expect(createDbSchema).not.toHaveBeenCalled();
    });

    it("--quiet 미리보기는 stdout에 아무것도 내지 않는다", async () => {
      await run("--quiet", "schema", "create", INSTANCE_ID, "--name", "billing");
      expect(stdout()).toBe("");
    });
  });

  describe("user create", () => {
    it("--yes --wait --quiet은 표준 입력의 끝 줄바꿈을 지운 비밀번호를 보내고 jobId 한 줄을 출력한다", async () => {
      await run("--quiet", ...CREATE_ARGS, "--yes", "--wait");

      expect(createDbUser).toHaveBeenCalledWith(INSTANCE_ID, {
        dbUserName: "app",
        dbPassword: PASSWORD,
        host: "10.0.0.%",
        authorityType: "CRUD",
      });
      expect(waitForJob).toHaveBeenCalledWith(JOB_ID, { timeoutMs: 300_000 });
      expect(stdout()).toBe(`${JOB_ID}\n`);
      expect(stderr()).not.toContain(PASSWORD);
    });

    it("--json 결과에 비밀번호가 없다", async () => {
      await run("--json", ...CREATE_ARGS, "--yes", "--wait", "--auth-plugin", "caching-sha2", "--tls", "x509");

      expect(createDbUser).toHaveBeenCalledWith(INSTANCE_ID, expect.objectContaining({
        authenticationPlugin: "CACHING_SHA2",
        tlsOption: "X509",
      }));
      const result = JSON.parse(stdout()) as Record<string, unknown>;
      expect(result).toEqual({
        operation: "user-create",
        dbInstanceId: INSTANCE_ID,
        target: "'app'@'10.0.0.%'",
        dbUserId: null,
        authorityType: "CRUD",
        previousAuthorityType: null,
        authenticationPlugin: "CACHING_SHA2",
        tlsOption: "X509",
        action: "create",
        applied: true,
        jobId: JOB_ID,
        jobStatus: "COMPLETED",
      });
      expect(stdout()).not.toContain(PASSWORD);
    });

    it("TTY에서 비밀번호 없이 실행하면 EXIT_PARAM_ERROR이고 client를 만들지 않는다", async () => {
      stdinIsTty.mockReturnValue(true);
      await expect(run(...CREATE_ARGS)).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
      expect(resolveRdsMysqlClient).not.toHaveBeenCalled();
    });

    it("3자 비밀번호는 EXIT_PARAM_ERROR이고 오류 문구에 값을 넣지 않는다", async () => {
      pipeStdin("abc\n");
      const error = await run(...CREATE_ARGS).catch((e: unknown) => e);
      expect(error).toMatchObject({ exitCode: EXIT_PARAM_ERROR });
      expect((error as Error).message).toBe("DB 사용자 비밀번호는 4자 이상 256자 이하여야 합니다.");
      expect(resolveRdsMysqlClient).not.toHaveBeenCalled();
    });

    it("같은 이름@host 사용자가 있으면 --yes여도 EXIT_PARAM_ERROR이고 요청하지 않는다", async () => {
      await expect(
        run("user", "create", INSTANCE_ID, "--name", "app", "--host", "%", "--authority", "read", "--yes"),
      ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR, message: "이미 있는 DB 사용자입니다: 'app'@'%'" });
      expect(createDbUser).not.toHaveBeenCalled();
    });

    it("host 대소문자만 다른 사용자가 있으면 같은 사용자로 보고 EXIT_PARAM_ERROR다", async () => {
      listDbUsers.mockResolvedValue([
        { dbUserId: USER_ID, dbUserName: "app", host: "App.example.com", authorityType: "CRUD", dbUserStatus: "STABLE" },
      ]);
      await expect(
        run("user", "create", INSTANCE_ID, "--name", "app", "--host", "app.example.com", "--authority", "read", "--yes"),
      ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR, message: "이미 있는 DB 사용자입니다: 'app'@'app.example.com'" });
      expect(createDbUser).not.toHaveBeenCalled();
    });

    it("이름 대소문자가 다르면 다른 사용자로 보고 미리보기를 낸다", async () => {
      await run("--json", "user", "create", INSTANCE_ID, "--name", "App", "--host", "%", "--authority", "read");
      expect(JSON.parse(stdout())).toMatchObject({ target: "'App'@'%'", applied: false });
    });

    it("--auth-plugin을 줬는데 인스턴스가 지원하지 않으면 EXIT_PARAM_ERROR다", async () => {
      getDbInstance.mockResolvedValue({ ...INSTANCE, supportAuthenticationPlugin: false });
      await expect(run(...CREATE_ARGS, "--auth-plugin", "native", "--yes")).rejects.toMatchObject({
        exitCode: EXIT_PARAM_ERROR,
      });
      expect(createDbUser).not.toHaveBeenCalled();
    });

    it("--timeout을 --wait 없이 주면 EXIT_PARAM_ERROR다", async () => {
      await expect(run(...CREATE_ARGS, "--timeout", "10")).rejects.toMatchObject({
        exitCode: EXIT_PARAM_ERROR,
        message: "--timeout은 --wait와 함께 씁니다.",
      });
      expect(resolveRdsMysqlClient).not.toHaveBeenCalled();
    });
  });

  describe("user create 입력 검증", () => {
    const createWith = (option: string, value: string): string[] => {
      const base: Record<string, string> = { "--name": "app", "--host": "10.0.0.%", "--authority": "crud" };
      base[option] = value;
      return ["user", "create", INSTANCE_ID, ...Object.entries(base).flat()];
    };

    it.each([
      ["--name", "빈 값", ""],
      ["--name", "33자", "a".repeat(33)],
      ["--name", "제어 문자", "app\x01"],
      ["--name", "예약 이름", "admin"],
      ["--host", "공백 포함", "10.0.0. 1"],
      ["--host", "46자", "h".repeat(46)],
      ["--authority", "CUSTOM", "custom"],
      ["--authority", "프로토타입 키", "__proto__"],
      ["--auth-plugin", "지원하지 않는 값", "md5"],
      ["--auth-plugin", "프로토타입 키", "toString"],
      ["--tls", "지원하지 않는 값", "tls"],
      ["--tls", "프로토타입 키", "constructor"],
    ])("%s %s는 EXIT_PARAM_ERROR이고 client를 만들지 않는다", async (option, _case, value) => {
      const error = await run(...createWith(option, value)).catch((e: unknown) => e);
      expect(error).toMatchObject({ exitCode: EXIT_PARAM_ERROR });
      expect((error as Error).message).not.toContain(PASSWORD);
      expect(resolveRdsMysqlClient).not.toHaveBeenCalled();
    });

    it.each([
      ["--name", "32자", "a".repeat(32), `'${"a".repeat(32)}'@'10.0.0.%'`],
      ["--host", "45자", "h".repeat(45), `'app'@'${"h".repeat(45)}'`],
    ])("%s %s는 받아 미리보기를 낸다", async (option, _case, value, target) => {
      await run("--json", ...createWith(option, value));
      expect(JSON.parse(stdout())).toMatchObject({ target, applied: false });
    });

    it("257자 비밀번호는 EXIT_PARAM_ERROR이고 오류 문구에 값을 넣지 않는다", async () => {
      const longPassword = "p".repeat(257);
      pipeStdin(`${longPassword}\n`);
      const error = await run(...CREATE_ARGS).catch((e: unknown) => e);
      expect(error).toMatchObject({ exitCode: EXIT_PARAM_ERROR });
      expect((error as Error).message).not.toContain(longPassword.slice(0, 16));
      expect(resolveRdsMysqlClient).not.toHaveBeenCalled();
    });

    it("256자 비밀번호는 받아 그대로 보낸다", async () => {
      const maxPassword = "p".repeat(256);
      pipeStdin(`${maxPassword}\n`);
      await run(...CREATE_ARGS, "--yes");
      expect(createDbUser).toHaveBeenCalledWith(INSTANCE_ID, expect.objectContaining({ dbPassword: maxPassword }));
    });

    it("--password-file 앞에 BOM이 있으면 EXIT_PARAM_ERROR이고 오류 문구에 값을 넣지 않는다", async () => {
      const dir = mkdtempSync(join(tmpdir(), "nhncloud-rds-mysql-test-"));
      try {
        const file = join(dir, "password.txt");
        writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`${PASSWORD}\n`)]));
        const error = await run(...CREATE_ARGS, "--password-file", file, "--yes").catch((e: unknown) => e);
        expect(error).toMatchObject({
          exitCode: EXIT_PARAM_ERROR,
          message: "DB 사용자 비밀번호 앞에 BOM(U+FEFF)이 있습니다. BOM 없는 UTF-8로 저장해 다시 실행하세요.",
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
      expect(resolveRdsMysqlClient).not.toHaveBeenCalled();
      expect(createDbUser).not.toHaveBeenCalled();
    });

    it("따옴표, 백슬래시, %, 유니코드가 섞인 비밀번호를 바꾸지 않고 보낸다", async () => {
      const special = `a'b"c\\d%e_한글🔑`;
      pipeStdin(`${special}\n`);
      await run(...CREATE_ARGS, "--yes");
      expect(createDbUser).toHaveBeenCalledWith(INSTANCE_ID, expect.objectContaining({ dbPassword: special }));
    });

    it("--password-file은 끝 줄바꿈을 지운 값을 요청 본문에 넣는다", async () => {
      const filePassword = "file-only-pass";
      const dir = mkdtempSync(join(tmpdir(), "nhncloud-rds-mysql-test-"));
      try {
        const file = join(dir, "password.txt");
        writeFileSync(file, `${filePassword}\n`);
        await run("--json", ...CREATE_ARGS, "--password-file", file, "--yes");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }

      expect(createDbUser).toHaveBeenCalledWith(INSTANCE_ID, expect.objectContaining({ dbPassword: filePassword }));
      expect(stdout()).not.toContain(filePassword);
      expect(stderr()).not.toContain(filePassword);
    });
  });

  describe("user update", () => {
    it("권한이 같으면 --yes여도 요청하지 않고 action이 unchanged다", async () => {
      await run("--json", "user", "update", INSTANCE_ID, USER_ID, "--authority", "CRUD", "--yes");

      expect(updateDbUser).not.toHaveBeenCalled();
      expect(JSON.parse(stdout())).toMatchObject({ action: "unchanged", applied: false, jobId: null });
      expect(stderr()).toContain("권한이 이미 CRUD라 요청하지 않았습니다.");
    });

    it("권한이 다르면 현재 TLS 옵션만 함께 보내고 인증 플러그인과 비밀번호는 보내지 않는다", async () => {
      await run("--json", "user", "update", INSTANCE_ID, USER_ID, "--authority", "ddl", "--yes");

      expect(updateDbUser).toHaveBeenCalledTimes(1);
      const body = updateDbUser.mock.calls[0]?.[2];
      expect(body).toStrictEqual({ authorityType: "DDL", tlsOption: "SSL" });
      expect(JSON.parse(stdout())).toMatchObject({
        operation: "user-update",
        target: "'app'@'%'",
        dbUserId: USER_ID,
        authorityType: "DDL",
        previousAuthorityType: "CRUD",
        authenticationPlugin: null,
        tlsOption: "SSL",
        action: "update",
        applied: true,
        jobId: JOB_ID,
      });
      expect(stderr()).toContain(`nhncloud rds-mysql job get ${JOB_ID}로 확인합니다`);
    });

    it("기본값이 아닌 인증 플러그인을 쓰는 사용자도 요청 본문에 authenticationPlugin을 넣지 않는다", async () => {
      listDbUsers.mockResolvedValue([
        {
          dbUserId: USER_ID,
          dbUserName: "app",
          host: "%",
          authorityType: "READ",
          dbUserStatus: "STABLE",
          authenticationPlugin: "CACHING_SHA2",
          tlsOption: "X509",
        },
      ]);
      await run("user", "update", INSTANCE_ID, USER_ID, "--authority", "crud", "--yes");

      const body = updateDbUser.mock.calls[0]?.[2];
      expect(body).not.toHaveProperty("authenticationPlugin");
      expect(body).not.toHaveProperty("dbPassword");
      expect(body).toStrictEqual({ authorityType: "CRUD", tlsOption: "X509" });
    });

    it("인스턴스가 인증 플러그인을 지원하지 않으면 TLS 옵션도 본문에서 뺀다", async () => {
      getDbInstance.mockResolvedValue({ ...INSTANCE, supportAuthenticationPlugin: false });
      await run("user", "update", INSTANCE_ID, USER_ID, "--authority", "all", "--yes");

      expect(updateDbUser).toHaveBeenCalledWith(INSTANCE_ID, USER_ID, { authorityType: "ALL" });
    });

    it("현재 권한이 CUSTOM이면 되돌릴 수 없다고 경고한다", async () => {
      listDbUsers.mockResolvedValue([
        { dbUserId: USER_ID, dbUserName: "legacy", host: "%", authorityType: "CUSTOM", dbUserStatus: "STABLE" },
      ]);
      await run("user", "update", INSTANCE_ID, USER_ID, "--authority", "read");

      expect(stderr()).toContain("다시 CUSTOM으로 되돌릴 수 없습니다");
      expect(updateDbUser).not.toHaveBeenCalled();
    });
  });

  describe("user delete", () => {
    it("dbUserId가 목록에 없으면 EXIT_PARAM_ERROR다", async () => {
      const missing = "99999999-9999-9999-9999-999999999999";
      await expect(run("user", "delete", INSTANCE_ID, missing, "--yes")).rejects.toMatchObject({
        exitCode: EXIT_PARAM_ERROR,
        message: `DB 사용자를 찾을 수 없습니다: ${missing}. nhncloud rds-mysql user list ${INSTANCE_ID}로 dbUserId를 확인하세요.`,
      });
      expect(deleteDbUser).not.toHaveBeenCalled();
    });

    it("--yes 없이 실행하면 지우지 않고 applied가 false다", async () => {
      await run("--json", "user", "delete", INSTANCE_ID, USER_ID);

      expect(deleteDbUser).not.toHaveBeenCalled();
      expect(JSON.parse(stdout())).toMatchObject({ operation: "user-delete", action: "delete", applied: false, jobId: null });
      expect(stderr()).toContain("미리보기입니다. 요청하지 않았습니다. 반영하려면 --yes를 붙입니다.");
    });

    it("--yes면 지우고 현재 권한을 결과에 담는다", async () => {
      await run("--json", "user", "delete", INSTANCE_ID, USER_ID, "--yes");

      expect(deleteDbUser).toHaveBeenCalledWith(INSTANCE_ID, USER_ID);
      expect(JSON.parse(stdout())).toMatchObject({
        operation: "user-delete",
        target: "'app'@'%'",
        authorityType: "CRUD",
        action: "delete",
        applied: true,
      });
    });
  });

  describe("DB 사용자 상태 (dbUserStatus)", () => {
    function userWithStatus(dbUserStatus: string, dbUserId = USER_ID) {
      return { dbUserId, dbUserName: "app", host: "%", authorityType: "CRUD", dbUserStatus };
    }

    it("user create는 같은 이름@host라도 DELETED 사용자는 중복으로 보지 않고 요청한다", async () => {
      listDbUsers.mockResolvedValue([userWithStatus("DELETED")]);
      await run("user", "create", INSTANCE_ID, "--name", "app", "--host", "%", "--authority", "read", "--yes");

      expect(createDbUser).toHaveBeenCalledTimes(1);
    });

    it("user create는 DELETED 기록과 STABLE 사용자가 함께 있으면 중복으로 막는다", async () => {
      listDbUsers.mockResolvedValue([
        userWithStatus("DELETED", "99999999-9999-9999-9999-999999999999"),
        userWithStatus("STABLE"),
      ]);
      await expect(
        run("user", "create", INSTANCE_ID, "--name", "app", "--host", "%", "--authority", "read", "--yes"),
      ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR, message: "이미 있는 DB 사용자입니다: 'app'@'%'" });
      expect(createDbUser).not.toHaveBeenCalled();
    });

    it("user create는 같은 사용자를 지우는 중(DELETING)이면 삭제가 끝난 뒤 다시 실행하라고 막는다", async () => {
      listDbUsers.mockResolvedValue([userWithStatus("DELETING")]);
      await expect(
        run("user", "create", INSTANCE_ID, "--name", "app", "--host", "%", "--authority", "read", "--yes"),
      ).rejects.toMatchObject({
        exitCode: EXIT_PARAM_ERROR,
        message: `같은 DB 사용자를 지우는 중입니다: 'app'@'%'. 삭제가 끝난 뒤 nhncloud rds-mysql user list ${INSTANCE_ID}로 확인하고 다시 실행하세요.`,
      });
      expect(createDbUser).not.toHaveBeenCalled();
    });

    it.each(["CREATING", "UPDATING", "SYNCING"])(
      "user update는 %s 사용자를 미리보기에서도 막고 요청하지 않는다",
      async (status) => {
        listDbUsers.mockResolvedValue([userWithStatus(status)]);
        await expect(run("user", "update", INSTANCE_ID, USER_ID, "--authority", "ddl")).rejects.toMatchObject({
          exitCode: EXIT_PARAM_ERROR,
          message: `DB 사용자에 다른 작업이 진행 중입니다 (dbUserStatus=${status}). 요청하지 않았습니다. nhncloud rds-mysql user list ${INSTANCE_ID}로 상태가 STABLE인지 확인한 뒤 다시 실행하세요.`,
        });
        expect(stdout()).toBe("");
        expect(updateDbUser).not.toHaveBeenCalled();
      },
    );

    it("user update는 권한이 같아도 STABLE이 아니면 unchanged 대신 막는다", async () => {
      listDbUsers.mockResolvedValue([userWithStatus("UPDATING")]);
      await expect(run("user", "update", INSTANCE_ID, USER_ID, "--authority", "crud", "--yes")).rejects.toMatchObject({
        exitCode: EXIT_PARAM_ERROR,
      });
      expect(updateDbUser).not.toHaveBeenCalled();
    });

    it.each(["DELETING", "DELETED"])("user delete는 %s 사용자를 --yes여도 막는다", async (status) => {
      listDbUsers.mockResolvedValue([userWithStatus(status)]);
      await expect(run("user", "delete", INSTANCE_ID, USER_ID, "--yes")).rejects.toMatchObject({
        exitCode: EXIT_PARAM_ERROR,
        message: `이미 지웠거나 지우는 중인 DB 사용자입니다 (dbUserStatus=${status}). 요청하지 않았습니다. nhncloud rds-mysql user list ${INSTANCE_ID}로 상태가 STABLE인지 확인한 뒤 다시 실행하세요.`,
      });
      expect(deleteDbUser).not.toHaveBeenCalled();
    });

    it("오류 문구의 dbUserStatus는 제어 문자를 치환한다", async () => {
      listDbUsers.mockResolvedValue([userWithStatus("UPD\u001b[31mATING")]);
      await expect(run("user", "delete", INSTANCE_ID, USER_ID, "--yes")).rejects.toSatisfy(
        (err: Error) => !err.message.includes("\u001b"),
      );
      expect(deleteDbUser).not.toHaveBeenCalled();
    });
  });

  describe("schema create", () => {
    it.each([["1abc"], ["mysql"], ["MySQL"]])("--name %s는 EXIT_PARAM_ERROR이고 client를 만들지 않는다", async (name) => {
      await expect(run("schema", "create", INSTANCE_ID, "--name", name)).rejects.toMatchObject({
        exitCode: EXIT_PARAM_ERROR,
      });
      expect(resolveRdsMysqlClient).not.toHaveBeenCalled();
    });

    it("64자 이름은 받고 65자 이름은 거른다", async () => {
      await run("schema", "create", INSTANCE_ID, "--name", `a${"b".repeat(63)}`);
      expect(createDbSchema).not.toHaveBeenCalled();

      await expect(run("schema", "create", INSTANCE_ID, "--name", `a${"b".repeat(64)}`)).rejects.toMatchObject({
        exitCode: EXIT_PARAM_ERROR,
      });
    });

    it("이미 있는 이름이면 EXIT_PARAM_ERROR이고 요청하지 않는다", async () => {
      await expect(run("schema", "create", INSTANCE_ID, "--name", "orders", "--yes")).rejects.toMatchObject({
        exitCode: EXIT_PARAM_ERROR,
        message: "이미 있는 DB 스키마입니다: orders",
      });
      expect(createDbSchema).not.toHaveBeenCalled();
    });

    it("--yes --wait --timeout은 대기 상한을 밀리초로 넘긴다", async () => {
      await run("schema", "create", INSTANCE_ID, "--name", "billing", "--yes", "--wait", "--timeout", "10");

      expect(createDbSchema).toHaveBeenCalledWith(INSTANCE_ID, "billing");
      expect(waitForJob).toHaveBeenCalledWith(JOB_ID, { timeoutMs: 10_000 });
    });
  });

  describe("요청 실패", () => {
    it("요청이 RdsMysqlApiError가 아닌 오류로 실패하면 접수 여부 불명을 안내하고 원래 오류를 던진다", async () => {
      const original = new Error("fetch failed");
      createDbUser.mockRejectedValue(original);

      await expect(run(...CREATE_ARGS, "--yes")).rejects.toBe(original);
      expect(stderr()).toContain(
        `주의: 요청이 접수됐는지 알 수 없습니다. 다시 실행하기 전에 nhncloud rds-mysql user list ${INSTANCE_ID}로 반영 여부를 확인하세요.`,
      );
      expect(stdout()).toBe("");
    });

    it("요청이 RdsMysqlApiError로 실패하면 접수 여부 불명 안내를 하지 않는다", async () => {
      const original = new RdsMysqlApiError(80400, "invalid parameter");
      createDbUser.mockRejectedValue(original);

      await expect(run(...CREATE_ARGS, "--yes")).rejects.toBe(original);
      expect(stderr()).not.toContain("요청이 접수됐는지 알 수 없습니다");
    });
  });

  describe("요청 실패의 HTTP 상태", () => {
    it("HTTP 5xx 봉투로 실패하면 결과를 아는 실패로 보지 않고 접수 여부 불명을 안내한다", async () => {
      const original = new RdsMysqlApiError(80500, "internal error", 503);
      createDbUser.mockRejectedValue(original);

      await expect(run(...CREATE_ARGS, "--yes")).rejects.toBe(original);
      expect(stderr()).toContain("요청이 접수됐는지 알 수 없습니다");
    });

    it.each([
      ["HTTP 400", 400],
      ["HTTP 200 봉투", undefined],
    ])("%s 실패는 접수 여부 불명 안내를 하지 않는다", async (_case, httpStatus) => {
      const original = new RdsMysqlApiError(80400, "invalid parameter", httpStatus);
      createDbUser.mockRejectedValue(original);

      await expect(run(...CREATE_ARGS, "--yes")).rejects.toBe(original);
      expect(stderr()).not.toContain("요청이 접수됐는지 알 수 없습니다");
    });
  });

  describe("--wait 결과", () => {
    it("failed면 결과를 먼저 출력하고 원인을 고친 뒤 다시 실행하라고 안내한다", async () => {
      waitForJob.mockResolvedValue({ outcome: "failed", job: { jobId: JOB_ID, jobStatus: "FAILED" } });

      const error = await run("--json", ...CREATE_ARGS, "--yes", "--wait").catch((e: unknown) => e);
      expect(error).toMatchObject({
        exitCode: EXIT_API_ERROR,
        message: `RDS for MySQL 작업이 실패했습니다 (jobId=${JOB_ID}, jobStatus=FAILED). 원인을 확인해 고친 뒤 다시 실행하세요.`,
      });
      expect(JSON.parse(stdout())).toMatchObject({ applied: true, jobId: JOB_ID, jobStatus: "FAILED" });
    });

    it("오류 문구의 jobStatus 는 제어 문자를 치환하고 --json 결과에는 서버 값을 그대로 둔다", async () => {
      waitForJob.mockResolvedValue({ outcome: "failed", job: { jobId: JOB_ID, jobStatus: "FAILED\x1b[31m" } });

      const error = await run("--json", ...CREATE_ARGS, "--yes", "--wait").catch((e: unknown) => e);
      expect(error).toMatchObject({
        exitCode: EXIT_API_ERROR,
        message: `RDS for MySQL 작업이 실패했습니다 (jobId=${JOB_ID}, jobStatus=FAILED?[31m). 원인을 확인해 고친 뒤 다시 실행하세요.`,
      });
      expect(JSON.parse(stdout())).toMatchObject({ jobStatus: "FAILED\x1b[31m" });
    });

    it("uncertain이면 결과를 먼저 출력하고 다시 실행하지 말라고 안내한다", async () => {
      waitForJob.mockResolvedValue({ outcome: "uncertain", job: { jobId: JOB_ID, jobStatus: "COMPLETED_WITH_ERROR" } });

      const error = await run("--json", ...CREATE_ARGS, "--yes", "--wait").catch((e: unknown) => e);
      expect(error).toMatchObject({
        exitCode: EXIT_API_ERROR,
        message: `RDS for MySQL 작업 결과를 확정하지 못했습니다 (jobId=${JOB_ID}, jobStatus=COMPLETED_WITH_ERROR). 다시 실행하지 말고 nhncloud rds-mysql job get ${JOB_ID}와 nhncloud rds-mysql user list ${INSTANCE_ID}로 확인하세요.`,
      });
      expect(JSON.parse(stdout())).toMatchObject({ applied: true, jobStatus: "COMPLETED_WITH_ERROR" });
    });

    it("timeout이고 받은 작업이 없으면 마지막 jobStatus를 없음으로 쓴다", async () => {
      waitForJob.mockResolvedValue({ outcome: "timeout", job: null });

      const error = await run("--json", ...CREATE_ARGS, "--yes", "--wait", "--timeout", "10").catch((e: unknown) => e);
      expect(error).toMatchObject({
        exitCode: EXIT_API_ERROR,
        message: `RDS for MySQL 작업이 대기 상한(10초) 안에 끝나지 않았습니다 (jobId=${JOB_ID}, 마지막 jobStatus=없음). 작업은 계속 진행될 수 있습니다. 다시 실행하지 말고 nhncloud rds-mysql job get ${JOB_ID}로 확인하세요.`,
      });
      expect(JSON.parse(stdout())).toMatchObject({ applied: true, jobStatus: null });
    });

    it("waitForJob이 reject하면 결과를 먼저 출력하고 작업 상태를 확인하지 못했다고 안내한다", async () => {
      waitForJob.mockRejectedValue(new Error("socket hang up"));

      const error = await run("--json", ...CREATE_ARGS, "--yes", "--wait").catch((e: unknown) => e);
      expect(error).toMatchObject({
        exitCode: EXIT_API_ERROR,
        message: `작업 상태를 확인하지 못했습니다 (jobId=${JOB_ID}): socket hang up. 다시 실행하지 말고 nhncloud rds-mysql job get ${JOB_ID}와 nhncloud rds-mysql user list ${INSTANCE_ID}로 확인하세요.`,
      });
      expect(JSON.parse(stdout())).toMatchObject({ applied: true, jobId: JOB_ID, jobStatus: null });
      expect(stdout()).not.toContain(PASSWORD);
      expect(stderr()).not.toContain(PASSWORD);
    });
  });
});
