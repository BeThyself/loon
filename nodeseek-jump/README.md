# NodeSeek 链接跳 NS Connect（Loon）

点 NodeSeek 帖子链接时不再落在网页，直接进 [NS Connect](https://github.com/tyrad/nodeseek)（NodeSeek 的第三方 iOS 客户端）。

## 为什么需要它

NS Connect 注册了 `nsconnect://` scheme，但没有 Universal Link：`nodeseek.entitlements` 里没有 `com.apple.developer.associated-domains`，站点根目录也没有 `apple-app-site-association`。所以系统层面点 `https://www.nodeseek.com/post-xxx` 只会开网页，不会进 App。

这个插件在 Loon 里把请求 302 到 App 深链：

| 网页 | 深链 |
|---|---|
| `https://www.nodeseek.com/post-139218` | `nsconnect://post/139218` |
| `https://www.nodeseek.com/post-139218-3` | `nsconnect://post/139218-3` |

Safari 收到 302 后会提示「在 NS Connect 中打开」。

## 前置条件

**App 必须支持 `nsconnect://post/...`。** 官方旧版本只认小组件的 `nsconnect://probe`，其它路径会被 `SceneDelegate` 丢弃，跳过去只会停在首页。

- 上游实现（PR）：[tyrad/nodeseek#19](https://github.com/tyrad/nodeseek/pull/19)
- 自测方法：Safari 地址栏直接输入 `nsconnect://post/139218`，能进帖子页就说明版本已支持

## 安装

1. Loon → 配置 → 插件 → 添加：
   `https://raw.githubusercontent.com/BeThyself/loon/main/nodeseek-jump/nodeseek-jump.lpx`
2. 打开 MitM，确认 Loon 根证书已安装并信任。插件已声明 `hostname = nodeseek.com, www.nodeseek.com`，证书不受信任时看不到 HTTPS 路径，规则永远不命中。
3. 要临时恢复网页打开，在 Loon 里停用该插件即可（脚本没有参数开关，避免条件不命中）。

## 排查

| 现象 | 原因 |
|---|---|
| 点链接完全没反应，还是网页 | MitM 没开 / 证书没信任 / 规则被 `ENABLED=false` 关掉 |
| 跳到 App 但停在首页 | App 版本还不支持 `nsconnect://post` |
| Safari 出现「无法打开页面」 | 系统拦了 302 到的未知 scheme，确认 App 已安装 |
| 楼层没定位 | 插件只带页码，楼层锚点交给 App 自己判断 |

## 来源与致谢

- 思路同常见的 Telegram 重定向插件（`t.me` → `tg://resolve`），只是换成 NS Connect 的 scheme。
- 深链格式与 App 侧实现见 [tyrad/nodeseek#19](https://github.com/tyrad/nodeseek/pull/19)。
