# 应用版本与 Segment 灰度

所有注册 App 自动获得版本管理，入口 `/admin/:appId/versions`。版本元数据按 App 隔离；灰度引用平台共享 Segment，不再维护版本专属用户名单。人群能力和 KV 一致性见 [Segment 文档](./SEGMENTS.md)。

## 版本规则

- 版本号为规范 `x.x.x`，每段非负安全整数，无前导零，不支持前缀或预发布后缀。同应用内唯一，创建后不能重命名，按数字分段排序。
- 每个版本包含 Markdown 更新说明、可选 HTTP/HTTPS 下载地址、可选正安全整数的字节大小。下载地址允许签名查询参数，不接受 URL 凭据或控制字符；说明允许空，UTF-8 最大 256 KiB。
- 保存后内容立即生效，不另设发布流程；新建版本不会自动改变手动最新版本。
- 发布类型 `releaseType` 为 `full`（全量）或 `gray`（灰度），新建默认灰度。只有全量版本可以设为最新版本；全量版本不会自动成为最新版本。
- 只有灰度版本可关联多个 Segment，同一 Segment 可关联多个 App 和灰度版本。未配置 Segment 的灰度版本不会被客户端查询选中。命中多个灰度版本时取最高者，并与最新全量版本取最高值，不提供优先级或单用户覆盖配置。
- 灰度改为全量时，保存操作原子清空全部 Segment 引用。非最新的全量版本可以改为灰度，原有关联不会恢复；当前最新版本须先更改或清空最新设置，才能改为灰度。
- 只使用已验证 token 的 SSO ID 匹配，Segment 的姓名和学号字段不参与版本查询。
- 最新版本或仍关联 Segment 的版本不能删除，须先清空对应设置或引用。关联了空人群的版本也需要先解除引用。

## 客户端接口

```http
GET /api/:appId/versions/latest
Authorization: Bearer <SSO access token>
```

Authorization 可省略。匿名查询只读取最新全量版本，不访问人群名单。有 Authorization 时必须通过现有 SSO issuer、RS256、有效期、`api-platform-<appId>` audience 等校验，以 JWT sub 作为 sso_id。未知或非法参数均拒绝，不能通过 query 指定用户 ID、姓名或学号。

```json
{"code":1,"msg":"获取成功","data":{"version":{"version":"1.5.0","releaseNotes":"## 更新","downloadUrl":"https://example.com/app.apk","downloadSizeBytes":12345678}}}
```

没有适用版本返回 `data:{"version":null}`，下载地址和大小可以为 null。客户端自行比较已安装版本、展示说明和执行更新，不强制升级或降级。

无效凭证返回 401，SSO 公钥不可用返回 503，不回退匿名。引用的人群不可读、或者并发解除引用后删除导致版本暂时不可读时返回 503，可重试。全部版本接口使用 no-store。

## 流水线创建接口

```http
POST /api/token/buaa-classhopper/versions
Authorization: Bearer <API Token>
Content-Type: application/json
```

此入口用于 BUAA ClassHopper 发布流水线，仅创建版本。Token 必须属于 `buaa-classhopper` 并拥有 `versions:create`（新建灰度版本）权限。管理员可在该 App 的 API Token 创建页中勾选“版本管理 / 新建灰度版本”，将创建后仅展示一次的明文保存到流水线 Secret。

请求为 `{version,releaseNotes?,downloadUrl?,downloadSizeBytes?,segmentIds?}`，复用管理接口的字段校验。请求不接受 `releaseType`，包括 `full` 和 `gray` 都返回 400；服务端固定创建为 `gray`。也不能指定 App、修订号或最新版本。Segment 可省略，默认 `[]`；需要灰度投放时，可在此处指定现有 Segment ID，或稍后在管理页面配置。

示例 `version.json`：

```json
{
  "version": "1.6.0",
  "releaseNotes": "## 本次更新\n\n- 优化课程预约体验\n- 修复已知问题",
  "downloadUrl": "https://example.com/classhopper-1.6.0.apk",
  "downloadSizeBytes": 12345678
}
```

在流水线生成该 JSON 文件后调用：

```sh
curl --fail-with-body --request POST \
  "${API_PLATFORM_BASE_URL}/api/token/buaa-classhopper/versions" \
  --header "Authorization: Bearer ${API_PLATFORM_TOKEN}" \
  --header "Content-Type: application/json" \
  --data-binary @version.json
```

`API_PLATFORM_BASE_URL` 为平台地址，`API_PLATFORM_TOKEN` 从流水线 Secret 注入。调用不需要 Cloudflare Access 管理员凭证或 SSO 登录。

成功返回 201 和完整版本记录，`data.releaseType` 固定为 `gray`、初始 revision 为 1。元数据与 Segment 引用原子创建，不修改最新全量版本设置。该接口没有编辑、删除、转全量或设置最新版本的操作；转全量与设为最新仍在管理页面进行。

缺少、无效、过期、撤销或其他 App 的 Token 返回 401，缺少 `versions:create` 权限返回 403；输入非法返回 400，请求体超过 320 KiB 返回 413。版本号重复或 Segment 已失效返回 409，不覆盖已有版本，流水线重跑也遵循此规则。全部响应使用 `Cache-Control: no-store`。创建审计记录 Token ID，不记录 Token 明文。本仓库仅提供接口和调用契约，未改动 Android 仓库的发布工作流。

## 管理 API

下表路径基于 `/api/admin/:appId/versions`，均使用 Cloudflare Access 和平台响应包装。

| 方法和路径 | 请求／行为 |
| --- | --- |
| `GET /` | 分页列表 `page=1&pageSize=20`，最多 100，版本号降序 |
| `POST /` | `{version,releaseType?,segmentIds?,releaseNotes?,downloadUrl?,downloadSizeBytes?}`；releaseType 默认 gray，segmentIds 默认 []；201 |
| `GET /:version` | 完整版本信息 |
| `PATCH /:version` | `{revision,releaseType?,segmentIds?,releaseNotes?,downloadUrl?,downloadSizeBytes?}`；至少一个编辑字段，可同时保存元数据和灰度人群 |
| `DELETE /:version` | `{revision}`；成功 data:null |
| `GET /latest` | `{latestVersion,revision}`；首次为 null、1 |
| `PUT /latest` | `{revision,version}`，只能指定全量版本，version:null 清空 |
| `PUT /:version/segments` | `{revision,segmentIds}` 整体替换灰度版本的 Segment 引用，全量版本拒绝此操作（包括空数组） |

版本详情和列表项为 `{version,releaseType,releaseNotes,downloadUrl,downloadSizeBytes,revision,createdAt,updatedAt,segmentIds}`。全量版本的 segmentIds 始终为 `[]`。列表为 `{items,page,pageSize,total}`。不返回按人群估算的用户数，后台显示关联人群数量。客户端查询的版本字段保持 `{version,releaseNotes,downloadUrl,downloadSizeBytes}`。

引用替换使用该版本 revision，和元数据编辑共享乐观锁，并递增版本 revision。人群 ID 保存于 `app_versions.segment_ids` JSON 数组字段，默认 `[]`。数组和修订号通过单条条件 UPDATE 原子替换；过期请求不修改引用，人群不存在时条件写入不生效并返回 409。最多关联 100 个 Segment，去重排序；传空数组解除全部引用。没有旧的按用户 rollouts 接口。

创建、编辑版本可同时提交 segmentIds，与版本内容在同一条条件 INSERT／UPDATE 中保存。人群已失效时，版本内容也不保存；整个操作只使用一个版本 revision。PATCH 省略 segmentIds 保留原引用，转全量仍会清空引用。全量版本不能提交非空 segmentIds。

最新设置使用独立的配置 revision。不存在的版本返回 404；重复版本、编辑冲突、引用失效、发布类型不允许当前操作或删除受保护版本返回 409；参数非法返回 400。

## 管理页面

版本管理页仅提供版本列表，显示发布类型、下载信息、关联人群数和最新标记，提供新建、编辑和删除。不再展示最新版本信息栏、清空设置按钮或灰度配置视图选择器。“设为最新”位于版本编辑页标题右侧，仅已保存且没有未保存修改的全量版本可用，当前最新版本显示“已是最新”。编辑页分为“基本信息”和“安装包”两个页签，切换页签保留全部草稿。

基本信息依次展示独占一行的版本号、更新说明编辑器、分隔线和发布类型。更新说明与公告共用 `MarkdownEditor`，包含格式工具栏、图片上传／粘贴和实时预览。默认选择灰度并显示 Segment 多选；选择全量隐藏人群配置，当前最新版本不可选择灰度。灰度转全量时，原有人群关联的解除提示显示在类型选择处。安装包页签仅包含下载地址和文件大小。

版本内容与所选人群通过“保存版本”一次提交。无论当前位于哪个页签，均保存整份草稿；校验失败时切换到对应字段所在的页签。白名单和灰度的 Segment 选择完整展示可选人群、在本地搜索，不显示分页；人群管理列表仍保留分页。

灰度人群统一在版本编辑页的基本信息中配置，使用共享 Segment 搜索／多选组件。成员只在人群管理中编辑，版本页面只保存引用。人群变更自动被下一次版本查询使用，版本关联不需要重新保存。

所有编辑沿用应用隔离的会话草稿、未保存提醒和固定操作栏。冲突保留输入或选择，必须人工核对并明确采用最新修订号后保存，写请求不自动重试。

## 数据库与验证

重写后的 `0007_app_versions.sql` 仅定义平台 Segment、App 版本、最新设置的表结构、默认值、索引及主外键，不使用 CHECK、触发器或存储过程。`app_versions.release_type` 默认为 `gray`。参数合法性由 Zod Schema 校验，发布规则由 Service 校验；Repository 的条件写入保护并发一致性。类型切换与引用清空共用一条带 revision 的 UPDATE，指定最新与切换为灰度的写入条件相互排斥。iClass 白名单引用配置仅存 KV，不建表。不创建单独的版本人群关联表。不兼容之前未上线的设计。

上线前应用迁移并手工配置 Segment 与引用，不导入旧名单。使用干净临时本地库执行 Worker/D1/KV 联调、并发和故障测试；类型检查、前端测试、生产构建和 dry-run 不等于生产 SSO 或 KV 全球传播验证。本次不修改消费端、不执行生产迁移或部署。

版本 Repository 在更新引用的语句中检查目标人群仍存在，Segment Repository 在删除语句中检查没有版本引用该人群。存在引用时返回通用 409；两端使用条件写入，避免先检查后写入的并发间隙。业务规则集中在应用代码中，直接绕过应用写数据库不会执行这些校验。
