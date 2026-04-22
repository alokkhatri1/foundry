# Deployment

Production is served by **Vercel** at **[foundry.alokkhatri.com](https://foundry.alokkhatri.com)**,
wired to the `main` branch of the GitHub repo
[`alokkhatri1/foundry`](https://github.com/alokkhatri1/foundry). Every push to
`main` triggers an automatic build + deploy. There is no staging environment yet.

## Domain setup

- Custom domain `foundry.alokkhatri.com` is configured as the Vercel production
  domain. The underlying `*.vercel.app` URL still resolves but shouldn't be
  shared with participants.
- DNS is managed by **Netlify DNS** (not GoDaddy — GoDaddy only registers the
  name and delegates to Netlify nameservers). The `foundry` subdomain is a
  CNAME to `cname.vercel-dns.com`.
- SSL is auto-provisioned by Vercel once the CNAME resolves.
- Supabase auth **Site URL** must match the custom domain
  (`https://foundry.alokkhatri.com`) or OAuth will bounce users back to the
  `*.vercel.app` URL after Google sign-in.

## Deploy checklist

Run from the `sandbox-app/` directory.

```bash
# 1. Sanity-check the build locally before shipping.
npx vite build

# 2. Smoke-test the change in the dev server against the actual symptom
#    you're fixing. Build success is not the same as feature correctness.
npm run dev   # http://localhost:5173/

# 3. Stage only the files that actually changed. Avoid `git add -A` —
#    it can sweep in .env, local experiments, or stray build artifacts.
git status --short
git add <file1> <file2> ...

# 4. Commit with a message that leads with *why*, not *what*.
git commit -m "Short imperative subject

Optional body: the reason this change exists, the user-visible
effect, any follow-up it leaves open."

# 5. Push to the remote named `personal` (points at alokkhatri1/foundry).
git push personal main
```

Vercel picks up the push, builds, and rolls out. Watch the build in the
[Vercel dashboard](https://vercel.com/dashboard) — a failed build does not
take down the current production version, but it also doesn't ship the fix.

## Before deploying

- **Build must pass.** `npx vite build` is the minimum gate. If it errors,
  do not push.
- **Smoke-test the actual feature** in the dev server. The file-preview
  blank-screen bug from Apr 20 shipped through green builds twice because
  nobody clicked the actual affordance after the edit.
- **Only push what's tested.** If you have unrelated half-finished work in
  the tree, stage specifically — don't bundle it.

## After deploying

- Open the Vercel production URL and re-do the smoke test against the
  live build. Cache can serve stale assets — hard-refresh (Cmd+Shift+R).
- If it's broken: the safe move is to push a forward fix, not revert.
  Revert only when the bug is blocking a live workshop.

## Notes

- There is no `vercel.json` in the repo — Vercel auto-detects the Vite
  project. If framework detection ever breaks, add one with
  `buildCommand: "npm run build"` and `outputDirectory: "dist"`.
- Environment variables (Supabase URL, anon key, Anthropic key) live in
  the Vercel project settings, not in this repo. `.env` is gitignored.
- The GitHub remote is aliased `personal`, not `origin`:
  `git remote -v` will show `personal  https://github.com/alokkhatri1/foundry.git`.
