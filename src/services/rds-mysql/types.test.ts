import { describe, expect, it } from "vitest";
import { classifyJobStatus, isRdsMysqlDbUser, isRdsMysqlJob } from "./types.js";

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

describe("classifyJobStatus", () => {
  it.each([
    ["COMPLETED", "completed"],
    ["FAILED", "failed"],
    ["FAIL_TO_REGISTER", "failed"],
    ["COMPLETED_WITH_ERROR", "uncertain"],
    ["DELETED", "uncertain"],
    ["RUNNING", "running"],
    ["SOMETHING_NEW", "running"],
  ])("%s 는 %s 로 해석한다", (status, expected) => {
    expect(classifyJobStatus(status)).toBe(expected);
  });
});

describe("isRdsMysqlDbUser", () => {
  it("공식 예제 응답을 받는다", () => {
    expect(isRdsMysqlDbUser(dbUser)).toBe(true);
  });

  it("표시용 선택 필드가 null 이어도 받는다", () => {
    expect(isRdsMysqlDbUser({ ...dbUser, authenticationPlugin: null, tlsOption: null })).toBe(true);
  });

  it("dbUserId 가 없으면 거른다", () => {
    const { dbUserId: _omitted, ...withoutId } = dbUser;
    expect(isRdsMysqlDbUser(withoutId)).toBe(false);
  });

  it("표시용 선택 필드가 string 도 null 도 아니면 거른다", () => {
    expect(isRdsMysqlDbUser({ ...dbUser, tlsOption: 1 })).toBe(false);
  });
});

describe("isRdsMysqlJob", () => {
  it("resourceRelations 가 배열이 아니면 거른다", () => {
    expect(isRdsMysqlJob({ jobId: "job-1", jobStatus: "RUNNING", resourceRelations: {} })).toBe(false);
  });

  it("resourceRelations 원소의 필드가 null 이어도 받는다", () => {
    expect(
      isRdsMysqlJob({
        jobId: "job-1",
        jobStatus: "RUNNING",
        resourceRelations: [{ resourceType: null, resourceId: "resourceId-example" }],
      }),
    ).toBe(true);
  });
});
