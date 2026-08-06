'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { featureForPath, pageAllowed, workspaceDef } from '@/lib/features'
import {
  Home, CalendarDays, Building2, Layers, MessageSquare, ClipboardList,
  ListChecks, Sliders, LogOut, RefreshCw, Gauge, Activity, Star, CalendarRange, AlertTriangle, Timer,
  Share2, Sparkles, TrendingUp, UserCog, PhoneCall, Users, BookOpen, ShoppingCart, FileText, Bell, Mail, Megaphone, Lock, Plug, ShieldAlert, ClipboardCheck, Radar, Receipt
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
      { to: '/reservation-emails', label: 'Front-Desk Notices', Icon: Mail },
      { to: '/messages',     label: 'Messages',     Icon: MessageSquare },
      { to: '/reviews',      label: 'Reviews',      Icon: Star },
      { to: '/welcome-calls', label: 'Welcome Calls', Icon: PhoneCall },
      { to: '/guidebooks',   label: 'Guidebooks',   Icon: BookOpen },
      { to: '/claims',       label: 'Claims',       Icon: ShieldAlert }, // Jon 2026-08-04: claims are guest-driven — lives with Guests
      { to: '/faq',          label: 'Unit Knowledge', Icon: Sparkles },
    ],
  },
  {
    title: 'Operations',
    items: [
      { to: '/plan',     label: 'Today in Ops', Icon: ListChecks },
      { to: '/schedule', label: 'Schedule', Icon: CalendarRange },
      { to: '/glitches', label: 'Guest Issues', Icon: AlertTriangle },
      { to: '/audits',   label: 'Audits',   Icon: ClipboardList },
      { to: '/inspections', label: 'Inspections', Icon: ClipboardCheck }, // gated 2026-08-06 — was URL-only
      { to: '/orders',   label: 'Purchasing', Icon: ShoppingCart },
      { to: '/requests', label: 'Work Orders', Icon: ClipboardList },
    ],
  },
  {
    title: 'Portfolio',
    items: [
      { to: '/buildings', label: 'Properties', Icon: Building2 },
      { to: '/vault',     label: 'Vault', Icon: Lock },
      { to: '/health',    label: 'Health Score', Icon: Activity },
      { to: '/patterns',  label: 'Patterns', Icon: Radar },
    ],
  },
  {
    title: 'Money',
    items: [
      { to: '/revenue',  label: 'Revenue',      Icon: TrendingUp },
      { to: '/channels', label: 'Channels',     Icon: Share2 },
      { to: '/marketing', label: 'Direct Bookings', Icon: Megaphone },
      { to: '/billing',  label: 'Billable Hours', Icon: Receipt }, // 2026-08-06 - Breezeway task billing by owner
      { to: '/reports',  label: 'Owner Reports', Icon: FileText },
      { to: '/owner-audit', label: 'Owner Audit', Icon: ListChecks },
    ],
  },
  {
    title: 'Team',
    items: [
      { to: '/cleaners', label: 'Cleaners', Icon: Users },
      { to: '/labor',    label: 'Labor', Icon: Timer },
    ],
  },
  {
    title: 'Settings',
    items: [
      { to: '/integrations', label: 'Integrations', Icon: Plug },
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
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [levels, setLevels] = useState<Record<string, string> | null>(null)
  const [roleLabel, setRoleLabel] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email || null))
    fetch('/api/access/me').then(r => r.json()).then(j => {
      setIsAdmin(!!j?.isAdmin); setIsOwner(!!j?.isOwner)
      setFeatures(j?.features && typeof j.features === 'object' ? j.features : {})
      setWorkspace(typeof j?.workspace === 'string' ? j.workspace : null)
      if (j?.levels && typeof j.levels === 'object') setLevels(j.levels)
      if (typeof j?.accessRole === 'string' && j.accessRole) setRoleLabel(j.accessRole)
      if (j?.profile?.name) setDisplayName(String(j.profile.name))
    }).catch(() => {})
  }, [])

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const initials = (email || 'U').split('@')[0].split('.').map(s => s[0]?.toUpperCase()).slice(0, 2).join('') || 'U'

  const isActive = (to: string) => path === to || (to !== '/' && path?.startsWith(to))

  // Hide pages outside the user's workspace bundle or toggled off for them (owner always sees all).
  // While /api/access/me is still loading (workspace === null) show everything — no nav flicker,
  // and the middleware is the real gate anyway.
  const canSee = (to: string) => {
    if (isOwner || (workspace === null && levels === null)) return true
    const feat = featureForPath(to)
    if (!feat) return true
    // Roles + levels (migration 023): 'off' hides the tab. Falls back to the legacy
    // workspace-bundle check when levels haven't arrived (pre-migration or fetch failure).
    if (levels && levels[feat.key] != null) return levels[feat.key] !== 'off'
    return pageAllowed(workspace, features, feat.key)
  }
  const sections = SECTIONS
    .map(sec => sec.title === 'Settings' && isAdmin
      ? { ...sec, items: [...sec.items, { to: '/users', label: 'Users & admin', Icon: UserCog }] }
      : sec)
    .map(sec => ({ ...sec, items: sec.items.filter(it => it.to === '/users' || canSee(it.to)) }))
    .filter(sec => sec.items.length > 0)

  // Badge shows the DB role when assigned (pretty-printed key), else the legacy workspace label.
  const wsLabel = roleLabel
    ? roleLabel.split('_').map(w => w === 'cs' ? 'CS' : w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : (workspace ? workspaceDef(workspace).label : null)

  return (
    <div className="min-h-screen flex bg-app">
      {/* Sidebar */}
      <aside className="w-60 bg-white border-r border-line flex flex-col">
        <div className="px-4 pt-5 pb-4 flex items-center gap-2.5">
          <img src="/icon-192.png" alt="Lighthouse" className="w-8 h-8 rounded-lg shadow-sm" />
          <span className="font-bold text-[15px] tracking-tight text-ink">LIGHTHOUSE</span>
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
                  <Link key={to} href={to} prefetch={false}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${active ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-app hover:text-ink'}`}>
                    <Icon size={16} strokeWidth={active ? 2.25 : 2} className={active ? 'text-brand-600' : ''} />
                    {label}
                  </Link>
                )
              })}
            </div>
          ))}
        </nav>
        <NotificationsBell />
        <div className="border-t border-line p-3">
          <div className="flex items-center gap-2.5 px-1.5 py-1.5">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white text-xs font-semibold flex items-center justify-center flex-shrink-0">
              {initials}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-ink truncate font-medium">{displayName || email?.split('@')[0]}</div>
              <div className="flex items-center gap-1.5 mt-0.5">
                {wsLabel && <span className="text-[10px] font-semibold px-1.5 py-px rounded bg-brand-50 text-brand-700">{wsLabel}</span>}
                <button onClick={signOut} className="text-[11px] text-muted hover:text-ink flex items-center gap-1">
                  <LogOut size={10} /> Sign out
                </button>
              </div>
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

// SYSTEM-WIDE notifications bell — polls /api/notifications (comments, @mentions, and any
// feature that calls lib/notify). Lives in the sidebar so it's visible on every page.
function NotificationsBell() {
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState<any[]>([])
  const loadN = () => { fetch('/api/notifications', { cache: 'no-store' }).then(r => r.json()).then(j => { if (j && j.ok) { setUnread(j.unread || 0); setItems(Array.isArray(j.notifications) ? j.notifications : []) } }).catch(() => {}) }
  useEffect(() => { loadN(); const t = setInterval(() => { if (document.visibilityState === 'visible') loadN() }, 60000); return () => clearInterval(t) }, [])
  const markAll = async () => { try { await fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'readAll' }) }) } catch {} loadN() }
  const openOne = async (n: any) => { try { await fetch('/api/notifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read', ids: [n.id] }) }) } catch {} if (n.link) { window.location.href = n.link } else { loadN() } }
  const when = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
  return (
    <div className="border-t border-line px-2 py-1.5 relative">
      <button onClick={() => { const next = !open; setOpen(next); if (next) loadN() }} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-muted hover:bg-app hover:text-ink transition-all">
        <Bell size={16} />
        Notifications
        {unread > 0 && <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-rose-600 text-white">{unread}</span>}
      </button>
      {open && (
        <div className="absolute bottom-12 left-2 w-80 max-h-96 overflow-y-auto rounded-xl border border-line bg-white shadow-lg z-50">
          <div className="flex items-center px-3 py-2 border-b border-line sticky top-0 bg-white">
            <span className="text-sm font-semibold text-ink">Notifications</span>
            {unread > 0 && <button onClick={markAll} className="ml-auto text-[11px] font-medium text-brand-700 hover:underline">Mark all read</button>}
          </div>
          {items.length === 0 && <div className="px-3 py-6 text-sm text-muted text-center">Nothing yet.</div>}
          <div className="divide-y divide-line">
            {items.map(n => (
              <button key={n.id} onClick={() => openOne(n)} className={'w-full text-left px-3 py-2 hover:bg-app/60 ' + (n.read ? 'opacity-60' : '')}>
                <div className="text-[12px] font-medium text-ink">{n.title}</div>
                {n.body && <div className="text-[11px] text-muted line-clamp-2">{n.body}</div>}
                <div className="text-[10px] text-muted mt-0.5">{when(n.created_at)}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// Reusable spinner icon for sync feedback
export function SpinIcon({ size = 14 }: { size?: number }) {
  return <RefreshCw size={size} className="animate-spin" />
}
