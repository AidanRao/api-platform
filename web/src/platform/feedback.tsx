import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : "操作失败，请稍后重试";
export function ErrorNotice({ error }: { error: unknown }) { return error ? <Alert variant="destructive" role="alert"><AlertDescription>{errorMessage(error)}</AlertDescription></Alert> : null; }
export function Notice({ children }: { children: string | null }) { return children ? <Alert role="status"><AlertDescription>{children}</AlertDescription></Alert> : null; }
export function Loading() { return <div className="space-y-4" role="status" aria-label="正在加载"><Skeleton className="h-8 w-48" /><Skeleton className="h-40 w-full" /></div>; }
