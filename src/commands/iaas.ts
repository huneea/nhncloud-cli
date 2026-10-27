import { getIaasToken, type IaasTokenEndpoints } from "../api/keystone.js";
import { getIaasCredential, getProfileEnvironment, resolveProfileName } from "../config/credentials.js";
import type { CloudEnvironment } from "../config/types.js";

export interface IaasResolverOpts {
  profile?: string;
  region?: string;
}

export type IaasTokenContext = {
  profileName: string;
  region: string;
  environment: CloudEnvironment;
} & IaasTokenEndpoints;

export async function resolveIaasTokenContext(
  opts: IaasResolverOpts,
): Promise<IaasTokenContext> {
  const profileName = await resolveProfileName(opts.profile);
  const iaas = await getIaasCredential(profileName);
  const effectiveIaas = opts.region ? { ...iaas, region: opts.region } : iaas;
  const environment = await getProfileEnvironment(profileName);

  const tokenContext = await getIaasToken(profileName, effectiveIaas, false, environment);
  return { profileName, region: effectiveIaas.region, environment, ...tokenContext };
}
