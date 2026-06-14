// Pull a skill/theory document from a public GitHub file URL. Accepts either a
// normal github.com/.../blob/... URL (converted to raw) or a raw URL directly.
// Public files only — raw.githubusercontent.com is CORS-open so the browser can
// fetch it; private repos would need a token/proxy (out of scope).
export async function fetchGithubText(url) {
  let raw = (url || '').trim();
  if (!raw) throw new Error('Enter a GitHub file URL.');
  // github.com/owner/repo/blob/branch/path  →  raw.githubusercontent.com/owner/repo/branch/path
  const m = raw.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
  if (m) raw = `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}`;
  let res;
  try {
    res = await fetch(raw);
  } catch {
    throw new Error('Could not reach GitHub. Is the file public?');
  }
  if (!res.ok) throw new Error(`GitHub fetch failed (${res.status}) — check the URL is a public file.`);
  return await res.text();
}
