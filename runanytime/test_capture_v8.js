const fs=require('fs'),vm=require('vm'),assert=require('assert');
const src=fs.readFileSync(__dirname+'/runanytime-capture.js','utf8');
const store={};let posts=[],notes=[],done=0,pending=[];
function run({req,res,hold=false,fail=false}={}) {
 done=0;const ctx={$argument:{hook:'https://receiver.example/secret/cookie',token:'test-only'},
 $persistentStore:{read:k=>store[k]||null,write:(v,k)=>{if(v===undefined)delete store[k];else store[k]=String(v);return true;}},
 $notification:{post:(...a)=>notes.push(a)},$done:()=>{done++},console,
 $httpClient:{post:(o,cb)=>{posts.push(JSON.parse(o.body));if(hold)pending.push(cb);else cb(fail?'network':null,{status:200},JSON.stringify({ok:true,skipped:false,has_refresh:true}));},get:(o,cb)=>cb(null,{status:200},JSON.stringify({ok:true,version:8,has_refresh:true}))}};
 if(req)ctx.$request=req;if(res)ctx.$response=res;
 vm.runInNewContext(src,ctx);if(!hold)assert.equal(done,1,'exactly one done');return ctx;
}
function auth(refresh='fresh-one',sid='sid-one',headers) {return {req:{url:'https://runanytime.hxi.me/api/user/auth/refresh',headers:{Cookie:'cf_clearance=fake-clearance; new_api_refresh=old-one','User-Agent':'Safari-test'}},res:{status:200,headers:headers||{'Set-Cookie':'new_api_refresh='+refresh+'; Path=/api/user/auth; HttpOnly; SameSite=Strict'},body:JSON.stringify({success:true,data:{session:{sid},access_token:'fake-access',user:{id:14705}}})}}}
function reset(){for(const k of Object.keys(store))delete store[k];posts=[];notes=[];pending=[];}
let count=0;function test(name,fn){reset();fn();console.log('PASS',name);count++;}
test('ordinary request never posts',()=>{run({req:{url:'https://runanytime.hxi.me/api/user/self',headers:{Authorization:'Bearer a',Cookie:'cf_clearance=fake-clearance'}}});assert.equal(posts.length,0);});
test('new response cookie overrides old request cookie',()=>{run(auth());assert.equal(posts.length,1);assert.equal(posts[0].refresh_cookie,'fresh-one');assert.equal(posts[0].schema,8);assert.equal(posts[0].cookie,'cf_clearance=fake-clearance');});
test('Bearer rotation alone is not identity change',()=>{let a=auth();run(a);a.res.body=a.res.body.replace('fake-access','fake-access-two');run(a);assert.equal(posts.length,1);assert.equal(notes.length,1);});
test('refresh rotation is saved without repeat notifications',()=>{run(auth());run(auth('fresh-two'));assert.equal(posts.length,2);assert.equal(notes.length,1);});
test('array Set-Cookie is supported',()=>{run(auth('x','s',{'sEt-CoOkIe':['unrelated=a; Path=/','new_api_refresh=array-value; Path=/api/user/auth; HttpOnly']}));assert.equal(posts[0].refresh_cookie,'array-value');});
test('combined cookies with Expires comma are supported',()=>{run(auth('x','s',{'Set-Cookie':'other=a; Expires=Wed, 25 Nov 2026 10:00:00 GMT; Path=/, new_api_refresh=combined-value; Path=/api/user/auth'}));assert.equal(posts[0].refresh_cookie,'combined-value');});
test('no rotation falls back to successful refresh request cookie',()=>{let a=auth();a.res.headers={};run(a);assert.equal(posts[0].refresh_cookie,'old-one');});
test('deletion does not fall back to stale cookie',()=>{run(auth('','s',{'Set-Cookie':'new_api_refresh=; Max-Age=0; Path=/api/user/auth'}));assert.equal(posts.length,0);});
test('failed auth response never captured',()=>{let a=auth();a.res.status=401;run(a);assert.equal(posts.length,0);});
test('fake success without account identity is ignored',()=>{let a=auth();a.res.body=JSON.stringify({success:true,data:{access_token:'a'}});run(a);assert.equal(posts.length,0);});
test('request only clearance cannot erase state',()=>{run(auth());run({req:{url:'https://runanytime.hxi.me/api/user/self',headers:{Cookie:'cf_clearance=fake-clearance'}}});assert.equal(posts.length,1);});
test('parallel identical captures collapse before callback',()=>{run({...auth(),hold:true});run(auth());assert.equal(posts.length,1);pending[0](null,{status:200},JSON.stringify({ok:true,has_refresh:true}));});
test('failed delivery not marked accepted',()=>{run({...auth(),fail:true});run(auth());assert.equal(posts.length,2);assert.equal(notes.some(n=>n.join(' ').includes('fresh-one')),false);});
test('successful login Set-Cookie is captured',()=>{let a=auth();a.req.url='https://runanytime.hxi.me/api/user/login';run(a);assert.equal(posts.length,1);});
test('generic self check contains no secret values',()=>{run(auth());run();assert.equal(notes.some(n=>/fresh-one|sid-one|fake-access/.test(n.join(' '))),false);});
test('second-factor login response is captured',()=>{let a=auth();a.req.url='https://runanytime.hxi.me/api/user/login/2fa';run(a);assert.equal(posts.length,1);});
test('passkey finish response is captured',()=>{let a=auth();a.req.url='https://runanytime.hxi.me/api/user/passkey/login/finish';run(a);assert.equal(posts.length,1);});
test('HTML and invalid JSON do not create captures',()=>{let a=auth();a.res.body='<html>challenge</html>';run(a);assert.equal(posts.length,0);});
test('expired Set-Cookie cannot reuse request refresh',()=>{run(auth('expired','s',{'Set-Cookie':'new_api_refresh=expired; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/api/user/auth'}));assert.equal(posts.length,0);});
test('cross host never captured',()=>{let a=auth();a.req.url='https://attacker.example/api/user/auth/refresh';run(a);assert.equal(posts.length,0);});
test('notification does not claim actual sign-in',()=>{run(auth());assert.equal(notes.some(n=>n[0].includes('签到成功')),false);});
console.log('TOTAL',count);
