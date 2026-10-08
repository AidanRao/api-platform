# BUAA ClassHopper 签到预约

预约是 BUAA ClassHopper 专属能力。新预约由 `iclass-checkin` Workflow 调度，Go 服务同步返回签到结果，平台保存结果并负责重试。所有时间在数据库中保存为 UTC ISO 8601 字符串；接口返回的课程时间也统一为该格式。

## Android 接口

以下接口使用 `Authorization: Bearer <SSO access_token>`。平台通过固定的 SSO JWKS 验证 RS256 签名、issuer、有效期及 `api-platform-buaa-classhopper` audience；`userId` 取 JWT `sub`，客户端不能指定。

### 创建或刷新预约

```http
POST /api/buaa-classhopper/reservations
Content-Type: application/json
```

```json
{
  "loginName": "student123",
  "studentId": "23370001",
  "studentName": "张三",
  "course": {
    "id": 12345,
    "courseId": 678,
    "courseName": "高等数学",
    "courseNum": "D211042002",
    "classroomName": "B118",
    "classBeginTime": "2026-10-05T09:00:00+08:00",
    "classEndTime": "2026-10-05T10:30:00+08:00"
  }
}
```

`studentName` 为必填姓名，首尾空白会去除，最长 128 个字符。课程 ID 接受正整数或十进制数字字符串，存储和响应时统一为字符串；`courseNum` 可以为空。课程时间必须带偏移量，结束时间晚于开始时间。只允许预约未来 30 天内、且距离上课仍超过 10 分钟的课程；30 天窗口按请求时刻至 `classBeginTime` 计算，恰好 30 天可预约。每位用户最多保留 10 条计入上限的预约记录：`QUEUED`、`IN_PROGRESS` 和 `CANCELLED` 计入，`SUCCESS` 和 `FAILED` 不计入；永久删除或进入后两种状态后可释放名额。超过数量上限返回 HTTP 409，时间超出范围返回 HTTP 400。唯一键为 `(user_id, login_name, course_schedule_id)`：第一次创建返回 HTTP 201，同一预约的重复请求返回 HTTP 200 并保留 ID，且不占用新名额；若仍在可预约时间内，会更新学号、姓名及课程快照。超过截止时间的重复请求返回原记录，不更新内容。

新预约 ID 格式为 `RSV-YYYYMMDD-XXXXXXXXXX`，例如 `RSV-20261002-K7M2Q9A8P3`。日期取创建时的上海日历日，末段为 Web Crypto 生成的 10 位大写 Base36 随机字符。通用生成器可自定义前缀；数据库仍以不透明的 `TEXT PRIMARY KEY` 保存 ID，并保留业务唯一键。ID 碰撞时最多尝试生成 3 个候选值；已有预约保持原 ID，不批量改写外部引用。

响应遵循平台 `code/msg/data` 信封。成功 `data` 包含原有预约字段，以及 `resultCode`、`resultData`。新预约状态为 `QUEUED`，表示已进入调度、等待发起签到；`nextAttemptAt` 是上课前 8 分钟加上一次生成的 −5～+5 秒随机偏移。发起签到后为 `IN_PROGRESS`，表示 Go 服务正在同步执行；失败后等待重试时恢复为 `QUEUED`。首次执行失败后按 30 秒、1 分钟、2 分钟、4 分钟等指数间隔等待，最多重试 6 次（含首次尝试共最多 7 次）；下一次尝试达到课程结束时间时提前停止。单次 HTTP 请求最多等待 60 秒，Go 服务内部执行上限为 55 秒。网络超时的结果视为未知，下次尝试先查询课表是否已签到。每分钟定时任务会补偿超过 75 秒仍处于 `IN_PROGRESS` 的尝试。

预约时间在课前 10 分钟截止线之前发生变更时，会生成新的目标时间和 Workflow 版本。

`classroomName` 为必填教室快照，允许空字符串，最多 200 个字符。

### 查询本人预约

```http
GET /api/buaa-classhopper/reservations?page=1&pageSize=10
```

只返回当前 SSO `sub` 名下的预约。默认 `page=1`、`pageSize=10`，最大页大小 100；按创建时间及 ID 倒序。成功 `data` 为 `{items,page,pageSize,total}`。

`GET /api/buaa-classhopper/reservations/{id}` 返回当前用户的一条预约，在原有预约字段外增加 `events` 数组。事件按发生顺序保存，包含提交、调度、签到尝试与结果等节点；客户端可倒序展示。他人的预约与不存在的预约均返回 404。此接口使用相同的 SSO 鉴权与 `code/msg/data` 响应格式，不缓存响应。

### 管理本人预约

| 接口 | 用途 |
| --- | --- |
| `POST /api/buaa-classhopper/reservations/{id}/cancel` | 取消已排队或失败的预约；签到中不能取消；重复取消返回当前记录 |
| `POST /api/buaa-classhopper/reservations/{id}/restore` | 恢复已取消的预约；课程结束后返回 409 |
| `DELETE /api/buaa-classhopper/reservations/{id}` | 永久删除任意状态的预约；响应 `data` 为 `{id}`，重复删除返回 404 |

用户操作他人预约返回 404。取消后的预约不能通过重复创建请求恢复，须调用恢复接口。恢复发生在原定签到时间之前时重新按默认时间排程，否则立即排程；恢复和取消会使旧 Workflow 与旧尝试结果失效。

## API Token 详情查询

```http
GET /api/token/buaa-classhopper/reservations/{id}
Authorization: Bearer <api_token>
```

Token 必须属于 `buaa-classhopper`，且包含 `reservations:read` 权限。有效 Token 可以读取本 App 任意预约的详情。无效或已撤销 Token 返回 401；权限不足返回 403；预约不存在返回 404。

Go 服务使用只读 Token 查询签到所需的 `loginName`、`course.id` 和当前 `activeAttemptId`。它向 Workflow 的调用直接返回 `{reservationId,attemptId,status,code,message,data}`；`status` 取 `SUCCESS` 或 `FAILED`，成功码为 `0`。平台仅接受当前预约版本及尝试 ID 的结果。

## Token 管理

下列接口仍使用 Cloudflare Access 管理员身份。Token 明文仅在创建或轮换响应中出现一次。Token 可以不设置过期时间，也可以提前撤销。

| 接口 | 用途 |
| --- | --- |
| `GET /api/admin/{appId}/api-tokens/permissions` | 获取该 App 的权限目录，返回 `{groups:[{code,name,permissions:[{code,name}]}]}`；未配置权限时 `groups` 为空数组 |
| `POST /api/admin/{appId}/api-tokens` | 创建；请求为 `{name,permissions,expiresAt?}`，返回 Token 明文及元数据 |
| `GET /api/admin/{appId}/api-tokens` | 列出该 App 的元数据，不返回密钥 |
| `DELETE /api/admin/{appId}/api-tokens/{id}` | 撤销；重复撤销返回当前元数据 |
| `POST /api/admin/{appId}/api-tokens/{id}/rotate` | 轮换有效 Token；只更换密钥摘要，返回新 Token 明文一次，旧 Token 立即失效 |
| `DELETE /api/admin/{appId}/api-tokens/{id}/permanent` | 永久删除已撤销 Token；有效或已过期但未撤销的 Token 须先撤销 |

`expiresAt` 若提供，必须是晚于当前时间且带时区的 ISO 8601 时间。权限编码、展示名称和分组由后端代码目录统一维护，创建请求的 `permissions` 只提交编码，后端按目录校验。当前 BUAA ClassHopper 的“签到预约”组只包含“读取签到预约详情”(`reservations:read`)。原始 Token 用安全随机数生成，D1 只保存 SHA-256 摘要。

管理页面 `/admin/{appId}/api-tokens` 只展示当前应用的 Token 元数据，使用后端目录中的权限名称，支持搜索、轮换、撤销及删除已撤销 Token；“创建 Token”进入独立的 `/admin/{appId}/api-tokens/new` 页面。创建页按组展示所有权限，填写完成后在同页预览名称、所选权限和到期时间，返回修改时保留输入，确认后才创建 Token。有效期可选永不过期、7 天、30 天、90 天、1 年或自定义；自定义时间按浏览器本地时间填写，提交时转换为 UTC。新建 Token 明文只在创建成功页显示；轮换后在弹窗显示一次，关闭后不能再次获取。轮换保留 Token ID、名称、权限、到期时间和创建信息，已撤销或已过期的 Token 不可轮换。没有已登记权限的 App 无法创建 Token。

## 管理员预约列表

`GET /api/admin/buaa-classhopper/reservations?page=1&pageSize=10&search=高等数学&status=QUEUED` 使用 Cloudflare Access 管理员身份，返回本 App 所有用户的预约。`search` 可选，最长 200 字符，对预约 ID、用户姓名、学号和课程名称进行不区分英文字母大小写的包含匹配；`studentId` 仍可用于学号精确匹配。`status` 可选，可取 `QUEUED`、`IN_PROGRESS`、`SUCCESS`、`FAILED`、`CANCELLED`。这些条件可组合。默认每页 10 条，最大 100 条；按 `created_at DESC, id DESC` 排序，响应 `data` 为筛选后的 `{items,page,pageSize,total}`。管理页面 `/admin/buaa-classhopper/reservations` 在侧边栏的「签到预约」中展示记录，搜索、状态和页码都保存在 URL 中。学号精确匹配和状态筛选索引由 `0004_reservations_and_api_tokens.sql` 创建。

管理员可对任意记录调用相同后缀的 `POST /api/admin/buaa-classhopper/reservations/{id}/cancel`、`POST .../{id}/restore` 和 `DELETE .../{id}`。`POST .../{id}/checkin` 将待处理或失败预约的原定时任务提前到现在执行，仅在课程结束前可用；请求返回更新后的预约，签到结果随后由 Workflow 保存。管理页面提供对应操作及永久删除确认。

`GET /api/admin/buaa-classhopper/reservations/{id}/events` 返回 `{items}`，供管理页面点击状态列后在右侧栏展示签到流程。节点记录提交、进入调度、每次签到尝试及其执行结果，也记录取消、恢复、立即签到和停止重试。事件作为只追加的 JSON 数组保存在预约行的 `events_json` 中；删除预约时一并删除历史。

`0004_reservations_and_api_tokens.sql` 直接创建预约所需的完整表结构，包括 `events_json`。已应用合并前 `0004`–`0007` 的本地 D1 结构相同，可继续使用；新建本地库只需运行现有迁移脚本。

## 部署

部署前先应用数据库迁移 `0004_reservations_and_api_tokens.sql`。Worker 根环境的 `SSO_ISSUER` 指向测试 SSO，production 指向 `https://sso.aidanrao.top`；Android 所用 SSO OAuth 客户端须允许 `api-platform-buaa-classhopper` audience。SSO 的 `loginName`、`studentId` 和 `studentName` 没有在此接口中向 iClass 核验归属。

本地 `ICLASS_SERVICE_BASE_URL` 在 `wrangler.jsonc` 顶层 `vars` 中指向 `http://127.0.0.1:8020`；执行 `cp .dev.vars.example .dev.vars`，把 `ICLASS_SERVICE_SECRET` 改成与本机 Go 服务相同的值，并确保 Go 进程实际监听 `:8020`。生产签到请求通过 `env.production.vpc_services` 中的 `ICLASS_PRIVATE_API` 进入 Cloudflare Tunnel，VPC Service 应指向 Go 服务器本机 `127.0.0.1:8020`，其 Service ID 已配置在 `wrangler.jsonc`。生产 `ICLASS_SERVICE_BASE_URL=http://localhost` 不负责路由，只提供 Host 和路径。生产密钥通过 `npx wrangler secret put ICLASS_SERVICE_SECRET --env production` 设置。Go 服务的 `API_PLATFORM_ACCESS_TOKEN` 只需 `reservations:read` 权限。生产构建采用 `CLOUDFLARE_ENV=production`，确保生成的 Wrangler 配置包含 VPC Service、`iclass-checkin` Workflow 绑定与每分钟修复触发器。两端应使用同步结果协议一同发布。

本地排查实例时保持 `npm run dev` 运行，并使用 `npx wrangler workflows instances describe iclass-checkin <workflowInstanceId> --local --port 5173 --json`；不带 `--local` 会查询 Cloudflare 账号中的生产 Workflow。
