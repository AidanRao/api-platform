export interface AccessIdentity {
  email: string | null;
  subject: string | null;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    accessIdentity: AccessIdentity;
  };
};
