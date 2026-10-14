# 哔哩主题（bili-theme）— 原理与 Loon 兼容性笔记

上游：[chaoscard/bili-theme](https://github.com/chaoscard/bili-theme) v3.2.1
本目录：`BiliTheme.lpx`（script-path 已改指向本仓库，**timeout 已从 10 提到 30**）+ 两个脚本
（`bili-theme.response.js` 做了**多部件并发拉取**改造，其余逻辑与上游一致）

实测环境：Loon + `Biliverse/Enhanced` v0.6.1 + `Biliverse/ADBlock` v0.7.3

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

## 二、与 Biliverse ADBlock / Enhanced 的实测冲突分析

### 2.1 逐条比对结果

**Biliverse ADBlock v0.7.3** 的 16 条脚本规则里，**只有一条**与 BiliTheme 重叠：

```ini
http-response ^https?:\/\/app\.bili(bili\.com|api\.net)\/x\/v2\/(splash\/(brand\/list|event\/list2|list|show)|feed\/index(\/(relate\/)?story)?|search\/square)
  requires-body=1, script-path=.../response.bundle.js, tag=📺 BiliBili.ADBlock.response.json
```

**`/x/resource/show/skin` 和 `/x/v2/space` 在 ADBlock 里完全没有规则命中**
（拆开 `response.bundle.js` 验证：全文件搜 `show/skin` 命中 0 次）。

**Biliverse Enhanced v0.6.1** 只碰 `x/resource/show/tab/v2`、`account/mine`、`region/index`、
`channel/region/list` 和 `app.bilibili.com/settings/*`，与 BiliTheme 的四个 URL 无交集。

### 2.2 唯一的 URL 级冲突：开屏

`/x/v2/splash/brand/list` 被两边同时命中。Loon 官方文档（新版 Script 语法）明确：

> **同一响应最多选择一条 Response Script，并保持原配置顺序。**

而且方向正好相反：

```js
// ADBlock response.bundle.js
case "/x/v2/splash/brand/list": switch (c?.Splash) { case true: default: {
  const p = ["account", "event_list", "preload", "show"];
  p.forEach((e) => { delete m.data[e] });      // 删掉 preload
}}
```
```js
// BiliTheme
data.data.preload = [{ show: showItems, forcibly: true, force_show_times: 999, rule: "random" }];
```

一个要删 `preload`，一个全靠 `preload` —— 在 Loon 上只能有一个生效。
→ **结论：在 ADBlock 里把 `Splash` 关掉，让位给 BiliTheme，是正确且最优的选择。**

### 2.3 但皮肤失效不是 URL 冲突

用户实测：`ADBlock.Splash = true` 时 BiliTheme 要两次冷启动才生效；`Splash = false` 时一次就生效。
而 ADBlock **根本不碰皮肤接口** —— 所以这不可能是"谁抢到 URL"的问题。

**实际机制（时序/超时）**：

1. 冷启动第一个请求就是 `/x/v2/splash/brand/list`，ADBlock 的 `response.bundle.js` 要在这里跑
   （1 MB 的打包脚本，含配置初始化）。
2. 紧接着 App 请求 `/x/resource/show/skin`，BiliTheme 的脚本要跑，
   而它**脚本内部还要串行发 1~3 个 `$httpClient` 请求**去 `api.bilibili.com` 拉装扮素材。
3. 两者叠在同一个脚本引擎的冷启动窗口里 → 累计**超过 `.lpx` 里的 `timeout=10`** →
   **Loon 直接杀掉脚本，响应原样放行** → 这一次等于没注入。
4. 第二次冷启动：脚本已编译、BoxJS 配置已缓存、DNS/TLS 都热 → 压进 10 秒内 → 成功。

`ADBlock.Splash = false` 时，那个 `switch(c?.Splash)` 直接落到空分支提前返回，
冷启动窗口少了一大块执行量，BiliTheme 就稳了。

这也解释了**为什么把插件在 Loon 里拖到最前面没用** —— 不是匹配顺序问题，
"保持原配置顺序"指的是配置文件的顺序，而且这压根不是顺序造成的。

**为什么只有 Loon**：`timeout` 是 Loon 的硬性杀脚本超时，其他客户端要么给得更宽，
要么脚本内 `$httpClient` 不走同一套调度。

---

## 三、本仓库打的补丁

| 文件 | 改动 | 目的 |
|---|---|---|
| `BiliTheme.lpx` | `BiliTheme.response` 的 `timeout=10` → `timeout=30`；`BiliTheme.api` 的 `timeout=15` → `timeout=20` | 不再被 Loon 在素材拉取途中杀掉 |
| `BiliTheme.lpx` | 新增插件参数 `diagNotify`（诊断通知，默认开） | 不用翻日志也能拿到关键数据 |
| `BiliTheme.lpx` | `#!author` 改为 Thyself | fork 后自行维护 |
| `bili-theme.panel.js` | **`/select` 时就把整套素材预拉取好并写进 `$persistentStore["BiliTheme.suit"]`** | 把网络请求从冷启动关键路径上挪走 —— 这是核心修复 |
| `bili-theme.panel.js` | 新增 `/settings/theme/api/diag` 端点 | 浏览器直接读诊断，不依赖通知权限 |
| `bili-theme.response.js` | `fetchSuit()` 先查预拉取缓存，命中则**零网络请求**；未命中才现场拉取并写回缓存 | 冷启动响应不再等网络 |
| `bili-theme.response.js` | 多部件由串行改 `Promise.all` 并发；记录每个 item 走的接口（`benefit` / `detail`） | 拉取耗时与失败原因可查 |
| `bili-theme.response.js` | 诊断保留最近 5 次，含 `before`（原始响应里已有的 equip 字段）与 `wrote`（我们写进去的） | 能对比成功/失败两次的差异 |

### 3.1 为什么是「预拉取」而不是「加大超时」

实测发现失败与耗时的相关性根本不在秒级：

| 素材拉取耗时 | 结果 |
|---|---|
| < 300ms | 皮肤生效 |
| ~300ms | 经常不生效 |

300ms 离 30 秒超时差了三数量级，所以**不是超时**。唯一说得通的解释是：
**`/x/resource/show/skin` 的响应在脚本里多花了这段网络时间，App 那边这条关键响应就被推迟了**，
而 App 对这段时间敏感（它有自己的启动时序）。

那就别在关键路径上发请求 —— 把 `fetchSuit()` 提前到用户点衣服图标那一刻（H5 页面里，
用户对着"正在注入装扮与预热缓存…"的 toast，完全无感），冷启动只剩纯计算，耗时归零。

**后续实测（2026-10-14）**：预拉取生效后 `cached: true, ms: 0`，但「第一次冷启动不生效、第二次才生效」
依然存在。对比两次 `/x/resource/show/skin` 的记录，**除 App 自己的 `is_free_theme` 参数（0 → 1）和时间戳外，
两边字节级完全一致** —— 说明注入本身没问题，剩下的差异在 App 内部，代理侧再优化也没用。
详见第七节。

## 四、为什么在 Loon 日志里找不到 console.log

Loon 官方文档（新版 Script 语法）里 `with` 支持的字段：

| 字段 | 类型 | 默认值 | 适用范围 |
|---|---|---|---|
| `debug` | Boolean / 插件 Boolean | **false** | 全部 Script |

**`debug` 默认 false —— 也就是脚本的 `console.log` 默认不会写进日志。**
BiliTheme 的 `.lpx` 用的是旧版语法，没有这个开关，所以日志里翻不到。

两条路：

1. **不想折腾日志** → 见下面第五节，脚本会把结果落盘 + 弹通知。
2. **想要真正的日志** → 把插件规则改写成新版语法并加 `debug=true`：
   ```ini
   response if ${url} ~= /^https?:\/\/(www\.bilibili\.com\/h5\/mall\/(digital-card\/home|suit\/detail)|app\.bilibili\.com\/x\/(resource\/show\/skin|v2\/space|v2\/splash\/brand\/list))(\?|$)/ then script("https://raw.githubusercontent.com/BeThyself/loon/main/bili-theme/bili-theme.response.js", {${spaceBg}, ${splashBg}, ${diagNotify}}) with tag="BiliTheme.response", timeout=30, requires_body=true, debug=true
   ```
   需要 Loon ≥ 3.5.1 (983)。**这条我没法在本地实测**，改之前先备份能用的旧语法版本。

## 五、诊断信息的三个出口

脚本每次处理 `/x/resource/show/skin` 都会把结果**无条件落盘**到 `$persistentStore["BiliTheme.diag"]`，
不依赖通知权限、也不依赖插件参数。三种读法：

### 出口 1：浏览器直接看（最稳，推荐）

用任意浏览器打开：

```
https://app.bilibili.com/settings/theme/api/diag
```

这个路径是假的，由 `bili-theme.panel.js` 直接应答（走 Loon 的 MITM），返回：

```json
{
  "panelVersion": "3.2.1-loon.3",
  "theme": { "item_id": "...", "name": "...", "ids": ["..."], "cover": "..." },
  "suitCache": { "for": "1766130114001", "name": "未来有你福利卡池个性主题", "ids": ["..."] },
  "runs": 7,
  "lastRuns": [
    {
      "time": "2026-10-14T06:27:38.115Z",
      "hit": "skin",
      "query": "?build=91400300",
      "hasMid": true,
      "theme": "未来有你福利卡池个性主题",
      "before": { "userEquip": null, "commonEquip": 9, "loadEquip": null, "skinColors": null, "equipKeys": ["common_equip"] },
      "injected": true,
      "wrote": { "id": 1766130114001, "ver": 3, "pkg": "https://i0.hdslb.com/bfs/garb/...", "hasLoad": true },
      "cached": true,
      "parts": 1, "total": 1, "ms": 0,
      "trace": [],
      "reason": null
    }
  ],
  "note": "lastRuns 是最近 5 次 /x/resource/show/skin 的诊断，从旧到新"
}
```

关键字段：

| 字段 | 说明 |
|---|---|
| `suitCache` | 有值 = 预拉取成功，冷启动应该零网络 |
| `cached` / `ms` | `true` + `0` = 命中缓存（理想状态）；`false` + 几百 ms = 又走了现场拉取 |
| `trace` | 每个 item 走的哪个接口。出现 `via: "detail"` 说明 `benefit` 没给数据，走了回落 |
| `before` | 原始响应里本来有什么。`userEquip` 非 null 说明 App 早就有装扮了 |
| `wrote` | 我们写进去的 `user_equip` —— 和 App 实际显示的对不上就说明被覆盖或被忽略 |
| `reason` | 没注入成功时的原因 |

**这一步同时能判定脚本有没有更新到**：

| 看到的 | 说明 |
|---|---|
| `panelVersion` 是 `3.2.1-loon.3` | 两个脚本都换成新版了 |
| `{"error":"unknown endpoint: /diag"}` | `panel.js` 还是旧版，插件没更新成功 |
| 打不开 / 一直转圈 | Loon 没拦到这个域名，或 MitM 未生效 |
| `lastSkinRun` 是 `null` + note 提示没记录 | `response.js` 还是旧版，或装好后还没冷启动过 B 站 |

### 出口 2：系统通知

插件参数 `diagNotify` 打开时，冷启动会弹一条通知。
**注意**：Loon 文档写明「通知是否最终展示还会受到系统通知权限和 Loon 通知设置影响」——
先去 iOS 设置 → 通知 → Loon 确认开关是开的，否则这条永远看不到。

| 通知内容 | 含义 |
|---|---|
| `✅ 皮肤注入成功「xxx」` + `素材 3/3 个部件，耗时 842ms` | 时序猜测坐实，耗时远离 30000ms，问题解决 |
| `✅ ... 耗时 9xxx ms` | 还在超时边界附近，需要继续压耗时 |
| `❌ 皮肤未注入` + `garb 接口没给到 package_url` | 素材接口被挡或返回异常，往 `api.bilibili.com` 的规则上查 |
| `⏭ 脚本已执行，但本地没有选中主题` | 脚本跑了，但 `$persistentStore["BiliTheme"]` 是空的 |
| **完全没有通知** | 先查出口 1：`lastSkinRun` 有记录 → 是通知权限问题；没记录 → 脚本压根没跑 |

### 出口 3：Loon 日志

需要新版语法 + `debug=true`，见第四节。

## 六、剩余已知限制

- `/x/v2/splash/brand/list` 在 Loon 上必然二选一，与 ADBlock 的 `Splash` 开关互斥。
- `spaceBg` 默认关；Loon 插件里 `argument=[{spaceBg},{splashBg},{diagNotify}]` 传的是对象，脚本能正确读到。
- `diagNotify` 排查完记得关，否则每次冷启动都会弹一条通知（落盘诊断不弹通知，可以一直留着）。

---

## 七、实测记录（2026-10-14）

### 7.1 两次冷启动的 diag 对比

| | 第 1 次（没生效） | 第 2 次（生效） |
|---|---|---|
| `is_free_theme` | **0** | **1** |
| `cached` / `ms` | true / 0 | true / 0 |
| `injected` | true | true |
| `wrote` | `{id:1776138445001, ver:1776239479, pkg:"https://i0.hdslb.com/bfs/garb/zip/d9bb…", hasLoad:true}` | 完全相同 |
| `before` | `{userEquip:null, commonEquip:null, loadEquip:null, skinColors:3, equipKeys:[]}` | 完全相同 |

结论：**代理侧两次行为一致，`user_equip` 都写进去了**。App 只是第二次才愿意用。
`is_free_theme` 0 → 1 是 App 自己状态的映射，说明它在两次之间存了东西。

### 7.2 旁路流水：看 App 自己干了什么

光看那四个 URL 已经看不到差异了，所以加了一条**只记录、不改写**的规则：

```ini
http-response ^https?:\/\/api\.bilibili\.com\/x\/garb\/ requires-body=1, tag=BiliTheme.garb, timeout=15
```

（同时把 `api.bilibili.com` 加进 MitM hostname。）

它记录 App 是否自己去 `api.bilibili.com/x/garb/` 查装扮归属 —— 如果 App 查了 `benefit?item_id=<我们注入的 id>`
而服务器回 `code != 0`（"你没有这个装扮"），那就是它拒绝应用的原因。

流水里用 `from` 字段区分是谁发的：

| `from` | 判定依据 |
|---|---|
| `脚本自身` | 请求带桌面 Chrome UA（BiliTheme 的 `fetchSuit` 用的） |
| `App` | 其他 UA |

记录最近 40 条，`/diag` 的 `garbTrace` 字段可以直接看。

### 7.3 旁路结果：App 不查装扮归属

`garbTrace` 抓到的 6 条（全部 `from: "App"`）是：

```
/x/garb/mall_v2/nav              /x/garb/mall_v2/home
/x/garb/popup                    /x/garb/v2/mall/home/recommend/list  ×2
/x/garb/vas/exposure/report
```

**全是装扮商城 H5 页自己加载内容，没有一条 `user/suit/benefit?item_id=…`。**
→ App 不会去服务端核实"我到底有没有这个装扮"，**"App 查证失败所以拒绝应用" 这个假设被排除。**

（脚本自身的 `fetchSuit` 请求不出现，是因为 Loon 里脚本经 `$httpClient` 发出的请求不走复写规则。）

### 7.4 时间线：第一次冷启动只活了 8 秒

| 时间 | 事件 |
|---|---|
| 06:36:21–24 | 用户在装扮商城浏览（6 条 garb 请求） |
| 06:36:48.606 | 第 1 次冷启动的 `/x/resource/show/skin`，`is_free_theme=0` |
| 06:36:56.716 | 第 2 次冷启动，`is_free_theme=1` |

两次之间只隔 **8.1 秒**。B 站冷启动本身要 2~3 秒，也就是说**第 1 次启动只活了三五秒就被杀掉了**。

而装扮包（`https://i0.hdslb.com/bfs/garb/zip/….zip`）需要 App 在启动后异步下载、校验、解压安装。
**三五秒根本不够。** 被杀掉 = 下载中断 = 这个周期没装上 → 下次启动重来。

`is_free_theme` 从 0 翻到 1 也说明：第 1 次启动之后 App 的本地状态**被改变了**
（它确实收下了我们注入的 `user_equip`），只是没来得及渲染。

### 7.5 结论（当前认知，待实验 A 确认）

> App 拿到注入的装扮 → 需要在本次启动内下载并安装装扮包 → 冷启动早期界面已经渲染完 → **下次启动才用上**。

这属于 **App 自身的资源管线**，代理侧（Loon 能改的只有响应内容）**无法让它提前渲染**。
所以「第一次不生效、第二次生效」在注入模式下大概率是**必然行为**，不是可以修掉的 bug。

### 7.6 怎么跑这个实验

1. Loon 删除「哔哩主题」插件，重新添加（改过 MitM hostname，必须重装）
2. 彻底退出 B 站
3. 冷启动一次，**确认皮肤没出来**
4. 再彻底退出，冷启动一次，**确认皮肤出来了**
5. 打开 `https://app.bilibili.com/settings/theme/api/diag`，把 `lastRuns` 和 `garbTrace` 发出来
