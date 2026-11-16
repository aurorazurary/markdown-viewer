// Builds the request sent to the AI provider (pure; no DOM or platform access).

export const SYSTEM_PROMPT = `You help someone get what they need from a Markdown document quickly, without reading all of it.
Answer in Markdown. Be brief: lead with the answer, use short bullet points, and skip any preamble or closing remarks.
Use only information from the document. If it doesn't contain what was asked for, say so in one line.
When you point to a part of the document, link the section like [Section title](#section-id), using the ids from the section list.`;

export const DEFAULT_REQUEST =
  'Give me a short summary: what this document is about, its key points as 3-6 bullets, and anything I need to do or decide.';

/**
 * @param {{ text: string, fileName: string, outline: {level:number,text:string,id:string}[], request?: string }} o
 * @returns {{ system: string, prompt: string }}
 */
export function buildPrompt({ text, fileName, outline, request }) {
  const sections = outline.length
    ? outline.map((h) => `${'  '.repeat(Math.max(0, h.level - 1))}- ${h.text} (#${h.id})`).join('\n')
    : '(no headings)';
  const ask = request && request.trim() ? `What I want from this document: ${request.trim()}` : DEFAULT_REQUEST;
  // Long document first, the question last.
  const prompt = `<document name="${fileName.replace(/"/g, "'")}">\n${text}\n</document>\n\nSections:\n${sections}\n\n${ask}`;
  return { system: SYSTEM_PROMPT, prompt };
}

/** A short note for how the answer ended, or null when it finished normally. */
export function stopNote(stop) {
  if (stop === 'max_tokens' || stop === 'length') return 'The answer was cut off (output limit reached).';
  if (stop === 'refusal' || stop === 'content_filter') return 'The model declined to answer this.';
  if (stop === 'cancelled') return 'Stopped.';
  return null;
}
