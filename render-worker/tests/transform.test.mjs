import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { gateLessonHtml, inspectLesson } from '../src/transform.mjs';

function execute(source) {
  const seen = []; let calls = 0;
  const context = { __videoai2ServerRenderV1: { wrapStart(fn) { return function(...args) { calls++; seen.push(Reflect.apply(fn, this, args)); }; } } };
  context.window = context; context.globalThis = context;
  const html = `<html><head></head><body><script>${source}</script></body></html>`;
  const transformed = gateLessonHtml(html);
  vm.runInNewContext(transformed.match(/<script>([\s\S]*)<\/script>/)[1], context);
  return { calls, seen, transformed };
}
test('gate is installed before an eager call to a hoisted entry', () => {
  const result = execute('startAnimation();function startAnimation(){return 42;}');
  assert.equal(result.calls, 1); assert.deepEqual(result.seen, [42]);
});
test('lexical arrow entry keeps its captured variables', () => {
  const result = execute('const text=23; const startAnimation=()=>text; startAnimation();');
  assert.deepEqual(result.seen, [23]);
});
test('window assignment and strict directive remain valid', () => {
  const result = execute('"use strict";window.startAnimation=function(){return this===window;};window.startAnimation();');
  assert.deepEqual(result.seen, [true]);
});
test('reject ambiguous/missing entry rather than letting HTML run ungated', () => {
  assert.throws(() => gateLessonHtml('<html><script>const x=1</script></html>'), /startAnimation/);
  assert.throws(() => gateLessonHtml('<html><script>function startAnimation(){};window.startAnimation=()=>{}</script></html>'), /startAnimation/);
});
test('inspect flat narration without eval, including Vietnamese and template strings', () => {
  const result = inspectLesson('<html><script>const narrationScript={a:"mờ", "b":`ích`};function startAnimation(){}</script></html>');
  assert.deepEqual(result.cueIds, ['a', 'b']);
});
