import { useId } from "react";
import { cn } from "@/lib/utils";

export type SegmentedChoiceOption<T extends string = string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export type SegmentedChoiceProps<T extends string = string> = {
  label: string;
  value: T;
  options: readonly SegmentedChoiceOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  name?: string;
  className?: string;
};

/** Controlled single-choice group for a small, fixed set of options. */
export function SegmentedChoice<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  hideLabel = false,
  name,
  className,
}: SegmentedChoiceProps<T>) {
  const generatedName = useId();
  return (
    <fieldset disabled={disabled} className={cn("min-w-0 space-y-2", className)}>
      <legend className={hideLabel ? "sr-only" : "text-sm font-medium"}>
        {label}
      </legend>
      <div className="flex w-fit max-w-full flex-wrap rounded-md bg-muted">
        {options.map((option, index) => (
          <label
            key={option.value}
            className="relative min-w-0 first:rounded-l-md last:rounded-r-md"
          >
            <input
              className="peer sr-only"
              type="radio"
              name={name ?? generatedName}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
            />
            {index > 0 &&
              value !== option.value &&
              value !== options[index - 1]?.value && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-0 top-1/2 h-4 w-px -translate-y-1/2 bg-border"
                />
              )}
            <span className="flex min-h-9 cursor-pointer items-center justify-center rounded-[inherit] border border-transparent px-4 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground peer-checked:border-primary peer-checked:bg-background peer-checked:font-medium peer-checked:text-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-disabled:cursor-not-allowed peer-disabled:opacity-50">
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
