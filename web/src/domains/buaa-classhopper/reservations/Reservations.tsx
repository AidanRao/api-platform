import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, CircleCheck, CircleX, Ellipsis, Search } from "lucide-react";
import { useSearchParams } from "react-router";
import { DropdownMenu } from "radix-ui";

import { reservationStatusSchema, type Reservation, type ReservationEvent } from "../../../../../src/domains/buaa-classhopper/reservations/schema";
import { useApplication } from "../../../platform/AppContext";
import { ErrorNotice, Loading, useToast } from "../../../platform/feedback";
import { resourceKey } from "../../../platform/query";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { changeReservation, deleteReservation, listReservationEvents, listReservations } from "./api";

const statusNames = {
  QUEUED: "已排队", IN_PROGRESS: "签到中", SUCCESS: "已完成",
  FAILED: "失败", CANCELLED: "已取消",
};
const statusStyles = {
  QUEUED: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300",
  IN_PROGRESS: "border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-300",
  SUCCESS: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  FAILED: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  CANCELLED: "border-border bg-muted text-muted-foreground",
};
const formatTime = (value: string | null) => value
  ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })
  : "—";
const classDate = (value: string) => new Date(value).toLocaleDateString("zh-CN", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
});
const classClock = (value: string) => new Date(value).toLocaleTimeString("zh-CN", {
  timeZone: "Asia/Shanghai", hour: "2-digit", minute: "2-digit", hour12: false,
});
function classTime(item: Reservation) {
  const start = item.course.classBeginTime;
  const end = item.course.classEndTime;
  return classDate(start) === classDate(end)
    ? `${classDate(start)} ${classClock(start)}–${classClock(end)}`
    : `${classDate(start)} ${classClock(start)} – ${classDate(end)} ${classClock(end)}`;
}
function DetailField({ label, value }: { label: string; value: string }) {
  return <div className="space-y-1 py-4 first:pt-0 last:pb-0">
    <dt className="text-xs text-muted-foreground">{label}</dt>
    <dd className="break-all text-sm font-medium">{value || "—"}</dd>
  </div>;
}

function eventTitle(event: ReservationEvent) {
  switch (event.kind) {
    case "SUBMITTED": return "用户提交预约";
    case "CANCELLED": return "预约已取消";
    case "RESTORED": return "预约已恢复";
    case "MANUAL_TRIGGER": return "管理员立即签到";
    case "RESCHEDULED": return "预约时间已更新";
    case "SCHEDULED": return "进入签到调度";
    case "ATTEMPT_STARTED": return `第 ${event.attemptNumber ?? "?"} 次签到`;
    case "RESULT_SUCCESS": return "签到成功";
    case "RESULT_FAILED": return "签到失败";
    case "FINISHED_FAILED": return "停止重试";
  }
}

type TimelineNode = { event: ReservationEvent; result?: ReservationEvent } | { waitingFor: string };

function timelineNodes(events: ReservationEvent[], item: Reservation): TimelineNode[] {
  const nodes: TimelineNode[] = [];
  for (const event of events) {
    if (event.kind === "RESULT_SUCCESS" || event.kind === "RESULT_FAILED") {
      const attempt = [...nodes].reverse().find((node) => "event" in node &&
        node.event.kind === "ATTEMPT_STARTED" && !node.result &&
        node.event.scheduleVersion === event.scheduleVersion &&
        (!event.referenceId || node.event.referenceId === event.referenceId));
      if (attempt && "event" in attempt) {
        attempt.result = event;
        continue;
      }
    }
    nodes.push({ event });
  }
  const last = events.at(-1);
  if (item.status === "QUEUED" && item.nextAttemptAt && last?.kind === "RESULT_FAILED" &&
    last.scheduledFor === item.nextAttemptAt && Date.parse(item.nextAttemptAt) > Date.parse(last.occurredAt)) {
    nodes.push({ waitingFor: item.nextAttemptAt });
  }
  return nodes;
}

function ReservationTimeline({ item, appId }: { item: Reservation; appId: string }) {
  const events = useQuery({
    queryKey: [...resourceKey(appId, "reservations"), "events", item.id],
    queryFn: ({ signal }) => listReservationEvents(item.id, signal),
    refetchInterval: 5_000,
  });
  if (events.isPending) return <Loading />;
  if (events.isError) return <ErrorNotice error={events.error} />;
  const nodes = timelineNodes(events.data.items, item).reverse();
  const currentTone = item.status === "SUCCESS" ? "border-emerald-500 text-emerald-600 ring-emerald-500/10"
    : item.status === "FAILED" ? "border-red-400 text-red-500 ring-red-400/10"
      : item.status === "CANCELLED" ? "border-muted-foreground text-muted-foreground ring-muted-foreground/10"
        : "border-primary text-primary ring-primary/10";
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground">最新进度在上方 · 北京时间</p>
      <Badge variant="outline" className={statusStyles[item.status]}>{statusNames[item.status]}</Badge>
    </div>
    {nodes.length ? <ol>
      {nodes.map((node, index) => {
        const current = index === 0;
        const event = "event" in node ? node.event : null;
        const result = "event" in node ? node.result : undefined;
        const waiting = "waitingFor" in node;
        const scheduledFor = waiting ? node.waitingFor : event?.scheduledFor;
        const nextNodeIsWait = index > 0 && "waitingFor" in nodes[index - 1]!;
        const retryAt = result?.scheduledFor ?? (event?.kind === "RESULT_FAILED" ? event.scheduledFor : null);
        const referenceId = event?.referenceId || result?.referenceId;
        const showRetry = Boolean(retryAt && !nextNodeIsWait && Date.parse(retryAt) > Date.parse(result?.occurredAt ?? event?.occurredAt ?? ""));
        const hasDetails = Boolean(result || (!waiting && scheduledFor && event?.kind !== "RESULT_FAILED") || showRetry || referenceId);
        return <li key={index} data-stage={current ? "current" : "completed"} className="relative min-h-4 pb-6 pl-7 last:pb-0 before:absolute before:top-[8px] before:bottom-[-8px] before:left-[7px] before:w-px before:bg-border last:before:hidden">
          <span aria-hidden="true" className={current
            ? `absolute top-0 left-0 z-10 grid size-4 place-items-center rounded-full border-2 bg-background ring-2 ${currentTone}`
            : "absolute top-0.5 left-0.5 z-10 size-3 rounded-full border border-muted-foreground/30 bg-background"}>
            {current && <span className="size-1 rounded-full bg-current" />}
          </span>
          <div className={current ? "-ml-1 rounded-xl border border-border/70 bg-muted/35 px-3 py-3" : "py-0.5 text-muted-foreground opacity-70"}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="text-sm font-medium">{event ? eventTitle(event) : "等待下次签到"}</span>
              {result && <span role="img" aria-label={result.kind === "RESULT_SUCCESS" ? "签到成功" : "签到失败"} title={result.kind === "RESULT_SUCCESS" ? "签到成功" : "签到失败"} className={result.kind === "RESULT_SUCCESS" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
                {result.kind === "RESULT_SUCCESS" ? <CircleCheck aria-hidden="true" className="size-4" /> : <CircleX aria-hidden="true" className="size-4" />}
              </span>}
            </div>
            {event ? <time className="mt-1 block text-xs text-muted-foreground" dateTime={event.occurredAt}>{formatTime(event.occurredAt)}</time>
              : waiting && <time className="mt-1 block text-xs text-muted-foreground" dateTime={node.waitingFor}>{formatTime(node.waitingFor)}</time>}
            {(result?.message || event?.message) && <p className="mt-2 break-words text-sm text-muted-foreground">{result?.message || event?.message}</p>}
            {event?.kind === "SUBMITTED" && <dl className="mt-3 space-y-3 rounded-lg border bg-muted/30 p-3 text-xs">
              <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2"><dt className="text-muted-foreground">用户</dt><dd className="break-words font-medium">{item.studentName || "未填写姓名"} - {item.studentId}</dd></div>
              <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2"><dt className="text-muted-foreground">课程</dt><dd><span className="block break-words font-medium">{item.course.courseName}</span><span className="mt-1 block text-muted-foreground">{classTime(item)}</span></dd></div>
            </dl>}
            {hasDetails && <details className="mt-2 text-xs text-muted-foreground"><summary className="w-fit cursor-pointer hover:text-foreground">查看详情</summary>
              <div className="mt-2 space-y-1.5 text-xs">
                {result && <p>结果时间：{formatTime(result.occurredAt)}</p>}
                {!waiting && scheduledFor && event?.kind !== "RESULT_FAILED" && <p>计划执行：{formatTime(scheduledFor)}</p>}
                {showRetry && <p>下次重试：{formatTime(retryAt!)}</p>}
                {referenceId && <p className="break-all font-mono">{event?.kind === "SCHEDULED" ? "Workflow" : "尝试 ID"}：{referenceId}</p>}
              </div>
            </details>}
          </div>
        </li>;
      })}
    </ol> : <p className="text-sm text-muted-foreground">暂无流程节点</p>}
  </div>;
}

export default function Reservations() {
  const app = useApplication();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const rawPage = Number(params.get("page") ?? 1);
  const page = Number.isInteger(rawPage) && rawPage > 0 && rawPage <= 1_000_000 ? rawPage : 1;
  const search = params.get("search")?.trim() ?? "";
  const parsedStatus = reservationStatusSchema.safeParse(params.get("status"));
  const status = parsedStatus.success ? parsedStatus.data : "";
  const [searchInput, setSearchInput] = useState(search);
  const [detail, setDetail] = useState<{ item: Reservation; section: "user" | "course" | "flow" } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Reservation | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const supported = app.id === "buaa-classhopper";
  const list = useQuery({
    queryKey: [...resourceKey(app.id, "reservations"), "list", { page, search, status }],
    queryFn: ({ signal }) => listReservations(page, search, status, signal),
    enabled: supported,
    refetchInterval: detail?.section === "flow" ? 5_000 : false,
  });
  useEffect(() => { setSearchInput(search); }, [search]);
  const filterParams = (nextPage: number, nextSearch = search, nextStatus = status) => ({
    page: String(nextPage),
    ...(nextSearch ? { search: nextSearch } : {}),
    ...(nextStatus ? { status: nextStatus } : {}),
  });
  useEffect(() => {
    if (list.data && page > 1 && list.data.items.length === 0) {
      setParams(filterParams(Math.max(1, Math.ceil(list.data.total / 10))), { replace: true });
    }
  }, [list.data, page, search, status, setParams]);
  if (!supported) return <h1 className="text-2xl font-semibold">页面或应用不存在</h1>;
  const updatePage = (next: number) => setParams(filterParams(next));
  async function act(item: Reservation, action: "cancel" | "restore" | "checkin" | "delete") {
    setPendingId(item.id);
    try {
      if (action === "delete") await deleteReservation(item.id);
      else await changeReservation(item.id, action);
      toast.success({ cancel: "预约已取消", restore: "预约已恢复", checkin: "已触发签到", delete: "预约已删除" }[action]);
      await queryClient.invalidateQueries({ queryKey: resourceKey(app.id, "reservations") });
    } catch (error) { toast.error(error); }
    finally { setPendingId(null); }
  }

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-semibold tracking-tight">签到预约</h1><p className="mt-1 text-sm text-muted-foreground">查看预约状态、用户和课程安排。</p></div>
      <Button variant="outline" disabled={list.isFetching} onClick={() => void list.refetch()}>刷新列表</Button>
    </div>
    <form role="search" className="flex flex-wrap items-center gap-2 rounded-xl border bg-card p-2 shadow-xs" onSubmit={(event) => {
      event.preventDefault();
      setParams(filterParams(1, searchInput.trim()));
    }}>
      <div className="relative min-w-64 flex-1"><Label htmlFor="reservation-search" className="sr-only">搜索预约</Label><Search aria-hidden="true" className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input id="reservation-search" type="search" className="bg-background pl-9" maxLength={200} value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="预约 ID、用户姓名、学号或课程名称" /></div>
      <Label htmlFor="reservation-status" className="sr-only">状态</Label><Select value={status || "all"} onValueChange={(value) => setParams(filterParams(1, searchInput.trim(), value === "all" ? "" : value))}>
        <SelectTrigger id="reservation-status" className="w-36 bg-background" aria-label="状态"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">全部状态</SelectItem>{Object.entries(statusNames).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
      </Select>
      <Button type="submit">搜索</Button>
      {(search || status) && <Button type="button" variant="ghost" onClick={() => setParams({ page: "1" })}>重置</Button>}
    </form>
    {list.isPending ? <Loading /> : list.isError ? <><ErrorNotice error={list.error} /><Button variant="outline" onClick={() => void list.refetch()}>重试</Button></> : <>
      <div className="overflow-hidden rounded-xl border bg-background"><Table className="min-w-[900px]"><TableHeader className="bg-muted/35"><TableRow>
        <TableHead className="pl-4">预约 ID</TableHead><TableHead>用户</TableHead><TableHead>课程</TableHead>
        <TableHead>状态</TableHead><TableHead>提交预约时间</TableHead><TableHead className="pr-4">操作</TableHead>
      </TableRow></TableHeader><TableBody>
        {list.data.items.map((item) => <TableRow key={item.id} className="hover:bg-muted/25">
          <TableCell className="w-48 py-4 pl-4 align-middle"><span className="block max-w-44 break-all font-mono text-xs leading-5 whitespace-normal text-muted-foreground" title={item.id}>{item.id}</span></TableCell>
          <TableCell className="min-w-52 py-3 align-middle"><button type="button" className="group flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" aria-label={`查看用户详情：${item.studentName || "未填写姓名"} - ${item.studentId}`} onClick={() => setDetail({ item, section: "user" })}>
            <span className="min-w-0 break-words font-medium text-foreground">{item.studentName || "未填写姓名"} - {item.studentId}</span><ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </button></TableCell>
          <TableCell className="min-w-64 py-3 align-middle"><button type="button" className="group flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" aria-label={`查看课程详情：${item.course.courseName}`} onClick={() => setDetail({ item, section: "course" })}>
            <span className="min-w-0"><span className="block break-words font-medium text-foreground">{item.course.courseName}</span><span className="mt-1 block text-xs text-muted-foreground">{classTime(item)}</span></span><ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </button></TableCell>
          <TableCell className="py-3 align-middle"><button type="button" className="group flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring" aria-label={`查看签到流程：${item.id}`} onClick={() => setDetail({ item, section: "flow" })}>
            <Badge variant="outline" className={statusStyles[item.status]}>{statusNames[item.status]}</Badge><ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </button></TableCell>
          <TableCell className="py-4 pr-4 align-middle"><div className="text-sm">{formatTime(item.createdAt)}</div></TableCell>
          <TableCell className="py-4 pr-4 align-middle"><DropdownMenu.Root>
            <DropdownMenu.Trigger asChild><Button type="button" variant="ghost" size="icon-sm" className="bg-muted/60" aria-label={`预约操作：${item.id}`} disabled={pendingId !== null}><Ellipsis aria-hidden="true" /></Button></DropdownMenu.Trigger>
            <DropdownMenu.Portal><DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-40 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg outline-none">
              {(["QUEUED", "FAILED"].includes(item.status)) &&
                <DropdownMenu.Item className="cursor-default rounded-md px-3 py-2 text-sm outline-none focus:bg-accent" onSelect={() => void act(item, "cancel")}>取消预约</DropdownMenu.Item>}
              {(["QUEUED", "FAILED"].includes(item.status)) &&
                <DropdownMenu.Item disabled={Date.now() >= Date.parse(item.course.classEndTime)} className="cursor-default rounded-md px-3 py-2 text-sm outline-none focus:bg-accent data-[disabled]:opacity-50" onSelect={() => void act(item, "checkin")}>立即签到</DropdownMenu.Item>}
              {item.status === "CANCELLED" && <DropdownMenu.Item disabled={Date.now() >= Date.parse(item.course.classEndTime)} className="cursor-default rounded-md px-3 py-2 text-sm outline-none focus:bg-accent data-[disabled]:opacity-50" onSelect={() => void act(item, "restore")}>恢复预约</DropdownMenu.Item>}
              {(["QUEUED", "FAILED", "CANCELLED"].includes(item.status)) && <DropdownMenu.Separator className="my-1 h-px bg-border" />}
              <DropdownMenu.Item className="cursor-default rounded-md px-3 py-2 text-sm text-destructive outline-none focus:bg-destructive/10 focus:text-destructive" onSelect={() => setDeleteTarget(item)}>删除</DropdownMenu.Item>
            </DropdownMenu.Content></DropdownMenu.Portal>
          </DropdownMenu.Root></TableCell>
        </TableRow>)}
        {list.data.items.length === 0 && <TableRow><TableCell colSpan={6} className="h-32 text-center text-muted-foreground">暂无预约记录</TableCell></TableRow>}
      </TableBody></Table></div>
      <div className="flex flex-wrap items-center justify-between gap-3"><span className="text-sm text-muted-foreground">共 {list.data.total} 条预约 · 第 {page} 页</span><div className="flex gap-2"><Button variant="outline" disabled={page <= 1} onClick={() => updatePage(page - 1)}>上一页</Button><Button variant="outline" disabled={page * 10 >= list.data.total} onClick={() => updatePage(page + 1)}>下一页</Button></div></div>
    </>}
    <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>永久删除预约？</AlertDialogTitle><AlertDialogDescription>预约 {deleteTarget?.id} 将从记录中移除，无法恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { if (deleteTarget) void act(deleteTarget, "delete"); }}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Sheet open={detail !== null} onOpenChange={(open) => { if (!open) setDetail(null); }}><SheetContent className="w-full overflow-y-auto sm:max-w-md">
      {detail && <><SheetHeader className="border-b px-6 py-6 pr-12"><SheetTitle>{detail.section === "user" ? "用户详情" : detail.section === "course" ? "课程详情" : "签到流程"}</SheetTitle><SheetDescription className="break-all">预约 ID · {detail.item.id}</SheetDescription></SheetHeader>
        {detail.section === "flow" ? <div className="px-6 py-6"><ReservationTimeline
          item={list.data?.items.find((item) => item.id === detail.item.id) ?? detail.item} appId={app.id} /></div> : <div className="space-y-6 px-6 py-2">
          <div><p className="text-lg font-semibold">{detail.section === "user" ? `${detail.item.studentName || "未填写姓名"} - ${detail.item.studentId}` : detail.item.course.courseName}</p><p className="mt-1 text-sm text-muted-foreground">{detail.section === "user" ? "预约用户信息" : classTime(detail.item)}</p></div>
          <dl className="divide-y">
            {detail.section === "user" ? <>
              <DetailField label="姓名" value={detail.item.studentName} />
              <DetailField label="学号" value={detail.item.studentId} />
              <DetailField label="loginName" value={detail.item.loginName} />
              <DetailField label="用户 ID" value={detail.item.userId} />
            </> : <>
              <DetailField label="课程名称" value={detail.item.course.courseName} />
              <DetailField label="课程编号" value={detail.item.course.courseNum} />
              <DetailField label="教室" value={detail.item.course.classroomName} />
              <DetailField label="排课 ID" value={detail.item.course.id} />
              <DetailField label="课程 ID" value={detail.item.course.courseId} />
              <DetailField label="开始时间（上海）" value={formatTime(detail.item.course.classBeginTime)} />
              <DetailField label="结束时间（上海）" value={formatTime(detail.item.course.classEndTime)} />
            </>}
          </dl>
        </div>}</>}
    </SheetContent></Sheet>
  </div>;
}
