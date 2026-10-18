// Acceptance-only transport. User HTML/audio and resulting videos are never
// committed in plaintext or uploaded as plaintext public workflow artifacts.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const [command, directory, outputDirectory] = process.argv.slice(2);
const root = path.resolve(directory);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const runId = process.env.GITHUB_RUN_ID;
const aad = Buffer.from(`videoai2-kore-acceptance:${runId}`);
if (!runId || !/^\d+$/.test(runId)) throw new Error('Missing workflow run identity.');

if (command === 'init') {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  await fs.writeFile(path.join(root, 'private.pem'), privateKey, { mode: 0o600 });
  const exchange = path.join(root, 'exchange');
  await fs.mkdir(exchange);
  await fs.writeFile(path.join(exchange, 'request.json'), JSON.stringify({ version: 1, runId, publicKey }));
} else if (command === 'receive') {
  const api = `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}`;
  const headers = { Authorization: `Bearer ${process.env.GH_READ_TOKEN}`, Accept: 'application/vnd.github+json' };
  let index;
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    const response = await fetch(`${api}/contents/render-worker/acceptance-input/index.json?ref=${encodeURIComponent(process.env.GITHUB_REF_NAME)}`, { headers });
    if (response.ok) {
      const data = await response.json();
      const candidate = JSON.parse(Buffer.from(data.content, 'base64'));
      if (candidate.version === 1 && candidate.runId === runId) { index = candidate; break; }
    } else if (response.status !== 404) throw new Error(`Input lookup failed: HTTP ${response.status}`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  if (!index || !Array.isArray(index.chunks) || index.chunks.length > 100) throw new Error('Encrypted input did not arrive.');
  const chunks = [];
  for (const chunk of index.chunks) {
    if (!/^[a-f0-9]{40}$/.test(chunk.sha)) throw new Error('Invalid input blob.');
    const response = await fetch(`${api}/git/blobs/${chunk.sha}`, { headers });
    if (!response.ok) throw new Error(`Input transfer failed: HTTP ${response.status}`);
    const blob = await response.json();
    const bytes = Buffer.from(blob.content, 'base64');
    if (hash(bytes) !== chunk.sha256) throw new Error('Encrypted chunk checksum mismatch.');
    chunks.push(bytes);
  }
  const cipher = Buffer.concat(chunks);
  if (cipher.length > 32 * 1024 * 1024 || hash(cipher) !== index.cipherSha256) throw new Error('Encrypted input checksum mismatch.');
  const key = crypto.privateDecrypt({ key: await fs.readFile(path.join(root, 'private.pem')), oaepHash: 'sha256' }, Buffer.from(index.wrappedKey, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(index.iv, 'base64'));
  decipher.setAAD(aad); decipher.setAuthTag(Buffer.from(index.tag, 'base64'));
  const html = gunzipSync(Buffer.concat([decipher.update(cipher), decipher.final()]), { maxOutputLength: 80 * 1024 * 1024 });
  if (hash(html) !== index.originalSha256) throw new Error('Original HTML checksum mismatch.');
  await fs.writeFile(path.join(root, 'lesson.html'), html, { mode: 0o600 });
  await fs.writeFile(path.join(root, 'recipient.pem'), index.returnPublicKey, { mode: 0o600 });
  console.log(JSON.stringify({ received: true, originalBytes: html.length, originalSha256: index.originalSha256 }));
} else if (command === 'seal') {
  const recipient = await fs.readFile(path.join(root, 'recipient.pem'));
  const archive = path.join(root, 'results.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', path.resolve(outputDirectory), '.']);
  const key = crypto.randomBytes(32); const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(aad);
  const encrypted = Buffer.concat([cipher.update(await fs.readFile(archive)), cipher.final()]);
  const sealed = path.join(root, 'sealed'); await fs.mkdir(sealed, { recursive: true });
  await fs.writeFile(path.join(sealed, 'results.enc'), encrypted);
  await fs.writeFile(path.join(sealed, 'index.json'), JSON.stringify({ version: 1, runId, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), cipherSha256: hash(encrypted), wrappedKey: crypto.publicEncrypt({ key: recipient, oaepHash: 'sha256' }, key).toString('base64') }));
  await fs.unlink(archive);
  console.log(JSON.stringify({ encryptedResults: true, bytes: encrypted.length }));
} else throw new Error('Expected init, receive or seal.');
