# NodeSeek 链接跳 NS Connect（Loon）

点 NodeSeek 帖子链接时不再落在网页，直接进 [NS Connect](https://github.com/tyrad/nodeseek)（NodeSeek 的第三方 iOS 客户端）。

## 为什么需要它

NS Connect 支持 `nsconnect://` scheme，但当时检查的 App 源码没有 Associated Domains entitlement，不能靠 Universal Link 接管帖子链接。站点 AASA 请求曾被 Cloudflare 拦截，不能据此断言文件不存在。插件改用网页 302 到自定义 scheme；需要实际已支持帖子深链的版本（v1.5.0+）。

这个插件在 Loon 里把请求 302 到 App 深链：

| 网页 | 深链 |
|---|---|
| `https://www.nodeseek.com/post-139218` | `nsconnect://post/139218` |
| `https://www.nodeseek.com/post-139218-3` | `nsconnect://post/139218-3` |

Safari 收到 302 后通常会提示「在 NS Connect 中打开」；其它内置浏览器可能限制自定义 scheme。

## 2026-11-26 防循环修复

旧规则只看 URL，App 自己抓取正文也会再次命中并收到 302，存在导致「帖子加载失败」的冲突。

源码中 `NodeSeekService.loadPostDetail` 请求帖子网页，`HiddenWebViewHTMLClient.get` 调用 `WebRequestFingerprint.applyHTMLHeaders`，固定设置站内 `Referer`。新版据此只对 **GET 且 Referer 缺失、为空或非 NodeSeek 站内** 的帖子请求跳转，带站内 Referer 的请求全部放行。判定域名含子域名和端口，不误把 `nodeseek.com.example.org` 当作站内。

| 场景 | 行为 |
|---|---|
| TG → Safari / 地址栏打开，Referer 缺失或非站内 | 302 到 NS Connect |
| NS Connect 加载正文，Referer 为 `https://www.nodeseek.com/` | 放行，正常请求站点 |
| Safari 在 NodeSeek 网页里站内翻帖，带站内 Referer | 保留网页，不强制跳 App |
| POST 或其它非 GET | 放行 |

这不是精确的 App 进程识别。若其他插件删除或改写 App 的 Referer，保护可能失效；某些浏览器携带站内 Referer 时会选择不跳转。宁可少跳一次，也不应阻断正文。App 自定义 UA 也包含 Safari，不能用 UA 简单区分。

已做本地条件/替换模拟和 Loon 静态校验；尚待用户真机验证「TG → Safari → App → 正文」完整链路。

## 前置条件

**App 必须支持 `nsconnect://post/...`。** 官方旧版本只认小组件的 `nsconnect://probe`，其它路径会被 `SceneDelegate` 丢弃，跳过去只会停在首页。

- 上游实现（PR）：[tyrad/nodeseek#19](https://github.com/tyrad/nodeseek/pull/19)
- 自测方法：Safari 地址栏直接输入 `nsconnect://post/139218`，能进帖子页就说明版本已支持

## 安装

1. Loon → 配置 → 插件 → 添加：
   `https://raw.githubusercontent.com/BeThyself/loon/main/nodeseek-jump/nodeseek-jump.lpx`
2. 打开 MitM，确认 Loon 根证书已安装并信任。插件已声明 `hostname = nodeseek.com, www.nodeseek.com`，证书不受信任时看不到 HTTPS 路径，规则永远不命中。
3. **更新现有安装时先手动更新插件配置**（不只是切换启用开关）；若界面没有更新入口，删除旧插件后按同一地址重新添加。确认描述出现「防循环版」、日期为 `2026-11-26`，规则中含 `Referer`。只保留一份，删除此前手动复制到本地复写的旧无条件规则。
4. 要临时恢复网页打开，在 Loon 里停用该插件即可。更新后回 TG 重点原链接，再确认 App 正文能加载、翻页正常。

## 排查

| 现象 | 原因 |
|---|---|
| 点链接仍是网页 | 插件未更新/未启用、MitM/证书问题，或请求带站内 Referer 被有意放行 |
| 跳到 App 但停在首页 | 检查已安装版本是否支持 `nsconnect://post`，不能仅凭 GitHub Release 判断 TF 已分发 |
| App 进了帖子页但加载失败 | 检查仍否存在旧无条件规则；Loon 中看 App 正文请求是否被重定向。新版应放行站内 Referer；若仍失败再查登录/站点验证/网络 |
| Safari 出现「无法打开页面」 | 确认 App 已安装及浏览器允许自定义 scheme |
| 楼层没定位 | 插件带帖子 ID 和页码，不主动传递 HTTP 请求不包含的 `#fragment` 楼层 |

## 本地静态回归

`test_rewrite.py` 用 Python 标准库读取本插件，模拟其限定的条件和替换语法；遇到未知语法报错，**不等于执行 Loon 原生引擎或完成真机测试**。

```sh
python3 nodeseek-jump/test_rewrite.py
```

覆盖外部/空 Referer、站内/子域名/端口 Referer、非 GET、页码与 query、相似恶意域名和非帖子 URL。另需用 `loon-dev` 的 `loon_lint.py` 校验插件语法。

## 来源与致谢

- 思路同常见的 Telegram 重定向插件（`t.me` → `tg://resolve`），只是换成 NS Connect 的 scheme。
- 深链格式与 App 侧实现见 [tyrad/nodeseek#19](https://github.com/tyrad/nodeseek/pull/19)。
