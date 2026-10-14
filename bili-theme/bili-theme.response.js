/* 由 tools/build.js 生成：响应改写脚本 */
/**
 * BiliTheme: Theme Response
 * 哔哩主题 — 官方装扮商城详情页原生衣服图标一键注入（三端通用）
 *
 * 拦截范围:
 *   www.bilibili.com/h5/mall/(digital-card/home|suit/detail) → 原生衣服图标接管与注入
 *   app.bilibili.com/x/resource/show/skin                   → 注入主题皮肤 + 加载动画
 *   app.bilibili.com/x/v2/space                             → 注入个人空间头图
 *   app.bilibili.com/x/v2/splash/brand/list                 → 注入开屏画面装扮
 *
 * 存储结构:
 *   $persistentStore["BiliTheme"] = { item_id, name, ids, cover }
 *
 * MITM hostname: app.bilibili.com, www.bilibili.com
 */
const VERSION = "3.2.1";
const STORAGE_ROOT = "BiliTheme";
let modified = false;

/* **************** 平台适配层 **************** */
const $app = typeof $loon !== "undefined" ? "Loon"
	: typeof $environment !== "undefined" && $environment["surge-version"] ? "Surge"
	: typeof $task !== "undefined" ? "Quantumult X"
	: typeof $environment !== "undefined" && $environment["stash-version"] ? "Stash"
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

/* **************** 配置读取 **************** */
function getTheme() {
	const d = storeRead(STORAGE_ROOT);
	if (d && typeof d === "object") {
		if (d.item_id) return d;
		if (d.config && d.config.skin && d.config.skin.item_id) return d.config.skin;
	}
	return null;
}
function getSettings() {
	const theme = getTheme();
	return { Switch: !!theme, Skin: theme || {} };
}

/* **************** garb API **************** */
const GARB_BENEFIT = "https://api.bilibili.com/x/garb/v2/user/suit/benefit?item_id=";
const GARB_SUIT_DETAIL = "https://api.bilibili.com/x/garb/v2/mall/suit/detail?item_id=";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const validStr = (s) => (typeof s === "string" && s.trim() ? s.trim() : null);

/**
 * 从单个 item 数据里探测可见部件:
 *   普通装扮: suit_items.{skin,loading,space_bg}[0].properties
 *   卡池单品: 顶层 properties
 */
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

/**
 * 提取 space_bg 中的多套图片列表 [{ landscape, portrait, isFallback? }]
 * 1. 若本身包含 images 数组（如自定义/导入结构），直接转换返回；
 * 2. 扫描平铺键 image1..image9（官方标准格式）；
 * 3. 兜底策略（方案 B）: 扫描 skin.properties.head_myself_squared_bg，用于无独立 space_bg 的单品/动态主题。
 */
function extractAllSpaceImages(spaceBg, skin) {
	const images = [];
	// 1. 若已有 images 数组
	const directList = spaceBg?.images || spaceBg?.properties?.images;
	if (Array.isArray(directList) && directList.length > 0) {
		for (const img of directList) {
			const land = img.landscape || img.portrait;
			const port = img.portrait || img.landscape;
			if (land || port) images.push({ landscape: land, portrait: port });
		}
		if (images.length > 0) return images.slice(0, 15);
	}
	// 2. 扫描平铺键 image1..image15（对齐官方 App 空间头图 15 张上限）
	const sp = spaceBg?.properties || {};
	for (let i = 1; i <= 15; i++) {
		const land = sp[`image${i}_landscape`];
		const port = sp[`image${i}_portrait`];
		if (land || port) {
			images.push({
				landscape: land || port,
				portrait: port || land,
			});
		}
	}
	if (images.length > 0) return images.slice(0, 15);
	// 3. 方案 B 智能多级兜底（用于无独立 space_bg 的单品/动态主题）:
	//    优先: head_myself_squared_bg（老版单品大图，如双鱼座）
	//    次选: image_cover || image_preview（装扮官方主视觉封面，如终冕）
	//    末选: cover（装扮顶层封面）
	const skinP = skin?.properties || {};
	const fallback = validStr(skinP.head_myself_squared_bg)
		|| validStr(skinP.image_cover)
		|| validStr(skinP.image_preview)
		|| validStr(skin?.cover)
		|| null;
	if (fallback) {
		images.push({ landscape: fallback, portrait: fallback, isFallback: true });
	}
	return images;
}

/** 拉单个 item 完整数据：benefit 优先（卡池单品唯一可用），失败回落 mall/suit/detail */
async function fetchItemFull(id) {
	let j = await httpGet(GARB_BENEFIT + id + "&part=emoji_package");
	if (j && j.code === 0 && j.data && (j.data.suit_items !== undefined || j.data.properties)) return j.data;
	j = await httpGet(GARB_SUIT_DETAIL + id + "&part=suit");
	if (j && j.code === 0 && j.data) return j.data;
	return null;
}

/**
 * 获取套装数据。
 * 按 ids（同套装多个部件 item）逐个探测后合并；仅保留皮肤/加载动画/空间头图三组。
 */
async function fetchSuit(itemId, ids) {
	const uniq = [...new Set((ids && ids.length ? ids : [itemId]).map(String).filter(Boolean))];
	const parts = { skin: null, loading: null, spaceBg: null };
	let name = "";
	for (const id of uniq) {
		const item = await fetchItemFull(id);
		if (!item) continue;
		const p = extractParts(item);
		if (!parts.skin && p.skin) { parts.skin = p.skin; name = item.name || ""; }
		if (!parts.loading && p.loading) parts.loading = p.loading;
		if (!parts.spaceBg && p.spaceBg) parts.spaceBg = p.spaceBg;
	}
	if (!parts.skin || !parts.skin.properties?.package_url) return null;
	return {
		name: name || parts.skin.name || String(itemId),
		item_id: String(parts.skin.item_id || itemId),
		ids: uniq,
		skin: parts.skin,
		loading: parts.loading,
		space_bg: parts.spaceBg,
	};
}

/** 跨平台 HTTP GET JSON */
function httpGet(url, timeoutMs = 8000) {
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

/* **************** 注入: 原生衣服图标接管 **************** */
const DETAIL_INJECT_SNIPPET = `<style id="bili-theme-inject-style">
.bt-toast{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(.9);background:rgba(20,20,20,.88);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.15);color:#fff;padding:13px 20px;border-radius:14px;z-index:1000000;pointer-events:none;opacity:0;transition:all .22s cubic-bezier(.2,.8,.2,1);box-shadow:0 8px 32px rgba(0,0,0,.45);text-align:center;width:max-content;max-width:92vw;box-sizing:border-box}
.bt-toast.bt-show{opacity:1;transform:translate(-50%,-50%) scale(1)}
.bt-toast-title{font-size:14.5px;font-weight:600;color:#fff;line-height:1.4}
.bt-toast-name{font-size:13px;font-weight:500;color:rgba(255,255,255,.88);margin-top:4px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.bt-toast-tip{font-size:13px;font-weight:500;color:rgba(255,255,255,.8);margin-top:5px;line-height:1.4}
</style>
<div class="bt-toast" id="btToast">
  <div class="bt-toast-title" id="btToastTitle"></div>
  <div class="bt-toast-name" id="btToastName"></div>
  <div class="bt-toast-tip" id="btToastTip"></div>
</div>
<script>
(function(){
if(window.__biliThemeInjected)return;
window.__biliThemeInjected=true;
var cur=null;
function toast(title,name,tip){
  var t=document.getElementById("btToast");var tt=document.getElementById("btToastTitle");var tn=document.getElementById("btToastName");var tp=document.getElementById("btToastTip");
  if(!t||!tt)return;
  tt.textContent=title||"";
  if(tn){tn.textContent=name||"";tn.style.display=name?"block":"none";}
  if(tp){tp.textContent=tip||"";tp.style.display=tip?"block":"none";}
  t.classList.add("bt-show");
  clearTimeout(t._tm);
  t._tm=setTimeout(function(){t.classList.remove("bt-show")},tip?3500:2600);
}
var _f=window.fetch;
if(typeof _f==="function"){
  window.fetch=async function(){
    var res=await _f.apply(this,arguments);
    try{
      var u=typeof arguments[0]==="string"?arguments[0]:(arguments[0]&&arguments[0].url)||"";
      if(u.indexOf("garb/v2/mall/suit/detail")!==-1||u.indexOf("garb/v2/user/suit/benefit")!==-1){
        res.clone().json().then(function(j){
          var d=j&&j.data;if(!d)return;
          var si=d.suit_items||{};var sk=Array.isArray(si.skin)?si.skin[0]:si.skin;
          var id=(sk&&sk.item_id)||d.item_id;
          var allIds=[d.item_id,sk&&sk.item_id,si.space_bg&&si.space_bg[0]&&si.space_bg[0].item_id].filter(Boolean).join("&");
          if(id){cur={item_id:String(id),ids:allIds||String(id),name:d.name||(sk&&sk.name)||"个性装扮",cover:(d.properties&&d.properties.image_cover)||(sk&&sk.properties&&sk.properties.image_cover)||""}}
        }).catch(function(){})
      }
    }catch(e){}
    return res;
  };
}

async function handleInject(){
  var p=new URLSearchParams(window.location.search);
  var act=p.get("act_id");var id=p.get("id");
  var suit=null;
  if(act){
    toast("正在识别当前卡池装扮…","");
    try{
      var activeEl=document.querySelector(".tab-item.active,.tab-item[class*='active'],[class*='tab'][class*='active']");
      var activeTitle=(activeEl?activeEl.textContent:"").trim();
      var tabIdx=-1;
      if(activeEl&&activeEl.parentNode){
        var allTabs=Array.prototype.slice.call(activeEl.parentNode.children);
        tabIdx=allTabs.indexOf(activeEl);
      }
      var r=await _f("https://api.bilibili.com/x/vas/dlc_act/asset_bag?act_id="+act).then(function(x){return x.json()});
      var d=r&&r.data;
      var cl=(d&&d.collect_list)||[];
      var sl=((d&&d.lottery_simple_list)||[]).filter(function(x){return Number(x&&x.lottery_id)!==0});
      var matchedLottery=null;
      if(sl.length>0){
        if(activeTitle){
          matchedLottery=sl.find(function(x){
            return x&&x.lottery_name&&(activeTitle.indexOf(x.lottery_name)!==-1||x.lottery_name.indexOf(activeTitle)!==-1);
          });
        }
        if(!matchedLottery&&tabIdx>=0&&tabIdx<sl.length){
          matchedLottery=sl[tabIdx];
        }
      }
      var target=null;
      if(matchedLottery){
        target=cl.find(function(x){
          return Number(x&&x.redeem_item_type)===5&&String(x&&x.lottery_id)===String(matchedLottery.lottery_id);
        });
      }
      if(!target){
        target=cl.find(function(x){return Number(x&&x.redeem_item_type)===5});
      }
      if(target){
        suit={
          item_id:String(target.redeem_item_id||"").split("&")[0],
          ids:String(target.redeem_item_id||""),
          name:target.redeem_item_name||target.name||(matchedLottery?matchedLottery.lottery_name+"个性主题":"活动主题套装"),
          cover:target.redeem_item_image||target.redeem_detail_image||""
        };
      }
    }catch(err){}
  }else if(id){
    if(cur&&cur.item_id===String(id)){
      suit=cur;
    }else{
      toast("正在获取装扮详情…","");
      try{
        var r=await _f("https://api.bilibili.com/x/garb/v2/user/suit/benefit?item_id="+id+"&part=emoji_package").then(function(x){return x.json()});
        var dt=(r&&r.data)||{};
        var si=dt.suit_items||{};var sk=Array.isArray(si.skin)?si.skin[0]:si.skin;
        var realId=(sk&&sk.item_id)||dt.item_id||id;
        var allIds=[dt.item_id,sk&&sk.item_id,id,si.space_bg&&si.space_bg[0]&&si.space_bg[0].item_id].filter(Boolean).join("&");
        suit={
          item_id:String(realId),
          ids:allIds||String(realId),
          name:dt.name||(sk&&sk.name)||"个性装扮",
          cover:(dt.properties&&dt.properties.image_cover)||(sk&&sk.properties&&sk.properties.image_cover)||""
        };
        cur=suit;
      }catch(err){}
    }
  }else if(cur){
    suit=cur;
  }
  if(!suit||!suit.item_id){toast("未检测到可注入主题","");return}
  toast("正在注入装扮与预热缓存…","👕「"+suit.name+"」");
  try{
    if(suit.cover){try{var _im=new Image();_im.src=suit.cover}catch(e){}}
    var qs=new URLSearchParams({item_id:suit.item_id,ids:suit.ids,name:suit.name,cover:suit.cover||""}).toString();
    var sv=await _f("https://app.bilibili.com/settings/theme/api/select",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:qs}).then(function(x){return x.json()});
    if(sv&&sv.saved){
      await new Promise(function(resolve){setTimeout(resolve,1000)});
      toast("🎉 装扮注入成功","👕「"+(sv.name||suit.name)+"」","🔄 重启哔哩哔哩后生效，部分装扮可能需要重启两次");
    }else{
      toast((sv&&sv.error)||"注入失败","");
    }
  }catch(err){toast("请求失败，请检查网络与代理","");}
}

function findTshirtEl(){
  var share=document.querySelector('.share-icon,[class*="share-icon"],[class*="share"]');
  if(share&&share.previousElementSibling)return share.previousElementSibling;
  var allIcons=document.querySelectorAll('.icon,[class*="icon"],svg');
  for(var i=0;i<allIcons.length;i++){
    var it=allIcons[i];
    var iconAttr=(it.getAttribute&&it.getAttribute("icon"))||"";
    if(iconAttr.indexOf("tshirt")!==-1)return it;
  }
  for(var j=0;j<allIcons.length;j++){
    var el=allIcons[j];
    if(el.closest&&el.closest('.share-icon,[class*="share"],[class*="back"]'))continue;
    var r=el.getBoundingClientRect();
    if(r.top>=0&&r.top<100&&r.right>(window.innerWidth-130)&&r.right<(window.innerWidth-30))return el;
  }
  return null;
}

function updateOverlay(){
  var target=findTshirtEl();
  if(!target)return;
  var r=target.getBoundingClientRect();
  if(r.width<=0||r.height<=0)return;
  var ov=document.getElementById("btTshirtOverlay");
  if(!ov){
    ov=document.createElement("div");
    ov.id="btTshirtOverlay";
    ov.style.cssText="position:fixed;z-index:9999999;cursor:pointer;-webkit-tap-highlight-color:transparent;background:transparent;";
    ov.addEventListener("click",function(e){
      e.stopPropagation();
      e.preventDefault();
      handleInject();
    });
    ov.addEventListener("touchstart",function(e){e.stopPropagation();},{passive:true});
    document.body.appendChild(ov);
  }
  ov.style.left=Math.max(0,r.left-6)+"px";
  ov.style.top=Math.max(0,r.top-6)+"px";
  ov.style.width=(r.width+12)+"px";
  ov.style.height=(r.height+12)+"px";
  ov.style.display="block";
}

var _cnt=0;
var _tm=setInterval(function(){
  updateOverlay();
  _cnt++;
  if(_cnt>40){clearInterval(_tm);setInterval(updateOverlay,1200);}
},150);
window.addEventListener("scroll",updateOverlay,{passive:true});
window.addEventListener("resize",updateOverlay);

document.addEventListener("click",function(e){
  var el=e.target;
  var t=findTshirtEl();
  if(t&&(t===el||(t.contains&&t.contains(el)))){
    e.stopPropagation();
    e.stopImmediatePropagation();
    e.preventDefault();
    handleInject();
  }
},true);
})();
</script>`;

function injectDetailHtml(html) {
	if (typeof html !== "string" || html.includes("bili-theme-inject-style")) return html;
	if (html.includes("</body>")) {
		return html.replace("</body>", DETAIL_INJECT_SNIPPET + "\n</body>");
	}
	return html + DETAIL_INJECT_SNIPPET;
}

/* **************** 注入: 皮肤 + 加载动画 **************** */
function buildUserEquip(skin) {
	const p = skin.properties || {};
	const bool = (v) => v === "true" ? true : v === "false" ? false : v;
	// data 字段顺序注意: side_bg_color 必须在 color_second_page 之后（App 解析约束）
	const data = {
		color_mode: p.color_mode ?? "light",
		color: p.color ?? "#212121",
		color_second_page: p.color_second_page ?? "#ffffff",
	};
	if (p.side_bg_color !== undefined) data.side_bg_color = p.side_bg_color;
	if (p.tail_color !== undefined) data.tail_color = p.tail_color;
	if (p.tail_color_selected !== undefined) data.tail_color_selected = p.tail_color_selected;
	if (p.tail_icon_ani !== undefined) data.tail_icon_ani = bool(p.tail_icon_ani);
	if (p.tail_icon_ani_mode !== undefined) data.tail_icon_ani_mode = p.tail_icon_ani_mode;
	if (p.tail_icon_mode !== undefined) data.tail_icon_mode = p.tail_icon_mode;
	if (p.head_myself_mp4_play !== undefined) data.head_myself_mp4_play = p.head_myself_mp4_play;

	return {
		id: Number(skin.item_id || 0),
		name: skin.name || "",
		package_url: p.package_url || "",
		package_md5: p.package_md5 || "",
		ver: Number(p.ver || 0),
		data,
	};
}

function buildLoadEquip(loading) {
	if (!loading?.properties?.loading_url) return null;
	return {
		id: Number(loading.item_id || 0),
		loading_url: loading.properties.loading_url,
		ver: Number(loading.properties.ver || 0),
	};
}

/** 注入 skin/loading 到 /x/resource/show/skin 响应 */
async function injectSkinResponse(data, skinConfig) {
	const itemId = skinConfig?.item_id;
	if (!itemId) return data;
	const suit = await fetchSuit(itemId, skinConfig.ids);
	if (!suit?.skin) {
		console.log(`[BiliTheme] 警告: 未获取到主题皮肤素材 (item_id: ${itemId})，已放行原始响应`);
		return data;
	}
	data.data = data.data || {};
	const ue = buildUserEquip(suit.skin);
	data.data.user_equip = ue;
	data.data.skin_colors = data.data.skin_colors || [];
	data.data.skin_colors.push({ id: ue.id, color_mode: ue.data.color_mode });
	const le = buildLoadEquip(suit.loading);
	if (le) data.data.load_equip = le;
	modified = true;
	const parts = ["皮肤", le ? "加载动画" : null].filter(Boolean).join("+");
	console.log(`[BiliTheme] 皮肤与加载动画注入成功:「${suit.name || skinConfig.name || "个性装扮"}」(${parts})`);
	return data;
}

/* **************** 注入: 个人空间头图 **************** */
function injectSpaceBg(data, suit, images) {
	const targetImages = (images || []).slice(0, 15);
	if (!targetImages || targetImages.length === 0) return data;
	data.data = data.data || {};
	const d = data.data;
	d.images = d.images || {};

	const bgId = Number(suit?.space_bg?.id || suit?.space_bg?.item_id || suit?.item_id || 0);

	// 1. 同步外层首屏与默认底图（取第 1 套 landscape，确保首屏秒开）
	d.images.imgUrl = targetImages[0].landscape;
	d.images.night_imgurl = targetImages[0].landscape;
	d.images.has_garb = true;

	// 2. 构造精简的 top.result 列表（仅用于空间 Carousel 轮播，切断与收藏馆关联）
	const results = targetImages.map((img, idx) => {
		const isFallback = !!img.isFallback;
		const itemIdStr = bgId ? `${bgId}-${idx}` : `space-${idx}`;
		return {
			biz_type: 1,
			biz_id: bgId,
			item_id: itemIdStr,
			item: {
				item_type: 1,
				item_id: itemIdStr,
				image: {
					default_image: img.landscape, // 空间主页轮播展示: 方形/横向大图
					long_image: img.portrait,
					shape_type: 1,
					width: 1242,
					height: isFallback ? 1073 : 1988,
				},
				extra: {
					show_in_collection: false, // 明确切断：不在收藏馆中展示（仅作为空间头图）
					show_in_space: true,        // 空间头图展示与左右滑动
				},
				garb_extra: {
					space_item_id: bgId,
					space_item_index: idx,
				},
			},
			title: {
				title: suit.name || "个性装扮",
			},
		};
	});

	d.images.collection_top_simple = d.images.collection_top_simple || {};
	d.images.collection_top_simple.top = {
		count: results.length,
		result: results,
	};

	modified = true;
	return data;
}

/**
 * 判定是否启用个人空间头图注入:
 * 默认值: false（保护用户原本个人空间头图）
 * 多平台多态传参深度适配:
 *   - Loon 原生对象: $argument.spaceBg === true (Loon 3.2.1+ 标准规范)
 *   - 原生布尔值/数字: true / 1
 *   - Surge 键值对字符串: argument="spaceBg={{{spaceBg}}}" → "spaceBg=true"
 *   - 纯字符串/JSON: "true", "{\"spaceBg\":true}"
 *   - Quantumult X: 由于 QX 不支持 argument 传参，若命中本规则（用户主动解除规则注释）则直接视为开启
 */
function isSpaceBgEnabled() {
	if ($app === "Quantumult X") return true;
	if (typeof $argument === "boolean") return $argument;
	if (typeof $argument === "number") return $argument === 1;

	// Loon 原生对象（$argument.spaceBg / $argument.space）
	if ($argument && typeof $argument === "object") {
		const v = $argument.spaceBg ?? $argument.space ?? $argument.enableSpace;
		if (typeof v === "boolean") return v;
		if (typeof v === "string") return v.toLowerCase() === "true" || v === "1";
		if (typeof v === "number") return v === 1;
	}

	// 字符串形式（Surge 模块参数 / JSON / 裸布尔字符串）
	if (typeof $argument === "string" && $argument.trim()) {
		const str = $argument.trim().toLowerCase();
		if (str === "true" || str === "1") return true;
		if (str === "false" || str === "0") return false;
		try {
			const obj = JSON.parse(str);
			if (obj && typeof obj === "object") {
				const v = obj.spaceBg ?? obj.space ?? obj.enableSpace;
				if (typeof v === "boolean") return v;
				if (typeof v === "string") return v.toLowerCase() === "true" || v === "1";
				if (typeof v === "number") return v === 1;
			}
		} catch {}
		const m = str.match(/(?:^|[,;&])(?:spacebg|space|enablespace)\s*=\s*(true|false|1|0)/);
		if (m) return m[1] === "true" || m[1] === "1";
	}
	return false;
}

async function handleSpaceResponse(data, skinConfig, vmid, reqMid) {
	if (!skinConfig?.item_id) return data;
	// 仅改写自己的个人空间
	if (vmid && reqMid && String(vmid) !== String(reqMid)) return data;
	const suit = await fetchSuit(skinConfig.item_id, skinConfig.ids);
	if (!suit) return data;
	const images = extractAllSpaceImages(suit.space_bg, suit.skin);
	if (!images || images.length === 0) return data;
	const res = injectSpaceBg(data, suit, images);
	const countDesc = images[0].isFallback ? "主画封面/我的页大图垫入" : `${images.length}套头图`;
	console.log(`[BiliTheme] 空间头图注入成功:「${suit.name || skinConfig.name || "个性装扮"}」(${countDesc}, UID: ${vmid || reqMid || "当前用户"})`);
	return res;
}

/* **************** 注入: 开屏画面装扮 **************** */

/**
 * 判定是否启用开屏画面注入:
 * 默认值: true（默认开启一体化沉浸体验；用户自选官方开屏时可手动关闭）
 * 多平台多态传参深度适配:
 *   - Loon 原生对象: $argument.splashBg !== false
 *   - 原生布尔值/数字: true / 1
 *   - Surge 键值对字符串: argument="splashBg={{{splashBg}}}"
 *   - 纯字符串/JSON: "true", "{\"splashBg\":false}"
 *   - Quantumult X: 命中规则即视为开启
 */
function isSplashBgEnabled() {
	if ($app === "Quantumult X") return true;
	if (typeof $argument === "boolean") return $argument;
	if (typeof $argument === "number") return $argument !== 0;

	// Loon 原生对象（$argument.splashBg / $argument.splash）
	if ($argument && typeof $argument === "object") {
		const v = $argument.splashBg ?? $argument.splash ?? $argument.enableSplash;
		if (typeof v === "boolean") return v;
		if (typeof v === "string") return v.trim().toLowerCase() !== "false" && v.trim() !== "0";
		if (typeof v === "number") return v !== 0;
		if (v === undefined) return true;
	}

	// 字符串形式（Surge 模块参数 / JSON / 裸布尔字符串）
	if (typeof $argument === "string" && $argument.trim()) {
		const str = $argument.trim().toLowerCase();
		if (str === "false" || str === "0") return false;
		if (str === "true" || str === "1") return true;
		try {
			const obj = JSON.parse(str);
			if (obj && typeof obj === "object") {
				const v = obj.splashBg ?? obj.splash ?? obj.enableSplash;
				if (typeof v === "boolean") return v;
				if (typeof v === "string") return v.trim().toLowerCase() !== "false" && v.trim() !== "0";
				if (typeof v === "number") return v !== 0;
				if (v === undefined) return true;
			}
		} catch {}
		const m = str.match(/(?:^|[,;&])(?:splashbg|splash|enablesplash)\s*=\s*(true|false|1|0)/);
		if (m) return m[1] === "true" || m[1] === "1";
	}
	return true; // 默认开启
}

/**
 * 提取开屏画面素材集合（带双模判定与 12 张对齐保护）:
 * 1. 首选: space_bg 竖屏大图集合 (image1_portrait .. image12_portrait) → mode: full (全屏立绘)
 * 2. 次选兜底: skin.image_cover || image_preview || cover → mode: half (半屏封面)
 */
function extractAllSplashImages(spaceBg, skin, skinConfig) {
	const images = [];

	// 1. 首选：空间头图竖屏大图集合
	const directList = spaceBg?.images || spaceBg?.properties?.images;
	if (Array.isArray(directList) && directList.length > 0) {
		for (const item of directList) {
			const p = validStr(item?.portrait || item?.landscape);
			if (p && !images.some((x) => x.url === p)) {
				images.push({ url: p, isPortrait: true });
			}
		}
	}
	const sp = spaceBg?.properties || {};
	for (let i = 1; i <= 12; i++) {
		const port = validStr(sp[`image${i}_portrait`]);
		const land = validStr(sp[`image${i}_landscape`]);
		const target = port || land;
		if (target && !images.some((x) => x.url === target)) {
			images.push({ url: target, isPortrait: !!port });
		}
	}
	if (images.length > 0) return images.slice(0, 12);

	// 2. 次选兜底：商城封面 / 卡面
	const skinP = skin?.properties || {};
	const cover = validStr(skinP.image_cover)
		|| validStr(skinP.image_preview)
		|| validStr(skin?.cover)
		|| validStr(skinConfig?.cover);
	if (cover) {
		return [{ url: cover, isPortrait: false }];
	}

	return [];
}

/** 注入开屏装扮到 /x/v2/splash/brand/list 响应（支持多图随机抽取） */
async function injectSplashResponse(data, skinConfig) {
	if (!skinConfig?.item_id) return data;
	const suit = await fetchSuit(skinConfig.item_id, skinConfig.ids);
	if (!suit) return data;
	const images = extractAllSplashImages(suit.space_bg, suit.skin, skinConfig);
	if (!images || images.length === 0) return data;

	data.data = data.data || {};
	const themeName = suit.name || skinConfig.name || "个性装扮";
	const isMulti = images.length > 1;

	// 构建 brand 自选库列表项
	const brandItems = images.map((img, idx) => ({
		id: 999901 + idx,
		thumb: img.url,
		thumb_hash: "",
		thumb_size: 200000,
		logo_url: "http://i0.hdslb.com/bfs/archive/1b1a8a4fc78a3b1b2992402ebdc19808b9d251ed.png",
		logo_hash: "87f2da855046aa0a69a375f1c4c7e3b6",
		logo_size: 23686,
		mode: img.isPortrait ? "full" : "half",
		thumb_name: isMulti ? `${themeName} #${idx + 1}` : themeName,
		source: "brand",
		show_logo: !img.isPortrait,
	}));

	// 注入到自选库列表顶部
	const list = Array.isArray(data.data.list) ? data.data.list : [];
	data.data.list = [...brandItems, ...list.filter((x) => !x || x.id < 999900 || x.id > 999999)];

	// 构建强制预加载调度表（rule: "random" 随机抽取）
	const showItems = images.map((img, idx) => ({
		id: 999901 + idx,
		begin_time: 1700000000,
		end_time: 2500000000,
		probability: Math.floor(100 / images.length),
		duration: 3000,
		mode: img.isPortrait ? "full" : "half",
		show_logo: !img.isPortrait,
		logo_position: "center",
		new_splash: false,
		categories: null,
		initial_push_time: 0,
		source: "brand",
	}));

	const preloadItem = {
		show: showItems,
		pull_interval: 1800,
		forcibly: true,
		rule: "random",
		begin_time: 1700000000,
		end_time: 2500000000,
		force_show_times: 999,
		show_hash: "999999",
	};
	data.data.preload = [preloadItem];

	modified = true;
	const modeDesc = isMulti
		? `全屏立绘随机抽取, 共${images.length}套`
		: (images[0].isPortrait ? "全屏立绘模式" : "半屏封面模式");
	console.log(`[BiliTheme] 开屏画面注入成功:「${themeName}」(${modeDesc})`);
	return data;
}

/* **************** 主调度 **************** */
(async () => {
	const urlStr = $request.url;
	const u = new URL(urlStr.replace(/^https?:\/\//, "https://"));
	const path = u.pathname;
	const settings = getSettings();

	/* 1. 官方装扮商城详情页 HTML 注入（衣服图标接管 + 双行 Toast） */
	if (u.hostname === "www.bilibili.com" && (path.includes("/h5/mall/digital-card/home") || path.includes("/h5/mall/suit/detail"))) {
		const raw = typeof $response.body === "string" ? $response.body : "";
		if (raw) {
			const mod = injectDetailHtml(raw);
			if (mod !== raw) {
				console.log("[BiliTheme] 商城详情页接管成功: 衣服图标覆盖层与注入钩子已就绪");
				const headers = $response.headers || {};
				headers["content-type"] = "text/html; charset=utf-8";
				delete headers["content-length"];
				if ($app === "Quantumult X") $done({ status: $response.status || 200, headers, body: mod });
				else $done({ response: { status: $response.status || 200, headers, body: mod } });
				return;
			}
		}
		$done({});
		return;
	}

	/* 2. 主题皮肤与个人空间 API 响应注入 */
	let rawBody = $response.body;
	if (!rawBody || typeof rawBody !== "string") { $done({}); return; }
	let data;
	try { data = JSON.parse(rawBody); } catch { $done({}); return; }

	if (path === "/x/resource/show/skin") {
		if (settings.Switch && settings.Skin?.item_id) {
			data = await injectSkinResponse(data, settings.Skin);
		}
	} else if (path === "/x/v2/space") {
		if (!isSpaceBgEnabled()) {
			$done({});
			return;
		}
		if (settings.Switch && settings.Skin?.item_id) {
			const vmid = u.searchParams.get("vmid");
			const reqMid = $request.headers?.["x-bili-mid"] || $request.headers?.["X-Bili-Mid"];
			data = await handleSpaceResponse(data, settings.Skin, vmid, reqMid);
		}
	} else if (path === "/x/v2/splash/brand/list") {
		if (!isSplashBgEnabled()) {
			$done({});
			return;
		}
		if (settings.Switch && settings.Skin?.item_id) {
			data = await injectSplashResponse(data, settings.Skin);
		}
	}

	if (modified) {
		const body = JSON.stringify(data);
		if ($app === "Quantumult X") $done({ body });
		else $done({ response: { body } });
	} else {
		$done({});
	}
})().catch((err) => {
	console.log(`[BiliTheme] 异常放行: ${err?.message || err}`);
	$done({});
});
