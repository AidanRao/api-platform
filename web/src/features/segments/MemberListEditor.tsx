import { useId, useRef, useState } from "react";
import { Minus, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Pagination } from "../../components/Pagination";
import { MEMBER_FIELDS, type MemberField } from "../../../../src/features/segments/schema";
import { appendPendingMembers, type MemberDraft } from "./member-draft";
import { memberFieldLabels, parseMemberText } from "./presentation";

export function MemberListEditor({ draft, onChange }: { draft: MemberDraft; onChange: (value: MemberDraft) => void }) {
  return <div className="grid items-start gap-6 lg:grid-cols-3">
    {MEMBER_FIELDS.map((field) => <MemberColumn key={field} field={field} draft={draft} onChange={onChange} />)}
  </div>;
}

function MemberColumn({ field, draft, onChange }: { field: MemberField; draft: MemberDraft; onChange: (value: MemberDraft) => void }) {
  const prefix = useId(), label = memberFieldLabels[field];
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchButton = useRef<HTMLButtonElement>(null);
  const [addOpen, setAddOpen] = useState(() => draft.pending[field] !== "");
  const addButton = useRef<HTMLButtonElement>(null);
  const additionInput = useRef<HTMLTextAreaElement>(null);
  const [requestedPage, setPage] = useState(1);
  const [focusedRow, setFocusedRow] = useState<string | null>(null);
  const rows = draft.rows.filter((row) => row.field === field);
  const filtered = rows.filter((row) => row.id === focusedRow || row.value.includes(search.trim()));
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(filtered.length / 20)));
  const visible = filtered.slice((page - 1) * 20, page * 20);
  const closeSearch = () => { setSearchOpen(false); setSearch(""); setPage(1); };
  const add = () => {
    const next = appendPendingMembers(draft, field);
    onChange(next);
    setSearch(""); setPage(Math.max(1, Math.ceil(next.rows.filter((row) => row.field === field).length / 20)));
    additionInput.current?.focus();
  };

  return <section aria-labelledby={`${prefix}-title`} className="min-w-0 space-y-3">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-baseline gap-2"><h2 id={`${prefix}-title`} className="font-semibold">{label}</h2><span className="text-xs text-muted-foreground">{new Set(rows.map((row) => row.value.trim()).filter(Boolean)).size} 项</span></div>
      <div className="flex gap-1">
        <Button ref={addButton} type="button" size="icon-sm" variant="ghost" aria-label={addOpen ? `收起${label}新增` : `新增${label}`} aria-expanded={addOpen} aria-controls={`${prefix}-add`} onClick={() => setAddOpen((open) => !open)}>
          {addOpen ? <Minus aria-hidden="true" /> : <Plus aria-hidden="true" />}
        </Button>
        <Button ref={searchButton} type="button" size="icon-sm" variant="ghost" aria-label={searchOpen ? `收起${label}搜索` : `搜索${label}`} aria-expanded={searchOpen} aria-controls={`${prefix}-search`} onClick={() => { if (searchOpen) closeSearch(); else setSearchOpen(true); }}>
          {searchOpen ? <X aria-hidden="true" /> : <Search aria-hidden="true" />}
        </Button>
      </div>
    </div>
    {searchOpen && <Input id={`${prefix}-search`} autoFocus aria-label={`查询${label}`} placeholder={`搜索${label}`} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} onKeyDown={(e) => {
      if (e.key === "Enter") e.preventDefault();
      if (e.key === "Escape") { e.preventDefault(); closeSearch(); searchButton.current?.focus(); }
    }} />}
    {addOpen && <div id={`${prefix}-add`} className="flex items-start gap-2">
      <Textarea ref={additionInput} autoFocus aria-label={`待新增${label}`} className="min-h-9 max-h-40 resize-y" rows={1} placeholder="可换行或逗号批量粘贴" value={draft.pending[field]} onChange={(e) => onChange({ ...draft, pending: { ...draft.pending, [field]: e.target.value } })} onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); setAddOpen(false); addButton.current?.focus(); }
      }} />
      <Button type="button" size="sm" variant="outline" className="h-9" aria-label={`添加${label}`} disabled={!parseMemberText(draft.pending[field]).length} onClick={add}>添加</Button>
    </div>}
    <ul aria-label={`${label}名单`} className="divide-y">
      {visible.map((row, index) => <li key={row.id} className="flex items-center gap-2 py-2" onFocus={() => setFocusedRow(row.id)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setFocusedRow(null); }}>
        <Input aria-label={`编辑${label}第 ${(page - 1) * 20 + index + 1} 项`} value={row.value} onChange={(e) => onChange({ ...draft, rows: draft.rows.map((item) => item.id === row.id ? { ...item, value: e.target.value } : item) })} onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }} />
        <Button type="button" size="sm" variant="outline" className="h-9" aria-label={`删除${label} ${row.value || "空条目"}`} onClick={() => onChange({ ...draft, rows: draft.rows.filter((item) => item.id !== row.id) })}>删除</Button>
      </li>)}
      {!filtered.length && <li className="py-4 text-center text-sm text-muted-foreground">{rows.length ? "没有符合条件的名单项。" : "暂无名单项。"}</li>}
    </ul>
    {filtered.length > 20 && <Pagination page={page} total={filtered.length} onChange={setPage} />}
  </section>;
}
