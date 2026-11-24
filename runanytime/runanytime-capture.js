/*
 * RunAnyTime (runanytime.hxi.me) Cookie 抓取 → 投递到自建服务器
 *
 * 站点登录要 Turnstile，脚本不做登录；这里只负责：
 *   1. 手机浏览器登录后，抓到请求头里的 Cookie + New-Api-User
 *   2. 只在 session 变化时 POST 到服务器
 *   3. 服务器写入配置、立刻试跑签到，把结果回给通知
 */

function argOf(name) {
  var a = typeof $argument === "undefined" ? null : $argument;
  if (!a) return "";
  if (typeof a === "object") {
    var v = a[name];
    return v === undefined || v === null ? "" : String(v);
  }
  var parts = String(a).split("&");
  for (var i = 0; i < parts.length; i++) {
    var idx = parts[i].indexOf("=");
    if (idx > 0 && parts[i].slice(0, idx) === name) return parts[i].slice(idx + 1);
  }
  return "";
}

var EP = argOf("hook");
var TOKEN = argOf("token");
var K_LAST = "runanytime_last_session";
var K_UID = "runanytime_uid";

function hget(h, name) {
  if (!h) return "";
  var low = name.toLowerCase();
  for (var k in h) {
    if (Object.prototype.hasOwnProperty.call(h, k) && k.toLowerCase() === low) return String(h[k]);
  }
  return "";
}

function sessionOf(ck) {
  var m = String(ck || "").match(/(?:^|;\s*)session=([^;]*)/);
  return m ? m[1] : "";
}

function notify(title, body) {
  $notification.post("RunAnyTime " + title, "", String(body || "").slice(0, 400));
}

if (typeof $request !== "undefined" && $request) {
  var headers = $request.headers || {};
  if (!EP || !TOKEN) {
    notify("❌ 未配置", "请在插件参数里填 hook 与 token");
    $done({});
  } else {
  var ck = hget(headers, "Cookie");
  var uid = hget(headers, "New-Api-User");
  var ses = sessionOf(ck);

  if (!ses) {
    $done({});
  } else {
    var last = $persistentStore.read(K_LAST) || "";
    if (ses === last) {
      // 同一个登录态，不重复投递
      $done({});
    } else {
      $persistentStore.write(ses, K_LAST);
      if (uid) $persistentStore.write(String(uid), K_UID);
      $httpClient.post(
        {
          url: EP,
          headers: { "Content-Type": "application/json", "X-Token": TOKEN },
          body: JSON.stringify({ cookie: ck, uid: uid || $persistentStore.read(K_UID) || "" }),
          timeout: 60000,
          "auto-cookie": false,
          "auto-redirect": true
        },
        function (err, resp, data) {
          if (err) {
            notify("❌ 投递失败", String(err));
            return $done({});
          }
          var j = null;
          try { j = JSON.parse(data); } catch (e) {}
          if (!j || !j.ok) {
            notify("❌ 服务器拒绝", (j && j.error) || String(data).slice(0, 200));
            return $done({});
          }
          var log = String(j.log || j.note || j.error || "").replace(/\*\*/g, "");
          notify(j.code === 0 ? "✅ 已投递并签到成功" : "ℹ️ Cookie 已投递", log);
          $done({});
        }
      );
    }
  }
  }
} else {
  $done({});
}
