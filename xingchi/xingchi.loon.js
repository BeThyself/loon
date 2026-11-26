/*
 * 星驰 API · 登录会话刷新 / 每日签到 · 2026-11-19
 * Inspired by @773075692 and MaYIHEI's AgentRouter check-in workflow.
 * https://github.com/MaYIHEI/paperclip/blob/main/loon/agentrouter/agentrouter.lpx
 * This is a fresh implementation for xingchiapi.com's Sub2API endpoints.
 * Keep tokens in Loon storage/settings; never publish them with these files.
 */
(async () => {
  const interception = typeof $request !== 'undefined';
  const args = typeof $argument === 'object' && $argument ? $argument : {};
  const io = {
    get: key => $persistentStore.read(key),
    set: (key, value) => { if (!$persistentStore.write(value, key)) throw new Error('storage'); },
    now: () => Date.now(),
    debug: args.debug === true || args.debug === 'true',
    log: text => console.log('[星驰 API] ' + text),
    notify: (title, subtitle, body, url) => $notification.post(title, subtitle, body, { openUrl: url }),
    http: (method, url, headers, body) => new Promise((resolve, reject) => {
      const options = { url, headers, timeout: 15000, insecure: false, 'auto-redirect': false, 'auto-cookie': false };
      if (body !== undefined) options.body = JSON.stringify(body);
      $httpClient[method.toLowerCase()](options, (error, response, text) => {
        if (error || !response) reject(new Error('network'));
        else resolve({ status: Number(response.status || response.statusCode), body: text });
      });
    })
  };
  const app = createXingchi(io);
  if (interception) {
    try {
      const headers = $request.headers || {};
      const key = Object.keys(headers).find(k => k.toLowerCase() === 'authorization');
      app.capture({ url: $request.url, authorization: key ? headers[key] : '',
        status: typeof $response !== 'undefined' ? Number($response.status || $response.statusCode) : 0,
        body: typeof $response !== 'undefined' ? $response.body : null });
    } catch (_) { console.log('[星驰 API] 登录信息获取失败；原请求继续。'); }
    finally { $done({}); }
  } else {
    try { await app.execute(args); } finally { $done(); }
  }
})().catch(() => {
  console.log('[星驰 API] 脚本环境初始化失败。');
  if (typeof $request !== 'undefined') $done({}); else $done();
});

/* Shared implementation, embedded into each standalone mobile script. */
function createXingchi(io) {
  const ROOT = 'https://xingchiapi.com/api/v1';
  const PAGE = 'https://xingchiapi.com/dashboard';
  const KEY = 'xingchi.auth.v1';
  const LOCK = 'xingchi.run.lock.v1';
  const ownError = (message, status, reason) => Object.assign(new Error(message), { safe: true, status, reason });
  const read = () => { try { return JSON.parse(io.get(KEY) || '{}'); } catch (_) { return {}; } };
  const write = value => io.set(KEY, JSON.stringify(value));
  const token = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 16384
    && !/[\r\n\x00]/.test(value) ? value.trim().replace(/^Bearer\s+/i, '') : '';
  const number = value => typeof value === 'number' && Number.isFinite(value);
  const money = value => number(value) ? value.toFixed(2) : null;
  const notify = (subtitle, body) => io.notify('星驰 API', subtitle, body, PAGE);
  function jwt(value) {
    try {
      const part = value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
      let bits = 0, acc = 0, out = '';
      for (const ch of part.replace(/=+$/, '')) {
        const x = alphabet.indexOf(ch); if (x < 0) return {};
        acc = (acc << 6) | x; bits += 6;
        if (bits >= 8) { bits -= 8; out += String.fromCharCode((acc >> bits) & 255); }
      }
      const data = JSON.parse(out);
      return { subject: String(data.sub || data.user_id || ''), expiresAt: number(data.exp) ? data.exp * 1000 : 0 };
    } catch (_) { return {}; }
  }
  function stamp() { return String(io.now()) + '.' + Math.random().toString(36).slice(2); }
  function seedID(access, refresh) {
    // Identifies a changed manual setting; never used as an authentication hash.
    let a = 2166136261, b = 5381;
    for (const ch of access + '\n' + refresh) { a = Math.imul(a ^ ch.charCodeAt(0), 16777619); b = Math.imul(b, 33) ^ ch.charCodeAt(0); }
    return (a >>> 0).toString(16) + ':' + (b >>> 0).toString(16);
  }
  function authState(access, refresh, expiresIn, userID, previous) {
    const parsed = jwt(access);
    return {
      access, refresh, subject: parsed.subject || (userID ? String(userID) : ''),
      expiresAt: number(expiresIn) && expiresIn > 0 ? io.now() + expiresIn * 1000 : parsed.expiresAt || 0,
      generation: stamp(), seed: previous.seed || '', updatedAt: io.now()
    };
  }
  function path(url) {
    const m = /^https:\/\/xingchiapi\.com(?::443)?(\/api\/v1\/[^?#]*)(?:[?#]|$)/.exec(url || '');
    return m ? m[1].slice('/api/v1'.length) : '';
  }
  function capture(event) {
    const endpoint = path(event.url);
    if (!endpoint) return;
    const before = read();
    if (event.body != null && endpoint.startsWith('/auth/') && event.status >= 200 && event.status < 300) {
      let envelope; try { envelope = JSON.parse(event.body); } catch (_) { return; }
      if (!envelope || envelope.code !== 0 || !envelope.data) return;
      const data = envelope.data;
      if (data.requires_2fa === true) return;
      const access = token(data.access_token), refresh = token(data.refresh_token);
      if (!access) return;
      // Only accept an actual token response; never save passwords or CAPTCHA tokens.
      const next = authState(access, refresh, data.expires_in, data.user && data.user.id, before);
      if (endpoint === '/auth/refresh' && before.subject && next.subject && before.subject !== next.subject) return;
      write(next);
      if (!before.refresh || before.subject !== next.subject) {
        notify('登录信息已获取', refresh ? '已保存会话，可手动运行签到；后续会自动刷新登录状态。' : '已获取短期 Token；请等待网页刷新或重新登录，以获取刷新令牌。');
      }
      return;
    }
    if (endpoint !== '/auth/me' || event.body != null) return;
    const access = token(event.authorization);
    if (!access || !/^Bearer\s+/i.test(event.authorization || '')) return;
    const parsed = jwt(access);
    if (parsed.expiresAt && parsed.expiresAt <= io.now()) return;
    if (before.access === access) return;
    const sameAccount = !!before.subject && before.subject === parsed.subject;
    // Header capture is only a fallback. Keep a known refresh pair for this account.
    if (before.refresh && (sameAccount || !parsed.subject)) return;
    if (!before.refresh && sameAccount && before.expiresAt > (parsed.expiresAt || 0)) return;
    write(authState(access, '', null, null, before));
    if (!before.access || (before.subject && before.subject !== parsed.subject)) {
      notify('已获取临时登录状态', '请重新登录或保持网页打开，等待刷新令牌捕获成功后再运行签到。');
    }
  }
  async function request(method, endpoint, state, body) {
    const headers = { Accept: 'application/json', 'Accept-Language': 'zh', 'X-User-UI-Request': '1' };
    if (state && state.access) headers.Authorization = 'Bearer ' + state.access;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (io.debug) io.log(method + ' ' + endpoint.split('?')[0]);
    let response;
    try { response = await io.http(method, ROOT + endpoint, headers, body); }
    catch (_) { throw ownError('网络请求失败或超时；请稍后重试。'); }
    let data; try { data = JSON.parse(response.body); } catch (_) {
      throw ownError('网站返回非 JSON 响应；请在网页检查访问验证。', response.status);
    }
    if (response.status < 200 || response.status >= 300 || !data || data.code !== 0) {
      const reason = data && data.reason;
      const status = response.status;
      let message = '接口返回异常（HTTP ' + status + '）；请到网页核对。';
      if (status === 401) message = '登录状态已失效，请重新登录以获取会话。';
      if (status === 403) message = '网站拒绝请求，请在网页完成验证后重新获取会话。';
      if (status === 429) message = '请求过于频繁，请稍后重试。';
      if (status >= 300 && status < 400) message = '网站返回重定向，已停止请求；请到网页检查。';
      throw ownError(message, status, reason);
    }
    return data.data;
  }
  function current(state) {
    const saved = read();
    if (saved.generation !== state.generation) {
      throw ownError('登录信息在运行中发生变化，请重新运行签到。');
    }
  }
  async function refresh(state) {
    current(state);
    if (!state.refresh) throw ownError('缺少刷新令牌，请重新登录并等待“登录信息已获取”通知。');
    let data;
    try { data = await request('POST', '/auth/refresh', null, { refresh_token: state.refresh }); }
    catch (error) {
      // Never overwrite a newer capture or erase credentials after a transient network failure.
      if ((error.status === 400 || error.status === 401) && read().generation === state.generation) {
        write({ seed: state.seed || '', generation: stamp() });
        throw ownError('刷新令牌已失效，请重新登录获取新会话。');
      }
      throw error;
    }
    current(state);
    const access = token(data && data.access_token), nextRefresh = token(data && data.refresh_token);
    if (!access || !nextRefresh) throw ownError('刷新响应缺少令牌；请在网页重新登录。');
    const next = authState(access, nextRefresh, data.expires_in, null, state);
    if (state.subject && next.subject && state.subject !== next.subject) throw ownError('刷新响应账号不匹配，已停止签到。');
    write(next);
    return next;
  }
  function importSettings(settings) {
    for (const name of ['access_token', 'ACCESS_TOKEN', 'refresh_token', 'REFRESH_TOKEN']) {
      if (settings[name] && !token(settings[name])) throw ownError('手动令牌格式无效，请检查输入内容。');
    }
    const access = token(settings.access_token || settings.ACCESS_TOKEN);
    const refreshToken = token(settings.refresh_token || settings.REFRESH_TOKEN);
    const saved = read();
    if (!access && !refreshToken) return saved;
    const seed = seedID(access, refreshToken);
    if (saved.seed === seed) return saved; // Keep the rotated refresh token on subsequent runs.
    const state = authState(access, refreshToken, null, null, { seed });
    write(state); return state;
  }
  async function run(settings) {
    settings = settings || {};
    const action = String(settings.action || settings.ACTION || 'checkin').trim().toLowerCase() || 'checkin';
    if (!['checkin', 'login', 'clear'].includes(action)) throw ownError('action 请填写 checkin、login 或 clear。');
    if (action === 'clear') {
      // Keep the settings fingerprint so an unchanged manual token is not silently restored.
      const state = read();
      const access = token(settings.access_token || settings.ACCESS_TOKEN);
      const refreshToken = token(settings.refresh_token || settings.REFRESH_TOKEN);
      const seed = access || refreshToken ? seedID(access, refreshToken) : state.seed || '';
      write({ seed, generation: stamp() });
      notify('本地会话已清除', '继续使用时请重新捕获登录，或填写一组新的手动令牌。');
      return;
    }
    const lock = Number(io.get(LOCK) || '0');
    if (lock > io.now() - 180000 && lock <= io.now()) { notify('已有任务运行中', '请等待当前任务完成。'); return; }
    const lockValue = String(io.now()); io.set(LOCK, lockValue);
    try {
      let state = importSettings(settings);
      if (!state.access && !state.refresh) throw ownError('尚未获取登录信息，请开启模块后在星驰网页正常登录一次。');
      let refreshed = false;
      if (!state.access || (state.expiresAt && state.expiresAt <= io.now() + 120000)) {
        if (state.refresh) { state = await refresh(state); refreshed = true; }
        else if (!state.access || state.expiresAt <= io.now()) throw ownError('临时 Token 已到期，请重新登录并获取刷新令牌。');
      }
      const authed = async (method, endpoint) => {
        current(state);
        try { const data = await request(method, endpoint, state); current(state); return data; }
        catch (error) {
          if (error.status === 401 && !refreshed && state.refresh) {
            state = await refresh(state); refreshed = true;
            const data = await request(method, endpoint, state); current(state); return data;
          }
          throw error;
        }
      };
      if (action === 'login') {
        const user = await authed('GET', '/auth/me?timezone=Asia%2FShanghai');
        if (!user || typeof user !== 'object') throw ownError('登录验证响应缺少用户信息。');
        notify('登录状态有效', money(user.balance) !== null ? '当前余额：$' + money(user.balance) : '当前会话可以正常访问账户。');
        return;
      }
      const statusPath = '/user/checkin?timezone=Asia%2FShanghai';
      let status = await authed('GET', statusPath);
      if (!status || typeof status.enabled !== 'boolean' || typeof status.claimed_today !== 'boolean') {
        throw ownError('签到状态格式与预期不符，请到网页核对。');
      }
      if (!status.enabled) { notify('签到未开放', '网站当前未启用每日签到。'); return; }
      let title = '今日已签到', reward = null;
      if (!status.claimed_today) {
        try {
          const claimed = await authed('POST', '/user/checkin');
          if (claimed && claimed.status && claimed.status.claimed_today === true) status = claimed.status;
          else status = await authed('GET', statusPath);
          if (!status || status.claimed_today !== true) throw ownError('领取接口已返回，但签到状态未确认，请到网页核对。');
          title = '签到成功'; reward = claimed ? money(claimed.amount) : null;
        } catch (error) {
          if (error.reason === 'CHECKIN_ALREADY_CLAIMED' || !error.status || error.status >= 500) {
            current(state);
            try { status = await authed('GET', statusPath); } catch (_) { throw error; }
            if (!status || status.claimed_today !== true) throw error;
            title = '今日已签到（状态已确认）';
          } else throw error;
        }
      }
      const lines = [];
      if (reward !== null) lines.push('本次奖励：$' + reward);
      if (number(status.total_count)) lines.push('累计签到：' + status.total_count + ' 次');
      if (money(status.total_amount) !== null) lines.push('累计奖励：$' + money(status.total_amount));
      try {
        const user = await authed('GET', '/auth/me?timezone=Asia%2FShanghai');
        if (user && money(user.balance) !== null) lines.push('当前余额：$' + money(user.balance));
      } catch (_) { lines.push('余额查询暂未成功，可到网页查看。'); }
      if (!state.refresh) lines.push('当前仅有短期 Token，请重新登录获取刷新令牌。');
      notify(title, lines.join('\n') || '网站已确认今日签到。');
    } finally {
      if (io.get(LOCK) === lockValue) io.set(LOCK, '');
    }
  }
  async function execute(settings) {
    try { await run(settings); }
    catch (error) { notify('运行未完成', error && error.safe ? error.message : '脚本运行异常，请检查配置后重试。'); }
  }
  return { capture, execute };
}
