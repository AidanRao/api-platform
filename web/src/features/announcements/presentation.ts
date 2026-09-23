export const statusNames = { draft: "草稿", published: "已发布", unpublished: "已下架" };
export const formatTime = (value: string | null) => value === null ? "尚未发布" : new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
