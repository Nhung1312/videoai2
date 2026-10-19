// Real Chromium MediaRecorder/WebAudio/Canvas streams; only the display picker
// is replaced with a diagnostic canvas. No Gemini request or teacher input.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { chromium } from '../render-worker/node_modules/playwright-core/index.mjs';

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','4173','--strictPort'], { stdio:'ignore' });
const output = path.resolve('render-worker/artifacts/html-recording'); await fs.mkdir(output,{recursive:true});
let browser;
function wav(seconds) {
  const b=Buffer.alloc(44+seconds*16000);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(8000,24);b.writeUInt32LE(16000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);
  for(let i=0;i<seconds*8000;i++)b.writeInt16LE(Math.round(Math.sin(.3+i*2*Math.PI*443.17/8000)*2000),44+i*2);return b.toString('base64');
}
const html='<!doctype html><html><head><title>Recording diagnostic</title></head><body><p id="value">Đang chạy</p><script>const narrationScript={"intro":"Kiểm tra âm thanh."};async function cue(id){await window.onNarrationCue(id);}async function startAnimation(){await cue("intro");document.getElementById("value").textContent="Hoàn tất";}window.addEventListener("load",()=>void startAnimation());</script></body></html>';

try {
  let ready=false;for(let i=0;i<100;i++){try{ready=(await fetch('http://127.0.0.1:4173')).ok;}catch{}if(ready)break;await new Promise(r=>setTimeout(r,100));}assert.ok(ready);
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_BIN||'/usr/bin/google-chrome',headless:false,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  const context=await browser.newContext({viewport:{width:1000,height:900},acceptDownloads:true});let apiCalls=0;const errors=[];
  await context.route('**/api/tts',route=>{apiCalls++;return route.abort();});
  await context.route('**/test-recording-host',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Host</title><p>Recording diagnostic host</p>'}));
  context.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));

  async function create(kind,seconds,webm=false){
    const host=await context.newPage();await host.goto('http://127.0.0.1:4173/test-recording-host');
    const id='diagnostic-'+Date.now();const audioBase64=wav(seconds);let page=host;
    if(kind==='standalone'){
      const pending=context.waitForEvent('page');
      await host.evaluate(async({id,html,audioBase64})=>{
        const {openStandaloneHtmlExport}=await import('/src/lib/htmlExportWindowLauncher.ts');
        const {injectHtmlNarrationBridge,injectHtmlRecordingLayout,stableHtmlLessonId}=await import('/src/lib/htmlLessonBridge.ts');
        const bytes=Uint8Array.from(atob(audioBase64),x=>x.charCodeAt(0));
        await openStandaloneHtmlExport(id,async()=>({sessionId:id,runningHtml:injectHtmlNarrationBridge(injectHtmlRecordingLayout(html),id,stableHtmlLessonId(html)),fileName:'diagnostic.html',playbackRate:1,cues:[{id:'intro',narration:'Kiểm tra âm thanh.',audio:bytes.buffer}]}));
      },{id,html,audioBase64});page=await pending;await page.getByText('Đã nhận 1 đoạn Kore. Sẵn sàng xuất video.',{exact:true}).waitFor();
    }else{
      await host.evaluate(async({id,html,audioBase64,seconds})=>{
        const {AudioEngine}=await import('/src/lib/audioEngine.ts');const {saveStoredAudioClip}=await import('/src/lib/ttsStorage.ts');const {getTtsProfile}=await import('/src/lib/ttsProfile.ts');const {stableHtmlLessonId}=await import('/src/lib/htmlLessonBridge.ts');
        await saveStoredAudioClip({cacheKey:AudioEngine.getCacheKey(stableHtmlLessonId(html)+':intro','Kiểm tra âm thanh.','Kore'),audioBase64,mimeType:'audio/wav',duration:seconds,ttsProfile:getTtsProfile('Kore'),timestamp:Date.now()});
        localStorage.setItem('videoai2-html-export:'+id,JSON.stringify({rawHtml:html,fileName:'diagnostic.html'}));
      },{id,html,audioBase64,seconds});await host.goto('http://127.0.0.1:4173/?html-kore-export='+id);await host.getByText('Kore đã sẵn sàng. Bấm “Bắt đầu xuất video”.',{exact:true}).waitFor();
    }
    await page.bringToFront();
    await page.evaluate(webm=>{
      navigator.mediaDevices.getDisplayMedia=async()=>{
        const canvas=document.createElement('canvas');canvas.width=innerWidth;canvas.height=innerHeight;const ctx=canvas.getContext('2d');let tick=0;
        const paint=()=>{ctx.fillStyle=tick++%48<24?'#2456ab':'#39aa65';ctx.fillRect(0,0,canvas.width,canvas.height);};paint();const timer=setInterval(paint,1000/24);const stream=canvas.captureStream(24);const track=stream.getVideoTracks()[0];track.addEventListener('ended',()=>clearInterval(timer));return stream;
      };
      if(webm){const supported=MediaRecorder.isTypeSupported.bind(MediaRecorder);MediaRecorder.isTypeSupported=type=>!type.includes('mp4')&&supported(type);}
    },webm);
    return {page,host};
  }
  const results=[];
  for(const [kind,seconds,webm] of [['normal',4,false],['standalone',4,false],['standalone',4,true],['standalone',120,false]]){
    const {page,host}=await create(kind,seconds,webm);const downloads=[];page.on('download',d=>downloads.push(d));
    const file=page.waitForEvent('download',{timeout:(seconds+35)*1000});
    const failed=page.waitForFunction(()=>/Đã hủy|Thời lượng hình\/tiếng|không kiểm tra được|chuyển nền|chưa hoàn tất|Bản xuất chưa đủ|Không nhận được dữ liệu/i.test(document.body.innerText) || Boolean(document.querySelector('#error')?.textContent?.trim()),null,{timeout:(seconds+35)*1000}).then(async()=>{throw Error(await page.locator('body').innerText());});
    const wall=Date.now();await page.getByRole('button',{name:'Bắt đầu xuất video 9:16',exact:true}).click();
    const download=await Promise.race([file,failed]).catch(async e=>{console.error('Recording UI at failure:',await page.locator('body').innerText());throw e;});const out=path.join(output,kind+'-'+seconds+(webm?'-webm':'')+path.extname(download.suggestedFilename()));await download.saveAs(out);
    const probe=JSON.parse(execFileSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',out]));
    const v=probe.streams.find(s=>s.codec_type==='video'),a=probe.streams.find(s=>s.codec_type==='audio');assert.ok(v&&a);assert.equal(v.width,720);assert.equal(v.height,1280);
    // Live MediaRecorder WebM need not contain a container Duration element.
    // Independently measure both encoded tracks with ffprobe packet timestamps.
    const packets=JSON.parse(execFileSync('ffprobe',['-v','error','-show_packets','-show_entries','packet=stream_index,pts_time,duration_time','-of','json',out],{maxBuffer:32*1024*1024})).packets;
    const end=index=>Math.max(...packets.filter(p=>p.stream_index===index).map(p=>Number(p.pts_time)+Number(p.duration_time||0)));
    const video=end(v.index),audio=end(a.index);
    assert.ok(Math.abs(video-seconds)<4,JSON.stringify({kind,seconds,video,audio}));assert.ok(Math.abs(video-audio)<0.5,JSON.stringify({video,audio}));
    execFileSync('ffmpeg',['-v','error','-xerror','-i',out,'-f','null','-']);
    results.push({kind,seconds,webm,wall:(Date.now()-wall)/1000,duration:probe.format.duration,video,audio,format:probe.format.format_name});
    console.log('PASS: native recording',JSON.stringify(results.at(-1)));await page.close();if(host!==page)await host.close();
  }
  for(const kind of ['normal','standalone']){
    const {page,host}=await create(kind,20);let downloads=0;page.on('download',()=>downloads++);
    await page.getByRole('button',{name:'Bắt đầu xuất video 9:16',exact:true}).click();
    await page.waitForFunction(()=>[...document.querySelectorAll('iframe')].some(f=>(f.getAttribute('srcdoc')||'').includes('narrationScript')));
    const other=await context.newPage();await other.goto('about:blank');await other.bringToFront();
    await page.waitForFunction(()=>document.body.innerText.includes('Tab xuất đã bị ẩn'),null,{timeout:5000,polling:100});
    assert.equal(downloads,0);await other.close();await page.close();if(host!==page)await host.close();console.log('PASS: hidden '+kind+' recording discarded');
  }
  const {page,host}=await create('standalone',20);let downloads=0;page.on('download',()=>downloads++);
  await page.getByRole('button',{name:'Bắt đầu xuất video 9:16',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#lesson')?.getAttribute('srcdoc')?.includes('narrationScript'));
  await page.evaluate(()=>{window.requestAnimationFrame=()=>0;});await page.getByText(/Hình bị gián đoạn/).waitFor();assert.equal(downloads,0);await page.close();await host.close();
  assert.equal(apiCalls,0);assert.deepEqual(errors,[]);await fs.writeFile(path.join(output,'results.json'),JSON.stringify({results,hidden:'PASS',stalled:'PASS',apiCalls},null,2));
}finally{await browser?.close();server.kill();}
