// Foundry runs as one Vercel project against one Supabase project, with
// production at foundry.alokkhatri.com and staging at
// dev.foundry.alokkhatri.com. Anything that mutates a workshop the world
// can join (createWorkshop, joinRoom) needs to know which environment it's
// running in, so we don't accidentally cross-contaminate.
//
// Strict whitelist: only the canonical production hostname counts as
// production. The dev URL, localhost, and preview-deploy *.vercel.app
// hostnames all resolve to 'development'. Server-side / SSR contexts (no
// window) default to 'production' for safety — better to fail closed.

export function getCurrentEnvironment() {
  if (typeof window === 'undefined') return 'production';
  const host = window.location.hostname;
  if (host === 'foundry.alokkhatri.com') return 'production';
  return 'development';
}

export const isProduction = () => getCurrentEnvironment() === 'production';

// The standalone Research Bench is served from the same Vercel deploy but on
// its own subdomain. We branch the React root on this so the workshop App
// machinery never mounts for researchers.
//
// Dev story: the implicit-flow OAuth redirect drops the query string, so
// `?research=1` alone wouldn't survive sign-in locally. We persist a
// localStorage flag the first time we see it; once set, this browser keeps
// loading the bench until you clear it. Production never relies on this —
// the subdomain hostname is authoritative there.
const RESEARCH_HOST = 'research.foundry.alokkhatri.com';
const RESEARCH_FLAG_KEY = 'sandbox:research-host';

export function isResearchHost() {
  if (typeof window === 'undefined') return false;
  // Production: a path under /research on the main domain. This is the primary
  // mechanism — same domain, same deploy, no subdomain/DNS needed.
  if (window.location.pathname.startsWith('/research')) return true;
  // Legacy/alt: a research.* subdomain also works if ever set up.
  const host = window.location.hostname;
  if (host === RESEARCH_HOST || host.startsWith('research.')) return true;
  // Dev override.
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('research') === '1') {
      localStorage.setItem(RESEARCH_FLAG_KEY, '1');
      return true;
    }
    if (params.get('research') === '0') {
      localStorage.removeItem(RESEARCH_FLAG_KEY);
      return false;
    }
    return localStorage.getItem(RESEARCH_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}
