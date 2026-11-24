# RunAnyTime 抓 Cookie（Loon）

配合服务器端 `/opt/runanytime/` 使用：手机浏览器登录 runanytime.hxi.me 后，Loon 抓到 Cookie 直接投递到你的服务器，服务器写入配置并立刻试跑签到，结果回到通知里。

## 为什么需要它

该站（随时跑路公益站）是 New-API + 私有 PoW 签到：
- 登录接口要 Turnstile，纯脚本无法登录
- 签到要 `SHA-256(prefix+nonce)` 前 difficulty 个 bit 为 0

所以拆成两段：登录用浏览器（人工过一次验证），签到放服务器（CPU 算 PoW 快）。

## 安装

1. Loon → 配置 → 插件 → 添加：
   `https://raw.githubusercontent.com/BeThyself/loon/main/runanytime/runanytime-capture.lpx`
2. 打开插件参数，填 `hook`（投递地址）和 `token`
3. 开 MitM（插件已声明 `hostname = runanytime.hxi.me`）
4. 用 Safari 打开 runanytime.hxi.me 登录（该站需要过一次 Turnstile）
5. 登录成功后通知：`✅ 已投递并签到成功` 或 `ℹ️ Cookie 已投递` + 服务器返回的日志

## 通知含义

| 通知 | 含义 |
|---|---|
| `✅ 已投递并签到成功` | Cookie 已存，服务器签到成功（带余额） |
| `ℹ️ Cookie 已投递` | Cookie 已存，但签到失败（日志里看原因） |
| `❌ 投递失败` | 网络问题，服务器不可达 |
| `❌ 服务器拒绝` | hook/token 不对，或 Cookie 里没有 session |
| `❌ 未配置` | 插件参数没填 |

## 去重（v4）

登录态没变就**完全不发请求、不发通知**：

- 客户端按 `session` 值判定（**不看**每次刷新都会变的 `Authorization: Bearer`），session 一样就什么都不做；
- 服务端再把收到的 Cookie / Bearer 归一化后与已存配置比对，一致则直接返回 `{"ok":true,"skipped":true}`，**不跑签到、不回日志、Loon 静默**。

所以同一个登录态反复访问网站不会刷屏；只有真的重新登录（session 变了）才会投递一次。

## 安全

- 服务器端只接受 `POST /<暗号>/cookie`，且要 `X-Token` 匹配；只写 Cookie 与 uid 两个字段，不返回任何已有配置。
- 投递地址里的暗号与 token 只存在于插件参数，不在仓库里。
- Cookie 有效期约一个月，过期后重新登录一次即可。
