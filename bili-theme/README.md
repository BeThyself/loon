# 哔哩主题（bili-theme）

上游：[chaoscard/bili-theme](https://github.com/chaoscard/bili-theme) v3.2.1
本目录为 fork 后自用版：`BiliTheme.lpx` + 两个脚本，`script-path` 指向本仓库。

---

## 注入原理

不改 App、不注入 IPA，**伪造 B 站自己的接口响应**，让 App 以为用户已购买并装备了这套装扮。

```
装扮商城 H5 页  --注入 JS-->  点衣服图标  --POST-->  /settings/theme/api/select
                                                          | 被 panel.js 拦截
                                                          v
                                              $persistentStore["BiliTheme"]
                                                  + "BiliTheme.suit"（预拉取素材）

App 原生请求 ----------------------------------------------+
  /x/resource/show/skin    --改写--> user_equip + load_equip   主题皮肤 / 加载动画
  /x/v2/space              --改写--> images.imgUrl + 轮播列表   个人空间头图
  /x/v2/splash/brand/list  --改写--> list + preload            开屏画面
```

- **素材来自 B 站自己的 API**：`fetchSuit()` 请求 `api.bilibili.com/x/garb/v2/user/suit/benefit`
  （失败回落 `x/garb/v2/mall/suit/detail`），拿真实的 `package_url` / `package_md5` / `ver`
  原样塞回去，所以 zip 包是官方 CDN 下载的、md5 校验也能过。
- **H5 详情页注入**：往商城页 HTML 的 `</body>` 前插一段 `<script>`，hook `window.fetch` 偷 `item_id`，
  用透明 div 盖住原生衣服图标接管点击。盲盒页还会查 `x/vas/dlc_act/asset_bag` 按当前 Tab 匹配卡池。
- **panel.js**：拦截 `app.bilibili.com/settings/theme/api/{select,config}`（该路径真实不存在，请求不出网），
  把配置写进 `$persistentStore`。
- 三处响应改写的细节：`side_bg_color` 必须排在 `color_second_page` 之后（App 解析约束）；
  空间头图明确 `show_in_collection:false` + `show_in_space:true`，且仅当 `vmid == x-bili-mid` 才改；
  开屏用 `rule:"random"` + `force_show_times:999` 强行随机抽取，id 用 999901+ 自留号段。

---

## 本仓库的改动（相对上游）

| 文件 | 改动 | 为什么 |
|---|---|---|
| `BiliTheme.lpx` | `BiliTheme.response` 超时 10 → 30；`BiliTheme.api` 15 → 20 | 上游的超时对冷启动偏紧 |
| `bili-theme.panel.js` | `/select` 时**预拉取整套素材**写进 `$persistentStore["BiliTheme.suit"]` | 把网络请求从冷启动关键路径上挪走 |
| `bili-theme.response.js` | `fetchSuit()` 先查预拉取缓存，命中则**零网络请求**；未命中才并发拉取并写回 | 同上 |
| `bili-theme.response.js` | 多部件由串行改 `Promise.all` 并发 | 缩短拉取耗时 |
| `BiliTheme.lpx` | `#!author` 改为 Thyself | fork 后自行维护 |

### 为什么要预拉取

实测：`/x/resource/show/skin` 的响应路径上如果还要现发网络请求拉素材，
**拉取耗时达到数百毫秒时 App 经常不应用装扮**。把这次请求提前到用户点衣服图标那一刻
（H5 页面里，用户对着 toast 完全无感），冷启动就只剩纯计算。

---

## 已知行为：第一次冷启动不生效

**这是 App 自身的行为，不是脚本 bug，代理侧无法修。**

`/x/resource/show/skin` 的原始响应（用户没有装扮时）没有任何 `equip` 字段，我们注入 `user_equip` 后，
App 还需要在**本次启动内**下载 → 校验 → 解压安装装扮 zip 包。而冷启动早期界面早就渲染完了，
所以这次看不到，**下次启动才用上**。

排查时记录到的关键证据：

- 连续两次冷启动的注入记录**除 App 自己的 `is_free_theme` 参数（0 → 1）和时间戳外字节级一致** ——
  代理侧两次行为相同，`user_equip` 都写进去了。
- 两次冷启动只隔 **8.1 秒**，第 1 次启动活不过数秒，**不足以完成 zip 下载安装**。
- `is_free_theme` 0 → 1 说明 App 确实收下了注入的 `user_equip`，只是没来得及渲染。
- 新增只记录不改写的旁路规则盯 `api.bilibili.com/x/garb/`，抓到的全是装扮商城 H5 自身请求
  （`mall_v2/nav`、`popup`、`mall_v2/home`、`recommend/list`、`exposure/report`），
  **没有一条 `user/suit/benefit?item_id=…`** —— App 不会去服务端核实装扮归属。

**想让它一次生效**：注入后别急着杀 App，让它在前台待 1~2 分钟把包装完，再彻底退出重开。

---

## 安装（Loon）

1. Loon → 配置 → 插件 → 添加：
   `https://raw.githubusercontent.com/BeThyself/loon/main/bili-theme/BiliTheme.lpx`
2. 确保 MitM 已开启，hostname 含 `app.bilibili.com, www.bilibili.com`。
3. 重启哔哩哔哩 App。

插件参数：`spaceBg`（个人空间头图注入，默认关）、`splashBg`（开屏画面注入，默认开）。

### 与 B 站去广告插件的冲突

流行的去广告插件（如 `Biliverse/ADBlock`）有一条规则命中同一个 URL：

```ini
http-response ^https?:\/\/app\.bili(bili\.com|api\.net)\/x\/v2\/(splash\/(brand\/list|event\/list2|list|show)|…) …
```

它要 `delete data.preload`，而本插件注入开屏全靠写 `data.preload`。Loon 文档规定
**同一响应最多选择一条 Response Script**，所以这两个在开屏上只能二选一。

→ 在去广告插件里把 `Splash` 开关关掉，让位给本插件。

（去广告插件**不碰** `/x/resource/show/skin` 和 `/x/v2/space`，与皮肤注入无冲突。）

---

## 上游

`bili-theme` 源自 [chaoscard/bili-theme](https://github.com/chaoscard/bili-theme)（v3.2.1），
本仓库为镜像 + 本地补丁，业务逻辑版权归原作者。
