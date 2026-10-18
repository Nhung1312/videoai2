import test from 'node:test';
import assert from 'node:assert/strict';
import { cssUrls, inspectAssetUrls } from '../scripts/collect-assets.mjs';

test('stage inline font imports with semicolons and nested CSS URLs', () => {
  const url = 'https://fonts.googleapis.com/css2?family=Nunito:wght@400;700;900&display=swap';
  const html = `<head><style>@import url('${url}');</style></head>`;
  assert.ok(inspectAssetUrls(html).has(url));
  assert.deepEqual(cssUrls('@import "nested.css"; @font-face{src:url(../font.woff2)} .x{background:url(data:image/png;base64,abc)}'), ['../font.woff2', 'nested.css']);
});
test('stage MathJax color and explicit require extensions before offline render', () => {
  const base = 'https://cdnjs.cloudflare.com/ajax/libs/mathjax/3.2.2/es5/';
  const html = `<script src="${base}tex-svg.js"></script><div>\\color{red}{x} \\require{bbox}</div>`;
  const urls = inspectAssetUrls(html);
  assert.ok(urls.has(base + 'input/tex/extensions/color.js'));
  assert.ok(urls.has(base + 'input/tex/extensions/bbox.js'));
});
