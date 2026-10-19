// Test-only visual states. Final MP4s still run the untouched author animation.
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadPackage } from '../src/package.mjs';
import { createRuntime } from '../src/runtime.mjs';
import { openRunner } from '../src/browser.mjs';
import { runProcess } from '../src/process.mjs';

const [input, output] = process.argv.slice(2); await fs.mkdir(output, { recursive: true });
const pkg = await loadPackage(input); const runtime = await createRuntime(); let runner;
try {
  runner = await openRunner(pkg, runtime, { chromiumPath: process.env.CHROMIUM_BIN });
  const results=[];
  for (const mode of ['intro','step1','step3','step4','long-text','final']) {
    await runner.page.evaluate(mode => {
      const steps=[...document.querySelectorAll('.step-box')];
      for(const s of steps){s.style.display='none';s.classList.remove('compact');for(const el of s.querySelectorAll('.line,.math-line,.step-title')){el.classList.remove('show','vanish');el.style.display='none';el.innerHTML='';}}
      document.getElementById('full-rule')?.classList.remove('show');
      const number=mode==='intro'||mode==='step1'?1:mode==='step3'?3:4;
      const active=document.getElementById('part-'+number);active.style.display='block';
      for(const el of active.querySelectorAll('[data-text]')){el.innerHTML=el.dataset.text;el.style.display='block';}
      for(const group of active.querySelectorAll('.collapse'))group.classList.remove('collapse');
      for(const el of active.querySelectorAll('.math-line')) {
        const stash=document.getElementById('b'+el.id.slice(1).replace('_','-'));
        if(stash){el.innerHTML=stash.innerHTML;el.classList.add('show');el.style.display='';}
      }
      if(mode==='intro')for(const el of active.querySelectorAll('.math-line,.line'))if(el.id!=='t1_1'&&el.id!=='m1_1'){el.style.display='none';el.classList.remove('show');}
      if(mode==='long-text'){
        const el=document.createElement('div');el.id='readable-long-tail';el.className='line';el.style.display='block';el.textContent='Đây là dòng dài cần được đọc trọn vẹn. '.repeat(35)+' DÒNG CUỐI PHẢI HIỂN THỊ.';active.append(el);
      }
      if(mode==='final')document.getElementById('full-rule').classList.add('show');
      window.__videoai2PortraitLayout.fit();
    },mode);
    await new Promise(resolve=>setTimeout(resolve,1000));
    const state=await runner.snapshot();
    const filename=path.join(output,mode+'.png');
    await runProcess('ffmpeg',['-v','error','-y','-f','x11grab','-video_size','720x1280','-draw_mouse','0','-i',runtime.env.DISPLAY,'-frames:v','1',filename],{env:runtime.env,timeoutMs:15000});
    results.push({mode,viewport:state.viewport,layout:state.layout});
    if(state.layout?.focusOverflow>1)throw new Error('Focused text is clipped: '+JSON.stringify(results.at(-1)));
  }
  await fs.writeFile(path.join(output,'layout-probe.json'),JSON.stringify(results,null,2));
  console.log(JSON.stringify({probePassed:true,cases:results.length,viewport:results[0].viewport}));
} finally {await runner?.browser.close();await runtime.close();}
