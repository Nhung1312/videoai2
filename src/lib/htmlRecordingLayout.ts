/**
 * Recording-only layout override for portrait lesson HTML.
 * Removes the original narrow 405px cap so the lesson fills a 9:16 capture frame.
 */
export const injectHtmlRecordingLayout = (html: string): string => {
  const style = `
<style data-videoai2-recording-layout>
  html, body {
    width: 100% !important;
    height: 100% !important;
    min-height: 100% !important;
    margin: 0 !important;
    overflow: hidden !important;
    background: #000 !important;
  }
  body {
    align-items: stretch !important;
    justify-content: stretch !important;
  }
  .container {
    width: 100% !important;
    max-width: none !important;
    height: 100% !important;
    margin: 0 !important;
    padding-bottom: 0 !important;
    border-left: 0 !important;
    border-right: 0 !important;
    box-shadow: none !important;
  }

  /* Preview controls must never cover lesson content in the recorded video. */
  .replay-btn,
  button[onclick*="reload"],
  button[onclick*="location.reload"],
  [data-videoai2-no-record] {
    display: none !important;
  }

  /* Recording must show real text, not a fade/mask that makes top/bottom lines
     look clipped. The active step is fitted by the script below. */
  .board {
    -webkit-mask-image: none !important;
    mask-image: none !important;
    overflow-y: hidden !important;
    padding-top: 6px !important;
    padding-bottom: 12px !important;
    scroll-behavior: auto !important;
  }
  #scroll-content {
    padding-top: 2px !important;
    padding-bottom: 10px !important;
  }
  .step-box {
    transform-origin: top left !important;
    scroll-margin-top: 6px !important;
    scroll-margin-bottom: 10px !important;
  }
  .final-ans {
    margin-bottom: 10px !important;
  }
</style>
<script data-videoai2-recording-scroll-fix>
(() => {
  const install = () => {
    const board = document.getElementById('board') || document.querySelector('.board');
    if (!board) return;

    let lastActive = null;
    let fitting = false;

    const isVisible = (el) => {
      if (!el) return false;
      const st = getComputedStyle(el);
      return (
        st.display !== 'none' &&
        st.visibility !== 'hidden' &&
        Number(st.opacity || 1) > 0.02 &&
        !el.classList.contains('collapse')
      );
    };

    const getVisibleSteps = () =>
      Array.from(
        board.querySelectorAll(
          '.step-box, [data-step], .solution-step, .lesson-step'
        )
      ).filter(isVisible);

    const fitAndScroll = () => {
      if (fitting) return;
      fitting = true;

      try {
        const steps = getVisibleSteps();
        const active = steps[steps.length - 1] || null;
        if (!active) {
          board.scrollTop = 0;
          return;
        }

        if (lastActive && lastActive !== active) {
          lastActive.style.zoom = '';
          lastActive.style.maxHeight = '';
        }
        lastActive = active;

        // Always measure the unscaled current step first.
        active.style.zoom = '';

        const safeHeight = Math.max(1, board.clientHeight - 18);
        const naturalHeight = Math.max(
          active.scrollHeight,
          active.getBoundingClientRect().height
        );

        if (naturalHeight > safeHeight) {
          // The former 0.82 floor was still too large for long generated steps.
          // Fit the whole active step, including its heading and final line.
          const zoom = Math.max(0.60, Math.min(1, safeHeight / naturalHeight));
          active.style.zoom = String(zoom);
        }

        // Put the TOP of the current step inside the board. Never auto-scroll to
        // the absolute bottom, which was hiding headings in steps 1, 3 and 4.
        const top = Math.max(0, active.offsetTop - 4);
        const maxTop = Math.max(0, board.scrollHeight - board.clientHeight);
        board.scrollTop = Math.min(top, maxTop);
      } finally {
        fitting = false;
      }
    };

    // Gemini lessons commonly call autoScroll() after every typed fragment.
    // Replace it for export; the MutationObserver below also corrects any
    // lexical/global binding that an individual HTML keeps internally.
    try {
      window.autoScroll = fitAndScroll;
    } catch {}

    const observer = new MutationObserver(() => {
      requestAnimationFrame(fitAndScroll);
    });

    observer.observe(board, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });

    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(() => {
        requestAnimationFrame(fitAndScroll);
      });
      resizeObserver.observe(board);
    }

    // MathJax, web fonts and typewriter effects can change element height after
    // their DOM mutation. A light heartbeat keeps every generated step fitted.
    const timer = window.setInterval(fitAndScroll, 120);
    window.addEventListener('beforeunload', () => clearInterval(timer), { once: true });

    if (document.fonts?.ready) {
      document.fonts.ready.then(() => requestAnimationFrame(fitAndScroll)).catch(() => {});
    }

    requestAnimationFrame(fitAndScroll);
    window.setTimeout(fitAndScroll, 250);
    window.setTimeout(fitAndScroll, 900);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
<\/script>
`;

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${style}</head>`);
  }
  return style + html;
};
