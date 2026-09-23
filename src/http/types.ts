import type { OssSecrets } from "../infrastructure/oss";
export interface AccessIdentity {
  email: string | null;
  subject: string | null;
}

export type AppEnv = {
  Bindings: Env & OssSecrets;
  Variables: {
    accessIdentity: AccessIdentity;
  };
};
