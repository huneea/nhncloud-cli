import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NhnCloudCliError } from "../utils/errors.js";
import { EXIT_AUTH_ERROR, EXIT_CONFIG_ERROR, EXIT_PARAM_ERROR } from "../utils/exit-codes.js";
import {
  getUserAccessKey,
  getStoredProfileEnvironment,
  resolveProfileName,
  setIaasCredential,
  setProfileEnvironment,
  setServiceCredential,
  setUserAccessKey,
} from "../config/credentials.js";
import {
  verifyDnsplus,
  verifyIaas,
  verifyLogncrash,
  verifyNcr,
  verifyNcs,
  verifyUserAccessKey,
} from "./configure-verify.js";
import { configureCommand } from "./configure.js";
import { confirm, input, password } from "@inquirer/prompts";

vi.mock("../config/credentials.js", () => ({
  resolveProfileName: vi.fn(async (profile?: string) => profile ?? "default"),
  setUserAccessKey: vi.fn(),
  setServiceCredential: vi.fn(),
  setIaasCredential: vi.fn(),
  listProfilesWithUak: vi.fn(async () => []),
  getUserAccessKey: vi.fn(),
  getStoredProfileEnvironment: vi.fn(async () => undefined),
  setProfileEnvironment: vi.fn(),
}));
vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
  password: vi.fn(),
  confirm: vi.fn(),
  select: vi.fn(),
}));
vi.mock("./configure-verify.js", () => ({
  verifyUserAccessKey: vi.fn(),
  verifyLogncrash: vi.fn(),
  verifyIaas: vi.fn(),
  verifyNcr: vi.fn(),
  verifyNcs: vi.fn(),
  verifyDnsplus: vi.fn(),
}));

/** credentials 파일에 이미 있는 profile 하나를 흉내 낸다. */
function mockStoredProfile(environment: "real" | "gov"): void {
  vi.mocked(getStoredProfileEnvironment).mockResolvedValue(environment);
}

function programWithConfigure(): Command {
  return new Command("nhncloud").exitOverride().addCommand(configureCommand);
}

describe("configure logncrash Search v3", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    vi.mocked(getStoredProfileEnvironment).mockResolvedValue(undefined);
    vi.mocked(getUserAccessKey).mockResolvedValue({ id: "existing-id", secret: "existing-secret" });
    vi.mocked(verifyUserAccessKey).mockResolvedValue(true);
    vi.mocked(verifyLogncrash).mockResolvedValue(true);
    vi.mocked(verifyIaas).mockResolvedValue(true);
    vi.mocked(verifyNcr).mockResolvedValue(true);
    vi.mocked(verifyNcs).mockResolvedValue(true);
  });

  it("--logncrash-appkey만으로 비대화형 분기에 들어가 기존 profile UAK로 검증한다", async () => {
    await programWithConfigure().parseAsync([
      "node",
      "nhncloud",
      "configure",
      "--profile",
      "profile-a",
      "--logncrash-appkey",
      "appkey",
    ]);

    expect(getUserAccessKey).toHaveBeenCalledWith("profile-a");
    expect(verifyLogncrash).toHaveBeenCalledWith(
      { id: "existing-id", secret: "existing-secret" },
      "appkey",
      "real",
    );
    expect(setServiceCredential).toHaveBeenCalledWith(
      "profile-a",
      "logncrash",
      { appkey: "appkey" },
    );
  });

  it("새 UAK flag가 있으면 기존 UAK를 읽지 않고 같은 값으로 UAK와 logncrash를 검증한다", async () => {
    const uak = { id: "new-id", secret: "new-secret" };
    await programWithConfigure().parseAsync([
      "node",
      "nhncloud",
      "configure",
      "--uak-id",
      uak.id,
      "--uak-secret",
      uak.secret,
      "--logncrash-appkey",
      "appkey",
    ]);

    expect(getUserAccessKey).not.toHaveBeenCalled();
    expect(verifyUserAccessKey).toHaveBeenCalledWith(uak, "real");
    expect(verifyLogncrash).toHaveBeenCalledWith(uak, "appkey", "real");
    expect(setUserAccessKey).toHaveBeenCalledWith("default", uak);
  });

  it("기존 공공망 profile은 모든 연결 테스트를 공공망으로 보낸 뒤 저장한다", async () => {
    mockStoredProfile("gov");
    const uak = { id: "<uak-id>", secret: "<uak-secret>" };
    const iaas = { tenantId: "tenant", username: "user", password: "pass", region: "kr2" };

    await programWithConfigure().parseAsync([
      "node", "nhncloud", "configure", "--profile", "public",
      "--uak-id", uak.id, "--uak-secret", uak.secret,
      "--logncrash-appkey", "lncs-appkey",
      "--iaas-tenant-id", iaas.tenantId, "--iaas-username", iaas.username,
      "--iaas-password", iaas.password, "--iaas-region", iaas.region,
      "--ncr-appkey", "ncr-appkey", "--ncs-appkey", "ncs-appkey",
    ]);

    expect(getStoredProfileEnvironment).toHaveBeenCalledWith("public");
    expect(verifyUserAccessKey).toHaveBeenCalledWith(uak, "gov");
    expect(verifyLogncrash).toHaveBeenCalledWith(uak, "lncs-appkey", "gov");
    expect(verifyIaas).toHaveBeenCalledWith(iaas, "gov");
    expect(verifyNcr).toHaveBeenCalledWith(uak, "ncr-appkey", "gov");
    expect(verifyNcs).toHaveBeenCalledWith(uak, "ncs-appkey", "gov");
    expect(setUserAccessKey).toHaveBeenCalledWith("public", uak);
  });

  it("profile의 environment 값이 잘못되면 연결 테스트와 저장 전에 멈춘다", async () => {
    vi.mocked(getStoredProfileEnvironment).mockRejectedValue(new NhnCloudCliError("environment 오류", EXIT_CONFIG_ERROR));

    await expect(programWithConfigure().parseAsync([
      "node", "nhncloud", "configure", "--profile", "bad",
      "--uak-id", "<uak-id>", "--uak-secret", "<uak-secret>",
    ])).rejects.toMatchObject({ exitCode: EXIT_CONFIG_ERROR });

    expect(verifyUserAccessKey).not.toHaveBeenCalled();
    expect(setUserAccessKey).not.toHaveBeenCalled();
  });

  it("--logncrash-secret은 한 번 경고하고 저장 값에서는 제외한다", async () => {
    await programWithConfigure().parseAsync([
      "node",
      "nhncloud",
      "configure",
      "--no-verify",
      "--logncrash-appkey",
      "appkey",
      "--logncrash-secret",
      "legacy-secret",
    ]);

    const warnings = vi.mocked(process.stderr.write).mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.includes("--logncrash-secret은 폐기 예정"));
    expect(warnings).toHaveLength(1);
    expect(setServiceCredential).toHaveBeenCalledWith(
      "default",
      "logncrash",
      { appkey: "appkey" },
    );
  });

  it("빈 --logncrash-appkey는 profile 해석과 저장 전에 거부한다", async () => {
    await expect(
      programWithConfigure().parseAsync([
        "node",
        "nhncloud",
        "configure",
        "--logncrash-appkey",
        "",
      ]),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });
    expect(resolveProfileName).not.toHaveBeenCalled();
    expect(setServiceCredential).not.toHaveBeenCalled();
  });

  it("새 UAK와 기존 profile UAK가 모두 없으면 저장·검색 전에 EXIT_CONFIG_ERROR", async () => {
    const error = new NhnCloudCliError("UAK가 없습니다.", EXIT_CONFIG_ERROR);
    vi.mocked(getUserAccessKey).mockRejectedValue(error);

    await expect(
      programWithConfigure().parseAsync([
        "node",
        "nhncloud",
        "configure",
        "--logncrash-appkey",
        "appkey",
      ]),
    ).rejects.toBe(error);
    expect(verifyLogncrash).not.toHaveBeenCalled();
    expect(setServiceCredential).not.toHaveBeenCalled();
  });

  it("UAK·logncrash·IaaS·NCR·NCS 값을 각 verifier의 기존 위치에 전달한다", async () => {
    const uak = { id: "uak-id", secret: "uak-secret" };
    const iaas = { tenantId: "tenant", username: "user", password: "pass", region: "kr3" };
    await programWithConfigure().parseAsync([
      "node",
      "nhncloud",
      "configure",
      "--uak-id",
      uak.id,
      "--uak-secret",
      uak.secret,
      "--logncrash-appkey",
      "lncs-appkey",
      "--iaas-tenant-id",
      iaas.tenantId,
      "--iaas-username",
      iaas.username,
      "--iaas-password",
      iaas.password,
      "--iaas-region",
      iaas.region,
      "--ncr-appkey",
      "ncr-appkey",
      "--ncs-appkey",
      "ncs-appkey",
    ]);

    expect(verifyUserAccessKey).toHaveBeenCalledWith(uak, "real");
    expect(verifyLogncrash).toHaveBeenCalledWith(uak, "lncs-appkey", "real");
    expect(verifyIaas).toHaveBeenCalledWith(iaas, "real");
    expect(verifyNcr).toHaveBeenCalledWith(uak, "ncr-appkey", "real");
    expect(verifyNcs).toHaveBeenCalledWith(uak, "ncs-appkey", "real");
    expect(setIaasCredential).toHaveBeenCalledWith("default", iaas);
  });

  it("--deploy-appkey 단독 호출이 대화형으로 빠지지 않고 deploy 자격증명으로 저장된다", async () => {
    await programWithConfigure().parseAsync([
      "node",
      "nhncloud",
      "configure",
      "--profile",
      "profile-deploy",
      "--no-verify",
      "--deploy-appkey",
      "deploy-appkey",
    ]);

    // 저장 키 이름까지 단언한다 — saveAndVerify 위치 인수가 밀리면 이 단언이 잡는다.
    expect(setServiceCredential).toHaveBeenCalledWith("profile-deploy", "deploy", {
      appkey: "deploy-appkey",
    });
  });

  it("--deploy-appkey 빈 문자열은 EXIT_PARAM_ERROR 로 거부된다", async () => {
    await expect(
      programWithConfigure().parseAsync([
        "node",
        "nhncloud",
        "configure",
        "--profile",
        "profile-deploy",
        "--no-verify",
        "--deploy-appkey",
        "",
      ]),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });

    expect(setServiceCredential).not.toHaveBeenCalled();
  });

  it("--deploy-appkey 와 --apigateway-appkey 를 함께 주면 각각 제 블록에 저장된다", async () => {
    await programWithConfigure().parseAsync([
      "node",
      "nhncloud",
      "configure",
      "--profile",
      "profile-both",
      "--no-verify",
      "--apigateway-appkey",
      "apigateway-appkey",
      "--deploy-appkey",
      "deploy-appkey",
    ]);

    expect(setServiceCredential).toHaveBeenCalledWith("profile-both", "apigateway", {
      appkey: "apigateway-appkey",
    });
    expect(setServiceCredential).toHaveBeenCalledWith("profile-both", "deploy", {
      appkey: "deploy-appkey",
    });
  });

  it("--apigateway-appkey 단독 호출이 apigateway 자격증명으로 저장된다", async () => {
    await programWithConfigure().parseAsync([
      "node",
      "nhncloud",
      "configure",
      "--profile",
      "profile-apigateway",
      "--no-verify",
      "--apigateway-appkey",
      "apigateway-appkey",
    ]);

    expect(setServiceCredential).toHaveBeenCalledWith(
      "profile-apigateway",
      "apigateway",
      { appkey: "apigateway-appkey" },
    );
  });

  it("--skm-appkey 단독 호출이 skm 자격증명으로 저장된다", async () => {
    await programWithConfigure().parseAsync([
      "node",
      "nhncloud",
      "configure",
      "--profile",
      "profile-skm",
      "--no-verify",
      "--skm-appkey",
      "skm-appkey",
    ]);

    expect(setServiceCredential).toHaveBeenCalledWith(
      "profile-skm",
      "skm",
      { appkey: "skm-appkey" },
    );
  });

  it("--skm-appkey 공백 값은 EXIT_PARAM_ERROR 로 거부된다", async () => {
    await expect(
      programWithConfigure().parseAsync([
        "node",
        "nhncloud",
        "configure",
        "--profile",
        "profile-skm",
        "--no-verify",
        "--skm-appkey",
        "  ",
      ]),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });

    expect(setServiceCredential).not.toHaveBeenCalled();
  });

  it("--rds-mysql-appkey 단독 호출이 rds-mysql 자격증명으로 저장된다", async () => {
    await programWithConfigure().parseAsync([
      "node",
      "nhncloud",
      "configure",
      "--profile",
      "profile-rds",
      "--no-verify",
      "--rds-mysql-appkey",
      " rds-mysql-appkey ",
    ]);

    expect(vi.mocked(setServiceCredential).mock.calls).toStrictEqual([
      ["profile-rds", "rds-mysql", { appkey: "rds-mysql-appkey" }],
    ]);
  });

  it("--rds-mysql-appkey 공백 값은 EXIT_PARAM_ERROR 로 거부된다", async () => {
    await expect(
      programWithConfigure().parseAsync([
        "node",
        "nhncloud",
        "configure",
        "--profile",
        "profile-rds",
        "--no-verify",
        "--rds-mysql-appkey",
        "  ",
      ]),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });

    expect(setServiceCredential).not.toHaveBeenCalled();
  });

  it("--dnsplus-appkey 는 UAK 없이 profile 의 망 주소로 검증하고 저장한다", async () => {
    mockStoredProfile("gov");
    vi.mocked(verifyDnsplus).mockResolvedValue(true);

    await programWithConfigure().parseAsync([
      "node",
      "nhncloud",
      "configure",
      "--profile",
      "profile-dns",
      "--dnsplus-appkey",
      " dnsplus-appkey ",
    ]);

    expect(verifyDnsplus).toHaveBeenCalledWith("dnsplus-appkey", "gov");
    expect(verifyUserAccessKey).not.toHaveBeenCalled();
    expect(vi.mocked(setServiceCredential).mock.calls).toStrictEqual([
      ["profile-dns", "dnsplus", { appkey: "dnsplus-appkey" }],
    ]);
  });

  it("--dnsplus-appkey 검증이 실패하면 저장하지 않고 인증 오류로 끝난다", async () => {
    vi.mocked(verifyDnsplus).mockResolvedValue(false);

    await expect(
      programWithConfigure().parseAsync([
        "node",
        "nhncloud",
        "configure",
        "--profile",
        "profile-dns",
        "--dnsplus-appkey",
        "bad",
      ]),
    ).rejects.toMatchObject({ exitCode: EXIT_AUTH_ERROR });

    expect(setServiceCredential).not.toHaveBeenCalled();
  });

  it("--dnsplus-appkey 공백 값은 EXIT_PARAM_ERROR 로 거부된다", async () => {
    await expect(
      programWithConfigure().parseAsync([
        "node",
        "nhncloud",
        "configure",
        "--profile",
        "profile-dns",
        "--no-verify",
        "--dnsplus-appkey",
        "  ",
      ]),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });

    expect(setServiceCredential).not.toHaveBeenCalled();
  });
});

describe("configure --environment", () => {
  function nonInteractive(...args: string[]): Promise<Command> {
    return programWithConfigure().parseAsync([
      "node",
      "nhncloud",
      "configure",
      ...args,
      "--uak-id",
      "uak-id",
      "--uak-secret",
      "uak-secret",
    ]);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    vi.mocked(getStoredProfileEnvironment).mockResolvedValue(undefined);
    vi.mocked(verifyUserAccessKey).mockResolvedValue(true);
  });

  it("새 profile 에 gov 를 주면 공공망으로 검증하고 environment: gov 를 저장한다", async () => {
    await nonInteractive("--profile", "gov-new", "--environment", "gov");

    expect(verifyUserAccessKey).toHaveBeenCalledWith({ id: "uak-id", secret: "uak-secret" }, "gov");
    expect(setProfileEnvironment).toHaveBeenCalledWith("gov-new", "gov");
    expect(setUserAccessKey).toHaveBeenCalledWith("gov-new", { id: "uak-id", secret: "uak-secret" });
  });

  it("새 profile 에 private 를 주면 일반망으로 검증하고 environment 를 쓰지 않는다", async () => {
    await nonInteractive("--profile", "real-new", "--environment", "private");

    expect(verifyUserAccessKey).toHaveBeenCalledWith({ id: "uak-id", secret: "uak-secret" }, "real");
    expect(setProfileEnvironment).toHaveBeenCalledWith("real-new", "real");
    expect(setUserAccessKey).toHaveBeenCalled();
  });

  it("기존 gov profile 은 옵션 없이도, 같은 값을 줘도 공공망으로 검증한다", async () => {
    mockStoredProfile("gov");

    await nonInteractive("--profile", "gov-old");
    await nonInteractive("--profile", "gov-old", "--environment", "gov");

    expect(verifyUserAccessKey).toHaveBeenNthCalledWith(1, { id: "uak-id", secret: "uak-secret" }, "gov");
    expect(verifyUserAccessKey).toHaveBeenNthCalledWith(2, { id: "uak-id", secret: "uak-secret" }, "gov");
  });

  it("기존 profile 과 다른 망을 주면 검증과 저장 없이 EXIT_PARAM_ERROR 로 끝난다", async () => {
    mockStoredProfile("real");

    await expect(nonInteractive("--profile", "real-old", "--environment", "gov")).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR,
    });

    expect(verifyUserAccessKey).not.toHaveBeenCalled();
    expect(setUserAccessKey).not.toHaveBeenCalled();
    expect(setServiceCredential).not.toHaveBeenCalled();
    expect(setIaasCredential).not.toHaveBeenCalled();
    expect(setProfileEnvironment).not.toHaveBeenCalled();
  });

  it("기존 gov profile 에 private 를 주면 저장 없이 EXIT_PARAM_ERROR 로 끝난다", async () => {
    mockStoredProfile("gov");

    await expect(
      nonInteractive("--profile", "gov-old", "--environment", "private", "--logncrash-appkey", "appkey"),
    ).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });

    expect(verifyUserAccessKey).not.toHaveBeenCalled();
    expect(setUserAccessKey).not.toHaveBeenCalled();
    expect(setServiceCredential).not.toHaveBeenCalled();
    expect(setProfileEnvironment).not.toHaveBeenCalled();
  });

  it("--no-verify 로 새 gov profile 을 저장해도 environment: gov 를 남긴다", async () => {
    await nonInteractive("--profile", "gov-nv", "--environment", "gov", "--no-verify");

    expect(verifyUserAccessKey).not.toHaveBeenCalled();
    expect(setProfileEnvironment).toHaveBeenCalledWith("gov-nv", "gov");
    expect(setUserAccessKey).toHaveBeenCalledWith("gov-nv", { id: "uak-id", secret: "uak-secret" });
  });

  it.each(["real", "public", ""])("--environment %j 는 사용법 오류로 끝난다", async (value) => {
    await expect(nonInteractive("--profile", "p", "--environment", value)).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR,
    });

    expect(verifyUserAccessKey).not.toHaveBeenCalled();
    expect(setUserAccessKey).not.toHaveBeenCalled();
  });

  describe("대화형", () => {
    // clearAllMocks 는 구현을 남기므로, 테스트마다 건 프롬프트 응답이 다음 테스트로 넘어가지 않게 지운다.
    beforeEach(() => {
      vi.mocked(input).mockReset();
      vi.mocked(password).mockReset();
      vi.mocked(confirm).mockReset();
    });

    const GOV_QUESTION = "공공망(gov) profile 인가요?";

    function answer(isGov: boolean): void {
      vi.mocked(input).mockImplementation((async ({ message }: { message: string }) =>
        message === "UAK ID" ? "uak-id" : "profile-i") as never);
      vi.mocked(password).mockResolvedValue("uak-secret" as never);
      vi.mocked(confirm).mockImplementation((async ({ message }: { message: string }) =>
        message === GOV_QUESTION ? isGov : false) as never);
    }

    function interactive(...args: string[]): Promise<Command> {
      return programWithConfigure().parseAsync(["node", "nhncloud", "configure", ...args]);
    }

    function govQuestionAsked(): boolean {
      return vi.mocked(confirm).mock.calls.some(([opts]) => (opts as { message: string }).message === GOV_QUESTION);
    }

    it("새 profile 이면 망을 묻고, gov 를 고르면 공공망으로 검증하고 저장한다", async () => {
      answer(true);

      await interactive();

      expect(govQuestionAsked()).toBe(true);
      expect(verifyUserAccessKey).toHaveBeenCalledWith({ id: "uak-id", secret: "uak-secret" }, "gov");
      expect(setProfileEnvironment).toHaveBeenCalledWith("profile-i", "gov");
    });

    it("기본값(일반망)이면 environment 를 쓰지 않는다", async () => {
      answer(false);

      await interactive();

      expect(verifyUserAccessKey).toHaveBeenCalledWith({ id: "uak-id", secret: "uak-secret" }, "real");
      expect(setProfileEnvironment).toHaveBeenCalledWith("profile-i", "real");
      expect(setUserAccessKey).toHaveBeenCalled();
    });

    it("--environment 를 주거나 기존 profile 이면 망을 묻지 않는다", async () => {
      answer(false);
      await interactive("--environment", "gov");
      expect(govQuestionAsked()).toBe(false);
      expect(verifyUserAccessKey).toHaveBeenLastCalledWith({ id: "uak-id", secret: "uak-secret" }, "gov");

      mockStoredProfile("gov");
      await interactive();
      expect(govQuestionAsked()).toBe(false);
      expect(verifyUserAccessKey).toHaveBeenLastCalledWith({ id: "uak-id", secret: "uak-secret" }, "gov");
    });

    it("기존 profile 과 다른 망을 주면 UAK 를 묻기 전에 EXIT_PARAM_ERROR 로 끝난다", async () => {
      answer(false);
      mockStoredProfile("gov");

      await expect(interactive("--environment", "private")).rejects.toMatchObject({ exitCode: EXIT_PARAM_ERROR });

      expect(password).not.toHaveBeenCalled();
      expect(setUserAccessKey).not.toHaveBeenCalled();
    });

    it("iaas 질문 앞에 테넌트 ID, API 비밀번호, IAM username 찾는 곳과 공식 문서를 안내한다", async () => {
      answer(false);
      vi.mocked(confirm).mockImplementation((async ({ message }: { message: string }) =>
        message.startsWith("iaas")) as never);
      vi.mocked(input).mockResolvedValue("value" as never);
      const { select } = await import("@inquirer/prompts");
      vi.mocked(select).mockResolvedValue("kr1" as never);
      vi.mocked(verifyIaas).mockResolvedValue(true);

      await interactive();

      const stderr = vi
        .mocked(process.stderr.write)
        .mock.calls.map(([chunk]) => String(chunk))
        .join("");
      expect(stderr).toContain("API 엔드포인트 설정");
      expect(stderr).toContain("테넌트 ID");
      expect(stderr).toContain("API 비밀번호 설정");
      expect(stderr).toContain("이메일 형식");
      expect(stderr).toContain("https://docs.nhncloud.com/ko/nhncloud/ko/public-api/iaas-token/");
    });
  });
});
