# loon

自用 Loon 代理插件 / 脚本仓库。

所有 `script-path` 指向本仓库的 `raw.githubusercontent.com` 地址，方便直接导入 Loon，
并且可以按需打补丁，不受上游仓库更新影响。

## 目录

| 路径 | 说明 |
|---|---|
| `bili-theme/BiliTheme.lpx` | 哔哩主题插件（Loon 导入用），script-path 已指向本仓库 |
| `bili-theme/bili-theme.response.js` | 响应改写脚本（H5 注入 + 皮肤/加载动画/空间头图/开屏注入） |
| `bili-theme/bili-theme.panel.js` | 主题配置持久化 API（伪造 `/settings/theme/api/*`） |
| `bili-theme/README.md` | 注入原理与 Loon 兼容性分析笔记 |

## 安装（Loon）

1. Loon → 配置 → 插件 → 添加：
   `https://raw.githubusercontent.com/BeThyself/loon/main/bili-theme/BiliTheme.lpx`
2. 确保 MitM 已开启，且 hostname 含 `app.bilibili.com, www.bilibili.com`。
3. 重启哔哩哔哩 App。

## 上游

`bili-theme` 源自 [chaoscard/bili-theme](https://github.com/chaoscard/bili-theme)（v3.2.1），
本仓库为镜像 + 本地补丁，版权归原作者。
