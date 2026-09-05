import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
const profile = await fs.readFile(new URL('./profile.js',import.meta.url),'utf8');
const renderer = await fs.readFile(new URL('./client-renderer.js',import.meta.url),'utf8');
function context(width=1512,height=900,dpr=2,name='native') {
  const localStorage = new Map();
  const c = {location:{search:`?profile=${name}`,host:'localhost:4262'},navigator:{maxTouchPoints:0},
    matchMedia:()=>({matches:false}),devicePixelRatio:dpr,innerWidth:width,innerHeight:height,
    URLSearchParams,TextEncoder,btoa:s=>Buffer.from(s,'binary').toString('base64'),
    localStorage:{getItem:k=>localStorage.get(k),setItem:(k,v)=>localStorage.set(k,v)},
    document:{hidden:false},performance:{now:()=>100},window:null};
  c.window=c;vm.createContext(c);vm.runInContext(profile,c);vm.runInContext(renderer,c);return c;
}
test('GUI retains MacBook scale 4 and fits small landscape/portrait framebuffers',()=>{
  assert.equal(context().spawnpoint26GuiScale(3024,1800),4);
  assert.equal(context(1200,714,2).spawnpoint26GuiScale(2400,1428),4);
  assert.equal(context(1280,800,2,'tablet').spawnpoint26GuiScale(1131,707),2);
  assert.equal(context(360,640,3,'tablet').spawnpoint26GuiScale(360,640),1);
  assert.equal(context().spawnpoint26GuiScale(500,300),1);
  // Moving a window to a DPR 1 display must keep the same apparent GUI size.
  assert.equal(context(1200,714,2).spawnpoint26GuiScale(1200,714),2);
});
const stack = (name,count=1,namespace='minecraft')=>({e2U:count,hOc:{fTF:{eUf:{e1L:{eSr:namespace},eXs:{eSr:name}}}}});
test('client light follows selected hand and offhand without writing inventory or terrain',()=>{
  const c=context(), data=[stack('torch'),stack('stone')], equipment=[null,stack('soul_lantern')];
  const player={eSR:{eSu:10,eSy:65,eSv:20},eY4:1.62,eUN:{fej:0,eXM:{gYF:{hA0:{data}}},fPU:{fte:{e5V:{data:equipment}}}}};
  c.__prototype26.client={eSD:player};const before=JSON.stringify(player);
  c.spawnpoint26Frame();assert.equal(c.__prototype26.light[3],14);assert.equal(JSON.stringify(player),before);
  player.eUN.fej=1;c.spawnpoint26Frame();assert.equal(c.__prototype26.light[3],10);
  equipment[1]=stack('lantern',0);c.spawnpoint26Frame();assert.equal(c.__prototype26.light[3],0);
  data[1]=stack('lantern');c.spawnpoint26Frame();assert.equal(c.__prototype26.light[3],15);
  c.__prototype26.lighting=false;c.spawnpoint26Frame();assert.equal(c.__prototype26.light[3],0);
  c.__prototype26.client.eSD=null;c.spawnpoint26Frame();assert.equal(c.__prototype26.light[3],0);
});
test('shader changes only terrain, uses existing skylight and caches uniform lookup',()=>{
  const c=context();const text='uniform ChunkSection { }; void main() { vertexColor = Color * sample_lightmap(Sampler2, UV2); }';
  const modified=c.spawnpoint26Shader(text);assert.match(modified,/max\(float\(UV2.x\), heldLevel \* 16.0\), UV2.y/);
  assert.equal(c.spawnpoint26Shader('void main() {}'),'void main() {}');
  const p={},location={};let queries=0,updates=0;
  const gl={getUniformLocation:()=>{queries++;return location;},uniform4fv:(l,v)=>{assert.equal(l,location);assert.equal(v.length,4);updates++;}};
  c.spawnpoint26Program(gl,p);c.spawnpoint26Program(gl,p);assert.equal(queries,1);assert.equal(updates,2);
});
test('regression: model vertices with TeaVM float drift still match, distinct vertices do not',async()=>{
  const script=await fs.readFile(new URL('./build-client.mjs',import.meta.url),'utf8');
  const expression=script.match(/'s===d.eTi&&t===d.eTh&&u===d.eTk', '([^']+)'/)[1];
  const matches=new Function('s','t','u','d',`return ${expression}`);
  assert.ok(matches(.4374999977185067,0,.5625,{eTi:.4375,eTh:0,eTk:.5625}));
  assert.ok(matches(.00012499094009399414,.1876250058412552,.999875009059906,{eTi:.00012499094009399414,eTh:.1876250058412552,eTk:.9998749999940628}));
  assert.equal(matches(0,0,0,{eTi:.000125,eTh:0,eTk:0}),false);
  assert.equal(matches(NaN,0,0,{eTi:0,eTh:0,eTk:0}),false);
});
test('muting music prevents failed-stream retries without blocking a later unmute',async()=>{
  const script=await fs.readFile(new URL('./build-client.mjs',import.meta.url),'utf8');
  const branch=script.match(/patch\('if\(a.fbT===null\)[^\n]+', '([^']+)'\);/)[1];
  const step=new Function('a','f',`let b={fKc:{}},$p=0; _:while(true){if($p===9)return 'start';${branch}return 'delay';}`);
  const volume={eS_:0};const a={fbT:null,e8M:0,e9B:{eSH:{h_6:{e5V:{data:[null,{eTb:volume}]}}}}};
  step(a,0);assert.equal(a.e8M,100);
  volume.eS_=1;assert.equal(step(a,0),'start');
  a.fbT={};volume.eS_=0;assert.equal(step(a,0),'delay');assert.ok(a.fbT);
});
test('launch defaults use valid client ranges and leave master/effect volume alone',()=>{
  const c=context();const o={};
  for(const key of ['f7d','hiK','hBq','fMt','hlA','gdu','gBE','gdn','gAI','gnU','gDe']) o[key]={};
  const master={eTb:{eS_:1}},music={eTb:{eS_:1}},effects={eTb:{eS_:.7}};
  o.h_6={e5V:{data:[master,music,effects]}};
  c.spawnpoint26Options(o,n=>({eSp:n}),{}, {}, {}, {},n=>({eS_:n}),{});
  assert.equal(o.hlA.eTb.eSp,5);assert.equal(o.fMt.eTb.eSp,6);assert.equal(o.f7d.eTb.eSp,90);
  assert.equal(o.hiK.eTb.eSp,120);assert.equal(music.eTb.eS_,0);
  assert.equal(master.eTb.eS_,1);assert.equal(effects.eTb.eS_,.7);
});
