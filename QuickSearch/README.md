# 快捷搜索 Pro（QuickSearch.lpx）

在 Safari 里用「命令 + 关键词」直接切换搜索引擎，并在**已装 App 的应用内**发起搜索。

以 [可莉 · 快捷搜索](https://kelee.one/Tool/Loon/Lpx/QuickSearch.lpx) 为基准，保留其全部 7 条命令，
新增 7 条命令（京东 / 淘宝 / 拼多多 / B站 / YouTube / 微信 / 电报），并给原有命令补上了「关键词在前」的语序。

## 安装

Loon → 插件 → 右上角 `+` → 从 URL 添加：

```
https://raw.githubusercontent.com/BeThyself/loon/main/QuickSearch/QuickSearch.lpx
```

一键导入：

```
loon://import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2FBeThyself%2Floon%2Fmain%2FQuickSearch%2FQuickSearch.lpx
```

安装后：

1. **设置 → Safari → 搜索引擎 → DuckDuckGo**（不改的话规则永远匹配不到）
2. Loon 里打开该插件，并确认 **MitM 已开启、证书已信任**（插件已声明 `hostname=duckduckgo.com`）
3. Safari 地址栏输入「命令 空格 关键词」或「关键词 空格 命令」，回车

> 302/307 是 Loon 在本地 MitM 之后直接返回的，**不会真的去访问 DuckDuckGo**，所以 DuckDuckGo 通不通都不影响使用。

## 命令表

| 命令 | 目标 | 位置 |
|---|---|---|
| `bd` | 百度 | 网页 |
| `bdimg` | 百度图片 | 网页 |
| `gimg` | Google 图片 | 网页 |
| `b` | 必应 | 网页 |
| `wk` | 中文维基 | 网页 |
| `qm` | 七麦数据（查 App） | 网页 |
| `gh` | GitHub | 网页 |
| **`jd`** | **京东** | **App 内搜索** |
| **`tb`** | **淘宝** | **App 内搜索** |
| **`pdd`** | **拼多多** | **App 内搜索** |
| **`bli`** | **哔哩哔哩** | **App 内搜索** |
| **`yt`** | **YouTube** | **App 内搜索** |
| `wx` | 微信（搜狗微信网页版） | 网页 |
| `tg` | 电报 | 仅唤起 App |
| （无命令） | Google | 网页 |

例：`jd 电动牙刷`、`蓝牙耳机 tb`、`bli 孤独摇滚`、`gh loon plugin`

## 跳 App 的实现与限制

| 命令 | Scheme | 能否带关键词 |
|---|---|---|
| jd | `openapp.jdmobile://virtual?params={"des":"productList","keyWord":"…","from":"search","category":"jump"}` | ✅ |
| tb | `taobao://s.taobao.com?q=…` | ✅ |
| pdd | `pinduoduo://com.xunmeng.pinduoduo/search_result.html?search_key=…` | ✅ |
| bli | `bilibili://search?keyword=…` | ✅ |
| yt | `youtube://results?search_query=…` | ✅ |
| wx | 无可用深链 → 走 `weixin.sogou.com` 网页 | ❌ |
| tg | 只支持 `tg://` 唤起 App | ❌ |

**关于微信**：微信没有对外公开的、能带关键词的搜索 URL Scheme。
社区里流传的 `weixin://dl/search?keyword=` 没有任何可验证的落地记录，所以我没做成默认行为。
如果你只想「至少跳到微信 App」，把插件里 `wx` 那两行注释掉、改用下面这行即可（关键词会被忽略）：

```
request if ${url} ~= /^https:\/\/duckduckgo\.com\/\?q=wx\+/i then redirect(307, "weixin://")
```

**关于电报**：`tg://search?query=关键词` 只在 **Telegram Android** 存在
（源码 `DrKLO/Telegram` 的 `LaunchActivity.java` 里有 `tg:search` 分支）。
**iOS 版没有**——Telegram iOS 的 `tg://` host 白名单是
`localpeer / join / addstickers / addemoji / invoice / setlanguage / msg / msg_url / webproxy / socks / proxy / passport / oauth / resolve`
（源码 `submodules/TelegramUI/Sources/OpenUrl.swift`），里面没有 `search`。
所以 `tg` 命令只能唤起 App，关键词带不过去。

## 与可莉原版的差异

- 原版 7 条命令**文本原样保留**，只额外补了「关键词在前」的语序（如 `蓝牙耳机 tb`）。
- 默认规则（无命令走 Google）改成带**前后双向负向预查**，避免把带命令的请求吃掉。
- 全部规则使用 Loon 新版 Rewrite 语法（`request if … then redirect(307, …)`），需要 **Loon ≥ 3.5.1 (978)**。

## 已知问题

- **首次跳 App 时 iOS 可能弹一次「在"淘宝"中打开？」**，这是系统的自定义 scheme 确认，属正常现象。
- 通过 307 转给 App 的关键词是**百分号编码**形式（如 `%E6%89%8B%E6%9C%BA`），
  由 App 侧自行解码；主流 App 均正常。若某个 App 显示成乱码，说明它没解码，那个命令就只能走网页版。
- 京东/淘宝/拼多多/B站/YouTube 的 scheme 属于各家私有协议，**官方随时可能改**；失效的话换回网页版即可。

## 许可与致谢

- 基底与命令设计来自 [可莉 Kelee](https://kelee.one)（[源插件](https://kelee.one/Tool/Loon/Lpx/QuickSearch.lpx)）。
- 本文档中的 scheme 取自多个公开来源交叉验证：`JamesHopbourn/Apple-Automation`、`torappinfo/uweb`、
  `lulululbj/Direct`、`Tartarus2014/Loon-Script`。
