import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

/** Keep this inside the form so submit buttons retain native form behavior. */
export function EditorActions({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const { open, isMobile } = useSidebar();

  useLayoutEffect(() => {
    const bar = ref.current;
    const content = bar?.closest<HTMLElement>("[data-page-content]");
    if (!bar || !content) return;
    const measure = () => {
      content.style.setProperty("--editor-actions-height", `${bar.getBoundingClientRect().height}px`);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(bar);
    return () => {
      observer?.disconnect();
      content.style.removeProperty("--editor-actions-height");
    };
  }, []);

  return (
    <div
      ref={ref}
      role="group"
      aria-label="页面操作"
      data-slot="editor-actions"
      className="fixed bottom-0 right-0 z-40 border-t bg-background transition-[left] duration-200 ease-linear"
      style={{ left: !isMobile && open ? "var(--sidebar-width)" : 0 }}
    >
      <div className={cn("mx-auto flex w-full max-w-7xl flex-wrap items-center gap-3 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:px-8", className)}>
        {children}
      </div>
    </div>
  );
}
