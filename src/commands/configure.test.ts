import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NhnCloudCliError } from "../utils/errors.js";
import { EXIT_CONFIG_ERROR, EXIT_PARAM_ERROR } from "../utils/exit-codes.js";
import {
  getUserAccessKey,
  getProfileEnvironment,
  resolveProfileName,
  setIaasCredential,
  setServiceCredential,
  setUserAccessKey,
} from "../config/credentials.js";
import {
  verifyIaas,
  verifyLogncrash,
  verifyNcr,
  verifyNcs,
  verifyUserAccessKey,
} from "./configure-verify.js";
import { configureCommand } from "./configure.js";

vi.mock("../config/credentials.js", () => ({
  resolveProfileName: vi.fn(async (profile?: string) => profile ?? "default"),
  setUserAccessKey: vi.fn(),
  setServiceCredential: vi.fn(),
  setIaasCredential: vi.fn(),
  listProfilesWithUak: vi.fn(async () => []),
  getUserAccessKey: vi.fn(),
  getProfileEnvironment: vi.fn(async () => "real"),
}));
vi.mock("./configure-verify.js", () => ({
  verifyUserAccessKey: vi.fn(),
  verifyLogncrash: vi.fn(),
  verifyIaas: vi.fn(),
  verifyNcr: vi.fn(),
  verifyNcs: vi.fn(),
}));

function programWithConfigure(): Command {
  return new Command("nhncloud").exitOverride().addCommand(configureCommand);
}

describe("configure logncrash Search v3", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stderr, "write").mockImplementation((() => true) as never);
    vi.mocked(getProfileEnvironment).mockResolvedValue("real");
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
    expect(verifyUserAccessKey).toHaveBeenCalledWith(uak);
    expect(verifyLogncrash).toHaveBeenCalledWith(uak, "appkey");
    expect(setUserAccessKey).toHaveBeenCalledWith("default", uak);
  });

  it("기존 공공망 profile은 일반망 연결 테스트 전에 거부한다", async () => {
    vi.mocked(getProfileEnvironment).mockResolvedValue("gov");

    await expect(programWithConfigure().parseAsync([
      "node", "nhncloud", "configure", "--profile", "public",
      "--uak-id", "<uak-id>", "--uak-secret", "<uak-secret>",
    ])).rejects.toMatchObject({ exitCode: EXIT_CONFIG_ERROR });

    expect(getProfileEnvironment).toHaveBeenCalledWith("public", true);
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

    expect(verifyUserAccessKey).toHaveBeenCalledWith(uak);
    expect(verifyLogncrash).toHaveBeenCalledWith(uak, "lncs-appkey");
    expect(verifyIaas).toHaveBeenCalledWith(iaas);
    expect(verifyNcr).toHaveBeenCalledWith(uak, "ncr-appkey");
    expect(verifyNcs).toHaveBeenCalledWith(uak, "ncs-appkey");
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
});
