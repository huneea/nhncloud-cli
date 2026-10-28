export const PRIVATE_DNS_RECORD_TYPES = ["A", "AAAA", "CAA", "CNAME", "MX", "NAPTR", "NS", "PTR", "SOA", "SPF", "SRV", "TXT"] as const;
export type PrivateDnsRecordType = (typeof PRIVATE_DNS_RECORD_TYPES)[number];

export interface PrivateDnsZone {
  id: string;
  name: string;
  description: string | null;
  status: string;
  networks: string[];
  created_at: string;
  updated_at: string;
  rrset_count?: number;
}

export interface PrivateDnsRecord {
  content: string;
}

/** type 은 서버가 목록 밖 값을 돌려줘도 조회가 실패하지 않도록 string 으로 둔다. */
export interface PrivateDnsRecordSet {
  id: string;
  name: string;
  description: string | null;
  zone_id: string;
  ttl: number;
  type: string;
  records: PrivateDnsRecord[];
  created_at: string;
  updated_at: string;
}

export interface CreatePrivateDnsZoneParams {
  name: string;
  description?: string;
  networks: string[];
}

export interface UpdatePrivateDnsZoneParams {
  description: string;
  networks: string[];
}

export interface CreatePrivateDnsRecordSetParams {
  name: string;
  type: string;
  records: PrivateDnsRecord[];
  ttl?: number;
  description: string;
}

export interface UpdatePrivateDnsRecordSetParams {
  type: string;
  records: PrivateDnsRecord[];
  ttl: number;
  description: string;
}
