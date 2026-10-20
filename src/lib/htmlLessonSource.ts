import { parse as parseHtml } from 'parse5';
import { parse as parseJs } from 'acorn';

export function walkLessonJs(node: any, visit: (node: any, ancestors: any[]) => void, ancestors: any[] = []) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node, ancestors);
  const parents = [...ancestors, node];
  for (const [key, child] of Object.entries(node)) {
    if (key === 'loc') continue;
    if (Array.isArray(child)) child.forEach(value => walkLessonJs(value, visit, parents));
    else if (child && typeof child === 'object') walkLessonJs(child, visit, parents);
  }
}

/** Parse scripts as code, never evaluate imported lessons to inspect them. */
export function readLessonScripts(html: string) {
  const scripts: Array<{ start: number; end: number; source: string; ast: any }> = [];
  const visit = (node: any) => {
    if (node.nodeName === 'script') {
      const attrs = Object.fromEntries(node.attrs.map((a: any) => [a.name, a.value]));
      const location = node.sourceCodeLocation;
      if (!attrs.src && !Object.keys(attrs).some(k => k.startsWith('data-videoai2-')) &&
          (!attrs.type || ['module', 'text/javascript', 'application/javascript'].includes(String(attrs.type).toLowerCase())) && location?.endTag) {
        const start = location.startTag.endOffset;
        const end = location.endTag.startOffset;
        const source = html.slice(start, end);
        const ast = parseJs(source, { ecmaVersion: 'latest', sourceType: attrs.type === 'module' ? 'module' : 'script' });
        scripts.push({ start, end, source, ast });
      }
    }
    for (const child of node.childNodes || []) visit(child);
  };
  visit(parseHtml(html, { sourceCodeLocationInfo: true }));
  return scripts;
}

export function lessonMemberName(node: any): string | undefined {
  if (node?.type === 'Identifier') return node.name;
  if (node?.type === 'MemberExpression') return node.computed ? node.property.value : node.property.name;
}

function staticString(node: any): string | undefined {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral' && !node.expressions.length) return node.quasis[0].value.cooked;
}

export function inspectHtmlLessonSource(html: string) {
  const declared: Array<{ id: string; narration: string }> = [];
  const referenced = new Set<string>();
  let hasCueCalls = false;
  let dynamic = false;
  for (const script of readLessonScripts(html)) {
    walkLessonJs(script.ast, node => {
      if (node.type !== 'VariableDeclarator' || node.id?.name !== 'narrationScript' || node.init?.type !== 'ObjectExpression') return;
      for (const prop of node.init.properties) {
        if (prop.type !== 'Property' || prop.computed || prop.kind !== 'init') continue;
        const id = prop.key.name ?? prop.key.value;
        const narration = staticString(prop.value)?.trim();
        if (typeof id === 'string' && id && narration) declared.push({ id, narration });
      }
    });
    const calls = (node: any) => {
      if (!node || typeof node !== 'object') return;
      // API implementation calls such as cue(id) inside withCue are not lesson
      // cue usages; strings, comments and declarations are not calls either.
      if (node.type === 'FunctionDeclaration' && ['cue', 'withCue'].includes(node.id?.name)) return;
      if (node.type === 'VariableDeclarator' && ['cue', 'withCue'].includes(node.id?.name)) return;
      if (node.type === 'CallExpression' && ['cue', 'withCue', 'onNarrationCue'].includes(lessonMemberName(node.callee) || '')) {
        hasCueCalls = true;
        const id = staticString(node.arguments[0]);
        if (id !== undefined) referenced.add(id); else dynamic = true;
      }
      for (const child of Object.values(node)) {
        if (Array.isArray(child)) child.forEach(calls);
        else if (child && typeof child === 'object') calls(child);
      }
    };
    calls(script.ast);
  }
  if (new Set(declared.map(c => c.id)).size !== declared.length) throw new Error('narrationScript chứa cue ID trùng.');
  return { declared, referenced, dynamic, hasCueCalls };
}

const manifestPattern = /<!--videoai2-used-cues:([\s\S]*?)-->/g;
export const stripHtmlCueManifest = (html: string) => html.replace(manifestPattern, '');

/** Export preparation metadata only; original math, CSS and scripts stay intact. */
export function withHtmlCueManifest(html: string, ids: string[]) {
  const json = JSON.stringify([...new Set(ids)]).replace(/</g, '\\u003c').replace(/>/g, '\\u003e');
  return stripHtmlCueManifest(html) + `<!--videoai2-used-cues:${json}-->`;
}

export function readHtmlCueManifest(html: string): string[] | null {
  const matches = [...html.matchAll(manifestPattern)];
  if (!matches.length) return null;
  const ids = JSON.parse(matches[matches.length - 1][1]);
  if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) throw new Error('Danh sách cue đã chuẩn bị không hợp lệ.');
  return [...new Set(ids)] as string[];
}
