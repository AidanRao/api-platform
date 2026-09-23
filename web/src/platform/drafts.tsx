import { createContext, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useBlocker } from "react-router";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";

type Entry = { value: unknown; dirty: boolean; busy: boolean; appId: string };
class DraftStore {
  entries = new Map<string, Entry>();
  listeners = new Set<() => void>();
  version = 0;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.version;
  emit() { this.version++; this.listeners.forEach((listener) => listener()); }
  set<T>(key: string, appId: string, value: T, dirty: boolean, busy = false) {
    this.entries.set(key, { appId, value, dirty, busy }); this.emit();
  }
  remove(key: string) { this.entries.delete(key); this.emit(); }
  clearApp(appId: string) { for (const [key, value] of this.entries) if (value.appId === appId) this.entries.delete(key); this.emit(); }
}
const Context = createContext<DraftStore | null>(null);
export function DraftProvider({ children }: { children: ReactNode }) {
  const store = useRef(new DraftStore());
  return <Context.Provider value={store.current}>{children}</Context.Provider>;
}
function useStore() {
  const store = useContext(Context);
  if (!store) throw new Error("DraftProvider is missing");
  return store;
}
export function useDraft<T>(appId: string, resource: string, id: string, initial: () => T, isDirty: (value: T) => boolean) {
  const store = useStore();
  const key = JSON.stringify([appId, resource, id]);
  useSyncExternalStore(store.subscribe, store.snapshot);
  if (!store.entries.has(key)) store.entries.set(key, { appId, value: initial(), dirty: false, busy: false });
  const value = store.entries.get(key)!.value as T;
  return [value, (next: T | ((previous: T) => T), busy = false) => {
    if (!store.entries.has(key)) return;
    const previous = store.entries.get(key)!.value as T;
    const updated = typeof next === "function" ? (next as (value: T) => T)(previous) : next;
    store.set(key, appId, updated, isDirty(updated), busy);
  }, () => store.remove(key)] as const;
}
const pathApp = (path: string) => /^\/admin\/([^/]+)/.exec(path)?.[1];
export function DraftNavigationGuard() {
  const store = useStore();
  useSyncExternalStore(store.subscribe, store.snapshot);
  const hasChanges = [...store.entries.values()].some((entry) => entry.dirty || entry.busy);
  const busy = [...store.entries.values()].some((entry) => entry.busy);
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    hasChanges && pathApp(currentLocation.pathname) !== pathApp(nextLocation.pathname));
  useEffect(() => {
    if (!hasChanges) return;
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [hasChanges]);
  return <AlertDialog open={blocker.state === "blocked"} onOpenChange={(open) => { if (!open && blocker.state === "blocked") blocker.reset(); }}>
    <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>离开当前应用？</AlertDialogTitle>
      <AlertDialogDescription>{busy ? "正在处理请求，请等待完成。" : "当前应用有未保存的更改。离开后这些草稿将被丢弃。"}</AlertDialogDescription></AlertDialogHeader>
      <AlertDialogFooter><AlertDialogCancel>继续编辑</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={() => {
        if (blocker.state !== "blocked") return;
        for (const appId of new Set([...store.entries.values()].map((entry) => entry.appId))) store.clearApp(appId);
        blocker.proceed();
      }}>放弃更改并离开</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
