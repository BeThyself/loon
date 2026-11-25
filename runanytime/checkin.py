#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""runanytime.hxi.me（随时跑路公益站）每日签到

站点是 New-API，但签到是私有 PoW 扩展：
  GET  /api/user/pow/challenge?action=checkin  -> challenge_id / prefix / difficulty
  计算 SHA-256(prefix + 8位小写hex计数器) 前 difficulty 个 bit 全为 0
  POST /api/user/checkin?pow_challenge=..&pow_nonce=..

登录接口需要 Turnstile，脚本不做登录：只用捕获的 new_api_refresh Cookie 续期短期 Bearer；self 有效时不刷新。

用法：python3 checkin.py
配置：同目录 config.json
"""

import hashlib
import json
import os
import sys
import time
from urllib import request, error
import auth_store
import http.cookiejar
from auth_probe import Probe

HERE = os.path.dirname(os.path.abspath(__file__))
LOCK_PATH = os.path.join(HERE, "config.lock")
CFG_PATH = os.path.join(HERE, "config.json")
BASE = "https://runanytime.hxi.me"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
MAX_DIFFICULTY = 26       # 超过这个难度直接放弃，避免长时间烧 CPU
SOLVE_DEADLINE = 9.0      # challenge 默认 10 秒 TTL


def log(msg):
    print(time.strftime("[%Y-%m-%d %H:%M:%S] ") + str(msg), flush=True)


def load_cfg():
    with open(CFG_PATH, encoding="utf-8") as f:
        return json.load(f)


def load_tg(cfg):
    tg = cfg.get("telegram") or {}
    if tg.get("bot_token") and tg.get("chat_id"):
        return tg
    try:
        with open("/opt/auto-update/config.json", encoding="utf-8") as f:
            t = json.load(f).get("telegram", {})
        return {"bot_token": t.get("bot_token", ""), "chat_id": t.get("chat_id", "")}
    except Exception:
        return tg


SITE = "随时跑路"


def notify(cfg, title, body):
    if not str(title).startswith("["):
        title = "[%s] %s" % (SITE, title)
    text = "**%s**\n%s" % (title, body)
    log(text.replace("\n", " / "))
    tg = load_tg(cfg)
    if not tg.get("bot_token") or not tg.get("chat_id"):
        log("未配置 TG，跳过推送")
        return
    payload = json.dumps({"chat_id": tg["chat_id"], "text": text,
                          "disable_web_page_preview": True}).encode()
    req = request.Request("https://api.telegram.org/bot%s/sendMessage" % tg["bot_token"],
                          data=payload, headers={"Content-Type": "application/json"})
    try:
        request.urlopen(req, timeout=15).read()
    except Exception as e:
        log("TG 推送失败")


class Session(Probe):
    def __init__(self, cfg):
        super().__init__(cfg)

    def call(self, path, method="GET", body=None, timeout=25):
        return self._call(path,method,body=body)

    def persist(self, cfg):
        with auth_store.locked(LOCK_PATH):
            current=auth_store.read_config(CFG_PATH)
            if any(current.get(k) != self.cfg.get(k) for k in ("new_api_refresh","token","sid","uid","auth_observed_at")):
                return False
            cookie,refresh=self._rotated()
            current.update(token=self.token,sid=self.sid,uid=self.uid,cookie=cookie,cookie_jar=self.cookie_records())
            if refresh: current["new_api_refresh"]=refresh
            auth_store.atomic_write(CFG_PATH,current)
            self.cfg=current.copy()
            cfg.update(current)
            return True


def refresh_token(sess, cfg):
    result=sess.refresh(CFG_PATH,LOCK_PATH)
    if not result.get("ok"):
        log("refresh失败 status=%s code=%s" % (result.get("status"),result.get("code")))
        return False
    with auth_store.locked(LOCK_PATH): cfg.update(auth_store.read_config(CFG_PATH))
    sess.cfg=cfg.copy()
    return True


STATE_PATH = os.path.join(HERE, "state.json")


def beijing_date(timestamp=None):
    return time.strftime("%Y-%m-%d", time.gmtime((timestamp if timestamp is not None else time.time()) + 8*3600))

def done_today(state, uid, today=None):
    # Legacy state had date/how only; preserve manual-checkin suppression for today.
    if not isinstance(state,dict) or state.get("date") != (today or beijing_date()): return False
    return not state.get("uid") or str(state.get("uid")) == str(uid)

def mark_done(how, uid=""):
    try:
        auth_store.atomic_write(STATE_PATH,{"date":beijing_date(),"uid":str(uid),"how":how})
    except Exception:
        log("写 state 失败")


def save_cfg(cfg):
    with auth_store.locked(LOCK_PATH):
        current=auth_store.read_config(CFG_PATH)
        current.update(cfg)
        auth_store.atomic_write(CFG_PATH,current)


def solve_pow(prefix, difficulty, deadline=SOLVE_DEADLINE):
    """SHA-256(prefix + hex8(counter)) 前 difficulty bit 全 0"""
    start = time.time()
    counter = 0
    pfx = prefix.encode()
    limit = 1 << difficulty
    while counter <= 0xFFFFFFFF:
        nonce = "%08x" % counter
        h = hashlib.sha256(pfx + nonce.encode()).digest()
        if int.from_bytes(h, "big") >> (256 - difficulty) == 0:
            return nonce, time.time() - start, counter
        counter += 1
        if (counter & 0x3FFF) == 0 and time.time() - start > deadline:
            return None, time.time() - start, counter
    return None, time.time() - start, counter


def money(q):
    try:
        return "$%.2f" % (float(q) / 500000.0)
    except Exception:
        return "?"


def main():
    with auth_store.locked(LOCK_PATH):
        cfg = load_cfg()
    cookie = (cfg.get("cookie") or "").strip()
    token = (cfg.get("token") or "").strip()
    if not cookie and not token and not cfg.get("new_api_refresh"):
        notify(cfg, "❌ 未配置凭证",
               "请在浏览器登录 runanytime.hxi.me，用抓取插件投递 Cookie / Bearer，或手动填进 config.json")
        return 1

    sess = Session(cfg)
    sess.user_agent = cfg.get("user_agent") or UA
    if token:
        sess.token = token
    sess.uid = str(cfg.get("uid") or "").strip()

    if os.path.exists(STATE_PATH):
        try:
            with open(STATE_PATH,encoding="utf-8") as f: state=json.load(f)
            if done_today(state,sess.uid):
                log("今天该账号已处理，跳过签到")
                return 0
        except Exception: pass

    # 0. 用现有 access token 优先验证；仅失效且具备 refresh Cookie 时显式续期。
    status, info = sess.call("/api/user/self")
    refreshed = False
    if status != 200 or not (isinstance(info,dict) and info.get("success",True)):
        if cfg.get("new_api_refresh") and status in (200,401):
            log("self验证失败，尝试一次refresh")
            if refresh_token(sess,cfg):
                refreshed=True
                status,info=sess.call("/api/user/self")
        if status != 200 or not (isinstance(info,dict) and info.get("success",True)):
            notify(cfg,"❌ 登录态失效","HTTP %s；停止签到，请显式运行 auth_probe.py --verify 或 --refresh 后更新浏览器凭证" % (status or "network"))
            return 1

    data = info.get("data") or {}
    if data.get("id"):
        sess.uid = str(data["id"])
    who = data.get("display_name") or data.get("username") or ""
    log("登录态正常: %s (id=%s) 余额 %s" % (who, sess.uid, money(data.get("quota"))))

    # 不做无条件 refresh；成功self验证时将 cookie jar 的轮换持久化。
    if not sess.persist(cfg):
        log("凭证被并发更新，停止本次签到")
        return 1

    # 2. challenge
    status, ch = sess.call("/api/user/pow/challenge?action=checkin")
    if status != 200:
        notify(cfg, "❌ 获取 PoW challenge 失败",
               "HTTP %s · %s" % (status, "invalid_challenge"))
        return 1
    payload = ch.get("data") if isinstance(ch, dict) else None
    if not isinstance(payload, dict):
        notify(cfg, "❌ challenge 返回异常", "invalid_challenge")
        return 1
    cid = payload.get("challenge_id") or payload.get("challengeId") or ""
    prefix = payload.get("prefix") or ""
    difficulty = int(payload.get("difficulty") or 0)
    log("challenge: id=%s difficulty=%s prefix=%s…" % (str(cid)[:8], difficulty, prefix[:8]))

    if difficulty <= 0 or not prefix or not cid:
        notify(cfg, "❌ challenge 字段缺失", "invalid_challenge")
        return 1
    if difficulty > MAX_DIFFICULTY:
        notify(cfg, "⚠️ 难度过高，已跳过",
               "difficulty=%s 超过上限 %s，避免长时间占用 CPU" % (difficulty, MAX_DIFFICULTY))
        return 1

    # 3. 解 PoW
    nonce, elapsed, tries = solve_pow(prefix, difficulty)
    if nonce is None:
        notify(cfg, "❌ PoW 超时", "difficulty=%s 在 %.1fs 内没解出来（试了 %s 次）"
               % (difficulty, elapsed, tries))
        return 1
    log("PoW 解出: nonce=%s 用时 %.2fs 尝试 %s 次" % (nonce, elapsed, tries))

    # 4. 提交
    path = "/api/user/checkin?pow_challenge=%s&pow_nonce=%s" % (cid, nonce)
    status, res = sess.call(path, "POST", body={})
    msg = ""
    ok = False
    if isinstance(res, dict):
        msg = str(res.get("message") or (res.get("data") or {}).get("message") or "")
        ok = bool(res.get("success"))

    if status == 401 or status == 403:
        notify(cfg, "❌ 签到被拒", "HTTP %s · %s\nCookie 或 token 失效，请更新 config.json" % (status, "auth_failed"))
        return 1
    if not ok and any(k in msg for k in ("已签到", "已经签到", "already", "重复")):
        _, info3 = sess.call("/api/user/self")
        d3 = (info3 or {}).get("data") or {}
        notify(cfg, "ℹ️ 今日已签到", "%s\n余额 %s · 已用 %s" % ("already_checked_in", money(d3.get("quota")), money(d3.get("used_quota"))))
        sess.persist(cfg)
        mark_done("already",sess.uid)
        return 0

    if not ok:
        notify(cfg, "❌ 签到失败", "HTTP %s · %s" % (status, "request_failed"))
        return 1

    # 5. 余额
    _, info2 = sess.call("/api/user/self")
    d2 = (info2 or {}).get("data") or {}
    notify(cfg, "✅ 签到成功",
           "%s\n余额 %s · 已用 %s%s" % ("checkin_ok", money(d2.get("quota")), money(d2.get("used_quota")),
                                     (" · " + who) if who else ""))
    sess.persist(cfg)
    mark_done("ok",sess.uid)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        notify(load_cfg(), "❌ 脚本异常", "internal_error")
        sys.exit(1)
