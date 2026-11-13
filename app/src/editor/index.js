// Raw-text editor (CodeMirror 6): setup, theme, and the small API the UI uses.
// Loaded lazily the first time the user switches to Edit / Split.
import { EditorState, EditorSelection } from '@codemirror/state';
import { EditorView, keymap, drawSelection, highlightActiveLine, dropCursor, highlightSpecialChars, rectangularSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { commands, formatKeys } from './commands.js';

export { commands };

const mdHighlight = HighlightStyle.define([
  { tag: t.heading1, fontWeight: '700', fontSize: '1.3em', color: 'var(--ed-heading)' },
  { tag: t.heading2, fontWeight: '700', fontSize: '1.15em', color: 'var(--ed-heading)' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: '700', color: 'var(--ed-heading)' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--ed-link)' },
  { tag: t.monospace, color: 'var(--ed-code)' },
  { tag: t.quote, color: 'var(--ed-muted)', fontStyle: 'italic' },
  { tag: [t.processingInstruction, t.contentSeparator, t.list], color: 'var(--ed-mark)' },
  { tag: t.meta, color: 'var(--ed-muted)' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '14px', backgroundColor: 'var(--bg)', color: 'var(--fg)' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6' },
  '.cm-content': { padding: '24px 0', maxWidth: '900px', margin: '0 auto', caretColor: 'var(--fg)' },
  '.cm-line': { padding: '0 28px' },
  '.cm-activeLine': { backgroundColor: 'var(--ed-active)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--fg)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--ed-sel) !important' },
  '.cm-panels': { backgroundColor: 'var(--chrome)', color: 'var(--fg)', borderColor: 'var(--border)' },
  '.cm-searchMatch': { backgroundColor: 'var(--find)' },
});

export function createEditor(parent, text, { onChange, onScroll }) {
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        highlightSpecialChars(), history(), drawSelection(), dropCursor(), rectangularSelection(),
        highlightActiveLine(), highlightSelectionMatches(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage }),
        syntaxHighlighting(mdHighlight),
        formatKeys,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        theme,
        EditorView.contentAttributes.of({ spellcheck: 'false', 'aria-label': 'Markdown source' }),
        EditorView.updateListener.of((u) => { if (u.docChanged) onChange(u.state.doc.toString()); }),
        EditorView.domEventHandlers({ scroll: () => onScroll?.() }),
      ],
    }),
  });
  return {
    view,
    getText: () => view.state.doc.toString(),
    setText(t) {
      if (t === view.state.doc.toString()) return;
      const head = Math.min(view.state.selection.main.head, t.length);
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: t }, selection: EditorSelection.cursor(head) });
    },
    focus: () => view.focus(),
    run: (name) => commands[name]?.(view),
    gotoLine(line0) {
      const l = view.state.doc.line(Math.min(line0 + 1, view.state.doc.lines));
      view.dispatch({ selection: EditorSelection.cursor(l.from), effects: EditorView.scrollIntoView(l.from, { y: 'start', yMargin: 20 }) });
      view.focus();
    },
    scrollToLine(line0) {
      const l = view.state.doc.line(Math.min(line0 + 1, view.state.doc.lines));
      view.dispatch({ effects: EditorView.scrollIntoView(l.from, { y: 'start' }) });
    },
    find() { openSearchPanel(view); },
    /** 0-based line at the top of the viewport. */
    topLine() {
      const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
      return view.state.doc.lineAt(block.from).number - 1;
    },
  };
}
