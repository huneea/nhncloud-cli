import { describe, expect, it } from "vitest";
import { buildRecordList, parseRecordsetName, parseRecordsetType, toFqdn } from "./helpers.js";

describe("dnsplus helpers", () => {
  it("이름을 소문자 FQDN 으로 맞춘다", () => {
    expect(toFqdn("WWW.Example.com")).toBe("www.example.com.");
    expect(toFqdn("www.example.com.")).toBe("www.example.com.");
  });

  it("존 밖의 이름은 입력 오류다", () => {
    expect(parseRecordsetName("www.example.com", "example.com.")).toBe("www.example.com.");
    expect(parseRecordsetName("example.com.", "example.com.")).toBe("example.com.");
    expect(() => parseRecordsetName("www.other.com", "example.com.")).toThrow("존 example.com. 안의 이름");
    expect(() => parseRecordsetName("badexample.com", "example.com.")).toThrow("안의 이름");
  });

  it("타입은 A, CNAME, TXT 만 받는다", () => {
    expect(parseRecordsetType("cname")).toBe("CNAME");
    expect(() => parseRecordsetType("MX")).toThrow("A, CNAME, TXT");
  });

  it("A 는 IPv4 만 받는다", () => {
    expect(buildRecordList("A", ["192.0.2.1", "192.0.2.2"])).toEqual([
      { recordDisabled: false, recordContent: "192.0.2.1" },
      { recordDisabled: false, recordContent: "192.0.2.2" },
    ]);
    expect(() => buildRecordList("A", ["not-an-ip"])).toThrow("IPv4");
    expect(() => buildRecordList("A", ["2001:db8::1"])).toThrow("IPv4");
  });

  it("CNAME 은 값 하나를 끝 점이 있는 FQDN 으로 보낸다", () => {
    expect(buildRecordList("CNAME", ["Target.example.net"])).toEqual([
      { recordDisabled: false, recordContent: "target.example.net." },
    ]);
    expect(() => buildRecordList("CNAME", ["a.example.net", "b.example.net"])).toThrow("하나만");
  });

  it("TXT 는 따옴표로 감싸고 이미 감싼 값은 겹치지 않는다", () => {
    expect(buildRecordList("TXT", ["v=spf1 mx -all"])[0]?.recordContent).toBe('"v=spf1 mx -all"');
    expect(buildRecordList("TXT", ['"v=spf1 mx -all"'])[0]?.recordContent).toBe('"v=spf1 mx -all"');
    expect(buildRecordList("TXT", ['say "hi"'])[0]?.recordContent).toBe('"say \\"hi\\""');
  });

  it("값이 없으면 입력 오류다", () => {
    expect(() => buildRecordList("A", [])).toThrow("--value");
  });
});
