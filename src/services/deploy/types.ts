/** 바이너리 그룹 — `GET .../binary-groups` 의 binaryGroups[] 항목 */
export interface BinaryGroup {
  /** 그룹 key (binaries 조회의 binaryGroupKey 입력) */
  key: number | string;
  name: string;
  description?: string | null;
  regionCode: string;
  createDate: string;
}

/** 서버 그룹에 매핑된 Deploy 시나리오. */
export interface Scenario {
  scenarioId: number;
  scenarioName: string;
}

/** 바이너리 — `GET .../binary-groups/{key}/binaries` 의 binaries[] 항목 */
export interface Binary {
  binaryKey: number | string;
  version: string;
  binaryName: string;
  /** 파일 크기 (bytes) */
  binarySize: number | string;
  uploadDate: string;
  uploader: string;
  description: string;
}

/** 바이너리 목록 조회 쿼리 파라미터 */
export interface BinaryListParams {
  pageNum?: number;
  pageSize?: number;
  /** 정렬 기준 (예: UPLOAD_DATE) */
  sortKey?: string;
  /** 정렬 방향 (예: DESC) */
  sortDirection?: string;
  /** 바이너리 버전 검색 키워드 */
  keyword?: string;
}

/** 바이너리 업로드 요청 — multipart/form-data 로 전송 */
export interface UploadBinaryParams {
  appKey: string;
  artifactId: string;
  /** 업로드 대상 바이너리 그룹 key (binary-groups 조회로 확인) */
  binaryGroupKey: number;
  /** 업로드할 파일 내용 (command 에서 statSync 가드 후 읽은 Buffer) */
  fileBuffer: Buffer;
  /** form 의 파일 파트 파일명 (basename) */
  fileName: string;
  /** applicationType 텍스트 파트 (예: server) */
  applicationType: string;
  /** 설명 (선택) */
  description?: string;
}

/** 바이너리 업로드 응답 — body.{downloadUrl, binaryKey} */
export interface UploadBinaryResult {
  downloadUrl: string;
  binaryKey: number;
}

export interface DeployRunParams {
  appKey: string;
  artifactId: string;
  serverGroupId: string;
  scenarioIds: string;
  /** 대상 호스트 CSV. 비어있으면 서버그룹 전체 배포 */
  targetHosts?: string;
  /** 병렬 배포 수 (기본 1) */
  concurrentNum?: number;
  /** 시나리오 실패 시에도 다음 진행 여부 (기본 false) */
  nextWhenFail?: boolean;
  /** 배포 메모 */
  deployNote?: string;
  /** true = 즉시 반환, false = 완료 대기 (기본 false) */
  async?: boolean;
}

/** 배포 이력 — `GET .../deploy-histories` 의 deployHistories[] 항목 */
export interface DeployHistory {
  deployKey: number;
  /** 실행 결과. 문서는 SUCCESS/FAIL/RUNNING 이지만 실제 응답은 소문자다 */
  totalResult: string;
  scenarioName?: string;
  serverGroupName?: string;
  serverGroupId?: number;
  binaryVersion?: string;
  executeDate?: string;
  executeUser?: string;
}

/** 배포 이력 조회 쿼리 파라미터. 생략한 값은 API 기본값을 쓴다 */
export interface DeployHistoryParams {
  serverGroupId?: number;
  /** yyyy-MM-dd */
  from?: string;
  /** yyyy-MM-dd */
  to?: string;
  pageNum?: number;
  pageSize?: number;
}

/** 배포 이력 한 페이지 */
export interface DeployHistoryPage {
  totalCount: number;
  deployHistories: DeployHistory[];
}
