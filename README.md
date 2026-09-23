# Public API

基于 Cloudflare Workers、Hono、Zod、React、Workers KV 和 D1 的多业务域 API。一个 Worker 服务多个在代码中注册的 App，通用能力按 App 隔离，应用专属能力独立扩展；公开接口无需鉴权，`/api/admin/*` 与 `/admin/*` 由统一的 Cloudflare Access 中间件保护。

管理页位于：

```text
/admin/
```

App 统一在 `src/apps/registry.ts` 维护。所有 App 共享通用能力及管理页框架，各自通过 `/admin/<appId>/` 管理本应用的数据。公告按应用隔离；图片通过平台级 `/api/admin/media/images` 共享上传，不接收 App ID。BUAA 额外提供白名单管理。未来广告将作为与公告并列的通用模块接入。

[平台架构、D1 和 OSS 接入](./docs/PLATFORM.md) · [公告 API 与业务规则](./docs/ANNOUNCEMENTS.md)

白名单页面先在本地暂存新增与删除，只有点击“保存更改”时才调用现有 PATCH 接口。遇到 `409` 会保留草稿、重新读取最新白名单并重算有效差异，不会自动重复提交。

## API

### BUAA ClassHopper：公开读取白名单

```http
GET /api/buaa-classhopper/v1/iclass/access-policy
```

成功响应：

```json
{
  "code": 1,
  "msg": "获取成功",
  "data": {
    "schemaVersion": 1,
    "revision": "2026-09-10-001",
    "studentIds": ["23370001", "ZY370002"],
    "names": ["张三", "李四"]
  }
}
```

### BUAA ClassHopper：管理员增量更新

```http
PATCH /api/admin/buaa-classhopper/v1/iclass/access-policy
Content-Type: application/json
```

```json
{
  "baseRevision": "2026-09-10-001",
  "add": {
    "studentIds": ["23370003"],
    "names": ["王五"]
  },
  "remove": {
    "studentIds": ["23370001"],
    "names": ["张三"]
  }
}
```

`add`、`remove` 及其数组按需提供，但一次请求至少要包含一个非空数组。增加已存在项和删除不存在项是幂等无操作；同一项不能在一次请求中同时增加和删除。所有操作均未改变白名单时返回当前策略，不写 KV，也不提升 revision。

`baseRevision` 必须等于当前 revision，否则返回 `409` 和当前 revision。实际发生变化时，Worker 按上海日期自动生成 `YYYY-MM-DD-NNN`：同日递增数字版本，跨日从 `001` 开始。

Worker 会验证 Cloudflare Access 注入的 `Cf-Access-Jwt-Assertion`，并核对签名、issuer 和 audience。请求体上限为 32 KiB；数组最多各 500 项，字符串首尾空白会被清理，重复项和未知字段会被拒绝。

## 代码结构

```text
src/
├── app.ts                    # 全局鉴权、错误处理和平台装配
├── apps/                     # App 注册表与通用能力挂载
├── http/                     # 响应、鉴权、管理页、安全头
├── infrastructure/           # OSS 等共享基础设施
├── features/
│   ├── announcements/        # 通用公告业务
│   └── media/                # 通用图片上传入口
└── domains/buaa-classhopper/ # 应用专属 iClass 白名单
web/
├── admin/index.html          # 所有已注册 App 共用的管理 HTML
└── src/
    ├── App.tsx               # React Router 路由、侧边栏与应用选择器
    ├── platform/             # App 上下文、Query 缓存、会话草稿、API 和媒体客户端
    ├── features/announcements/
    └── domains/buaa-classhopper/
```

- `src/apps/registry.ts` 只定义 App 身份；新增 App 后通用接口和管理入口自动生效，不复制公告代码或 HTML。
- `src/apps/routes.ts` 负责装配通用能力与应用扩展。模块只拥有自己的 schema、业务逻辑和表，不维护应用名单。
- 所有通用业务表共用 `API_PLATFORM_DB`；小型配置继续使用 `API_PLATFORM_KV`。白名单 key 仍是 `buaa-classhopper:iclass:access-policy:v1`。
- Vite 输出统一的 `web/dist/client/admin/index.html` 和 `/admin/assets/*`。Worker 验证 App 注册与 Access 身份后返回同一管理文档；前端通过 `GET /api/admin/apps` 获取应用目录，侧边栏支持切换 App，并保护未保存的草稿。
- `AccessVerifier` 复用 Remote JWK Set 缓存；平台基础设施不依赖公告或其他业务模块。

## 新增 App 或通用能力

新增 App 只需在 `src/apps/registry.ts` 增加 `id` 和 `name`，随后构建部署即可。App 无需逐个开启公告等通用能力；应用专属扩展才在后端路由装配和前端栏目装配中单独接入。

新增通用能力时，在 `src/features/<capability>/` 与 `web/src/features/<capability>/` 实现业务，并在平台装配处挂载。当前广告未实现，后续采用 App、AdSlot、Campaign、Creative 架构，复用现有 App 身份和 OSS。详见 [平台架构](./docs/PLATFORM.md)。

## 本地开发

```bash
npm install
npm run types
npm run seed:local
npm run db:migrate:local
npm run dev
```

`npm run dev` 使用 Cloudflare Vite 开发服务器，`npm run preview` 构建后在 Workers 运行时预览。Vite 仅在本地 `serve`/`preview` 时把 `ENVIRONMENT` 覆盖为 `development`、把 `ACCESS_BYPASS_LOCAL` 覆盖为 `true`，因此管理页可以直接联调；身份日志会标记为 `local-development-bypass`。

Access 绕过必须同时满足 `ENVIRONMENT=development` 和 `ACCESS_BYPASS_LOCAL=true`。`wrangler.jsonc` 默认环境为 `development`，但绕过开关为 `false`；production 环境固定为 `production` 与 `false`，所有构建都会禁用绕过开关；即使线上误把单独的 bypass 开关设为 `true`，仍不会跳过 JWT 校验。

运行完整检查：

```bash
npm run types:check
npm run typecheck
npm test
npm run build
npm run deploy:production:dry
```

`npm test` 会依次运行 Workers Vitest 和独立的 jsdom Web 测试。`npm run typecheck` 会分别检查 Worker 与 DOM 类型环境。

## 部署

第一次从空账号环境上线时，请按 [完整上线指南](./docs/DEPLOYMENT.md) 操作。以下仅保留日常部署摘要。

1. 登录 Cloudflare：`npx wrangler login`。
2. 平台 D1 首次上线需先按 [平台接入文档](./docs/PLATFORM.md) 创建 D1、填写生产数据库 ID 并应用迁移。
3. 在 `wrangler.jsonc` 的 `env.production` 中配置 `TEAM_DOMAIN`、`ACCESS_AUD`、Custom Domain 和 KV。
4. 创建 Cloudflare Access Self-hosted 应用，在同一个应用中添加 `你的域名/api/admin/*` 和 `你的域名/admin/*`，并只允许管理员身份访问。保留公开 GET 路径不受保护。
5. 把该 Access 应用的 Application Audience (AUD) 填入 `ACCESS_AUD`。
6. 在 Access 应用设置中关闭 **Cookie Path Attribute**，使同一个 `CF_Authorization` Cookie 能覆盖 `/admin/*` 与 `/api/admin/*`。
7. 当前 production 已将 `API_PLATFORM_KV` 固定到 namespace `ae082c6018fd43b0bb6c62dfe84219d7`（此前核对的云端名称为 `PUBLIC_API_KV`；实际绑定以 ID 为准），无需重复创建。新账号部署时需替换为自己的 namespace ID，并准备初始白名单。
8. 首次执行 `npm run seed:production`，使用 `npm run deploy:production` 发布。`seed:remote` 和 `deploy` 分别是对应 production 命令的快捷别名。

生产环境中，即使 `workers.dev` 地址没有经过 Access 边缘应用，Worker 仍会验证 `Cf-Access-Jwt-Assertion`，不会直接暴露管理页面或管理 API。HTML 响应使用 `no-store`；带哈希的 `/admin/assets/*` 使用私有长期缓存，并统一添加 CSP、`frame-ancestors 'none'`、`nosniff` 等安全头。生产 CSP 允许 shadcn/Radix 所需的内联样式，脚本仍限定同源；只有本地开发另允许 HMR WebSocket。

[Workers KV 是最终一致存储](https://developers.cloudflare.com/kv/concepts/how-kv-works/)，管理员更新在其他地区最长可能短暂读到旧值。`baseRevision` 可以防止通常的陈旧编辑，但无法彻底消除极端跨区域同时写入的竞争；若未来需要严格串行写入，应将同一 key 的管理写入迁移到 Durable Object。写接口返回本次已写入的数据，不依赖一次立即回读。
