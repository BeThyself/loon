// Adapted from ZHT0711/xingchi-api-loon-egern @ e8ec098a1ee379313276b959b2ba098423ff441a.
// Loon-only: test the shipped Loon core; omit Egern-specific adapters.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const loon = fs.readFileSync(new URL('../xingchi.loon.js', import.meta.url), 'utf8');
const core = loon.slice(loon.indexOf('function createXingchi(io)'));
const KEY = 'xingchi.auth.v1';
const NOW = 1_800_000_000_000;
const BASE = 'https://xingchiapi.com/api/v1';
const statusPath = '/user/checkin?timezone=Asia%2FShanghai';
function jwt(id, expiry = NOW + 3_600_000, marker = 'test') {
  return Buffer.from('{"alg":"none"}').toString('base64url') + '.' +
    Buffer.from(JSON.stringify({ sub: String(id), exp: expiry / 1000, marker })).toString('base64url') + '.mock';
}
function good(data) { return { status: 200, body: JSON.stringify({ code: 0, message: 'success', data }) }; }
function claimed(overrides = {}) { return { enabled: true, claimed_today: true, amount: 3, total_count: 5, total_amount: 15, ...overrides }; }
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function harness(handler = () => { throw Error('Unexpected HTTP'); }) {
  const storage = new Map(), notices = [], logs = [], calls = [];
  const context = vm.createContext({ console: { log() {} }, Math, Date });
  vm.runInContext(core + '\nglobalThis.make = createXingchi;', context);
  const io = {
    get: k => storage.get(k), set: (k, v) => storage.set(k, v), now: () => NOW,
    notify: (...n) => notices.push(n), log: x => logs.push(x), debug: true,
    http: async (method, url, headers, body) => {
      const call = { method, url, path: url.slice(BASE.length), headers, body };
      calls.push(call); return handler(call, calls.length);
    }
  };
  const app = context.make(io);
  return { app, storage, notices, logs, calls, state: () => JSON.parse(storage.get(KEY) || '{}') };
}
function capture(h, id = 1, access = jwt(id), refresh = 'mock-refresh-' + id, extra = {}) {
  h.app.capture({ url: BASE + '/auth/login', status: 200, body: good({ access_token: access, refresh_token: refresh, expires_in: 3600, user: { id }, ...extra }).body });
  return h.state();
}

test('captures paired token response but ignores pending 2FA without saving CAPTCHA/password', () => {
  const h = harness();
  h.app.capture({ url: BASE + '/auth/login', status: 200, body: good({ requires_2fa: true, temp_token: 'mock-pending', access_token: jwt(1), refresh_token: 'mock-refresh', password: 'mock-password' }).body });
  assert.equal(h.storage.has(KEY), false);
  capture(h, 1, jwt(1), 'mock-refresh-1', { password: 'mock-password', turnstile_token: 'mock-captcha' });
  assert.equal(h.state().refresh, 'mock-refresh-1');
  assert.equal(h.state().subject, '1');
  assert.doesNotMatch(h.storage.get(KEY), /mock-password|mock-captcha/);
  assert.equal(h.notices.length, 1);
});

test('header fallback preserves a known refresh pair for the same account', () => {
  const h = harness(), before = capture(h);
  h.app.capture({ url: BASE + '/auth/me', authorization: 'Bearer ' + jwt(1, NOW + 7_200_000, 'other'), body: null });
  assert.equal(h.state().access, before.access);
  assert.equal(h.state().refresh, before.refresh);
  assert.equal(h.state().generation, before.generation);
});

test('header fallback updates a changed account and rejects expired or foreign-domain tokens', () => {
  const h = harness(); capture(h);
  h.app.capture({ url: BASE + '/auth/me', authorization: 'Bearer ' + jwt(2), body: null });
  assert.equal(h.state().subject, '2'); assert.equal(h.state().refresh, '');
  const before = h.storage.get(KEY);
  for (const url of ['http://xingchiapi.com/api/v1/auth/me', 'https://xingchiapi.com.evil.test/api/v1/auth/me', BASE + '/user/profile']) {
    h.app.capture({ url, authorization: 'Bearer ' + jwt(3), body: null });
  }
  h.app.capture({ url: BASE + '/auth/me', authorization: 'Bearer ' + jwt(3, NOW - 1_000), body: null });
  assert.equal(h.storage.get(KEY), before);
});

test('expired manual access refreshes, persists rotated pair, and unchanged settings do not restore old seed', async () => {
  const settings = { ACCESS_TOKEN: jwt(1, NOW - 1_000), REFRESH_TOKEN: 'mock-old-refresh', ACTION: 'login' };
  const h = harness(c => {
    if (c.path === '/auth/refresh') {
      assert.equal(c.body.refresh_token, 'mock-old-refresh'); assert.equal(c.headers.Authorization, undefined);
      return good({ access_token: jwt(1), refresh_token: 'mock-rotated-refresh', expires_in: 3600 });
    }
    assert.equal(c.path, '/auth/me?timezone=Asia%2FShanghai');
    assert.equal(c.headers.Authorization, 'Bearer ' + jwt(1));
    assert.equal(c.headers['X-User-UI-Request'], '1');
    return good({ id: 1, balance: 50 });
  });
  await h.app.execute(settings); await h.app.execute(settings);
  assert.equal(h.calls.filter(c => c.path === '/auth/refresh').length, 1);
  assert.equal(h.state().refresh, 'mock-rotated-refresh');
  assert.equal(h.notices.at(-1)[1], '登录状态有效');
});

test('refresh-only seed can obtain an access token', async () => {
  const h = harness(c => c.path === '/auth/refresh' ? good({ access_token: jwt(1), refresh_token: 'mock-new-refresh', expires_in: 3600 }) : good({ balance: 1 }));
  await h.app.execute({ REFRESH_TOKEN: 'mock-refresh-only', ACTION: 'login' });
  assert.equal(h.state().refresh, 'mock-new-refresh'); assert.equal(h.calls[0].path, '/auth/refresh');
});

test('already claimed status avoids POST and reports real total/balance', async () => {
  const h = harness(c => {
    assert.equal(c.method, 'GET');
    if (c.path === statusPath) return good(claimed());
    assert.equal(c.path, '/auth/me?timezone=Asia%2FShanghai'); return good({ balance: 60 });
  }); capture(h);
  await h.app.execute({});
  assert.equal(h.calls.length, 2); assert.equal(h.notices.at(-1)[1], '今日已签到');
  assert.match(h.notices.at(-1)[2], /累计签到：5 次/); assert.match(h.notices.at(-1)[2], /当前余额：\$60\.00/);
  assert.doesNotMatch(h.notices.at(-1)[2], /本次奖励/);
});

test('successful claim uses server reward including zero, no body and no balance-delta guessing', async () => {
  const h = harness(c => {
    if (c.path === statusPath) return good(claimed({ claimed_today: false }));
    if (c.path === '/user/checkin') { assert.equal(c.method, 'POST'); assert.equal(c.body, undefined); return good({ amount: 0, status: claimed({ total_amount: 12 }) }); }
    return good({ balance: 700 });
  }); capture(h); await h.app.execute({});
  assert.equal(h.notices.at(-1)[1], '签到成功'); assert.match(h.notices.at(-1)[2], /本次奖励：\$0\.00/);
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
});

test('ambiguous POST network failure confirms status and never repeats claim POST', async () => {
  let statuses = 0;
  const h = harness(c => {
    if (c.path === statusPath) return good(claimed({ claimed_today: ++statuses > 1 }));
    if (c.path === '/user/checkin') throw Error('mock network failed after committed');
    return good({ balance: 10 });
  }); capture(h); await h.app.execute({});
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
  assert.equal(h.notices.at(-1)[1], '今日已签到（状态已确认）');
  assert.doesNotMatch(h.notices.at(-1)[2], /本次奖励/);
});

test('already-claimed conflict reason is confirmed with fresh status', async () => {
  let statuses = 0;
  const h = harness(c => {
    if (c.path === statusPath) return good(claimed({ claimed_today: ++statuses > 1 }));
    if (c.path === '/user/checkin') return { status: 409, body: JSON.stringify({ code: 'CONFLICT', reason: 'CHECKIN_ALREADY_CLAIMED', message: 'Already claimed' }) };
    return good({ balance: 9 });
  }); capture(h); await h.app.execute({});
  assert.equal(h.notices.at(-1)[1], '今日已签到（状态已确认）'); assert.equal(statuses, 2);
});

test('network/server errors never expose raw credentials or server text in logs/notification', async () => {
  const h = harness(() => ({ status: 403, body: JSON.stringify({ code: 'FORBIDDEN', message: 'mock-secret-token mock-password mock-captcha', metadata: { token: 'mock-secret-token' } }) }));
  capture(h, 1, jwt(1), 'mock-secret-token'); await h.app.execute({ ACTION: 'login' });
  assert.equal(h.notices.at(-1)[1], '运行未完成');
  assert.doesNotMatch(JSON.stringify([...h.notices, ...h.logs]), /mock-secret-token|mock-password|mock-captcha/);
});

for (const changedAccount of [false, true]) {
  test(`pending refresh does not overwrite newer ${changedAccount ? 'account' : 'session'} capture`, async () => {
    const ready = deferred(), response = deferred();
    const h = harness(c => { assert.equal(c.path, '/auth/refresh'); ready.resolve(); return response.promise; });
    await Promise.resolve();
    const running = h.app.execute({ ACTION: 'login', ACCESS_TOKEN: jwt(1, NOW - 1_000), REFRESH_TOKEN: 'mock-old-refresh' });
    await ready.promise;
    const id = changedAccount ? 2 : 1;
    capture(h, id, jwt(id, NOW + 9_000_000, 'newer'), 'mock-newer-session');
    const newer = h.storage.get(KEY);
    response.resolve(good({ access_token: jwt(1), refresh_token: 'mock-stale-refresh-response', expires_in: 3600 }));
    await running;
    assert.equal(h.storage.get(KEY), newer); assert.equal(h.calls.length, 1);
    assert.equal(h.notices.at(-1)[1], '运行未完成');
  });
}

test('failed pending refresh does not erase newer captured pair', async () => {
  const ready = deferred(), response = deferred();
  const h = harness(() => { ready.resolve(); return response.promise; });
  const running = h.app.execute({ ACTION: 'login', ACCESS_TOKEN: jwt(1, NOW - 1_000), REFRESH_TOKEN: 'mock-old-refresh' });
  await ready.promise; capture(h, 2, jwt(2), 'mock-newer-refresh'); const newer = h.storage.get(KEY);
  response.resolve({ status: 401, body: JSON.stringify({ code: 'UNAUTHORIZED', message: 'invalid refresh' }) });
  await running; assert.equal(h.storage.get(KEY), newer);
});

test('ACTION clear forgets stored auth and unchanged manual seeds cannot silently restore it', async () => {
  const h = harness(), settings = { ACCESS_TOKEN: jwt(1), REFRESH_TOKEN: 'mock-manual-seed' };
  await h.app.execute({ ...settings, ACTION: 'clear' });
  assert.equal(h.state().access, undefined); assert.equal(h.state().refresh, undefined);
  assert.ok(h.state().seed);
  await h.app.execute({ ...settings, ACTION: 'login' });
  assert.equal(h.calls.length, 0); assert.equal(h.notices.at(-1)[1], '运行未完成');
});

test('malformed manual credentials are rejected without replacing a known session', async () => {
  const h = harness(); capture(h); const before = h.storage.get(KEY);
  for (const setting of [{ ACCESS_TOKEN: 'mock-access\r\nInjected: yes' }, { REFRESH_TOKEN: 'mock-refresh\u0000' }, { ACCESS_TOKEN: ' '.repeat(3) }]) {
    await h.app.execute({ ACTION: 'login', ...setting });
    assert.equal(h.storage.get(KEY), before); assert.equal(h.calls.length, 0);
    assert.equal(h.notices.at(-1)[1], '运行未完成');
    assert.match(h.notices.at(-1)[2], /格式无效/);
  }
});

test('ACTION clear still clears the known session when manual settings contain malformed tokens', async () => {
  const h = harness(); capture(h);
  await h.app.execute({ ACTION: 'clear', ACCESS_TOKEN: 'mock-access\r\ninvalid', REFRESH_TOKEN: 'mock-refresh\u0000' });
  assert.equal(h.state().access, undefined); assert.equal(h.state().refresh, undefined);
  assert.equal(h.notices.at(-1)[1], '本地会话已清除'); assert.equal(h.calls.length, 0);
});

test('refresh authentication failure forgets expired pair but transient failure preserves it', async () => {
  for (const status of [401, 503]) {
    const h = harness(() => ({ status, body: JSON.stringify({ code: 'ERROR', message: 'server text' }) }));
    const old = capture(h, 1, jwt(1, NOW - 1_000), 'mock-retained', { expires_in: 0 });
    await h.app.execute({ ACTION: 'login' });
    assert.equal(h.calls.length, 1); assert.equal(h.calls[0].path, '/auth/refresh');
    if (status === 401) assert.equal(h.state().refresh, undefined);
    else assert.equal(h.state().refresh, old.refresh);
  }
});

test('malformed POST success with confirmed subsequent status does not invent a reward', async () => {
  let statuses = 0;
  const h = harness(c => {
    if (c.path === statusPath) return good(claimed({ claimed_today: ++statuses > 1 }));
    if (c.path === '/user/checkin') return { status: 200, body: '{"code":0,"message":"success"}' };
    return good({ balance: 1 });
  }); capture(h); await h.app.execute({});
  assert.equal(h.notices.at(-1)[1], '签到成功');
  assert.doesNotMatch(h.notices.at(-1)[2], /undefined|NaN|本次奖励/);
});

test('Loon response interception calls done({}) exactly once without changing response', async () => {
  const storage = new Map(), done = [], notices = [];
  const raw = good({ access_token: jwt(1, Date.now() + 3_600_000), refresh_token: 'mock-loon-refresh', expires_in: 3600, user: { id: 1 } }).body;
  const original = { status: 200, body: raw, headers: { 'Content-Type': 'application/json' } };
  const context = vm.createContext({ console: { log() {} }, Date, Math,
    $request: { url: BASE + '/auth/login', headers: {} }, $response: original,
    $persistentStore: { read: k => storage.get(k), write: (v, k) => { storage.set(k, v); return true; } },
    $notification: { post: (...n) => notices.push(n) }, $done: value => done.push(value) });
  await vm.runInContext(loon, context);
  assert.equal(done.length, 1); assert.equal(JSON.stringify(done[0]), '{}');
  assert.equal(original.body, raw); assert.equal(JSON.parse(storage.get(KEY)).refresh, 'mock-loon-refresh');
  assert.equal(notices[0][3].openUrl, 'https://xingchiapi.com/dashboard');
});

test('Loon scheduled adapter serializes refresh and disables insecure TLS, redirects and cookies', async () => {
  const storage = new Map(), calls = [], done = [];
  const context = vm.createContext({ console: { log() {} }, Date, Math,
    $argument: { action: 'login', access_token: jwt(1, Date.now() - 1_000), refresh_token: 'mock-loon-old' },
    $persistentStore: { read: k => storage.get(k), write: (v, k) => { storage.set(k, v); return true; } },
    $notification: { post() {} }, $done: value => done.push(value),
    $httpClient: {
      post: (options, cb) => { calls.push(options); cb(null, { status: 200 }, good({ access_token: jwt(1, Date.now() + 3_600_000), refresh_token: 'mock-loon-rotated', expires_in: 3600 }).body); },
      get: (options, cb) => { calls.push(options); cb(null, { status: 200 }, good({ balance: 3 }).body); }
    }
  });
  await vm.runInContext(loon, context);
  assert.equal(calls[0].url, BASE + '/auth/refresh'); assert.equal(JSON.parse(calls[0].body).refresh_token, 'mock-loon-old');
  assert.equal(calls[0].insecure, false); assert.equal(calls[0]['auto-redirect'], false); assert.equal(calls[0]['auto-cookie'], false);
  assert.equal(calls[0].timeout, 15000);
  assert.equal(done.length, 1); assert.equal(JSON.parse(storage.get(KEY)).refresh, 'mock-loon-rotated');
});

const plugin = fs.readFileSync(new URL('../xingchi.loon.lpx', import.meta.url), 'utf8');
test('all three plugin entrypoints load the bundled script from this repository', () => {
  const refs = [...plugin.matchAll(/script\("([^"\n]+)"/g)].map(m => m[1]);
  assert.deepEqual(refs, Array(3).fill('https://raw.githubusercontent.com/BeThyself/loon/main/xingchi/xingchi.loon.js'));
});
test('plugin attribution and schedule follow repository conventions', () => {
  assert.match(plugin, /^#!author=thyself$/m);
  assert.match(plugin, /ZHT0711\/xingchi-api-loon-egern/);
  assert.match(plugin, /cron "0 9 \* \* \*"/);
  assert.match(plugin, /^hostname = xingchiapi\.com$/m);
});
test('capture URL guards match only the intended HTTPS auth endpoints', () => {
  const rules = [...plugin.matchAll(/^(request|response) if \$\{url\} ~= (\/.*\/) then script/gm)];
  assert.equal(rules.length, 2);
  for (const [, kind, literal] of rules) {
    const pattern = new RegExp(literal.slice(1, -1));
    const path = kind === 'request' ? '/auth/me' : '/auth/login';
    assert.ok(pattern.test(BASE + path));
    assert.ok(pattern.test(BASE + path + '?a=1'));
    assert.equal(pattern.test('https://xingchiapi.com.evil.test/api/v1' + path), false);
    assert.equal(pattern.test('http://xingchiapi.com/api/v1' + path), false);
  }
});
