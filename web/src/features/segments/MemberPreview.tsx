import { useQueries } from "@tanstack/react-query";
import { MEMBER_FIELDS, mergeMembers, type MemberField } from "../../../../src/features/segments/schema";
import { memberFieldLabels } from "./presentation";
import { ErrorNotice, Loading } from "../../platform/feedback";
import { Button } from "@/components/ui/button";
import { segmentClient, segmentKey } from "./api";

export function MemberPreview({ segmentIds, fields = MEMBER_FIELDS }: { segmentIds: string[]; fields?: readonly MemberField[] }) {
  const queries = useQueries({ queries: segmentIds.map((id) => ({ queryKey: [...segmentKey, "detail", id], queryFn: ({ signal }: { signal: AbortSignal }) => segmentClient.get(id, signal) })) });
  const failure = queries.find((q) => q.isError);
  if (failure) return <div className="space-y-2"><ErrorNotice error={failure.error} /><Button variant="outline" type="button" onClick={() => void Promise.all(queries.filter((q) => q.isError).map((q) => q.refetch()))}>重新加载名单</Button></div>;
  if (queries.some((q) => q.isPending)) return <Loading />;
  const members = mergeMembers(queries.flatMap((q) => q.data ? [q.data] : []));
  return <section aria-label="合并名单预览" className="space-y-3"><h2 className="font-semibold">合并名单预览</h2><div className={`grid gap-3 ${fields.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3"}`}>{fields.map((f) => <details key={f} className="min-w-0 rounded-md border px-3 py-2"><summary className="cursor-pointer text-sm">{memberFieldLabels[f]}（{members[f].length}）</summary><ul className="mt-2 max-h-48 overflow-auto text-sm">{members[f].map((v) => <li key={v} className="break-all py-1">{v}</li>)}</ul></details>)}</div></section>;
}
