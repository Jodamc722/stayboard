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
  },
  // SECURITY HEADERS ON EVERY RESPONSE (2026-09-28 audit, B-15). Deliberately NOT X-Frame-Options or
  // a Content-Security-Policy yet: nobody has inventoried what embeds these pages or what they embed
  // (owner reports, guidebooks, share boards), and either header can blank a page without an error.
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      ],
    }]
  },
}
export default nextConfig
