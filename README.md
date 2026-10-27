# API Platform

基于 Cloudflare Workers、Hono、Zod、React、Workers KV 和 D1 的多业务域 API。一个 Worker 服务多个在代码中注册的 App，通用能力按 App 隔离，应用专属能力独立扩展；公开接口无需鉴权，`/api/admin/*` 与 `/admin/*` 由统一的 Cloudflare Access 中间件保护。

管理页位于：

```text
/admin/
```

App 统一在 `src/apps/registry.ts` 维护。所有 App 共享通用能力及管理页框架，各自通过 `/admin/<appId>/` 管理本应用的数据。公告按应用隔离；图片通过平台级 `/api/admin/media/images` 共享上传，不接收 App ID。BUAA 在版本编辑页额外提供白名单配置，默认策略通过白名单页签右上角入口内联编辑，白名单和版本资料分别保存。广告提供平台共享活动和素材、按 App 管理广告位及投放，支持横幅、轮播、卡片和开屏。

[平台架构、D1 和 OSS 接入](./docs/PLATFORM.md) · [公告 API 与业务规则](./docs/ANNOUNCEMENTS.md) · [广告管理与接入](./docs/ADS.md) · [应用版本与灰度管理](./docs/VERSIONS.md)

Segment 在平台统一维护，白名单和版本灰度只保存人群引用。名单仅存现有 KV；人群元数据和版本引用存 D1，iClass 白名单引用配置存 KV。人群没有说明字段，不提供引用来源查询。

## iClass 白名单接口

```http
GET /api/buaa-classhopper/v1/iclass/access-policy
X-App-Version: 1.5.1
```

公开读取按 `X-App-Version` 精确匹配配置的 `x.y.z` 版本规则，合法版本未命中时使用 `default.unmatched`，缺失或非法版本头使用 `default.invalidVersion`，两项均须配置。结果可为指定 Segment、返回空名单（200，`studentIds` 和 `names` 均为空数组），或不可用（426，`{code:0,msg:"当前版本暂不可用",data:null}`）。成功使用 `Cache-Control: public, max-age=60` 和 `Vary: X-App-Version`，错误使用 no-store。

```json
{"code":1,"msg":"获取成功","data":{"schemaVersion":1,"revision":"<opaque hash>","studentIds":["23370001"],"names":["张三"]}}
```

名单由命中结果引用的 Segment 分字段合并去重。revision 是不透明字符串，包含配置修订、命中的版本规则或默认分支，以及所选人群修订信息。未关联人群返回空名单，命中结果的引用不可读返回 503，不回退默认结果。

管理接口仍为 `/api/admin/buaa-classhopper/v1/iclass/access-policy`，使用 Cloudflare Access，无需版本头。GET、PUT 使用 `{revision,rules,default}` 整体读取和保存；`rules` 为 `{version,segmentIds}` 数组，版本号不可重复，Segment ID 数组必须非空，空选时移除规则。版本规则不支持 `result` 或其他结果类型。`default` 下的 `unmatched` 和 `invalidVersion` 均为必填结果，分别对应合法版本未匹配和版本号缺失或无效。仅默认结果支持 `{type:"segments",segmentIds:[...]}`、`{type:"empty"}` 或 `{type:"unavailable"}`。已观察到的过期修订返回 409，任一规则或默认结果引用的人群不存在或不可读时拒绝保存并返回 503。未上线的旧版本规则结构直接移除，不提供兼容或迁移。

配置仅存 KV key `buaa-classhopper:iclass:access-policy:v4`，不创建白名单 D1 表；不读取或迁移旧 key。尚无配置时返回 revision 为 1、空 rules，两类默认结果均为 `{type:"empty"}`。KV 不提供原子比较写入，不能保证并发编辑互斥。旧名单增删 PATCH 协议已移除。

公开响应沿用客户端原有的 `schemaVersion:1`、`revision`、`studentIds` 和 `names` 字段，将 Segment 的学号、姓名分别映射为 `studentIds` 和 `names`，不暴露 `members` 或 `sso_id`。revision 仍为不透明字符串，现有客户端按原字段读取即可。不读取旧 KV 名单。完整协议见 [Segment 文档](./docs/SEGMENTS.md)。

## 代码结构

```text
src/
├── app.ts                    # 全局鉴权、错误处理和平台装配
├── apps/                     # App 注册表与通用能力挂载
├── http/                     # 响应、鉴权、管理页、安全头
├── infrastructure/           # OSS 等共享基础设施
├── features/
│   ├── ads/                  # 共享活动、素材发布与 App 广告投放
│   ├── announcements/        # 通用公告业务
│   ├── segments/             # 平台共享人群
│   ├── versions/             # 应用版本与人群灰度
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
- 所有业务表共用 `API_PLATFORM_DB`；人群名单仅保存在 `API_PLATFORM_KV`，消费者只持有 Segment ID。
- Vite 输出统一的 `web/dist/client/admin/index.html` 和 `/admin/assets/*`。Worker 验证 App 注册与 Access 身份后返回同一管理文档；前端通过 `GET /api/admin/apps` 获取应用目录，侧边栏支持切换 App，并保护未保存的草稿。
- `AccessVerifier` 复用 Remote JWK Set 缓存；平台基础设施不依赖公告或其他业务模块。

## 新增 App 或通用能力

新增 App 只需在 `src/apps/registry.ts` 增加 `id` 和 `name`，随后构建部署即可。App 无需逐个开启公告等通用能力；应用专属扩展才在后端路由装配和前端栏目装配中单独接入。

新增通用能力时，在 `src/features/<capability>/` 与 `web/src/features/<capability>/` 实现业务，并在平台装配处挂载。广告模块使用平台共享 Campaign、Creative 与 App 隔离的 AdSlot、Placement，复用现有 App 身份和 OSS。详见 [平台架构](./docs/PLATFORM.md)。

## 本地开发

```bash
npm install
npm run types
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
7. 当前 production 的 `API_PLATFORM_KV` 已固定 namespace，无需重复创建。新账号需替换为自己的 namespace ID。
8. 应用 D1 迁移后使用 `npm run deploy:production` 发布，随后在 `/admin/segments` 手工创建人群并配置业务引用。后续推送到 `main` 会由 [GitHub Actions 部署流程](./docs/DEPLOYMENT.md#github-actions-自动部署) 自动完成检查、D1 迁移和发布。

生产环境中，即使 `workers.dev` 地址没有经过 Access 边缘应用，Worker 仍会验证 `Cf-Access-Jwt-Assertion`，不会直接暴露管理页面或管理 API。HTML 响应使用 `no-store`；带哈希的 `/admin/assets/*` 使用私有长期缓存，并统一添加 CSP、`frame-ancestors 'none'`、`nosniff` 等安全头。生产 CSP 允许 shadcn/Radix 所需的内联样式，脚本仍限定同源；只有本地开发另允许 HMR WebSocket。


## 应用版本管理

所有注册应用均支持全量／灰度版本、Markdown 更新说明和可选下载信息。新建默认灰度，仅全量可设为最新，仅灰度可关联共享 Segment。版本及引用存 D1，人群名单仅存现有 Cloudflare KV。接入接口及迁移说明见 [版本管理文档](./docs/VERSIONS.md)。

BUAA ClassHopper 发布流水线可通过 `POST /api/token/buaa-classhopper/versions` 创建灰度版本，使用拥有 `versions:create` 权限的 API Token；不接受发布类型，不修改最新版本。
