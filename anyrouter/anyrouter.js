/*
 * AnyRouter (anyrouter.top) 每日签到 · Loon
 *
 * v3
 *  - 每个 API 请求都做「遇到挑战页就地解、解完重试」，不再依赖先预热 /api/status
 *  - $httpClient 显式关掉 auto-cookie，避免 Loon 自带 cookie 罐污染
 *  - 任何失败都一定发通知，不会再静默
 *  - 抓凭证（request 脚本）与签到（cron / manual）共用一个文件
 *
 * 站点在阿里云 WAF 后面，裸请求只拿到混淆 JS 挑战页；这里把挑战页的 <script>
 * 放进沙盒 eval，拦截 document.cookie 取它自己算出的 acw_sc__v2。
 * 固定混淆表已被随机化（社区老脚本因此全部失效），所以不硬编码算法。
 */

var BASE = "https://anyrouter.top";
var K_CK = "anyrouter_cookie";
var K_UID = "anyrouter_uid";
var K_TS = "anyrouter_captured_at";
var ACW = "acw_sc__v2";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var QUOTA_UNIT = 500000;

/* ---------------- 基础工具 ---------------- */

function arg(name) {
  var a = typeof $argument === "undefined" ? null : $argument;
  if (!a) return "";
  if (typeof a === "object") {
    var v = a[name];
    return v === undefined || v === null ? "" : String(v);
  }
  var parts = String(a).split("&");
  for (var i = 0; i < parts.length; i++) {
    var idx = parts[i].indexOf("=");
    if (idx > 0 && parts[i].slice(0, idx) === name) {
      try { return decodeURIComponent(parts[i].slice(idx + 1)); } catch (e) { return parts[i].slice(idx + 1); }
    }
  }
  return "";
}

function flag(name) {
  var v = arg(name).toLowerCase();
  return v === "true" || v === "1" || v === "on";
}

function hget(h, name) {
  if (!h) return "";
  var low = name.toLowerCase();
  for (var k in h) {
    if (Object.prototype.hasOwnProperty.call(h, k) && k.toLowerCase() === low) return String(h[k]);
  }
  return "";
}

function sessionPart(ck) {
  var m = String(ck || "").match(/(?:^|;\s*)session=([^;]*)/);
  return m ? m[1] : "";
}

function setCookie(ck, name, value) {
  var out = [], seen = false, list = String(ck || "").split(";");
  for (var i = 0; i < list.length; i++) {
    var item = list[i].trim();
    if (!item) continue;
    var idx = item.indexOf("=");
    if (idx > 0 && item.slice(0, idx).trim() === name) { out.push(name + "=" + value); seen = true; }
    else out.push(item);
  }
  if (!seen) out.push(name + "=" + value);
  return out.join("; ");
}

function money(quota) {
  var n = Number(quota);
  return isNaN(n) ? "?" : "$" + (n / QUOTA_UNIT).toFixed(2);
}

function notify(title, sub, body) {
  var text = String(body || "");
  if (text.length > 300) text = text.slice(0, 300) + "…";
  $notification.post("AnyRouter " + title, sub || "", text);
}

function write(key, value) {
  if (value === undefined || value === null || value === "") $persistentStore.write(undefined, key);
  else $persistentStore.write(String(value), key);
}

function parseJSON(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

/* ---------------- WAF 挑战 ---------------- */

function isChallenge(body) {
  return !!body && typeof body === "string" && body.indexOf("arg1=") >= 0 && body.indexOf(ACW) >= 0;
}

function solveByEval(html) {
  var m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) return "";
  var jar = {};
  var doc = {};
  try {
    Object.defineProperty(doc, "cookie", {
      configurable: true,
      get: function () { return ""; },
      set: function (v) {
        var kv = String(v).split(";")[0];
        var i = kv.indexOf("=");
        if (i > 0) jar[kv.slice(0, i).trim()] = kv.slice(i + 1);
      }
    });
  } catch (e) { return ""; }
  var loc = { reload: function () {}, replace: function () {}, assign: function () {}, href: BASE + "/" };
  var nav = { userAgent: UA, platform: "Win32", language: "zh-CN", languages: ["zh-CN"], webdriver: false };
  try {
    var fn = new Function("document", "location", "navigator", "window", "setTimeout", "setInterval", m[1]);
    fn(doc, loc, nav, {}, function () {}, function () {});
  } catch (e) {
    // 脚本末尾通常有 location.reload()，抛错不影响已写入的 cookie
  }
  return jar[ACW] || "";
}

function solveByTable(html) {
  var m = html.match(/arg1\s*=\s*['"]([0-9A-Fa-f]{40})['"]/);
  if (!m) return "";
  var arg1 = m[1].toUpperCase();
  var SH = [0xf, 0x23, 0x1d, 0x18, 0x21, 0x10, 0x1, 0x26, 0xa, 0x9, 0x13, 0x1f, 0x28, 0x1b, 0x16, 0x17, 0x19,
    0xd, 0x6, 0xb, 0x27, 0x12, 0x14, 0x8, 0xe, 0x15, 0x20, 0x1a, 0x2, 0x1e, 0x7, 0x4, 0x11, 0x5, 0x3,
    0x1c, 0x22, 0x25, 0xc, 0x24];
  var XOR = "3000176000856006061501533003690027800375";
  var chars = [], i, j;
  for (i = 0; i < arg1.length; i++) {
    for (j = 0; j < SH.length; j++) if (SH[j] === i + 1) chars[j] = arg1[i];
  }
  var s = chars.join(""), out = "";
  for (i = 0; i < s.length && i < XOR.length; i += 2) {
    var n = (parseInt(s.substr(i, 2), 16) ^ parseInt(XOR.substr(i, 2), 16)).toString(16);
    out += ("0" + n).slice(-2);
  }
  return out;
}

function solve(html) {
  return solveByEval(html) || solveByTable(html);
}

/* ---------------- 带挑战重试的 API 调用 ---------------- */

function headersFor(ck, uid, json) {
  var h = {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Referer": BASE + "/console",
    "Origin": BASE
  };
  if (ck) h["Cookie"] = ck;
  if (json) h["Content-Type"] = "application/json";
  if (uid) h["New-Api-User"] = String(uid);
  return h;
}

// cb(err, {status, body, cookie})
function call(method, path, ck, uid, body, cb, round) {
  round = round || 0;
  var opt = {
    url: BASE + path,
    headers: headersFor(ck, uid, method === "POST"),
    timeout: 20000,
    "auto-cookie": false,
    "auto-redirect": true
  };
  if (method === "POST") opt.body = body || "";
  var fn = method === "POST" ? $httpClient.post : $httpClient.get;

  fn(opt, function (err, resp, data) {
    if (err) return cb(String(err), null);
    var status = resp && resp.status ? resp.status : 0;
    var text = typeof data === "string" ? data : String(data || "");
    if (isChallenge(text)) {
      if (round >= 3) return cb("WAF 反复拦截", { status: status, body: text, cookie: ck });
      var v = solve(text);
      if (!v) return cb("WAF 解析失败", { status: status, body: text, cookie: ck });
      var ck2 = setCookie(ck, ACW, v);
      write(K_CK, ck2);
      return call(method, path, ck2, uid, body, cb, round + 1);
    }
    cb(null, { status: status, body: text, cookie: ck });
  });
}

/* ---------------- 主流程 ---------------- */

function finish() { $done(); }

function run() {
  if (flag("debug")) write(K_TS, $persistentStore.read(K_TS) || "");

  if (arg("action") === "clear") {
    write(K_CK, ""); write(K_UID, ""); write(K_TS, "");
    notify("🧹 已清除凭证", "", "下次打开 anyrouter.top 登录时会重新抓取");
    return finish();
  }

  var ck = arg("cookie") || arg("session");
  var uid = arg("new_api_user") || arg("user_id");

  if (ck && ck.indexOf("=") < 0) ck = "session=" + ck;
  if (!ck) ck = $persistentStore.read(K_CK) || "";
  if (!uid) uid = $persistentStore.read(K_UID) || "";

  if (!ck) {
    notify("❌ 未配置", "缺少 Cookie", "先在浏览器打开 anyrouter.top/console 登录一次，或在插件参数 session 里手动填");
    return finish();
  }

  call("POST", "/api/user/sign_in", ck, uid, "", function (err, r) {
    if (err && !r) {
      notify("❌ 签到请求失败", String(err), "网络不通或 Loon 无法连接 " + BASE);
      return finish();
    }
    var status = r.status, text = r.body;
    var j = parseJSON(text);

    if (status === 401 || status === 403) {
      notify("❌ 凭证失效", "HTTP " + status, "重新打开 anyrouter.top 登录一次，让插件抓新 Cookie");
      return finish();
    }
    if (err) {
      notify("❌ " + err, "HTTP " + status, text.slice(0, 300));
      return finish();
    }

    var msg = "";
    if (j) msg = String(j.message || (j.data && j.data.message) || "");
    var ok = !!(j && (j.success === true || j.code === 0 || (j.data && j.data.success)));

    if (!ok && /已签到|already|重复/.test(msg)) {
      return report(r.cookie, uid, "ℹ️ 今日已签到", msg);
    }
    if (!ok) {
      notify("❌ 签到失败", "HTTP " + status, msg || text.slice(0, 200));
      return finish();
    }
    report(r.cookie, uid, "✅ 签到成功", msg);
  });
}

function report(ck, uid, title, msg) {
  call("GET", "/api/user/self", ck, uid, "", function (err, r) {
    if (err || !r) {
      notify(title, "", msg + "（余额查询失败：" + String(err || "") + "）");
      return finish();
    }
    var j = parseJSON(r.body);
    var d = j && j.data ? j.data : null;
    var line = msg || "";
    if (d) {
      if (d.id && String(d.id) !== String(uid)) write(K_UID, String(d.id));
      line += (line ? " · " : "") + "余额 " + money(d.quota) + " · 已用 " + money(d.used_quota);
      var who = d.display_name || d.username;
      if (who) line += " · " + who;
    }
    var ts = $persistentStore.read(K_TS) || "";
    if (ts) line += "\n凭证抓取于 " + ts;
    notify(title, "", line);
    finish();
  });
}

/* ---------------- 入口 ---------------- */

if (typeof $request !== "undefined" && $request) {
  var h = $request.headers || {};
  var hitCk = hget(h, "Cookie");
  var hitUid = hget(h, "New-Api-User");
  var oldCk = $persistentStore.read(K_CK) || "";
  var oldUid = $persistentStore.read(K_UID) || "";
  var changed = false;

  if (hitCk && sessionPart(hitCk) && sessionPart(hitCk) !== sessionPart(oldCk)) {
    write(K_CK, hitCk);
    changed = true;
    var d = new Date();
    write(K_TS, d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2) + " " +
      ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2));
  }
  if (hitUid && hitUid !== oldUid) {
    write(K_UID, hitUid);
    changed = true;
  }
  if (changed) notify("✅ 已抓取凭证", hitUid ? "用户 " + hitUid : "", "之后按 cron 自动签到；也可在脚本列表手动跑一次");
  $done({});
} else {
  run();
}
