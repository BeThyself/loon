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
const VERSION = "3.2.1";
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
			storeWrite(STORAGE_ROOT, theme);
			console.log(`[BiliTheme] 主题已保存:「${theme.name}」(item_id: ${theme.item_id}, 套装部件数: ${theme.ids.length})`);
			reply(200, { saved: true, ...theme });
			return;
		}
		default:
			reply(404, { error: "unknown endpoint: " + sub });
	}
})();
