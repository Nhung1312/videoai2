import { spawn } from 'node:child_process';
import { RenderError } from './errors.mjs';

export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export function startProcess(command, args, { env, cwd, extraPipe = false } = {}) {
  const child = spawn(command, args, { env, cwd, stdio: ['pipe', 'ignore', 'pipe', ...(extraPipe ? ['pipe'] : [])] });
  let stderr = '';
  child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-65536); });
  const finished = new Promise((resolve, reject) => {
    child.once('error', error => reject(new RenderError('render-error', `Không chạy được ${command}: ${error.message}`)));
    child.once('close', (code, signal) => resolve({ code, signal, stderr }));
  });
  finished.catch(() => {});
  return { child, finished, stderr: () => stderr };
}
export async function runProcess(command, args, options = {}) {
  const proc = startProcess(command, args, options);
  const timer = setTimeout(() => proc.child.kill('SIGKILL'), options.timeoutMs ?? 120000);
  const abort = () => proc.child.kill('SIGTERM');
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    const result = await proc.finished;
    if (result.code !== 0) throw new RenderError('render-error', `${command} kết thúc bất thường.`, result);
    return result;
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
export async function stopProcess(proc, { graceful = false, timeoutMs = 5000 } = {}) {
  if (!proc || proc.child.exitCode !== null || proc.child.signalCode !== null) return proc?.finished;
  if (graceful && proc.child.stdin.writable) proc.child.stdin.write('q\n');
  else proc.child.kill('SIGTERM');
  const timer = setTimeout(() => proc.child.kill('SIGKILL'), timeoutMs);
  try { return await proc.finished; } finally { clearTimeout(timer); }
}
export async function waitUntil(check, { timeoutMs = 10000, label = 'dịch vụ', proc } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc && (proc.child.exitCode !== null || proc.child.signalCode !== null)) throw new RenderError('render-error', `${label} dừng trước khi sẵn sàng.`, { stderr: proc.stderr() });
    if (await check()) return;
    await delay(50);
  }
  throw new RenderError('timeout', `Hết thời gian chờ ${label}.`, { stderr: proc?.stderr() });
}
