# 小黑盒签到（Loon）

小黑盒「每日签到」自动签到，签到一次领 20 H 币。

- 插件：`heybox-checkin.lpx`
- 脚本：`heybox.js`（[MaYIHEI/paperclip](https://github.com/MaYIHEI/paperclip/tree/main/app/heybox) 的镜像，逻辑未改动，仅把 `script()` 地址指向本仓库）
- 上游版本：`2026-10-28.r3`（SHA-256 `59e34d4f011737ac…`）

## 安装

1. Loon → 配置 → 插件 → 添加：

   ```
   https://raw.githubusercontent.com/BeThyself/loon/main/heybox/heybox-checkin.lpx
   ```

2. 一键导入：[loon://import?plugin=…](loon://import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2FBeThyself%2Floon%2Fmain%2Fheybox%2Fheybox-checkin.lpx)

3. 开启 MitM 并信任证书，hostname 只需 `api.xiaoheihe.cn`。

## 使用

1. 启用插件，打开小黑盒 App →「我的」→「签到」，停留 1 秒
2. 收到「✅ 小黑盒 Cookie 获取成功」即抓取成功，通知里 `device_id` / `pkey` 为打码显示
3. 到插件脚本列表手动跑一次「小黑盒签到」，确认当天结果
4. 之后每天 08:20 自动签到，通知内容为 `✅ 签到成功  💰 +20 H 币  连签 N 天`

## 通知

| 场景 | 标题 |
|---|---|
| 抓到 Cookie | ✅ 小黑盒 Cookie 获取成功 |
| 签到成功 | ✅ 签到成功 |
| 异步未确认 | ⏳ 签到已发起 |
| 登录态失效 | 🚫 登录失效 |
| 未抓 Cookie | 🚫 缺少 Cookie |
| 签到失败 | ❌ 签到失败 |

未开启 `merge`，每天单独一条通知。

## 注意

- 依赖 `raw.githubusercontent.com`，国内直连不通时脚本下载会失败，表现为定时任务静默不执行
- 本仓库托管脚本副本，因此**不会**跟随上游自动更新；上游改了接口需要手动同步 `heybox.js`
- 签到时间 `20 8 * * *`，想改直接编辑插件里的 cron
- 脚本只请求 `api.xiaoheihe.cn`，Cookie 仅存 Loon 本地存储

## 来源

脚本来自 [MaYIHEI/paperclip](https://github.com/MaYIHEI/paperclip) 的 `app/heybox`。
业务逻辑版权归原作者，本仓库仅做镜像与插件封装。
