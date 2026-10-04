import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : "操作失败，请稍后重试";
export function ErrorNotice({ error }: { error: unknown }) { return error ? <Alert variant="destructive" role="alert"><AlertDescription>{errorMessage(error)}</AlertDescription></Alert> : null; }
export function Loading() { return <div className="space-y-4" role="status" aria-label="正在加载"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /></div>; }

type Toast = { id: number; message: string; kind: "success" | "info" | "error" };
type ToastContextValue = { success: (message: string) => void; info: (message: string) => void; error: (error: unknown) => void };
const ToastContext = createContext<ToastContextValue | null>(null);

function ToastItem({ toast, dismiss }: { toast: Toast; dismiss: (id: number) => void }) {
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(toast.id), toast.kind === "error" ? 8000 : 5000);
    return () => window.clearTimeout(timer);
  }, [dismiss, toast.id]);
  const Icon = toast.kind === "success" ? CircleCheck : toast.kind === "error" ? CircleAlert : Info;
  return <div role={toast.kind === "error" ? "alert" : "status"} className="pointer-events-auto flex items-start gap-3 rounded-lg border bg-card px-4 py-3 text-sm text-card-foreground shadow-lg">
    <Icon aria-hidden="true" className={toast.kind === "success" ? "mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" : toast.kind === "error" ? "mt-0.5 size-4 shrink-0 text-destructive" : "mt-0.5 size-4 shrink-0 text-blue-600 dark:text-blue-400"} />
    <span className="min-w-0 flex-1">{toast.message}</span>
    <button type="button" aria-label="关闭通知" className="-mr-1 -mt-1 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" onClick={() => dismiss(toast.id)}><X aria-hidden="true" className="size-4" /></button>
  </div>;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((toast) => toast.id !== id)), []);
  const show = useCallback((message: string, kind: Toast["kind"]) => {
    const id = nextId.current++;
    setToasts((current) => [...current.slice(-2), { id, message, kind }]);
  }, []);
  const value = useMemo(() => ({ success: (message: string) => show(message, "success"), info: (message: string) => show(message, "info"), error: (error: unknown) => show(errorMessage(error), "error") }), [show]);
  return <ToastContext.Provider value={value}>
    {children}
    <div aria-label="操作通知" className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col gap-2 sm:inset-x-auto sm:right-6 sm:w-96">
      {toasts.map((toast) => <ToastItem key={toast.id} toast={toast} dismiss={dismiss} />)}
    </div>
  </ToastContext.Provider>;
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error("useToast must be used within ToastProvider");
  return value;
}
