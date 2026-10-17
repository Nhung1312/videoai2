import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from '../src/package.mjs';

export function wavTone(seconds = 0.15, frequency = 700) {
  const rate = 48000; const samples = Math.round(seconds * rate);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) {
    const fade = Math.min(1, i / 240, (samples - i) / 240);
    buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * i / rate) * 9000 * fade), 44 + i * 2);
  }
  return buffer;
}

export async function diagnosticPackage(directory, { count = 18, lastSeconds = 1.1, firstSeconds = 1.1, error = false, staticSeconds = 5 } = {}) {
  await fs.mkdir(path.join(directory, 'audio'), { recursive: true });
  const ids = Array.from({ length: count }, (_, i) => `cue_${i + 1}`);
  const narration = Object.fromEntries(ids.map(id => [id, `Chẩn đoán ${id}`]));
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body {margin:0;width:100%;height:100%;background:#121829;color:white;font:28px Arial}
.container{display:flex;flex-direction:column;height:100%;padding:24px;box-sizing:border-box}
.board{flex:1;overflow:hidden;position:relative}.step-box{padding:12px;font-size:28px;min-height:40px}
#marker{position:fixed;left:0;top:0;width:80px;height:80px;background:#000}
#typing{font-size:32px;color:#ffee77}math{font-size:36px}
</style></head><body><div class="container"><h1>Chẩn đoán pipeline 18 cue</h1><p>Âm báo tổng hợp; KHÔNG phải Kore.</p><math><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mi>x</mi><mo>=</mo><mn>2</mn></math><div class="board" id="board"><div id="scroll-content"><div class="step-box" id="step"><div id="typing"></div></div></div></div></div><div id="marker"></div><script>
const narrationScript=${JSON.stringify(narration)};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function cue(id){await window.onNarrationCue(id,narrationScript[id]);}
async function withCue(id,animationFn){await Promise.all([cue(id),animationFn()]);}
async function startAnimation(){
  for(let i=1;i<=${count};i++){
    await withCue('cue_'+i,async()=>{
      document.getElementById('marker').style.background=i%2?'#ffffff':'#000000';
      document.getElementById('typing').textContent='';
      for(const char of 'Bước '+i+': Kiểm tra đồng bộ hình và tiếng. '){document.getElementById('typing').textContent+=char;await sleep(3);}
      ${error ? "if(i===2)throw new Error('intentional-animation-failure');" : ''}
    });
    if(i===Math.ceil(${count}/2))await sleep(${staticSeconds * 1000});
    await sleep(120);
  }
  document.getElementById('typing').textContent='Đã xong — giữ đủ hình cuối';
}
startAnimation();
</script></body></html>`;
  const cues = [];
  for (const [i, id] of ids.entries()) {
    const bytes = wavTone(i === 0 ? firstSeconds : i === count - 1 ? lastSeconds : 0.2 + i % 3 * 0.05, 700 + i * 30);
    const file = `audio/${i}.wav`;
    await fs.writeFile(path.join(directory, file), bytes);
    cues.push({ id, file, mimeType: 'audio/wav', sha256: sha256(bytes) });
  }
  await fs.writeFile(path.join(directory, 'lesson.html'), html);
  const manifest = { version: 1, width: 720, height: 1280, fps: 30, playbackRate: 1, voiceName: 'Kore', lesson: 'lesson.html', source: { kind: 'synthetic-diagnostic', note: 'Tones only, never qualifies the real Kore acceptance gate.' }, cues, assets: [] };
  await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { html, manifest };
}
