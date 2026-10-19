import { parse } from 'parse5';

export function portraitViewport(html, options = {}) {
  let container = false; let board = false; let steps = false;
  const visit = node => {
    const a = Object.fromEntries((node.attrs || []).map(x => [x.name, x.value]));
    const classes = (a.class || '').split(/\s+/);
    container ||= classes.includes('container'); board ||= a.id === 'board'; steps ||= classes.includes('step-box');
    for (const child of node.childNodes || []) visit(child);
  };
  visit(parse(html));
  // Author coordinates stay in CSS pixels; native Chromium rasterizes at 2.5x.
  // Xvfb and FFmpeg still capture exactly 720x1280 pixels, without video scaling.
  return options.readablePortrait !== false && container && board && steps
    ? { width: 288, height: 512, deviceScaleFactor: 2.5, readable: true }
    : { width: 720, height: 1280, deviceScaleFactor: 1, readable: false };
}

export function installPortraitLayout() {
  const install = () => {
    const board = document.getElementById('board');
    if (!board) return;
    const rect = el => { const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
    const shown = el => {
      if (!el?.getClientRects().length) return false;
      for (let p = el; p && p !== board; p = p.parentElement) {
        if (p.classList.contains('collapse') || p.classList.contains('vanish') || getComputedStyle(p).visibility === 'hidden' || getComputedStyle(p).display === 'none') return false;
      }
      return true;
    };
    const set = (el, property, value) => { if (el.style[property] !== value) el.style[property] = value; };
    let active = null; let pending = false; let state = null; let maxFocusOverflow = 0;
    const seen = new Set();
    const caretRect = el => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let last; let n;
      while ((n = walker.nextNode())) if (n.textContent.trim() && !n.parentElement.closest('svg,mjx-container')) last = n;
      if (!last) return rect(el);
      const range = document.createRange();
      range.setStart(last, Math.max(0, last.textContent.length - 1)); range.setEnd(last, last.textContent.length);
      const r = range.getBoundingClientRect();
      return r.height ? r : rect(el);
    };
    const fit = () => {
      pending = false;
      const visible = [...board.querySelectorAll('.step-box')].filter(shown);
      const next = visible.at(-1);
      if (!next) { board.scrollTop = 0; return; }
      if (active !== next) {
        if (active) {
          active.removeAttribute('data-videoai2-current');
          for (const p of ['zoom', 'maxHeight', 'overflowY']) set(active, p, '');
          active.scrollTop = 0;
        }
        active = next; active.setAttribute('data-videoai2-current', '1');
      }
      const bs = getComputedStyle(board);
      const safe = Math.max(40, board.clientHeight - parseFloat(bs.paddingTop) - parseFloat(bs.paddingBottom) - 4);
      board.style.setProperty('--videoai2-end-space', board.clientHeight + 'px');
      set(active, 'zoom', '1');
      const natural = active.scrollHeight + active.offsetHeight - active.clientHeight;
      const ratio = Math.min(1, safe / Math.max(1, natural));
      const scrollInside = ratio < 0.85;
      if (scrollInside) {
        set(active, 'maxHeight', safe + 'px'); set(active, 'overflowY', 'auto');
      } else {
        set(active, 'maxHeight', ''); set(active, 'overflowY', 'visible');
        set(active, 'zoom', String(Math.max(0.85, ratio))); active.scrollTop = 0;
      }
      // Extra end space lets a short last step reach the TOP of the board.
      // Keep every earlier step in the DOM and scroll past it.
      board.scrollTop += active.getBoundingClientRect().top - board.getBoundingClientRect().top - parseFloat(bs.paddingTop);
      const blocks = [...active.querySelectorAll('.step-title,.line,.math-line.show')].filter(shown);
      for (const el of blocks) if (el.id) seen.add(el.id);
      const focus = blocks.at(-1) || active;
      const title = active.querySelector('.step-title');
      if (scrollInside && focus !== title) {
        const ar = active.getBoundingClientRect(); const tr = title && shown(title) ? title.getBoundingClientRect() : null;
        const top = tr ? Math.max(ar.top + 4, tr.bottom + 4) : ar.top + 8;
        const bottom = ar.bottom - 10;
        const fr = focus.matches('.line') ? caretRect(focus) : focus.getBoundingClientRect();
        if (fr.bottom > bottom) active.scrollTop += fr.bottom - bottom;
        else if (fr.top < top) active.scrollTop -= top - fr.top;
      }
      const br = board.getBoundingClientRect(); const ar = active.getBoundingClientRect();
      const fr = focus.matches('.line') ? caretRect(focus) : focus.getBoundingClientRect();
      const overflow = Math.max(0, br.top - fr.top, fr.bottom - br.bottom, -fr.left, fr.right - innerWidth);
      maxFocusOverflow = Math.max(maxFocusOverflow, overflow);
      state = { activeId: active.id, focusId: focus.id, fontScale: scrollInside ? 1 : Math.max(0.85, ratio), scrollInside, board: rect(board), active: rect(active), focus: { top: fr.top, bottom: fr.bottom, left: fr.left, right: fr.right }, focusOverflow: overflow, maxFocusOverflow, seenIds: [...seen] };
    };
    const schedule = () => { if (!pending) { pending = true; requestAnimationFrame(fit); } };
    // Only the temporary export document is adapted. Author animation and cue
    // functions stay intact; callbacks keep their original real-time clocks.
    window.autoScroll = fit;
    Object.defineProperty(window, '__videoai2PortraitLayout', { value: { fit, snapshot: () => state } });
    new MutationObserver(records => {
      if (records.some(r => r.type !== 'attributes' || r.attributeName !== 'style' || !r.target.matches('#board,.step-box,.math-line'))) schedule();
    }).observe(board, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] });
    new ResizeObserver(schedule).observe(board);
    const timer = setInterval(fit, 120);
    addEventListener('beforeunload', () => clearInterval(timer), { once: true });
    document.fonts?.ready.then(schedule);
    schedule();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
}

export function injectPortraitLayout(html) {
  const removals = [];
  const visit = node => {
    if (node.nodeName === 'script' && node.attrs.some(a => a.name === 'data-videoai2-recording-scroll-fix')) removals.push(node.sourceCodeLocation);
    for (const child of node.childNodes || []) visit(child);
  };
  visit(parse(html, { sourceCodeLocationInfo: true }));
  for (const loc of removals.sort((a, b) => b.startOffset - a.startOffset)) html = html.slice(0, loc.startOffset) + html.slice(loc.endOffset);
  const style = `<style data-videoai2-readable-portrait>
    .container { display:flex!important; flex-direction:column!important; min-height:0!important; }
    .header,.prob-wrap { flex-shrink:0!important; }
    .prob-wrap,.rule-box,.popup-msg { overflow-wrap:anywhere; }
    .board { flex:1 1 0!important; min-height:0!important; overflow:hidden!important; }
    #scroll-content { flex:0 0 auto!important; min-height:0!important; }
    .board::after { content:''; display:block; flex:0 0 var(--videoai2-end-space,512px); height:var(--videoai2-end-space,512px); }
    .step-box { box-sizing:border-box; flex-shrink:0; }
    .step-box[data-videoai2-current] { opacity:1!important; }
    .step-box[data-videoai2-current] .step-title { position:sticky; top:0; z-index:3; background:#111424; }
    .step-box::-webkit-scrollbar { display:none; }
    .step-box { scrollbar-width:none; }
    .math-line:not(.show) { display:none!important; }
    mjx-container svg { max-width:100%; height:auto; }
  </style><script data-videoai2-readable-portrait>(${installPortraitLayout.toString()})();</script>`;
  return html.replace(/<\/head>/i, style + '</head>');
}
