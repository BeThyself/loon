# loon

自用 Loon 插件 / 脚本仓库。一个目录一个插件，目录里的 `README.md` 写该插件的原理、参数与排查步骤。

插件头部 `#!author` 统一为 `thyself`；脚本上游的来源与致谢集中在文末。

## 插件一览

| 插件 | 文件 | 作用 | 触发 | 脚本位置 |
|---|---|---|---|---|
| 哔哩主题 | [`bili-theme/BiliTheme.lpx`](bili-theme/BiliTheme.lpx) | 装扮注入：皮肤 / 加载动画 / 开屏画面 / 空间头图，搜索时补齐下架装扮 | 装扮详情页点右上角衣服图标 | 本仓库 |
| 快捷搜索 Pro | [`QuickSearch/QuickSearch.lpx`](QuickSearch/QuickSearch.lpx) | Safari 地址栏命令：切换搜索引擎，并呼出知乎 / 微博 / 京东 / 淘宝 / 拼多多 / B站 / YouTube 的 App 内搜索 | 地址栏输入「命令 关键词」 | 内嵌于 lpx |
| 微博净化[墨鱼版] | [`weibo/WeiboEnhanced.plugin`](weibo/WeiboEnhanced.plugin) | 微博去广告、精简信息流、去开屏 | 自动 | 作者 CDN（跟随上游更新） |
| 麦片屏幕翻译 会员解锁 | [`mppmfy/MaipianVIP.plugin`](mppmfy/MaipianVIP.plugin) | 把会员 / 剩余次数接口改写成永久高级订阅（仅本地展示，不涉及真实付费） | 自动 | 本仓库 |
| 小黑盒签到 | [`heybox/heybox-checkin.lpx`](heybox/heybox-checkin.lpx) | 抓 Cookie，每天 08:20 自动签到领 20 H 币 | cron + 首次打开签到页 | 本仓库 |
| AnyRouter 每日签到 | [`anyrouter/anyrouter-checkin.lpx`](anyrouter/anyrouter-checkin.lpx) | 自动过阿里云 WAF 挑战，每天 08:35 签到，通知带余额 | cron + 首次登录网页 | 本仓库 |
| AgentRouter 每日签到 | [`agentrouter/agentrouter-checkin.lpx`](agentrouter/agentrouter-checkin.lpx) | Cookie / 密码双模式，每天 09:00 签到（本机已改由服务器跑，插件留作备用） | cron + 首次登录网页 | 本仓库 |
| RunAnyTime 抓 Cookie | [`runanytime/runanytime-capture.lpx`](runanytime/runanytime-capture.lpx) | 把 runanytime.hxi.me 的登录态投递到自建服务器，由服务器做 PoW 签到 | 登录网页时投递 + 自带自检入口 | 自家 VPS |
| NodeSeek 链接跳 App | [`nodeseek-jump/nodeseek-jump.lpx`](nodeseek-jump/nodeseek-jump.lpx) | 把 NodeSeek 帖子链接 302 到 NS Connect 深链，点链接直接进 App（需客户端支持 `nsconnect://post`） | 点击帖子链接 | 内嵌于 lpx |

## 安装

Loon → 配置 → 插件 → 添加，填对应 raw 地址：

```
https://raw.githubusercontent.com/BeThyself/loon/main/<目录>/<插件文件>
```

需要 MitM 的插件（证书必须已信任，否则看不到 HTTPS 内容）：

| 插件 | hostname |
|---|---|
| 哔哩主题 | `app.bilibili.com, www.bilibili.com, api.bilibili.com` |
| 快捷搜索 Pro | `duckduckgo.com` |
| 微博净化 | `api.weibo.cn, bootpreload.uve.weibo.com, wbapp.uve.weibo.com` |
| 麦片解锁 | `youxifanyizhushou.com` |
| 小黑盒签到 | `api.xiaoheihe.cn` |
| AnyRouter | `anyrouter.top` |
| AgentRouter | `agentrouter.org` |
| RunAnyTime | `runanytime.hxi.me` |
| NodeSeek 跳转 | `nodeseek.com, www.nodeseek.com` |

## 目录结构

```
bili-theme/   BiliTheme.lpx · bili-theme.api.js · bili-theme.response.js · garb-database.json
QuickSearch/  QuickSearch.lpx
weibo/        WeiboEnhanced.plugin
mppmfy/       MaipianVIP.plugin · mppmfy.response.js
heybox/       heybox-checkin.lpx · heybox.js
anyrouter/    anyrouter-checkin.lpx · anyrouter.js
agentrouter/  agentrouter-checkin.lpx · agentrouter_checkin.js
runanytime/   runanytime-capture.lpx · runanytime-capture.js
nodeseek-jump/ nodeseek-jump.lpx
```

## 通用说明

- **远程脚本按 URL 缓存**：改了仓库里的脚本，必须在 Loon 里把插件**停用再启用**，否则仍在跑旧代码。
- **签到类通知带站点名**：标题统一为 `[站点名] 结果`，多站点混在一起时能分清来源。
- **抓 Cookie 投递类脚本两端去重**：客户端只认稳定登录态（不看每次刷新都变的 Bearer），服务端再归一化比对，一致就回 `skipped`，不重复签到、不重复提醒。
- 所有签到插件只发签到与余额查询请求，不改动站点上的任何数据。

## 来源与致谢

业务逻辑版权归各上游作者，本仓库只做 Loon 适配与修复：

- `bili-theme` — [chaoscard/bili-theme](https://github.com/chaoscard/bili-theme)，本仓库为镜像，脚本逐字节一致，仅 `script-path` 改指本仓库
- `QuickSearch` — 可莉 Kelee 的 `QuickSearch.lpx`（https://kelee.one/Tool/Loon/Lpx/QuickSearch.lpx ），原版 7 条命令原样保留，另外补了「关键词在前」的语序与若干 App 内搜索
- `weibo` — 墨鱼（ddgksf2013）的 QuantumultX 远程重写，转成 Loon 语法
- `heybox` — [MaYIHEI/paperclip](https://github.com/MaYIHEI/paperclip) 的 `app/heybox/heybox.js`，逻辑未改
- `anyrouter` — WAF 挑战思路参考 [823302271/custom-clash](https://github.com/823302271/custom-clash) 与 [wujunjr/anyrouter-checkin](https://github.com/wujunjr/anyrouter-checkin)；固定混淆表已被站点随机化，本仓库改为沙盒 eval 现算
- `agentrouter` — 基于 [ddgksf2013/Scripts](https://github.com/ddgksf2013/Scripts) 的 `agentrouter_checkin.js` 改造，新增 Cookie 模式、验证码页判读与请求头补全
- `runanytime` — PoW 求解与站点适配参考 [Auroraee/checkin-pilot](https://github.com/Auroraee/checkin-pilot)、[wangwingzero/sign-in](https://github.com/wangwingzero/sign-in)
- `nodeseek-jump` — 思路同常见的 Telegram 重定向插件（`t.me` → `tg://resolve`），换成 NS Connect 的 scheme；深链格式与 App 侧实现见 [tyrad/nodeseek#19](https://github.com/tyrad/nodeseek/pull/19)
