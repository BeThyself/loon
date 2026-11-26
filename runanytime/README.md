# 随时跑路 · 刷新凭证捕获 v8

Loon 捕获 runanytime.hxi.me 成功认证响应中的刷新凭证，再投递到自建服务器。**接收端仍只保存，不自动刷新、不签到、不发 TG；独立服务器定时已于 2026-11-25 恢复，每天北京时间 09:02～09:12 自动续期并签到。隔日稳定性仍在观察。**

## 为什么旧版第二天失败

已确认 access token 是有效期 900 秒的 JWT。之前只保存 Bearer 与 `cf_clearance`，缺少长期刷新认证链。

2026-11-25 的无凭证刷新请求返回 401，并清除 `new_api_refresh`（`Path=/api/user/auth; HttpOnly; SameSite=Strict`）。前端刷新客户端启用 `withCredentials`，会自动携带匹配路径的 Cookie。历史日志中 auth 请求 Cookie 为 452 字节，普通 API 为 333 字节，接收端整条覆盖，可能丢失了 auth 专属 Cookie。**452 字节那份原始内容未保留，不能断言其差额必然是刷新 Cookie。**

更正之前不成立的描述：

- 没有证据证明服务器/IP/TLS 绑定，不能由残缺凭证的 401 得出“纯 HTTP 不可定时”。
- 前端 token/session 存模块内存，localStorage 在该认证模块仅保存 `user`。
- 没有证据证明 JWT sid 与响应 sid 是不同性质的秘密；sid 本身不等于完整刷新凭证。
- 刷新 Cookie 有效期尚未测得，不再写“约一个月”。

## v8 行为

1. 只处理本站成功登录、OAuth 或 `/api/user/auth/refresh` 响应，要求返回有效账号 ID、session.sid 和 access token。
2. 先读**响应** `Set-Cookie` 的 `new_api_refresh`；没有新值才使用该成功请求里的 Cookie。删除指令不回退到旧值。
3. 不抓普通请求，不因 Bearer 变化投递。以接收地址、账号、sid、刷新 Cookie 去重，投递确认后才记成功；同一待确认捕获短期合并。
4. 刷新 Cookie 轮换必须同步新值，但同账号捕获通知 12 小时内最多一条；换账号独立提示。
5. 服务器独立存刷新 Cookie，普通 Cookie 不能覆盖它；文件锁和原子写防止并发配置损坏。
6. `✅ 刷新凭证已保存` **不代表**续期或签到已成功。空回包、HTTP 异常不会伪装成成功。

## 安装/更新（本次必须更新插件规则）

先记下旧插件里的 `hook` 与 `token`，停用旧版（尤其不要两份并存），再用以下地址更新或重装：

[插件原始文件](https://raw.githubusercontent.com/BeThyself/loon/main/runanytime/runanytime-capture.lpx)

- 参数 `hook`：原来的 HTTPS 接收地址；`token`：原来的投递令牌，均不写进公开仓库。
- 开启 MITM 并信任证书，hostname 为 `runanytime.hxi.me`。
- 本版 JS 使用新的 `runanytime-capture-v8.js` 托管地址，以避开旧 URL 缓存；仓库源码仍叫 `runanytime-capture.js`。
- Safari 正常打开并刷新站点。若已登录，页面刷新会触发其认证恢复；仍抓不到再退出并正常重新登录、人工完成验证码。
- 捕获成功后可暂时关闭网页，避免浏览器与服务器同时使用可能一次性轮换的刷新 Cookie。
- Loon 脚本列表可点「随时跑路 v8 自检」查看服务器是否已经保存刷新 Cookie，不显示凭证原文。

**不需要把 Cookie、Bearer 或 token 粘贴到聊天中。**

## 验收标准

2026-11-25 已两次真实验证纯 HTTP 续期：18:40 主动刷新成功；18:59 在 access token 过期、self 返回 401 后，再刷新并查询账号成功，期间没有浏览器新投递。轮换 Cookie 与新 token 已落盘。

用户当天已手动签到，已按账号标记今日完成，避免启用 `Persistent=true` timer 后补跑。定时已应用户要求开启，首次隔日执行将在 **2026-11-26 北京时间约 09:08**；实际随机计划可用 `systemctl list-timers runanytime.timer` 查看。

每次执行先验证 access token；有效则直接签到，过期则尝试 refresh、落盘并验证后签到。刷新接口遇到 429 会遵守 `Retry-After`，没有该头时按 60 秒、180 秒有限退避，最多三次；401/403 或其他错误立即停止并按真实阶段通知，不会把刷新限流误报成登录态失效。无需手机打开网页或 Minis；但刷新凭证仍可能撤销，不能承诺永久有效。

2026-11-26：首次定时执行遇到 refresh HTTP 429，原通知错误显示为旧 self 的 401；随后以同一刷新凭证补跑成功，签到成功，余额从 $100 增至 $125。

后续验收/观察项目：

1. 成功捕获 `new_api_refresh`，服务器独立落盘。
2. 服务器主动刷新一次，立即保存响应 Cookie 轮换及新 access token，然后 `/api/user/self` 返回有效账号。
3. 等原 access token 过期后重新刷新，再验证账号；隔日再验长期稳定性。
4. 测试签到接口，返回成功或「今日已签到」均如实分类；按北京时间及账号记录去重。

浏览器和服务器共用会话可能互相轮换刷新 Cookie，失败后不要多次重试。若完整凭证仍失败，再研究会话撤销、Cookie 轮换冲突或环境绑定，而不是先假设原因。

## 安全与限制

- 接收端只监听回环地址，通过 HTTPS 反代访问；路径暗号与 `X-Token` 都要匹配。GET 自检同样鉴权。
- 不接受旧版 schema 的普通请求投递；限制请求体大小；配置权限 600。
- 不在日志、通知和 HTTP 回包里打印任何 Cookie、Bearer、sid 或投递令牌。
- 服务器默认 capture-only。`auth_probe.py` 是显式执行的验证工具，不由接收请求自动启动。
- Cookie jar 遵守域、路径、过期与 Set-Cookie 轮换，刷新成功后立即落盘，避免只更新内存。
- 捕获仍需要用户在浏览器登录、手工完成 Turnstile；不承诺刷新 Cookie 的长期有效性。

## 文件与测试

- `runanytime-capture.lpx`：Loon 参数、MITM、认证响应规则和自检入口。
- `runanytime-capture.js`：v8 客户端。
- `test_capture_v8.js`：Node 模拟测试（不访问真实账号）。
- `auth_store.py`：服务端凭证存储、文件锁和 Cookie jar。
- `auth_probe.py`：显式刷新与登录状态验证，不签到、不发 TG。
- `receiver.py`：capture-only 接收端。
- `checkin.py`：PoW 签到程序，定时关闭时不会自动运行。
- `test_auth_backend.py`、`test_auth_store.py`：服务端存储与认证回归测试。
- `test_http_v8.py`：真实本地 HTTP Cookie 轮换和路径测试。
- `test_receiver_v8.py`：接收端鉴权、去重及只保存行为测试。
- `test_receiver_edges.py`：残缺凭证、Cookie 注入与未来时间拒绝测试。
- `test_refresh_limits.py`：429 分类、Retry-After、有限退避和通知真实状态测试。

```sh
node --check runanytime-capture.js
node test_capture_v8.js
python3 -m unittest discover -v
python3 /var/minis/skills/loon-dev/scripts/loon_lint.py runanytime-capture.lpx
# 以下在已配置的服务器目录中显式执行；不会发起签到：
python3 auth_probe.py --verify
python3 auth_probe.py --refresh
```

## 来源与参考

- 站点公开前端认证模块与本账号历史脱敏日志。
- [Loon 官方脚本 API](https://nsloon.app/docs/Script/script_api)。
- [Python 3.8 CookieJar 文档](https://docs.python.org/3.8/library/http.cookiejar.html)。
- PoW 适配参考 [Auroraee/checkin-pilot](https://github.com/Auroraee/checkin-pilot)、[wangwingzero/sign-in](https://github.com/wangwingzero/sign-in)。
