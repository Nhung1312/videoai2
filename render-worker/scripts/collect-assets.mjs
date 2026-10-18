import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import { parse } from 'parse5';
import { sha256 } from '../src/package.mjs';
import { assertRender } from '../src/errors.mjs';

const HOSTS = new Set(['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com']);
export function cssUrls(css) {
  const urls = [];
  for (const match of css.matchAll(/url\(\s*(?:(["'])(.*?)\1|([^\s)]+))\s*\)/g)) urls.push(match[2] ?? match[3]);
  for (const match of css.matchAll(/@import\s+(["'])(.*?)\1/g)) urls.push(match[2]);
  return urls.filter(url => !/^(?:data:|blob:|#)/i.test(url));
}
export function inspectAssetUrls(html) {
  const urls = new Set();
  const visit = node => {
    const attrs = Object.fromEntries((node.attrs || []).map(a => [a.name, a.value]));
    const value = node.nodeName === 'link' ? attrs.href : attrs.src;
    if (value && /^https:\/\//.test(value)) urls.add(value);
    const css = node.nodeName === 'style' ? (node.childNodes || []).map(n => n.value || '').join('') : attrs.style || '';
    for (const url of cssUrls(css)) if (/^https:\/\//.test(url)) urls.add(url);
    for (const child of node.childNodes || []) visit(child);
  };
  visit(parse(html));
  // MathJax's combined tex-svg bundle loads optional TeX extensions lazily.
  // Stage explicit require packages and the color commands used in lessons;
  // never permit the offline renderer to fetch them itself.
  const packages = new Set([...html.matchAll(/\\require\{([a-zA-Z0-9_-]+)\}/g)].map(m => m[1]));
  if (/\\(?:color|textcolor|definecolor|colorbox|fcolorbox)\b/.test(html)) packages.add('color');
  for (const url of [...urls]) {
    if (!/\/mathjax\/[^/]+\/es5\/(?:tex|tex-mml)-(?:svg|chtml)(?:-full)?\.js(?:\?.*)?$/.test(url)) continue;
    const base = new URL('./', url);
    for (const name of packages) urls.add(new URL(`input/tex/extensions/${name}.js`, base).href);
  }
  return urls;
}
export function isPublicAddress(address) {
  // Asset staging intentionally accepts IPv4 only. No IPv6/mapped-address or
  // alternate numeric-host parsing can bypass the private-address checks.
  if (net.isIP(address) !== 4) return false;
  const [a, b] = address.split('.').map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && [0, 168].includes(b) || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19].includes(b));
}
export async function fetchAsset(input, redirect = 0) {
  const url = new URL(input);
  assertRender(url.protocol === 'https:' && HOSTS.has(url.hostname) && !url.username && !url.password && (!url.port || url.port === '443'), 'package-error', `CDN không được cho phép: ${url.href}`);
  assertRender(redirect <= 4, 'package-error', 'Tài nguyên chuyển hướng quá nhiều lần.');
  const addresses = await dns.lookup(url.hostname, { family: 4, all: true });
  assertRender(addresses.length && addresses.every(a => isPublicAddress(a.address)), 'package-error', 'DNS trỏ vào mạng riêng.');
  const pinned = addresses[0].address;
  return new Promise((resolve, reject) => {
    const request = https.get(url, { lookup: (_host, options, callback) => options.all ? callback(null, [{ address: pinned, family: 4 }]) : callback(null, pinned, 4), timeout: 20000, headers: { 'User-Agent': 'videoai2-asset-stager/1' } }, response => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume(); fetchAsset(new URL(response.headers.location, url).href, redirect + 1).then(resolve, reject); return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`CDN HTTP ${response.statusCode}: ${url.href}`)); return; }
      let size = 0; const chunks = [];
      response.on('data', chunk => { size += chunk.length; if (size > 32 * 1024 * 1024) request.destroy(new Error('Tài nguyên vượt 32 MiB.')); else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => resolve({ bytes: Buffer.concat(chunks), contentType: response.headers['content-type'] || 'application/octet-stream', finalUrl: url.href }));
    });
    request.on('timeout', () => request.destroy(new Error('CDN timeout.')));
    request.on('error', reject);
  });
}

export async function collectAssets(directory) {
  const manifestFile = path.join(directory, 'manifest.json');
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  const html = await fs.readFile(path.join(directory, manifest.lesson || 'lesson.html'), 'utf8');
  const urls = inspectAssetUrls(html);
  const existing = new Set((manifest.assets || []).map(a => a.url));
  await fs.mkdir(path.join(directory, 'assets'), { recursive: true });
  for (const url of urls) {
    if (existing.has(url)) continue;
    const asset = await fetchAsset(url);
    const file = `assets/${sha256(Buffer.from(url))}`;
    await fs.writeFile(path.join(directory, file), asset.bytes);
    manifest.assets ??= [];
    manifest.assets.push({ url, file, contentType: asset.contentType, sha256: sha256(asset.bytes) });
    existing.add(url);
    if (/text\/css/.test(asset.contentType)) {
      const css = asset.bytes.toString('utf8');
      for (const value of cssUrls(css)) urls.add(new URL(value, asset.finalUrl).href);
    }
    assertRender(urls.size <= 250, 'package-error', 'Quá nhiều tài nguyên trong package.');
  }
  await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2));
  return manifest.assets || [];
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try { console.log(JSON.stringify({ assets: (await collectAssets(process.argv[2])).length })); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
