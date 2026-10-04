import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useId, useState, type FormEvent } from "react";

import type { AccessPolicy } from "../../../../../src/domains/buaa-classhopper/access-policy/schema";
import type { PolicyDraft, PolicyField } from "./draft";

interface WhitelistSectionProps {
  title: string;
  field: PolicyField;
  inputLabel: string;
  placeholder: string;
  policy: AccessPolicy;
  draft: PolicyDraft;
  disabled: boolean;
  onAdd: (field: PolicyField, value: string) => string | null;
  onRemove: (field: PolicyField, value: string) => void;
  onUndo: (field: PolicyField, value: string) => void;
}

export function WhitelistSection({
  title,
  field,
  inputLabel,
  placeholder,
  policy,
  draft,
  disabled,
  onAdd,
  onRemove,
  onUndo,
}: WhitelistSectionProps) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextError = onAdd(field, value);
    setError(nextError);
    if (nextError === null) setValue("");
  }

  return (
    <Card aria-labelledby={`${inputId}-title`}>
      <CardHeader>
        <div>
          <CardTitle id={`${inputId}-title`}>{title}</CardTitle>
          <p>{policy[field].length} 个当前项目</p>
        </div>
      </CardHeader>
      <CardContent>
      <form className="space-y-2" onSubmit={submit}>
        <Label htmlFor={inputId}>{inputLabel}</Label>
        <div className="flex gap-2">
          <Input
            id={inputId}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              if (error !== null) setError(null);
            }}
            placeholder={placeholder}
            disabled={disabled}
            aria-invalid={error !== null}
            aria-describedby={error === null ? undefined : errorId}
          />
          <Button variant="outline" size="sm"  type="submit" disabled={disabled}>
            新增
          </Button>
        </div>
        <p id={errorId} className="min-h-5 text-sm text-destructive" aria-live="polite">
          {error ?? "\u00a0"}
        </p>
      </form>

      <ul className="divide-y" aria-label={`${title}当前项目`}>
        {policy[field].map((item) => {
          const pendingRemoval = draft.remove[field].includes(item);
          return (
            <li className={`flex items-center justify-between gap-3 py-3 ${pendingRemoval ? "text-muted-foreground line-through" : ""}`} key={item}>
              <span>{item}</span>
              {pendingRemoval ? (
                <Button variant="outline" size="sm" type="button" onClick={() => onUndo(field, item)} disabled={disabled}>
                  撤销删除
                </Button>
              ) : (
                <Button variant="outline" size="sm" type="button" onClick={() => onRemove(field, item)} disabled={disabled}>
                  删除
                </Button>
              )}
            </li>
          );
        })}
        {draft.add[field].map((item) => (
          <li className="flex items-center justify-between gap-3 py-3" key={`add-${item}`}>
            <span>
              {item} <small>待新增</small>
            </span>
            <Button variant="outline" size="sm" type="button" onClick={() => onRemove(field, item)} disabled={disabled}>
              撤销新增
            </Button>
          </li>
        ))}
        {policy[field].length === 0 && draft.add[field].length === 0 ? (
          <li className="py-8 text-center text-sm text-muted-foreground">暂无项目</li>
        ) : null}
      </ul>
      </CardContent>
    </Card>
  );
}
