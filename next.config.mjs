/** @type {import('next').NextConfig} */
// Tab census runs before every build/dev start: a page with no user-settings decision fails the
// build (see scripts/check-tabs.mjs). Jon's rule 2026-08-06 — new tabs must show in /users → Roles.
import { checkTabs } from './scripts/check-tabs.mjs'
checkTabs()

const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**.supabase.co' },
      { protocol: 'https', hostname: 'assets.guesty.com' }
    ]
  }
}
export default nextConfig
