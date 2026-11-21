/*
 * AnyRouter (anyrouter.top) 每日签到 · Loon
 *
 * 说明：
 *  - 站点在阿里云 WAF 后面（ESA），裸请求只会拿到混淆的 JS 挑战页；
 *    本脚本把挑战页里的脚本放进沙盒 eval，取出它算好的 acw_sc__v2，
 *    再带着这个 cookie 去签到。混淆表每次部署都会变，所以不硬编码算法。
 *  - 凭证来源：抓 anyrouter.top 的请求，取 Cookie 和 New-Api-User 两个头；
 *    也可以在插件参数里手动填 session / new_api_user。
 *  - 抓取方式：浏览器或 App 打开一次 https://anyrouter.top/console 即可。
 */

var BASE = "https://anyrouter.top";
var K_CK = "anyrouter_cookie";
var K_UID = "anyrouter_uid";
var UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
var ACW = "acw_sc__v2";
var QUOTA_UNIT = 500000;

/* ---------------- 小工具 ---------------- */

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
    if (idx < 0) continue;
    if (parts[i].slice(0, idx) === name) {
      try { return decodeURIComponent(parts[i].slice(idx + 1)); } catch (e) { return parts[i].slice(idx + 1); }
    }
  }
  return "";
}

function hget(h, name) {
  if (!h) return "";
  var low = name.toLowerCase();
  for (var k in h) {
    if (Object.prototype.hasOwnProperty.call(h, k) && k.toLowerCase() === low) return String(h[k]);
  }
  return "";
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
  if (isNaN(n)) return "?";
  return "$" + (n / QUOTA_UNIT).toFixed(2);
}

function notify(title, sub, body) {
  $notification.post("AnyRouter " + title, sub || "", body || "");
}

function done() {
  $done();
}

/* ---------------- WAF 挑战 ---------------- */

function isChallenge(body) {
  return !!body && typeof body === "string" && body.indexOf("<script>") >= 0 &&
    body.indexOf("arg1=") >= 0 && body.indexOf(ACW) >= 0;
}

// 把挑战页脚本跑在沙盒里，读它生成的 acw_sc__v2。
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
  } catch (e) {
    doc.cookie = "";
  }
  var loc = { reload: function () {}, replace: function () {}, assign: function () {}, href: BASE + "/" };
  var nav = { userAgent: UA, platform: "Win32", language: "zh-CN", languages: ["zh-CN"] };
  try {
    var fn = new Function("document", "location", "navigator", "window", "setTimeout", "setInterval", m[1]);
    fn(doc, loc, nav, {}, function () {}, function () {});
  } catch (e) {
    // 沙盒里抛错很正常（脚本末尾会 location.reload），cookie 可能已经写进去了
  }
  return jar[ACW] || "";
}

// 兜底：老的固定表解法（当前部署已失效，仅留作参考）
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

/* ---------------- 网络 ---------------- */

function headersFor(ck, uid, json) {
  var h = {
    "User-Agent": UA,
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Cookie": ck || "",
    "Referer": BASE + "/console",
    "Origin": BASE
  };
  if (json) h["Content-Type"] = "application/json";
  if (uid) h["New-Api-User"] = String(uid);
  return h;
}

function getJSON(path, ck, uid, cb) {
  $httpClient.get({ url: BASE + path, headers: headersFor(ck, uid, false), timeout: 20000 }, function (err, resp, data) {
    cb(err, resp, data);
  });
}

function postEmpty(path, ck, uid, cb) {
  $httpClient.post({ url: BASE + path, headers: headersFor(ck, uid, true), body: "", timeout: 20000 }, function (err, resp, data) {
    cb(err, resp, data);
  });
}

function parse(data) {
  try { return JSON.parse(data); } catch (e) { return null; }
}

/* ---------------- 主流程 ---------------- */

function run() {
  var ck = $persistentStore.read(K_CK) || "";
  var uid = $persistentStore.read(K_UID) || "";
  var argCk = arg("session") || arg("cookie");
  var argUid = arg("new_api_user") || arg("user_id");

  if (argCk) ck = argCk.indexOf("=") > 0 ? argCk : "session=" + argCk;
  if (argUid) uid = argUid;
  if (!ck) {
    notify("❌ 未配置", "缺少 Cookie", "先在浏览器打开 anyrouter.top/console 让插件抓一次凭证，或在插件参数里填 session");
    return done();
  }

  // 1. 预热 WAF：拿挑战页 → 解出 acw_sc__v2
  getJSON("/api/status", ck, uid, function (err, resp, data) {
    if (err) {
      notify("❌ 网络错误", String(err), "无法连接 anyrouter.top");
      return done();
    }
    if (isChallenge(data)) {
      var v = solve(data);
      if (!v) {
        notify("❌ WAF 挑战解析失败", "HTTP " + (resp && resp.status), "站点更新了防护算法，需要改脚本");
        return done();
      }
      ck = setCookie(ck, ACW, v);
      $persistentStore.write(ck, K_CK);
    }
    signIn(ck, uid, 0);
  });
}

function signIn(ck, uid, retried) {
  postEmpty("/api/user/sign_in", ck, uid, function (err, resp, data) {
    if (err) {
      notify("❌ 签到请求失败", String(err), "");
      return done();
    }
    if (isChallenge(data)) {
      if (retried >= 2) {
        notify("❌ WAF 反复拦截", "HTTP " + (resp && resp.status), "签到未完成");
        return done();
      }
      var v = solve(data);
      if (!v) {
        notify("❌ WAF 挑战解析失败", "", "站点更新了防护算法");
        return done();
      }
      ck = setCookie(ck, ACW, v);
      $persistentStore.write(ck, K_CK);
      return signIn(ck, uid, retried + 1);
    }

    var j = parse(data);
    var status = resp && resp.status ? resp.status : 0;
    var msg = j && (j.message || (j.data && j.data.message)) ? String(j.message || j.data.message) : "";
    var ok = !!(j && (j.success === true || j.code === 0 || (j.data && j.data.success)));

    if (status === 401 || status === 403) {
      notify("❌ 凭证失效", "HTTP " + status, "重新打开 anyrouter.top 登录一次，让插件抓新 Cookie");
      return done();
    }
    if (!ok && /已签到|already/i.test(msg)) {
      return summary(ck, uid, "ℹ️ 今日已签到", msg);
    }
    if (!ok) {
      notify("❌ 签到失败", "HTTP " + status, msg || String(data).slice(0, 200));
      return done();
    }
    summary(ck, uid, "✅ 签到成功", msg);
  });
}

function summary(ck, uid, title, msg) {
  getJSON("/api/user/self", ck, uid, function (err, resp, data) {
    var j = parse(data);
    var d = j && j.data ? j.data : null;
    if (d && d.id && String(d.id) !== String(uid)) {
      uid = String(d.id);
      $persistentStore.write(uid, K_UID);
    }
    var line = msg || "";
    if (d) {
      line += (line ? " · " : "") + "余额 " + money(d.quota) + " · 已用 " + money(d.used_quota);
      if (d.display_name || d.username) line += " · " + (d.display_name || d.username);
    }
    notify(title, "", line);
    done();
  });
}

/* ---------------- 入口 ---------------- */

if (typeof $request !== "undefined" && $request) {
  // 抓凭证：浏览器/App 访问 anyrouter.top 时顺手存下 Cookie 与 New-Api-User
  var h = $request.headers || {};
  var ck = hget(h, "Cookie");
  var uid = hget(h, "New-Api-User");
  if (ck && ck.indexOf("session=") >= 0) $persistentStore.write(ck, K_CK);
  if (uid) $persistentStore.write(uid, K_UID);
  $done({});
} else {
  run();
}
