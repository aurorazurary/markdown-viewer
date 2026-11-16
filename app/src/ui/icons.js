// Minimal 16px stroke icons (24-unit viewBox).
const p = (d) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const icons = {
  open: p('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  newwin: p('<rect x="3" y="5" width="14" height="14" rx="2"/><path d="M21 9v10a2 2 0 0 1-2 2H9"/><path d="M10 9v6M7 12h6"/>'),
  outline: p('<path d="M4 6h16M8 12h12M8 18h12M4 12h.01M4 18h.01"/>'),
  save: p('<path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3M7 21v-7h10v7"/>'),
  export: p('<path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4"/>'),
  'theme-system': p('<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M12 7v7" /><path d="M12 7a3.5 3.5 0 0 1 0 7z" fill="currentColor"/>'),
  'theme-light': p('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  'theme-dark': p('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  code: p('<path d="M8 7l-5 5 5 5M16 7l5 5-5 5"/>'),
  link: p('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  image: p('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'),
  ul: p('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>'),
  ol: p('<path d="M10 6h10M10 12h10M10 18h10M4 5l1.5-1v5M3.5 14.5a1.5 1.5 0 0 1 2.6.9c0 .9-2.6 2.1-2.6 3.6h2.8"/>'),
  task: p('<rect x="3" y="4" width="6" height="6" rx="1"/><path d="M4.5 7l1 1 2-2"/><rect x="3" y="14" width="6" height="6" rx="1"/><path d="M13 7h8M13 17h8"/>'),
  quote: p('<path d="M4 6v12"/><path d="M9 8h11M9 12h11M9 16h7"/>'),
  codeblock: p('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M10 10l-2 2 2 2M14 10l2 2-2 2"/>'),
  table: p('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16M15 4v16"/>'),
  tablerow: p('<path d="M3 5h18v8H3zM3 9h18M9 5v8M15 5v8"/><path d="M12 16v6M9 19h6"/>'),
  hr: p('<path d="M3 12h18"/><path d="M7 6h10M7 18h10" opacity=".35"/>'),
  undo: p('<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: p('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  sparkle: p('<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>'),
  gear: p('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  up: p('<path d="M6 15l6-6 6 6"/>'),
  down: p('<path d="M6 9l6 6 6-6"/>'),
  close: p('<path d="M6 6l12 12M18 6L6 18"/>'),
};

export function applyIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) el.innerHTML = icons[el.dataset.icon] || '';
}
