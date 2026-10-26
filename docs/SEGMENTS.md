# 平台共享人群 Segment

Segment 管理名单和匹配能力。人群属于平台，可被任意 App 的多个业务引用。模型只有稳定 ID、名称、修订号、三类名单、字段条目数和管理时间，没有说明字段，不提供引用查询接口或消费者注册表。

## 名单与匹配

```json
{
  "name": "内测人群",
  "members": {
    "student_name": ["张三"],
    "student_id": ["23370001"],
    "sso_id": ["user-1"]
  }
}
```

三个字段是独立集合，没有同行用户关系。各项去除首尾空白、去重并排序，按精确值匹配，大小写敏感；任一已提供属性命中即属于该人群。缺失属性不匹配。姓名最多 100 字符、学号 64、SSO ID 256，不能包含控制字符。

空人群合法。字段条目数不等于实际用户人数，不提供推算的总人数。编辑页保留姓名、学号、SSO ID 三列，每列独立逐行编辑、删除，新增入口位于各列内，支持换行、英文或中文逗号批量粘贴；窄屏依次纵向排列。各列标题行右侧提供新增和搜索按钮，输入框默认隐藏，点击后展开并聚焦。收起新增区域会保留待新增内容；收起搜索或按 Escape 清除筛选，每列独立分页。全部修改在“保存人群”时整体提交，尚未点击“添加”的输入也会一并保存；冲突时保留逐行编辑和待新增内容。

## 管理 API

已有 Segment 的名称直接显示在编辑页标题中，悬停或键盘聚焦时显示编辑按钮，也可点击标题文字进入编辑。触屏上编辑按钮保持可见。名称输入框在标题位置展开，Enter 或失焦结束编辑，Escape 恢复本次编辑前的名称；所有修改仍通过“保存人群”统一提交。新建页显示固定标题“新建人群”，使用带“人群名称”标签的普通输入框，创建后切换为标题原位编辑。

全部使用 Cloudflare Access，成功和失败响应沿用 `code/msg/data`，使用 `Cache-Control: no-store`。

| 方法与路径 | 行为 |
| --- | --- |
| `GET /api/admin/segments` | `page=1&pageSize=20&search=...`；search 按名称或 ID 包含匹配，每页最多 100 |
| `POST /api/admin/segments` | 请求 `{name,members}`；成功 201 |
| `GET /api/admin/segments/:id` | 读取完整人群 |
| `PUT /api/admin/segments/:id` | `{revision,name,members}` 整体保存 |
| `DELETE /api/admin/segments/:id` | `{revision}`；成功 `data:null` |

ID 为自动生成的 `SEGM-YYYYMMDD-XXXXXXXXXX`，稳定且不可修改。名称去空白后必填，最长 100 字符。请求严格拒绝未知字段，包括 `description`；人群写入请求体最多 2 MiB。

详情返回 `{id,name,revision,members,counts,createdAt,updatedAt}`；counts 与 members 使用相同三个字段名。列表返回 `{items,page,pageSize,total}`，其中 items 不含 members。KV key 不对外返回。

不存在返回 404，输入非法返回 400，写入冲突返回 409。仍被版本引用的人群由 Repository 条件删除保护，返回通用 409，不暴露具体业务表或引用来源。不存在 `/:id/references` 接口。

## 模块边界与存储

`src/features/segments` 独立拥有 schema、Repository、Service、Routes 和 KV MemberStore。消费者依赖 `SegmentReader.load(ids)` 接口，使用 `mergeMembers` 合并，或使用 `matchesMembers(members, identity)` 匹配，不操作 KV key。

D1 的 `segments` 保存名称、修订号、当前快照 key 和三个字段条目数，个人名单只存现有 `API_PLATFORM_KV`。key 为 `segments:<id>:members:<uuid>`，值为 `{schemaVersion:1,segmentId,members}`。

每次保存先写唯一的完整 KV 快照，再在 D1 中条件提交名称、条目数和快照引用并递增 revision。过期修订不能覆盖当前数据；KV 写入失败不修改元数据，未提交快照不会参与读取。写入前检查 KV 单值 25 MiB 限制。

已提交快照缺失、JSON／结构无效或 segmentId 不符，返回可重试的 503，不能解释为空名单。KV 最终一致，新 key 可能暂时不可读。当前及历史快照不设 TTL，首版不增加清理任务。参见 [KV 一致性](https://developers.cloudflare.com/kv/concepts/how-kv-works/)。

版本灰度将 Segment ID 数组保存于 `app_versions.segment_ids`，版本 Repository 通过带 revision 和目标人群存在条件的单条 UPDATE 原子替换。Segment Repository 的 DELETE 在同一语句中检查版本引用，避免与引用保存并发时产生悬空 ID。迁移不定义 CHECK、触发器或存储过程；参数和业务规则由应用代码控制。

白名单和灰度配置共用 Segment 选择组件，页面默认仅显示已选人群和“添加人群”按钮。点击后打开右侧 Sheet，按需完整加载可选人群，支持多选及按名称或 ID 本地搜索，不显示分页。勾选直接更新表单草稿，关闭侧栏保留选择，最终通过页面保存按钮提交；已选人群可在页面直接移除。此调整仅影响配置选择器，人群管理列表仍使用分页接口和分页展示。

## iClass 白名单协议变更

后台使用原管理路径的 GET、PUT，整体配置格式：

```ts
type PolicyResult =
  | { type: "segments"; segmentIds: string[] }
  | { type: "unavailable" };
type PolicyConfig = {
  revision: number;
  rules: { version: string; result: PolicyResult }[];
  default: PolicyResult;
};
```

每条规则精确匹配一个 `x.y.z` 版本，复用版本管理的版本号校验（不接受前导零、预发布后缀或超出安全整数的分量）；版本号不能重复。`default` 为必填结果；Segment 允许空选。合法版本未命中时使用默认结果，缺失或非法版本头固定返回成功和空名单，不读取配置，也不使用默认结果。

配置仅存 `API_PLATFORM_KV` 的 `buaa-classhopper:iclass:access-policy:v3`，不建立白名单 D1 表。不读取或迁移旧 key，也不自动删除旧数据。新 key 不存在时返回 `{revision:1,rules:[],default:{type:"segments",segmentIds:[]}}`。保存前验证所有规则及默认结果引用的人群可读，整份配置一次写入 KV；读取或写入故障返回 503。

保存检查当前可读的 revision，已观察到的过期修订返回 409，成功后加一。KV 为最终一致存储，不支持原子比较写入，因此同时保存可能互相覆盖；管理端保留整份草稿并支持 409 后核对重试，但不承诺跨地区即时一致或并发互斥。

KV 引用没有数据库外键保护。仅被白名单引用的人群可被删除，删除后只有选中该引用的公开请求返回 503，直到管理员清除或替换失效引用；其他规则或默认结果不受影响。Segment 模块不扫描 KV 业务配置，不维护消费者注册表。版本引用由 Repository 条件写入和删除保护。

公开路径仍为 `GET /api/buaa-classhopper/v1/iclass/access-policy`，使用 `X-App-Version` 选择结果，不再设置固定最低版本。配置为不可用时返回 426，提示“当前版本暂不可用”。命中结果的 Segment 不可读时返回 503，不回退默认结果。成功保留 `Cache-Control: public, max-age=60` 和 `Vary: X-App-Version`，错误使用 `no-store`。成功返回：

```json
{"code":1,"msg":"获取成功","data":{"schemaVersion":1,"revision":"<opaque hash>","studentIds":[],"names":[]}}
```

公开接口保持原有响应结构：`schemaVersion` 固定为 1，所选 Segment 的 `student_id` 合并去重后返回 `studentIds`，`student_name` 合并去重后返回 `names`，不返回 `members`、`sso_id` 或 Segment ID。后台白名单合并预览也只显示姓名和学号。客户端按姓名或学号判断命中。revision 为配置修订号、命中版本规则标识（默认结果使用 null）和有序 `[segmentId,segmentRevision]` 列表等信息的 SHA-256；客户端只比较是否相同，不解析日期或数字。所选人群编辑也会改变公开 revision，无需重新保存白名单引用。缺失或非法版本头使用独立、固定的 SHA-256 revision，不随配置变化。

Android 客户端继续读取 `schemaVersion`、`revision`、`studentIds`、`names`，无需改为 Segment 的字段结构。本仓库不修改 Android。

## 版本消费者

版本元数据仍归各 App。版本分为全量和灰度，默认灰度；仅灰度版本通过 `app_versions.segment_ids` JSON 数组关联多个 Segment，同一 Segment 可以关联多个灰度版本和 App。灰度转为全量时自动解除引用。版本查询只用已验证 JWT `sub` 作为 `sso_id`，不以姓名或学号匹配，也不接受客户端自行指定用户 ID。全部命中的灰度版本与手动指定的最新全量版本按数字 versionCode 取最高者。完整契约见 [版本管理](./VERSIONS.md)。

## 首次切换

直接使用重写后的 `0007_app_versions.sql` 创建新结构；0007 已上线；安装包对象与数字 versionCode 使用后续 0008 迁移。不增加旧结构兼容、名单导入或运行时回退。上线后手工创建 Segment 并配置消费者引用，旧 KV key 不再读取，也不自动删除。

此前本地验证库已经应用过旧 0007，因此本次联调使用独立临时目录，通过 `wrangler d1 migrations apply --local --persist-to <目录>` 创建干净数据库，并让 `wrangler dev --local --persist-to <同一目录>` 使用它，不重置现有本地库。
