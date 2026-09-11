import { useId, useState, type FormEvent } from "react";

import type { AccessPolicy } from "../../src/domains/buaa-classhopper/access-policy.schema";
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
    <section className="panel" aria-labelledby={`${inputId}-title`}>
      <div className="panel-heading">
        <div>
          <h2 id={`${inputId}-title`}>{title}</h2>
          <p>{policy[field].length} 个当前项目</p>
        </div>
      </div>

      <form className="add-form" onSubmit={submit}>
        <label htmlFor={inputId}>{inputLabel}</label>
        <div className="input-row">
          <input
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
          <button className="secondary" type="submit" disabled={disabled}>
            新增
          </button>
        </div>
        <p id={errorId} className="field-error" aria-live="polite">
          {error ?? "\u00a0"}
        </p>
      </form>

      <ul className="item-list" aria-label={`${title}当前项目`}>
        {policy[field].map((item) => {
          const pendingRemoval = draft.remove[field].includes(item);
          return (
            <li className={pendingRemoval ? "pending-removal" : undefined} key={item}>
              <span>{item}</span>
              {pendingRemoval ? (
                <button type="button" onClick={() => onUndo(field, item)} disabled={disabled}>
                  撤销删除
                </button>
              ) : (
                <button type="button" onClick={() => onRemove(field, item)} disabled={disabled}>
                  删除
                </button>
              )}
            </li>
          );
        })}
        {draft.add[field].map((item) => (
          <li className="pending-addition" key={`add-${item}`}>
            <span>
              {item} <small>待新增</small>
            </span>
            <button type="button" onClick={() => onRemove(field, item)} disabled={disabled}>
              撤销新增
            </button>
          </li>
        ))}
        {policy[field].length === 0 && draft.add[field].length === 0 ? (
          <li className="empty-item">暂无项目</li>
        ) : null}
      </ul>
    </section>
  );
}
