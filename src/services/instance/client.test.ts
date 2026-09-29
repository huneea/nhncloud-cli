import { beforeEach, describe, expect, it, vi } from "vitest";
import ky from "ky";
import { InstanceClient } from "./client.js";

vi.mock("ky", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ky")>();
  return { ...actual, default: { ...actual.default, post: vi.fn() } };
});

const compute = "https://kr1-api-instance-infrastructure.nhncloudservice.com/v2/tenant";
const image = "https://kr1-api-image-infrastructure.nhncloudservice.com";

describe("InstanceClient 보안그룹 연결", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(ky.post).mockResolvedValue({} as never);
  });

  it.each(["addSecurityGroup", "removeSecurityGroup"] as const)("%s 는 server action 으로 보안그룹 이름을 보낸다", async (method) => {
    const client = new InstanceClient("token", compute, image);
    await client[method]("server 1", "web-sg");
    expect(ky.post).toHaveBeenCalledTimes(1);
    expect(ky.post).toHaveBeenCalledWith(`${compute}/servers/server%201/action`, expect.objectContaining({
      headers: { "X-Auth-Token": "token" },
      json: { [method]: { name: "web-sg" } },
      retry: 0,
    }));
  });
});
