/* 由 tools/build.js 生成：响应改写脚本 */
/**
 * BiliTheme: Theme Response
 * 哔哩主题 — 官方装扮商城详情页原生衣服图标一键注入（五端通用）
 *
 * 拦截范围:
 *   www.bilibili.com/h5/mall/(digital-card/home|suit/detail) → 原生衣服图标接管与注入
 *   app.bilibili.com/x/resource/show/skin                   → 注入主题皮肤 + 加载动画
 *   app.bilibili.com/x/v2/space                             → 注入个人空间头图
 *   app.bilibili.com/x/v2/splash/brand/list                 → 注入开屏画面装扮
 *
 * 存储结构:
 *   $persistentStore["BiliTheme"]     = { item_id, name, ids, cover, splashes?, spaces?, act_id? }
 *   $persistentStore["BiliThemeMeta"] = { [imageUrl]: { hash, size } }（轻量开屏素材元数据持久化缓存）
 *
 * MITM hostname: app.bilibili.com, www.bilibili.com
 */
const VERSION = "4.1.0";
const STORAGE_ROOT = "BiliTheme";
let modified = false;

/* **************** 平台适配层 **************** */
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

/**
 * 跨平台 HTTP 响应统一完成适配层:
 * 1. Quantumult X: 扁平 status, headers, body 结构；
 * 2. Surge: 顶层必须包含 status, headers, body（Surge 官方 http-response 规范，不支持 response 嵌套）；
 * 3. Stash / Loon / Egern: 双层挂载 response 兼容严格对象引擎与扁平引擎。
 */
function doneResponse(options) {
	if (!options) {
		$done({});
		return;
	}
	const res = {};
	if (options.status !== undefined) res.status = options.status;
	if (options.headers !== undefined) res.headers = options.headers;
	if (options.body !== undefined) res.body = options.body;

	if ($app === "Quantumult X") {
		$done(res);
		return;
	}
	if ($app === "Surge") {
		$done({ status: res.status || 200, headers: res.headers || {}, body: res.body });
		return;
	}

	res.response = {
		status: res.status,
		headers: res.headers,
		body: res.body,
	};
	$done(res);
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
 * 提取普通装扮 space_bg 中的官方轮播图片列表 [{ landscape, portrait }]
 * 官方标准格式：平铺键 image1_landscape/portrait .. image15_landscape/portrait
 * 严格使用官方配置的原生横版与竖版素材，对齐官方空间头图 15 套上限。
 */
function extractAllSpaceImages(spaceBg) {
	const images = [];
	if (!spaceBg) return images;

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

	// 2. 扫描官方标准平铺键 image1..image15
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
	return images.slice(0, 15);
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
var curActiveLotteryId=null;
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
      if(u.indexOf("lottery_home_detail")!==-1){
        var m=u.match(/[?&]lottery_id=([^&#]+)/);
        if(m&&m[1]&&Number(m[1])!==0)curActiveLotteryId=String(m[1]);
      }
      if(u.indexOf("garb/v2/mall/suit/detail")!==-1||u.indexOf("garb/v2/user/suit/benefit")!==-1){
        res.clone().json().then(function(j){
          var d=j&&j.data;if(!d)return;
          var si=d.suit_items||{};var sk=Array.isArray(si.skin)?si.skin[0]:si.skin;
          var id=(sk&&sk.item_id)||d.item_id;
          var allIds=[d.item_id,sk&&sk.item_id,si.space_bg&&si.space_bg[0]&&si.space_bg[0].item_id].filter(Boolean).join("&");
          var spBg=Array.isArray(si.space_bg)?si.space_bg[0]:si.space_bg;
          var spImages=[];
          if(spBg&&spBg.properties){
            for(var pi=1;pi<=12;pi++){
              var port=spBg.properties["image"+pi+"_portrait"];
              if(port&&spImages.indexOf(port)===-1)spImages.push(port);
            }
          }
          var splashes=spImages.map(function(iu,idx){
            return {url:iu,hash:"",size:0,name:(d.name||"个性装扮")+" #"+(idx+1),isPortrait:true};
          });
          if(id){
            cur={
              suit_id:String(d.item_id||""),
              item_id:String(id),
              ids:allIds||String(id),
              name:d.name||(sk&&sk.name)||"个性装扮",
              cover:(d.properties&&d.properties.image_cover)||(sk&&sk.properties&&sk.properties.image_cover)||"",
              splashes:splashes.length>0?splashes:null
            };
          }
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
      if(curActiveLotteryId){
        matchedLottery=sl.find(function(x){return String(x&&x.lottery_id)===String(curActiveLotteryId)});
      }
      if(!matchedLottery&&sl.length>0){
        var tabs=document.querySelectorAll(".van-tab--active,.tab-item.active,[class*='tab--active'],[class*='tab'][class*='active']");
        for(var ti=0;ti<tabs.length;ti++){
          var txt=(tabs[ti].textContent||"").trim();
          if(!txt)continue;
          var found=sl.find(function(x){return x&&x.lottery_name&&(txt.indexOf(x.lottery_name)!==-1||x.lottery_name.indexOf(txt)!==-1)});
          if(found){matchedLottery=found;break;}
        }
      }
      if(!matchedLottery){
        var urlLid=p.get("lottery_id");
        if(urlLid&&Number(urlLid)!==0){
          matchedLottery=sl.find(function(x){return String(x&&x.lottery_id)===String(urlLid)});
        }
      }
      if(!matchedLottery&&sl.length>0){
        matchedLottery=sl[0];
      }
      var target=null;
      if(matchedLottery){
        var mLid=String(matchedLottery.lottery_id);
        var mName=matchedLottery.lottery_name||"";
        target=cl.find(function(x){
          return Number(x&&x.redeem_item_type)===5&&String(x&&x.lottery_id)===mLid;
        });
        if(!target&&mName){
          target=cl.find(function(x){
            if(Number(x&&x.redeem_item_type)!==5)return false;
            var rName=x.redeem_item_name||x.name||"";
            return rName.indexOf(mName)!==-1||mName.indexOf(rName)!==-1;
          });
        }
      }
      if(!target){
        target=cl.find(function(x){return Number(x&&x.redeem_item_type)===5});
      }
      var splashes=[];
      var curLid=String(matchedLottery?matchedLottery.lottery_id:(curActiveLotteryId||p.get("lottery_id")||""));
      if(curLid&&Number(curLid)!==0){
        try{
          var lResp=await _f("https://api.bilibili.com/x/vas/dlc_act/lottery_home_detail?act_id="+act+"&lottery_id="+curLid).then(function(x){return x.json()});
          var lItems=(lResp&&lResp.data&&lResp.data.item_list)||[];
          var poolCards=[];
          for(var li=0;li<lItems.length;li++){
            var lit=lItems[li];
            var lci=(lit&&(lit.card_info||lit.card_item))||{};
            var sc=Number((lit&&lit.item_scarcity)||(lci&&lci.card_scarcity)||0);
            var ct=Number((lci&&lci.card_type)||(lit&&lit.card_type)||0);
            var img=(lci&&(lci.card_img||lci.card_img_download))||"";
            if(img){
              poolCards.push({
                url:img,
                hash:"",
                size:0,
                name:lci.card_name||lit.name||"卡牌立绘",
                isPortrait:true,
                scarcity:sc,
                cardType:ct
              });
            }
          }
          // 1. 高品质动态立绘大卡 (cardType === 2 或 scarcity >= 20)，按稀有度降序排序
          var bigCards=poolCards.filter(function(x){
            return x.cardType===2||(x.cardType!==1&&x.scarcity>=20);
          });
          bigCards.sort(function(a,b){return (b.scarcity||0)-(a.scarcity||0)});

          // 2. 依次按官方原生顺序向后无偏补齐
          var combined=[].concat(bigCards);
          for(var pci=0;pci<poolCards.length;pci++){
            var pc=poolCards[pci];
            if(!combined.some(function(x){return x.url===pc.url}))combined.push(pc);
          }
          if(combined.length>0){
            splashes=combined;
          }
        }catch(e){}
      }
      // 提取前 12 张作为高质量开屏画面
      if(splashes.length>12){
        splashes=splashes.slice(0,12);
      }
      // 提取前 15 张高质量大卡并使用 CDN 参数裁切为空间横图 + 竖图轮播
      var spaces=(combined||[]).slice(0,15).map(function(c){
        var raw=String(c.url||"").replace(/@[^@]+$/,"");
        return {
          landscape: raw+"@0-0-1242-1073a",
          portrait: raw,
          name: c.name||"卡牌头图"
        };
      });
      if(target){
        suit={
          item_id:String(target.redeem_item_id||"").split("&")[0],
          ids:String(target.redeem_item_id||""),
          name:target.redeem_item_name||target.name||(matchedLottery?matchedLottery.lottery_name+"个性主题":"活动主题套装"),
          cover:target.redeem_item_image||target.redeem_detail_image||"",
          splashes:splashes.length>0?splashes:null,
          spaces:spaces.length>0?spaces:null,
          act_id:String(act)
        };
      }
    }catch(err){}
  }else if(id){
    if(cur&&(cur.suit_id===String(id)||cur.item_id===String(id))){
      suit=cur;
    }else{
      toast("正在获取装扮详情…","");
      try{
        var r=await _f("https://api.bilibili.com/x/garb/v2/mall/suit/detail?item_id="+id).then(function(x){return x.json()});
        if(!r||r.code!==0||!r.data){
          r=await _f("https://api.bilibili.com/x/garb/v2/user/suit/benefit?item_id="+id+"&part=emoji_package").then(function(x){return x.json()});
        }
        var dt=(r&&r.data)||{};
        var si=dt.suit_items||{};var sk=Array.isArray(si.skin)?si.skin[0]:si.skin;
        var realId=(sk&&sk.item_id)||dt.item_id||id;
        var allIds=[dt.item_id,sk&&sk.item_id,id,si.space_bg&&si.space_bg[0]&&si.space_bg[0].item_id].filter(Boolean).join("&");
        var spBg=Array.isArray(si.space_bg)?si.space_bg[0]:si.space_bg;
        var spImages=[];
        if(spBg&&spBg.properties){
          for(var siIdx=1;siIdx<=12;siIdx++){
            var port=spBg.properties["image"+siIdx+"_portrait"];
            if(port&&spImages.indexOf(port)===-1)spImages.push(port);
          }
        }
        var splashes=spImages.map(function(iu,idx){
          return {url:iu,hash:"",size:0,name:(dt.name||"个性装扮")+" #"+(idx+1),isPortrait:true};
        });
        suit={
          suit_id:String(dt.item_id||id),
          item_id:String(realId),
          ids:allIds||String(realId),
          name:dt.name||(sk&&sk.name)||"个性装扮",
          cover:(dt.properties&&dt.properties.image_cover)||(sk&&sk.properties&&sk.properties.image_cover)||"",
          splashes:splashes.length>0?splashes:null
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
    if(suit.splashes&&suit.splashes.length){suit.splashes.forEach(function(sp){if(sp&&sp.url){try{var _spIm=new Image();_spIm.src=sp.url}catch(e){}}})}
    var selectParams={item_id:suit.item_id,ids:suit.ids,name:suit.name,cover:suit.cover||""};
    if(suit.splashes&&suit.splashes.length>0)selectParams.splashes=JSON.stringify(suit.splashes);
    if(suit.spaces&&suit.spaces.length>0)selectParams.spaces=JSON.stringify(suit.spaces);
    if(suit.act_id)selectParams.act_id=suit.act_id;
    var qs=new URLSearchParams(selectParams).toString();
    var sv=null;
    try{
      var resp=await _f("https://app.bilibili.com/settings/theme/api/select",{
        method:"POST",
        headers:{"Content-Type":"application/x-www-form-urlencoded"},
        body:qs
      });
      if(resp&&typeof resp.json==="function"){
        sv=await resp.json();
      }else if(resp&&typeof resp.text==="function"){
        var txt=await resp.text();
        sv=JSON.parse(txt);
      }
    }catch(postErr){
      // 容错兜底：若客户端在极少数环境下对 POST 解析抛错，平滑回落 GET 请求确保 100% 连通
      try{
        var getUrl="https://app.bilibili.com/settings/theme/api/select?"+qs;
        var getResp=await _f(getUrl);
        if(getResp&&typeof getResp.json==="function")sv=await getResp.json();
        else if(getResp&&typeof getResp.text==="function")sv=JSON.parse(await getResp.text());
      }catch(e){}
    }
    if(sv&&sv.saved){
      await new Promise(function(resolve){setTimeout(resolve,1000)});
      toast("🎉 装扮注入成功","👕「"+(sv.name||suit.name)+"」"+(suit.splashes?" ("+suit.splashes.length+"张开屏立绘)":""),"🔄 重启哔哩哔哩后生效，部分装扮可能需要重启两次");
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
    ov.style.cssText="position:fixed;z-index:9999999;cursor:pointer;-webkit-tap-highlight-color:transparent;background:rgba(0,0,0,0.001);";
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

function isTshirtHit(e){
  var el=e.target;
  var t=findTshirtEl();
  if(t&&(t===el||(t.contains&&t.contains(el))))return true;
  var cx=e.clientX!=null?e.clientX:(e.touches&&e.touches[0]?e.touches[0].clientX:(e.changedTouches&&e.changedTouches[0]?e.changedTouches[0].clientY:-1));
  var cy=e.clientY!=null?e.clientY:(e.touches&&e.touches[0]?e.touches[0].clientY:(e.changedTouches&&e.changedTouches[0]?e.changedTouches[0].clientY:-1));
  if(cx>=0&&cy>=0){
    var w=window.innerWidth||(document.documentElement&&document.documentElement.clientWidth)||375;
    if(cx>=(w-115)&&cx<=(w-45)&&cy>=0&&cy<=80)return true;
  }
  return false;
}

function handleCaptureEvent(e){
  if(isTshirtHit(e)){
    e.stopPropagation();
    e.stopImmediatePropagation();
    e.preventDefault();
    handleInject();
  }
}

document.addEventListener("click",handleCaptureEvent,true);
document.addEventListener("touchend",handleCaptureEvent,true);
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

	// 数组形式（Loon: argument=[{spaceBg}, {splashBg}]）
	if (Array.isArray($argument)) {
		const v = $argument[0];
		if (typeof v === "boolean") return v;
		if (typeof v === "string") return v.toLowerCase() === "true" || v === "1";
		if (typeof v === "number") return v === 1;
	}

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
		if (str.includes("{{{spacebg}}}") || str.includes("{{spacebg}}")) return true;
		try {
			const obj = JSON.parse(str);
			if (Array.isArray(obj)) {
				const raw = obj[0];
				const v = (raw && typeof raw === "object")
					? (raw.spaceBg ?? raw.space ?? raw.enableSpace)
					: raw;
				if (typeof v === "boolean") return v;
				if (typeof v === "string") return v.toLowerCase() === "true" || v === "1";
				if (typeof v === "number") return v === 1;
			} else if (obj && typeof obj === "object") {
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

	// 1. 优先使用显式保存的高清卡牌空间头图集合（针对抽卡盲盒/收藏集卡池，支持多套轮播，上限15张）
	let images = [];
	if (Array.isArray(skinConfig.spaces) && skinConfig.spaces.length > 0) {
		images = skinConfig.spaces.filter((x) => x && (x.landscape || x.portrait)).map((x) => ({
			landscape: x.landscape || x.portrait,
			portrait: x.portrait || x.landscape,
			name: x.name || "卡牌头图",
		})).slice(0, 15);
	}

	// 2. 次选：从标准装扮 space_bg 中提取官方配置的 landscape/portrait 轮播图片
	let suit = null;
	if (images.length === 0) {
		suit = await fetchSuit(skinConfig.item_id, skinConfig.ids);
		if (!suit) return data;
		images = extractAllSpaceImages(suit.space_bg);
	}
	if (!images || images.length === 0) return data;

	const res = injectSpaceBg(data, suit || { name: skinConfig.name, item_id: skinConfig.item_id }, images);
	console.log(`[BiliTheme] 空间头图注入成功:「${suit?.name || skinConfig.name || "个性装扮"}」(${images.length}套头图, UID: ${vmid || reqMid || "当前用户"})`);
	return res;
}

/* **************** 注入: 开屏画面装扮 **************** */

/**
 * 判定是否启用开屏画面注入:
 * 默认值: false（默认关闭，保护用户原本开屏与去广告策略；需要时由用户在插件中开启）
 * 多平台多态传参深度适配:
 *   - Loon 原生对象: $argument.splashBg === true
 *   - 原生布尔值/数字: true / 1
 *   - Surge 键值对字符串: argument="splashBg={{{splashBg}}}" → "splashBg=true"
 *   - 纯字符串/JSON: "true", "{\"splashBg\":true}"
 *   - Quantumult X: 由于 QX 不支持 argument 传参，若命中本规则（用户主动解除规则注释）则直接视为开启
 */
function isSplashBgEnabled() {
	if ($app === "Quantumult X") return true;
	if (typeof $argument === "boolean") return $argument;
	if (typeof $argument === "number") return $argument === 1;

	// 数组形式（Loon: argument=[{spaceBg}, {splashBg}]）
	if (Array.isArray($argument)) {
		const v = $argument[1] ?? $argument[0];
		if (typeof v === "boolean") return v;
		if (typeof v === "string") return v.toLowerCase() === "true" || v === "1";
		if (typeof v === "number") return v === 1;
	}

	// Loon 原生对象（$argument.splashBg / $argument.splash）
	if ($argument && typeof $argument === "object") {
		const v = $argument.splashBg ?? $argument.splash ?? $argument.enableSplash;
		if (typeof v === "boolean") return v;
		if (typeof v === "string") return v.toLowerCase() === "true" || v === "1";
		if (typeof v === "number") return v === 1;
	}

	// 字符串形式（Surge 模块参数 / JSON / 裸布尔字符串）
	if (typeof $argument === "string" && $argument.trim()) {
		const str = $argument.trim().toLowerCase();
		if (str === "true" || str === "1") return true;
		if (str === "false" || str === "0") return false;
		if (str.includes("{{{splashbg}}}") || str.includes("{{splashbg}}")) return true;
		try {
			const obj = JSON.parse(str);
			if (Array.isArray(obj)) {
				const raw = obj[1] ?? obj[0];
				const v = (raw && typeof raw === "object")
					? (raw.splashBg ?? raw.splash ?? raw.enableSplash)
					: raw;
				if (typeof v === "boolean") return v;
				if (typeof v === "string") return v.toLowerCase() === "true" || v === "1";
				if (typeof v === "number") return v === 1;
			} else if (obj && typeof obj === "object") {
				const v = obj.splashBg ?? obj.splash ?? obj.enableSplash;
				if (typeof v === "boolean") return v;
				if (typeof v === "string") return v.toLowerCase() === "true" || v === "1";
				if (typeof v === "number") return v === 1;
			}
		} catch {}
		const m = str.match(/(?:^|[,;&])(?:splashbg|splash|enablesplash)\s*=\s*(true|false|1|0)/);
		if (m) return m[1] === "true" || m[1] === "1";
	}
	return false; // 默认关闭
}

/**
 * 提取开屏画面素材集合（纯全屏立绘模式，宁缺毋滥）:
 * 仅提取 space_bg 中的竖屏大立绘 (image1_portrait .. image12_portrait)。
 * 彻底移除半屏与商城小封面兜底，避免出现白底小方块；无全屏大图时直接返回空数组并放弃开屏注入。
 */
function extractAllSplashImages(spaceBg) {
	const images = [];
	if (!spaceBg) return images;

	// 1. 直接列表中的竖屏大图
	const directList = spaceBg?.images || spaceBg?.properties?.images;
	if (Array.isArray(directList) && directList.length > 0) {
		for (const item of directList) {
			const p = validStr(item?.portrait);
			if (p && !images.some((x) => x.url === p)) {
				images.push({ url: p, isPortrait: true });
			}
		}
	}
	// 2. properties 中的 image1_portrait .. image12_portrait 竖屏大立绘
	const sp = spaceBg?.properties || {};
	for (let i = 1; i <= 12; i++) {
		const port = validStr(sp[`image${i}_portrait`]);
		if (port && !images.some((x) => x.url === port)) {
			images.push({ url: port, isPortrait: true });
		}
	}
	return images.slice(0, 12);
}

/** 跨平台轻量探测图片真实 MD5 (Etag) 与总字节数 (Content-Range / Content-Length) */
function fetchImageMeta(url, timeoutMs = 3500) {
	return new Promise((resolve) => {
		const headers = { "Range": "bytes=0-0", "User-Agent": UA };
		let settled = false, timer = null;
		const fin = (v) => {
			if (settled) return;
			settled = true;
			if (timer) { try { clearTimeout(timer); } catch {} }
			resolve(v);
		};
		if (typeof setTimeout === "function") timer = setTimeout(() => fin(null), timeoutMs);

		const handleHeaders = (rawHeaders) => {
			if (!rawHeaders || typeof rawHeaders !== "object") return fin(null);
			const norm = {};
			for (const [k, v] of Object.entries(rawHeaders)) {
				norm[String(k).toLowerCase()] = v;
			}
			let etag = String(norm["etag"] || norm["content-md5"] || "").replace(/["']/g, "").trim();
			if (etag.length === 24 && etag.endsWith("==")) {
				try {
					if (typeof Buffer !== "undefined") {
						etag = Buffer.from(etag, "base64").toString("hex");
					}
				} catch {}
			}
			let size = 0;
			const cr = norm["content-range"];
			if (typeof cr === "string") {
				const m = cr.match(/\/(\d+)/);
				if (m) size = parseInt(m[1], 10);
			}
			if (!size && norm["content-length"]) {
				size = parseInt(norm["content-length"], 10) || 0;
			}
			if (etag) {
				fin({ hash: etag.toLowerCase(), size: size || 200000 });
			} else {
				fin(null);
			}
		};

		if ($app === "Quantumult X") {
			$task.fetch({ method: "GET", url, headers }).then(
				(resp) => handleHeaders(resp?.headers),
				() => fin(null)
			);
		} else {
			$httpClient.get({ url, headers }, (err, resp) => {
				if (err || !resp) return fin(null);
				handleHeaders(resp.headers);
			});
		}
	});
}

/** 批量获取素材真实元数据并走轻量持久化缓存 */
async function fillImagesMeta(images) {
	let cachedMeta = {};
	try {
		cachedMeta = storeRead("BiliThemeMeta") || {};
		if (typeof cachedMeta !== "object" || Array.isArray(cachedMeta)) cachedMeta = {};
	} catch {}

	let hasNew = false;
	await Promise.all(images.map(async (img) => {
		if (img.hash && img.size) return; // 素材已内置真实元数据（如典藏卡自带），直接使用
		if (cachedMeta[img.url] && cachedMeta[img.url].hash) {
			img.hash = cachedMeta[img.url].hash;
			img.size = cachedMeta[img.url].size;
			return;
		}
		const meta = await fetchImageMeta(img.url);
		if (meta && meta.hash) {
			img.hash = meta.hash;
			img.size = meta.size;
			cachedMeta[img.url] = meta;
			hasNew = true;
		} else {
			img.hash = "";
			img.size = 200000;
		}
	}));

	if (hasNew) {
		try {
			const keys = Object.keys(cachedMeta);
			if (keys.length > 30) {
				const trimMeta = {};
				for (const k of keys.slice(-25)) trimMeta[k] = cachedMeta[k];
				storeWrite("BiliThemeMeta", trimMeta);
			} else {
				storeWrite("BiliThemeMeta", cachedMeta);
			}
		} catch {}
	}
}

/** 注入开屏装扮到 /x/v2/splash/brand/list 响应（方案 B 借壳官方原生合法 ID 独占替换 + 真实 MD5 校验对齐） */
async function injectSplashResponse(data, skinConfig, reqUrl) {
	if (!skinConfig?.item_id) return data;

	let targetUrl = reqUrl;
	if (!targetUrl && typeof $request !== "undefined" && $request?.url) {
		try { targetUrl = new URL($request.url.replace(/^https?:\/\//, "https://")); } catch {}
	}
	let selectedBrandIds = [];
	try {
		const selParam = targetUrl?.searchParams?.get("selected");
		if (selParam) {
			const parsedSel = JSON.parse(selParam);
			if (Array.isArray(parsedSel?.brand)) {
				selectedBrandIds = parsedSel.brand.map(Number).filter((n) => !isNaN(n) && n > 0);
			}
		}
	} catch {}

	// 1. 优先提取显式保存的数字卡牌典藏全屏开屏
	let images = [];
	if (Array.isArray(skinConfig.splashes) && skinConfig.splashes.length > 0) {
		images = skinConfig.splashes.filter((x) => x && x.url).map((x) => ({
			url: x.url,
			hash: x.hash || "",
			size: x.size || 0,
			isPortrait: true,
			name: x.name,
		}));
	}

	// 2. 次选：从标准装扮 space_bg 中提取竖屏全屏立绘
	let suit = null;
	if (images.length === 0) {
		suit = await fetchSuit(skinConfig.item_id, skinConfig.ids);
		if (suit?.space_bg) {
			images = extractAllSplashImages(suit.space_bg);
		}
	}

	// 3. 安全熔断：若未包含任何真正全屏立绘大图，放弃开屏注入，保持官方原生开屏（彻底告别半屏小图白底）
	if (!images || images.length === 0) {
		const skipName = skinConfig.name || skinConfig.item_id;
		console.log(`[BiliTheme] 装扮「${skipName}」未包含全屏大立绘，跳过开屏画面注入（保持官方原生开屏）`);
		return data;
	}

	// 并发获取各素材真实的 Etag (MD5) 与精确字节大小（带持久化缓存，已有元数据跳过探测）
	await fillImagesMeta(images);

	// 真实接口在未购买自选开屏时返回 code: -400，强制设为 0 与 message: "0"，确保客户端正常入库
	if (data.code !== 0) {
		data.code = 0;
		data.message = "0";
	} else if (!data.message) {
		data.message = "OK";
	}
	data.data = data.data || {};
	const themeName = suit?.name || skinConfig.name || "个性装扮";
	const isMulti = images.length > 1;

	// 方案 B：借壳官方原生合法 ID 独占替换（彻底清空官方原有杂项，杜绝冲突与回退）
	const origList = Array.isArray(data.data.list) ? data.data.list : [];
	const origPreloadShow = data.data.preload?.[0]?.show;
	const officialBaseId = (Array.isArray(origPreloadShow) && origPreloadShow[0]?.id)
		|| (origList[0]?.id)
		|| 145;

	// 智能分配 ID：若客户端请求中携带 selected 参数（即用户在 App 内已勾选的开屏 ID），
	// 优先将装扮物料对齐覆盖到用户勾选的各 ID 上，确保客户端本地选择器 100% 命中展示；
	// 若装扮素材图多于勾选数量，自动补齐借壳 ID。未传 selected 时（或测试）平滑降级为借壳官方原有 ID。
	let targetIds = [];
	if (selectedBrandIds.length > 0) {
		targetIds = [...selectedBrandIds];
		let extraIdx = 0;
		while (targetIds.length < images.length && targetIds.length < 12) {
			const candidate = (origList[extraIdx] && origList[extraIdx].id) ? origList[extraIdx].id : (officialBaseId + extraIdx);
			if (!targetIds.includes(candidate)) {
				targetIds.push(candidate);
			}
			extraIdx++;
		}
	} else {
		// 未开启自定义开屏（selected={}）：优先借壳官方已有 Preload 合法 ID（如 145）及官方列表已有 ID
		const count = Math.min(images.length, 12);
		if (officialBaseId && !targetIds.includes(officialBaseId)) {
			targetIds.push(officialBaseId);
		}
		for (let i = 0; i < count; i++) {
			const cand = (origList[i] && origList[i].id) ? origList[i].id : (officialBaseId + i);
			if (!targetIds.includes(cand)) {
				targetIds.push(cand);
			}
			if (targetIds.length >= count) break;
		}
		let fill = 1;
		while (targetIds.length < count) {
			const nextId = officialBaseId + fill;
			if (!targetIds.includes(nextId)) targetIds.push(nextId);
			fill++;
		}
	}

	// 为每套图片分配 ID：首选借壳官方原生已有合法 ID，并填入真实 MD5 与字节大小
	const brandItems = targetIds.map((targetId, idx) => {
		const img = images[idx % images.length];
		return {
			id: targetId,
			thumb: img.url,
			thumb_hash: img.hash || "",
			thumb_size: img.size || 200000,
			logo_url: "https://i0.hdslb.com/bfs/archive/1b1a8a4fc78a3b1b2992402ebdc19808b9d251ed.png",
			logo_hash: "87f2da855046aa0a69a375f1c4c7e3b6",
			logo_size: 23686,
			mode: "full",
			thumb_name: img.name || (isMulti ? `${themeName} #${(idx % images.length) + 1}` : themeName),
			source: "brand",
			show_logo: true,
		};
	});

	// 彻底清空官方原有杂项，独占覆盖（开屏库仅包含我们的装扮）
	data.data.list = brandItems;

	// 构建强制预加载调度表（动态对齐当前活跃时间窗口：1小时前生效，持续30天）
	const now = Math.floor(Date.now() / 1000);
	const beginTime = now - 3600;
	const endTime = now + 86400 * 30;

	const showItems = brandItems.map((item) => ({
		id: item.id,
		begin_time: beginTime,
		end_time: endTime,
		probability: isMulti ? Math.floor(100 / brandItems.length) : 100,
		duration: 1000,
		mode: "full",
		show_logo: true,
		logo_position: "center",
		new_splash: false,
		categories: null,
		initial_push_time: 0,
		source: "brand",
	}));

	// 动态计算基于当前装扮唯一标识与素材哈希的版本 show_hash
	const hashSeed = String(skinConfig?.item_id || "") + "_" + images.map((x) => x.hash || x.url || "").join("_");
	let h = 0;
	for (let hi = 0; hi < hashSeed.length; hi++) {
		h = (Math.imul(31, h) + hashSeed.charCodeAt(hi)) | 0;
	}
	const dynamicHash = String(Math.abs(h) || 999999);

	// 激活顶层与内层双层强制调度（保证未开启自定义开屏的用户也能直接生效展示）
	data.data.pull_interval = 1800;
	data.data.forcibly = true;
	data.data.rule = isMulti ? "random" : "order";
	data.data.force_show_times = 10000;
	data.data.show_hash = dynamicHash;
	data.data.has_new_splash_set = true;
	data.data.new_splash_hash = dynamicHash;

	const preloadItem = {
		show: showItems,
		pull_interval: 1800,
		forcibly: true,
		rule: isMulti ? "random" : "order",
		begin_time: beginTime,
		end_time: endTime,
		force_show_times: 10000,
		show_hash: dynamicHash,
	};
	data.data.preload = [preloadItem];

	modified = true;
	const modeDesc = isMulti ? `全屏立绘随机抽取, 共${images.length}套` : "纯全屏立绘模式";
	const hashDesc = images[0].hash ? `MD5: ${images[0].hash.slice(0, 8)}…, 大小: ${(images[0].size / 1024).toFixed(0)}KB` : "默认元数据";
	console.log(`[BiliTheme] 全屏开屏画面注入成功:「${themeName}」(${modeDesc}, ${hashDesc}, 官方原生借壳独占替换)`);
	return data;
}

/* **************** 主调度 **************** */
(async () => {
	const urlStr = $request.url;
	const u = new URL(urlStr.replace(/^https?:\/\//, "https://"));
	const path = u.pathname;
	const settings = getSettings();

	/* 1. 官方装扮商城详情页 HTML 注入（衣服图标接管 + 三行 Toast） */
	if (u.hostname === "www.bilibili.com" && (path.includes("/h5/mall/digital-card/home") || path.includes("/h5/mall/suit/detail"))) {
		const raw = typeof $response.body === "string" ? $response.body : "";
		if (raw) {
			const mod = injectDetailHtml(raw);
			if (mod !== raw) {
				console.log("[BiliTheme] 商城详情页接管成功: 衣服图标覆盖层与注入钩子已就绪");
				const headers = $response.headers || {};
				headers["content-type"] = "text/html; charset=utf-8";
				delete headers["content-length"];
				delete headers["Content-Length"];
				delete headers["content-encoding"];
				delete headers["Content-Encoding"];
				doneResponse({ status: $response.status || 200, headers, body: mod });
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
			data = await injectSplashResponse(data, settings.Skin, u);
		}
	}

	if (modified) {
		const body = JSON.stringify(data);
		const headers = $response.headers || {};
		headers["content-type"] = "application/json; charset=utf-8";
		delete headers["content-length"];
		delete headers["Content-Length"];
		delete headers["content-encoding"];
		delete headers["Content-Encoding"];
		doneResponse({ status: $response.status || 200, headers, body });
	} else {
		$done({});
	}
})().catch((err) => {
	console.log(`[BiliTheme] 异常放行: ${err?.message || err}`);
	$done({});
});
