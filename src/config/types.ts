export interface UserAccessKey {
  id: string;
  secret: string;
}

export type CloudEnvironment = "real" | "gov";

export interface ServiceCredential {
  appkey?: string;
  secret?: string;
}

export interface IaasCredential {
  tenantId: string;
  username: string;
  password: string;
  region: string;
}

export interface ProfileCredentials {
  environment?: "gov";
  userAccessKey?: UserAccessKey;
  [service: string]: UserAccessKey | ServiceCredential | IaasCredential | CloudEnvironment | undefined;
}

export interface Credentials {
  version: 1;
  profiles: Record<string, ProfileCredentials>;
}

export interface Config {
  version: 1;
  defaultProfile?: string;
}
