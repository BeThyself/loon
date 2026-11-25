#!/usr/bin/env python3
"""原子化、跨进程锁定的认证凭证持久层。"""
import fcntl
import json
import os
import secrets
import tempfile
from contextlib import contextmanager

MAX_FILE = 64 * 1024
MAX_FIELD = 16 * 1024
SECRET_FIELDS = ("new_api_refresh", "cookie", "token", "sid")

class StoreError(ValueError):
    def __init__(self, code):
        self.code = code
        super().__init__(code)

@contextmanager
def locked(lock_path):
    os.makedirs(os.path.dirname(os.path.abspath(lock_path)), exist_ok=True)
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        os.fchmod(fd, 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)

def read_config(path):
    try:
        with open(path, "rb") as f:
            raw = f.read(MAX_FILE + 1)
        if len(raw) > MAX_FILE:
            raise StoreError("config_too_large")
        value = json.loads(raw.decode("utf-8"))
        return value if isinstance(value, dict) else {}
    except FileNotFoundError:
        return {}
    except StoreError:
        raise
    except Exception:
        raise StoreError("config_invalid")

def atomic_write(path, value):
    directory = os.path.dirname(os.path.abspath(path))
    os.makedirs(directory, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".auth-" + secrets.token_hex(8) + "-", dir=directory)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(value, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
        os.chmod(path, 0o600)
    finally:
        try:
            os.unlink(tmp)
        except FileNotFoundError:
            pass

def _text(value, field, required=False):
    if value is None:
        value = ""
    if not isinstance(value, str) or len(value) > MAX_FIELD or "\r" in value or "\n" in value:
        raise StoreError("invalid_" + field)
    value = value.strip()
    if required and not value:
        raise StoreError("missing_" + field)
    return value

def refresh_value(raw):
    value = _text(raw, "refresh_cookie", required=True)
    if any(ord(c) < 33 or ord(c) > 126 or c in ';,\\"' for c in value):
        raise StoreError("invalid_refresh_cookie")
    return value

def validate_capture(payload):
    import time
    if not isinstance(payload, dict) or payload.get("schema") != 8:
        raise StoreError("schema_required")
    if payload.get("source") != "auth-response":
        raise StoreError("auth_response_required")
    refresh_value(payload.get("refresh_cookie"))
    for field in ("uid", "sid", "token"):
        _text(payload.get(field), field, required=True)
    uid = payload["uid"]
    if not uid.isdigit() or int(uid) <= 0:
        raise StoreError("invalid_uid")
    observed = payload.get("observed_at")
    if not isinstance(observed, int) or isinstance(observed, bool) or observed <= 0 or observed > int(time.time()*1000) + 300000:
        raise StoreError("invalid_observed_at")

def _clearance(cookie):
    out = []
    for part in cookie.split(";"):
        k, sep, v = part.strip().partition("=")
        if sep and k.strip().lower() == "cf_clearance":
            out.append("cf_clearance=" + v.strip())
    return "; ".join(out)

def save_capture(payload, config_path, lock_path, now_ms=None):
    if not isinstance(payload, dict) or payload.get("schema") != 8:
        raise StoreError("schema_required")
    if payload.get("source") != "auth-response":
        raise StoreError("auth_response_required")
    observed = payload.get("observed_at")
    if not isinstance(observed, int) or isinstance(observed, bool) or observed <= 0:
        raise StoreError("invalid_observed_at")
    refresh = _text(payload.get("refresh_cookie"), "refresh_cookie")
    cookie = _text(payload.get("cookie"), "cookie")
    ua = _text(payload.get("user_agent"), "user_agent")
    sid = _text(payload.get("sid"), "sid")
    token = _text(payload.get("token"), "token")
    uid = _text(payload.get("uid"), "uid")
    cookie = _clearance(cookie)
    if not any((refresh, token, sid)):
        raise StoreError("auth_material_required")
    now_ms = now_ms if now_ms is not None else __import__("time").time_ns() // 1_000_000
    with locked(lock_path):
        cfg = read_config(config_path)
        old_obs = cfg.get("auth_observed_at", 0)
        if isinstance(old_obs, int) and observed < old_obs:
            raise StoreError("stale_observation")
        old_refresh, old_sid = cfg.get("new_api_refresh", ""), cfg.get("sid", "")
        if observed == old_obs and refresh and old_refresh and refresh != old_refresh:
            raise StoreError("stale_observation")
        switched = bool(uid and cfg.get("uid") and uid != str(cfg.get("uid")))
        # An unidentified session change cannot borrow the prior account's token.
        uncertain_session = bool(not uid and sid and old_sid and sid != old_sid and refresh)
        if switched or uncertain_session:
            for key in SECRET_FIELDS + ("uid", "cookie_jar", "auth_verification"):
                cfg.pop(key, None)
            cfg.pop("user_agent", None)
        stable = bool(not switched and not uncertain_session and
                      (not refresh or refresh == old_refresh) and (not sid or sid == old_sid))
        changed = switched or uncertain_session
        if refresh and refresh != old_refresh:
            cfg.pop("cookie_jar",None)
        for key, value in (("new_api_refresh", refresh), ("cookie", cookie), ("user_agent", ua), ("sid", sid), ("token", token), ("uid", uid)):
            # Missing refresh/cookie/token/sid never erase a prior credential.
            if value and cfg.get(key) != value:
                cfg[key] = value
                changed = True
        if observed > old_obs:
            cfg["auth_observed_at"] = observed
            changed = True
        if changed:
            atomic_write(config_path, cfg)
        return {"skipped": stable, "has_refresh": bool(cfg.get("new_api_refresh")), "observed_at": cfg.get("auth_observed_at")}

def save_probe(config_path, lock_path, values):
    """把成功刷新响应中的轮换值在同一把锁内合并写入。"""
    with locked(lock_path):
        cfg = read_config(config_path)
        uid = values.get("uid", "")
        if uid and cfg.get("uid") and str(uid) != str(cfg.get("uid")):
            for key in SECRET_FIELDS:
                cfg.pop(key, None)
        for key in ("new_api_refresh", "cookie", "token", "sid", "uid"):
            value = values.get(key)
            if isinstance(value, str) and value:
                cfg[key] = value
        cfg["auth_verified_at"] = __import__("time").time_ns() // 1_000_000
        atomic_write(config_path, cfg)
        return cfg
