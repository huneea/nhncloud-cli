import { beforeEach, describe, expect, it, vi } from "vitest";
import ky, { HTTPError } from "ky";
import { RdsMysqlClient } from "./client.js";
import { RdsMysqlApiError } from "./errors.js";
import { EXIT_API_ERROR, EXIT_AUTH_ERROR } from "../../utils/exit-codes.js";

// HTTPError 를 실제 클래스로 유지해야 instanceof 분기를 검증할 수 있어 HTTP 메서드만 바꾼다.
vi.mock("ky", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ky")>();
  return {
    ...actual,
    default: { ...actual.default, get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  };
});

const INSTANCE_ID = "instance-test-1";
const USER_ID = "user-test-1";
const realBase = "https://kr1-rds-mysql.api.nhncloudservice.com/v3.0";
const govBase = "https://kr1-rds-mysql.api.gov-nhncloudservice.com/v3.0";
const successfulHeader = { resultCode: 0, resultMessage: "SUCCESS", isSuccessful: true };

const dbUser = {
  dbUserId: "550e8400-e29b-41d4-a716-446655440000",
  dbUserName: "dbUserName-example",
  host: "192.168.0.1",
  authorityType: "CUSTOM",
  dbUserStatus: "STABLE",
  createdYmdt: "2023-12-31T15:00:00+09:00",
  updatedYmdt: "2023-12-31T15:00:00+09:00",
  authenticationPlugin: "NATIVE",
  tlsOption: "NONE",
};

const dbInstance = {
  dbInstanceId: "550e8400-e29b-41d4-a716-446655440000",
  dbInstanceGroupId: "550e8400-e29b-41d4-a716-446655440000",
  dbInstanceName: "dbInstanceName-example",
  description: "description-example",
  dbVersion: "MYSQL_V8411",
  dbPort: 13306,
  dbInstanceType: "MASTER",
  dbInstanceStatus: "AVAILABLE",
  progressStatus: "NONE",
  createdYmdt: "2023-12-31T15:00:00+09:00",
  updatedYmdt: "2023-12-31T15:00:00+09:00",
};

function job(jobStatus: string) {
  return {
    jobId: "550e8400-e29b-41d4-a716-446655440000",
    jobStatus,
    resourceRelations: [{ resourceType: "resourceType-example", resourceId: "resourceId-example" }],
    createdYmdt: "2023-12-31T15:00:00+09:00",
    updatedYmdt: "2023-12-31T15:00:00+09:00",
  };
}

function mockKyResponse(body: unknown) {
  return { json: async () => body } as never;
}

function success(fields: Record<string, unknown>) {
  return mockKyResponse({ header: successfulHeader, ...fields });
}

function failure(resultCode: number | string) {
  return mockKyResponse({ header: { resultCode, resultMessage: "FAIL", isSuccessful: false } });
}

function httpErrorResponse(status: number, body: string) {
  const response = new Response(body, { status, headers: { "Content-Type": "application/json" } });
  const request = new Request(`${realBase}/db-instances`);
  const error = new HTTPError(response, request, {} as never);
  return {
    json: async () => {
      throw error;
    },
  } as never;
}

function client(environment: "real" | "gov" = "real") {
  return new RdsMysqlClient("test-appkey", "test-uak-id", "test-uak-secret", "kr1", environment);
}

describe("RdsMysqlClient 요청 구성", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listDbUsers 는 일반망 host 로 세 인증 헤더를 보내고 dbUsers 를 돌려준다", async () => {
    vi.mocked(ky.get).mockReturnValue(success({ dbUsers: [dbUser] }));

    await expect(client().listDbUsers(INSTANCE_ID)).resolves.toStrictEqual([dbUser]);

    const [url, options] = vi.mocked(ky.get).mock.calls[0] ?? [];
    expect(url).toBe(`${realBase}/db-instances/${INSTANCE_ID}/db-users`);
    expect(options).toMatchObject({
      headers: {
        "X-TC-APP-KEY": "test-appkey",
        "X-TC-AUTHENTICATION-ID": "test-uak-id",
        "X-TC-AUTHENTICATION-SECRET": "test-uak-secret",
      },
      retry: 0,
    });
  });

  it("공공망 profile 은 공공망 host 로 요청한다", async () => {
    vi.mocked(ky.get).mockReturnValue(success({ dbUsers: [] }));

    await client("gov").listDbUsers(INSTANCE_ID);

    expect(vi.mocked(ky.get).mock.calls[0]?.[0]).toBe(`${govBase}/db-instances/${INSTANCE_ID}/db-users`);
  });

  it("경로의 ID 는 인코딩한다", async () => {
    vi.mocked(ky.get).mockReturnValue(success({ dbUsers: [] }));

    await client().listDbUsers("a/b");

    expect(vi.mocked(ky.get).mock.calls[0]?.[0]).toBe(`${realBase}/db-instances/a%2Fb/db-users`);
  });

  it("listDbInstances 는 공식 예제 응답을 받는다", async () => {
    vi.mocked(ky.get).mockReturnValue(success({ dbInstances: [dbInstance] }));

    await expect(client().listDbInstances()).resolves.toStrictEqual([dbInstance]);
    expect(vi.mocked(ky.get).mock.calls[0]?.[0]).toBe(`${realBase}/db-instances`);
  });

  it("getDbInstance 결과에는 header 키가 없다", async () => {
    vi.mocked(ky.get).mockReturnValue(success({ ...dbInstance, supportAuthenticationPlugin: true }));

    const result = await client().getDbInstance(INSTANCE_ID);

    expect(result).toStrictEqual({ ...dbInstance, supportAuthenticationPlugin: true });
    expect(Object.keys(result)).not.toContain("header");
  });

  it("getJob 결과에는 header 키가 없다", async () => {
    vi.mocked(ky.get).mockReturnValue(success(job("COMPLETED")));

    const result = await client().getJob("job-1");

    expect(result).toStrictEqual(job("COMPLETED"));
    expect(vi.mocked(ky.get).mock.calls[0]?.[0]).toBe(`${realBase}/jobs/job-1`);
  });

  it("createDbUser 는 입력을 json 본문으로 그대로 보내고 jobId 를 돌려준다", async () => {
    vi.mocked(ky.post).mockReturnValue(success({ jobId: "job-created" }));
    const input = {
      dbUserName: "app_user",
      dbPassword: "fake-password-for-test",
      host: "%",
      authorityType: "CRUD" as const,
      authenticationPlugin: "CACHING_SHA2" as const,
      tlsOption: "NONE" as const,
    };

    await expect(client().createDbUser(INSTANCE_ID, input)).resolves.toBe("job-created");

    const [url, options] = vi.mocked(ky.post).mock.calls[0] ?? [];
    expect(url).toBe(`${realBase}/db-instances/${INSTANCE_ID}/db-users`);
    expect(options).toMatchObject({ json: input, retry: 0 });
  });

  it("createDbSchema 는 dbSchemaName 을 보내고 jobId 를 돌려준다", async () => {
    vi.mocked(ky.post).mockReturnValue(success({ jobId: "job-schema" }));

    await expect(client().createDbSchema(INSTANCE_ID, "app_db")).resolves.toBe("job-schema");

    expect(vi.mocked(ky.post).mock.calls[0]?.[1]).toMatchObject({ json: { dbSchemaName: "app_db" } });
  });

  it("updateDbUser 는 값이 undefined 인 키를 빼고 PUT 한다", async () => {
    vi.mocked(ky.put).mockReturnValue(success({ jobId: "job-updated" }));

    await expect(
      client().updateDbUser(INSTANCE_ID, USER_ID, { authorityType: "READ", tlsOption: undefined }),
    ).resolves.toBe("job-updated");

    const [url, options] = vi.mocked(ky.put).mock.calls[0] ?? [];
    expect(url).toBe(`${realBase}/db-instances/${INSTANCE_ID}/db-users/${USER_ID}`);
    expect((options as { json?: unknown } | undefined)?.json).toStrictEqual({ authorityType: "READ" });
  });

  it("updateDbUser 는 값이 있는 tlsOption 을 본문에 그대로 넣는다", async () => {
    vi.mocked(ky.put).mockReturnValue(success({ jobId: "job-updated" }));

    await client().updateDbUser(INSTANCE_ID, USER_ID, { authorityType: "CRUD", tlsOption: "SSL" });

    const options = vi.mocked(ky.put).mock.calls[0]?.[1];
    expect((options as { json?: unknown } | undefined)?.json).toStrictEqual({ authorityType: "CRUD", tlsOption: "SSL" });
  });

  it("deleteDbUser 는 DELETE 하고 jobId 를 돌려준다", async () => {
    vi.mocked(ky.delete).mockReturnValue(success({ jobId: "job-deleted" }));

    await expect(client().deleteDbUser(INSTANCE_ID, USER_ID)).resolves.toBe("job-deleted");
    expect(vi.mocked(ky.delete).mock.calls[0]?.[0]).toBe(
      `${realBase}/db-instances/${INSTANCE_ID}/db-users/${USER_ID}`,
    );
  });
});

describe("RdsMysqlClient 응답 형식과 오류", () => {
  beforeEach(() => vi.clearAllMocks());

  it("dbUsers 가 배열이 아니면 형식 오류다", async () => {
    vi.mocked(ky.get).mockReturnValue(success({ dbUsers: {} }));

    await expect(client().listDbUsers(INSTANCE_ID)).rejects.toMatchObject({
      message: "RDS for MySQL 응답 형식 오류: dbUsers",
      exitCode: EXIT_API_ERROR,
    });
  });

  it("header 가 없으면 형식 오류다", async () => {
    vi.mocked(ky.get).mockReturnValue(mockKyResponse({ dbUsers: [] }));

    await expect(client().listDbUsers(INSTANCE_ID)).rejects.toMatchObject({
      message: "RDS for MySQL 응답 형식 오류: header",
      exitCode: EXIT_API_ERROR,
    });
  });

  it("쓰기 응답의 jobId 가 string 이 아니면 형식 오류다", async () => {
    vi.mocked(ky.delete).mockReturnValue(success({ jobId: 1 }));

    await expect(client().deleteDbUser(INSTANCE_ID, USER_ID)).rejects.toMatchObject({
      message: "RDS for MySQL 응답 형식 오류: jobId",
      exitCode: EXIT_API_ERROR,
    });
  });

  it("봉투 실패 80401 은 RdsMysqlApiError 이고 인증 오류다", async () => {
    vi.mocked(ky.get).mockReturnValue(failure(80401));

    const err = await client().listDbUsers(INSTANCE_ID).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RdsMysqlApiError);
    expect(err).toMatchObject({ resultCode: 80401, exitCode: EXIT_AUTH_ERROR });
  });

  it("문자열 resultCode 80403 도 인증 오류다", async () => {
    vi.mocked(ky.get).mockReturnValue(failure("80403"));

    await expect(client().listDbUsers(INSTANCE_ID)).rejects.toMatchObject({ exitCode: EXIT_AUTH_ERROR });
  });

  it("HTTP 200 봉투의 resultCode 401 도 인증 오류다", async () => {
    vi.mocked(ky.get).mockReturnValue(failure(401));

    const err = await client().listDbInstances().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RdsMysqlApiError);
    expect(err).toMatchObject({ resultCode: 401, exitCode: EXIT_AUTH_ERROR });
  });

  it("문자열 resultCode 403 도 인증 오류다", async () => {
    vi.mocked(ky.get).mockReturnValue(failure("403"));

    await expect(client().listDbInstances()).rejects.toMatchObject({ exitCode: EXIT_AUTH_ERROR });
  });

  it.each([
    ["숫자", 500],
    ["문자열", "500"],
  ])("조회 요청의 HTTP 200 봉투 실패 %s 500 은 API 오류이고 앱키 확인 안내를 붙인다", async (_case, resultCode) => {
    vi.mocked(ky.get).mockReturnValue(failure(resultCode));

    const err = await client().listDbInstances().catch((e: unknown) => e);

    expect(err).toMatchObject({ exitCode: EXIT_API_ERROR });
    expect((err as Error).message).toContain("rds-mysql.appkey");
    expect((err as RdsMysqlApiError).summary).not.toContain("appkey");
  });

  it("쓰기 요청의 HTTP 200 봉투 실패 500 에는 앱키 확인 안내를 붙이지 않는다", async () => {
    vi.mocked(ky.post).mockReturnValue(failure(500));

    const err = await client().createDbSchema(INSTANCE_ID, "app_db").catch((e: unknown) => e);

    expect(err).toMatchObject({ resultCode: 500, exitCode: EXIT_API_ERROR });
    expect((err as Error).message).not.toContain("appkey");
  });

  it("봉투 실패 -1 은 API 오류이고 앱키 확인 안내를 붙이지 않는다", async () => {
    vi.mocked(ky.get).mockReturnValue(failure(-1));

    const err = await client().listDbUsers(INSTANCE_ID).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RdsMysqlApiError);
    expect(err).toMatchObject({ message: "RDS for MySQL API 오류 (-1): FAIL", exitCode: EXIT_API_ERROR });
  });

  it("봉투 본문의 HTTP 401 오류는 RdsMysqlApiError 이고 인증 오류다", async () => {
    vi.mocked(ky.get).mockReturnValue(
      httpErrorResponse(
        401,
        JSON.stringify({ header: { resultCode: 80401, resultMessage: "Unauthorized", isSuccessful: false } }),
      ),
    );

    const err = await client().listDbInstances().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RdsMysqlApiError);
    expect(err).toMatchObject({ resultCode: 80401, httpStatus: 401, exitCode: EXIT_AUTH_ERROR });
  });

  it("HTTP 500 본문의 봉투 resultCode 500 에는 앱키 확인 안내를 붙이지 않는다", async () => {
    vi.mocked(ky.get).mockReturnValue(
      httpErrorResponse(
        500,
        JSON.stringify({ header: { resultCode: 500, resultMessage: "Internal Server Error", isSuccessful: false } }),
      ),
    );

    const err = await client().listDbInstances().catch((e: unknown) => e);

    expect(err).toMatchObject({ resultCode: 500, httpStatus: 500, exitCode: EXIT_API_ERROR });
    expect((err as Error).message).not.toContain("appkey");
  });

  it("봉투 본문의 HTTP 503 오류는 RdsMysqlApiError 이고 HTTP 상태를 담은 API 오류다", async () => {
    vi.mocked(ky.get).mockReturnValue(
      httpErrorResponse(
        503,
        JSON.stringify({ header: { resultCode: 99999, resultMessage: "Service Unavailable", isSuccessful: false } }),
      ),
    );

    const err = await client().listDbInstances().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RdsMysqlApiError);
    expect(err).toMatchObject({ resultCode: 99999, httpStatus: 503, exitCode: EXIT_API_ERROR });
  });

  it("봉투가 아닌 본문의 HTTP 500 오류는 RdsMysqlApiError 가 아닌 API 오류다", async () => {
    vi.mocked(ky.get).mockReturnValue(httpErrorResponse(500, "<html>Internal Server Error</html>"));

    const err = await client().listDbInstances().catch((e: unknown) => e);

    expect(err).not.toBeInstanceOf(RdsMysqlApiError);
    expect(err).toMatchObject({ exitCode: EXIT_API_ERROR });
  });

  it("오류 메시지에 요청 본문의 비밀번호를 넣지 않는다", async () => {
    vi.mocked(ky.post).mockReturnValue(failure(-1));

    const err = await client()
      .createDbUser(INSTANCE_ID, {
        dbUserName: "app_user",
        dbPassword: "fake-password-for-test",
        host: "%",
        authorityType: "CRUD",
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RdsMysqlApiError);
    expect((err as Error).message).not.toContain("fake-password-for-test");
  });
});

describe("RdsMysqlClient.waitForJob", () => {
  beforeEach(() => vi.clearAllMocks());

  it("RUNNING 다음 COMPLETED 면 completed 와 마지막 job 을 돌려준다", async () => {
    vi.mocked(ky.get)
      .mockReturnValueOnce(success(job("RUNNING")))
      .mockReturnValueOnce(success(job("COMPLETED")));

    await expect(client().waitForJob("job-1", { timeoutMs: 60_000, intervalMs: 0 })).resolves.toStrictEqual({
      outcome: "completed",
      job: job("COMPLETED"),
    });
  });

  it("RUNNING 다음 FAILED 면 failed 를 돌려준다", async () => {
    vi.mocked(ky.get)
      .mockReturnValueOnce(success(job("RUNNING")))
      .mockReturnValueOnce(success(job("FAILED")));

    await expect(client().waitForJob("job-1", { timeoutMs: 60_000, intervalMs: 0 })).resolves.toMatchObject({
      outcome: "failed",
      job: { jobStatus: "FAILED" },
    });
  });

  it("DELETED 면 uncertain 을 돌려준다", async () => {
    vi.mocked(ky.get).mockReturnValueOnce(success(job("DELETED")));

    await expect(client().waitForJob("job-1", { timeoutMs: 60_000, intervalMs: 0 })).resolves.toMatchObject({
      outcome: "uncertain",
    });
  });

  it("timeoutMs 0 이면 조회 없이 timeout 과 job null 을 돌려준다", async () => {
    await expect(client().waitForJob("job-1", { timeoutMs: 0, intervalMs: 0 })).resolves.toStrictEqual({
      outcome: "timeout",
      job: null,
    });
    expect(ky.get).not.toHaveBeenCalled();
  });

  it("상태 조회 오류는 그대로 던진다", async () => {
    vi.mocked(ky.get).mockReturnValueOnce(failure(80401));

    await expect(client().waitForJob("job-1", { timeoutMs: 60_000, intervalMs: 0 })).rejects.toBeInstanceOf(
      RdsMysqlApiError,
    );
  });
});
