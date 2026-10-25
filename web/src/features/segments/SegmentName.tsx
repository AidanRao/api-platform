import { useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import "./segment-name.css";

export function SegmentName({ name, onChange, formId, disabled }: {
  name: string;
  onChange: (value: string) => void;
  formId: string;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const previousName = useRef(name);
  const edit = () => { previousName.current = name; setEditing(true); };
  const finish = () => { if (name.trim()) setEditing(false); };

  if (editing) return <Input form={formId} autoFocus aria-label="人群名称" placeholder="新建人群" maxLength={100} required disabled={disabled}
    className="h-10 max-w-2xl text-2xl font-semibold md:text-2xl" value={name} onChange={(e) => onChange(e.target.value)}
    onFocus={(e) => e.currentTarget.select()} onBlur={finish} onKeyDown={(e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(); }
      if (e.key === "Escape") { e.preventDefault(); onChange(previousName.current); setEditing(!previousName.current.trim()); }
    }} />;

  return <header className="segment-name-heading flex min-h-10 w-fit max-w-full items-center gap-2">
    <h1 className="min-w-0 text-2xl font-semibold"><button type="button" disabled={disabled} className="cursor-text break-all text-left outline-none focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring" onClick={edit}>{name || "新建人群"}</button></h1>
    <Button type="button" size="icon-sm" variant="ghost" disabled={disabled} className="segment-name-edit shrink-0" aria-label="编辑人群名称" onClick={edit}><Pencil aria-hidden="true" /></Button>
  </header>;
}
