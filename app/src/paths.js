// Pure Windows path <-> file:// URL helpers (no platform dependency).

export function pathToFileUrl(p) {
  let s = p.replace(/\\/g, '/');
  let prefix = 'file:///';
  if (s.startsWith('//')) { prefix = 'file://'; s = s.slice(2); } // UNC: \\server\share
  return prefix + s.split('/').map((seg, i) => (i === 0 && /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg))).join('/');
}

export function fileUrlToPath(u) {
  const url = new URL(u);
  let p = decodeURIComponent(url.pathname);
  if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
  p = p.replace(/\//g, '\\');
  return url.host ? '\\\\' + url.host + p : p;
}

export const dirOf = (f) => f.replace(/[\\/][^\\/]*$/, '');
/** file:// URL of the folder containing `f`, with a trailing slash (a base for relative links). */
export const dirUrl = (f) => pathToFileUrl(dirOf(f)) + '/';
export const baseName = (f) => (f ? f.split(/[\\/]/).pop() : 'Untitled.md');
