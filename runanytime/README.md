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

## 这个站的登录态是什么（v6）

站点不用 Cookie 登录，前端把两样东西放在 localStorage：

- **access token**：JWT，**只活 15 分钟**
- **sid**（会话 ID）：刷新接口 `POST /api/user/auth/refresh` 用它换新 token，没有 body，sid 放在 `X-Auth-Session` 请求头里

Loon 读不到 localStorage，所以按两条路抓：

| 规则 | 抓什么 | 用途 |
|---|---|---|
| `request` | `Authorization: Bearer`、`Cookie`、`X-Auth-Session` | 拿到当前可用的短期 token，立刻能签到 |
| `response`（`/api/user/auth/refresh`） | 回包里的 `data.session.sid` + `data.access_token` | 拿到**真正的会话 ID**，服务器可自行续期 |

**注意**：JWT 里的 `sid` 声明不可用于刷新（实测拿它请求一律 401），只有登录/刷新响应里的 `session.sid` 才行。

## 通知含义

| 通知 | 含义 |
|---|---|
| `✅ 已投递并签到成功` | Cookie 已存，服务器签到成功（带余额） |
| `ℹ️ Cookie 已投递` | Cookie 已存，但签到失败（日志里看原因） |
| `❌ 投递失败` | 网络问题，服务器不可达 |
| `❌ 服务器拒绝` | hook/token 不对，或 Cookie 里没有 session |
| `❌ 未配置` | 插件参数没填 |

## 去重（v7）

登录态没变就**完全不发请求、不发通知**：

- 客户端只看**两样东西是否变化**：短期 `token`、会话 `sid`；两个都没变直接退出；
- 非 sid 变更的投递有 **30 秒冷却**，避免一次页面加载连发多条；
- 服务器逐字段比对（只比这次带了值的字段），没变化回 `{"skipped":true}`；
- **当天已签到过**（`state.json` 记录的日期等于今天）就只存凭证，不重复跑签到、不弹通知；
- 服务器返回空 body / `{}` / `skipped` 一律静默。

## 已知限制

refresh 接口（`/api/user/auth/refresh`）**只在浏览器环境可用**：实测从服务器带真 sid、有效 token、`cf_clearance` 请求一律 `401 Unauthorized`，说明它绑了浏览器侧的东西。

所以定时签到**做不到**，只能做到「你打开站点 → 抓到新鲜 token（15 分钟）→ 服务器立刻签到」。当天签过之后不会再有通知。

## 安全

- 服务器端只接受 `POST /<暗号>/cookie`，且要 `X-Token` 匹配；只写 Cookie 与 uid 两个字段，不返回任何已有配置。
- 投递地址里的暗号与 token 只存在于插件参数，不在仓库里。
- Cookie 有效期约一个月，过期后重新登录一次即可。
