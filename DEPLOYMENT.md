# Deployment

Production is served by **Vercel** at **[foundry.alokkhatri.com](https://foundry.alokkhatri.com)**,
wired to the `main` branch of the GitHub repo
[`alokkhatri1/foundry`](https://github.com/alokkhatri1/foundry). Every push to
`main` triggers an automatic build + deploy.

A staging environment lives at **[dev.foundry.alokkhatri.com](https://dev.foundry.alokkhatri.com)**,
wired to the `dev` branch of the same repo. Every push to `dev` triggers an
automatic preview build at the same URL — that's the testing link. Work on
larger changes lands on `dev` first; once verified there, `dev` is merged
into `main` and the change ships to production.

**Shared-Supabase caveat.** Both environments hit the *same* Supabase
project — env vars are set once at the Vercel project level. So:

- Database migrations applied to Supabase land for both `dev` and `main`
  at the same moment. There is no "preview Supabase" without standing up a
  second project (deferred — flag scope creep before proposing it).
- Anything you click on `dev.foundry.alokkhatri.com` reads/writes the
  production DB. Test rows show up everywhere. Useful for testing the
  pipes on real data, dangerous if you forget which environment you're in.

Vercel ships everything in this repo on every push to `main`:

- **Frontend (React app)** — built from `src/` by Vite.
- **Server-side API routes** under `api/*.js` — deployed as Vercel
  serverless functions automatically. The frontend calls them at
  `/api/<name>` (same origin, no CORS).

There is intentionally only one deploy mechanism. If you ever add server
code that needs to live elsewhere (e.g., Supabase Edge Functions for
DB-proximate work), wire a separate deploy then — but until then, default
to `api/*.js`.

## Domain setup

- Custom domain `foundry.alokkhatri.com` is configured as the Vercel production
  domain (assigned to the `main` branch). The underlying `*.vercel.app` URL
  still resolves but shouldn't be shared with participants.
- Custom domain `dev.foundry.alokkhatri.com` is assigned to the `dev` branch
  in Vercel → Project Settings → Domains. Pushes to `dev` rebuild this URL.
- DNS is managed by **Netlify DNS** (not GoDaddy — GoDaddy only registers the
  name and delegates to Netlify nameservers). Both `foundry` and
  `dev.foundry` are CNAMEs to `cname.vercel-dns.com`.
- SSL is auto-provisioned by Vercel once each CNAME resolves.
- Supabase auth **Site URL** must match the production domain
  (`https://foundry.alokkhatri.com`) or OAuth will bounce users back to the
  `*.vercel.app` URL after Google sign-in. Add `https://dev.foundry.alokkhatri.com`
  to Supabase **Additional Redirect URLs** so Google sign-in works on staging
  too — without this, `dev` will sign-in-loop.

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

# 5a. For larger or higher-risk work: push to `dev` first.
#     Verify on https://dev.foundry.alokkhatri.com, then promote to prod
#     by fast-forward-merging dev into main and pushing main.
git push personal dev
# ...test on dev URL...
git checkout main && git merge --ff-only dev && git push personal main

# 5b. For tiny, low-risk fixes: push directly to `main`.
git push personal main
```

Vercel picks up the push, builds, and rolls out. Watch the build in the
[Vercel dashboard](https://vercel.com/dashboard) — a failed build does not
take down the current production version, but it also doesn't ship the fix.

**Default to 5a (dev first) for any change that touches a migration, a new
component, or anything you can't fully cover with `npx vite build`. Reserve
5b for one-line CSS tweaks and copy edits.**

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

## Facilitator brief — credit top-ups during live sessions

Default per-participant allocation is **3000 credits** (≈ $1.50 of LLM spend).
That sizes for a 6-hour workshop with mixed use — chat, a few workflow runs,
some coworker configuration. Heavy users who run many workflows or lean on
Sonnet-backed coworkers will burn through this faster.

**Monitor during the session:**

- Admin Dashboard → pick the workshop → Participants tab shows each user's
  credit balance. The list updates live (LLM usage realtime).
- When a user drops below ~300 credits, consider a top-up before they hit 0
  and get gated out of chat / workflow runs.

**To grant more credits mid-session:**

1. Admin Dashboard → select the live workshop → Participants tab.
2. Click the participant whose balance is low.
3. Bump their credit bonus (this is additive — keeps their original allocation
   intact, layers a bonus on top).
4. Change propagates via realtime; their UI shows the new balance within a
   second or two.

**If the whole room needs more:**

- Change the workshop's default allocation (admin dashboard → workshop
  settings). This re-allocates to every participant, not just new joiners.

**Signals a user is running out:**

- Yellow credit chip in their header turns red (at the 300-credit warn
  threshold).
- They see "You're out of credits (X allocated). Ask the facilitator…" when
  they try to chat or run a workflow. Their message is still shown locally,
  just not sent.

**Rough cost cheat sheet (for sizing top-ups):**

- One chat turn with Foundry: ~10-30 credits
- One chat turn with a coworker: ~15-50 credits
- One workflow run (3-5 steps): ~300-800 credits
- Intent classification was removed in the 04-24 perf sweep — chat turns are
  now cheaper than before.

## API routes

Files under `api/<name>.js` become Vercel serverless functions automatically
on push. The frontend reaches them at `/api/<name>`.

Current routes:

- `api/claude-proxy.js` — forwards browser calls to `api.anthropic.com` so
  the Anthropic key never lives on the client. Verifies the caller's
  Supabase session JWT before forwarding.

### Required Vercel env vars

Set these in **Vercel → Project Settings → Environment Variables** for the
**Production** environment:

- `ANTHROPIC_API_KEY` — the actual Anthropic key. Server-only — must NOT
  have a `VITE_` prefix or Vite will inline it into the client bundle.
- `VITE_SUPABASE_URL` — already set; reused by the proxy for JWT verify.
- `VITE_SUPABASE_ANON_KEY` — already set; ditto.

After changing env vars, redeploy from the Vercel dashboard (or push a
trivial commit) so the new value reaches the function.

### Local dev

`npm run dev` runs Vite on port 5173 but does **not** serve `api/*.js` —
calls to `/api/claude-proxy` will 404 in dev. To exercise the proxy
locally, use `vercel dev` instead, which boots both the Vite dev server
and the API routes together. For UI-only work, the dev server is fine.

## Notes

- There is no `vercel.json` in the repo — Vercel auto-detects the Vite
  project. If framework detection ever breaks, add one with
  `buildCommand: "npm run build"` and `outputDirectory: "dist"`.
- Environment variables (Supabase URL, anon key, Anthropic key) live in the
  Vercel project settings, not in this repo. `.env` is gitignored. The
  Anthropic key used to live on the client too, but as of the H3 audit it
  moved off the client into the `claude-proxy` Vercel function's env.
- The GitHub remote is aliased `personal`, not `origin`:
  `git remote -v` will show `personal  https://github.com/alokkhatri1/foundry.git`.
