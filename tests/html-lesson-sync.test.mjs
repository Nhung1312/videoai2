import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'acorn';
import { validateHtmlLesson, stableHtmlLessonId, injectHtmlNarrationBridge } from '../src/lib/htmlLessonBridge.ts';
import { inspectHtmlLessonSource, readLessonScripts, withHtmlCueManifest } from '../src/lib/htmlLessonSource.ts';
import { prepareHtmlLessonSync } from '../src/lib/htmlLessonSync.ts';
import { buildOfflineKoreHtml } from '../src/lib/htmlOfflineKoreExporter.ts';

const lesson = (body, extra = '') => `<!doctype html><html><head><style>.panel{opacity:0}.panel.show{opacity:1}</style></head><body><p>Toán giữ nguyên: x² + 2x = 3; AB ⟂ CD; 15 km.</p><script>
const narrationScript = { 'used': 'Lời thực sự dùng.', 'unused': 'Không tạo TTS.', 'branch': 'Nhánh không chạy.' };
async function cue(id) { if(window.onNarrationCue) await window.onNarrationCue(id,narrationScript[id]); }
async function withCue(id, callback) { await Promise.all([cue(id), callback()]); }
${extra}
async function startAnimation() { ${body} }
window.addEventListener('load',()=>startAnimation());
</script></body></html>`;

test('unused declarations, comments and strings are not cue calls', () => {
  const html = lesson(`await withCue('used',async()=>{}); // cue('unused')\nconst text="cue('unused')";`);
  assert.deepEqual(validateHtmlLesson(html).cues.map(c => c.id), ['used']);
  assert.equal(inspectHtmlLessonSource(html).declared.length, 3);
  assert.equal(validateHtmlLesson(lesson('const s="cue(\\\'used\\\')";')).success, false);
});

test('dynamic IDs remain valid without guessing which branch should spend TTS', () => {
  const html = lesson(`for (const id of ['used']) await withCue(id,async()=>{}); if(false) await cue('branch');`);
  assert.equal(validateHtmlLesson(html).success, true);
  const prepared = withHtmlCueManifest(html, ['used', 'used']);
  assert.deepEqual(validateHtmlLesson(prepared).cues.map(c => c.id), ['used']);
  assert.equal(stableHtmlLessonId(prepared), stableHtmlLessonId(html), 'existing cached audio keys must stay valid');
  assert.equal(withHtmlCueManifest(prepared, ['used']), prepared);
});

test('cue inspection supports flat JS literals and rejects invalid or duplicate declarations without eval', () => {
  const html = lesson('await cue(`used`);').replace("'used': 'Lời thực sự dùng.'", 'used: `Lời thực sự dùng.`');
  assert.deepEqual(validateHtmlLesson(html).cues.map(c => c.id), ['used']);
  assert.equal(validateHtmlLesson(html.replace('const narrationScript = {', "const narrationScript = { used:'duplicate',")).success, false);
  assert.equal(validateHtmlLesson(lesson('await cue(')).success, false);
});

test('cleanup instrumentation preserves math/text and valid syntax, including nested expressions', () => {
  const html = lesson(`await withCue(await Promise.resolve('used'),async()=>{
    const el=document.getElementById('popup'); el.classList.add('show');
    await new Promise(r=>setTimeout(r,1)); el.style.opacity=0;
    el.classList.remove('show'); document.getElementById('target').replaceChildren();
    const text='withCue(\"unused\")'; el.setAttribute('data-math', 'x²');
  });`);
  const transformed = prepareHtmlLessonSync(html);
  assert.equal(prepareHtmlLessonSync(transformed), transformed);
  assert.ok(transformed.indexOf('<meta charset="utf-8">') < transformed.indexOf('<script data-videoai2-lesson-sync>'));
  assert.ok(transformed.indexOf('<meta charset="utf-8">') < 1024);
  assert.ok(transformed.includes('x² + 2x = 3; AB ⟂ CD; 15 km.'));
  assert.ok(transformed.includes("const text='withCue(\"unused\")'"));
  for (const script of readLessonScripts(transformed)) assert.doesNotThrow(() => parse(script.source, { ecmaVersion: 'latest' }));
  assert.ok(transformed.includes('.assign(el.style,"opacity",0)'));
  assert.ok(transformed.includes('.method(el.classList,"remove",[\'show\'])'));
});

test('function, arrow and assignment entries use the same completion gate', () => {
  const original = lesson("await cue('used');");
  for (const html of [original, original.replace('async function startAnimation()', 'const startAnimation=async() =>'), original.replace('async function startAnimation()', 'window.startAnimation=async function()')]) {
    const transformed = prepareHtmlLessonSync(html);
    assert.ok(transformed.includes('.wrapStart('));
    for (const script of readLessonScripts(transformed)) assert.doesNotThrow(() => parse(script.source, { ecmaVersion: 'latest' }));
  }
});

test('preview/video bridge and manual HTML share the same synchronization runtime', () => {
  const html = lesson("await cue('used');");
  for (const output of [injectHtmlNarrationBridge(html, 'session', 'lesson'), buildOfflineKoreHtml(html, [{ id:'used',mimeType:'audio/wav',audioBase64:'fixture' }], 1)]) {
    assert.equal((output.match(/<script data-videoai2-lesson-sync>/g) || []).length, 1);
    assert.ok(output.includes('x² + 2x = 3; AB ⟂ CD; 15 km.'));
  }
});
