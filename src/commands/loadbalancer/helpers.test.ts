import { describe, expect, it, vi } from "vitest";
import type { IpAclGroup, LoadBalancer } from "../../services/loadbalancer/types.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import {
  collectOption,
  normalizeCidrForCompare,
  optionalTrimmed,
  parseIpAclAction,
  requireResourceInput,
  requireResourceInputs,
  requireYes,
  resolveIpAclGroupId,
  resolveIpAclGroups,
  resolveLoadBalancerId,
} from "./helpers.js";

function loadBalancer(id: string, name: string): LoadBalancer {
  return {
    id,
    name,
    vip_address: "192.0.2.10",
    provisioning_status: "ACTIVE",
    operating_status: "ONLINE",
    ipacl_group_action: null,
    ipacl_groups: [],
  };
}

function ipAclGroup(id: string, name: string): IpAclGroup {
  return {
    id,
    name,
    action: "ALLOW",
    ipacl_target_count: "0",
    loadbalancers: [],
  };
}

describe("requireResourceInput", () => {
  it("입력을 trim한다", () => {
    expect(requireResourceInput("  resource-a  ", "리소스")).toBe("resource-a");
  });

  it("공백 입력을 API 호출 전에 EXIT_PARAM_ERROR로 거부한다", () => {
    try {
      requireResourceInput("   ", "리소스");
      throw new Error("예외가 발생해야 합니다.");
    } catch (error) {
      expect(error).toBeInstanceOf(NhnCloudCliError);
      expect((error as NhnCloudCliError).exitCode).toBe(EXIT_PARAM_ERROR);
    }
  });
});

describe("쓰기 입력 helper", () => {
  it("action은 ALLOW·DENY 원문만 허용한다", () => {
    expect(parseIpAclAction("ALLOW")).toBe("ALLOW");
    expect(parseIpAclAction("DENY")).toBe("DENY");
    expect(() => parseIpAclAction("allow")).toThrow("ALLOW 또는 DENY");
  });

  it("설명 trim, --yes, 반복 group 입력을 순수 검증한다", () => {
    expect(optionalTrimmed("  description  ")).toBe("description");
    expect(optionalTrimmed(undefined)).toBeUndefined();
    expect(requireYes(true, "작업")).toBe(true);
    expect(() => requireYes(false, "작업")).toThrow("--yes");
    expect(collectOption("group-2", ["group-1"])).toEqual(["group-1", "group-2"]);
    expect(requireResourceInputs([" group-1 "], "IP ACL 그룹")).toEqual(["group-1"]);
    expect(() => requireResourceInputs([], "IP ACL 그룹")).toThrow("한 개 이상");
  });
});

describe("resolveLoadBalancerId", () => {
  it("이름과 같은 다른 리소스가 있어도 정확한 UUID를 우선한다", async () => {
    const client = {
      listLoadBalancers: vi.fn().mockResolvedValue([
        loadBalancer("lb-uuid", "other"),
        loadBalancer("other-id", "lb-uuid"),
      ]),
    };

    await expect(resolveLoadBalancerId(client, "lb-uuid")).resolves.toBe("lb-uuid");
  });

  it("정확한 이름 하나를 UUID로 해석한다", async () => {
    const client = {
      listLoadBalancers: vi.fn().mockResolvedValue([loadBalancer("lb-1", "public-lb")]),
    };

    await expect(resolveLoadBalancerId(client, "public-lb")).resolves.toBe("lb-1");
  });

  it("중복 이름이면 정렬된 후보 UUID를 포함해 거부한다", async () => {
    const client = {
      listLoadBalancers: vi.fn().mockResolvedValue([
        loadBalancer("lb-z", "same"),
        loadBalancer("lb-a", "same"),
      ]),
    };

    await expect(resolveLoadBalancerId(client, "same")).rejects.toThrow(
      "후보 UUID: lb-a, lb-z",
    );
  });
});

describe("resolveIpAclGroupId", () => {
  it("UUID와 이름을 해석하고 미발견 입력을 거부한다", async () => {
    const client = {
      listIpAclGroups: vi.fn().mockResolvedValue([
        ipAclGroup("group-1", "office"),
        ipAclGroup("group-2", "partners"),
      ]),
    };

    await expect(resolveIpAclGroupId(client, "group-1")).resolves.toBe("group-1");
    await expect(resolveIpAclGroupId(client, "partners")).resolves.toBe("group-2");
    await expect(resolveIpAclGroupId(client, "missing")).rejects.toThrow(
      "찾을 수 없습니다",
    );
  });

  it("해석된 그룹 UUID가 비어 있으면 API path 조립 전에 거부한다", async () => {
    const client = {
      listIpAclGroups: vi.fn().mockResolvedValue([ipAclGroup("", "broken")]),
    };

    await expect(resolveIpAclGroupId(client, "broken")).rejects.toMatchObject({
      exitCode: EXIT_PARAM_ERROR,
    });
  });

  it("여러 그룹을 한 번 조회해 입력 순서대로 반환한다", async () => {
    const listIpAclGroups = vi.fn().mockResolvedValue([
      ipAclGroup("group-1", "office"),
      ipAclGroup("group-2", "partners"),
    ]);

    await expect(
      resolveIpAclGroups({ listIpAclGroups }, ["partners", "group-1"]),
    ).resolves.toEqual([
      ipAclGroup("group-2", "partners"),
      ipAclGroup("group-1", "office"),
    ]);
    expect(listIpAclGroups).toHaveBeenCalledTimes(1);
  });

  it("CIDR 비교용 정규화는 단독 IP를 /32·/128로 맞추고 대소문자를 합친다", () => {
    expect(normalizeCidrForCompare("203.0.113.5")).toBe("203.0.113.5/32");
    expect(normalizeCidrForCompare(" 203.0.113.5/32 ")).toBe("203.0.113.5/32");
    expect(normalizeCidrForCompare("2001:DB8::1")).toBe("2001:db8::1/128");
    expect(normalizeCidrForCompare("203.0.113.0/24")).toBe("203.0.113.0/24");
  });
});
