# 通用广告系统

广告是平台通用能力。活动和素材全平台共享，广告位按 App 隔离，一条投放将活动、广告位与一份素材关联。所有注册 App 自动获得广告管理与公开读取接口。支持横幅、轮播、图文卡片、开屏，以及从 events 按需查询单投放统计；不包含第三方广告、预算、用户定向或服务端频控。广告事件继续由客户端通过已有 events SDK 上报。

## 管理流程

1. 在平台侧边栏“共享素材”创建图片或图文卡片，上传图片、填写文案，保存素材即可发布。
2. 在“广告活动”创建活动，设置时间窗口并启用。
3. 选择 App，在“广告位管理”创建客户端已接入的广告位，广告位始终可用，无需启用。
4. 在“广告投放”选择活动、广告位和素材，设置点击 URL、优先级与时间窗口，启用投放。活动详情也可进入指定 App 新建投放。

投放列表以当前发布素材的封面和广告位名称为主信息，下方显示素材名称；列表不显示投放 ID 或广告位标识。活动与投放状态分为未启用、未开始、进行中、已结束；投放按活动与自身的启用状态、时间窗口交集判断。悬浮或键盘聚焦“进行中”可查看实际生效的起止时间（上海时间），未设边界显示“不限”。

素材的图片、标题、描述、按钮文案是共享内容；点击地址属于投放。同一素材在不同 App 可以使用不同 URL。管理页的素材预览不代表各客户端最终布局。

管理入口：

- `/admin/ads/campaigns`、`/admin/ads/creatives`：平台共享列表，支持 `/new` 和 `/:id` 编辑页。
- `/admin/:appId/ads/slots`：广告位列表，支持 `/new` 和 `/:slotKey`。
- `/admin/:appId/ads/placements`：投放列表，支持 `/new` 和 `/:id`。新建可带 `?campaignId=...`。

表单草稿按平台/App、资源、ID 隔离；从不同活动进入的新建投放也分别保留草稿。同作用域导航保留输入，跨作用域离开时确认放弃；刷新提示未保存。浏览器表单草稿不写 localStorage。素材保存时即发布，不再提供独立发布操作。409 保留输入，管理员可查看最新内容后显式采用新版本号，或放弃本地编辑。

## 素材版本

`revision` 是记录的乐观并发控制版本；`publishedVersion` 是素材发布内容版本。创建素材即发布 v1，后续保存使用 D1 条件写入和原子 batch，同时保存内容、不可变快照并切换当前版本；所有引用素材的投放在后续请求统一读取新内容。内容不变的保存不增加发布版本，但仍检查并递增 revision。旧数据中尚未发布的素材，下一次保存时发布；已有未发布更改也在下一次保存时生效，不会在迁移时自动发布。

历史列表和详情只读。首版没有回滚、固定旧版本、素材独立下架；广告位和素材均无启用字段，停止展示使用活动或投放的启停。图片素材保存必须有图片，卡片还必须有标题。名称和类型是素材管理属性，类型创建后不可更改；快照保存完整展示内容和发布时间。

素材内容结构：

```json
{
  "imageUrl": "https://your-bucket.oss-cn-beijing.aliyuncs.com/api-platform/images/00000000-0000-4000-8000-000000000001.png",
  "title": "活动标题",
  "description": "活动简介",
  "buttonText": "了解更多"
}
```

只接受平台图片上传接口返回的地址。图片共享使用现有 `POST /api/admin/media/images`，不新增媒体存储配置。

## 广告位与投放规则

- 广告位 `(appId, slotKey)` 唯一，slotKey 使用小写字母、数字，可用单个短横线或下划线分隔，例如 `home-banner`、`announcement_top_banner`，最长 100 字符，`new` 为管理页面保留标识。App、标识和展示形式不可修改。
- `format` 为 `banner`、`carousel`、`card`、`splash`。图片展示形式 banner/carousel/splash 使用 `image` 类型素材，card 使用 `card` 素材。
- 非轮播 `maxItems=1`；轮播默认 5，可配置 1–10。轮播由同一广告位上的多条投放组成。
- 优先级范围 -1000000 到 1000000，越大越优先；相同优先级按创建时间、ID 升序。
- 活动、投放默认停用。广告位和素材没有启停状态；素材保存即发布，素材类型必须匹配广告位。
- 只有活动和投放同时启用、素材已发布、当前时间落在活动与投放窗口交集内，才会返回广告。没有用户级选择或随机分配。
- 时间以 UTC ISO 8601 返回，接受带时区的输入并标准化为 UTC。管理界面显示和输入上海时间。时间窗口开始包含、结束不包含，空边界表示不限；待开始/生效/过期根据当前时间判断，无需定时任务。
- 活动、广告位、投放和素材的修改均在保存后生效。
- 活动或广告位存在关联投放时不能删除。素材在未引用时允许删除，并原子删除版本历史；被引用或 revision 过期时保留素材及历史。删除记录不删除 OSS 图片。

## 公开获取

```http
GET /api/:appId/ads/slots/:slotKey
```

无需登录。已知广告位成功返回 HTTP 200，即使没有可投内容；未知 App 或广告位返回 404。所有响应 `Cache-Control: no-store`。

```json
{
  "code": 1,
  "msg": "获取成功",
  "data": {
    "appId": "buaa-classhopper",
    "slotKey": "home-banner",
    "format": "banner",
    "items": [{
      "campaignId": "ADCA-20261022-ABCDEFGHIJ",
      "placementId": "ADPL-20261022-ABCDEFGHIJ",
      "creativeId": "ADCR-20261022-ABCDEFGHIJ",
      "publishedVersion": 1,
      "content": {
        "imageUrl": "https://your-bucket.oss-cn-beijing.aliyuncs.com/api-platform/images/00000000-0000-4000-8000-000000000001.png",
        "title": "活动标题",
        "description": "活动简介",
        "buttonText": "了解更多"
      },
      "targetUrl": "buaa-classhopper://annoucement/ANNC-1"
    }]
  }
}
```

四种形式使用相同响应结构：

| slotKey 示例 | format | items | 客户端职责 |
| --- | --- | --- | --- |
| home-banner | banner | 0–1 条图片 | 横幅布局、裁剪 |
| home-carousel | carousel | 0–maxItems 条图片 | 按返回顺序轮播，控制间隔、手势和动画 |
| feed-card | card | 0–1 条图文 | 图片、标题、描述和按钮布局 |
| launch-splash | splash | 0–1 条图片 | 启动时机、等待超时、跳过、正常进入应用 |

客户端遇到空 items 隐藏广告区域，网络或图片失败不得阻塞页面/启动。服务端定义广告位不会自动增加客户端 UI，接入方应维护稳定的 slotKey。旧的已加载内容不会被服务端主动撤回；客户端应在展示时刷新并按产品需要控制本地缓存。

### 点击 URL

`targetUrl` 为字符串或 null。支持例如：

```text
https://example.com/activity?id=1#details
http://example.com/activity
buaa-classhopper://annoucement/ANNC-1
```

服务端不解析业务路径、不探测地址、不提供跳转中转接口。客户端收到 URL 后交给自身链接处理器，决定内部导航、WebView 或外部浏览器打开；未知协议/页面需安全兜底。null 表示不执行点击动作。

URL 最长 2048 字符，必须为绝对 URL；不允许首尾空白、控制字符、未编码空格、账号密码，拒绝 javascript/vbscript/data/file/blob 协议。不限制 App 自定义 Scheme 名单。通过校验后保留原始字符串，不做 URL 标准化重写。管理端不会执行自定义协议。

## 管理 API

所有接口需要 Cloudflare Access，复用 `{code,msg,data}`，列表使用 `{items,page,pageSize,total}`。分页默认 1/20，page 最大 1000000、pageSize 最大 100。失败返回 400（校验）、404（不存在/跨 App）、409（并发或引用阻止），修改和删除携带 revision。写入上限 32 KiB，未知 JSON 字段拒绝。

| 资源根路径 | 能力 |
| --- | --- |
| `/api/admin/ads/campaigns` | GET 列表、POST 创建；`/:id` GET/PATCH/DELETE；`/:id/placements` GET 跨 App 投放 |
| `/api/admin/ads/creatives` | GET 列表、POST 创建；`/:id` GET/PATCH/DELETE；`/:id/versions` GET 历史；`/:id/versions/:version` GET 快照；`/:id/placements` GET 引用 |
| `/api/admin/:appId/ads/slots` | GET 列表、POST 创建；`/:slotKey` GET/PATCH/DELETE |
| `/api/admin/:appId/ads/placements` | GET 列表、POST 创建；`/:id` GET/PATCH/DELETE |
| `/api/admin/:appId/ads/placements/filters` | GET 当前 App 现有投放关联的活动、素材和广告位筛选选项 |
| `/api/admin/:appId/ads/placements/:id/metrics` | GET 指定投放的曝光、点击、点击率和每日统计 |

活动字段：`name,notes,enabled,startsAt,endsAt`。素材创建：`name,type,draft`；PATCH：`name,draft`，draft 是完整内容对象（保留字段名，保存时直接发布）。广告位创建：`slotKey,name,format,maxItems`；PATCH 不允许修改标识和类型。投放字段：`campaignId,slotKey,creativeId,targetUrl,priority,enabled,startsAt,endsAt`，App 始终来自请求路径。

PATCH 仅更新传入字段；传 null 可移除时间边界/跳转地址，传省略字段则保留。删除请求体为 `{"revision":1}`。管理对象含 revision、createdAt、updatedAt；素材对象额外包含 draft、publishedVersion 和 published（当前快照或 null）。

活动、投放列表支持 `enabled=true|false`；投放和引用列表还支持 `id,campaignId,creativeId,slotKey`。`id` 按完整投放 ID 精确匹配，去除首尾空白，空值不筛选，可与其他条件组合，查询范围仍受当前 App 或引用关系限制。引用接口将路径对应的活动或素材作为不可覆盖的筛选条件。管理历史列表也支持分页。

投放筛选选项在进入管理页面时加载，返回 `{campaigns:[{id,name}],creatives:[{id,name}],slots:[{slotKey,name}]}`。仅包含当前 App 现有投放引用的记录，去重并按名称排序；包括已停用或不在有效期内的投放，不受列表筛选和分页影响。不读取全平台活动、素材列表或未关联投放的广告位。

示例：

```json
{
  "campaignId": "ADCA-20261022-ABCDEFGHIJ",
  "slotKey": "home-banner",
  "creativeId": "ADCR-20261022-ABCDEFGHIJ",
  "targetUrl": "buaa-classhopper://annoucement/ANNC-1",
  "priority": 10,
  "enabled": true,
  "startsAt": null,
  "endsAt": null
}
```

## 实现与验收

广告模块位于 `src/features/ads` 和 `web/src/features/ads`，使用现有 API_PLATFORM_DB。`0005_ads.sql` 新建五张广告表，`0006_ads_slots_always_enabled.sql` 删除广告位 enabled 列，保留广告位及投放关联，不修改公告数据。平台共享资源、App 专属广告资源分别装配；App 注册表保留 `ads` 标识以避免平台路径冲突。

本地先运行 `npm run db:migrate:local`，再启动 `npm run dev`。提交部署前完成类型检查、Worker/Web 测试、构建与 production dry-run。正式部署需先应用迁移；本功能开发验证不执行生产迁移、推送或部署。

2026-10-22 本地验收：类型检查、生成类型一致性检查、Worker 146 项测试、Web 59 项测试、生产构建与 dry-run 通过。隔离本地 D1 已应用五份迁移，浏览器完成素材创建及发布、活动与投放配置、公开读取、草稿隔离、v2 发布、v1 历史查看和暂停后空结果验证，并检查桌面及手机宽度。此浏览器流程使用真实本地 Worker/D1；仅 OSS 上传响应和示例图片使用模拟，没有验证真实 OSS 上传或生产部署。

2026-10-23 调整：投放的活动/广告位摘要和选择器不再显示启停状态；广告位删除 enabled 字段；素材保存即发布并保留版本历史，未引用素材允许连同历史删除。类型检查、Worker/Web 回归测试、生产构建与 dry-run 均通过。迁移和运行验证仅在本地进行，未执行生产迁移或部署。

## 单投放数据查询

投放详情使用“基本信息”“投放数据”两个 Tab，默认打开基本信息。首次切到投放数据时查询一次；之后切换 Tab 保留已获取结果，不重复请求。新建投放保存前不可查询。基本信息的未保存编辑保留，保存、删除操作栏仅在基本信息中显示。

统计默认近 7 个上海自然日（包含今天），支持近 7、30、90 天及自定义日期。选择预设或修改日期只更新待查询范围；点击“查询”才应用，重复点击可手动刷新。修改筛选后，已显示数据仍标明实际查询范围。没有定时轮询、聚焦/重连刷新、自动重试、保存联动查询、预取、同步任务或本地统计副本。

```http
GET /api/admin/buaa-classhopper/ads/placements/ADPL-.../metrics?from_day=2026-11-01&to_day=2026-11-05
```

接口使用现有 Cloudflare Access。先校验投放属于路径 App，再验证日期；查询参数仅接受 from_day、to_day，均为 YYYY-MM-DD，左闭右开。以上覆盖上海时间 11 月 1 日至 4 日。范围限制为今天及之前 89 个自然日，结束日期最多为明天。界面结束日期为包含当天的日期，发请求时加一天。

平台通过 `EVENT_ANALYTICS` Service Binding 的 `AdMetricsEntrypoint.queryPlacementMetrics` 查询 events。服务端 `EVENT_ANALYTICS_APP_IDS` 映射广告业务 App 到采集 App；默认本地 `{ "buaa-classhopper": "11" }`，生产 `{ "buaa-classhopper": "local" }`。RPC 的 ads_app_id 和 placement_id 来自已验证的路径身份，浏览器不能覆盖。

成功仍为 `{code:1,msg:"获取成功",data:...}`。data 保留 events 的 `app_id,ads_app_id,placement_id,from_day,to_day,summary,daily,coverage` 字段。summary 和 daily 含 impressions、clicks、ctr，daily 按日升序并补零。平台校验结果标识、日期、每日完整性、非负整数计数及汇总一致性。浏览器和服务端均不把故障转换成零值。

CTR 是点击除以曝光，0.03 表示 3%，可超过 100%；无曝光为 null，界面显示 `—`。多次真实点击分别计数；同一事件重传不重复计数，曝光还按 show_id 去重。上海自然日以 events 的服务端 received_at_ms 划分。请求、关闭和错误事件不纳入本版指标。

coverage 提供 90 天保留窗口、统计起点和完整性。跨统计起点时显示覆盖不完整，包含今天时提示持续更新；零值不代表启用前没有发生广告行为。events 不回填既有明细，也不承诺客户端无漏报。统计范围汇总、两张 SVG 趋势图和每日表格共用一次响应。

调用只等待 10 秒，不重试。缺绑定、映射或 events 采集 App 未注册返回 503；异常、超时、损坏或不匹配的上游数据返回 502；日期错误 400，不存在或跨 App 404，非 GET 方法 405。所有响应使用 Cache-Control: no-store。

本次不新增公开广告事件端点、数据库迁移或客户端埋点。生产须先发布 events 的命名入口，绑定和联调方式见 [部署说明](./DEPLOYMENT.md#广告统计服务绑定)。
