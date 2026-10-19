import test from 'node:test';
import assert from 'node:assert/strict';
import { portraitViewport, injectPortraitLayout } from '../src/portrait-layout.mjs';

test('phone lesson keeps author CSS coordinates with a native 720x1280 raster', () => {
  const html = `<div class='container'><main id='board'><section class='step-box'></section></main></div>`;
  const v = portraitViewport(html);
  assert.equal(v.width * v.deviceScaleFactor, 720); assert.equal(v.height * v.deviceScaleFactor, 1280);
  assert.equal(v.width, 288);
  assert.equal(portraitViewport('<p>arbitrary html</p>').width, 720);
  assert.equal(portraitViewport(html, { readablePortrait: false }).width, 720);
});
test('runtime copy replaces old scroll fitting without editing author animation', () => {
  const author = `<script>async function startAnimation(){await withCue('x',animate);}</script>`;
  const html = `<html><head><script data-videoai2-recording-scroll-fix>oldFit()</script></head><body>${author}</body></html>`;
  const result = injectPortraitLayout(html);
  assert.ok(!result.includes('oldFit()'));
  assert.ok(result.includes(author)); assert.ok(html.includes('oldFit()'));
  assert.ok(result.includes('data-videoai2-readable-portrait'));
});
