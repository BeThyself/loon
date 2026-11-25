/*
 * RunAnyTime (runanytime.hxi.me) 登录态抓取 → 投递到自建服务器
 *
 * v7 · 2026-11-25
 *  站点登录态：access token（JWT，15 分钟）+ 会话 ID（sid，走 X-Auth-Session 头）。
 *  服务端无法自行刷新（refresh 接口绑定浏览器环境，从服务器 IP 一律 401），
 *  所以策略是「抓到时立刻签到」：token 活着的那 15 分钟里把签到做掉。
 *
 *  去重（v7 重写，解决刷屏）：
 *    - 只看 token 变化 / sid 变化，两个都没变直接退出，不发请求、不发通知
 *    - 30 秒冷却：不是 sid 变更的投递，30 秒内最多一次
 *    - 服务器返回 skipped / 空 body / {} 一律静默，不弹通知
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
var VERSION = "v7";
var K_TOK = "runanytime_last_token";
var K_SID = "runanytime_last_sid";
var K_UID = "runanytime_uid";
var K_ATS = "runanytime_last_post";
var K_SEEN = "runanytime_seen";
var COOLDOWN = 30000;

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

function post(payload, onDone) {
  $httpClient.post(
    {
      url: EP,
      headers: { "Content-Type": "application/json", "X-Token": TOKEN },
      body: JSON.stringify(payload),
      timeout: 90000,
      "auto-cookie": false,
      "auto-redirect": true
    },
    function (err, resp, data) {
      if (err) {
        notify("❌ 投递失败", String(err));
        return onDone(false);
      }
      var raw = String(data || "").trim();
      var j = null;
      try { j = raw ? JSON.parse(raw) : null; } catch (e) { j = null; }
      // 空 body / {} / 解析失败：当作没拿到明确答复，静默
      if (!j || Object.keys(j).length === 0) return onDone(false);
      if (!j.ok) {
        var why = j.error ? String(j.error) : "";
        if (why) notify("❌ 服务器拒绝", why);
        return onDone(false);
      }
      if (j.skipped || j.note) return onDone(true);   // 没变化 / 冷却中：静默
      var log = String(j.log || "").replace(/\*\*/g, "");
      notify(j.code === 0 ? "✅ 已投递并签到成功" : "ℹ️ 已投递（签到未成功）", log);
      onDone(true);
    }
  );
}

function maybeDeliver(payload, done) {
  var lastTok = $persistentStore.read(K_TOK) || "";
  var lastSid = $persistentStore.read(K_SID) || "";
  var sid = String(payload.sid || "");
  var tok = String(payload.token || "");
  var sidNew = !!sid && sid !== lastSid;
  var tokNew = !!tok && tok !== lastTok;

  if (!sidNew && !tokNew) return done();

  var lastAt = Number($persistentStore.read(K_ATS) || 0) || 0;
  if (!sidNew && Date.now() - lastAt < COOLDOWN) return done();

  post(payload, function (ok) {
    if (ok) {
      if (sid) $persistentStore.write(sid, K_SID);
      if (tok) $persistentStore.write(tok, K_TOK);
      if (payload.uid) $persistentStore.write(String(payload.uid), K_UID);
      $persistentStore.write(String(Date.now()), K_ATS);
    }
    done();
  });
}

if (typeof $response !== "undefined" && $response) {
  // 响应分支：/api/user/auth/refresh 的回包里有 session.sid 与新的 access_token
  if (!EP || !TOKEN) {
    $done({});
  } else {
    var body = typeof $response.body === "string" ? $response.body : "";
    var jr = null;
    try { jr = JSON.parse(body); } catch (e) { jr = null; }
    var d = jr && jr.success && jr.data ? jr.data : null;
    var sid2 = d && d.session && typeof d.session.sid === "string" ? d.session.sid : "";
    var tok2 = d && typeof d.access_token === "string" ? d.access_token : "";
    if (!sid2 && !tok2) {
      $done({});
    } else {
      maybeDeliver(
        {
          cookie: hget($request && $request.headers ? $request.headers : {}, "Cookie") || "",
          token: tok2,
          uid: d && d.user && d.user.id ? String(d.user.id) : "",
          sid: sid2
        },
        function () { $done({}); }
      );
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

    if (!sid && !bearer && !ses) {
      $done({});
    } else {
      maybeDeliver(
        {
          cookie: ck || "",
          token: bearer || "",
          uid: uid || "",
          sid: sid || ""
        },
        function () { $done({}); }
      );
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
        var sid = $persistentStore.read(K_SID) || "（还没抓到）";
        notify("✅ 脚本已加载 " + VERSION, "服务器 HTTP " + st + " · sid: " + String(sid).slice(0, 8));
        $done();
      }
    );
  }
}
