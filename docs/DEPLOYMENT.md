# API Platform 从零上线指南

本文说明如何把本项目第一次部署到 Cloudflare。完成后，一个 Cloudflare Worker 会同时提供：

- 公开接口：`GET /api/buaa-classhopper/v1/iclass/access-policy`
- 管理页面：`/admin/buaa-classhopper/`
- 管理接口：`PATCH /api/admin/buaa-classhopper/v1/iclass/access-policy`
- 一个绑定为 `API_PLATFORM_KV` 的生产 Workers KV namespace
- Cloudflare Access 对管理页面和管理接口的双层保护

React 静态资源和 API Worker 会在同一次部署中发布，不需要 Pages、第二个 Worker 或第二套流水线。

> 本文中的 `api-platform.example.com`、`example.com`、管理员邮箱和 Access team name 都是示例，请替换成自己的值。

## 1. 上线前准备

### 1.1 必备条件

- 一个可登录的 Cloudflare 账号。
- 一个已接入该账号、状态为 Active 的域名 zone，例如 `example.com`。
- 一个未被 CNAME 占用的子域名，例如 `api-platform.example.com`。
- Node.js 24 LTS 和项目自带的 npm。
- 可以接收 Cloudflare Access 登录邮件的管理员邮箱，或现有企业身份提供商账号。

Cloudflare Workers Custom Domain 要求域名属于当前账号中的 Active zone。Custom Domain 会由 Cloudflare 自动创建 DNS 记录和证书，但目标 hostname 不能已有冲突的 CNAME。参见 [Cloudflare Workers Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)。

如果目前只有 Cloudflare 账号、还没有域名，需要先购买或转入一个域名，并把它作为 Active zone 接入 Cloudflare；本方案不建议把 `workers.dev` 当正式入口。

### 1.2 先确定这些值

| 名称 | 示例 | 用途 |
| --- | --- | --- |
| 根域名 | `example.com` | Cloudflare zone |
| 服务 hostname | `api-platform.example.com` | API 和管理页共同入口 |
| Access team name | `my-team` | 组成 `https://my-team.cloudflareaccess.com` |
| 管理员邮箱 | `admin@example.com` | Access Allow 策略 |
| Worker 名称 | `api-platform` | `wrangler.jsonc` 中已有 |

## 2. 准备本地项目

在项目根目录执行：

```bash
cd /path/to/api-platform
npm ci
npx wrangler --version
npx wrangler login
npx wrangler whoami
```

`wrangler login` 会打开浏览器，请选择将要承载该服务的 Cloudflare 账号。项目已固定 Wrangler 版本，应使用项目内的 `npx wrangler`，不要依赖全局安装。参见 [Wrangler 安装与更新](https://developers.cloudflare.com/workers/wrangler/install-and-update/)。

先完成本地验证：

```bash
npm run types:check
npm run typecheck
npm test
npm run seed:local
npm run dev
```

浏览器打开：

```text
http://127.0.0.1:5173/admin/buaa-classhopper/
```

本地 Vite 运行时会自动设置 `ENVIRONMENT=development` 和 `ACCESS_BYPASS_LOCAL=true`，因此不需要 Access JWT。生产构建会强制恢复为 `production` 和 `false`。

## 3. 创建 Cloudflare Zero Trust 组织

如果账号中尚未启用 Zero Trust：

1. 打开 Cloudflare Dashboard，进入 **Zero Trust**。
2. 完成组织初始化并选择 team name，例如 `my-team`。
3. 记录 team domain：

   ```text
   https://my-team.cloudflareaccess.com
   ```

4. 选择 Zero Trust 套餐。若选择 Free 计划，Cloudflare 当前仍可能要求完成账单资料步骤。

team name 可在 **Zero Trust > Settings** 查看。参见 [Cloudflare Zero Trust 入门](https://developers.cloudflare.com/cloudflare-one/setup/)。

## 4. 配置管理员登录方式

如果已有 Google Workspace、Microsoft Entra ID、GitHub、Okta 等身份提供商，可在：

```text
Zero Trust > Integrations > Identity providers
```

连接现有 IdP。

只有少量管理员时，最简单的方式是添加 **One-time PIN**：

1. 进入 **Zero Trust > Integrations > Identity providers**。
2. 选择 **Add new identity provider**。
3. 选择 **One-time PIN** 并保存。

OTP 只是登录方式，不是授权范围。后续 Access Allow 策略必须限制为明确邮箱或受控邮箱域，不能只写 `Login Methods = One-time PIN`，否则任何可接收邮件的人都可能被允许登录。参见 [One-time PIN login](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/) 和 [Access policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/)。

## 5. 先创建 Cloudflare Access 应用

在让自定义域正式指向 Worker 之前，先配置 Access：

1. 进入 **Zero Trust > Access controls > Applications**。
2. 选择 **Create new application**。
3. 选择 **Self-hosted and private**。
4. 应用名称填写，例如 `API Platform Admin`。
5. 添加第一个 public hostname：
   - Hostname：`api-platform.example.com`
   - Path：`/admin/*`
6. 再选择 **Add public hostname**，添加：
   - Hostname：`api-platform.example.com`
   - Path：`/api/admin/*`
7. 不要添加整个 hostname、`/*` 或 `/api/*`，否则公开 GET 也会要求登录。
8. 创建一个 Allow 策略：
   - Action：`Allow`
   - Include selector：`Emails`
   - Value：明确的管理员邮箱，例如 `admin@example.com`
9. 选择需要的身份提供商；只有一个 IdP 时可以开启 **Apply instant authentication**。
10. 设置合适的 Session Duration，例如 8 小时。
11. 创建应用。

Access 应用默认拒绝所有未命中 Allow 策略的用户。官方流程参见 [Publish a self-hosted application](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/) 和 [Application paths](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)。

### 5.1 关闭 Cookie Path Attribute

两个受保护路径必须共享同一个 `CF_Authorization` Cookie：

1. 回到 **Zero Trust > Access controls > Applications**。
2. 找到刚创建的应用并选择 **Configure**。
3. 进入 **Advanced settings**。
4. 找到 **Cookie settings**。
5. 关闭 **Cookie Path Attribute**。
6. 保存。

如果开启该设置，登录 `/admin/*` 后访问 `/api/admin/*` 可能再次要求认证，导致管理页保存失败。参见 [Access authorization cookie](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/)。

### 5.2 记录 Access AUD

仍在 Access 应用配置中：

1. 进入 **Additional settings**。
2. 复制 **Application Audience (AUD) Tag**。

每个 Access 应用有唯一 AUD；只有删除并重建应用时才会变化。本 Worker 会同时校验 JWT 签名、issuer、audience 和有效期。Cloudflare 也建议 Worker 自身校验 `Cf-Access-Jwt-Assertion`，不能只相信请求头存在。参见 [Validate Access JWTs](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)。

## 6. 创建 production KV namespace

当前 `env.production.kv_namespaces` 已固定绑定到现有 namespace：

| 项目 | 当前值 |
| --- | --- |
| Worker 名称 | `api-platform` |
| 代码 binding | `API_PLATFORM_KV` |
| 云端 namespace 名称（此前核对） | `PUBLIC_API_KV`；实际绑定以 ID 为准 |
| namespace ID | `ae082c6018fd43b0bb6c62dfe84219d7` |
| 业务 key | `buaa-classhopper:iclass:access-policy:v1` |

生产构建通过 `CLOUDFLARE_ENV=production` 选取此绑定，部署产物为 `web/dist/api_platform/wrangler.json`。显式 ID 指向现有 KV，Worker 改名不会重命名或复制 KV；本地开发默认使用 `.wrangler/state` 中的模拟 KV。

下面的创建步骤仅供新账号或需要新 namespace 时使用，当前账号无需重复创建：

```bash
npx wrangler kv namespace create API_PLATFORM_KV --env production
```

命令会返回 namespace ID。记录类似下面的值：

```text
fedcba9876543210fedcba9876543210
```

创建命令和参数参见 [Wrangler KV commands](https://developers.cloudflare.com/workers/wrangler/commands/kv/)。

## 7. 填写分环境配置

编辑项目根目录的 `wrangler.jsonc`。

### 7.1 配置 Access、KV 和 Custom Domain

将相关部分调整为：

```jsonc
{
  "name": "api-platform",
  "vars": {
    "TEAM_DOMAIN": "https://YOUR_TEAM.cloudflareaccess.com",
    "ACCESS_AUD": "REPLACE_WITH_ACCESS_APPLICATION_AUD",
    "ENVIRONMENT": "production",
    "ACCESS_BYPASS_LOCAL": "false",
    "SSO_ISSUER": "https://sso-test.aidanrao.top"
  },
  "env": {
    "production": {
      "name": "api-platform",
      "workers_dev": false,
      "preview_urls": false,
      "vars": {
        "TEAM_DOMAIN": "https://my-team.cloudflareaccess.com",
        "ACCESS_AUD": "Access Application Audience AUD",
        "ENVIRONMENT": "production",
        "ACCESS_BYPASS_LOCAL": "false",
        "SSO_ISSUER": "https://sso.aidanrao.top"
      },
      "kv_namespaces": [
        {
          "binding": "API_PLATFORM_KV",
          "id": "production KV namespace ID"
        }
      ],
      "routes": [
        {
          "pattern": "api-platform.example.com",
          "custom_domain": true
        }
      ]
    }
  }
}
```

注意：

- `TEAM_DOMAIN` 必须带 `https://`，但不能带路径或末尾自定义内容。
- `ACCESS_AUD` 必须来自第 5 步创建的同一个 Access 应用。
- `SSO_ISSUER` 须与当前环境 SSO JWT 的 `iss` 完全一致；预约客户端还须在 SSO 侧获准 `api-platform-buaa-classhopper` audience。
- production 必须显式声明 `vars` 与 `kv_namespaces`；这些字段不会自动继承根配置。
- production 的 `ACCESS_BYPASS_LOCAL` 必须保持 `false`。
- `API_PLATFORM_KV` 是代码依赖的 binding 名称，不要修改。
- production 的 `workers_dev=false` 和 `preview_urls=false` 会关闭绕过自定义域的公开入口。
- Custom Domain 会让 Worker 成为该 hostname 的 origin，不需要 Tunnel 或额外服务器。Vite 生成的客户端目录会自动写入部署配置，输入配置不应手写 `assets.directory`。参见 [Vite Static Assets](https://developers.cloudflare.com/workers/vite-plugin/reference/static-assets/)。

如果 `api-platform.example.com` 已有 CNAME，请先确认它没有承载其他业务，再删除冲突记录；不要覆盖仍在使用的 DNS 记录。

### 7.2 重新生成绑定类型

```bash
npm run types
npm run types:check
npm run typecheck
```

检查生成的 `worker-configuration.d.ts` 中包含：

```text
API_PLATFORM_KV
ASSETS
TEAM_DOMAIN
ACCESS_AUD
ENVIRONMENT
ACCESS_BYPASS_LOCAL
```

## 8. 准备并写入初始白名单

编辑 `seed/access-policy.json`，填入真实初始数据：

```json
{
  "schemaVersion": 1,
  "revision": "2026-09-11-001",
  "studentIds": ["23370001", "ZY370002"],
  "names": ["张三", "李四"]
}
```

要求：

- `schemaVersion` 固定为 `1`。
- `revision` 使用上海日期，格式为 `YYYY-MM-DD-NNN`。
- 初始版本建议使用部署当天的 `001`。
- 学号和姓名是两个独立集合，不要求一一对应。
- 不要提交不应该进入 Git 的真实个人数据；若仓库会公开，请使用单独的、未跟踪 seed 文件并直接用 Wrangler 写入。

首次上线前写入 production KV：

```bash
npm run seed:production
```

用下面的命令确认内容：

```bash
npx wrangler kv key get \
  --binding=API_PLATFORM_KV \
  --remote \
  --env production \
  buaa-classhopper:iclass:access-policy:v1
```

> `seed:production` 是整体覆盖操作。服务上线并开始通过管理页维护后，不要把它当日常更新命令，否则会覆盖线上最新 revision 和白名单。`seed:remote` 只是它的快捷别名。

## 9. 部署前检查

```bash
npm run types:check
npm run typecheck
npm test
npm run deploy:production:dry
```

重点检查 dry-run 输出：

- production Worker 名称为 `api-platform`。
- 存在 `API_PLATFORM_KV` 和 `ASSETS` 两个 binding。
- `ENVIRONMENT` 为 `production`。
- `ACCESS_BYPASS_LOCAL` 为 `false`。
- 静态资源来自 `web/dist/client`。

Cloudflare Vite 插件会把 Worker bundle、React 静态资源和部署用 `wrangler.json` 一起生成；正式部署仍是一个 Worker 的一次上传。参见 [Cloudflare Vite React/API tutorial](https://developers.cloudflare.com/workers/vite-plugin/tutorial/)。

## 10. 第一次部署

部署 production：

```bash
npm run deploy:production
```

该命令会创建 Worker 版本、部署到 100% 流量、创建 Custom Domain DNS 记录并签发证书。部署完成后，等待 Custom Domain 和证书状态变为 Active；通常很快，但不要在控制台仍显示 Pending 时反复修改 DNS。

`npm run deploy` 是 `deploy:production` 的快捷别名。分环境脚本会通过 `CLOUDFLARE_ENV` 让 Vite 选择正确的 Wrangler 环境，再部署生成的配置；即使之前运行过本地 preview，也不会把本地 Access bypass 发布到线上。

### GitHub Actions 自动部署

仓库的 `.github/workflows/deploy.yml` 在每次推送到 `main` 时运行，也可通过 GitHub Actions 页面手动触发。当前只有 production 一个部署目标，没有按分支选择环境。工作流依次执行类型检查、测试、production 构建与 dry-run、生产 D1 迁移，最后部署同一份构建产物。若迁移命令失败，仅当重新查询确认没有待应用迁移时才继续发布。

签到调度使用 `iclass-checkin` Workflow。Go `iclass-service` 同步返回签到结果；两端需使用同一协议。生产环境使用 `ICLASS_PRIVATE_API` VPC Service 绑定访问 Go 服务器本机 API，Service ID 已配置在 `wrangler.jsonc`；部署前确认 Tunnel 与 VPC Service 可用。`ICLASS_SERVICE_BASE_URL=http://localhost` 仅用于构造请求 URL，实际路由由绑定决定。用 `npx wrangler secret put ICLASS_SERVICE_SECRET --env production` 配置密钥；Go 服务使用相同的 `ICLASS_SERVICE_SECRET`，其 `API_PLATFORM_ACCESS_TOKEN` 只需 `reservations:read`。预约记录的原始建表脚本包含签到节点的 `events_json` 字段。详见 [预约与签到](./RESERVATIONS.md)。

在 GitHub 仓库的 **Settings > Secrets and variables > Actions** 中配置以下 Repository secrets：

| Secret | 内容 |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | 承载 `api-platform` Worker 和 D1 的 Cloudflare 账号 ID |
| `CLOUDFLARE_API_TOKEN` | 该账号的 API Token，需具备部署 Worker、管理目标 Custom Domain 和 D1 写入所需权限 |

Token 至少需覆盖目标 Worker 的编辑权限、目标 zone 的 Workers Routes Write 权限，以及对生产 D1 执行迁移所需的 D1 Edit 权限；按实际资源收窄作用范围。不要把 Token 写进仓库。配置好 Secrets 后，推送到 `main` 或手动触发工作流，并检查 Actions 中迁移和部署步骤均成功。

## 11. 上线验收

### 11.1 公开接口不需要认证

在未登录 Access 的终端执行：

```bash
curl -i \
  https://api-platform.aidanrao.top/api/buaa-classhopper/v1/iclass/access-policy
```

预期：

- HTTP `200`
- `Content-Type: application/json`
- `code` 为 `1`
- `revision` 和 seed 一致
- 不发生 Access 登录跳转

如果返回 `503 白名单尚未配置`，说明当前 Worker 绑定的生产 KV 中还没有正确 key。

### 11.2 管理路径必须经过 Access

使用未登录的浏览器打开：

```text
https://api-platform.aidanrao.top/admin/buaa-classhopper/
```

预期先进入 Cloudflare Access 登录流程。登录允许的管理员邮箱后，页面应显示当前 revision 和白名单。

再验证完整写入：

1. 新增一个测试学号或姓名。
2. 点击保存。
3. 确认 revision 自动提升。
4. 刷新页面。
5. 确认数据仍存在。
6. 删除测试项并再次保存。

### 11.3 确认错误用户无法访问

使用未包含在 Allow 策略中的账号或无痕窗口登录，预期被 Access 拒绝。不要只测试管理员成功路径。

### 11.4 检查安全边界

- `/api/buaa-classhopper/v1/iclass/access-policy`：公开 `200`。
- `/admin/buaa-classhopper/`：未认证时由 Access 拦截。
- `/api/admin/buaa-classhopper/v1/iclass/access-policy`：未认证时由 Access 拦截。
- 未知 `/admin/...` 资源：认证后仍返回 `404`，不会回退管理首页。
- HTML：`Cache-Control: no-store`。
- `/admin/assets/*`：认证后可加载，响应包含安全头。

## 12. 后续发布流程

每次修改代码后：

```bash
npm ci
npm run types:check
npm run typecheck
npm test
npm run deploy:production:dry
npm run deploy:production
```

不要重复创建 KV namespace，不要修改已有 KV ID，也不要再次运行任何远程 seed 命令。

## 13. 日志、版本与回滚

### 查看实时日志

```bash
npx wrangler tail api-platform
```

管理写入日志只记录操作者身份、旧/新 revision 和增删数量，不记录具体姓名或学号。

### 查看版本

```bash
npx wrangler versions list --name api-platform
```

### 回滚 Worker 代码

```bash
npx wrangler rollback --name api-platform
```

也可以进入 **Workers & Pages > api-platform > Deployments**，在目标版本菜单中选择 **Rollback**。回滚会立即切换线上 Worker 版本，但不会回滚 KV 内容；Cloudflare Worker 版本也不保存 KV 历史。参见 [Workers rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)。

## 14. 常见问题

### Access 登录成功，但管理页或 PATCH 返回 401

依次检查：

1. `/admin/*` 和 `/api/admin/*` 是否属于同一个 Access 应用。
2. Cookie Path Attribute 是否关闭。
3. `TEAM_DOMAIN` 是否是正确的 `https://<team>.cloudflareaccess.com`。
4. `ACCESS_AUD` 是否来自当前 Access 应用，而不是另一个应用。
5. 修改 `wrangler.jsonc` 后是否重新执行了 `npm run deploy`。

### 管理页出现反复登录或重定向循环

- 确认 Cookie Path Attribute 已关闭。
- 清除该 hostname 的 `CF_Authorization` Cookie 后重新登录。
- 确认没有两个互相重叠、AUD 不同的 Access 应用同时保护这两个路径。
- 如果开启了 Binding Cookie，同时使用不兼容的域级功能，应按 Cloudflare 的 Cookie 文档排查。

### 公开接口返回 503

检查生产 KV：

```bash
npx wrangler kv key get \
  --binding=API_PLATFORM_KV \
  --remote \
  --env production \
  buaa-classhopper:iclass:access-policy:v1
```

如果 key 不存在，确认 `wrangler.jsonc` 中 KV ID 正确，再执行一次首次 seed。

### 部署后仍访问旧数据

Workers KV 是最终一致存储，跨地区读取可能短暂看到旧值。管理页 PATCH 成功后会直接采用写入响应，不会立即回读 KV；极端跨区域并发写入仍可能发生冲突。

### Custom Domain 无法创建

- 确认根域名是当前账号中的 Active zone。
- 确认 hostname 没有现存 CNAME。
- 确认 `routes.pattern` 只写 hostname，不带协议和路径。
- 在 **Workers & Pages > api-platform > Settings > Domains & Routes** 查看具体状态。

## 15. 上线完成判定

只有以下项目全部满足，才算完成上线：

- [ ] 自定义域和证书为 Active。
- [ ] 公开 GET 在无认证环境返回 `200`。
- [ ] 管理页面和 PATCH 都经过 Access。
- [ ] 非管理员账号被拒绝。
- [ ] Worker 内部 JWT issuer/audience 验证通过。
- [ ] 初始 KV 已写入，管理页可以保存并刷新持久化。
- [ ] dry-run 显示生产环境无法开启本地 bypass。
- [ ] 已知道在哪里查看日志和执行 Worker 回滚。
