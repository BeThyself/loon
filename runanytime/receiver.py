#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""只接收 schema v8 成功认证响应，不触发签到、刷新或通知。"""
import hmac
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import auth_store

DIR = os.environ.get("RUNANYTIME_DIR", "/opt/runanytime")
CFG = os.path.join(DIR, "config.json")
LOCK = os.path.join(DIR, "config.lock")
SECRET_FILE = os.path.join(DIR, "receiver.token")
PORT = 7871
MAX_BODY = 64 * 1024
with open(SECRET_FILE, encoding="utf-8") as f:
    lines = [x.strip() for x in f if x.strip()]
if len(lines) < 2:
    raise RuntimeError("receiver.token requires path secret and token")
PATH_SECRET, TOKEN = lines[:2]

def status_summary(cfg):
    verification = cfg.get("auth_verification") or {}
    return {"ok": True, "version": 8, "mode": "capture-only", "has_refresh": bool(cfg.get("new_api_refresh")),
            "has_cookie": bool(cfg.get("cookie")), "has_token": bool(cfg.get("token")),
            "has_sid": bool(cfg.get("sid")), "observed_at": cfg.get("auth_observed_at"),
            "refreshed_at": cfg.get("auth_refreshed_at"),
            "verification": {k: verification.get(k) for k in ("ok", "status", "code", "verified_at", "expires_at")}}

class Handler(BaseHTTPRequestHandler):
    server_version = "ra-recv/2.0"
    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=True).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def _auth(self, route):
        return (self.client_address[0] in ("127.0.0.1", "::1") and
                hmac.compare_digest(self.path, route) and
                hmac.compare_digest(self.headers.get("X-Token", ""), TOKEN))
    def do_POST(self):
        if self.path != "/%s/cookie" % PATH_SECRET:
            return self._json(404, {"ok":False,"code":"not_found"})
        if not self._auth("/%s/cookie" % PATH_SECRET):
            return self._json(401, {"ok":False,"code":"unauthorized"})
        try:
            n = int(self.headers.get("Content-Length", "-1"))
            if n < 0 or n > MAX_BODY: return self._json(413,{"ok":False,"code":"body_too_large"})
            data = json.loads(self.rfile.read(n))
            auth_store.validate_capture(data)
            result = auth_store.save_capture(data, CFG, LOCK)
            return self._json(200, {"ok":True,"skipped":result["skipped"],"has_refresh":result["has_refresh"]})
        except auth_store.StoreError as e:
            code = 409 if e.code == "stale_observation" else 400
            return self._json(code,{"ok":False,"code":e.code})
        except (ValueError, json.JSONDecodeError):
            return self._json(400,{"ok":False,"code":"bad_json"})
        except Exception:
            return self._json(500,{"ok":False,"code":"storage_error"})
    def do_GET(self):
        route = "/%s/status" % PATH_SECRET
        if not self._auth(route): return self._json(401,{"ok":False,"code":"unauthorized"})
        try:
            with auth_store.locked(LOCK): cfg = auth_store.read_config(CFG)
            return self._json(200,status_summary(cfg))
        except Exception:
            return self._json(500,{"ok":False,"code":"storage_error"})
    def log_message(self, *args):
        pass

if __name__ == "__main__":
    print("receiver listening on 127.0.0.1:%d" % PORT, flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
