import { parse as parseHtml } from 'parse5';
import { parse as parseJs } from 'acorn';
import { assertRender, RenderError } from './errors.mjs';

export const BRIDGE_KEY = '__videoai2ServerRenderV1';
const call = `globalThis.${BRIDGE_KEY}`;
function walk(node, visit, parent = null) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node, parent);
  for (const [key, child] of Object.entries(node)) {
    if (key === 'loc' || key === 'sourceCodeLocation') continue;
    if (Array.isArray(child)) child.forEach(value => walk(value, visit, node));
    else if (child && typeof child === 'object') walk(child, visit, node);
  }
}
function scripts(html) {
  const doc = parseHtml(html, { sourceCodeLocationInfo: true });
  const result = [];
  const visit = node => {
    if (node.nodeName === 'script') {
      const attrs = Object.fromEntries(node.attrs.map(a => [a.name, a.value]));
      if (attrs.src) return;
      if (attrs.type && !['module', 'text/javascript', 'application/javascript'].includes(attrs.type.toLowerCase())) return;
      const start = node.sourceCodeLocation?.startTag?.endOffset;
      const end = node.sourceCodeLocation?.endTag?.startOffset;
      if (start == null || end == null) return;
      const source = html.slice(start, end);
      let ast;
      try { ast = parseJs(source, { ecmaVersion: 'latest', sourceType: attrs.type === 'module' ? 'module' : 'script', allowHashBang: true }); }
      catch (e) { throw new RenderError('package-error', `JavaScript trong HTML không hợp lệ: ${e.message}`); }
      result.push({ start, end, source, ast });
    }
    for (const child of node.childNodes || []) visit(child);
  };
  visit(doc);
  return result;
}
function staticNarration(ast) {
  const ids = [];
  walk(ast, node => {
    if (node.type !== 'VariableDeclarator' || node.id?.name !== 'narrationScript' || node.init?.type !== 'ObjectExpression') return;
    for (const property of node.init.properties) {
      if (property.type !== 'Property' || property.computed || property.kind !== 'init') continue;
      const id = property.key.name ?? property.key.value;
      const value = property.value;
      if (typeof id === 'string' && ((value.type === 'Literal' && typeof value.value === 'string') || (value.type === 'TemplateLiteral' && !value.expressions.length))) ids.push(id);
    }
  });
  return ids;
}
function isStartTarget(node) {
  return node?.type === 'Identifier' && node.name === 'startAnimation' || node?.type === 'MemberExpression' && ['window', 'globalThis'].includes(node.object?.name) && (node.computed ? node.property?.value === 'startAnimation' : node.property?.name === 'startAnimation');
}
export function inspectLesson(html) {
  const inline = scripts(html);
  const cueIds = inline.flatMap(s => staticNarration(s.ast));
  assertRender(new Set(cueIds).size === cueIds.length, 'package-error', 'narrationScript chứa cue ID trùng.');
  return { cueIds, inlineScripts: inline.length };
}

// Only interpose on the entry function. The original animation bodies, cue(),
// withCue(), CSS and source file are never rewritten or evaluated on the server.
export function gateLessonHtml(html) {
  const edits = [];
  let entryCount = 0;
  for (const script of scripts(html)) {
    const declarations = script.ast.body.filter(node => node.type === 'FunctionDeclaration' && node.id?.name === 'startAnimation');
    for (const declaration of declarations) {
      // Function declarations are hoisted: install before an eager call earlier
      // in the same script, while retaining its original lexical scope.
      const directives = script.ast.body.filter(node => node.type === 'ExpressionStatement' && node.directive);
      const offset = directives.length ? directives.at(-1).end : 0;
      edits.push({ start: script.start + offset, end: script.start + offset, text: `\nstartAnimation=${call}.wrapStart(startAnimation);\n` });
      entryCount++;
    }
    walk(script.ast, node => {
      if (node.type === 'VariableDeclarator' && node.id?.name === 'startAnimation' && node.init || node.type === 'AssignmentExpression' && isStartTarget(node.left)) {
        const value = node.type === 'VariableDeclarator' ? node.init : node.right;
        edits.push({ start: script.start + value.start, end: script.start + value.start, text: `${call}.wrapStart(` });
        edits.push({ start: script.start + value.end, end: script.start + value.end, text: ')' });
        entryCount++;
      }
    });
  }
  assertRender(entryCount === 1, 'package-error', `Cần đúng một định nghĩa startAnimation; tìm thấy ${entryCount}.`, { entryCount });
  let output = html;
  for (const edit of edits.sort((a, b) => b.start - a.start)) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return output;
}
