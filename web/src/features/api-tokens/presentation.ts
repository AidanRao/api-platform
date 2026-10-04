export const formatTime = (value: string) => new Date(value).toLocaleString("zh-CN", {
  timeZone: "Asia/Shanghai", hour12: false,
});
