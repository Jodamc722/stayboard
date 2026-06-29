'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { featureForPath, featureEnabled } from '@/lib/features'
import {
  Home, CalendarDays, Building2, Layers, MessageSquare, ClipboardList,
  ListChecks, Sliders, LogOut, RefreshCw, Gauge, Activity, Star,
  Share2, Sparkles, TrendingUp, UserCog, PhoneCall
} from 'lucide-react'

// Cleaner information architecture: a small set of clearly-named groups,
// ordered the way a GM actually moves through the day —
// command → guests → portfolio → performance → ops → settings.
const SECTIONS: {
  title: string | null
  items: { to: string; label: string; Icon: any }[]
}[] = [
  {
    title: null,
    items: [
      { to: '/command', label: 'Command Center', Icon: Gauge },
      { to: '/',        label: 'Home',           Icon: Home },
    ],
  },
  {
    title: 'Guests',
    items: [
      { to: '/reservations', label: 'Reservations', Icon: CalendarDays },
      { to: '/messages',     label: 'Messages',     Icon: MessageSquare },
      { to: '/reviews',      label: 'Reviews',      Icon: Star },
      { to: '/welcome-calls', label: 'Welcome Calls', Icon: PhoneCall },
    ],
  },
  {
    title: 'Portfolio',
    items: [
      { to: '/buildings', label: 'Portfolio', Icon: Building2 },
    ],
  },
  {
    title: 'Performance',
    items: [
      { to: '/health',   label: 'Health Score', Icon: Activity },
      { to: '/channels', label: 'Channels',     Icon: Share2 },
      { to: '/revenue',  label: 'Revenue',      Icon: TrendingUp },
    ],
  },
  {
    title: 'Ops',
    items: [
      { to: '/plan',     label: 'Ops Plans', Icon: ListChecks },
      { to: '/requests', label: 'Requests',  Icon: ClipboardList },
    ],
  },
  {
    title: 'Settings',
    items: [
      { to: '/settings/custom-fields', label: 'Custom Fields', Icon: Sliders },
    ],
  },
]

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const [email, setEmail] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [features, setFeatures] = useState<Record<string, boolean> | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email || null))
    fetch('/api/access/me').then(r => r.json()).then(j => { setIsAdmin(!!j?.isAdmin); setIsOwner(!!j?.isOwner); setFeatures(j?.features && typeof j.features === 'object' ? j.features : {}) }).catch(() => {})
  }, [])

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const initials = (email || 'U').split('@')[0].split('.').map(s => s[0]?.toUpperCase()).slice(0, 2).join('') || 'U'

  const isActive = (to: string) => path === to || (to !== '/' && path?.startsWith(to))

  // Hide pages a user doesn't have access to (owner always sees all). Then add the admin-only Users link.
  const canSee = (to: string) => {
    if (isOwner) return true
    const feat = featureForPath(to)
    return !feat || featureEnabled(features, feat.key)
  }
  const sections = SECTIONS
    .map(sec => sec.title === 'Settings' && isAdmin
      ? { ...sec, items: [...sec.items, { to: '/users', label: 'Users & access', Icon: UserCog }] }
      : sec)
    .map(sec => ({ ...sec, items: sec.items.filter(it => it.to === '/users' || canSee(it.to)) }))
    .filter(sec => sec.items.length > 0)

  return (
    <div className="min-h-screen flex bg-app">
      {/* Sidebar */}
      <aside className="w-60 bg-white border-r border-line flex flex-col">
        <div className="px-4 pt-5 pb-4 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-sm shadow-sm">S</div>
          <span className="font-bold text-[15px] tracking-tight text-ink">STAYBOARD</span>
        </div>
        <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
          {sections.map((section, si) => (
            <div key={si}>
              {section.title && (
                <div className="px-3 pt-4 pb-1 text-[10px] uppercase tracking-wider font-semibold text-muted/60">{section.title}</div>
              )}
              {section.items.map(({ to, label, Icon }) => {
                const active = isActive(to)
                return (
                  <Link key={to} href={to} prefetch
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${active ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-app hover:text-ink'}`}>
                    <Icon size={16} strokeWidth={active ? 2.25 : 2} className={active ? 'text-brand-600' : ''} />
                    {label}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-2.5 px-1.5 py-1.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white text-xs font-semibold flex items-center justify-center flex-shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-ink truncate font-medium">{email?.split('@')[0]}</div>
              <button onClick={signOut} className="text-[11px] text-muted hover:text-ink flex items-center gap-1 mt-0.5">
                <LogOut size={10} /> Sign out
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-[1600px] mx-auto p-6 lg:p-8 animate-fade-in">{children}</div>
      </main>
    </div>
  )
}

// Reusable spinner icon for sync feedback
export function SpinIcon({ size = 14 }: { size?: number }) {
  return <RefreshCw size={size} className="animate-spin" />
}
