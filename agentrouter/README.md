# AgentRouter 每日签到（Loon）

基于 [ddgksf2013/agentrouter_checkin.js](https://github.com/ddgksf2013/Scripts) 改造，新增 **Cookie 模式**与 WAF 判读。

## 为什么会报「登录接口返回 HTML（HTTP 200）」

2026-11-24 起，agentrouter.org 全站（含 `/api/status`、`/api/user/login`）都挂到了阿里云 WAF 的**交互式验证码**后面：

```html
<meta name="aliyun_waf_aa" content="...">
<meta name="aliyun_waf_bb" content="...">
<script src=".../AliyunCaptcha.js"></script>
```

这和 anyrouter 那种「解个 JS 算法拿到 cookie」不一样：AA/BB 是点到点的风险验证，需要真实浏览器跑 AliyunCaptcha.js，纯 HTTP 请求无论如何构造都拿不到放行 token。原脚本只把这种情况笼统报成「返回 HTML」，所以看不出原因。

**能做的只有两条路：**

1. 用浏览器已经拿到放行凭证的那份 **Cookie**（含 `session=`），脚本带上去请求 —— 这也是新增的 Cookie 模式
2. 换一个没被风控的出口 IP（比如自建服务器），密码模式可能直接过

## 两种模式

| 模式 | 条件 | 说明 |
|---|---|---|
| 账号密码 | `AGENTROUTER_ACCOUNTS` / `AGENTROUTER_ACCOUNT` | 原逻辑，登录即签到；被验证码拦时会在通知里明说 |
| Cookie | 插件 `cookie` 参数，或浏览器访问后自动抓取 | 跳过登录，直接 `POST /api/user/sign_in`，再读 `/api/user/self` 拿余额 |

开了 `prefer_cookie` 就强制只走 Cookie 模式。

## 安装

1. Loon → 配置 → 插件 → 添加：
   `https://raw.githubusercontent.com/BeThyself/loon/main/agentrouter/agentrouter-checkin.lpx`
2. 打开 MitM（插件已声明 `hostname = agentrouter.org`）
3. 手机上用浏览器打开 `agentrouter.org` 并登录一次 → 会弹 `✅ 已抓取凭证`
4. 打开插件参数，把「优先 Cookie 模式」打开 → 手动跑一次「AgentRouter 手动签到」验证

不想开 MitM 也行：手动把浏览器里的 Cookie（含 `session=...`）粘到插件的 `cookie` 参数。

## 参数

| 参数 | 作用 |
|---|---|
| `cookie` | 浏览器 Cookie，留空则用密码模式 |
| `uid` | `New-Api-User`，可留空（脚本会从 `/api/user/self` 取） |
| `prefer_cookie` | 开启后只走 Cookie 模式 |
| `base_url` | 默认 `https://agentrouter.org` |
| `verify_log` | 是否查询当天签到日志核验（默认开） |
| `policy` | 可选，Loon 策略组名 |

多账号仍走持久化键：

```json
AGENTROUTER_ACCOUNTS = [{"name":"甲","account":"a@x.com#pwd"},{"name":"乙","account":"b@x.com#pwd"}]
```

## 通知

| 场景 | 内容 |
|---|---|
| 抓到登录态 | `✅ 已抓取凭证` |
| 签到成功 | `✅ 签到成功` + 服务端文案 + 余额/已用 |
| 今日已签 | `ℹ️` 文案里带「已签到」 |
| Cookie 过期 | `❌ Cookie 已失效（HTTP 401/403）` |
| 被验证码拦 | `❌ …被阿里云 WAF 验证码拦截`，并提示改用 Cookie 模式 |
| 密码错误 | `❌ 登录失败: …` |

## 已知限制

- 交互式验证码没法用脚本过，只能借用浏览器 Cookie；Cookie 过期后要重新登录一次。
- Cookie 模式只有单账号（一份 Cookie 对应一个登录态）；多账号仍建议密码模式，或分别部署。
- 未在真机跑过真实账号，联调用本地假站点验证了 Cookie / 密码 / 验证码三条路径。

## 来源

原始脚本：[ddgksf2013/Scripts · agentrouter_checkin.js](https://github.com/ddgksf2013/Scripts/blob/master/agentrouter_checkin.js)（Loon / Surge / QX / Node 四端兼容框架）。
本仓库版本改动：Cookie 模式、浏览器化请求头、验证码判读、Loon 插件参数支持、抓取凭证入口。
