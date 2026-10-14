/* 由 tools/build.js 生成：主题配置持久化 API */
/**
 * BiliTheme: Settings API
 * 哔哩主题 — 主题配置持久化 API（http-request 脚本，三端通用）
 *
 * 端点:
 *   POST /settings/theme/api/select  body: item_id=xx[&ids=a,b,c][&name=xx][&cover=xx]
 *   GET  /settings/theme/api/config  → 当前选中的主题信息
 *
 * 存储结构:
 *   $persistentStore["BiliTheme"] = { item_id, name, ids, cover }
 */
const VERSION = "3.2.1-loon.3";
const STORAGE_ROOT = "BiliTheme";
const BASE = "/settings/theme/api";

const $app = typeof $loon !== "undefined" ? "Loon"
	: typeof $environment !== "undefined" && $environment["surge-version"] ? "Surge"
	: typeof $task !== "undefined" ? "Quantumult X"
	: "Unknown";

function storeRead(root) {
	let raw;
	if ($app === "Quantumult X") raw = $prefs.valueForKey(root);
	else raw = $persistentStore.read(root);
	if (typeof raw !== "string") return raw ?? {};
	try { return JSON.parse(raw); } catch { return {}; }
}

function storeWrite(root, obj) {
	const raw = JSON.stringify(obj);
	if ($app === "Quantumult X") return $prefs.setValueForKey(raw, root);
	return $persistentStore.write(raw, root);
}

function reply(status, data, cors = true) {
	const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
	if (cors) headers["Access-Control-Allow-Origin"] = "*";
	const body = typeof data === "string" ? data : JSON.stringify(data);
	if ($app === "Quantumult X") $done({ status, headers, body });
	else $done({ response: { status, headers, body } });
}

const SUIT_CACHE_KEY = "BiliTheme.suit";

/* **************** 素材预拉取 ****************
 * 在用户点衣服图标（/select）时就把整套素材拉好写进缓存，
 * 这样冷启动的 /x/resource/show/skin 响应路径上就是零网络请求。
 * 与 bili-theme.response.js 里的同源逻辑保持一致。
 */
const GARB_BENEFIT = "https://api.bilibili.com/x/garb/v2/user/suit/benefit?item_id=";
const GARB_SUIT_DETAIL = "https://api.bilibili.com/x/garb/v2/mall/suit/detail?item_id=";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function httpGet(url, timeoutMs = 6000) {
	return new Promise((resolve) => {
		let settled = false, timer = null;
		const fin = (v) => { if (settled) return; settled = true; if (timer) { try { clearTimeout(timer); } catch {} } resolve(v); };
		const ok = (text) => { try { fin(JSON.parse(text)); } catch { fin(null); } };
		if (typeof setTimeout === "function") timer = setTimeout(() => fin(null), timeoutMs);
		const done = (err, resp, data) => {
			if (err) return fin(null);
			const body = typeof data === "string" ? data : (typeof resp?.body === "string" ? resp.body : null);
			if (body == null) return fin(null);
			ok(body);
		};
		if ($app === "Quantumult X") {
			$task.fetch({ url, headers: { "User-Agent": UA } }).then((resp) => ok(resp?.body), () => fin(null));
		} else {
			$httpClient.get({ url, headers: { "User-Agent": UA } }, done);
		}
	});
}

function extractParts(d) {
	const si = (d && d.suit_items) || {};
	const pick = (k) => (Array.isArray(si[k]) ? si[k][0] : si[k]) || null;
	const p = (d && d.properties) || {};
	const own = { item_id: String(d?.item_id ?? ""), name: d?.name || "", properties: p };
	const gSkin = pick("skin");
	const skin = gSkin?.properties?.package_url ? gSkin : (p.package_url ? own : null);
	const gLoad = pick("loading");
	const loading = gLoad?.properties?.loading_url ? gLoad : (p.loading_url ? own : null);
	const gBg = pick("space_bg");
	const bp = gBg?.properties || {};
	const spaceBg = (bp.image1_landscape || bp.image1_portrait || gBg?.images) ? gBg
		: ((p.image1_landscape || p.image1_portrait || d?.images) ? own : null);
	return { skin, loading, spaceBg };
}

async function fetchItemFull(id) {
	let j = await httpGet(GARB_BENEFIT + id + "&part=emoji_package");
	if (j && j.code === 0 && j.data && (j.data.suit_items !== undefined || j.data.properties)) return j.data;
	j = await httpGet(GARB_SUIT_DETAIL + id + "&part=suit");
	if (j && j.code === 0 && j.data) return j.data;
	return null;
}

async function prefetchSuit(itemId, ids) {
	try {
		const uniq = [...new Set((ids && ids.length ? ids : [itemId]).map(String).filter(Boolean))];
		const items = await Promise.all(uniq.map((id) => fetchItemFull(id).catch(() => null)));
		const parts = { skin: null, loading: null, spaceBg: null };
		let name = "";
		for (const item of items) {
			if (!item) continue;
			const p = extractParts(item);
			if (!parts.skin && p.skin) { parts.skin = p.skin; name = item.name || ""; }
			if (!parts.loading && p.loading) parts.loading = p.loading;
			if (!parts.spaceBg && p.spaceBg) parts.spaceBg = p.spaceBg;
		}
		if (!parts.skin || !parts.skin.properties?.package_url) {
			console.log(`[BiliTheme] 预拉取失败: ${items.filter(Boolean).length}/${uniq.length} 个部件`);
			return;
		}
		storeWrite(SUIT_CACHE_KEY, {
			for: String(itemId),
			name: name || parts.skin.name || String(itemId),
			item_id: String(parts.skin.item_id || itemId),
			ids: uniq,
			skin: parts.skin,
			loading: parts.loading,
			space_bg: parts.spaceBg,
		});
		console.log(`[BiliTheme] 预拉取完成:「${name || parts.skin.name}」${uniq.length} 个部件`);
	} catch {}
}

(async () => {
	const urlStr = $request.url;
	const u = new URL(urlStr.replace(/^https?:\/\//, "https://"));
	const path = u.pathname;
	if (!path.startsWith(BASE)) { $done({}); return; }
	const sub = path.slice(BASE.length);

	/* POST 表单解析 */
	let form = {};
	if ($request.body && typeof $request.body === "string") {
		for (const kv of $request.body.split("&")) {
			const i = kv.indexOf("=");
			if (i > 0) form[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, " "));
		}
	}

	switch (sub) {
		case "/config": {
			const d = storeRead(STORAGE_ROOT);
			const theme = d?.item_id ? d : (d?.config?.skin || null);
			reply(200, { theme: theme || null });
			return;
		}
		case "/select": {
			const itemId = String(form.item_id || "").trim();
			if (!itemId) {
				console.log("[BiliTheme] 保存失败: 请求缺少 item_id 参数");
				reply(400, { error: "missing item_id" });
				return;
			}
			const idsStr = String(form.ids || itemId).trim();
			const ids = idsStr ? idsStr.split("&").filter(Boolean) : [itemId];
			const theme = {
				item_id: itemId,
				name: String(form.name || "个性装扮").trim(),
				ids: ids,
				cover: String(form.cover || "").trim(),
			};
			// 清理早期诊断版留下的两个键，避免占着持久化存储
			try {
				if ($app === "Quantumult X") { $prefs.removeValueForKey("BiliTheme.diag"); $prefs.removeValueForKey("BiliTheme.trace"); }
				else { $persistentStore.write(undefined, "BiliTheme.diag"); $persistentStore.write(undefined, "BiliTheme.trace"); }
			} catch {}
			storeWrite(STORAGE_ROOT, theme);
			console.log(`[BiliTheme] 主题已保存:「${theme.name}」(item_id: ${theme.item_id}, 套装部件数: ${theme.ids.length})`);
			// 关键：在这里预拉取素材，别留到冷启动的响应路径上
			await prefetchSuit(itemId, ids);
			reply(200, { saved: true, ...theme });
			return;
		}
		default:
			reply(404, { error: "unknown endpoint: " + sub });
	}
})();
