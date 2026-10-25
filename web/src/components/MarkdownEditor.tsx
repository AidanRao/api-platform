import { useDeferredValue, useEffect, useRef, type ClipboardEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "../platform/feedback";
import { uploadImage } from "../platform/media";
import { MarkdownPreview } from "./MarkdownPreview";
import "../platform/resource-theme.css";

type Props = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  onUploadingChange: (uploading: boolean) => void;
  placeholder?: string;
  error?: string;
};

export function MarkdownEditor({ id, label, value, onChange, disabled = false, onUploadingChange, placeholder, error }: Props) {
  const toast = useToast(), textarea = useRef<HTMLTextAreaElement>(null);
  const insertionCaret = useRef<number | null>(null);
  const preview = useDeferredValue(value);
  const upload = useMutation({
    mutationFn: async ({ files, content, start, end }: { files: File[]; content: string; start: number; end: number }) => {
      const urls: string[] = [];
      for (const file of files) urls.push((await uploadImage(file)).url);
      const markdown = urls.map((url) => `![图片](<${url}>)`).join("\n");
      insertionCaret.current = start + markdown.length;
      onChange(`${content.slice(0, start)}${markdown}${content.slice(end)}`);
      toast.info("图片已插入，请保存");
    },
    onMutate: () => onUploadingChange(true),
    onError: (caught) => toast.error(caught),
    onSettled: () => onUploadingChange(false),
  });
  const busy = disabled || upload.isPending;
  useEffect(() => {
    if (!busy && insertionCaret.current !== null) {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(insertionCaret.current, insertionCaret.current);
      insertionCaret.current = null;
    }
  }, [busy]);
  function uploadFiles(files: File[]) {
    if (busy || !files.length) return;
    for (const file of files) {
      if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) { toast.error(new Error("仅支持 JPEG、PNG、WebP、GIF 图片")); return; }
      if (file.size > 5 * 1024 * 1024) { toast.error(new Error("图片不能超过 5 MiB")); return; }
    }
    const start = textarea.current?.selectionStart ?? value.length;
    upload.mutate({ files, content: value, start, end: textarea.current?.selectionEnd ?? start });
  }
  function pasteImage(event: ClipboardEvent<HTMLTextAreaElement>) {
    const images = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile()).filter((file): file is File => file !== null);
    const files = images.length ? images : Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (!files.length) return;
    event.preventDefault();
    uploadFiles(files);
  }
  function format(before: string, after = "", placeholder = "文字", atLineStart = false) {
    const start = textarea.current?.selectionStart ?? value.length, end = textarea.current?.selectionEnd ?? start;
    const selected = value.slice(start, end) || placeholder;
    const prefix = atLineStart && start > 0 && value[start - 1] !== "\n" ? `\n${before}` : before;
    const suffix = atLineStart && end < value.length && value[end] !== "\n" ? `${after}\n` : after;
    onChange(`${value.slice(0, start)}${prefix}${selected}${suffix}${value.slice(end)}`);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
    });
  }
  return <div className="resource-theme min-w-0 space-y-3">
    <Label htmlFor={id}>{label}</Label>
    <fieldset disabled={busy} className="overflow-hidden rounded-md border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted px-3 py-2">
        <div role="toolbar" aria-label="Markdown 格式" className="flex flex-wrap items-center gap-1">
          <Button type="button" variant="ghost" size="xs" onClick={() => format("## ", "", "标题", true)}>标题</Button>
          <Button type="button" variant="ghost" size="xs" onClick={() => format("**", "**")}>加粗</Button>
          <Button type="button" variant="ghost" size="xs" onClick={() => format("- ", "", "列表项", true)}>列表</Button>
          <Button type="button" variant="ghost" size="xs" onClick={() => format("[", "](https://)", "链接文字")}>链接</Button>
        </div>
        <div className="relative"><Label htmlFor={`${id}-image-upload`} className="inline-flex h-7 cursor-pointer items-center rounded-md px-2 text-xs font-medium hover:bg-accent">上传图片</Label><Input id={`${id}-image-upload`} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="absolute left-0 top-0 h-px w-px overflow-hidden opacity-0" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) uploadFiles([file]); }} /></div>
      </div>
      <div className="grid md:grid-cols-2">
        <div className="min-w-0"><div className="border-b px-4 py-2 text-xs font-medium text-muted-foreground">Markdown 源码</div><Textarea ref={textarea} id={id} value={value} onChange={(event) => onChange(event.target.value)} onPaste={pasteImage} placeholder={placeholder} className="min-h-80 resize-y rounded-none border-0 bg-transparent px-4 py-4 font-mono text-sm leading-6 shadow-none focus-visible:ring-0" aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} /></div>
        <section aria-label={`${label.replace(/（Markdown）$/, "")}预览`} className="min-w-0 border-t md:border-t-0 md:border-l"><div className="border-b px-4 py-2 text-xs font-medium text-muted-foreground">实时预览</div><div className="min-h-80 max-h-[40rem] overflow-auto px-4 py-4">{preview.trim() ? <MarkdownPreview content={preview} /> : <p className="text-sm text-muted-foreground">暂无内容</p>}</div></section>
      </div>
    </fieldset>
    {error && <p id={`${id}-error`} role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
