# STAYBOARD v2

Vacation rental operations dashboard for Stay Hospitality. Clean rebuild — **Next.js 14 + Supabase + Vercel**.

## Stack
- **Next.js 14** (App Router, Server Components, Route Handlers)
- **Supabase** — Postgres + Auth + Storage + Realtime
- **Tailwind CSS** — design system
- **Guesty Open API** — primary PMS data source
- **PWA-ready** — manifest + installable (Capacitor wrap → App Store next)
- **Deployed on Vercel**

## Quick start

### 1. Install Node.js (if not installed)
- macOS: `brew install node` or download from nodejs.org
- Verify: `node --version` (should print v20+)

### 2. Install dependencies
```bash
npm install
```

### 3. Set up Supabase (one-time)
1. Go to https://supabase.com → New project
2. Project Settings → API → copy the URL + `anon` key
3. Paste into `.env.local`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   ```
4. Supabase → Authentication → Providers → enable Google. Set domain hint to `stay-hospitality.com`.
5. Redirect URLs (Supabase → Authentication → URL Configuration):
   - `http://localhost:3000/auth/callback` (dev)
   - `https://YOUR-DEPLOY.vercel.app/auth/callback` (prod)

### 4. Run locally
```bash
npm run dev
```
Opens http://localhost:3000

### 5. Deploy to Vercel
```bash
npx vercel
```
First run prompts you to link your Vercel account. Subsequent runs deploy with one command.

Set the same env vars in **Vercel → Project → Settings → Environment Variables**:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `GUESTY_CLIENT_ID` (when you have it)
- `GUESTY_CLIENT_SECRET` (when you have it)
- `NEXT_PUBLIC_GUESTY_MOCK_MODE` (`true` until creds arrive, then `false`)

## Project layout

```
stayboard-v2/
├── app/
│   ├── api/                      # Route handlers (server-side Guesty calls)
│   │   ├── reservations/route.ts
│   │   └── listings/route.ts
│   ├── auth/callback/route.ts    # Supabase OAuth callback
│   ├── login/page.tsx            # Google sign-in
│   ├── reservations/page.tsx     # Reservations table
│   ├── listings/page.tsx         # Properties grid
│   ├── page.tsx                  # Home with stats
│   ├── layout.tsx                # Root layout
│   └── globals.css               # Tailwind
├── components/
│   └── Shell.tsx                 # Sidebar + main layout
├── lib/
│   ├── guesty.ts                 # Guesty Open API client (mock fallback)
│   ├── supabase-browser.ts       # Client-side Supabase
│   └── supabase-server.ts        # Server-side Supabase (cookies)
├── middleware.ts                 # Refresh Supabase session per request
├── types/guesty.ts               # TypeScript contracts
├── public/manifest.json          # PWA manifest
├── next.config.mjs
├── tailwind.config.ts
├── tsconfig.json
└── .env.local                    # Secrets (not committed)
```

## Mock mode

`NEXT_PUBLIC_GUESTY_MOCK_MODE=true` returns canned sample reservations + listings. Flip to `false` when Guesty creds are set. Both modes use the exact same TypeScript types so screens don't change.

<!-- deploy trigger 2026-07-09: photo Replace feature -->
