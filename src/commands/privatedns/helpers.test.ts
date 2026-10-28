import { beforeEach, describe, expect, it, vi } from "vitest";
import ky from "ky";
import { getIaasCredential, getProfileEnvironment, resolveProfileName } from "../../config/credentials.js";
import type { PrivateDnsRecordSet, PrivateDnsZone } from "../../services/privatedns/types.js";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import { resolveIaasTokenContext } from "../iaas.js";
import {
  assertWritableRecordSet,
  countUserRecordSets,
  isProtectedRecordSet,
  mergeRecordSetUpdate,
  mergeZoneNetworks,
  normalizeZoneName,
  parseRecordType,
  resolvePrivateDnsClients,
  resolveRecordSet,
  resolveVpcIds,
  resolveZone,
  toRecordName,
} from "./helpers.js";

vi.mock("ky", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ky")>();
  return { ...actual, default: { ...actual.default, get: vi.fn() } };
});

vi.mock("../../config/credentials.js", () => ({
  resolveProfileName: vi.fn(),
  getIaasCredential: vi.fn(),
  getProfileEnvironment: vi.fn(),
}));

vi.mock("../iaas.js", () => ({ resolveIaasTokenContext: vi.fn() }));

const ZONE_NAME = "example.net.";

function zone(id: string, name = ZONE_NAME): PrivateDnsZone {
  return {
    id, name, description: null, status: "ACTIVE", networks: ["vpc-1"],
    created_at: "2026-10-07T06:52:06Z", updated_at: "2026-10-07T06:52:06Z",
  };
}

function rrset(id: string, over: Partial<PrivateDnsRecordSet> = {}): PrivateDnsRecordSet {
  return {
    id, name: `www.${ZONE_NAME}`, description: "web", zone_id: "zone-1", ttl: 300, type: "A",
    records: [{ content: "192.0.2.1" }], created_at: "2026-10-07T06:52:06Z", updated_at: "2026-10-07T06:52:06Z",
    ...over,
  };
}

function catchError(run: () => unknown): Error & { exitCode?: number } {
  try {
    run();
  } catch (error) {
    return error as Error & { exitCode?: number };
  }
  throw new Error("오류가 나야 하는데 나지 않았습니다.");
}

async function catchAsyncError(run: () => Promise<unknown>): Promise<Error & { exitCode?: number }> {
  try {
    await run();
  } catch (error) {
    return error as Error & { exitCode?: number };
  }
  throw new Error("오류가 나야 하는데 나지 않았습니다.");
}

describe("normalizeZoneName", () => {
  it("끝에 점이 없으면 붙인다", () => {
    expect(normalizeZoneName(" example.net ")).toBe("example.net.");
    expect(normalizeZoneName("example.net.")).toBe("example.net.");
  });

  it("빈 값은 입력 오류다", () => {
    const error = catchError(() => normalizeZoneName("  "));
    expect(error.exitCode).toBe(EXIT_PARAM_ERROR);
    expect(error.message).toBe("Private DNS zone 이름이 비어 있습니다.");
  });
});

describe("resolveZone", () => {
  const client = (zones: PrivateDnsZone[]) => ({ listZones: vi.fn(async () => zones) });

  it("UUID 가 같은 zone 을 고른다", async () => {
    const zones = [zone("zone-1"), zone("zone-2", "other.net.")];
    await expect(resolveZone(client(zones), "zone-2")).resolves.toEqual(zones[1]);
  });

  it("이름은 대소문자를 무시하고 끝의 점을 보충해 비교한다", async () => {
    const zones = [zone("zone-1"), zone("zone-2", "other.net.")];
    await expect(resolveZone(client(zones), "Example.NET")).resolves.toEqual(zones[0]);
  });

  it("이름이 같은 zone 이 둘이면 후보 UUID 를 담은 중복 오류다", async () => {
    const error = await catchAsyncError(() => resolveZone(client([zone("zone-b"), zone("zone-a")]), "example.net"));
    expect(error.exitCode).toBe(EXIT_PARAM_ERROR);
    expect(error.message).toBe('Private DNS zone 이름이 중복됩니다: "example.net" (후보 UUID: zone-a, zone-b)');
  });

  it("없는 zone 은 찾을 수 없음 오류다", async () => {
    const error = await catchAsyncError(() => resolveZone(client([zone("zone-1")]), "missing.net"));
    expect(error.exitCode).toBe(EXIT_PARAM_ERROR);
    expect(error.message).toBe('Private DNS zone을(를) 찾을 수 없습니다: "missing.net"');
  });
});

describe("toRecordName", () => {
  it("상대 이름, @, FQDN 을 FQDN 으로 바꾼다", () => {
    expect(toRecordName("www", ZONE_NAME)).toBe("www.example.net.");
    expect(toRecordName("@", ZONE_NAME)).toBe("example.net.");
    expect(toRecordName("www.example.net.", ZONE_NAME)).toBe("www.example.net.");
  });

  it("빈 값은 입력 오류다", () => {
    const error = catchError(() => toRecordName(" ", ZONE_NAME));
    expect(error.exitCode).toBe(EXIT_PARAM_ERROR);
    expect(error.message).toBe("레코드 세트 이름이 비어 있습니다.");
  });
});

describe("parseRecordType", () => {
  it("소문자 입력을 대문자 타입으로 바꾼다", () => {
    expect(parseRecordType("cname")).toBe("CNAME");
  });

  it("목록 밖 타입은 입력 오류다", () => {
    const error = catchError(() => parseRecordType("ALIAS"));
    expect(error.exitCode).toBe(EXIT_PARAM_ERROR);
    expect(error.message).toBe(
      '--type은 A, AAAA, CAA, CNAME, MX, NAPTR, NS, PTR, SOA, SPF, SRV, TXT 중 하나여야 합니다: "ALIAS"',
    );
  });
});

describe("resolveRecordSet", () => {
  const a = rrset("rr-a");
  const txt = rrset("rr-txt", { type: "TXT", records: [{ content: '"hello"' }] });
  const client = { listRecordSets: vi.fn(async () => [a, txt]) };

  it("이름이 같은 레코드 세트가 여럿이면 타입:UUID 후보를 담은 오류다", async () => {
    const error = await catchAsyncError(() => resolveRecordSet(client, zone("zone-1"), "WWW"));
    expect(error.exitCode).toBe(EXIT_PARAM_ERROR);
    expect(error.message).toBe(
      "이름이 같은 레코드 세트가 2개 있습니다: WWW.example.net. (후보: A:rr-a, TXT:rr-txt). --type 으로 고르세요.",
    );
  });

  it("타입을 주면 그 타입의 레코드 세트를 고른다", async () => {
    await expect(resolveRecordSet(client, zone("zone-1"), "www", "A")).resolves.toEqual(a);
    expect(client.listRecordSets).toHaveBeenCalledWith("zone-1");
  });

  it("UUID 가 같아도 타입이 다르면 찾을 수 없음 오류다", async () => {
    const error = await catchAsyncError(() => resolveRecordSet(client, zone("zone-1"), "rr-a", "TXT"));
    expect(error.exitCode).toBe(EXIT_PARAM_ERROR);
    expect(error.message).toBe('레코드 세트를 찾을 수 없습니다: "rr-a"');
  });
});

describe("SOA·apex NS 보호", () => {
  const soa = { name: ZONE_NAME, type: "SOA" };
  const apexNs = { name: "EXAMPLE.net.", type: "NS" };
  const subNs = { name: `sub.${ZONE_NAME}`, type: "NS" };
  const a = { name: `www.${ZONE_NAME}`, type: "A" };

  it("SOA 와 apex NS 는 보호하고 하위 이름의 NS 는 보호하지 않는다", () => {
    expect(isProtectedRecordSet(soa, ZONE_NAME)).toBe(true);
    expect(isProtectedRecordSet(apexNs, ZONE_NAME)).toBe(true);
    expect(isProtectedRecordSet(subNs, ZONE_NAME)).toBe(false);
  });

  it("보호 대상을 바꾸려 하면 입력 오류다", () => {
    const error = catchError(() => assertWritableRecordSet(soa, ZONE_NAME));
    expect(error.exitCode).toBe(EXIT_PARAM_ERROR);
    expect(error.message).toBe("SOA 와 zone apex NS 레코드 세트는 바꾸거나 지울 수 없습니다: SOA example.net.");
    expect(() => assertWritableRecordSet(subNs, ZONE_NAME)).not.toThrow();
  });

  it("사용자 레코드 세트 수에서 보호 대상을 뺀다", () => {
    expect(countUserRecordSets([soa, apexNs, subNs, a], ZONE_NAME)).toBe(2);
    expect(countUserRecordSets([soa, apexNs], ZONE_NAME)).toBe(0);
  });
});

describe("mergeRecordSetUpdate", () => {
  it("ttl 만 바꾸면 type·records·description 을 보존한다", () => {
    const current = rrset("rr-a", { records: [{ content: "192.0.2.1" }, { content: "192.0.2.2" }] });
    expect(mergeRecordSetUpdate(current, { ttl: 60 })).toEqual({
      type: "A",
      records: [{ content: "192.0.2.1" }, { content: "192.0.2.2" }],
      ttl: 60,
      description: "web",
    });
  });

  it("records 를 주면 그 목록으로 바꾼다", () => {
    expect(mergeRecordSetUpdate(rrset("rr-a"), { records: ["198.51.100.1"] }).records).toEqual([
      { content: "198.51.100.1" },
    ]);
  });

  it("현재 description 이 null 이면 빈 문자열로 보낸다", () => {
    expect(mergeRecordSetUpdate(rrset("rr-a", { description: null }), { ttl: 60 }).description).toBe("");
  });
});

describe("mergeZoneNetworks", () => {
  it("add 는 이미 연결된 VPC 와 중복된 값을 무시하고 뒤에 더한다", () => {
    expect(mergeZoneNetworks(["vpc-1"], { add: ["vpc-1", "vpc-2", "vpc-2"] })).toEqual(["vpc-1", "vpc-2"]);
  });

  it("replace 는 중복을 지운 목록으로 바꾼다", () => {
    expect(mergeZoneNetworks(["vpc-1"], { replace: ["vpc-3", "vpc-3", "vpc-4"] })).toEqual(["vpc-3", "vpc-4"]);
  });

  it("연결되지 않은 VPC 를 remove 하면 입력 오류다", () => {
    const error = catchError(() => mergeZoneNetworks(["vpc-1", "vpc-2"], { remove: ["vpc-9"] }));
    expect(error.exitCode).toBe(EXIT_PARAM_ERROR);
    expect(error.message).toBe("연결되지 않은 VPC 입니다: vpc-9");
  });

  it("결과가 빈 목록이면 입력 오류다", () => {
    const error = catchError(() => mergeZoneNetworks(["vpc-1"], { remove: ["vpc-1"] }));
    expect(error.exitCode).toBe(EXIT_PARAM_ERROR);
    expect(error.message).toBe("zone 에는 VPC 가 하나 이상 연결되어야 합니다.");
  });

  it("replace 와 add 를 함께 주면 입력 오류다", () => {
    const error = catchError(() => mergeZoneNetworks(["vpc-1"], { replace: ["vpc-2"], add: ["vpc-3"] }));
    expect(error.exitCode).toBe(EXIT_PARAM_ERROR);
    expect(error.message).toBe("--network는 --add-network, --remove-network와 함께 쓸 수 없습니다.");
  });
});

describe("resolveVpcIds", () => {
  it("VPC 목록을 한 번 조회해 이름과 UUID 를 UUID 로 바꾼다", async () => {
    const network = {
      listVpcs: vi.fn(async () => [
        { id: "vpc-1", name: "default", state: "available" },
        { id: "vpc-2", name: "app", state: "available" },
      ]),
    };
    await expect(resolveVpcIds(network as never, ["app", "vpc-1"])).resolves.toEqual(["vpc-2", "vpc-1"]);
    expect(network.listVpcs).toHaveBeenCalledTimes(1);
  });

  it("없는 VPC 는 입력 오류다", async () => {
    const network = { listVpcs: vi.fn(async () => [{ id: "vpc-1", name: "default" }]) };
    const error = await catchAsyncError(() => resolveVpcIds(network as never, ["missing"]));
    expect(error.exitCode).toBe(EXIT_PARAM_ERROR);
    expect(error.message).toBe('VPC을(를) 찾을 수 없습니다: "missing"');
  });
});

describe("resolvePrivateDnsClients", () => {
  const networkEndpoint = "https://kr1-api-network-infrastructure.nhncloudservice.com/v2.0";

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(resolveProfileName).mockResolvedValue("default");
    vi.mocked(getIaasCredential).mockResolvedValue({
      tenantId: "<tenant-id>", username: "<username>", password: "<password>", region: "kr1",
    });
  });

  it("공공망에서 Private DNS 가 없는 region 이면 토큰을 발급하기 전에 입력 오류로 끝낸다", async () => {
    vi.mocked(getProfileEnvironment).mockResolvedValue("gov");
    const error = await catchAsyncError(() => resolvePrivateDnsClients({ region: "kr2" }));
    expect(error.exitCode).toBe(EXIT_PARAM_ERROR);
    expect(resolveIaasTokenContext).not.toHaveBeenCalled();
  });

  it("일반망 kr1 이면 Keystone 의 network 주소로 두 client 를 만든다", async () => {
    vi.mocked(getProfileEnvironment).mockResolvedValue("real");
    vi.mocked(resolveIaasTokenContext).mockResolvedValue({
      profileName: "default", region: "kr1", environment: "real", tokenId: "token-1", networkEndpoint,
    } as never);
    vi.mocked(ky.get).mockImplementation(((url: string) => ({
      json: async () => (url.endsWith("/vpcs") ? { vpcs: [] } : { zones: [] }),
    })) as never);

    const { dns, network, profileName } = await resolvePrivateDnsClients({});
    await dns.listZones();
    await network.listVpcs();

    expect(profileName).toBe("default");
    expect(resolveIaasTokenContext).toHaveBeenCalledWith({});
    const urls = vi.mocked(ky.get).mock.calls.map(([url]) => String(url));
    expect(urls).toEqual([`${networkEndpoint}/privatedns/zones`, `${networkEndpoint}/vpcs`]);
    for (const [, options] of vi.mocked(ky.get).mock.calls) {
      expect(options?.headers).toEqual({ "X-Auth-Token": "token-1" });
    }
  });
});
