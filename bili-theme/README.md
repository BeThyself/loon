# 哔哩主题（bili-theme）— 原理与 Loon 兼容性笔记

上游：[chaoscard/bili-theme](https://github.com/chaoscard/bili-theme) v3.2.1
本目录：`BiliTheme.lpx`（script-path 已改指向本仓库）+ 两个脚本（内容与上游 dist 一致）

---

## 一、注入原理

不改 App、不注入 IPA，**伪造 B 站自己的接口响应**，让 App 以为用户已购买并装备了这套装扮。

```
装扮商城 H5 页  --注入 JS-->  点衣服图标  --POST-->  /settings/theme/api/select
                                                          | 被 panel.js 拦截
                                                          v
                                                  $persistentStore["BiliTheme"]
                                                          |
App 原生请求 ----------------------------------------------+
  /x/resource/show/skin    --改写--> user_equip + load_equip   主题皮肤 / 加载动画
  /x/v2/space              --改写--> images.imgUrl + 轮播列表   个人空间头图
  /x/v2/splash/brand/list  --改写--> list + preload            开屏画面
```

### 1. 素材来自 B 站自己的 API
`fetchSuit()` 请求 `api.bilibili.com/x/garb/v2/user/suit/benefit`（失败回落 `x/garb/v2/mall/suit/detail`），
拿真实的 `package_url` / `package_md5` / `ver` / 配色 / 加载动画 URL，原样塞回给 App。
所以皮肤包是官方 CDN 下载的、md5 校验也能通过。

### 2. H5 详情页注入（`DETAIL_INJECT_SNIPPET`）
- 往商城页 HTML 的 `</body>` 前插一段 `<style>` + toast DOM + `<script>`。
- 该脚本 hook `window.fetch`，旁路监听页面自己的 `suit/detail`、`suit/benefit` 响应，抠出 item_id。
- `findTshirtEl()` 三级兜底定位原生衣服图标（icon 属性含 `tshirt` → share 图标兄弟节点 → 几何位置），
  在上面盖一个透明 div，每 150ms 跟随 `getBoundingClientRect()`。
- 点击时 `stopImmediatePropagation` 拦掉原生事件，盲盒页还要查 `x/vas/dlc_act/asset_bag`
  按当前 Tab 名匹配 `lottery_simple_list`，最后 POST 到 `/settings/theme/api/select`。

### 3. panel.js：伪造后端
拦截 `app.bilibili.com/settings/theme/api/{select,config}`，
把 `{item_id, name, ids, cover}` 写进 `$persistentStore["BiliTheme"]`。
这个域名路径在真实 B 站并不存在，请求根本不会出网。

### 4. 三处响应改写
| 接口 | 注入字段 | 备注 |
|---|---|---|
| `/x/resource/show/skin` | `user_equip`、`skin_colors`、`load_equip` | `data.side_bg_color` 必须排在 `color_second_page` 之后，否则 App 解析失败 |
| `/x/v2/space` | `images.imgUrl`、`night_imgurl`、`collection_top_simple.top.result` | `show_in_collection:false` + `show_in_space:true`；仅当 `vmid == x-bili-mid` 才改 |
| `/x/v2/splash/brand/list` | `data.list` 自选库 + `data.preload` | `rule:"random"`、`forcibly:true`、`force_show_times:999`，id 用 999901+ 自留号段 |

失败一律 `console.log` + 放行原响应，从不阻断请求。

---

## 二、Loon 上的冲突点（与去广告插件）

流行的 B 站去广告 Loon 插件（Maasea / 可莉 / kokoryh 一系）含有以下规则，
**与 BiliTheme 命中完全相同的 URL**：

```ini
[Rewrite]
^https:\/\/app\.bilibili\.com\/x\/resource\/show\/skin\? response-body-json-del data.common_equip
^https:\/\/app\.bilibili\.com\/x\/resource\/ip reject-dict

[Script]
http-response ^https:\/\/app\.bilibili\.com\/x\/v2\/splash\/(?:brand\/list|event\/list2|list|show) script-path=.../Bilibili_remove_ads.js,requires-body=true,tag=移除开屏广告
http-response ^https:\/\/app\.bilibili\.com\/x\/v2\/account\/(?:mine|myinfo) script-path=.../Bilibili_remove_ads.js,requires-body=true,tag=精简我的页面
```

对照 BiliTheme 的匹配范围：

```
www.bilibili.com/h5/mall/(digital-card/home|suit/detail)
app.bilibili.com/x/resource/show/skin     <-- 与去广告的「复写」同 URL
app.bilibili.com/x/v2/space
app.bilibili.com/x/v2/splash/brand/list   <-- 与去广告的「响应脚本」同 URL
```

### 关键结论

1. **`/x/v2/splash/brand/list` 是硬冲突**
   Loon 官方文档（新版 Script 语法）明确：
   > 同一响应最多选择一条 Response Script，并保持原配置顺序。

   去广告要"清空开屏广告"，BiliTheme 要"注入自己的开屏"——同一 URL 上两条
   `http-response` 脚本，Loon 只会跑一条。这不是 bug，是设计冲突。
   → 处理：在 Loon 插件列表里把 BiliTheme 排到去广告之前，
   或者关掉去广告那条「移除开屏广告」脚本 + BiliTheme 的 `splashBg` 开关二选一。

2. **`/x/resource/show/skin` 上「复写」与「脚本」并存**
   去广告用 `response-body-json-del data.common_equip`（复写）改同一个响应体，
   BiliTheme 用 `http-response` 脚本写 `user_equip`。两者都要求 Loon 读取完整 body，
   谁最后落地谁生效。

3. **`/x/v2/account/(mine|myinfo)`**
   BiliTheme 刻意不碰这个接口（上游 README 也写明），但去广告的「精简我的页面」脚本会改它——
   装扮权益相关的字段若被删，可能影响 App 判定是否应用新装扮。

---

## 三、为什么「第二次冷启动才生效」（待验证，按可能性排序）

1. **App 自身机制（与代理无关）**
   注入后 App 需要下载装扮 zip、校验 md5、解压安装；而冷启动早期界面早已渲染完，
   所以本次启动看不到 → 下次冷启动才生效。上游 README 自己也写了「部分装扮可能需要重启两次」。

2. **Loon 脚本超时（`timeout=10`）**
   `injectSkinResponse` → `fetchSuit` 会**串行**请求 1~N 个 item 的 garb 接口
   （`fetchItemFull` 失败还会再回落请求第二个 URL）。JS 侧 `setTimeout` 是 8s，
   但 `$httpClient` 自身的连接/请求超时是 Loon 默认值。
   第一次冷启动 DNS/TLS/节点都是冷的，累计超过 `timeout=10` 时 **Loon 会杀掉脚本、响应原样放行**，
   等于这一次没注入；第二次热了才成功。→ 修法：把 `timeout` 提到 20，并把多个 id 改成并发请求。

3. **`$persistentStore` 跨脚本可见性**
   panel.js（http-request）写入、response.js（http-response）读取，用的是同一个显式 key `BiliTheme`。
   理论上立即共享；若 Loon 的脚本运行时对 persistentStore 有缓存，也可能表现为「要等一轮」。

### 60 秒定位方法
Loon → 日志，筛 `/x/resource/show/skin`：
- 看 `BiliTheme.response` 有没有命中；
- 看有没有 `[BiliTheme] 皮肤与加载动画注入成功:「xxx」`；
- 看到 `[BiliTheme] 警告: 未获取到主题皮肤素材` → 就是 `fetchSuit` 失败（被去广告挡了或超时）。

## 四、可直接打的补丁
- `timeout=10` → `timeout=20`（.lpx）
- `fetchSuit` 里多个 id 改 `Promise.all` 并发（response.js）
- 兼容去广告：把 `/x/v2/splash/brand/list` 的注入挪到 `x/v2/splash/event/list2` 之类未被占用的入口（需实测）
