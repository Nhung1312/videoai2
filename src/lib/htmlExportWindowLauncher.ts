import {
  writeStandaloneHtmlExportShell,
  type StandaloneHtmlExportPayload,
} from './htmlStandaloneExporter';

export const needsStandaloneHtmlExport = (): boolean =>
  window.self !== window.top || /(^|\.)aistudio\.google\.com$/i.test(window.location.hostname);

/** Open synchronously from the click, then hand cached lesson data to the
 * existing shell. Never navigate an embedded preview URL into a top-level tab.
 */
export const openStandaloneHtmlExport = async (
  exportId: string,
  loadPayload: () => Promise<StandaloneHtmlExportPayload>
): Promise<void> => {
  const target = window.open('about:blank', '_blank');
  if (!target) throw new Error('Trình duyệt đã chặn tab xuất video. Hãy cho phép mở cửa sổ bật lên rồi bấm lại.');

  let receiveReady: () => void;
  const ready = new Promise<void>(resolve => { receiveReady = resolve; });
  const onMessage = (event: MessageEvent) => {
    if (event.source === target && event.data?.source === 'videoai2-standalone-export-ready' && event.data.exportId === exportId) receiveReady();
  };
  window.addEventListener('message', onMessage);
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    writeStandaloneHtmlExportShell(target, exportId);
    const payload = await loadPayload();
    await Promise.race([
      ready,
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Cửa sổ xuất video chưa sẵn sàng. Hãy bấm xuất lại.')), 10000); }),
    ]);
    if (target.closed) throw new Error('Cửa sổ xuất video đã đóng. Hãy bấm xuất lại.');
    target.postMessage({ source: 'videoai2-standalone-export-init', exportId, payload }, window.location.origin === 'null' ? '*' : window.location.origin);
  } catch (error) {
    target.close();
    throw error;
  } finally {
    clearTimeout(timeout);
    window.removeEventListener('message', onMessage);
  }
};
