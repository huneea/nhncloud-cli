import { describe, expect, it } from "vitest";
import { EXIT_PARAM_ERROR } from "../../utils/exit-codes.js";
import type { SecurityGroup } from "../../services/network/types.js";
import { parseRuleInput, requireUniqueGroupName, toCreateRuleParams } from "./helpers.js";

type RuleOptions = Parameters<typeof parseRuleInput>[0];

function expectParamError(opts: RuleOptions, message: string): void {
  let caught: unknown;
  try {
    parseRuleInput(opts);
  } catch (err) {
    caught = err;
  }
  expect(caught, `입력 ${JSON.stringify(opts)} 이 거부되지 않았다`).toMatchObject({ exitCode: EXIT_PARAM_ERROR, message });
}

describe("parseRuleInput 오류", () => {
  it("direction이 ingress·egress가 아니면 거부한다", () => {
    expectParamError({ direction: "inbound" }, '--direction은 ingress 또는 egress여야 합니다: "inbound"');
  });

  it("protocol이 허용 값이 아니면 거부한다", () => {
    expectParamError({ direction: "ingress", protocol: "TCP" },
      '--protocol은 tcp, udp, icmp, any 중 하나여야 합니다: "TCP"');
  });

  it("--port와 --port-range를 함께 지정하면 거부한다", () => {
    expectParamError({ direction: "ingress", protocol: "tcp", port: "22", portRange: "1-2" },
      "--port와 --port-range는 함께 지정할 수 없습니다.");
  });

  it("포트는 tcp·udp가 아닌 protocol과 함께 쓸 수 없다", () => {
    expectParamError({ direction: "ingress", protocol: "icmp", port: "22" },
      "포트는 --protocol tcp 또는 udp와 함께 지정합니다.");
    expectParamError({ direction: "ingress", portRange: "1-2" },
      "포트는 --protocol tcp 또는 udp와 함께 지정합니다.");
  });

  it("포트가 1~65535 정수가 아니면 거부한다", () => {
    expectParamError({ direction: "ingress", protocol: "tcp", port: "65536" },
      '--port 는 1 이상 65535 이하의 정수여야 합니다 (입력: "65536").');
    expectParamError({ direction: "ingress", protocol: "udp", portRange: "0-10" },
      '--port-range 는 1 이상 65535 이하의 정수여야 합니다 (입력: "0").');
  });

  it("--port-range가 시작-끝 형식이 아니거나 시작이 끝보다 크면 거부한다", () => {
    expectParamError({ direction: "ingress", protocol: "tcp", portRange: "2000-1000" },
      '--port-range는 시작-끝 형식이며 시작이 끝보다 클 수 없습니다: "2000-1000"');
    expectParamError({ direction: "ingress", protocol: "tcp", portRange: "80" },
      '--port-range는 시작-끝 형식이며 시작이 끝보다 클 수 없습니다: "80"');
  });

  it("--cidr와 --remote-group을 함께 지정하면 거부한다", () => {
    expectParamError({ direction: "ingress", cidr: "10.0.0.0/8", remoteGroup: "web" },
      "--cidr와 --remote-group은 함께 지정할 수 없습니다.");
  });

  it("--cidr가 IPv4 주소나 prefix 0~32 CIDR가 아니면 거부한다", () => {
    for (const cidr of ["10.0.0.0/33", "2001:db8::/32", "10.0.0.0/8/1", "host"]) {
      expectParamError({ direction: "ingress", cidr },
        `--cidr는 IPv4 주소 또는 CIDR이어야 합니다: ${JSON.stringify(cidr)}`);
    }
  });
});

describe("parseRuleInput 정상 조합", () => {
  it("tcp 단일 포트와 CIDR는 min·max를 같은 값으로 둔다", () => {
    expect(parseRuleInput({ direction: "ingress", protocol: "tcp", port: "22", cidr: "10.0.0.0/8" })).toEqual({
      direction: "ingress", protocol: "tcp", portRangeMin: 22, portRangeMax: 22, cidr: "10.0.0.0/8",
    });
  });

  it("udp 포트 범위는 시작과 끝을 나눈다", () => {
    expect(parseRuleInput({ direction: "ingress", protocol: "udp", portRange: "1000-2000" })).toEqual({
      direction: "ingress", protocol: "udp", portRangeMin: 1000, portRangeMax: 2000,
    });
  });

  it("icmp는 포트 없이 받는다", () => {
    expect(parseRuleInput({ direction: "ingress", protocol: "icmp" })).toEqual({
      direction: "ingress", protocol: "icmp",
    });
  });

  it("옵션 없는 egress는 direction만 남긴다", () => {
    expect(parseRuleInput({ direction: "egress" })).toEqual({ direction: "egress" });
  });
});

describe("toCreateRuleParams", () => {
  it("any는 protocol 키를 넣지 않고 원격 그룹 UUID를 remote_group_id로 옮긴다", () => {
    const params = toCreateRuleParams({ direction: "ingress", protocol: "any", description: "web" }, "group-1", "group-2");
    expect(params).toStrictEqual({
      security_group_id: "group-1", direction: "ingress", remote_group_id: "group-2", description: "web",
    });
  });

  it("포트와 CIDR를 API 필드 이름으로 옮긴다", () => {
    const params = toCreateRuleParams(
      { direction: "egress", protocol: "tcp", portRangeMin: 80, portRangeMax: 443, cidr: "192.0.2.0/24" },
      "group-1", undefined,
    );
    expect(params).toStrictEqual({
      security_group_id: "group-1", direction: "egress", protocol: "tcp",
      port_range_min: 80, port_range_max: 443, remote_ip_prefix: "192.0.2.0/24",
    });
  });
});

describe("requireUniqueGroupName", () => {
  const web: SecurityGroup = { id: "group-b", name: "web", description: "", tenant_id: "tenant-1", security_group_rules: [] };
  const db: SecurityGroup = { ...web, id: "group-c", name: "db" };

  it("이름이 유일하면 그 그룹을 반환한다", () => {
    expect(requireUniqueGroupName([web, db], "group-b")).toBe(web);
  });

  it("같은 이름 그룹이 둘이면 정렬된 후보 UUID와 함께 거부한다", () => {
    const twin: SecurityGroup = { ...web, id: "group-a" };
    let caught: unknown;
    try {
      requireUniqueGroupName([web, db, twin], "group-b");
    } catch (err) {
      caught = err;
    }
    expect(caught, "같은 이름 그룹이 둘인데 거부되지 않았다").toMatchObject({
      exitCode: EXIT_PARAM_ERROR,
      message: "이름이 같은 보안그룹이 2개 있어 인스턴스 연결을 변경할 수 없습니다: web "
        + "(후보 UUID: group-a, group-b). network security-group update로 이름을 먼저 바꾸세요.",
    });
  });
});
