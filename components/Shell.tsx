'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { featureForPath, pageAllowed, workspaceDef } from '@/lib/features'
import { defaultPinsFor, cleanPins, MAX_PINS, PINS_LS_KEY, GROUPS_LS_KEY } from '@/lib/nav'
import {
  Home, CalendarDays, Building2, MessageSquare, ClipboardList, KanbanSquare,
  ListChecks, Sliders, LogOut, RefreshCw, Gauge, Activity, Star, CalendarRange, AlertTriangle, Timer,
  Sparkles, TrendingUp, UserCog, PhoneCall, Users, BookOpen, ShoppingCart, FileText, Bell, Mail, Megaphone, Lock, Plug, ShieldAlert, ClipboardCheck, Receipt, CalendarOff, Sofa,
  ChevronRight, Search, Menu, X, Contact, Share2 } from 'lucide-react'

// ------------------------------------------------------------------------------------------------
// NAV, 2026-08-19 (Jon): the sidebar had 33 tabs in 7 groups, every one of them expanded, every
// minute of the day — 40 rows on screen, and Today in Ops sat below eight guest tabs. Two changes:
//
//   1. A pinned DAILY band on top. Hover any tab, click its star. Saved per person (not per
//      device) in app_users.prefs.nav_pins; someone who has never pinned anything inherits the
//      default for their role from lib/nav.ts.
//   2. The category groups stay — they are how you find the tab you touch twice a month — but they
//      FOLD. The group holding the page you are on opens itself; the rest stay shut until clicked,
//      and what you leave open is remembered on that device.
//
// Plus a jump box (Cmd/Ctrl-K) and, below lg, a real mobile header + drawer + a bottom bar carrying
// the first four pins, because until now the 240px desktop sidebar just squeezed onto a phone.
//
// Groups are ordered by how often a day touches them: Overview, Operations, Guests, Portfolio,
// Money, Team, Settings.
// ------------------------------------------------------------------------------------------------

type NavItem = { to: string; label: string; Icon: any }
type NavSection = { title: string; items: NavItem[] }

const SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { to: '/command', label: 'Command Center', Icon: Gauge },
      { to: '/eve',     label: 'Eve',            Icon: Sparkles },
      { to: '/',        label: 'Home',           Icon: Home },
    ],
  },
  {
    title: 'Operations',
    items: [
      // Ordered by use (Jon, 2026-08-19: "all other tabs can be reorganized to make sense"):
      // the everyday verbs first, then field work, then the periodic audit/purchasing layer.
      { to: '/plan',     label: 'Today in Ops', Icon: ListChecks },
      { to: '/schedule', label: 'Scheduler', Icon: CalendarRange },  // Jon 2026-08-19: his word for it
      { to: '/glitches', label: 'Glitches', Icon: AlertTriangle },   // Jon 2026-08-19: back to Glitches
      { to: '/requests', label: 'Work Orders', Icon: ClipboardList },
      { to: '/projects', label: 'Projects', Icon: KanbanSquare },
      { to: '/inspections', label: 'Inspections', Icon: ClipboardCheck },
      { to: '/audits',   label: 'Audits',   Icon: ClipboardList },
      { to: '/ffe',      label: 'FF&E Audit', Icon: Sofa },
      { to: '/orders',   label: 'Purchasing', Icon: ShoppingCart },
    ],
  },
  {
    title: 'Guests',
    items: [
      // Daily comms first; reference material (guidebooks, FAQ) after.
      { to: '/reservations', label: 'Reservations', Icon: CalendarDays },
      { to: '/messages',     label: 'Messages',     Icon: MessageSquare },
      { to: '/reviews',      label: 'Reviews',      Icon: Star },
      { to: '/welcome-calls', label: 'Welcome Calls', Icon: PhoneCall },
      { to: '/claims',       label: 'Claims',       Icon: ShieldAlert }, // Jon 2026-08-04: claims are guest-driven — lives with Guests
      { to: '/reservation-emails', label: 'Front-Desk Notices', Icon: Mail },
      { to: '/guidebooks',   label: 'Guidebooks',   Icon: BookOpen },
      // Renamed 2026-08-19 (Jon): "Unit Knowledge" -> "Property FAQ". Same page, same key.
      { to: '/faq',          label: 'Property FAQ', Icon: Sparkles },
      // Guests directory (2026-08-18, Jon, parallel session): guest profiles aggregated from
      // reservations; VIP on a profile feeds auto-inspections.
      { to: '/guests',       label: 'Guests',       Icon: Contact },
    ],
  },
  {
    title: 'Portfolio',
    items: [
      { to: '/buildings', label: 'Properties', Icon: Building2 },
      { to: '/vault',     label: 'Vault', Icon: Lock },
      // Share Links hub (2026-08-18, Jon, parallel session): build + customise owner/property links.
      { to: '/links',     label: 'Share Links', Icon: Share2 },
      { to: '/health',    label: 'Health Score', Icon: Activity },
      // Nav diet 2026-08-11 (Jon): Patterns folded into Guest Issues (/glitches → Patterns tab).
      { to: '/blocked',   label: 'Blocked Units', Icon: CalendarOff }, // 2026-08-10 - inventory off the calendar
    ],
  },
  {
    title: 'Money',
    items: [
      { to: '/revenue',  label: 'Revenue',      Icon: TrendingUp },
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
      // Nav diet 2026-08-11 (Jon): ONE Labor entry — the dashboard lives as a tab inside /labor.
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

function readLocal(key: string): any {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}
function writeLocal(key: string, value: any) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(key, JSON.stringify(value)) } catch { /* private mode */ }
}

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

  // Pins: null until we know (device copy or server), so the band never flashes the role default
  // over someone's real choices.
  const [pins, setPins] = useState<string[] | null>(null)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean> | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const pinsLoaded = useRef(false)
  const dragFrom = useRef<number | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email || null))
    // Paint the device copy immediately; the fetch below corrects it a moment later.
    const local = readLocal(PINS_LS_KEY)
    if (Array.isArray(local) && local.length) setPins(cleanPins(local))
    const groups = readLocal(GROUPS_LS_KEY)
    setOpenGroups(groups && typeof groups === 'object' && !Array.isArray(groups) ? groups : {})

    fetch('/api/access/me').then(r => r.json()).then(j => {
      setIsAdmin(!!j?.isAdmin); setIsOwner(!!j?.isOwner)
      setFeatures(j?.features && typeof j.features === 'object' ? j.features : {})
      setWorkspace(typeof j?.workspace === 'string' ? j.workspace : null)
      if (j?.levels && typeof j.levels === 'object') setLevels(j.levels)
      if (typeof j?.accessRole === 'string' && j.accessRole) setRoleLabel(j.accessRole)
      if (j?.profile?.name) setDisplayName(String(j.profile.name))
      const roleKey = typeof j?.accessRole === 'string' && j.accessRole ? j.accessRole : (j?.isOwner ? 'admin' : null)
      // The saved copy wins over the device copy, but only on this first pass — after that the
      // user's own clicks are the truth.
      fetch('/api/access/prefs', { cache: 'no-store' }).then(r => r.json()).then(p => {
        if (pinsLoaded.current) return
        pinsLoaded.current = true
        if (p && p.ok && Array.isArray(p.pins) && p.pins.length) {
          const clean = cleanPins(p.pins)
          setPins(clean); writeLocal(PINS_LS_KEY, clean)
          return
        }
        const again = readLocal(PINS_LS_KEY)
        if (Array.isArray(again) && again.length) { setPins(cleanPins(again)); return }
        setPins(defaultPinsFor(roleKey))
      }).catch(() => {
        if (pinsLoaded.current) return
        pinsLoaded.current = true
        const again = readLocal(PINS_LS_KEY)
        setPins(Array.isArray(again) && again.length ? cleanPins(again) : defaultPinsFor(roleKey))
      })
    }).catch(() => { /* nav stays fully visible; middleware is the real gate */ })
  }, [])

  // Close the drawer whenever the route changes — otherwise tapping a link on a phone leaves the
  // panel sitting over the page you just navigated to.
  useEffect(() => { setDrawerOpen(false); setPaletteOpen(false) }, [path])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(v => !v) }
      if (e.key === 'Escape') { setPaletteOpen(false); setDrawerOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const initials = (email || 'U').split('@')[0].split('.').map(s => s[0]?.toUpperCase()).slice(0, 2).join('') || 'U'

  const isActive = (to: string) => path === to || (to !== '/' && !!path && path.startsWith(to))

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

  const sections: NavSection[] = SECTIONS
    .map(sec => sec.title === 'Settings' && isAdmin
      ? { title: sec.title, items: sec.items.concat([{ to: '/users', label: 'Users & admin', Icon: UserCog }]) }
      : sec)
    .map(sec => ({ title: sec.title, items: sec.items.filter(it => it.to === '/users' || canSee(it.to)) }))
    .filter(sec => sec.items.length > 0)

  // Flat lookup so a pin (a path) renders with the same icon and label as its group row.
  const byPath: Record<string, NavItem> = {}
  for (let i = 0; i < sections.length; i++) {
    const items = sections[i].items
    for (let j = 0; j < items.length; j++) byPath[items[j].to] = items[j]
  }

  const pinned: NavItem[] = []
  if (pins) {
    for (let i = 0; i < pins.length; i++) {
      const hit = byPath[pins[i]]
      if (hit) pinned.push(hit)
    }
  }

  // Which group holds the page we are on — that one opens itself, whatever the saved state says.
  let activeGroup: string | null = null
  for (let i = 0; i < sections.length && !activeGroup; i++) {
    const items = sections[i].items
    for (let j = 0; j < items.length; j++) if (isActive(items[j].to)) { activeGroup = sections[i].title; break }
  }

  const isGroupOpen = (title: string) => {
    if (!openGroups) return title === activeGroup
    if (openGroups[title] != null) return !!openGroups[title]
    return title === activeGroup
  }
  const toggleGroup = (title: string) => {
    const next: Record<string, boolean> = {}
    const cur = openGroups || {}
    const keys = Object.keys(cur)
    for (let i = 0; i < keys.length; i++) next[keys[i]] = cur[keys[i]]
    next[title] = !isGroupOpen(title)
    setOpenGroups(next)
    writeLocal(GROUPS_LS_KEY, next)
  }

  function savePins(next: string[]) {
    setPins(next)
    writeLocal(PINS_LS_KEY, next)
    fetch('/api/access/prefs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pins: next }),
    }).catch(() => { /* the device copy already holds it */ })
  }
  const isPinned = (to: string) => !!pins && pins.indexOf(to) >= 0

  // Drag a Daily row onto another to reorder. The saved list may also hold pins this person can no
  // longer see (a role changed under them); those ride along at the end so a reorder never drops
  // them silently.
  function movePin(from: number, to: number) {
    if (from === to || from < 0 || to < 0) return
    const visible = pinned.map(p => p.to)
    if (from >= visible.length || to >= visible.length) return
    const next = visible.slice()
    const moved = next.splice(from, 1)[0]
    next.splice(to, 0, moved)
    const hidden = (pins || []).filter(p => visible.indexOf(p) < 0)
    savePins(next.concat(hidden))
  }
  function togglePin(to: string) {
    const cur = pins || []
    if (cur.indexOf(to) >= 0) { savePins(cur.filter(p => p !== to)); return }
    if (cur.length >= MAX_PINS) return
    savePins(cur.concat([to]))
  }

  // Badge shows the DB role when assigned (pretty-printed key), else the legacy workspace label.
  const wsLabel = roleLabel
    ? roleLabel.split('_').map(w => w === 'cs' ? 'CS' : w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : (workspace ? workspaceDef(workspace).label : null)

  const here = byPath[path || '']
  const currentLabel = here ? here.label : (activeGroup || 'Lighthouse')

  const navBody = (onNavigate?: () => void) => (
    <>
      <button type="button" onClick={() => { setPaletteOpen(true); if (onNavigate) onNavigate() }}
        className="w-full flex items-center gap-2.5 mb-2 px-3 py-2 rounded-xl border border-line bg-app/60 text-sm text-muted hover:bg-white hover:border-brand-200 transition-all">
        <Search size={15} />
        <span>Jump to…</span>
        <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded border border-line bg-white text-muted">⌘K</span>
      </button>

      {pinned.length > 0 && (
        <div>
          <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider font-bold text-amber-700 flex items-center gap-1.5">
            <Star size={11} className="fill-amber-400 text-amber-500" /> Daily
          </div>
          {pinned.map(({ to, label, Icon }, idx) => {
            const active = isActive(to)
            return (
              <div key={'pin-' + to} draggable
                onDragStart={() => { dragFrom.current = idx }}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); if (dragFrom.current != null) movePin(dragFrom.current, idx); dragFrom.current = null }}
                onDragEnd={() => { dragFrom.current = null }}
                title="Drag to reorder"
                className={`group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all cursor-grab active:cursor-grabbing ${active ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-app hover:text-ink'}`}>
                <Link href={to} prefetch={false} draggable={false} onClick={onNavigate} className="flex items-center gap-3 flex-1 min-w-0">
                  <Icon size={16} strokeWidth={active ? 2.25 : 2} className={active ? 'text-brand-600' : ''} />
                  <span className="truncate">{label}</span>
                </Link>
                <button type="button" title="Unpin from Daily" aria-label={'Unpin ' + label}
                  onClick={() => togglePin(to)} className="flex-shrink-0 text-amber-500 hover:text-amber-600">
                  <Star size={14} className="fill-amber-400" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {sections.map(section => {
        // Jon 2026-08-19: "if starred it should not show up again below, it should be MOVED." So a
        // pinned tab leaves its group entirely — Daily is its only home until it is unstarred, and
        // a group with nothing left drops out of the list rather than sitting there empty.
        const rest = section.items.filter(it => !isPinned(it.to))
        if (rest.length === 0) return null
        const open = isGroupOpen(section.title)
        return (
          <div key={section.title}>
            <button type="button" onClick={() => toggleGroup(section.title)}
              className="w-full mt-3 flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] uppercase tracking-wider font-bold text-muted/70 hover:bg-app hover:text-ink transition-all">
              <ChevronRight size={12} className={'transition-transform ' + (open ? 'rotate-90' : '')} />
              {section.title}
              <span className="ml-auto text-[10px] font-bold tracking-normal px-1.5 rounded-full border border-line bg-app text-muted">{rest.length}</span>
            </button>
            {open && rest.map(({ to, label, Icon }) => {
              const active = isActive(to)
              const on = isPinned(to)
              return (
                <div key={to} className={`group flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all ${active ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-app hover:text-ink'}`}>
                  <Link href={to} prefetch={false} onClick={onNavigate} className="flex items-center gap-3 flex-1 min-w-0">
                    <Icon size={16} strokeWidth={active ? 2.25 : 2} className={active ? 'text-brand-600' : ''} />
                    <span className="truncate">{label}</span>
                  </Link>
                  <button type="button" title={on ? 'Unpin from Daily' : 'Pin to Daily'} aria-label={(on ? 'Unpin ' : 'Pin ') + label}
                    onClick={() => togglePin(to)}
                    className={'flex-shrink-0 transition-opacity ' + (on ? 'text-amber-500' : 'text-muted/40 opacity-0 group-hover:opacity-100 hover:text-amber-500')}>
                    <Star size={14} className={on ? 'fill-amber-400' : ''} />
                  </button>
                </div>
              )
            })}
          </div>
        )
      })}
    </>
  )

  return (
    // APP SHELL, NOT A LONG PAGE. This was min-h-screen, so the wrapper grew to the height of the
    // content and the WINDOW did the scrolling — which meant main's overflow-auto never engaged and
    // every position:sticky inside it silently did nothing (sticky binds to the nearest scrolling
    // ancestor, and that ancestor was not scrolling). h-screen makes main the real scroller, so the
    // sidebar stays put and sticky headers work on every page.
    <div className="h-screen overflow-hidden flex bg-app">
      {/* Sidebar — desktop only. Below lg the header + drawer + bottom bar take over. */}
      <aside className="hidden lg:flex w-60 bg-white border-r border-line flex-col">
        <div className="px-4 pt-5 pb-4 flex items-center gap-2.5">
          <img src="/icon-192.png" alt="Lighthouse" className="w-8 h-8 rounded-lg shadow-sm" />
          <span className="font-bold text-[15px] tracking-tight text-ink">LIGHTHOUSE</span>
        </div>
        <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
          {navBody()}
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

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="lg:hidden flex items-center gap-2 px-3 py-2.5 bg-white border-b border-line flex-shrink-0">
          <button type="button" onClick={() => setDrawerOpen(true)} aria-label="Open menu"
            className="w-9 h-9 rounded-lg border border-line grid place-items-center text-muted hover:text-ink">
            <Menu size={17} />
          </button>
          <img src="/icon-192.png" alt="Lighthouse" className="w-7 h-7 rounded-lg shadow-sm" />
          <span className="font-semibold text-sm text-ink truncate">{currentLabel}</span>
          <button type="button" onClick={() => setPaletteOpen(true)} aria-label="Jump to a tab"
            className="ml-auto w-9 h-9 rounded-lg border border-line grid place-items-center text-muted hover:text-ink">
            <Search size={16} />
          </button>
        </header>

        <main className="flex-1 overflow-auto">
          <div className="max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8 animate-fade-in">{children}</div>
        </main>

        {/* Mobile bottom bar — the first four pins. One thumb, no scrolling. */}
        {pinned.length > 0 && (
          <nav className="lg:hidden flex-shrink-0 border-t border-line bg-white flex items-stretch">
            {pinned.slice(0, 4).map(({ to, label, Icon }) => {
              const active = isActive(to)
              return (
                <Link key={'bb-' + to} href={to} prefetch={false}
                  className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-semibold ${active ? 'text-brand-600' : 'text-muted'}`}>
                  <Icon size={18} strokeWidth={active ? 2.25 : 2} />
                  <span className="truncate max-w-full px-1">{label}</span>
                </Link>
              )
            })}
            <button type="button" onClick={() => setDrawerOpen(true)}
              className="flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-semibold text-muted">
              <Menu size={18} />
              <span>More</span>
            </button>
          </nav>
        )}
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setDrawerOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-[82%] max-w-[300px] bg-white shadow-lifted flex flex-col">
            <div className="px-4 pt-4 pb-3 flex items-center gap-2.5 border-b border-line">
              <img src="/icon-192.png" alt="Lighthouse" className="w-7 h-7 rounded-lg shadow-sm" />
              <span className="font-bold text-sm tracking-tight text-ink">LIGHTHOUSE</span>
              <button type="button" onClick={() => setDrawerOpen(false)} aria-label="Close menu"
                className="ml-auto w-8 h-8 rounded-lg grid place-items-center text-muted hover:text-ink">
                <X size={17} />
              </button>
            </div>
            <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
              {navBody(() => setDrawerOpen(false))}
            </nav>
            <div className="border-t border-line p-3 flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-white text-xs font-semibold flex items-center justify-center flex-shrink-0">
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-ink truncate font-medium">{displayName || email?.split('@')[0]}</div>
                <button onClick={signOut} className="text-[11px] text-muted hover:text-ink flex items-center gap-1 mt-0.5">
                  <LogOut size={10} /> Sign out
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {paletteOpen && <JumpPalette sections={sections} onClose={() => setPaletteOpen(false)} />}
    </div>
  )
}

// Cmd/Ctrl-K jump box. Type three letters, hit Enter. This is what makes a folded group free: you
// never have to remember which drawer a tab lives in.
function JumpPalette({ sections, onClose }: { sections: { title: string; items: { to: string; label: string; Icon: any }[] }[]; onClose: () => void }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => { const t = setTimeout(() => { if (inputRef.current) inputRef.current.focus() }, 20); return () => clearTimeout(t) }, [])
  useEffect(() => { setSel(0) }, [q])

  const all: { to: string; label: string; Icon: any; group: string }[] = []
  for (let i = 0; i < sections.length; i++) {
    const items = sections[i].items
    for (let j = 0; j < items.length; j++) all.push({ to: items[j].to, label: items[j].label, Icon: items[j].Icon, group: sections[i].title })
  }
  const needle = q.trim().toLowerCase()
  const hits = needle
    ? all.filter(x => x.label.toLowerCase().indexOf(needle) >= 0 || x.group.toLowerCase().indexOf(needle) >= 0)
    : all

  const go = (to: string) => { onClose(); router.push(to) }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(s + 1, hits.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(s - 1, 0)) }
    if (e.key === 'Enter' && hits[sel]) { e.preventDefault(); go(hits[sel].to) }
  }

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-ink/35" onClick={onClose} />
      <div className="absolute left-1/2 -translate-x-1/2 top-[12vh] w-[92vw] max-w-[560px] bg-white border border-line rounded-2xl shadow-lifted overflow-hidden">
        <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKey}
          placeholder="Jump to a tab…" aria-label="Jump to a tab"
          className="w-full px-4 py-3.5 text-[15px] outline-none border-b border-line text-ink placeholder:text-muted" />
        <div className="max-h-80 overflow-y-auto p-1.5">
          {hits.length === 0 && <div className="px-3 py-6 text-sm text-muted text-center">No tab matches that.</div>}
          {hits.map((h, i) => {
            const HitIcon = h.Icon
            return (
              <button key={h.to} type="button" onMouseEnter={() => setSel(i)} onClick={() => go(h.to)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-left ${i === sel ? 'bg-brand-50 text-brand-700' : 'text-ink hover:bg-app'}`}>
                <HitIcon size={15} />
                <span>{h.label}</span>
                <span className="ml-auto text-[11px] text-muted">{h.group}</span>
              </button>
            )
          })}
        </div>
      </div>
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
