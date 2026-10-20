import { lessonMemberName, readLessonScripts, walkLessonJs } from './htmlLessonSource.ts';

/** Self-contained: serialized into preview, both existing video exporters and
 * offline HTML. Completion comes from the real voice promise, never a timeout. */
export function installHtmlLessonSync() {
  const win = window as any;
  if (win.__videoai2LessonSync) return;
  type Voice = { initial: boolean; done: Promise<unknown> };
  let ready!: () => void;
  const readyGate = new Promise<void>(resolve => { ready = resolve; });
  const starts = new WeakMap<Function, Function>();
  const pending = new Set<Voice>();
  const deferred: Array<{ voices: Voice[]; target?: object; apply: () => unknown }> = [];
  const flush = () => {
    for (let i = 0; i < deferred.length;) {
      const item = deferred[i];
      if (item.voices.some(voice => pending.has(voice))) { i++; continue; }
      deferred.splice(i, 1);
      item.apply();
    }
  };
  // Setup/clear from the previous scene in the synchronous opening of a cue
  // remains immediate. Later cleanup belongs to the playing narration.
  const holding = () => [...pending].some(voice => !voice.initial);
  const later = (apply: () => unknown, target?: object) => { deferred.push({ voices: [...pending], target, apply }); };
  const blocked = (target: object) => deferred.some(item => item.target === target ||
    item.target instanceof Node && target instanceof Node && item.target.contains(target));
  const whenIdle = async () => {
    while (pending.size) await Promise.all([...pending].map(voice => voice.done));
    flush();
  };
  const hiddenValue = (property: string, value: unknown) => {
    const v = String(value).trim().toLowerCase();
    return property === 'display' && v === 'none' || property === 'visibility' && ['hidden', 'collapse'].includes(v) ||
      ['opacity', 'height', 'width', 'max-height', 'max-width', 'maxHeight', 'maxWidth'].includes(property) && /^0(?:\.0+)?(?:px|%|em|rem)?$/.test(v) ||
      property === 'transform' && /scale(?:[xy])?\(\s*0(?:[\s,)])/.test(v);
  };
  const visible = (el: Element) => {
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' &&
      Number(style.opacity) > 0 && (el instanceof SVGElement ? box.width > .5 || box.height > .5 : box.width > .5 && box.height > .5);
  };
  const hiddenFrames = (frames: any) => {
    if (Array.isArray(frames)) {
      const last = frames[frames.length - 1];
      return last && Object.entries(last).some(([p, v]) => hiddenValue(p, v));
    }
    return frames && Object.entries(frames).some(([p, v]) => hiddenValue(p, Array.isArray(v) ? v[v.length - 1] : v));
  };
  const classOwner = (list: DOMTokenList) => [...document.querySelectorAll('*')].find(el => el.classList === list);
  const probeHide = (el: Element, change: (clone: Element) => unknown) => {
    if (!el.parentElement || !visible(el)) return false;
    const clone = el.cloneNode(true) as HTMLElement;
    clone.setAttribute('data-videoai2-sync-probe', '');
    el.parentElement.insertBefore(clone, el.nextSibling);
    try {
      change(clone);
      const exits = clone.getAnimations().some(animation => hiddenFrames((animation.effect as KeyframeEffect | null)?.getKeyframes()));
      clone.style?.setProperty('transition', 'none', 'important');
      clone.style?.setProperty('animation', 'none', 'important');
      return exits || !visible(clone);
    } finally { clone.remove(); }
  };
  const api = {
    beforeStart: undefined as undefined | (() => unknown),
    onComplete: undefined as undefined | (() => void),
    whenIdle,
    wrapStart(original: Function) {
      if (starts.has(original)) return starts.get(original);
      const wrapped = async function(this: unknown, ...args: unknown[]) {
        await readyGate;
        await api.beforeStart?.();
        const value = await Reflect.apply(original, this, args);
        await whenIdle();
        api.onComplete?.();
        return value;
      };
      starts.set(original, wrapped); starts.set(wrapped, wrapped);
      return wrapped;
    },
    async withCue(invoke: (scope: { animation: (original: any) => any }) => unknown) {
      const animations: Promise<unknown>[] = [];
      const scope = {
        animation(original: any) {
          if (typeof original !== 'function') return original;
          return function(this: unknown, ...args: unknown[]) {
            const result = Promise.resolve(Reflect.apply(original, this, args));
            animations.push(result);
            return result;
          };
        },
      };
      const value = await invoke(scope);
      await Promise.all(animations);
      await whenIdle();
      return value;
    },
    assign(object: any, property: string, value: any) {
      const apply = () => object[property] = value;
      if (!holding()) return apply();
      if (blocked(object)) { later(apply, object); return value; }
      const styleOwner = object instanceof CSSStyleDeclaration && property === 'cssText' ? [...document.querySelectorAll('*')].find(el => (el as HTMLElement).style === object) : undefined;
      const hides = object instanceof CSSStyleDeclaration && (hiddenValue(property, value) || styleOwner && probeHide(styleOwner, clone => (clone as HTMLElement).style.cssText = value)) ||
        object instanceof Element && (['className', 'style'].includes(property) && probeHide(object, clone => (clone as any)[property] = value) || property === 'hidden' && value === true ||
          ['innerHTML', 'textContent', 'innerText'].includes(property) && value === '' && object.textContent);
      if (hides) { later(apply, object); return value; }
      return apply();
    },
    method(object: any, name: string, args: any[]) {
      const apply = () => Reflect.apply(object[name], object, args);
      if (!holding()) return apply();
      const owner = object instanceof DOMTokenList ? classOwner(object) : object;
      if (owner && blocked(owner)) { later(apply, owner); return name === 'removeChild' ? args[0] : undefined; }
      let hides = false;
      let result: unknown;
      if (object instanceof DOMTokenList && ['add', 'remove', 'toggle', 'replace'].includes(name)) {
        const el = owner as Element | undefined;
        if (el) hides = probeHide(el, clone => result = Reflect.apply((clone.classList as any)[name], clone.classList, args));
      } else if (object instanceof Element) {
        if (['remove', 'replaceWith'].includes(name)) hides = visible(object);
        if (name === 'removeChild' && args[0] instanceof Element) { hides = visible(args[0]); result = args[0]; }
        if (name === 'replaceChildren' && !args.length) hides = Boolean(object.textContent || object.childElementCount);
        if (['setAttribute', 'removeAttribute'].includes(name) && ['class', 'style', 'hidden', 'display', 'visibility', 'opacity'].includes(args[0])) {
          hides = probeHide(object, clone => Reflect.apply((clone as any)[name], clone, args));
        }
        if (name === 'animate' && hiddenFrames(args[0])) {
          const animation = apply() as Animation;
          animation.pause();
          later(() => animation.play(), object);
          return animation;
        }
      } else if (object instanceof CSSStyleDeclaration && name === 'setProperty') hides = hiddenValue(args[0], args[1]);
      if (hides) { later(apply, owner); return result; }
      return apply();
    },
  };
  win.__videoai2LessonSync = api;
  let voiceHandler: any;
  Object.defineProperty(win, 'onNarrationCue', {
    configurable: true,
    get: () => voiceHandler,
    set(handler) {
      if (typeof handler !== 'function') { voiceHandler = handler; return; }
      ready();
      voiceHandler = function(this: any, ...args: any[]) {
        let resolve!: (value: unknown) => void;
        let reject!: (error: unknown) => void;
        const done = new Promise((yes, no) => { resolve = yes; reject = no; });
        const voice = { initial: true, done };
        pending.add(voice);
        queueMicrotask(() => { voice.initial = false; });
        const finish = (ok: boolean, result: unknown) => {
          pending.delete(voice);
          try { flush(); } catch (error) { reject(error); return; }
          if (ok) resolve(result); else reject(result);
        };
        try { Promise.resolve(Reflect.apply(handler, this, args)).then(value => finish(true, value), error => finish(false, error)); }
        catch (error) { finish(false, error); }
        return done;
      };
    },
  });
}

/** Interpose only on visual cleanup operations and cue completion. Parsing keeps
 * literal text, formulas, cue IDs, animation timings and original HTML intact. */
export function prepareHtmlLessonSync(html: string) {
  if (html.includes('data-videoai2-lesson-sync')) return html;
  const api = 'window.__videoai2LessonSync';
  const methods = new Set(['add', 'remove', 'toggle', 'replace', 'setAttribute', 'removeAttribute', 'removeChild', 'replaceChildren', 'replaceWith', 'animate', 'setProperty', 'append', 'appendChild', 'prepend', 'insertBefore', 'insertAdjacentHTML', 'insertAdjacentElement', 'insertAdjacentText']);
  const properties = new Set(['display', 'visibility', 'opacity', 'height', 'width', 'maxHeight', 'maxWidth', 'transform', 'hidden', 'innerHTML', 'textContent', 'innerText', 'className', 'cssText', 'style']);
  const edits: Array<{ at: number; end: number; text: string }> = [];
  const scripts = readLessonScripts(html);
  const names = new Set<string>();
  for (const script of scripts) walkLessonJs(script.ast, node => { if (node.type === 'Identifier') names.add(node.name); });
  let scopeName = '__videoai2CueScope';
  while (names.has(scopeName)) scopeName += '_';
  for (const script of scripts) {
    for (const declaration of script.ast.body.filter((node: any) => node.type === 'FunctionDeclaration' && node.id?.name === 'startAnimation')) {
      const directives = script.ast.body.filter((node: any) => node.type === 'ExpressionStatement' && node.directive);
      const at = script.start + (directives[directives.length - 1]?.end || 0);
      edits.push({ at, end: at, text: `;startAnimation=${api}.wrapStart(startAnimation);` });
    }
    walkLessonJs(script.ast, node => {
      const startValue = node.type === 'VariableDeclarator' && node.id?.name === 'startAnimation' ? node.init :
        node.type === 'AssignmentExpression' && lessonMemberName(node.left) === 'startAnimation' ? node.right : null;
      if (startValue) {
        edits.push({ at: script.start + startValue.start, end: script.start + startValue.start, text: `${api}.wrapStart(` });
        edits.push({ at: script.start + startValue.end, end: script.start + startValue.end, text: ')' });
      }
      if (node.type === 'CallExpression' && !node.optional && !node.callee.optional && !node.callee.object?.optional) {
        if (lessonMemberName(node.callee) === 'withCue') {
          edits.push({ at: script.start + node.start, end: script.start + node.start, text: `${api}.withCue(async(${scopeName})=>(` });
          edits.push({ at: script.start + node.end, end: script.start + node.end, text: '))' });
          const animation = node.arguments[1];
          if (animation && animation.type !== 'SpreadElement') {
            edits.push({ at: script.start + animation.start, end: script.start + animation.start, text: `${scopeName}.animation(` });
            edits.push({ at: script.start + animation.end, end: script.start + animation.end, text: ')' });
          }
        } else if (node.callee.type === 'MemberExpression' && methods.has(lessonMemberName(node.callee) || '')) {
          const object = node.callee.object;
          const name = lessonMemberName(node.callee);
          // Keep nested receiver/argument rewrites by replacing only punctuation.
          edits.push({ at: script.start + node.start, end: script.start + object.start, text: `${api}.method(` });
          edits.push({ at: script.start + object.end, end: script.start + (node.arguments[0]?.start ?? node.end - 1), text: `,${JSON.stringify(name)},[` });
          edits.push({ at: script.start + node.end - 1, end: script.start + node.end, text: '])' });
        }
      } else if (node.type === 'AssignmentExpression' && node.operator === '=' && node.left.type === 'MemberExpression' && !node.left.optional) {
        const name = lessonMemberName(node.left);
        if (!name || !properties.has(name)) return;
        const object = node.left.object;
        edits.push({ at: script.start + node.start, end: script.start + object.start, text: `${api}.assign(` });
        edits.push({ at: script.start + object.end, end: script.start + node.right.start, text: `,${JSON.stringify(name)},` });
        edits.push({ at: script.start + node.end, end: script.start + node.end, text: ')' });
      }
    });
  }
  let output = html;
  for (const edit of edits.sort((a, b) => b.at - a.at || b.end - a.end)) output = output.slice(0, edit.at) + edit.text + output.slice(edit.end);
  const runtime = `<script data-videoai2-lesson-sync>(${installHtmlLessonSync.toString()})();<\/script>`;
  const head = /<head\b[^>]*>/i.exec(output);
  const root = /<html\b[^>]*>/i.exec(output);
  const at = head ? head.index + head[0].length : root ? root.index + root[0].length : undefined;
  return at === undefined ? runtime + output : output.slice(0, at) + runtime + output.slice(at);
}
