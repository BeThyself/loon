/*
 * RunAnyTime (runanytime.hxi.me) 登录态抓取 → 投递到自建服务器
 *
 * v5 · 2026-11-25
 *  站点不用 Cookie 登录：前端把 access token（JWT，仅 15 分钟）和会话 ID（sid）
 *  存在 localStorage 里，sid 通过 X-Auth-Session 请求头发给后端，
 *  POST /api/user/auth/refresh 就靠这个头换新的 access token。
 *  Loon 读不到 localStorage，但抓得到请求头：
 *    sid      ← X-Auth-Session
 *    token    ← Authorization: Bearer
 *    cookie   ← Cookie（只有 cf_clearance，Cloudflare 用）
 *  服务器拿 sid 就能随时换新 token，定时签到才可能跑通。
 *
 *  去重：sid 变了才投递；同一 sid 反复访问不重复推、不重复签到。
 *
 * v6 · 再加一条 response 规则抓 /api/user/auth/refresh 的回包：
 *  回包里的 data.session.sid 才是刷新用的真会话 ID（JWT 里的 sid 不是），
 *  data.access_token 是新的短期 token。拿到 sid 后服务器就能自己换 token。
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
var VERSION = "v6";
var K_LAST = "runanytime_last_session";
var K_UID = "runanytime_uid";
var K_NOTIFIED = "runanytime_notified_at";
var K_SEEN = "runanytime_seen";

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

function deliver(payload, done) {
  $httpClient.post(
    {
      url: EP,
      headers: { "Content-Type": "application/json", "X-Token": TOKEN },
      body: JSON.stringify(payload),
      timeout: 60000,
      "auto-cookie": false,
      "auto-redirect": true
    },
    function (err, resp, data) {
      if (err) {
        notify("❌ 投递失败", String(err));
        return done();
      }
      var j = null;
      try { j = JSON.parse(data); } catch (e) {}
      if (!j || !j.ok) {
        notify("❌ 服务器拒绝", (j && j.error) || String(data).slice(0, 200));
        return done();
      }
      if (j.skipped) return done();
      var log = String(j.log || j.note || j.error || "").replace(/\*\*/g, "");
      notify(j.code === 0 ? "✅ 已投递并签到成功" : "ℹ️ 已投递（签到未成功）", log);
      done();
    }
  );
}

if (typeof $response !== "undefined" && $response) {
  // 响应分支：抓 /api/user/auth/refresh 的回包
  if (!EP || !TOKEN) {
    $done({});
  } else {
    var body = typeof $response.body === "string" ? $response.body : "";
    var j = null;
    try { j = JSON.parse(body); } catch (e) {}
    var d = j && j.success && j.data ? j.data : null;
    var sid2 = d && d.session && typeof d.session.sid === "string" ? d.session.sid : "";
    var tok2 = d && typeof d.access_token === "string" ? d.access_token : "";
    var uid2 = d && d.user && d.user.id ? String(d.user.id) : "";
    if (!sid2) {
      $done({});
    } else {
      var key2 = "sid:" + sid2;
      var last2 = $persistentStore.read(K_LAST) || "";
      if (key2 === last2 && !tok2) {
        $done({});
      } else {
        $persistentStore.write(key2, K_LAST);
        if (uid2) $persistentStore.write(uid2, K_UID);
        deliver(
          {
            cookie: hget($request && $request.headers ? $request.headers : {}, "Cookie") || "",
            token: tok2,
            uid: uid2 || $persistentStore.read(K_UID) || "",
            sid: sid2
          },
          function () { $done({}); }
        );
      }
    }
  }
} else if (typeof $request !== "undefined" && $request) {
  var headers = $request.headers || {};
  if (!EP || !TOKEN) {
    notify("❌ 未配置", "插件参数 hook / token 为空");
    $done({});
  } else {
    var ck = hget(headers, "Cookie");
    var auth = hget(headers, "Authorization");
    var uid = hget(headers, "New-Api-User");
    var sid = hget(headers, "X-Auth-Session");
    var ses = sessionOf(ck);
    var bearer = String(auth || "").replace(/^Bearer\s+/i, "");

    // 没有 sid、没有会话 Cookie、也没有 Bearer：静态资源或未登录，忽略
    if (!sid && !ses && !bearer) {
      $done({});
    } else {
      var key = sid ? "sid:" + sid : (ses ? "s:" + ses : "b:" + bearer);
      var last = $persistentStore.read(K_LAST) || "";
      if (key === last) {
        $done({});
      } else {
        $persistentStore.write(key, K_LAST);
        if (uid) $persistentStore.write(String(uid), K_UID);
        deliver(
          {
            cookie: ck || "",
            token: bearer || "",
            uid: uid || $persistentStore.read(K_UID) || "",
            sid: sid || ""
          },
          function () { $done({}); }
        );
      }
    }
  }
} else {
  // 手动自检（Loon 脚本列表里点「RunAnyTime 自检」）
  if (!EP || !TOKEN) {
    notify("❌ 未配置", "插件参数 hook / token 为空");
    $done();
  } else {
    $httpClient.get(
      {
        url: EP,
        headers: { "X-Token": TOKEN },
        timeout: 15000,
        "auto-cookie": false
      },
      function (err, resp, data) {
        if (err) {
          notify("❌ 连不上服务器", VERSION + " · " + String(err));
          return $done();
        }
        var st = resp && resp.status ? resp.status : 0;
        var seen = $persistentStore.read(K_LAST) || "（还没抓到过）";
        notify("✅ 脚本已加载 " + VERSION,
               "服务器 HTTP " + st + " · 已抓到: " + String(seen).slice(0, 40));
        $done();
      }
    );
  }
}
