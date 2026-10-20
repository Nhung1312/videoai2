// Synthetic lessons/audio only. Every /api/tts request is fulfilled locally;
// there is no Gemini request and no teacher input in this test.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {importOffline} from '../render-worker/scripts/import-offline.mjs';
import {loadPackage,ORIGIN} from '../render-worker/src/package.mjs';
import {buildRunnerHtml} from '../render-worker/src/browser.mjs';
import {BRIDGE_KEY} from '../render-worker/src/transform.mjs';
import { spawn } from 'node:child_process';
import { chromium } from '../render-worker/node_modules/playwright-core/index.mjs';

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4173','--strictPort'], { stdio:'ignore' });
let browser;
function wav(seconds) {
  const n=Math.round(seconds*8000), b=Buffer.alloc(44+n*2);
  b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);
  for(let i=0;i<n;i++)b.writeInt16LE(Math.round(Math.sin(.3+i*2*Math.PI*443.17/8000)*2000),44+i*2);
  return b.toString('base64');
}
const audioBase64=wav(1.2);
const helpers=`const narrationScript={used:'Bài đọc mới.',unused:'Không được tốn quota.',branch:'Nhánh không chạy.'};
async function cue(id){await window.onNarrationCue(id,narrationScript[id]);}
async function withCue(id,fn){await Promise.race([cue(id),fn()]);}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));`;
const html=`<!doctype html><html><head><style>.panel{opacity:0;visibility:hidden;transition:opacity .05s}.show{opacity:1;visibility:visible}#popup{width:200px;height:70px}</style></head><body><div id="popup" class="panel">x² + 2x = 3</div><script>${helpers}
async function startAnimation(){
for(const id of ['used','used']) await withCue(id,async()=>{const el=document.getElementById('popup');el.classList.add('show');await sleep(40);el.classList.remove('show');});
if(false)await cue('branch');}
window.addEventListener('load',()=>startAnimation());</script></body></html>`;

try {
  let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch('http://127.0.0.1:4173')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_BIN||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  const context=await browser.newContext({acceptDownloads:true}); const errors=[];const requests=[];
  context.on('page',page=>page.on('pageerror',e=>{errors.push(e.message);console.error('PAGE ERROR:',e.message);}));
  await context.route('**/api/tts',route=>{
    const request=route.request().postDataJSON();requests.push(request.text);
    return route.fulfill({json:{audioBase64,mimeType:'audio/wav',ttsProfile:request.ttsProfile}});
  });
  await context.route('**/test-cue-host',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body>Fixture host</body></html>'}));
  const page=await context.newPage();await page.goto('http://127.0.0.1:4173/test-cue-host');
  await page.evaluate(async audioBase64=>{
    const {AudioEngine}=await import('/src/lib/audioEngine.ts');const {saveStoredAudioClip}=await import('/src/lib/ttsStorage.ts');const {getTtsProfile}=await import('/src/lib/ttsProfile.ts');const {SAMPLE_GEOMETRY_LESSON}=await import('/src/lib/sampleLessons.ts');const first=SAMPLE_GEOMETRY_LESSON.steps[0];
    await saveStoredAudioClip({cacheKey:AudioEngine.getCacheKey(first.id,first.narration,'Kore'),audioBase64,mimeType:'audio/wav',duration:1.2,ttsProfile:getTtsProfile('Kore'),timestamp:Date.now()});
  },audioBase64);
  await page.goto('http://127.0.0.1:4173/');await page.getByRole('button',{name:'HTML + Kore',exact:true}).click();
  await page.locator('input[type=file][accept*=".html"]').setInputFiles({name:'generic-cues.html',mimeType:'text/html',buffer:Buffer.from(html)});
  const started=Date.now();await page.getByRole('button',{name:'Chuẩn bị Kore & Chạy',exact:true}).click();
  const preview=page.frameLocator('iframe[title="HTML lesson preview with Kore narration"]');
  await preview.locator('#popup.show').waitFor();await page.waitForTimeout(250);
  assert.equal(await preview.locator('#popup').evaluate(el=>getComputedStyle(el).visibility),'visible');
  await page.getByText(/Đã cache 1 cue thực sự được gọi/).waitFor();
  assert.ok(Date.now()-started>=2200,'two actual voice endings must gate the two cue callbacks');
  assert.deepEqual(requests,['Bài đọc mới.'],'unused declaration and unexecuted branch must make zero TTS requests; repeat uses cache');
  assert.equal(await preview.locator('#popup').textContent(),'x² + 2x = 3');
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Tải HTML + Kore để quay thủ công',exact:true}).click()]);
  const offline=await fs.readFile(await download.path(),'utf8');
  assert.deepEqual(JSON.parse(offline.match(/const CLIPS = ([^\n]+);/)[1]).map(c=>c.id),['used']);
  const [popup]=await Promise.all([page.waitForEvent('popup'),page.getByRole('button',{name:'Xuất video 9:16',exact:true}).click()]);
  await popup.getByText('Kore đã sẵn sàng. Bấm “Bắt đầu xuất video”.',{exact:true}).waitFor();
  assert.ok(await popup.getByRole('button',{name:'Bắt đầu xuất video 9:16',exact:true}).isEnabled());await popup.close();
  await context.route('**/test-offline-cues',route=>route.fulfill({contentType:'text/html',body:offline}));
  const local=await context.newPage();await local.goto('http://127.0.0.1:4173/test-offline-cues');
  await local.waitForFunction(()=>document.getElementById('videoai2-kore-start'),null,{timeout:5000}).catch(async e=>{console.error('Offline page at failure:',await local.locator('body').innerText(),'errors',errors);throw e;});
  await local.getByRole('button',{name:'Bắt đầu bài giảng có tiếng',exact:true}).click();
  await local.locator('#popup.show').waitFor();await local.waitForTimeout(250);
  assert.equal(await local.locator('#popup').evaluate(el=>getComputedStyle(el).visibility),'visible');
  await local.waitForFunction(()=>!document.getElementById('popup').classList.contains('show')&&!document.getElementById('videoai2-kore-start'),null,{timeout:5000});await local.close();
  // The existing server/offline importer must accept the same downloaded
  // lesson without duplicating the entry gate or replacing its locked voice API.
  const directory=await fs.mkdtemp(path.join(tmpdir(),'videoai2-cue-compat-'));
  try {
    const input=path.join(directory,'lesson.html');await fs.writeFile(input,offline);
    const target=path.join(directory,'package');await importOffline(input,target);const pkg=await loadPackage(target);
    assert.deepEqual(pkg.inspection.cueIds,['used']);
    const worker=await context.newPage();await worker.setViewportSize({width:720,height:1280});
    await worker.route(ORIGIN+'/**',route=>{const url=route.request().url();if(url===ORIGIN+'/')return route.fulfill({contentType:'text/html; charset=utf-8',body:buildRunnerHtml(pkg,{tailMs:100})});const file=pkg.files.get(url);return file?route.fulfill({contentType:file.contentType,body:file.bytes}):route.abort();});
    await worker.goto(ORIGIN+'/');
    await worker.evaluate(async key=>{await window[key].prepare();window[key].recordingReady();window[key].start();},BRIDGE_KEY);
    await worker.waitForFunction(key=>window[key].snapshot().state==='COMPLETE'||window[key].snapshot().failure,BRIDGE_KEY,{timeout:10000});
    const snapshot=await worker.evaluate(key=>window[key].snapshot(),BRIDGE_KEY);assert.equal(snapshot.failure,null,JSON.stringify(snapshot));assert.equal(snapshot.state,'COMPLETE');assert.equal(snapshot.cueCounts.used,2);await worker.close();
    console.log('PASS: existing offline importer and server runner retain their audio/entry pipeline');
  }finally{await fs.rm(directory,{recursive:true,force:true});}
  console.log('PASS: actual called cue only, dynamic IDs, skipped branch, repeated-cue cache, manual HTML and existing video entry; mocked TTS calls='+requests.length);

  // Real AudioBufferSourceNode.onended acknowledgments, shorter visual timers.
  // Exercise different subject/DOM conventions without hard-coded element IDs
  // or class names in the shared runtime.
  const cases=[
    {name:'algebra-popup',markup:'<div id="visual" class="panel">2x + 1 = 5</div>',show:"el.classList.add('show')",hide:"el.classList.remove('show')"},
    {name:'geometry-svg-line',markup:'<svg width="200" height="100"><line id="visual" x1="10" y1="10" x2="180" y2="10" stroke="black"/></svg>',show:'',hide:'el.remove()',removed:true},
    {name:'word-problem-opacity',markup:'<div id="visual">Quãng đường: 15 km</div>',show:'',hide:"el.style.opacity='0'"},
    {name:'hidden-attribute',markup:'<div id="visual">AB ⟂ CD</div>',show:'',hide:"el.setAttribute('hidden','')"},
    {name:'timer-cleanup',markup:'<div id="visual">Lời giải</div>',show:'',hide:'setTimeout(()=>el.remove(),10)',removed:true},
    {name:'raf-cleanup',markup:'<div id="visual">Kết luận</div>',show:'',hide:"requestAnimationFrame(()=>{el.style.display='none'})"},
    {name:'css-exit',markup:'<div id="visual">Bí quyết</div>',show:'',hide:"el.classList.add('exit')"},
    {name:'authored-exit-sleep',markup:'<div id="visual">Hết lời rồi mới thu hình</div>',show:'',hide:"el.style.opacity='0';await sleep(120)",extraHold:100},
    {name:'scoped-entry',markup:'<div id="visual">Đại số trong phạm vi riêng</div>',show:'',hide:'el.remove()',removed:true,scoped:true},
    {name:'deferred-rebuild',markup:'<div id="visual">Nội dung đang đọc</div>',show:'',hide:"el.innerHTML='';el.append('Kết quả giữ nguyên')",rebuild:true},
    {name:'long-animation',markup:'<div id="visual">Bài giải dài</div>',show:'',hide:"await sleep(1000);el.style.opacity='0'",slow:true},
    {name:'web-animation-exit',markup:'<div id="visual">Hình học</div>',show:'',hide:"await el.animate([{opacity:1},{opacity:0}],{duration:40,fill:'forwards'}).finished"},
  ];
  for(const item of cases){
    const host=await context.newPage();await host.goto('http://127.0.0.1:4173/test-cue-host');
    let original=`<!doctype html><html><head><style>.panel{opacity:0;visibility:hidden}.show{opacity:1;visibility:visible}@keyframes disappear{to{opacity:0}}.exit{animation:disappear .04s forwards}</style></head><body>${item.markup}<script>${helpers}
const startAnimation=async()=>{await withCue('used',async()=>{const el=document.getElementById('visual');${item.show};await sleep(30);${item.hide};});document.body.dataset.finished='yes';};startAnimation();</script></body></html>`;
    if(item.scoped)original=original.replace('<script>','<script>(()=>{').replace('</script>','})();</script>');
    await host.evaluate(async original=>{
      const {injectHtmlNarrationBridge}=await import('/src/lib/htmlLessonBridge.ts');window.completed=false;window.ended=false;const ctx=new AudioContext();await ctx.resume();
      window.addEventListener('message',event=>{const d=event.data;if(d?.type==='lesson-complete'){window.completed=true;window.completedAt=performance.now();}if(d?.type!=='narration-cue')return;const source=ctx.createBufferSource();source.buffer=ctx.createBuffer(1,Math.round(ctx.sampleRate*.8),ctx.sampleRate);source.connect(ctx.destination);source.onended=()=>{window.ended=true;window.endedAt=performance.now();event.source.postMessage({source:'videoai2-html-host',sessionId:d.sessionId,requestId:d.requestId,ok:true},'*');};source.start();});
      const frame=document.createElement('iframe');frame.srcdoc=injectHtmlNarrationBridge(original,'test','test');document.body.appendChild(frame);
    },original);
    const frame=host.frameLocator('iframe');await frame.locator('#visual').waitFor({state:'attached'});await host.waitForTimeout(180);
    assert.equal(await host.evaluate(()=>window.ended),false,item.name);
    assert.equal(await frame.locator('#visual').evaluate(el=>{const s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>0;}),true,item.name+' must remain visible while voice is playing');
    assert.equal(await host.evaluate(()=>window.completed),false,item.name+' must not finish before audio');
    if(item.rebuild)assert.equal(await frame.locator('#visual').textContent(),'Nội dung đang đọc');
    if(item.slow){await host.waitForTimeout(680);assert.equal(await host.evaluate(()=>window.completed),false,'short audio must not finish a longer animation');}
    await host.waitForFunction(()=>window.completed,null,{timeout:5000});
    assert.equal(await host.evaluate(()=>window.ended),true,item.name);
    if(item.extraHold)assert.ok(await host.evaluate(()=>window.completedAt-window.endedAt)>=item.extraHold,'authored exit sleep must start after voice completes');
    assert.equal(await frame.locator('body').getAttribute('data-finished'),'yes');
    if(item.rebuild)assert.equal(await frame.locator('#visual').textContent(),'Kết quả giữ nguyên');
    else if(item.removed)assert.equal(await frame.locator('#visual').count(),0);
    else assert.equal(await frame.locator('#visual').evaluate(el=>{const s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)>.01;}),false,item.name+' cleanup must run after voice');
    await host.close();console.log('PASS: voice-ended visual barrier '+item.name);
  }
  assert.deepEqual(errors,[]);assert.deepEqual(requests,['Bài đọc mới.']);
} finally {await browser?.close();server.kill();}
