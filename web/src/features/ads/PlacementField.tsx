import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

export function PlacementField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={htmlFor ? undefined : label} className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-4 sm:grid-cols-[7rem_minmax(0,1fr)]">
      {htmlFor ? (
        <Label htmlFor={htmlFor} className="block pt-2 text-sm leading-5">{label}</Label>
      ) : (
        <h2 className="pt-2 text-sm font-medium leading-5">{label}</h2>
      )}
      <div className="min-w-0">{children}</div>
    </section>
  );
}
