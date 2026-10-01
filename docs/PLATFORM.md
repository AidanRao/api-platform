# App 平台与通用能力

## 职责与依赖

平台以 App 为数据隔离范围。公告、未来广告是所有已注册 App 的并列通用能力，不由公告定义 App，也不为每个 App 复制一套业务实现。

| 层次 | 代码入口 | 责任 |
| --- | --- | --- |
| App 注册 | `src/apps/registry.ts` | 代码维护 `id`、`name`，校验唯一且合法的路径标识；仅后端维护，前端通过 API 获取 |
| 后端装配 | `src/apps/routes.ts` | 为每个 App 挂载全部通用能力，另外挂载应用专属扩展 |
| 通用业务 | `src/features/announcements/`，未来 `src/features/ads/` | 自己的 schema、表和业务规则，接收平台传入的 App 身份 |
| 共享媒体 | `src/features/media/`、`src/infrastructure/oss.ts` | 同源上传入口、图片校验和 OSS 存储，不引用公告业务 |
| 管理框架 | `web/src/App.tsx`、`web/src/platform/` | React Router 路由、App 上下文、TanStack Query、会话草稿和通用 API 客户端 |
| 应用扩展 | `src/domains/buaa-classhopper/` 与对应前端目录 | 只向 BUAA 提供 iClass 白名单 |

基础设施和 HTTP 层不导入具体业务模块。App 注册表不导入公告／广告，不包含逐个 App 的通用能力开关。通用模块不包含 `buaa-classhopper` 的名称或请求地址。数据库、OSS 配置和管理 HTML 都归平台共享。

## 注册 App

只在 `src/apps/registry.ts` 的 `APPS` 中加入：

```ts
{ id: "another-app", name: "Another App" }
```

重新构建部署后，该 App 自动获得：

- `/admin/another-app/` 独立管理入口，使用同一 HTML 和管理组件，展示该 App 名称。
- `/api/another-app/announcement` 公告读取，以及 `/api/admin/another-app/announcement` 管理接口。
- 自动出现在 `GET /api/admin/apps` 和管理端应用选择器中。

未知 App 的入口和接口返回 404。App ID 使用小写字母、数字、短横线，不允许重复和 `admin/assets/index/apps/media` 保留值。前端从 `/api/admin/apps` 获取目录，根据 URL 匹配应用并向业务组件提供 App 上下文；管理 API 的 App 由后端挂载路径绑定，不接受请求体更改。切换应用前检查未保存内容，确认放弃后清除当前应用草稿，不带入其他 App。

App 不创建 D1 表，不提供新增、修改或删除 App 的管理 API。`app_id` 由代码注册表管理并出现在各业务表中。更改或删除已有 ID 不会自动迁移、删除数据库记录或 OSS 对象；已有应用应保留稳定 ID。

所有管理入口继续由同一个 Cloudflare Access 管理员策略保护，当前不区分每个管理员能够访问哪些 App。

## 平台管理接口与前端

`GET /api/admin/apps` 需要 Cloudflare Access，返回 `Cache-Control: no-store`，顺序与代码注册表一致：

```json
{"code":1,"msg":"获取成功","data":{"items":[{"id":"buaa-classhopper","name":"BUAA ClassHopper"}]}}
```

前端只共享 `src/apps/schema.ts` 的类型与校验，不能导入 `APPS` 运行时目录。增加应用后目录接口和通用能力自动生效。

管理端采用 Vite + React + TypeScript，React Router Data Mode 处理深链接，TanStack Query 管理读缓存，React Hook Form + Zod 校验公告表单；UI 使用仓库内的 shadcn/ui 源码和 Tailwind CSS 4。组件配置在 `components.json`，业务组件位于各自 feature/domain 目录。

| 路由 | 行为 |
| --- | --- |
| `/admin/` | 平台入口，提示从侧边栏选择应用，不自动选中 |
| `/admin/:appId/` | BUAA 跳转白名单，其他应用跳转公告列表 |
| `/admin/:appId/announcements` | 公告列表，`page` 和 `status` 查询参数支持历史前进后退 |
| `/admin/:appId/announcements/new` | 新建草稿 |
| `/admin/:appId/announcements/:id` | 公告编辑 |
| `/admin/buaa-classhopper/whitelist` | 应用专属白名单 |

侧边栏切换应用时保留当前栏目类型，目标不支持该栏目时使用默认栏目；不会带上原公告 ID。Worker 只为已注册应用的合法页面返回统一 HTML，未知页面、应用或静态资源仍返回 404。

草稿按 App、资源和 ID 保存在内存中，同应用内导航保留草稿；切换应用时通过确认框放弃，关闭/刷新标签页使用浏览器原生未保存提示。草稿不写 localStorage，刷新后不恢复。列表和详情缓存的 key 均包含 App 和资源，写入只使本应用缓存失效；后台刷新不会覆盖已经打开的编辑表单，写请求不自动重试。公告发生 409 后保留编辑，明确核对并采用最新版本号；白名单保持增量差异，冲突后刷新并重新合并，等待手动保存。

生产 CSP 保持 `script-src 'self'`，不允许内联脚本。shadcn/Radix 的定位、侧边栏尺寸和弹层滚动锁需要内联样式，因此 `style-src` 允许 `'unsafe-inline'`；图片域名仍仅按 OSS Bucket 域名放行。开发环境另允许 HMR WebSocket。

## 广告的后续边界

后续广告采用 **App、AdSlot、Campaign、Creative** 架构：App 复用此处注册表；AdSlot、Campaign、Creative 属于广告模块自身，按 `app_id` 隔离，使用独立的广告业务表和管理栏目。广告模块与公告并列，二者都可调用平台媒体上传能力。

本次只完成平台重构，没有创建广告表、占位接口、空管理页面或投放逻辑。广告中的实体关联、投放策略、排期和计量在广告功能阶段实现。

## 公共数据库

D1 绑定为 `API_PLATFORM_DB`，建议数据库名为 `api-platform`。`migrations/` 是平台迁移目录，目前 `0001_announcements.sql` 只创建公告模块需要的表和索引，未来业务使用后续迁移；现有白名单仍使用 KV。

本地：

```sh
npm run db:migrate:local
npm run dev
```

首次生产接入：

```sh
npx wrangler d1 create api-platform-production
```

将返回的真实 ID 写到 `wrangler.jsonc` 的 `env.production.d1_databases[0].database_id`，再执行：

```sh
npm run types
npm run db:migrate:production
npm run deploy:production:dry
npm run deploy:production
```

当前仓库已在 `wrangler.jsonc` 中填写生产 D1 ID。新账号接入时需换成该账号的真实数据库 ID，并按顺序迁移和发布。若本地旧绑定中有需保留的数据，请先导出再导入新绑定；本地迁移命令不会自动搬运旧库。

## 平台图片上传与 OSS

```http
POST /api/admin/media/images
Content-Type: image/png

<图片原始二进制，不是 multipart>
```

成功 HTTP 201：

```json
{"code":1,"msg":"上传成功","data":{"url":"https://examplebucket.oss-cn-hangzhou.aliyuncs.com/api-platform/images/uuid.png"}}
```

- 对象 key 为 `<OSS_PREFIX>/images/<uuid>.<ext>`。上传不接收 App ID，图片是平台共享资源。旧的应用级上传路径已移除，没有兼容别名；已有 OSS 对象与正文 URL 不改写。
- 允许 JPEG、PNG、WebP、GIF，校验声明类型和文件头，按实际读取字节数限制单张 5 MiB。不包含完整图片解码器，不接受 SVG。
- Worker 使用 [OSS V4 签名](https://www.alibabacloud.com/help/en/oss/developer-reference/recommend-to-use-signature-version-4)执行 [PutObject](https://www.alibabacloud.com/help/en/oss/developer-reference/putobject)，超时 30 秒，不跟随重定向，不覆盖已存在对象。
- 浏览器只请求同源 Worker，无需 OSS 浏览器直传 CORS。返回稳定匿名可读 URL，不把临时下载签名写入公告或素材。
- 未配置返回 503，非法图片 400，文件过大 413，上游失败 502；均沿用平台响应信封。删除业务记录不自动删除共享图片，首版无图片清理。

在各环境 `vars` 中配置以下非敏感参数：

| 参数 | 示例 / 约束 |
| --- | --- |
| `OSS_BUCKET` | `examplebucket` |
| `OSS_REGION` | `cn-hangzhou` |
| `OSS_PREFIX` | 默认 `api-platform`；允许字母、数字、短横线、下划线和分层斜杠 |

图片访问 URL 直接使用 `https://<OSS_BUCKET>.oss-<OSS_REGION>.aliyuncs.com/<objectKey>`，上传地址由 Bucket 和 Region 自动生成，与图片访问使用同一个 Bucket 域名，无需单独配置 Endpoint 或公共访问域名。管理页 CSP 自动放行该 Bucket 域名；Bucket 需允许图片长期匿名读取，上传不会更改 ACL。

凭据由管理员在自己的终端配置，不提交源码、不传给前端：

```sh
npx wrangler secret put OSS_ACCESS_KEY_ID --env production
npx wrangler secret put OSS_ACCESS_KEY_SECRET --env production
```

本地使用被 Git 忽略的 `.dev.vars` 配置同名凭据，推荐独立测试 Bucket。RAM 身份只需目标图片前缀 `oss:PutObject` 权限；当前不包含 STS 自动刷新。

## 验收

```sh
npm run types:check
npm run typecheck
npm test
npm run build
npm run deploy:production:dry
```

测试用第二个 App 验证自动挂载、数据与管理页隔离、未知应用拒绝和 BUAA 专属扩展边界。通用媒体的签名和失败场景用 mock 验证。配置 OSS 后再执行真实图片上传、匿名 URL 读取；生产数据库迁移发布后再验证完整发布／下架链路。具体公告协议见 [公告文档](./ANNOUNCEMENTS.md)。

### 本次重构验证边界

自动化覆盖 App 目录鉴权、平台图片入口、旧入口 404、深链接回退、应用隔离、URL 分页历史、内存草稿、离开确认和刷新保护、后台刷新保留编辑、公告与白名单冲突处理。真实浏览器视觉验收需要可用的浏览器连接与解锁的桌面；自动化组件测试不替代该验收。OSS 参数和生产 D1 ID 尚未配置，真实上传、匿名读取和生产发布链路需在配置完成后验证。

### 上传 502 排查

Worker 日志中的 `oss_upload_failed` 区分 `phase: request`（网络或运行时异常，记录 `errorType`）和 `phase: response`（记录 OSS HTTP 状态、错误 `code` 和 `requestId`）。日志不包含凭据、签名、图片正文或 OSS 完整响应。客户端仍返回统一的上传失败提示。

上传使用 `redirect: manual` 并拒绝非成功响应，包括 3xx，不向重定向目标发送签名头。项目当前 workerd 运行时不接受 `redirect: error`，会在构造请求时立即抛出 TypeError；回归测试使用实际运行时的 Request 构造器验证此行为边界。
