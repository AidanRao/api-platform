import { Button } from "@/components/ui/button";

export function Pagination({ page, total, onChange, pageSize = 20 }: { page: number; total: number; onChange: (page: number) => void; pageSize?: number }) {
  return <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">共 {total} 条，第 {page} 页</span><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={page <= 1} onClick={() => onChange(page - 1)}>上一页</Button><Button type="button" size="sm" variant="outline" disabled={page * pageSize >= total} onClick={() => onChange(page + 1)}>下一页</Button></div></div>;
}
