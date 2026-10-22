/*************************************
 * 麦片屏幕翻译 — 会员信息改写（Loon 版）
 *
 * 原始脚本：@ddm1023（https://github.com/chxm1023/Rewrite/blob/main/mppmfy.js）
 * 目标接口：GET https://youxifanyizhushou.com/ios/api/product/user/remain/ios
 *
 * 与原版的差异：
 *  1. 原脚本无条件 JSON.parse，遇到非 JSON / 空响应会抛异常并记一条错误；
 *     这里解析失败就原样放行（$done({})），不阻断 App 的请求。
 *  2. 原脚本只把 data 换成会员结构。但未登录时接口返回
 *     {"code":401,"error":"用户未登录!"}，code 不动的话客户端多半仍判未登录，
 *     所以这里在原 code 不是 0 / 200 时把 code 一并改成 200，并清掉错误文案。
 *  3. 其余字段（msg 等）原样保留。
 *************************************/

/* 改写后的会员数据结构，字段与原脚本一致：永久、无限次、3 级 */
var ACCESS = {
  infinite: true,
  productPayType: 1,
  times: 9999,
  level: 3,
  desc: "高级订阅",
  expireTime: "2099-09-09 09:09:09",
};

function passThrough(reason) {
  if (reason) console.log("[麦片] " + reason + "，放行");
  $done({});
}

(function () {
  var body = $response && $response.body;

  /* 没拿到 body（未开 requires_body / 空响应）就别动它 */
  if (typeof body !== "string" || body.length === 0) {
    return passThrough("无响应体");
  }

  var json;
  try {
    json = JSON.parse(body);
  } catch (e) {
    return passThrough("响应不是 JSON");
  }

  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return passThrough("响应不是对象");
  }

  /* 只动 data，其余字段原样保留 */
  json.data = [Object.assign({}, ACCESS)];

  var code = Number(json.code);
  if (code !== 0 && code !== 200) {
    json.code = 200;
    delete json.error;
    delete json.errmsg;
    delete json.msg;
    delete json.message;
    if (typeof json.info === "string" && /登录|会员|订阅/.test(json.info)) delete json.info;
  }

  $done({ body: JSON.stringify(json) });
})();
