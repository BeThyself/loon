/*
 * 随时跑路登录态捕获 v8 · 2026-11-25 · thyself
 * 仅处理成功认证响应；Set-Cookie 优先于原请求 Cookie。
 * 刷新 Cookie 独立保存，忽略普通 API 和 Bearer 轮换。捕获不等于续期/签到成功。
 * Loon API: https://nsloon.app/docs/Script/script_api
 */
(function () {
  var VERSION = "v8";
  var P = "runanytime_v8_";
  var completed = false;
  function done() { if (!completed) { completed = true; $done({}); } }
  function arg(name) {
    var a = typeof $argument === "undefined" ? null : $argument;
    if (!a) return "";
    if (typeof a === "object") return String(a[name] || "");
    var parts = String(a).split("&");
    for (var i = 0; i < parts.length; i++) {
      var at = parts[i].indexOf("=");
      if (parts[i].slice(0, at) === name) {
        try { return decodeURIComponent(parts[i].slice(at + 1)); } catch (e) { return ""; }
      }
    }
    return "";
  }
  function read(k) { return $persistentStore.read(P + k) || ""; }
  function write(k, v) { $persistentStore.write(v === undefined ? undefined : String(v), P + k); }
  function json(s) { try { return JSON.parse(s); } catch (e) { return null; } }
  function header(h, name) {
    for (var k in (h || {})) if (k.toLowerCase() === name.toLowerCase()) return h[k];
    return "";
  }
  function requestCookie(raw, name) {
    var parts = String(raw || "").split(";");
    for (var i = 0; i < parts.length; i++) {
      var at = parts[i].indexOf("=");
      if (parts[i].slice(0, at).trim() === name) return parts[i].slice(at + 1).trim();
    }
    return "";
  }
  function responseCookie(h, name) {
    var raw = header(h, "Set-Cookie");
    var lines = Array.isArray(raw) ? raw : [String(raw || "")];
    var result = { found: false, value: "", removed: false };
    for (var i = 0; i < lines.length; i++) {
      // Only split at an actual cookie boundary, not the comma in Expires.
      var parts = String(lines[i]).split(/\r?\n|,(?=\s*[^\s;,=]+\s*=)/);
      for (var j = 0; j < parts.length; j++) {
        var match = parts[j].match(/^\s*([^=;\s]+)=([^;]*)/);
        if (!match || match[1] !== name) continue;
        var value = match[2].trim();
        if (/^".*"$/.test(value)) value = value.slice(1, -1);
        var age = parts[j].match(/;\s*max-age\s*=\s*(-?\d+)/i);
        var expiry = parts[j].match(/;\s*expires\s*=\s*([^;]+)/i);
        result = { found: true, value: value, removed: !value || !!(age && Number(age[1]) <= 0) ||
          !!(!age && expiry && Date.parse(expiry[1]) <= Date.now()) };
      }
    }
    return result;
  }
  function note(kind, text, force) {
    var key = "notice_" + kind, last = Number(read(key)) || 0;
    if (!force && Date.now() - last < 12 * 3600000) return;
    write(key, Date.now());
    $notification.post("[随时跑路] " + text, "", VERSION + " · 不自动签到，定时任务尚未恢复");
  }
  var ep = arg("hook"), secret = arg("token");
  var req = typeof $request === "undefined" ? null : $request;
  var res = typeof $response === "undefined" ? null : $response;
  if (req && !res) return done(); // Old request rules must never deliver.
  if (!/^https:\/\/[^\s#]+$/.test(ep) || !secret) {
    note("config", "⚠️ 请填写 HTTPS 投递地址和令牌", !req);
    return done();
  }
  var options = { url: ep, headers: { "X-Token": secret }, timeout: 15000,
    "auto-cookie": false, "auto-redirect": false, insecure: false };
  if (!req && !res) {
    options.url = ep.replace(/\/cookie$/, "/status");
    $httpClient.get(options, function (err, resp, body) {
      var status = Number(resp && resp.status) || 0, result = json(body);
      if (err || status !== 200 || !result || result.ok !== true) {
        note("status", "❌ 自检失败（HTTP " + status + "）", true);
      } else {
        note("status", result.has_refresh ? "✅ 服务器已存刷新 Cookie；续期结果需另行验证" :
          "ℹ️ 服务器尚缺刷新 Cookie，请重新登录或刷新网页", true);
      }
      done();
    });
    return;
  }
  if (!req || !res || !/^https:\/\/runanytime\.hxi\.me\/(?:api\/user\/(?:auth\/(?:refresh|login)|login(?:\/2fa)?|passkey\/login\/finish)|api\/oauth\/[^?#]+)\/?(?:[?#]|$)/.test(String(req.url || ""))) return done();
  var status = Number(res.status) || 0;
  var body = typeof res.body === "string" ? json(res.body) : null;
  var d = body && body.success === true && body.data;
  if (status !== 200 || !d || !d.session || typeof d.session.sid !== "string" || !d.session.sid ||
      typeof d.access_token !== "string" || !d.access_token || !d.user || !/^[1-9]\d*$/.test(String(d.user.id))) return done();
  var refresh = responseCookie(res.headers, "new_api_refresh");
  if (refresh.removed) return done();
  var value = refresh.found ? refresh.value : requestCookie(header(req.headers, "Cookie"), "new_api_refresh");
  if (!value) {
    note("missing", "⚠️ 认证响应有效，但未发现刷新 Cookie");
    return done();
  }
  var uid = String(d.user.id), sid = d.session.sid;
  var key = JSON.stringify([ep, uid, sid, value]);
  if (read("ack") === key) return done();
  var pending = json(read("pending"));
  if (pending && pending.key === key && Date.now() - pending.at < 30000) return done();
  var at = Date.now();
  write("pending", JSON.stringify({ key: key, at: at }));
  var cf = responseCookie(res.headers, "cf_clearance");
  var clearance = cf.found ? (cf.removed ? "" : cf.value) : requestCookie(header(req.headers, "Cookie"), "cf_clearance");
  var payload = { schema: 8, source: "auth-response", observed_at: at, refresh_cookie: value,
    cookie: clearance ? "cf_clearance=" + clearance : "", user_agent: String(header(req.headers, "User-Agent") || ""),
    token: d.access_token, sid: sid, uid: uid };
  options.headers["Content-Type"] = "application/json";
  options.body = JSON.stringify(payload);
  $httpClient.post(options, function (err, resp, data) {
    var active = json(read("pending"));
    if (active && active.key === key) write("pending", undefined);
    var result = json(data), status = Number(resp && resp.status) || 0;
    if (err || status !== 200 || !result || result.ok !== true || result.has_refresh !== true) {
      note("delivery", "❌ 凭证投递未确认（HTTP " + status + "）");
      return done();
    }
    if (at >= (Number(read("ack_at")) || 0)) { write("ack", key); write("ack_at", at); }
    if (!result.skipped) note("captured_" + uid, "✅ 刷新凭证已保存，等待续期验证");
    done();
  });
})();
