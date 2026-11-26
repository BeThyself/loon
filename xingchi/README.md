# 星驰 API 登录签到（Loon）

迁移自 [ZHT0711/xingchi-api-loon-egern](https://github.com/ZHT0711/xingchi-api-loon-egern)，上游固定版本 `e8ec098a1ee379313276b959b2ba098423ff441a`。仅迁移 Loon 插件；配套 JS 与该版本逐字节一致，不包含 Egern 模块，也不自动跟随上游更新。

## 安装

适用于 **Loon 3.5.1(988)+**。在 Loon → 配置 → 插件 → 添加，粘贴：

```text
https://raw.githubusercontent.com/BeThyself/loon/main/xingchi/xingchi.loon.lpx
```

1. 启用插件和 MITM，安装并信任 Loon 的 HTTPS 解密证书；解密域名仅为 `xingchiapi.com`。
2. 在手机浏览器正常登录星驰并打开仪表盘，人工完成验证码；首次可退出再登录，以捕获完整 Access / Refresh Token。
3. 收到“登录信息已获取”后，可在 Loon 脚本页运行“星驰 API 每日登录签到”。默认每天**手机本地时间 09:00**运行，站点签到日期按 `Asia/Shanghai` 查询。
4. 若只有“已获取临时登录状态”，尚不代表完整刷新凭证已保存；重新登录或等待网页刷新捕获后再运行。

插件自动下载本目录的 `xingchi.loon.js`，三处脚本引用均指向本仓库，不再加载上游 JS。若已装上游版本，先停用或删除旧插件，避免两份定时任务重复运行。更新 `.lpx` 配置需手动更新或重新导入；远程 JS 有缓存，修改后需停用再启用插件以重新加载。

## 参数

| 参数 | 默认值 | 说明 |
|---|---|---|
| `action` | `checkin` | `checkin`：验证/必要时刷新并签到；`login`：只验证/必要时刷新并查余额；`clear`：清除脚本本地会话 |
| `access_token` | 空 | 通常留空，使用自动捕获；需要时可手动导入 |
| `refresh_token` | 空 | 手动导入时配对填写，以支持后续刷新 |
| `debug` | 关闭 | 仅输出接口路径与运行状态，不输出令牌 |

每份安装保存一个账户，重新登录其他账户会更新本地会话。`clear` 清除脚本存储但不会删除插件设置中手填的 Token；如需完整移除凭证，请同时清空这两个设置，之后将 `action` 改回 `checkin`。不要将 Token 填进公开文件、截图或聊天。

## 行为与注意事项

- 捕获与定时任务都在 Loon 本地运行，没有新增服务器接收端。Token 保存在本机脚本存储/设置中。
- 网络请求固定发往 `https://xingchiapi.com/api/v1`，验证 TLS，禁用自动跳转和自动 Cookie；不会自动处理登录验证码。
- 使用 `/auth/refresh` 刷新并保存轮换后的令牌，再查询 `/user/checkin` 和领取签到；已签到不重复领取。
- 刷新会轮换 Refresh Token，浏览器保留的旧会话可能需要重新登录。运行中检测到会话变化会停止，不覆盖新捕获。
- 原样保留上游异常处理：网络故障保留会话，刷新明确返回 400/401 时清除旧会话并提示重登；429 不进行无限重试。
- 通知沿用上游“星驰 API”标题及状态副标题。签到会改变网站当日签到状态和额度；本次迁移未执行任何真实账号请求或签到。

## 文件与验证

- `xingchi.loon.lpx`：插件配置，署名 `thyself`，脚本地址指向本仓库。
- `xingchi.loon.js`：上游业务脚本，保持原样。
- `THIRD_PARTY_LICENSE.txt`：上游附带的第三方 MIT 许可，原样保留。
- `tests/xingchi.test.mjs`：从上游回归测试提取 Loon 业务/适配器部分，直接加载本目录脚本，增加托管路径、署名、定时及域名边界检查；无需 npm 依赖。

本地检查命令（Node.js 20+、Python 3）：

```sh
node --check xingchi/xingchi.loon.js
node --test xingchi/tests/xingchi.test.mjs
python3 /var/minis/skills/loon-dev/scripts/loon_lint.py xingchi/xingchi.loon.lpx
```

模拟测试不调用真实站点，不能替代 iPhone Loon 真机、真实账号和隔日自然签到验证。本次未验证这些运行结果，不承诺长期续期稳定性。

## 来源与致谢

- 上游：[ZHT0711/xingchi-api-loon-egern](https://github.com/ZHT0711/xingchi-api-loon-egern/tree/e8ec098a1ee379313276b959b2ba098423ff441a)，原插件头署名 `Codex`。
- 上游脚本注明参考 [@773075692/agentrouter-checkin](https://github.com/773075692/agentrouter-checkin) 与 [MaYIHEI/paperclip](https://github.com/MaYIHEI/paperclip) 的 AgentRouter 签到流程。
- 第三方版权与许可见 [THIRD_PARTY_LICENSE.txt](THIRD_PARTY_LICENSE.txt)，本仓库署名不替代上游版权。
