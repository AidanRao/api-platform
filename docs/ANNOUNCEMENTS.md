# 通用公告系统

公告是所有已注册 App 的通用能力，后端位于 `src/features/announcements/`，前端位于 `web/src/features/announcements/`。App 身份由独立的 `src/apps/registry.ts` 管理，模块只接收 `appId`，不维护应用名单或基础设施。平台架构、D1 和 OSS 配置见 [平台接入文档](./PLATFORM.md)。

管理入口：`/admin/buaa-classhopper/announcements`；新建与编辑使用 `/new`、`/:id` 独立路由。编辑页左侧输入 Markdown、右侧实时预览，提供常用格式按钮。白名单与公告分别加载，白名单缺失不影响公告；页面内切换栏目保留未保存内容，离开页面时提示未保存更改。

## 公开接口

```http
GET /api/buaa-classhopper/announcement?page=1&pageSize=20
```

```json
{
  "code": 1,
  "msg": "获取成功",
  "data": {
    "items": [{
      "id": "ANCE-20260922-ABCDEFGHIJ",
      "title": "公告标题",
      "content": "# Markdown 原文\n\n![图片](https://examplebucket.oss-cn-hangzhou.aliyuncs.com/api-platform/images/example.png)",
      "publishedAt": "2026-09-22T08:00:00.000Z",
      "isPinned": false,
      "coverUrl": null,
      "tags": []
    }],
    "page": 1,
    "pageSize": 20,
    "total": 1
  }
}
```

仅返回 `published` 状态；按 `isPinned DESC, publishedAt DESC, id DESC` 排序。分页默认 1 / 20，page 最大 1,000,000，pageSize 最大 100，必须为正整数，越界返回 400。空列表和超出末页返回 `items: []`。响应使用 `Cache-Control: no-store`，下架后新请求不复用 HTTP 缓存。

新公告 ID 使用 `ANCE-YYYYMMDD-XXXXXXXXXX`：日期按 Asia/Shanghai 生成，末尾为 10 位大写 Base36 随机码；与预约 ID 使用同一个生成器。已有公告 ID 保持不变。正文原样保存、返回 Markdown，不生成 HTML。时间为 UTC ISO 8601；管理页以 Asia/Shanghai 显示。

### 公开详情

```http
GET /api/buaa-classhopper/announcement/:id
```

所有注册应用均提供 `/api/:appId/announcement/:id`，无需管理员认证。成功 HTTP 200，返回 `{ "code": 1, "msg": "获取成功", "data": { ... } }`，`data` 直接是单条公告，与公开列表的单项字段完全一致：`id`、`title`、`content`、`publishedAt`、`isPinned`、`coverUrl`、`tags`，不返回状态、版本号或管理时间字段。

仅当前应用已发布公告可访问；草稿、下架、已删除、不存在或跨应用 ID 均返回 HTTP 404，`{ "code": 0, "msg": "公告不存在", "data": null }`。详情使用 `Cache-Control: no-store`；下架后再次请求立即不可见。非 GET 方法返回 405（HEAD 按框架 GET 语义处理）。

## 管理接口

所有路径以 `/api/admin/buaa-classhopper/announcement` 为前缀，均需要 Cloudflare Access。

| 方法 | 路径 | 请求 |
| --- | --- | --- |
| GET | 空路径 | `page` / `pageSize`，可选 `status=draft\|published\|unpublished` |
| POST | 空路径 | `{ "title": "标题", "content": "正文", "isPinned": false }` |
| GET | `/:id` | 获取本应用公告详情 |
| PATCH | `/:id` | `{ "revision": 1, "title": "新标题", "content": "新正文", "isPinned": true }`，至少提供一个编辑字段 |
| POST | `/:id/publish` | `{ "revision": 1 }` |
| POST | `/:id/unpublish` | `{ "revision": 2 }` |
| DELETE | `/:id` | JSON 请求体 `{ "revision": 3 }` |

创建返回 HTTP 201；其他公告操作成功返回 HTTP 200。管理对象比公开对象多出 `status`、整数 `revision`、`createdAt`、`updatedAt`。删除返回 `data: null`。管理列表同样返回 `items/page/pageSize/total`。不返回跨应用数据。

- 创建固定为草稿，`publishedAt: null`，`revision: 1`。标题去除首尾空白后不能为空且最多 200 字符；正文默认空字符串，UTF-8 最多 256 KiB；置顶默认为 false。未知 JSON 字段被拒绝，请求体最多 2 MiB（为 JSON 转义保留空间）。
- 发布时正文不能全为空白，首次发布生成时间；编辑和重新发布保留首次时间。已发布公告编辑保存立即生效，不能保存空白正文。
- 下架仅适用于已发布公告，变为 `unpublished`。下架后可以编辑和重新发布。首版无定时发布或独立的“已发布内容修改草稿”。
- 所有修改都通过 D1 条件写入检查 revision，并递增版本；读完后发生并发修改同样不会覆盖。冲突 HTTP 409，`data: { "currentRevision": 2 }`。UI 保留本地内容并提供最新版本供核对，不自动重试覆盖。
- 不存在或其他应用的 ID 返回 404。未知应用返回 404；管理路径仍先执行统一鉴权。失败沿用 `{ "code": 0, "msg": "说明", "data": null }`，参数 400、文件过大 413、OSS 未配置 503、OSS 上传失败 502。
- 删除公告永久移除数据库记录，OSS 图片保留。未保存草稿上传的图片也会保留，首版不自动清理图片。

## 图片与平台依赖

公告使用平台公共 D1 绑定 `API_PLATFORM_DB`，表结构在 `migrations/0001_announcements.sql`。公告模块只拥有自己的表和业务规则；App 注册表不存入 D1，其他通用模块使用各自的表。

图片上传使用平台通用接口 `POST /api/admin/media/images`，不是公告子接口。管理页支持选择图片文件或直接向 Markdown 编辑框粘贴剪贴板图片，上传后在光标处插入图片 Markdown（有选区时替换选区）。多张图片按剪贴板顺序上传、全部成功后一起插入；上传失败保留原正文，可重新粘贴重试。普通文本仍正常粘贴。正文不存图片二进制。接口、OSS 配置和本地／生产数据库初始化见 [平台接入文档](./PLATFORM.md)。

预览使用 `react-markdown` 和 `remark-gfm`，禁用原始 HTML，保留默认安全 URL 转换。管理页 CSP 仅额外允许配置的 OSS Bucket 域名。

## 验证

公告测试覆盖 Markdown 原文、状态流转、首次发布时间、D1 条件更新、分页排序、跨应用隔离；前端测试覆盖发布、下架、删除、冲突处理、图片失败重试、安全预览和切换栏目保留草稿。平台测试额外验证：只新增注册 App，即自动获得公告路由及独立管理入口，媒体由平台独立提供，且不会获得 BUAA 专属白名单。

## 图片封面

公开和管理公告对象新增 `coverUrl: string | null`。封面可选，未设置或旧公告默认 `null`。创建时可传入，PATCH 省略时保留，传 `null` 移除；更新仍携带 `revision`。封面与 Markdown 正文独立，已发布公告保存新封面后立即生效。

管理页使用平台图片上传接口设置封面，支持预览、替换和移除。支持 JPEG、PNG、WebP、GIF，单张最大 5 MiB；上传校验 MIME 与文件头，保存接口仅接受当前 OSS Bucket、平台图片目录和支持的图片文件路径，不接收任意外部 URL、视频或 SVG。上传失败保留原封面和编辑内容，移除封面不删除 OSS 对象。

部署前先运行 `npm run db:migrate:production`，应用新增迁移 `0002_announcement_cover.sql`，再部署 Worker。本地先运行 `npm run db:migrate:local`。迁移只新增可空的 `cover_url` 列，不改写已有公告。

## 标签

公告支持可选的 `tags: string[]`，公开/管理列表及详情均返回该字段，默认 `[]`。创建时可省略；PATCH 省略时保留原值，提供数组时整体替换，传 `[]` 清空，仍需携带当前 `revision`。

每条公告最多 20 个标签，每个标签最多 50 字符。去除首尾空白，不允许空标签、非字符串或 `null`；去重后保留首次出现顺序。标签大小写敏感，逗号属于标签文本，不作为分隔符。

公开和管理列表都支持单标签精确筛选：

```http
GET /api/buaa-classhopper/announcement?tag=更新&page=1&pageSize=20
GET /api/admin/buaa-classhopper/announcement?tag=更新&status=draft
```

客户端需对标签做 URL 编码；不传 `tag` 则不限制标签，传空白标签返回 400。筛选作用于分页前，`total` 为筛选后的总数；排序规则、公开接口仅返回已发布公告以及应用隔离保持不变。

管理页支持逐项添加/移除标签、列表展示和标签筛选；筛选条件写入 URL，翻页和历史导航保留条件。标签使用 D1 JSON 数组列存储，通过参数绑定的 `json_each` 做精确成员查询，不使用模糊匹配。

部署前执行 `npm run db:migrate:production` 应用 `0003_announcement_tags.sql`，再部署 Worker；本地执行 `npm run db:migrate:local`。已有公告自动得到空标签数组。

### 标签目录与点击筛选

```http
GET /api/buaa-classhopper/announcement/tags
GET /api/admin/buaa-classhopper/announcement/tags
GET /api/admin/buaa-classhopper/announcement/tags?status=published
```

所有注册应用都提供上述 `:appId` 路由。公开目录无需认证，仅统计当前应用已发布公告；管理目录需要 Cloudflare Access，默认统计全部状态，可按 `draft`、`published`、`unpublished` 筛选。成功返回 HTTP 200：

```json
{"code":1,"msg":"获取成功","data":{"items":[{"tag":"更新","count":8},{"tag":"活动","count":3}]}}
```

`count` 是包含该标签的公告数量。目录去重，按数量倒序，再按标签的 SQLite BINARY 顺序升序；无标签返回 `items: []`。目录不分页，也不跟随单个 `tag` 筛选，避免选择后其他标签消失。公开接口传入 `status` 也不能查看未发布标签。管理接口非法状态返回 400，未知应用返回 404，非 GET 方法返回 405（HEAD 按框架 GET 语义处理）。

客户端先获取标签目录，再点击标签请求公告列表，例如 `announcement?tag=更新&page=1`；点击“全部”移除 `tag`。标签须 URL 编码。目录使用 `Cache-Control: no-store`，直接聚合公告数据，编辑标签、发布、下架或删除后再次查询立即反映变化；没有独立标签 CRUD 或额外迁移。

管理页展示“全部”及带数量的标签按钮，选择标签重置至第一页，并保留发布状态；切换状态重新获取对应目录。编辑器提供已有标签输入建议，仍允许新建任意合法字符串标签。公告修改后使当前应用的列表和标签目录缓存失效；目录加载失败不影响公告列表，支持独立重试。
