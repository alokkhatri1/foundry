// Anonymization for the research surfaces. The consent scope is "all-anonymized",
// so the research bench, downloads, and synthesis must never show real names.

// Stable pseudonym derived from the participant UUID: same person → same code,
// every export and every year, but reveals nothing (it's just the random id).
export function pseudonym(id) {
  if (!id) return 'P-?';
  return 'P-' + String(id).replace(/-/g, '').slice(0, 8);
}

// Best-effort name redactor: replaces any participant's full name found in free
// text with [name]. Full names only (≥ a few chars, word-boundary) to avoid
// clobbering common words. Won't catch nicknames or non-participant names — a
// risk reduction, not a guarantee.
export function makeRedactor(names) {
  const clean = [...new Set((names || []).map(n => (n || '').trim()).filter(n => n.length >= 3))]
    .sort((a, b) => b.length - a.length); // longest first so full names win over substrings
  if (!clean.length) return (t) => t;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('\\b(' + clean.map(esc).join('|') + ')\\b', 'gi');
  return (t) => typeof t === 'string' ? t.replace(re, '[name]') : t;
}
