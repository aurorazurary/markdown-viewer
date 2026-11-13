// GitHub-flavoured markdown -> sanitised HTML, plus outline + standalone export documents.
import MarkdownIt from 'markdown-it';
import anchor from 'markdown-it-anchor';
import taskLists from 'markdown-it-task-lists';
import hljs from 'highlight.js/lib/common';
import DOMPurify from 'dompurify';
import ghAuto from 'github-markdown-css/github-markdown.css?inline';
import ghLight from 'github-markdown-css/github-markdown-light.css?inline';
import hlLight from 'highlight.js/styles/github.css?inline';
import hlDark from 'highlight.js/styles/github-dark.css?inline';

export const hljsCss =
  `@media (prefers-color-scheme: light){${hlLight}}\n@media (prefers-color-scheme: dark){${hlDark}}`;

const md = new MarkdownIt({
  html: true,
  linkify: true,
  highlight(str, lang) {
    const l = (lang || '').trim().split(/\s+/)[0].toLowerCase();
    if (l && hljs.getLanguage(l)) {
      try {
        return `<pre><code class="hljs language-${l}">${hljs.highlight(str, { language: l, ignoreIllegals: true }).value}</code></pre>`;
      } catch {}
    }
    return `<pre><code class="hljs">${md.utils.escapeHtml(str)}</code></pre>`;
  },
});

// GitHub-style heading ids ("My Heading!" -> "my-heading").
const slugify = (s) =>
  s.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');
md.use(anchor, { slugify, tabIndex: false });
md.use(taskLists, { enabled: true, label: false });

// Tag block tokens with their source line so we can map rendered <-> raw (outline, scroll sync, task toggles).
md.core.ruler.push('source_lines', (state) => {
  for (const t of state.tokens) {
    if (t.map && t.nesting === 1) t.attrSet('data-line', String(t.map[0]));
  }
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'INPUT' && node.getAttribute('type') === 'checkbox') node.removeAttribute('disabled');
});

/** Render markdown. Returns { html, outline:[{level,text,id,line}] }. */
export function render(src) {
  const env = {};
  const tokens = md.parse(src, env);
  const outline = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === 'heading_open') {
      outline.push({
        level: Number(t.tag.slice(1)),
        text: tokens[i + 1].children.filter((c) => c.type === 'text' || c.type === 'code_inline').map((c) => c.content).join('') || tokens[i + 1].content,
        id: t.attrGet('id'),
        line: t.map ? t.map[0] : 0,
      });
    }
  }
  const raw = md.renderer.render(tokens, md.options, env);
  const html = DOMPurify.sanitize(raw, { ADD_ATTR: ['target'], FORBID_TAGS: ['style'] });
  return { html, outline };
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * A self-contained HTML document of the rendered markdown.
 * forPrint: light theme only, and a <base> so relative images resolve when rendered from a temp file.
 */
export function exportDocument(src, title, { forPrint = false, baseHref = null } = {}) {
  const html = render(src).html.replace(/<input(?=[^>]*type="checkbox")/g, '<input disabled');
  const css = forPrint
    ? `${ghLight}\n${hlLight}`
    : `${ghAuto}\n${hljsCss}`;
  const page = forPrint
    ? `body{margin:0}.markdown-body{box-sizing:border-box;max-width:none;padding:0;font-size:14px}
       .markdown-body pre,.markdown-body table,.markdown-body img,.markdown-body blockquote{break-inside:avoid}
       .markdown-body h1,.markdown-body h2,.markdown-body h3{break-after:avoid}
       .markdown-body pre{white-space:pre-wrap;word-break:break-word}
       .markdown-body .anchor{display:none}`
    : `body{margin:0;background:#fff}@media (prefers-color-scheme: dark){body{background:#0d1117}}
       .markdown-body{box-sizing:border-box;max-width:980px;margin:0 auto;padding:45px}
       @media (max-width:767px){.markdown-body{padding:15px}}`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${baseHref ? `<base href="${esc(baseHref)}">` : ''}
<title>${esc(title)}</title>
<style>${css}
.task-list-item{list-style:none}.task-list-item input{margin:0 .35em .25em -1.4em;vertical-align:middle}
${page}</style>
</head><body><article class="markdown-body">
${html}
</article></body></html>`;
}
