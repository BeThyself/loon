# loon

自用 Loon 插件 / 脚本仓库。

## 目录

| 路径 | 说明 |
|---|---|
| `bili-theme/BiliTheme.lpx` | 哔哩主题插件（Loon 导入用），script-path 已指向本仓库 |
| `bili-theme/bili-theme.response.js` | 响应改写脚本（H5 注入 + 皮肤/加载动画/空间头图/开屏） |
| `bili-theme/bili-theme.api.js` | 主题配置持久化 API（伪造 `/settings/theme/api/*`） |
| `bili-theme/README.md` | 注入原理、开屏机制与已知行为 |
| `QuickSearch/QuickSearch.lpx` | Safari 快捷搜索（基于可莉原版扩展，含知乎/微博/京东/淘宝/拼多多/B站/YouTube App 内搜索） |
| `QuickSearch/README.md` | 命令表、App 跳转 scheme 与限制说明 |

## 安装（Loon）

1. Loon → 配置 → 插件 → 添加：
   `https://raw.githubusercontent.com/BeThyself/loon/main/bili-theme/BiliTheme.lpx`
2. 确保 MitM 已开启，hostname 含 `app.bilibili.com, www.bilibili.com`。
3. 重启哔哩哔哩 App。

## 来源

`bili-theme` v4.1.0，来自 [chaoscard/bili-theme](https://github.com/chaoscard/bili-theme)。
本仓库为镜像：脚本内容逐字节一致，仅 `script-path` 改指本仓库。
业务逻辑版权归原作者。
