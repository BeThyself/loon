# AnyRouter 每日签到（Loon）

自动签到 `anyrouter.top`，并顺手破解它的阿里云 WAF 挑战。

## 为什么不能直接用现成脚本

anyrouter.top 挂在阿里云 WAF 后面。裸 HTTP 请求只会拿到一段混淆 JS 挑战页（`var arg1='...'` + 一大坨自解码函数），它算出一个 `acw_sc__v2` cookie 才算放行。GitHub 上那批 Surge/Loon 脚本（如 `823302271/custom-clash`）用的是社区逆向出来的**固定混淆表 + 固定 XOR key**，但阿里云现在按部署随机化这张表，算出来的 cookie 是错的，请求会一直卡在挑战页。

本脚本不再硬编码算法：把挑战页里的 `<script>` 丢进沙盒 `eval`，用 `document.cookie` 的 setter 拦截它自己算出的 `acw_sc__v2`，所以上游改表也不影响（除非换成另一种挑战）。

## 安装

1. Loon → 配置 → 插件 → 添加：
   `https://raw.githubusercontent.com/BeThyself/loon/main/anyrouter/anyrouter-checkin.lpx`
2. 打开 MitM（插件已声明 `hostname = anyrouter.top`）。
3. 用 Safari / AnyRouter 相关页面登录一次 `https://anyrouter.top/console`，插件会把 `Cookie` 和 `New-Api-User` 存下来（存 `$persistentStore`，不上传任何地方）。
4. 之后每天 08:35 自动签到，可通知里看余额。

也可以在插件参数里手动填 `session`（值或整条 Cookie）与 `new_api_user`，跳第 3 步。

## 通知

抓凭证和签到是两条独立通知，都需要：

| 时机 | 通知 |
|---|---|
| 首次抓到你登录后的 `session`（或换了账号） | `✅ 已抓取凭证 · 用户 <id>`，同一账号只弹一次，不会刷屏 |
| 每天 cron | `✅ 签到成功` + 服务端文案 + 余额 / 已用 |
| 已经签过 | `ℹ️ 今日已签到` |
| 凭证过期 | `❌ 凭证失效 HTTP 401`，重新登录一次即可 |
| cron 时还没抓到凭证 | `❌ 未配置 · 缺少 Cookie` |
| WAF 变更 | `❌ WAF 挑战解析失败`，说明站点换了防护方案 |
| 网络失败 | `❌ 网络错误` / `❌ 签到请求失败` |

## 抓不到凭证时

- 确认 MitM 开启、证书已信任；
- 确认访问的是 `anyrouter.top`（HTTPS），并且页面确实发起了 `/api/user/self` 之类的请求；
- 仍然不行就手动填 `session`：Safari 开发者工具或 Loon 的请求记录里复制 `Cookie` 里 `session=` 的那一段。

## 已知限制

- 只做了签到 + 余额查询，不涉及 API 调用。
- 站点若把 WAF 从阿里云换成别的方案（Cloudflare、EdgeOne 自研挑战），脚本的 eval 办法会失效，需要重写解法。
- 未在真机跑过真实账号（没有你的 session），401 链路已本地验证；首次使用请手动点一次 cron 确认通知。
