/* 由 tools/build.js 生成：主题配置持久化 API */
/**
 * BiliTheme: Settings API
 * 哔哩主题 — 主题配置持久化 API（http-request 脚本，五端通用）
 *
 * 端点:
 *   POST /settings/theme/api/select  body: item_id=xx[&ids=a,b,c][&name=xx][&cover=xx][&splashes=json][&act_id=xx]
 *   GET  /settings/theme/api/config  → 当前选中的主题信息
 *
 * 存储结构:
 *   $persistentStore["BiliTheme"]     = { item_id, name, ids, cover, splashes?, spaces?, act_id? }
 *   $persistentStore["BiliThemeMeta"] = { [imageUrl]: { hash, size } }（轻量开屏素材元数据持久化缓存）
 */
const VERSION = "4.1.0";
const STORAGE_ROOT = "BiliTheme";
const BASE = "/settings/theme/api";

const $app = typeof $loon !== "undefined" ? "Loon"
	: typeof $environment !== "undefined" && $environment["surge-version"] ? "Surge"
	: typeof $task !== "undefined" ? "Quantumult X"
	: typeof $environment !== "undefined" && $environment["stash-version"] ? "Stash"
	: typeof Egern !== "undefined" ? "Egern"
	: (typeof globalThis !== "undefined" && globalThis.$environment?.["surge-version"]) ? "Surge"
	: (typeof globalThis !== "undefined" && globalThis.$environment?.["stash-version"]) ? "Stash"
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

const StatusTexts = {
	200: "OK",
	400: "Bad Request",
	404: "Not Found",
	500: "Internal Server Error",
};

function reply(status, data, cors = true) {
	const headers = {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
		"Access-Control-Allow-Origin": "*",
		"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
		"Access-Control-Allow-Headers": "*",
	};
	const body = typeof data === "string" ? data : JSON.stringify(data);
	if ($app === "Quantumult X") {
		const statusLine = typeof status === "number" ? `HTTP/1.1 ${status} ${StatusTexts[status] || "OK"}` : status;
		$done({ status: statusLine, headers, body });
	} else {
		$done({ response: { status, headers, body } });
	}
}

(async () => {
	const urlStr = $request.url;
	const u = new URL(urlStr.replace(/^https?:\/\//, "https://"));
	const path = u.pathname;
	if (!path.startsWith(BASE)) { $done({}); return; }
	const sub = path.slice(BASE.length);

	/* 表单参数解析（兼容 POST body 与 GET query） */
	let form = {};
	if ($request.body && typeof $request.body === "string") {
		for (const kv of $request.body.split("&")) {
			const i = kv.indexOf("=");
			if (i > 0) form[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, " "));
		}
	}
	// GET 参数兜底补充
	for (const [k, v] of u.searchParams.entries()) {
		if (form[k] === undefined) form[k] = v;
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
			let splashes = null;
			if (form.splashes) {
				try {
					const parsed = JSON.parse(form.splashes);
					if (Array.isArray(parsed) && parsed.length > 0) splashes = parsed;
				} catch {}
			}
			let spaces = null;
			if (form.spaces) {
				try {
					const parsed = JSON.parse(form.spaces);
					if (Array.isArray(parsed) && parsed.length > 0) spaces = parsed;
				} catch {}
			}
			const theme = {
				item_id: itemId,
				name: String(form.name || "个性装扮").trim(),
				ids: ids,
				cover: String(form.cover || "").trim(),
			};
			if (splashes) theme.splashes = splashes;
			if (spaces) theme.spaces = spaces;
			if (form.act_id) theme.act_id = String(form.act_id).trim();
			storeWrite(STORAGE_ROOT, theme);
			const extraDesc = (splashes ? `, 典藏全屏开屏: ${splashes.length}张` : "") + (spaces ? `, 空间高清头图: ${spaces.length}套` : "");
			console.log(`[BiliTheme] 主题已保存:「${theme.name}」(item_id: ${theme.item_id}, 套装部件数: ${theme.ids.length}${extraDesc})`);
			reply(200, { saved: true, ...theme });
			return;
		}
		default:
			reply(404, { error: "unknown endpoint: " + sub });
	}
})();
