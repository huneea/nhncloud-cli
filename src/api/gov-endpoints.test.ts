import { describe, expect, it } from "vitest";
import {
  endpointFor, keystoneIdentityUrl, ncrHost, instanceHost, imageHost,
  networkHost, blockStorageHost, nksHost,
} from "./endpoints.js";
import { EXIT_PARAM_ERROR } from "../utils/exit-codes.js";

describe("공공망 endpoint 선택", () => {
  it("기본값은 기존 일반망 주소를 유지한다", () => {
    expect(endpointFor("deploy")).toBe("https://api-deploy.nhncloudservice.com");
    expect(endpointFor("skm")).toBe("https://api-keymanager.nhncloudservice.com");
    expect(keystoneIdentityUrl()).toBe("https://api-identity-infrastructure.nhncloudservice.com/v2.0/tokens");
    expect(ncrHost("kr1")).toBe("kr1-ncr.api.nhncloudservice.com");
    expect(instanceHost("kr1")).toBe("kr1-api-instance-infrastructure.nhncloudservice.com");
  });

  it("gov profile은 공식 공공망 주소를 사용한다", () => {
    expect(endpointFor("deploy", "gov")).toBe("https://api-tcd.gov-nhncloudservice.com");
    expect(endpointFor("skm", "gov")).toBe("https://api-keymanager.gov-nhncloudservice.com");
    expect(keystoneIdentityUrl("gov")).toBe("https://api-identity-infrastructure.gov-nhncloudservice.com/v2.0/tokens");
    expect(ncrHost("kr1", "gov")).toBe("kr1-ncr.api.gov-nhncloudservice.com");
    expect(instanceHost("kr2", "gov")).toBe("kr2-api-instance-infrastructure.gov-nhncloudservice.com");
    expect(imageHost("kr2", "gov")).toBe("kr2-api-image-infrastructure.gov-nhncloudservice.com");
    expect(networkHost("kr2", "gov")).toBe("kr2-api-network-infrastructure.gov-nhncloudservice.com");
    expect(blockStorageHost("kr2", "gov")).toBe("kr2-api-block-storage-infrastructure.gov-nhncloudservice.com");
    expect(nksHost("kr1", "gov")).toBe("kr1-api-kubernetes-infrastructure.gov-nhncloudservice.com");
  });

  it("공식 문서에 없는 공공망 region과 서비스는 요청 전에 거부한다", () => {
    expect(() => ncrHost("kr2", "gov")).toThrow(expect.objectContaining({ exitCode: EXIT_PARAM_ERROR }));
    expect(() => instanceHost("kr3", "gov")).toThrow(expect.objectContaining({ exitCode: EXIT_PARAM_ERROR }));
    expect(() => endpointFor("logncrash", "gov")).toThrow();
  });
});
