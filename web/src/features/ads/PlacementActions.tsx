import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Ellipsis } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { z } from "zod";
import {
  placementSchema,
  type Placement,
} from "../../../../src/features/ads/schema";
import { jsonRequest, platformClient } from "../../platform/api";
import { useToast } from "../../platform/feedback";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { adBase } from "./shared";

export function PlacementActions({
  placement,
  disabled,
}: {
  placement: Placement;
  disabled: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const client = useQueryClient();
  const toast = useToast();
  const mutation = useMutation({
    mutationFn: async (action: "toggle" | "delete") => {
      const url = `${adBase(placement.appId, "placements")}/${encodeURIComponent(placement.id)}`;
      if (action === "delete") {
        await platformClient(url, z.null(), jsonRequest("DELETE", {
          revision: placement.revision,
        }));
        return "投放已删除";
      }
      const updated = await platformClient(url, placementSchema, jsonRequest("PATCH", {
        revision: placement.revision,
        enabled: !placement.enabled,
      }));
      return updated.enabled ? "投放已启用" : "投放已停用";
    },
    onSuccess: (message) => toast.success(message),
    onError: (error) => toast.error(error),
    // Refresh revisions after a conflict as well; retrying requires another user action.
    onSettled: () => client.invalidateQueries({ queryKey: ["ads"] }),
  });
  const busy = disabled || mutation.isPending;
  const itemClass = "cursor-default rounded-md px-3 py-2 text-sm outline-none data-[disabled]:text-muted-foreground";

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="bg-muted/60"
            aria-label={`投放操作：${placement.id}`}
            disabled={busy}
          >
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-50 min-w-40 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg outline-none"
          >
            <DropdownMenu.Item
              disabled={busy}
              className={`${itemClass} focus:bg-accent`}
              onSelect={() => mutation.mutate("toggle")}
            >
              {placement.enabled ? "停用" : "启用"}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              disabled={busy}
              className={`${itemClass} ${busy ? "text-muted-foreground" : "text-destructive focus:bg-destructive/10 focus:text-destructive"}`}
              onSelect={() => setConfirmDelete(true)}
            >
              删除
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>永久删除投放？</AlertDialogTitle>
            <AlertDialogDescription>
              投放 {placement.id} 将从广告位 {placement.slotKey} 移除，无法恢复。关联活动和素材会保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant={busy ? "outline" : "destructive"}
              disabled={busy}
              onClick={() => mutation.mutate("delete")}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
