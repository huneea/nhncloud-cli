import ky from "ky";
import { endpointFor } from "../../api/endpoints.js";
import { unwrap, type NhnEnvelope } from "../../api/envelope.js";
import { toNhnCloudCliError } from "../../api/httpError.js";
import { DEFAULT_TIMEOUT_MS, SYNC_TIMEOUT_MS } from "../../api/timeout.js";
import { NhnCloudCliError } from "../../utils/errors.js";
import { EXIT_API_ERROR } from "../../utils/exit-codes.js";
import type { DeployRunParams, BinaryGroup, Scenario, Binary, BinaryListParams, UploadBinaryParams, UploadBinaryResult } from "./types.js";
import type { CloudEnvironment } from "../../config/types.js";

/**
 * 응답 타입 가드 — 5-4 회피.
 * key/binaryKey 는 number | string 수용 (docs 봇 차단으로 실측 불가,
 * 불명확 케이스이므로 완화. 형식 오류로 죽는 것을 방지).
 * 진단 노트: 실측 후 number 확정 시 string 분기 제거 가능.
 */
function isBinaryGroup(val: unknown): val is BinaryGroup {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  const keyType = typeof obj["key"];
  const descriptionType = typeof obj["description"];
  return (
    (keyType === "number" || keyType === "string") &&
    typeof obj["name"] === "string" &&
    (descriptionType === "undefined" || descriptionType === "string" || obj["description"] === null)
  );
}

function isScenario(val: unknown): val is Scenario {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  return typeof obj["scenarioId"] === "number" && typeof obj["scenarioName"] === "string";
}

function isBinary(val: unknown): val is Binary {
  if (typeof val !== "object" || val === null) return false;
  const obj = val as Record<string, unknown>;
  const binaryKeyType = typeof obj["binaryKey"];
  const binarySizeType = typeof obj["binarySize"];
  return (
    (binaryKeyType === "number" || binaryKeyType === "string") &&
    (binarySizeType === "number" || binarySizeType === "string")
  );
}

export class DeployClient {
  private readonly accessToken: string;
  private readonly baseUrl: string;

  constructor(accessToken: string, environment: CloudEnvironment = "real") {
    this.accessToken = accessToken;
    this.baseUrl = endpointFor("deploy", environment);
  }

  private authHeaders(): Record<string, string> {
    return {
      "X-NHN-AUTHORIZATION": `Bearer ${this.accessToken}`,
    };
  }

  /**
   * 배포를 실행한다.
   * - targetHosts 가 비어있으면 payload 에서 targetServerHostnames 를 제외한다 (서버그룹 전체 배포).
   * - async=false(기본) 일 때 서버가 완료까지 응답을 보류하므로 ky timeout 을 600s 로 설정한다.
   */
  async run(params: DeployRunParams): Promise<Record<string, unknown>> {
    const url =
      `${this.baseUrl}/api/v2.1/projects/${encodeURIComponent(params.appKey)}` +
      `/artifacts/${encodeURIComponent(params.artifactId)}` +
      `/server-group/${encodeURIComponent(params.serverGroupId)}/deploy`;

    const isAsync = params.async ?? false;

    const payload: Record<string, unknown> = {
      concurrentNum: params.concurrentNum ?? 1,
      nextWhenFail: params.nextWhenFail ?? false,
      scenarioIds: params.scenarioIds,
      deployNote: params.deployNote ?? `CLI deploy ${new Date().toISOString()}`,
      async: isAsync,
    };

    // targetServerHostnames 빈 값이면 payload 에서 제외 (서버그룹 전체 배포)
    if (params.targetHosts) {
      payload["targetServerHostnames"] = params.targetHosts;
    }

    try {
      const res = await ky
        .post(url, {
          headers: {
            ...this.authHeaders(),
            "Content-Type": "application/json",
          },
          json: payload,
          retry: 0,
          timeout: isAsync ? DEFAULT_TIMEOUT_MS : SYNC_TIMEOUT_MS,
        })
        .json<NhnEnvelope<Record<string, unknown>>>();

      return unwrap(res);
    } catch (err) {
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * 아티팩트 목록을 조회한다.
   */
  async artifacts(appKey: string): Promise<Record<string, unknown>> {
    const url = `${this.baseUrl}/api/v2.1/projects/${encodeURIComponent(appKey)}/artifacts`;

    try {
      const res = await ky
        .get(url, {
          headers: this.authHeaders(),
          retry: 0,
          timeout: DEFAULT_TIMEOUT_MS,
        })
        .json<NhnEnvelope<Record<string, unknown>>>();

      return unwrap(res);
    } catch (err) {
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * 서버그룹 목록을 조회한다.
   */
  async serverGroups(appKey: string, artifactId: string): Promise<Record<string, unknown>> {
    const url =
      `${this.baseUrl}/api/v2.1/projects/${encodeURIComponent(appKey)}` +
      `/artifacts/${encodeURIComponent(artifactId)}/server-groups`;

    try {
      const res = await ky
        .get(url, {
          headers: this.authHeaders(),
          retry: 0,
          timeout: DEFAULT_TIMEOUT_MS,
        })
        .json<NhnEnvelope<Record<string, unknown>>>();

      return unwrap(res);
    } catch (err) {
      throw toNhnCloudCliError(err);
    }
  }

  /** 공공망과 일반망 Deploy v2.1의 서버 그룹 시나리오 목록을 조회한다. */
  async scenarios(appKey: string, artifactId: string, serverGroupId: string): Promise<Scenario[]> {
    const url =
      `${this.baseUrl}/api/v2.1/projects/${encodeURIComponent(appKey)}` +
      `/artifacts/${encodeURIComponent(artifactId)}` +
      `/server-groups/${encodeURIComponent(serverGroupId)}/scenarios`;

    try {
      const res = await ky.get(url, {
        headers: this.authHeaders(),
        retry: 0,
        timeout: DEFAULT_TIMEOUT_MS,
      }).json<NhnEnvelope<{ scenarios?: unknown }>>();
      const body = unwrap(res);
      if (!Array.isArray(body.scenarios) || !body.scenarios.every(isScenario)) {
        throw new NhnCloudCliError("scenarios 응답 형식이 올바르지 않습니다 — scenarios 배열이 없습니다.", EXIT_API_ERROR);
      }
      return body.scenarios;
    } catch (err) {
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * 배포 이력을 조회한다.
   */
  async histories(appKey: string, artifactId: string): Promise<Record<string, unknown>> {
    const url =
      `${this.baseUrl}/api/v2.1/projects/${encodeURIComponent(appKey)}` +
      `/artifacts/${encodeURIComponent(artifactId)}/deploy-histories`;

    try {
      const res = await ky
        .get(url, {
          headers: this.authHeaders(),
          retry: 0,
          timeout: DEFAULT_TIMEOUT_MS,
        })
        .json<NhnEnvelope<Record<string, unknown>>>();

      return unwrap(res);
    } catch (err) {
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * 바이너리 그룹 목록을 조회한다.
   */
  async binaryGroups(appKey: string, artifactId: string): Promise<BinaryGroup[]> {
    const url =
      `${this.baseUrl}/api/v2.1/projects/${encodeURIComponent(appKey)}` +
      `/artifacts/${encodeURIComponent(artifactId)}/binary-groups`;

    try {
      const res = await ky
        .get(url, {
          headers: this.authHeaders(),
          retry: 0,
          timeout: DEFAULT_TIMEOUT_MS,
        })
        .json<NhnEnvelope<{ binaryGroups?: unknown }>>();

      const body = unwrap(res);
      const list = body.binaryGroups;
      if (!Array.isArray(list) || !list.every(isBinaryGroup)) {
        throw new NhnCloudCliError(
          "binary-groups 응답 형식이 올바르지 않습니다 — binaryGroups 배열이 없습니다.",
          EXIT_API_ERROR,
        );
      }
      return list;
    } catch (err) {
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * 특정 바이너리 그룹의 바이너리 목록을 조회한다.
   * pageNum/pageSize/sortKey/sortDirection 은 NHN docs 의 쿼리 파라미터로 그대로 전달한다.
   */
  async binaries(
    appKey: string,
    artifactId: string,
    binaryGroupKey: number,
    params: BinaryListParams = {},
  ): Promise<{ totalCount: number; binaries: Binary[] }> {
    const url =
      `${this.baseUrl}/api/v2.1/projects/${encodeURIComponent(appKey)}` +
      `/artifacts/${encodeURIComponent(artifactId)}/binary-groups/${binaryGroupKey}/binaries`;

    const searchParams: Record<string, string | number> = {};
    if (params.pageNum !== undefined) searchParams["pageNum"] = params.pageNum;
    if (params.pageSize !== undefined) searchParams["pageSize"] = params.pageSize;
    if (params.sortKey !== undefined) searchParams["sortKey"] = params.sortKey;
    if (params.sortDirection !== undefined) searchParams["sortDirection"] = params.sortDirection;

    try {
      const res = await ky
        .get(url, {
          headers: this.authHeaders(),
          searchParams,
          retry: 0,
          timeout: DEFAULT_TIMEOUT_MS,
        })
        .json<NhnEnvelope<{ totalCount?: unknown; binaries?: unknown }>>();

      const body = unwrap(res);
      const list = body.binaries;
      if (!Array.isArray(list) || !list.every(isBinary)) {
        throw new NhnCloudCliError(
          "binaries 응답 형식이 올바르지 않습니다 — binaries 배열이 없습니다.",
          EXIT_API_ERROR,
        );
      }
      // totalCount 는 number 가 정상이나 string("123") 으로 올 수 있어(resultCode 처럼 타입 혼재)
      // 숫자 문자열이면 변환해 "전체 항목 수" 의미를 보존한다. 그 외에만 현재 페이지 길이로 fallback.
      const tc = body.totalCount;
      const totalCount =
        typeof tc === "number"
          ? tc
          : typeof tc === "string" && /^\d+$/.test(tc)
            ? Number(tc)
            : list.length;
      return { totalCount, binaries: list };
    } catch (err) {
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * 바이너리를 multipart/form-data 로 업로드한다.
   *
   * 신규 전송 경로 — 기존 메서드는 ky `json:`(JSON body) 만 쓴다 (ADR-015).
   * - 파일 파트(binaryFile)는 command 에서 statSync 가드 후 읽은 Buffer 를 Blob 으로 감싼다.
   * - Content-Type 은 수동으로 박지 않는다 — ky 가 FormData 에서 multipart boundary 를 자동 설정한다.
   *
   * ⚠️ 실측 pending — 수동 QA 로 확정 필요:
   *   - endpoint 경로 세그먼트 단/복수(`binary-group` vs `binary-groups`) — 404 시 복수형으로 교체.
   *   - 응답 binaryKey 타입(number|string) — 코드는 둘 다 수용 후 Number() 정규화.
   */
  async uploadBinary(params: UploadBinaryParams): Promise<UploadBinaryResult> {
    const url =
      `${this.baseUrl}/api/v2.1/projects/${encodeURIComponent(params.appKey)}` +
      `/artifacts/${encodeURIComponent(params.artifactId)}/binary-group/${params.binaryGroupKey}`;

    const form = new FormData();
    // Buffer → Uint8Array → Blob (Node 18+ 전역 Blob/FormData 사용; Buffer 직접 전달 시 타입 불일치)
    const blob = new Blob([new Uint8Array(params.fileBuffer)]);
    form.append("binaryFile", blob, params.fileName);
    form.append("applicationType", params.applicationType);
    if (params.description !== undefined) {
      form.append("description", params.description);
    }

    try {
      const res = await ky
        .post(url, {
          headers: this.authHeaders(), // 인증 헤더만 — multipart boundary 는 ky 가 자동 설정
          body: form,
          retry: 0,
          timeout: SYNC_TIMEOUT_MS, // 업로드는 파일 크기에 따라 길 수 있어 긴 timeout
        })
        .json<NhnEnvelope<{ downloadUrl?: unknown; binaryKey?: unknown }>>();

      const body = unwrap(res);
      // binaryKey 는 number|string 모두 수용 (기존 isBinary 와 동일 — Deploy 는 resultCode 도 문자열, 실측 전 타입 미확정).
      // 단 Number() 정규화 결과가 NaN 이면 "NaN" 이 stdout·download 입력으로 새므로 isFinite 로 차단.
      const normalizedKey = Number(body.binaryKey);
      if (typeof body.downloadUrl !== "string" || !Number.isFinite(normalizedKey)) {
        throw new NhnCloudCliError(
          "upload 응답 형식이 올바르지 않습니다 — downloadUrl/binaryKey 누락 또는 비숫자.",
          EXIT_API_ERROR,
        );
      }
      return { downloadUrl: body.downloadUrl, binaryKey: normalizedKey };
    } catch (err) {
      throw toNhnCloudCliError(err);
    }
  }

  /**
   * 바이너리를 다운로드해 내용(Buffer)을 반환한다.
   *
   * 신규 수신 경로 — 응답이 봉투 JSON 이 아니라 파일 바이너리 스트림이다 (ADR-015).
   * 다른 메서드처럼 .json()/unwrap 을 쓰면 바이너리를 JSON 으로 파싱하다 깨진다 —
   * 반드시 .arrayBuffer() 로 받는다. 성공/실패는 HTTP status(ky throwHttpErrors)로만 판정.
   * 파일 쓰기는 command 가 담당한다 (client 는 내용만 반환 — 테스트 용이).
   *
   * ⚠️ 실측 pending — 수동 QA round-trip 으로 확정 필요:
   *   - endpoint 단/복수(`binary-group` vs `binary-groups`) — 404 시 복수형으로 교체.
   *   - 응답이 raw 바이너리인지 downloadUrl JSON 인지 — QA step 5 diff 로 확인.
   */
  async downloadBinary(
    appKey: string,
    artifactId: string,
    binaryGroupKey: number,
    binaryKey: number,
  ): Promise<Buffer> {
    const url =
      `${this.baseUrl}/api/v2.1/projects/${encodeURIComponent(appKey)}` +
      `/artifacts/${encodeURIComponent(artifactId)}/binary-group/${binaryGroupKey}/binaries/${binaryKey}`;

    try {
      const ab = await ky
        .get(url, {
          headers: this.authHeaders(),
          retry: 0,
          timeout: SYNC_TIMEOUT_MS, // 큰 파일 다운로드 — 긴 timeout
        })
        .arrayBuffer();

      return Buffer.from(ab);
    } catch (err) {
      throw toNhnCloudCliError(err);
    }
  }
}
