#!/usr/bin/env python3
"""显式执行纯 HTTP self 验证/refresh；不会触发签到或后台任务。"""
import argparse
import base64
import math
from urllib.parse import urlsplit
import http.cookiejar
import json
import os
import sys
import time
from urllib import request, error

import auth_store

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "https://runanytime.hxi.me"
TIMEOUT = 15
MAX_BODY = 1024 * 1024
UA_DEFAULT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"

def _data(obj):
    if not isinstance(obj, dict): return {}
    d = obj.get("data")
    return d if isinstance(d, dict) else obj

def _token(obj):
    d = _data(obj)
    for o in (obj, d):
        for k in ("access_token", "token", "accessToken"):
            if isinstance(o.get(k), str) and o[k]: return o[k]
    return ""

def _sid(obj, prior):
    d = _data(obj)
    sess = d.get("session") if isinstance(d.get("session"), dict) else {}
    return str(sess.get("sid") or d.get("sid") or prior or "")

def _uid(obj, prior):
    d = _data(obj)
    user = d.get("user") if isinstance(d.get("user"), dict) else {}
    return str(user.get("id") or d.get("id") or d.get("uid") or prior or "")

def _ok(obj):
    return isinstance(obj, dict) and obj.get("success", True) is True

def _cookie_pair(raw):
    pair = str(raw or "").split(";", 1)[0].strip()
    if "=" not in pair: return ""
    k, v = pair.split("=", 1)
    if not k.strip() or "\r" in pair or "\n" in pair: return ""
    return k.strip() + "=" + v.strip()

class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

class Probe:
    def __init__(self, cfg, base=BASE):
        self.cfg, self.base = cfg.copy(), base.rstrip("/")
        self.jar = http.cookiejar.CookieJar()
        self.opener = request.build_opener(request.HTTPCookieProcessor(self.jar), NoRedirect())
        host = urlsplit(self.base).hostname
        secure = urlsplit(self.base).scheme == "https"
        if not host: raise auth_store.StoreError("invalid_origin")
        self.host, self.secure = host, secure
        self.ua = cfg.get("user_agent") or UA_DEFAULT
        self.token, self.sid, self.uid = cfg.get("token", ""), cfg.get("sid", ""), str(cfg.get("uid", ""))
        # Cookies are scoped only to the fixed HTTPS site; host-only by default.
        for pair in str(cfg.get("cookie") or "").split(";"):
            p = _cookie_pair(pair)
            if p: self._insert_cookie(p.split("=",1)[0], p.split("=",1)[1], self.host, False)
        raw_refresh = str(cfg.get("new_api_refresh") or "")
        # The field stores a VALUE, which may itself contain '=' padding.
        if raw_refresh.startswith("new_api_refresh="):
            raw_refresh = raw_refresh[len("new_api_refresh="):]
        self.refresh_name, self.refresh_value = "new_api_refresh", raw_refresh
        if raw_refresh:
            self._insert_cookie(self.refresh_name, raw_refresh, self.host, False, "/api/user/auth")

        # Restore exact server cookie domain/path/secure/expiry, including rotations.
        for item in cfg.get("cookie_jar", []):
            try:
                c = http.cookiejar.Cookie(**item)
                if c.domain.lstrip(".") == self.host or self.host.endswith("." + c.domain.lstrip(".")):
                    if not c.is_expired(): self.jar.set_cookie(c)
            except (TypeError, ValueError): pass

    def cookie_records(self):
        fields = ("version","name","value","port","port_specified","domain","domain_specified","domain_initial_dot","path","path_specified","secure","expires","discard","comment","comment_url","rfc2109")
        return [dict({k:getattr(c,k) for k in fields}, rest=c._rest) for c in self.jar if not c.is_expired()]

    def _insert_cookie(self, name, value, domain, initial_dot, path="/"):
        c = http.cookiejar.Cookie(0, name, value, None, False, domain, initial_dot, initial_dot,
            path, True, self.secure, None, True, None, None, {}, False)
        self.jar.set_cookie(c)

    def _call(self, path, method="GET", token=None, sid=None, body=None):
        headers = {"User-Agent": self.ua, "Accept": "application/json, text/plain, */*",
                   "Referer": self.base + "/console/personal", "Origin": self.base}
        t = self.token if token is None else token
        s = self.sid if sid is None else sid
        if t: headers["Authorization"] = "Bearer " + t
        if s: headers["X-Auth-Session"] = s
        data = json.dumps(body).encode() if body is not None else (b"" if method == "POST" else None)
        if method == "POST": headers["Content-Type"] = "application/json"
        req = request.Request(self.base + path, data=data, method=method, headers=headers)
        try:
            with self.opener.open(req, timeout=TIMEOUT) as r:
                status, raw = r.status, r.read(MAX_BODY + 1)
        except error.HTTPError as e:
            status, raw = e.code, e.read(MAX_BODY + 1)
        except Exception:
            return 0, {}
        if len(raw) > MAX_BODY: return status, {}
        try: body = json.loads(raw.decode("utf-8"))
        except Exception: body = {}
        return status, body if isinstance(body, dict) else {}

    def _rotated(self):
        vals = {}
        for c in self.jar:
            vals[c.name] = c.value
        cookie = "; ".join(k + "=" + v for k,v in vals.items() if k.lower() != self.refresh_name.lower())
        refresh = vals.get(self.refresh_name, "")
        return cookie, refresh

    def verify(self):
        status, body = self._call("/api/user/self")
        d = _data(body)
        if status != 200 or not _ok(body) or not str(d.get("id") or d.get("uid") or "").isdigit():
            return {"ok": False, "code": "self_unauthorized" if status in (401,403) else "self_failed", "status": status or None}
        expiry = next((d.get(k) for k in ("expires_at", "expiresAt", "exp") if isinstance(d.get(k),(int,float))), None)
        if expiry is None and self.token.count(".") == 2:
            try:
                segment = self.token.split(".")[1]
                exp = json.loads(base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))).get("exp")
                if isinstance(exp, (int, float)) and math.isfinite(exp): expiry = exp
            except Exception:
                pass
        return {"ok": True, "status": status, "uid": str(d.get("id") or d.get("uid") or self.uid or "") or None,
                "username": str(d.get("username") or d.get("display_name") or "") or None,
                "quota": d.get("quota"), "expires_at": expiry,
                "verified_at": int(time.time())}

    def refresh(self, cfg_path, lock_path):
        if not self.refresh_value:
            return {"ok": False, "code": "missing_refresh", "status": None}
        status, body = self._call("/api/user/auth/refresh", "POST", token="")
        tok = _token(body)
        if status != 200 or not _ok(body) or not tok:
            result = {"ok": False, "code": "refresh_unauthorized" if status in (401, 403) else "refresh_failed", "status": status or None}
            with auth_store.locked(lock_path):
                current = auth_store.read_config(cfg_path)
                if all(current.get(k) == self.cfg.get(k) for k in ("new_api_refresh", "sid", "uid", "token", "auth_observed_at")):
                    current["auth_verification"] = dict(result, verified_at=int(time.time()))
                    auth_store.atomic_write(cfg_path, current)
            return result
        self.token = tok
        self.sid = _sid(body, self.sid)
        self.uid = _uid(body, self.uid)
        cookie, refresh = self._rotated()
        values = {"token":self.token, "sid":self.sid, "uid":self.uid, "cookie":cookie, "new_api_refresh":refresh, "cookie_jar":self.cookie_records()}
        # Under the same lock, compare the exact refresh cookie snapshot. A browser capture
        # that rotated it while this request was in flight wins over the stale HTTP reply.
        with auth_store.locked(lock_path):
            current = auth_store.read_config(cfg_path)
            if any(current.get(k) != self.cfg.get(k) for k in ("new_api_refresh", "sid", "uid", "token", "auth_observed_at")):
                return {"ok":False,"code":"credentials_changed","status":None}
            current.update(values)
            current["auth_refreshed_at"] = int(time.time()*1000)
            auth_store.atomic_write(cfg_path,current)
        # A self failure does not delete the just-saved successful refresh response.
        result = self.verify()
        with auth_store.locked(lock_path):
            current=auth_store.read_config(cfg_path)
            if current.get("token") == self.token:
                current["auth_verification"]={k:result.get(k) for k in ("ok","status","code","verified_at","expires_at")}
                current["cookie_jar"]=self.cookie_records()
                auth_store.atomic_write(cfg_path,current)
        return result

def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--verify", action="store_true", help="仅 GET /api/user/self")
    g.add_argument("--refresh", action="store_true", help="显式 POST refresh 后 GET self")
    ap.add_argument("--config", default=os.path.join(HERE,"config.json"))
    ap.add_argument("--base-url", default=BASE, help=argparse.SUPPRESS)
    args = ap.parse_args(argv)
    lock = os.path.join(os.path.dirname(os.path.abspath(args.config)), "config.lock")
    try:
        with auth_store.locked(lock): cfg = auth_store.read_config(args.config)
        p = Probe(cfg, args.base_url)
        result = p.refresh(args.config, lock) if args.refresh else p.verify()
        if args.verify:
            with auth_store.locked(lock):
                current=auth_store.read_config(args.config)
                if current.get("token") == cfg.get("token"):
                    current["auth_verification"]={k:result.get(k) for k in ("ok","status","code","verified_at","expires_at")}
                    auth_store.atomic_write(args.config,current)
    except auth_store.StoreError as e:
        result = {"ok":False,"code":e.code,"status":None}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result.get("ok") else 1

if __name__ == "__main__":
    sys.exit(main())
