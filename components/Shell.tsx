'use client'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { featureForPath, pageAllowed, workspaceDef } from '@/lib/features'
import { defaultPinsFor, cleanPins, MAX_PINS, PINS_LS_KEY } from '@/lib/nav'
import { DESKS, deskForPath, type DeskView } from '@/lib/desks'
import { EveFloat } from '@/components/EveFloat'
import { AddTaskHost, openAddTask } from '@/components/AddTaskSheet'
import { BUSINESSES, businessForPath, businessDef, GARDEN_NAV, GARDEN_SECTIONS, GARDEN_ICON, LAST_VR_PATH_KEY, type BusinessKey } from '@/lib/business'
import { AdamFloat } from '@/components/AdamFloat'
import {
  Building2, MessageSquare, ListChecks, LogOut, RefreshCw, Gauge, Star, TrendingUp, Users, FileText, Bell,
  Search, Menu, X, Plus, ChevronDown, Check, Settings as SettingsIcon } from 'lucide-react'

// ------------------------------------------------------------------------------------------------
// NAV, 2026-09-29 (Jon): "get rid of useless or noisy tabs… break it down into simple tabs", then
// "I want this app to be primary ops, guest experience, listing optimization, owner reporting and
// onboarding, review management, team management and operational KPI management."
//
// The sidebar is Today plus seven desks and an Admin desk behind a gear, read from lib/desks.ts —
// the one map of the app. Each desk links to the first page in it the person can open; the pages
// of the desk you are on run across the top as a strip, secondary ones under "More". The pinned
// band is gone on the VR side (nine rows fit on one screen) and the Jump box (Cmd/Ctrl-K) finds any
// page. The Garden Hotel keeps its own sections and pinned band unchanged (its session owns them).
//
// History, briefly: 38 rows in 7 folding groups with a pinned band (2026-08-19), hubs (08-24),
// tab sets (09-03). Each round moved the same pages around; this one puts them under the job they
// serve, and the permission grid, Eve's map and the Jump box read the same list.
// ------------------------------------------------------------------------------------------------

type NavItem = { to: string; label: string; Icon: any }
type NavSection = { title: string; items: NavItem[] }

// One icon per desk (lib/desks.ts stays free of JSX). Admin is the gear.
const DESK_ICONS: Record<string, any> = {
  today: Gauge, operations: ListChecks, guests: MessageSquare, reviews: Star, listings: Building2,
  owners: FileText, team: Users, kpis: TrendingUp, admin: SettingsIcon,
}
// The phone's bottom bar has room for about ten characters a tab.
const DESK_SHORT: Record<string, string> = { guests: 'Guests' }
// Pages that size themselves to the window and draw no desk strip above them.
const NO_STRIP = ['/revenue-app']

// PER-TAB CACHE FOR THE SHELL'S OWN READS (2026-09-18). The Shell is rendered inside every page,
// so it remounts on every navigation and asked /api/access/me and /api/access/prefs again each
// time — two auth'd round-trips (getUser + app_users + roles + settings) before the sidebar could
// settle, on every click. Access and pins change rarely; a tab keeps the last answer for two
// minutes and refreshes it in the background after that. A prefs write clears it, and a fresh tab
// or a sign-in always asks the server.
const SHELL_CACHE_TTL = 120_000
function cachedJson(url: string, ttl = SHELL_CACHE_TTL): Promise<any> {
  const key = 'shell:' + url
  try {
    const raw = sessionStorage.getItem(key)
    if (raw) {
      const hit = JSON.parse(raw)
      if (hit && typeof hit.at === 'number' && Date.now() - hit.at < ttl) return Promise.resolve(hit.v)
    }
  } catch { /* private mode or blocked storage */ }
  return fetch(url, { cache: 'no-store' }).then(r => r.json()).then(v => {
    try { if (v && (v.ok || v.isAdmin != null || v.features)) sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), v })) } catch { /* fine */ }
    return v
  })
}
function forgetCached(url: string) { try { sessionStorage.removeItem('shell:' + url) } catch { /* fine */ } }

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

// FULL-PAGE MODE (Jon, 2026-09-09: Projects "should have a open view full page with a sidebar that
// we can open for the main app if needed"). `full` hides the app sidebar, the phone header and the
// bottom bar at every width and hands the whole viewport to the page; the app's navigation is still
// one tap away as the drawer, opened through useShellMenu() from anywhere inside.
const ShellMenu = createContext<{ open: () => void; full: boolean }>({ open: () => {}, full: false })
export const useShellMenu = () => useContext(ShellMenu)

export function Shell({ children, full = false }: { children: React.ReactNode; full?: boolean }) {
  const path = usePathname()
  const router = useRouter()
  // ACTIVITY BEACON (Jon, 2026-08-22: "record all activity in the app"): one metadata row per
  // screen opened, straight from the shell so every page is covered. keepalive survives quick
  // navigations; failures are ignored — the app never waits on its own log.
  useEffect(() => {
    if (!path) return
    try {
      fetch('/api/activity', {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path }),
      }).catch(() => { /* logging never blocks the app */ })
    } catch { /* ignore */ }
  }, [path])
  const [email, setEmail] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [isOwner, setIsOwner] = useState(false)
  const [features, setFeatures] = useState<Record<string, boolean> | null>(null)
  const [workspace, setWorkspace] = useState<string | null>(null)
  const [levels, setLevels] = useState<Record<string, string> | null>(null)
  // Business units (migration 118): the businesses this login may enter + the hotel role's page levels.
  const [units, setUnits] = useState<string[] | null>(null)
  const [gLevels, setGLevels] = useState<Record<string, string> | null>(null)
  const [roleLabel, setRoleLabel] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState<string | null>(null)

  // Pins: null until we know (device copy or server), so the band never flashes the role default
  // over someone's real choices.
  const [pins, setPins] = useState<string[] | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  // WHICH BUSINESS (Jon, 2026-09-28: "a drop down… a completely different page"). Decided by the
  // URL, never by a saved choice, so a link into /garden always shows the hotel. The VR side's last
  // path is kept on the device so switching back lands where you were.
  const business: BusinessKey = businessForPath(path)
  const [bizOpen, setBizOpen] = useState(false)
  useEffect(() => { if (business === 'vr' && path) { try { localStorage.setItem(LAST_VR_PATH_KEY, path) } catch {} } }, [business, path])
  const switchBusiness = (key: BusinessKey) => {
    setBizOpen(false); setDrawerOpen(false)
    if (key === business) return
    let to = businessDef(key).landing
    if (key === 'vr') { try { const last = localStorage.getItem(LAST_VR_PATH_KEY); if (last && last.startsWith('/') && !last.startsWith('/garden')) to = last } catch {} }
    router.push(to)
  }
  // Hand-picked (lib/features HAND_PICKED): shown only once levels say so — never on a guess.
  const canSeeGarden = () => isOwner || !!gLevels || (!!units && units.includes('garden'))
  const canSeeVr = () => isOwner || !units || units.includes('vr')
  // The hotel's sidebar shows what the hotel role can see; before /api/access/me answers, nothing.
  const gOn = (key: string) => !!gLevels && !!gLevels[key] && gLevels[key] !== 'off'
  const gVisible = (key: string) => isOwner || gOn(key) || (key === 'users' && ['settings', 'setup', 'staff', 'adam'].some(gOn))
  const gardenNav = GARDEN_NAV.filter(g => gVisible(g.key))
  const pinsLoaded = useRef(false)
  const dragFrom = useRef<number | null>(null)

  useEffect(() => {
    const supabase = createClient()
    const who = supabase.auth.getUser().then(({ data }) => {
      const e = data.user?.email || null
      setEmail(e)
      try { const prev = sessionStorage.getItem('shell:who'); if (prev !== (e || '')) { forgetCached('/api/access/me'); forgetCached('/api/access/prefs'); sessionStorage.setItem('shell:who', e || '') } } catch { /* fine */ }
    })
    // Paint the device copy immediately; the fetch below corrects it a moment later.
    const local = readLocal(PINS_LS_KEY)
    if (Array.isArray(local) && local.length) setPins(cleanPins(local))

    who.then(() => cachedJson('/api/access/me')).then(j => {
      setIsAdmin(!!j?.isAdmin); setIsOwner(!!j?.isOwner)
      setFeatures(j?.features && typeof j.features === 'object' ? j.features : {})
      setWorkspace(typeof j?.workspace === 'string' ? j.workspace : null)
      if (j?.levels && typeof j.levels === 'object') setLevels(j.levels)
      if (Array.isArray(j?.businesses)) setUnits(j.businesses)
      setGLevels(j?.garden?.levels && typeof j.garden.levels === 'object' ? j.garden.levels : null)
      if (typeof j?.accessRole === 'string' && j.accessRole) setRoleLabel(j.accessRole)
      if (j?.profile?.name) setDisplayName(String(j.profile.name))
      const roleKey = typeof j?.accessRole === 'string' && j.accessRole ? j.accessRole : (j?.isOwner ? 'admin' : null)
      // The saved copy wins over the device copy, but only on this first pass — after that the
      // user's own clicks are the truth.
      cachedJson('/api/access/prefs').then(p => {
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
  useEffect(() => { setDrawerOpen(false); setPaletteOpen(false); setMoreOpen(false) }, [path])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(v => !v) }
      if (e.key === 'Escape') { setPaletteOpen(false); setDrawerOpen(false); setMoreOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function signOut() {
    forgetCached('/api/access/me'); forgetCached('/api/access/prefs')
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const initials = (email || 'U').split('@')[0].split('.').map(s => s[0]?.toUpperCase()).slice(0, 2).join('') || 'U'

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

  // THE DESKS (lib/desks.ts). A view is drawn only if the person can open it; a desk shows only if
  // one of its views does, and links to the first of them. Users & admin (/users) is the admin
  // console, which gates itself, so it shows for admins only.
  const viewVisible = (v: DeskView) => v.to === '/users' ? isAdmin : canSee(v.to)
  const desks = DESKS.map(d => ({ desk: d, views: d.views.filter(viewVisible) })).filter(x => x.views.length > 0)
  const deskHit = deskForPath(path)
  const deskHere = deskHit ? desks.find(x => x.desk.key === deskHit.desk.key) || null : null
  const viewHere: DeskView | null = deskHit && deskHit.view && viewVisible(deskHit.view) ? deskHit.view : null

  function savePins(next: string[]) {
    setPins(next)
    writeLocal(PINS_LS_KEY, next)
    forgetCached('/api/access/prefs')
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
    const visible = (pins || []).filter(p => p.startsWith('/garden'))
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

  const currentLabel = business === 'garden' ? ((GARDEN_NAV.slice().sort((a, b) => b.to.length - a.to.length).find(g => path === g.to || (g.to !== '/garden' && !!path && path.startsWith(g.to + '/'))) || GARDEN_NAV[0]).label) : viewHere ? viewHere.label : (deskHit ? deskHit.desk.label : 'Lighthouse')

  // DUPLICATE PAGE TITLE (Jon, 2026-08-26: "how do we make it visible and concise"). On a phone the
  // app bar two inches above the content already says "Today in Ops", and then the page says it
  // again in 30px type with an eyebrow over it — about 86px of screen, on every screen, spent
  // repeating the bar. So: after each render, compare the page's own h1 with the bar's label and
  // mark it (plus a short eyebrow line above it) only when they MATCH. Pages whose heading says
  // something the bar does not — Command Center's "Mission Control" — keep their heading. The
  // class only hides under 640px; see globals.css. Actions that live beside the h1 (the Day sheet
  // link) are siblings, not children, so they survive.
  useEffect(() => {
    const norm = (v: string) => v.replace(/\s+/g, ' ').trim().toLowerCase()
    let dead = false
    const clear = () => { document.querySelectorAll('.lh-dupe-title').forEach(el => el.classList.remove('lh-dupe-title')) }
    const apply = () => {
      if (dead) return
      clear()
      const main = document.querySelector('main')
      if (!main) return
      const h1 = main.querySelector('h1')
      if (!h1 || norm(h1.textContent || '') !== norm(currentLabel)) return
      h1.classList.add('lh-dupe-title')
      // The eyebrow sits either right before the h1 or right before the row that wraps it.
      let prev = h1.previousElementSibling
      if (!prev && h1.parentElement) prev = h1.parentElement.previousElementSibling
      const txt = prev ? (prev.textContent || '').trim() : ''
      if (prev && prev.tagName === 'P' && txt.length > 0 && txt.length <= 40) prev.classList.add('lh-dupe-title')
    }
    // Three passes: the heading is usually in the first paint, but a page that renders its header
    // after a fetch would otherwise keep the duplicate forever.
    apply()
    const t1 = setTimeout(apply, 250)
    const t2 = setTimeout(apply, 1200)
    return () => { dead = true; clearTimeout(t1); clearTimeout(t2); clear() }
  }, [path, currentLabel])


  // THE BUSINESS DROPDOWN — under the logo, in the sidebar and the phone drawer.
  const bizSwitcher = (compact?: boolean) => {
    const cur = businessDef(business)
    const list = BUSINESSES.filter(b => (b.key === 'vr' && canSeeVr()) || (b.key === 'garden' && canSeeGarden()))
    if (list.length < 2) return null
    return (
      <div className={compact ? 'px-3 pb-2' : 'px-3 pb-2'}>
        <div className="relative">
          <button type="button" onClick={() => setBizOpen(o => !o)} aria-haspopup="listbox" aria-expanded={bizOpen}
            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-line bg-app/60 hover:bg-white hover:border-brand-200 text-left">
            {business === 'garden' ? <GARDEN_ICON size={14} className="text-brand-600" /> : <Building2 size={14} className="text-brand-600" />}
            <span className="flex-1 min-w-0">
              <span className="block text-[12.5px] font-semibold text-ink truncate">{cur.label}</span>
              <span className="block text-[10px] text-muted truncate">{cur.short}</span>
            </span>
            <ChevronDown size={14} className={'text-muted transition ' + (bizOpen ? 'rotate-180' : '')} />
          </button>
          {bizOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setBizOpen(false)} />
              <div role="listbox" className="absolute left-0 right-0 mt-1 z-50 rounded-xl border border-line bg-white shadow-lifted p-1">
                {list.map(b => (
                  <button key={b.key} type="button" role="option" aria-selected={b.key === business} onClick={() => switchBusiness(b.key)}
                    className={'w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left ' + (b.key === business ? 'bg-brand-50' : 'hover:bg-app')}>
                    {b.key === 'garden' ? <GARDEN_ICON size={14} className="text-brand-600" /> : <Building2 size={14} className="text-brand-600" />}
                    <span className="flex-1 min-w-0">
                      <span className="block text-[12.5px] font-semibold text-ink">{b.label}</span>
                      <span className="block text-[10px] text-muted">{b.short}</span>
                    </span>
                    {b.key === business ? <Check size={14} className="text-brand-600" /> : null}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  // ONE SIDEBAR FOR BOTH BUSINESSES (Jon, 2026-09-29: "It's not a completely different web app.
  // It's the same web app, same design"). The VR side lists its desks; the hotel keeps its own
  // sections and pinned band — only the pages behind them differ.
  const G = business === 'garden'
  const gActive = (to: string) => path === to || (to !== '/garden' && !!path && path.startsWith(to + '/'))
  const gardenSections: NavSection[] = GARDEN_SECTIONS.map(sc => ({ title: sc.title, items: sc.items.filter(it => gVisible(it.key)).map(it => ({ to: it.to, label: it.label, Icon: it.Icon })) })).filter(sc => sc.items.length > 0)
  const gardenPinned: NavItem[] = (pins || []).map(p => gardenNav.find(g => g.to === p)).filter(Boolean).map((g: any) => ({ to: g.to, label: g.label, Icon: g.Icon }))
  // The Jump box and the phone bar read the same list the sidebar does.
  const deskSections: NavSection[] = desks.map(x => ({ title: x.desk.label, items: x.views.map(v => ({ to: v.to, label: v.label, Icon: DESK_ICONS[x.desk.key] || Gauge })) }))

  const jumpBox = (onNavigate?: () => void) => (
    <button type="button" onClick={() => { setPaletteOpen(true); if (onNavigate) onNavigate() }} title="Jump to any page (Cmd/Ctrl-K)"
      className="w-full flex items-center gap-2.5 mb-2 px-3 py-2 rounded-xl border border-line bg-app/60 text-sm text-muted hover:bg-white hover:border-brand-200 transition-all">
      <Search size={15} />
      <span>Jump to…</span>
      <span className="ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded border border-line bg-white text-muted">⌘K</span>
    </button>
  )

  // THE DESKS, one row each. The hover says what the desk is for; the row opens the first page in it
  // the person can see. Admin sits apart at the bottom, behind its gear.
  const deskRow = (x: { desk: typeof DESKS[number]; views: DeskView[] }, onNavigate?: () => void) => {
    const Icon = DESK_ICONS[x.desk.key] || Gauge
    const active = !!deskHere && deskHere.desk.key === x.desk.key
    return (
      <Link key={x.desk.key} href={x.views[0].to} prefetch={false} onClick={onNavigate} title={x.desk.blurb}
        aria-current={active ? 'page' : undefined}
        className={`flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm font-medium transition-all ${active ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-app hover:text-ink'}`}>
        <Icon size={17} strokeWidth={active ? 2.25 : 2} className={active ? 'text-brand-600' : ''} />
        <span className="truncate">{x.desk.label}</span>
      </Link>
    )
  }
  // In the phone drawer each desk also lists its pages, because the strip is hidden on a phone —
  // the drawer is the whole map there.
  const deskPages = (x: { desk: typeof DESKS[number]; views: DeskView[] }, onNavigate?: () => void) => x.views.length < 2 ? null : (
    <div className="ml-9 mb-1 border-l border-line pl-2">
      {x.views.map(v => {
        const on = !!viewHere && viewHere.to === v.to
        return <Link key={v.to} href={v.to} prefetch={false} onClick={onNavigate} title={v.hint}
          className={'block px-2 py-1.5 rounded-md text-[13px] ' + (on ? 'text-brand-700 font-semibold bg-brand-50' : 'text-muted hover:text-ink hover:bg-app')}>{v.label}</Link>
      })}
    </div>
  )
  const vrNav = (onNavigate?: () => void, withPages?: boolean) => {
    const main = desks.filter(x => x.desk.key !== 'admin')
    const admin = desks.find(x => x.desk.key === 'admin')
    return (
      <>
        {jumpBox(onNavigate)}
        <div className="space-y-0.5">{main.map(x => <div key={x.desk.key}>{deskRow(x, onNavigate)}{withPages ? deskPages(x, onNavigate) : null}</div>)}</div>
        {admin ? <div className="mt-3 pt-3 border-t border-line">{deskRow(admin, onNavigate)}{withPages ? deskPages(admin, onNavigate) : null}</div> : null}
      </>
    )
  }

  const gardenNavBody = (onNavigate?: () => void) => (
    <>
      {jumpBox(onNavigate)}

      {(
        // YOUR TABS (Jon, 2026-08-19: "revamp the tabs on the side… a star section, called
        // something, maybe Your tabs"). Kept on the hotel side; the VR side has desks instead.
        <div className="rounded-xl bg-app/70 border border-line p-1.5 mb-2">
          <div className="px-2 pt-1 pb-1.5 text-[10px] uppercase tracking-wider font-bold text-ink/50 flex items-center gap-1.5">
            <Star size={11} className="fill-brand-200 text-brand-400" /> Your tabs
            <span className="ml-auto font-semibold normal-case tracking-normal text-[10px] text-muted/50">drag to reorder</span>
          </div>
          {gardenPinned.length === 0 && (
            <p className="px-2 pb-1.5 text-[11px] text-muted/70">Star any tab below and it moves up here — your own order, front and center.</p>
          )}
          {gardenPinned.map(({ to, label, Icon }, idx) => {
            const active = gActive(to)
            return (
              <div key={'pin-' + to} draggable
                onDragStart={() => { dragFrom.current = idx }}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); if (dragFrom.current != null) movePin(dragFrom.current, idx); dragFrom.current = null }}
                onDragEnd={() => { dragFrom.current = null }}
                title="Drag to reorder"
                className={`group flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-sm font-medium transition-all cursor-grab active:cursor-grabbing ${active ? 'bg-white shadow-sm text-brand-700' : 'text-ink/70 hover:bg-white/70 hover:text-ink'}`}>
                <Link href={to} prefetch={false} draggable={false} onClick={onNavigate} className="flex items-center gap-3 flex-1 min-w-0">
                  <Icon size={16} strokeWidth={active ? 2.25 : 2} className={active ? 'text-brand-600' : ''} />
                  <span className="truncate">{label}</span>
                </Link>
                <button type="button" title="Remove from Your tabs" aria-label={'Remove ' + label + ' from Your tabs'}
                  onClick={() => togglePin(to)} className="flex-shrink-0 text-brand-400 hover:text-brand-600">
                  <Star size={14} className="fill-brand-200" />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {gardenSections.map(section => {
        // A pinned tab leaves its group; a group with nothing left drops out of the list.
        const rest = section.items.filter(it => !isPinned(it.to))
        if (rest.length === 0) return null
        return (
          <div key={section.title}>
            <div className="mt-3.5 px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] font-bold text-muted/60">
              {section.title}
            </div>
            {rest.map((item) => {
              const { to, label, Icon } = item
              const active = gActive(item.to)
              const on = isPinned(to)
              return (
                <div key={to} className={`group flex items-center gap-2.5 px-2.5 py-[7px] rounded-lg text-sm font-medium transition-all ${active ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-app hover:text-ink'}`}>
                  <Link href={to} prefetch={false} onClick={onNavigate} className="flex items-center gap-3 flex-1 min-w-0">
                    <Icon size={16} strokeWidth={active ? 2.25 : 2} className={active ? 'text-brand-600' : ''} />
                    <span className="truncate">{label}</span>
                  </Link>
                  <button type="button" title={on ? 'Remove from Your tabs' : 'Add to Your tabs'} aria-label={(on ? 'Remove ' : 'Add ') + label}
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

  const navBody = (onNavigate?: () => void, withPages?: boolean) => G ? gardenNavBody(onNavigate) : vrNav(onNavigate, withPages)

  // THE DESK STRIP — the pages of the desk you are on, across the top. Secondary pages sit under
  // "More" (unless you are on one, then it shows inline so you can see where you are). A desk with
  // a single page draws no strip.
  const deskStrip = () => {
    if (!deskHere || deskHere.views.length < 2) return null
    // Full-height pages draw no strip: the Revenue App frame sizes itself to the window.
    if (viewHere && NO_STRIP.indexOf(viewHere.to) >= 0) return null
    const Icon = DESK_ICONS[deskHere.desk.key] || Gauge
    const inline = deskHere.views.filter(v => !v.more || (viewHere && viewHere.to === v.to))
    const extra = deskHere.views.filter(v => v.more && !(viewHere && viewHere.to === v.to))
    return (
      // Desktop and tablet only: on a phone the bottom bar and the drawer carry the desks and their
      // pages, and a wrapped strip would cost a hundred pixels of every screen.
      <div className="mb-4 -mt-1 hidden sm:flex items-center gap-2 flex-wrap">
        <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] font-bold text-muted/70 mr-1" title={deskHere.desk.blurb}>
          <Icon size={13} />{deskHere.desk.label}
        </div>
        <div className="inline-flex items-center rounded-xl border border-line bg-white p-0.5 overflow-x-auto max-w-full">
          {inline.map(v => {
            const on = !!viewHere && viewHere.to === v.to
            return <Link key={v.to} href={v.to} prefetch={false} title={v.hint} aria-current={on ? 'page' : undefined}
              className={'px-3 py-1.5 rounded-lg text-[13px] font-semibold whitespace-nowrap transition ' + (on ? 'bg-ink text-white' : 'text-muted hover:text-ink hover:bg-app')}>{v.label}</Link>
          })}
        </div>
        {extra.length > 0 && (
          <div className="relative">
            <button type="button" onClick={() => setMoreOpen(o => !o)} aria-haspopup="menu" aria-expanded={moreOpen}
              title={'More in ' + deskHere.desk.label + ': ' + extra.map(v => v.label).join(', ')}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-line bg-white text-[13px] font-semibold text-muted hover:text-ink">
              More <ChevronDown size={13} className={'transition ' + (moreOpen ? 'rotate-180' : '')} />
            </button>
            {moreOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
                <div role="menu" className="absolute right-0 mt-1 z-50 w-[240px] max-w-[80vw] rounded-xl border border-line bg-white shadow-lifted p-1">
                  {extra.map(v => (
                    <Link key={v.to} href={v.to} prefetch={false} role="menuitem" title={v.hint} onClick={() => setMoreOpen(false)}
                      className="block px-3 py-2 rounded-lg text-[13px] text-ink hover:bg-app">
                      <span className="font-semibold">{v.label}</span>
                      <span className="block text-[11px] text-muted leading-snug">{v.hint}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    // APP SHELL, NOT A LONG PAGE. This was min-h-screen, so the wrapper grew to the height of the
    // content and the WINDOW did the scrolling — which meant main's overflow-auto never engaged and
    // every position:sticky inside it silently did nothing (sticky binds to the nearest scrolling
    // ancestor, and that ancestor was not scrolling). h-screen makes main the real scroller, so the
    // sidebar stays put and sticky headers work on every page.
    <ShellMenu.Provider value={{ open: () => setDrawerOpen(true), full }}>
    <div className="h-screen overflow-hidden flex bg-app">
      {/* Sidebar — desktop only. Below lg the header + drawer + bottom bar take over. */}
      <aside className={full ? 'hidden' : 'hidden lg:flex w-60 bg-white border-r border-line flex-col'}>
        <div className="px-4 pt-5 pb-4 flex items-center gap-2.5">
          <img src="/icon-192.png" alt="Lighthouse" className="w-8 h-8 rounded-lg shadow-sm" />
          <span className="font-bold text-[15px] tracking-tight text-ink">LIGHTHOUSE</span>
        </div>
        {bizSwitcher()}
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
        <header className={(full ? 'hidden' : 'lg:hidden flex') + ' items-center gap-2 px-3 py-2 pt-safe-keep px-safe-keep bg-white border-b border-line flex-shrink-0'}>
          <button type="button" onClick={() => setDrawerOpen(true)} aria-label="Open menu"
            className="w-10 h-10 rounded-lg border border-line grid place-items-center text-muted hover:text-ink active:bg-app">
            <Menu size={18} />
          </button>
          <img src="/icon-192.png" alt="Lighthouse" className="w-7 h-7 rounded-lg shadow-sm" />
          <span className="font-semibold text-[15px] text-ink truncate">{currentLabel}</span>
          {canSee('/plan') && (
            <button type="button" onClick={() => openAddTask()} aria-label="Add a task"
              className="ml-auto w-10 h-10 rounded-lg bg-ink text-white grid place-items-center active:opacity-80">
              <Plus size={18} />
            </button>
          )}
          <button type="button" onClick={() => setPaletteOpen(true)} aria-label="Jump to a tab"
            className={(canSee('/plan') ? '' : 'ml-auto ') + 'w-10 h-10 rounded-lg border border-line grid place-items-center text-muted hover:text-ink active:bg-app'}>
            <Search size={17} />
          </button>
        </header>

        <main className="flex-1 overflow-auto overscroll-contain px-safe">
          {/* pb-24 on a phone: Eve's bubble floats above the bottom bar, and without room to scroll
              past it the last row of every board sits permanently under a 56px circle. */}
          <div className={full ? 'h-full min-h-full' : 'max-w-[1600px] mx-auto px-3 pt-4 pb-24 sm:p-6 lg:p-8 animate-fade-in'}>
            {!G && !full ? deskStrip() : null}
            {children}
          </div>
        </main>

        {/* Eve rides along on every page (Jon, 2026-08-19: floating icon, not a page). Same
            role gate the old sidebar entry used — a role with eve 'off' never sees the bubble. */}
        {business === 'garden' ? <AdamFloat /> : (canSee('/eve') && <EveFloat />)}

        {/* One mount for the whole app; openAddTask() from anywhere raises it. */}
        {canSee('/plan') && <AddTaskHost />}

        {/* Mobile bottom bar — the first four desks (the hotel: its first four pages). One thumb.
            It renders unconditionally: it used to be gated on `pinned.length > 0`, which meant a
            person whose pins had not loaded yet (or whose role could see none of the daily six)
            got a phone with no navigation at all except the hamburger. "More" alone is still
            navigation. pb-safe keeps the labels off the iPhone home indicator, which viewport-fit
            cover otherwise draws straight through. */}
        <nav className={(full ? 'hidden' : 'lg:hidden flex') + ' flex-shrink-0 border-t border-line bg-white items-stretch pb-safe px-safe'}>
          {(business === 'garden' ? gardenNav.slice(0, 4) : desks.filter(x => x.desk.key !== 'admin').slice(0, 4).map(x => ({ to: x.views[0].to, label: DESK_SHORT[x.desk.key] || x.desk.label, Icon: DESK_ICONS[x.desk.key] || Gauge, key: x.desk.key }))).map(({ to, label, Icon, key }: any) => {
            const active = business === 'garden' ? (path === to || (to !== '/garden' && !!path && path.startsWith(to + '/'))) : !!deskHere && deskHere.desk.key === key
            return (
              <Link key={'bb-' + to} href={to} prefetch={false}
                className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-semibold ${active ? 'text-brand-600' : 'text-muted'}`}>
                <Icon size={20} strokeWidth={active ? 2.25 : 2} />
                <span className="truncate max-w-full px-1">{label}</span>
              </Link>
            )
          })}
          <button type="button" onClick={() => setDrawerOpen(true)} aria-label="More tabs"
            className="flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-semibold text-muted">
            <Menu size={20} />
            <span>More</span>
          </button>
        </nav>
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className={(full ? '' : 'lg:hidden ') + 'fixed inset-0 z-50'} role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setDrawerOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-[86%] max-w-[320px] bg-white shadow-lifted flex flex-col pt-safe pb-safe">
            <div className="px-4 pt-4 pb-3 flex items-center gap-2.5 border-b border-line">
              <img src="/icon-192.png" alt="Lighthouse" className="w-7 h-7 rounded-lg shadow-sm" />
              <span className="font-bold text-sm tracking-tight text-ink">LIGHTHOUSE</span>
              <button type="button" onClick={() => setDrawerOpen(false)} aria-label="Close menu"
                className="ml-auto w-8 h-8 rounded-lg grid place-items-center text-muted hover:text-ink">
                <X size={17} />
              </button>
            </div>
            <div className="pt-2">{bizSwitcher(true)}</div>
            <nav className="flex-1 px-2 py-2 space-y-0.5 overflow-y-auto">
              {navBody(() => setDrawerOpen(false), true)}
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

      {paletteOpen && <JumpPalette sections={G ? gardenSections : deskSections} onClose={() => setPaletteOpen(false)} />}
    </div>
    </ShellMenu.Provider>
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
