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
