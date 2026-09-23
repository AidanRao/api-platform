import { createContext, useContext, type ReactNode } from "react";
import type { AppDefinition } from "../../../src/apps/schema";

const ApplicationContext = createContext<AppDefinition | null>(null);
export function AppProvider({ app, children }: { app: AppDefinition; children: ReactNode }) {
  return <ApplicationContext.Provider value={app}>{children}</ApplicationContext.Provider>;
}
export function useApplication(): AppDefinition {
  const app = useContext(ApplicationContext);
  if (!app) throw new Error("Application context is required");
  return app;
}
