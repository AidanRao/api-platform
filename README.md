# Public API

基于 Cloudflare Workers、Hono、Zod、React 和 Workers KV 的多业务域 API。一个 Worker 承载多个彼此隔离的业务域及其小型管理界面；公开接口无需鉴权，`/api/admin/*` 与 `/admin/*` 由统一的 Cloudflare Access 中间件保护。

管理页位于：

```text
/admin/buaa-classhopper/
```

页面先在本地暂存新增与删除，只有点击“保存更改”时才调用现有 PATCH 接口。遇到 `409` 会保留草稿、重新读取最新白名单并重算有效差异，不会自动重复提交。

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
├── entry.ts
├── app.ts
├── http/
│   ├── access-auth.ts
│   ├── admin-assets.ts
│   ├── response.ts
│   └── types.ts
└── domains/
    └── buaa-classhopper/
        ├── routes.ts
        ├── access-policy.schema.ts
        ├── access-policy.repository.ts
        └── access-policy.service.ts
web/
├── admin/buaa-classhopper/index.html
└── src/
    ├── App.tsx
    ├── WhitelistSection.tsx
    ├── api.ts
    ├── draft.ts
    └── styles.css
```

- `entry.ts` 仅导出 Worker，`app.ts` 负责全局中间件、错误处理和领域挂载。
- 领域目录拥有自己的路由、Zod schema 和存储实现，不跨领域引用内部模块。
- Service 只承载白名单合并、乐观锁和 revision 生成；Repository 只负责 KV 读写及存储数据校验。
- 所有小型配置共用 `API_PLATFORM_KV`，通过 `<domain>:<resource>:v<schema>` key 隔离。当前 key 是 `buaa-classhopper:iclass:access-policy:v1`。
- Vite 将管理 HTML 输出到 `web/dist/client/admin/buaa-classhopper/index.html`，哈希资源输出到 `web/dist/client/admin/assets/`。Worker 在验证 Access JWT 后通过 `ASSETS` binding 返回它们；未知管理路径不会回退到 HTML。
- `AccessVerifier` 在进程内复用 `jose` 的 Remote JWK Set 缓存，只缓存证书获取状态，不保存请求身份。

## 新增业务域

1. 在 `src/domains/<domain>/` 中添加路由、schema 和 repository。
2. 分别选择 `/api/<domain>` 和 `/api/admin/<domain>` 作为公开、管理路由前缀，并在 `src/app.ts` 挂载子应用。
3. KV key 使用 `<domain>:<resource>:v<schema>`；不要复用其他领域的 key。
4. 为 schema 的清洗和边界、repository 的缺失/损坏数据、公开与管理路由以及跨领域不匹配分别补测试。

## 本地开发

```bash
npm install
npm run types
npm run seed:local
npm run dev
```

`npm run dev` 使用 Cloudflare Vite 开发服务器，`npm run preview` 构建后在 Workers 运行时预览。Vite 仅在本地 `serve`/`preview` 时把 `ENVIRONMENT` 覆盖为 `development`、把 `ACCESS_BYPASS_LOCAL` 覆盖为 `true`，因此管理页可以直接联调；身份日志会标记为 `local-development-bypass`。

Access 绕过必须同时满足 `ENVIRONMENT=development` 和 `ACCESS_BYPASS_LOCAL=true`。`wrangler.jsonc` 的可部署默认值固定为 `production` 与 `false`，生产构建也会再次写入这两个安全值；即使线上误把单独的 bypass 开关设为 `true`，仍不会跳过 JWT 校验。

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
2. 在 `wrangler.jsonc` 的 `env.production` 中配置 `TEAM_DOMAIN`、`ACCESS_AUD`、Custom Domain 和 KV。
3. 创建 Cloudflare Access Self-hosted 应用，在同一个应用中添加 `你的域名/api/admin/*` 和 `你的域名/admin/*`，并只允许管理员身份访问。保留公开 GET 路径不受保护。
4. 把该 Access 应用的 Application Audience (AUD) 填入 `ACCESS_AUD`。
5. 在 Access 应用设置中关闭 **Cookie Path Attribute**，使同一个 `CF_Authorization` Cookie 能覆盖 `/admin/*` 与 `/api/admin/*`。
6. 当前 production 已将 `API_PLATFORM_KV` 固定到 namespace `ae082c6018fd43b0bb6c62dfe84219d7`（此前核对的云端名称为 `PUBLIC_API_KV`；实际绑定以 ID 为准），无需重复创建。新账号部署时需替换为自己的 namespace ID，并准备初始白名单。
7. 首次执行 `npm run seed:production`，使用 `npm run deploy:production` 发布。`seed:remote` 和 `deploy` 分别是对应 production 命令的快捷别名。

生产环境中，即使 `workers.dev` 地址没有经过 Access 边缘应用，Worker 仍会验证 `Cf-Access-Jwt-Assertion`，不会直接暴露管理页面或管理 API。HTML 响应使用 `no-store`；带哈希的 `/admin/assets/*` 使用私有长期缓存，并统一添加 CSP、`frame-ancestors 'none'`、`nosniff` 等安全头。本地开发 CSP 只额外允许 Vite 注入样式与 HMR WebSocket，生产 CSP 不包含这些放宽项。

[Workers KV 是最终一致存储](https://developers.cloudflare.com/kv/concepts/how-kv-works/)，管理员更新在其他地区最长可能短暂读到旧值。`baseRevision` 可以防止通常的陈旧编辑，但无法彻底消除极端跨区域同时写入的竞争；若未来需要严格串行写入，应将同一 key 的管理写入迁移到 Durable Object。写接口返回本次已写入的数据，不依赖一次立即回读。
