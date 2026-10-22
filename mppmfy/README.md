# 麦片屏幕翻译 会员解锁（Loon 版）

「麦片屏幕翻译」的会员信息接口改写插件。原版是 [@ddm1023](https://github.com/chxm1023/Rewrite) 的
QuantumultX 脚本 [`mppmfy.js`](https://github.com/chxm1023/Rewrite/blob/main/mppmfy.js)，这里转成 Loon 插件格式，
脚本由本仓库托管（不依赖作者 CDN，作者删库也不影响）。

## 导入

```
loon://import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2FBeThyself%2Floon%2Fmain%2Fmppmfy%2FMaipianVIP.plugin
```

或手动添加：`https://raw.githubusercontent.com/BeThyself/loon/main/mppmfy/MaipianVIP.plugin`

导入后确认 MitM 已开启（`youxifanyizhushou.com` 会自动加进 hostname），然后**杀掉麦片 App 重开**。

## 拦截的接口

| 方法 | URL | 处理 |
|---|---|---|
| GET | `https://youxifanyizhushou.com/ios/api/product/user/remain/ios` | response Script 改写 |

## 改写逻辑

原脚本只做一件事：把 `data` 整个替换成

```json
[{ "infinite": true, "productPayType": 1, "times": 9999, "level": 3,
   "desc": "高级订阅", "expireTime": "2099-09-09 09:09:09" }]
```

本版在此基础上补了两处：

1. **非 JSON / 空响应直接放行。** 原脚本无条件 `JSON.parse`，遇到 5xx HTML 或空 body 会抛异常，
   Loon 里表现为一条脚本错误日志。现在解析失败就 `$done({})` 交给原样返回。
2. **修正状态码。** 实测未登录时接口返回

   ```json
   {"code":401,"error":"用户未登录!"}
   ```

   光塞 `data` 而 `code` 还是 401，客户端大概率仍按未登录/无会员走。
   所以原 `code` 不是 `0`/`200` 时，改成 `200` 并删掉 `error` / `msg` / `message` / `errmsg` 等错误文案；
   其余字段（含 `msg: "ok"` 这种正常提示）原样保留。

## 已知限制

- **纯本地展示**：只改客户端看到的会员状态。翻译请求若走服务端鉴权，服务器仍会按真实额度扣减或拒绝，
  这不是本插件能解决的（原脚本同理）。
- 接口返回结构是 2026-10 的快照。App 若改成在别的接口下发权益（例如新增 `/vip/status`），需要再补一条规则。
- `times: 9999` 是原脚本给的值，不是无限；如果 App 显示"剩余 9999 次"属于正常。
- 未实测真机运行（无该 App 的登录态账号可抓包），逻辑按接口实际返回的 `code:401` 结构编写。

## 文件

| 文件 | 说明 |
|---|---|
| `MaipianVIP.plugin` | Loon 插件，可直接导入 |
| `mppmfy.response.js` | 改写脚本（本仓库托管，插件里引用 raw 地址） |

## 来源 / 致谢

- 原作者：[@ddm1023](https://github.com/chxm1023)（Telegram 频道 `@ddm1023`），原脚本版权归其所有。
- 原脚本：`https://raw.githubusercontent.com/chxm1023/Rewrite/main/mppmfy.js`（2026-10-18 版）
- 原脚本声明：仅供参考，禁止转载与售卖 —— 本仓库仅作个人自用的格式转换，未做再分发售卖。
