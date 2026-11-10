import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function PlacementField({
  label,
  htmlFor,
  align = "start",
  children,
}: {
  label: string;
  htmlFor?: string;
  align?: "start" | "center";
  children: ReactNode;
}) {
  const labelClass = cn("text-sm font-medium leading-5", align === "start" && "pt-2");
  return (
    <section aria-label={htmlFor ? undefined : label} className={cn(
      "grid min-h-9 grid-cols-[5rem_minmax(0,1fr)] gap-4 sm:grid-cols-[7rem_minmax(0,1fr)]",
      align === "center" ? "items-center" : "items-start",
    )}>
      {htmlFor ? (
        <Label htmlFor={htmlFor} className={cn("block", labelClass)}>{label}</Label>
      ) : (
        <h2 className={labelClass}>{label}</h2>
      )}
      <div className="min-w-0">{children}</div>
    </section>
  );
}
