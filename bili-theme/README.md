# 哔哩主题（bili-theme）

原项目：[chaoscard/bili-theme](https://github.com/chaoscard/bili-theme)（上游 GitHub 仓库已不可访问），
当前发行站：https://bili-theme.66617173.xyz （Cloudflare Workers）。

本仓库为 **v6.0.0 镜像**，脚本内容与原版一致，仅改三处以便自持：

- `script-path` 指向本仓库 raw 地址（`.lpx` 内两处）；
- `DATABASE_URL` 指向本仓库的下架装扮离线库 `garb-database.json`（`bili-theme.response.js` 内一处）；
- `#!author` 署名 `thyself`（按仓库约定，不保留原作者名，致谢见文末）。

```
bili-theme.response.js  a78efac191a35759171590f1735cc00c  (仅 DATABASE_URL 改为自持地址，其余与原版一致)
bili-theme.api.js       452cb16d9308d071662405732a8670be  (与原版逐字节一致)
garb-database.json      90a8fb7d9eb44aaeca75205294e139df  (下架装扮离线库，v2026110705 / 660 套)
```

---

## 注入原理

不改 App、不注入 IPA，**伪造 B 站自己的接口响应**，让 App 以为用户已购买并装备了这套装扮。

```
装扮商城 H5 页  --注入 JS-->  点衣服图标  --POST-->  /settings/theme/api/select
                                                          | 被 api.js 拦截
                                                          v
                                              $persistentStore 多键存储
                                        BiliTheme / BiliThemeSpace
                                        BiliThemeSplash / BiliThemeOffShelf

App 原生请求 ----------------------------------------------+
  /x/resource/show/skin    --改写--> user_equip + load_equip   主题皮肤 / 加载动画
  /x/v2/space              --改写--> images.imgUrl + 轮播列表   个人空间头图
  /x/v2/splash/brand/list  --改写--> list + preload            开屏画面
  /x/garb/vas/search       --补齐--> 下架绝版装扮增量合并       商城搜索（v6 新增）
```

### 1. 素材全部来自 B 站真实 API

`fetchSuit()` 请求 `api.bilibili.com/x/garb/v2/user/suit/benefit`
（失败回落 `x/garb/v2/mall/suit/detail`），拿真实的 `package_url` / `package_md5` / `ver`
原样塞回去。所以皮肤 zip 是官方 CDN 下载的、md5 校验也过得去 —— 不是"破解"，是**转述**。

`extractParts()` 处理两种数据形态：普通套装是 `suit_items.{skin,loading,space_bg}[0].properties`，
盲盒单品是顶层 `properties`。一套装扮由多个 `item_id` 组成（皮肤 / 加载动画 / 头图），
用 `&` 拼成一串存进 `ids`，注入时逐个探测后合并。

### 2. H5 详情页注入（选装扮 + 接管点击）

往商城页 HTML 的 `</body>` 前塞一段 `<script>`（带 `bili-theme-inject-style` 标记做幂等）：

- **偷 item_id**：hook `window.fetch`，`res.clone().json()` 旁听页面自己拿到的
  `suit/detail`、`suit/benefit` 响应，从中抠出 id。不额外发请求。
- **盖住原生衣服图标**：`findTshirtEl()` 三级兜底（icon 属性含 `tshirt` → share 图标兄弟节点 →
  几何启发式：顶部 0~100px、右边缘距屏幕右边 30~130px），在上面压一个**透明 div**，
  每 150ms 跟随 `getBoundingClientRect()`（前 40 次快跟，之后降到 1200ms；scroll/resize 也触发）。
- **抢事件**：`document` 捕获阶段监听 click + `stopImmediatePropagation()`，
  抢在页面自己的处理器之前。
- 盲盒页（URL 带 `act_id`）会查 `x/vas/dlc_act/asset_bag`，取 `collect_list` 里
  `redeem_item_type === 5` 的项，按当前 Tab 名称匹配 `lottery_simple_list`。

### 3. api.js 伪造后端

拦截 `app.bilibili.com/settings/theme/api/{select,config}`。**这条路径真实不存在，请求不出网。**
按主题 / 空间头图 / 开屏画面三块分别写入 `$persistentStore`（`BiliTheme` / `BiliThemeSpace` / `BiliThemeSplash`）。
`reply()` 兼容 QX 与 Loon/Surge 两端不同的 `$done` 格式。

### 4. 三处响应改写

| 接口 | 注入字段 | 关键细节 |
|---|---|---|
| `/x/resource/show/skin` | `user_equip`、`skin_colors`（push 一条）、`load_equip` | `side_bg_color` **必须排在 `color_second_page` 之后**，否则 App 解析失败；`"true"/"false"` 字符串要转布尔 |
| `/x/v2/space` | `images.imgUrl` / `night_imgurl` / `has_garb` + `collection_top_simple.top.result` | 明确 `show_in_collection:false` + `show_in_space:true`，只当空间头图不污染收藏馆；仅当 `vmid == x-bili-mid` 才改 |
| `/x/v2/splash/brand/list` | `data.list`（自选库）+ `data.preload`（强制调度） | 从请求的 `selected` 读出用户勾选的 12 个开屏 ID，对齐覆盖；`fillImagesMeta()` 拉真实 ETag（当 MD5）与 Content-Range 精确字节数；无全屏竖版立绘时整段熔断，保持官方原生开屏；原生未购买自选开屏返回 `code:-400`，这里强制改 `code:0` |

### 5. 下架装扮搜索补齐（v6.0.0 新增）

- 拦截 `api.bilibili.com/x/garb/vas/search`，把离线库 `garb-database.json` 里的下架绝版装扮
  按关键词匹配后，**差集去重**增量合并进原生搜索结果（五元组 `[id, name, cover, type, lottery_id]`）。
- 库文件镜像自上游，本仓库已改自持地址；首次命中时毫秒级本地检索，未初始化才回源拉取，
  之后 7 天静默周期比对 `version` 做增量更新。
- 插件参数 `offShelf` 可整体关闭此功能。

---

## 安装（Loon）

1. Loon → 配置 → 插件 → 添加：
   `https://raw.githubusercontent.com/BeThyself/loon/main/bili-theme/BiliTheme.lpx`
2. MitM 已开启，hostname 含 `app.bilibili.com, www.bilibili.com, api.bilibili.com`
3. 重启哔哩哔哩 App

### 插件参数

| 参数 | 默认 | 说明 |
|---|---|---|
| `spaceBg` | true | 个人空间头图注入 |
| `splashBg` | true | 开屏画面装扮注入 |
| `offShelf` | true | 获取下架装扮（商城搜索时补齐下架绝版装扮） |

> **开屏要先手动设置一次**：App →「设置 - 开屏画面设置」→ 任意勾选 12 张 → 保存开启自选模式。
> 之后装扮开屏才能全自动生效与随机轮播。若某次开屏不生效，回该页面重新选 12 张即可。

---

## 已知行为：第一次冷启动可能不生效

**这是 App 自身行为，代理侧无法修。** `/x/resource/show/skin` 注入 `user_equip` 后，
App 还需要在本次启动内下载 → 校验 → 解压安装装扮 zip 包，而冷启动早期界面早已渲染完，
所以这次看不到，**下次启动才用上**。多数装扮**重启两次**即可。

（插件注入完成时的 toast 里也写了这句提示。）

## 与去广告插件的冲突

部分去广告插件会命中同一个开屏 URL：

```ini
http-response ^https?:\/\/app\.bili(bili\.com|api\.net)\/x\/v2\/(splash\/(brand\/list|event\/list2|list|show)|…) …
```

它要 `delete data.preload`，而本插件注入开屏全靠写 `data.preload`。Loon 文档规定
**同一响应最多选择一条 Response Script**，两者只能二选一 → 在去广告插件里关掉 `Splash` 开关。

（去广告插件**不碰** `/x/resource/show/skin` 和 `/x/v2/space`，与皮肤注入无冲突。）

## 版权

业务逻辑版权归原作者 [chaoscard](https://github.com/chaoscard)（bili-theme 项目）所有。
本仓库仅作镜像自持，署名按仓库约定改为 `thyself`。
