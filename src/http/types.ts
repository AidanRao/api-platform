import type { OssSecrets } from "../infrastructure/oss";
export interface AccessIdentity {
  email: string | null;
  subject: string | null;
}

export interface SsoIdentity {
  userId: string;
  clientId: string;
}

export interface ApiTokenIdentity {
  tokenId: string;
  appId: string;
}

export type AppEnv = {
  Bindings: Env & OssSecrets;
  Variables: {
    accessIdentity: AccessIdentity;
    ssoIdentity: SsoIdentity;
    apiTokenIdentity: ApiTokenIdentity;
  };
};
