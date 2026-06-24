'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { Home, CalendarDays, Building2, MessageSquare, ClipboardList, ListChecks, Sliders, LogOut, RefreshCw, Gauge } from 'lucide-react'

const NAV = [
  { to: '/command',                 label: 'Command Center', Icon: Gauge,         section: 'main' },
  { to: '/',                        label: 'Home',          Icon: Home,           section: 'main' },
  { to: '/reservations',            label: 'Reservations',  Icon: CalendarDays,   section: 'main' },
  { to: '/listings',                label: 'Properties',    Icon: Building2,      section: 'main' },
  { to: '/messages',                label: 'Messages',      Icon: MessageSquare,  section: 'main' },
  { to: '/plan',                    label: 'Ops Plans',     Icon: ListChecks,     section: 'ops' },
  { to: '/requests',                label: 'Requests',      Icon: ClipboardList,  section: 'ops' },
  { to: '/settings/custom-fields',  label: 'Custom Fields', Icon: Sliders,        section: 'settings' }
]

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname()
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email || null))
  }, [])

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const initials = (email || 'U').split('@')[0].split('.').map(s => s[0]?.toUpperCase()).slice(0, 2).join('') || 'U'

  return (
    <div className="min-h-screen flex bg-app">
      {/* Sidebar */}
      <aside className="w-60 bg-white border-r border-line flex flex-col">
        <div className="px-4 pt-5 pb-4 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center text-white font-bold text-sm shadow-sm">S</div>
          <span className="font-bold text-[15px] tracking-tight text-ink">STAYBOARD</span>
        </div>
        <nav className="flex-1 px-2 py-2 space-y-0.5">
          {NAV.filter(n => n.section === 'main').map(({ to, label, Icon }) => {
            const active = path === to || (to !== '/' && path?.startsWith(to))
            return (
              <Link key={to} href={to} prefetch
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${active ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-app hover:text-ink'}`}>
                <Icon size={16} strokeWidth={active ? 2.25 : 2} className={active ? 'text-brand-600' : ''} />
                {label}
              </Link>
            )
          })}
          <div className="px-3 pt-4 pb-1 text-[10px] uppercase tracking-wider font-semibold text-muted/60">Ops</div>
          {NAV.filter(n => n.section === 'ops').map(({ to, label, Icon }) => {
            const active = path === to || (to !== '/' && path?.startsWith(to))
            return (
              <Link key={to} href={to} prefetch
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${active ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-app hover:text-ink'}`}>
                <Icon size={16} strokeWidth={active ? 2.25 : 2} className={active ? 'text-brand-600' : ''} />
                {label}
              </Link>
            )
          })}
          <div className="px-3 pt-4 pb-1 text-[10px] uppercase tracking-wider font-semibold text-muted/60">Settings</div>
          {NAV.filter(n => n.section === 'settings').map(({ to, label, Icon }) => {
            const active = path === to || (to !== '/' && path?.startsWith(to))
            return (
              <Link key={to} href={to} prefetch
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${active ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-app hover:text-ink'}`}>
                <Icon size={16} strokeWidth={active ? 2.25 : 2} className={active ? 'text-brand-600' : ''} />
                {label}
              </Link>
            )
          })}
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
