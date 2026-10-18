# 微博净化（Loon 版）

微博 App 去广告、精简界面。原版是 [@ddgksf2013 墨鱼手记](https://ddgksf2013.top/) 的 **QuantumultX** 远程重写
（`WeiboEnhanced.conf`，V0.1.21 / 2026-10-12），这里是**段落格式转换**后的 Loon 插件 —— **JS 未做任何改动**，
仍从作者 CDN 拉取 `weibo_json.js`，所以脚本本身会自动跟随作者更新。

## 导入

```
loon://import?plugin=<本仓库 weibo/WeiboEnhanced.plugin 的 raw 地址，URL 编码>
```

备用形式：`https://www.nsloon.com/openloon/import?plugin=<encoded>`

## 转换做了什么

| QuantumultX | Loon |
|---|---|
| `hostname = api.weibo.cn, …` | `[MitM] hostname = …` |
| `url script-echo-response` | `http-request … requires-body=true`（脚本返回 `response` 即不透传上游） |
| `url script-analyze-echo-response` | `http-request … requires-body=true`（脚本要读请求体） |
| `url script-response-body` | `http-response … requires-body=true` |

脚本自带宿主探测：没有 `$prefs`/`$task` 时走 `$persistentStore` + `$httpClient`，`$done` 也会自动切成
Loon 的 `{response:{status,headers,body}}` 格式，因此无需改 JS。

小改一处：原正则末尾的 `(?=[?#]|$)` 含裸 `#`，Loon 配置里可能被当作行内注释截断，改为 `(?=[?\x23]|$)`，语义不变。

## 设置页

开启 MITM 与插件后，Safari 打开：

```
https://api.weibo.cn/__qx_weibo_settings__/
```

可逐项开关要精简的模块、调试开关、开屏图来源等。**只有开着代理和 MITM 时这个页面才能打开**，它不请求真实服务器。

## 注意

- 规则清单是转换时的快照。作者如果新增了接口，需要重新转换；`script-path` 指向他的 CDN，脚本逻辑则自动跟随。
- 需要 iOS 上信任 Loon 的根证书，且 `api.weibo.cn` / `bootpreload.uve.weibo.com` / `wbapp.uve.weibo.com` 在 MITM 名单里（插件会自动加入）。
- 如果同时装了其它微博相关插件（如微博国际版去广告），注意 `http-response` 每个 URL 只跑第一条命中的规则，可能互相抢。

## 来源 / 致谢

- 原作者：[@ddgksf2013](https://github.com/ddgksf2013)（墨鱼手记 / 墨鱼去广告计划），原配置与脚本版权归其所有。
- 原配置：`https://ddgksf2013.top/rewrite/WeiboEnhanced.conf`
- 上游贡献者（原作者标注）：@zmqcherish
