'use client'
// GuideView - the guest-facing property page (/guide/<slug>) and its in-place editor.
//
// Guests get a read-only promo page: what is on this week, where to eat, the menu, what guests
// say, things to do, a map and who to call. Admins open the SAME url with ?admin=1, type the
// StayBoard admin password, and every line on the page becomes editable, with add/remove on every
// list and a hide toggle on every section. One Save writes the whole document back.
//
// Styling is driven by CSS variables so a second property can look completely different from a
// single theme object in lib/guide.ts.
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  occurrencesIn, todayIso, dayLabel, shortDate, monthLabel, shiftMonth, monthOfIso,
  daysInMonth, firstOfMonth, dowOfIso, runsOn, inferSchedule, repeatLabel, windowOf, nowMinutes,
  menuWindow, openMenuGroups, type MenuGroup,
  DOW_SHORT, DOW_NAMES, type Guide, type Activation, type Occurrence,
} from '@/lib/guide'

const SERIF = "'Playfair Display', Georgia, 'Times New Roman', serif"

const GUIDE_CSS = [
  '@import url("https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&family=Inter:wght@400;500;600;700&display=swap");',
  '.gd-card{background:#fff;border:1px solid rgba(22,32,75,.10);border-radius:20px}',
  '.gd-shadow{box-shadow:0 18px 40px -28px rgba(14,21,51,.55)}',
  '.gd-link{color:var(--ink);text-decoration:none;border-bottom:1px solid rgba(22,32,75,.25)}',
  '.gd-tap{transition:box-shadow .15s,transform .15s,border-color .15s}',
  '.gd-tap:hover{border-color:var(--leaf);box-shadow:0 12px 30px -22px rgba(14,21,51,.6);transform:translateY(-1px)}',
  'html{scroll-behavior:smooth}',
  '@media print{.gd-noprint{display:none!important}}',
].join('')

type Path = (string | number)[]

function setIn(obj: any, path: Path, val: any): any {
  if (!path.length) return val
  const k: any = path[0]
  const copy: any = Array.isArray(obj) ? obj.slice() : { ...(obj || {}) }
  copy[k] = setIn(copy[k], path.slice(1), val)
  return copy
}

function getIn(obj: any, path: Path): any {
  let cur: any = obj
  for (const k of path) { if (cur == null) return undefined; cur = cur[k as any] }
  return cur
}

const telHref = (p: string) => 'tel:' + String(p || '').replace(/[^0-9+]/g, '')

// How many upcoming occurrences show before "See more".
const SHOW_N = 6
const hhmmLabel = (n: number) => {
  const h = Math.floor(n / 60); const m = n % 60
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return h12 + (m ? ':' + (m < 10 ? '0' + m : String(m)) : '') + ' ' + ampm
}
function tabStyle(on: boolean): any {
  return { borderRadius: 999, padding: '6px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: on ? 'var(--ink)' : 'transparent', color: on ? '#fff' : 'rgba(22,32,75,.7)' }
}
const selStyle: any = { background: '#fff', border: '1px solid rgba(22,32,75,.2)', borderRadius: 8, padding: '4px 8px', fontSize: 13, color: 'inherit', font: 'inherit' }

// ---- editable primitives (module scope so typing never remounts them) --------------------------
function Ed({ v, on, ph, cls, style, area, rows }: { v: string; on: (s: string) => void; ph?: string; cls?: string; style?: any; area?: boolean; rows?: number }) {
  const base: any = {
    width: '100%', background: 'rgba(255,255,255,.9)', border: '1px dashed rgba(22,32,75,.35)',
    borderRadius: 8, padding: '4px 8px', font: 'inherit', color: 'inherit', outline: 'none', ...(style || {}),
  }
  if (area) return <textarea value={v || ''} rows={rows || 3} placeholder={ph} onChange={e => on(e.target.value)} className={cls} style={base} />
  return <input value={v || ''} placeholder={ph} onChange={e => on(e.target.value)} className={cls} style={base} />
}

function Btn({ children, onClick, tone }: { children: any; onClick: () => void; tone?: 'ghost' | 'solid' | 'danger' }) {
  const styles: any = {
    ghost: { background: 'rgba(255,255,255,.9)', color: 'var(--ink)', border: '1px solid rgba(22,32,75,.2)' },
    solid: { background: 'var(--ink)', color: '#fff', border: '1px solid var(--ink)' },
    danger: { background: '#fff', color: '#b42318', border: '1px solid rgba(180,35,24,.3)' },
  }
  return (
    <button type="button" onClick={onClick}
      style={{ ...(styles[tone || 'ghost']), borderRadius: 999, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
      {children}
    </button>
  )
}

function Eyebrow({ children }: { children: any }) {
  return <div style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--leaf)' }}>{children}</div>
}

// ---- main -------------------------------------------------------------------------------------
export function GuideView({ slug, initial, canEdit: canEditInit }: { slug: string; initial: Guide; canEdit: boolean }) {
  const [g, setG] = useState<Guide>(initial)
  const [canEdit, setCanEdit] = useState(canEditInit)
  const [edit, setEdit] = useState(false)
  const [askPw, setAskPw] = useState(false)
  const [pw, setPw] = useState('')
  const [pwErr, setPwErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [copied, setCopied] = useState(false)
  const [liveQuotes, setLiveQuotes] = useState<{ text: string; who: string; source: string; date: string }[]>([])
  // A photo URL can die without warning (they are hosted off-property). Record the failure and
  // drop the frame rather than printing a broken-image icon on a page we send to guests.
  const [badImg, setBadImg] = useState<string[]>([])
  const imgOk = (u?: string) => !!u && badImg.indexOf(u) < 0
  const imgFailed = (u?: string) => { if (u) setBadImg(b => b.indexOf(u) < 0 ? b.concat(u) : b) }
  // Calendar state. `today` is the property's date (America/New_York), fixed for the render.
  const today = useMemo(() => todayIso(), [])
  const [calOpen, setCalOpen] = useState(false)
  const [calMonth, setCalMonth] = useState<string>(() => monthOfIso(todayIso()))
  const [pickDay, setPickDay] = useState('')
  // Clock for the "happening now" badge. Starts at -1 so the server and the first client render
  // agree; it fills in after mount and ticks every minute.
  const [nowMin, setNowMin] = useState(-1)
  useEffect(() => {
    setNowMin(nowMinutes())
    const t = setInterval(() => setNowMin(nowMinutes()), 60000)
    return () => clearInterval(t)
  }, [])

  const t = g.theme || {}
  const vars: any = {
    ['--ink']: t.ink || '#16204B',
    ['--deep']: t.deep || '#0E1533',
    ['--leaf']: t.leaf || '#5C8A4A',
    ['--sand']: t.sand || '#F5F1E8',
    ['--accent']: t.accent || '#C9A227',
  }

  const set = useCallback((path: Path, val: any) => { setG(prev => setIn(prev, path, val)); setMsg('') }, [])
  const omit: string[] = Array.isArray(g.omit) ? g.omit : []
  const hidden = (k: string) => omit.indexOf(k) >= 0
  const toggle = (k: string) => set(['omit'], hidden(k) ? omit.filter(x => x !== k) : omit.concat(k))

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (new URLSearchParams(window.location.search).get('admin') === '1' && !canEdit) setAskPw(true)
  }, [canEdit])

  // Guest quotes: if nobody has pinned any, pull real ones from the reviews we already hold.
  const qKeywords = (g.quotes && g.quotes.keywords) || []
  const qPinned = (g.quotes && g.quotes.items) || []
  useEffect(() => {
    if (hidden('quotes')) return
    if (qPinned.length || !(g.quotes && g.quotes.auto)) return
    const url = '/api/public/guide?slug=' + encodeURIComponent(slug) + '&quotes=1&limit=6'
      + (qKeywords.length ? '&keywords=' + encodeURIComponent(qKeywords.join(',')) : '')
    fetch(url, { cache: 'no-store' }).then(r => r.json()).then(j => { if (j && j.ok) setLiveQuotes(j.items || []) }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, qPinned.length])

  const quotes = qPinned.length ? qPinned : liveQuotes

  async function unlock() {
    setBusy(true); setPwErr('')
    try {
      const r = await fetch('/api/public/guide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, action: 'unlock', password: pw }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { setPwErr(j.error || 'Wrong password'); setBusy(false); return }
      setCanEdit(true); setAskPw(false); setEdit(true); setPw('')
    } catch (e: any) { setPwErr(String(e?.message || e)) }
    setBusy(false)
  }

  async function save() {
    setBusy(true); setMsg('')
    try {
      const r = await fetch('/api/public/guide', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug, content: g }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { setMsg(j.error || 'Could not save'); setBusy(false); return }
      if (j.content) setG(j.content)
      setMsg('Saved')
    } catch (e: any) { setMsg(String(e?.message || e)) }
    setBusy(false)
  }

  async function pullQuotes() {
    setBusy(true)
    try {
      const url = '/api/public/guide?slug=' + encodeURIComponent(slug) + '&quotes=1&limit=8'
        + (qKeywords.length ? '&keywords=' + encodeURIComponent(qKeywords.join(',')) : '')
      const r = await fetch(url, { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (j && j.ok) set(['quotes', 'items'], (j.items || []))
    } catch { /* ignore */ }
    setBusy(false)
  }

  function copyLink() {
    try {
      navigator.clipboard.writeText(window.location.origin + '/guide/' + slug)
      setCopied(true); setTimeout(() => setCopied(false), 1600)
    } catch { /* ignore */ }
  }

  const push = (path: Path, item: any) => { const arr = (getIn(g, path) as any[]) || []; set(path, arr.concat([item])) }
  const drop = (path: Path, i: number) => { const arr = (getIn(g, path) as any[]) || []; set(path, arr.filter((_, k) => k !== i)) }
  const move = (path: Path, i: number, d: number) => {
    const arr = ((getIn(g, path) as any[]) || []).slice()
    const j = i + d
    if (j < 0 || j >= arr.length) return
    const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp
    set(path, arr)
  }

  // ---- calendar derivations -------------------------------------------------------------------
  const acts: Activation[] = (g.activations && g.activations.items) || []
  // Everyday things (happy hour) get ONE "every day" block. Repeating them as a card per day
  // is noise - the dated cards are for what is special about a given day.
  const dailyActs = acts.filter(a => inferSchedule(a).repeat === 'daily' && runsOn(a, today))
  const datedActs = acts.filter(a => inferSchedule(a).repeat !== 'daily')
  // The cards are THIS WEEK only (today + 6 days). Everything beyond that lives in the calendar,
  // so the page never turns into a scroll of a hundred repeats.
  const week: Occurrence[] = useMemo(() => occurrencesIn(datedActs, today, 7), [acts, today])
  const dayList: Occurrence[] = useMemo(
    () => (pickDay ? occurrencesIn(acts, pickDay, 1) : []),
    [acts, pickDay],
  )
  // Six cards, variety first: one per event in date order, then the soonest repeats fill any gap.
  const weekCards: Occurrence[] = useMemo(() => {
    const used: number[] = []
    const picked: Occurrence[] = []
    for (const o of week) {
      if (used.indexOf(o.idx) >= 0) continue
      used.push(o.idx); picked.push(o)
      if (picked.length >= SHOW_N) break
    }
    if (picked.length < SHOW_N) {
      for (const o of week) {
        if (picked.indexOf(o) >= 0) continue
        picked.push(o)
        if (picked.length >= SHOW_N) break
      }
    }
    return picked.sort((a, b) => (a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : a.mins - b.mins))
  }, [week])
  const visible: Occurrence[] = pickDay ? dayList : weekCards
  const groupedUpcoming: { iso: string; items: Occurrence[] }[] = []
  for (const o of visible) {
    const last = groupedUpcoming[groupedUpcoming.length - 1]
    if (last && last.iso === o.iso) last.items.push(o)
    else groupedUpcoming.push({ iso: o.iso, items: [o] })
  }
  const monthCells: string[] = useMemo(() => {
    const first = firstOfMonth(calMonth)
    const cells: string[] = []
    for (let i = 0; i < dowOfIso(first); i++) cells.push('')
    const n = daysInMonth(calMonth)
    for (let d = 1; d <= n; d++) cells.push(calMonth + '-' + (d < 10 ? '0' + d : String(d)))
    return cells
  }, [calMonth])
  const byDay: Record<string, Occurrence[]> = useMemo(() => {
    const m: Record<string, Occurrence[]> = {}
    for (const o of occurrencesIn(acts, firstOfMonth(calMonth), daysInMonth(calMonth))) {
      if (!m[o.iso]) m[o.iso] = []
      m[o.iso].push(o)
    }
    return m
  }, [acts, calMonth])

  // ---- menu: open what is being served right now, keep the rest folded --------------------------
  const menuGroups: MenuGroup[] = (g.menu && g.menu.groups) || []
  const autoMenu = useMemo(() => openMenuGroups(menuGroups, nowMin), [menuGroups, nowMin])
  const [menuPick, setMenuPick] = useState<number[] | null>(null)
  const menuOpenIdx = menuPick || autoMenu
  function toggleMenu(i: number) {
    const cur = menuPick || autoMenu
    setMenuPick(cur.indexOf(i) >= 0 ? cur.filter(x => x !== i) : cur.concat(i))
  }

  // Maps link for a nearby place: the name plus the property's city, so "Las Olas Boulevard"
  // lands in the right Fort Lauderdale rather than somewhere else.
  const cityHint = String((g.place && (g.place.address || g.place.mapQuery)) || '').split(',').slice(1).join(',').trim()
  const mapSearch = (name: string) =>
    'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(String(name || '') + (cityHint ? ', ' + cityHint : ''))

  const actAt = (i: number): Activation => (acts[i] || ({} as Activation))
  // The calendar floats over the page, so opening it never shifts what is under it.
  function openCal() { setCalMonth(monthOfIso(pickDay || today)); setCalOpen(true) }
  function addActivation(dateIso: string) {
    const base: Activation = dateIso
      ? { day: shortDate(dateIso), time: '6 PM', name: 'New activation', where: '', desc: '', repeat: 'once', date: dateIso, at: '18:00' }
      : { day: 'Saturday', time: '6 PM', name: 'New activation', where: '', desc: '', repeat: 'weekly', dow: 6, at: '18:00' }
    push(['activations', 'items'], base)
    setCalOpen(false)
  }
  // Writing the schedule also keeps `day` in step, so the wording and the calendar can never disagree.
  function setRepeat(i: number, v: string) {
    const it = actAt(i); const s = inferSchedule(it)
    if (v === 'daily') set(['activations', 'items', i], { ...it, repeat: 'daily', day: 'Daily' })
    else if (v === 'weekly') { const d = s.dow >= 0 ? s.dow : 6; set(['activations', 'items', i], { ...it, repeat: 'weekly', dow: d, day: DOW_NAMES[d] }) }
    else { const date = s.date || pickDay || today; set(['activations', 'items', i], { ...it, repeat: 'once', date, day: shortDate(date) }) }
  }
  function setDow(i: number, d: number) {
    set(['activations', 'items', i], { ...actAt(i), repeat: 'weekly', dow: d, day: DOW_NAMES[d] })
  }
  function setOnce(i: number, date: string) {
    set(['activations', 'items', i], { ...actAt(i), repeat: 'once', date, day: date ? shortDate(date) : '' })
  }

  const nav = useMemo(() => ([
    { id: 'week', label: 'This week', on: !hidden('activations') },
    { id: 'dine', label: 'Eat and drink', on: !hidden('venues') },
    { id: 'menu', label: 'Menu', on: !hidden('menu') },
    { id: 'do', label: 'Things to do', on: !hidden('todo') },
    { id: 'map', label: 'Getting around', on: !hidden('place') },
  ].filter(x => x.on)), [omit.join(',')])

  const SectionHead = ({ id, k, title, note }: { id?: string; k: string; title: string; note?: string }) => (
    <div id={id} style={{ scrollMarginTop: 80 }} className="mb-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <Eyebrow>{k === 'activations' ? 'On the calendar' : k === 'venues' ? 'Dining' : k === 'menu' ? 'Tasting notes' : k === 'quotes' ? 'In their words' : k === 'todo' ? 'Explore' : k === 'gallery' ? 'Gallery' : k === 'place' ? 'Location' : k === 'contact' ? 'Contact' : 'Details'}</Eyebrow>
          {edit
            ? <Ed v={title} on={s => set([k, 'title'], s)} style={{ fontFamily: SERIF, fontSize: 30, marginTop: 6 }} />
            : <h2 style={{ fontFamily: SERIF, fontSize: 32, lineHeight: 1.15, color: 'var(--ink)', marginTop: 6 }}>{title}</h2>}
          {edit
            ? <div className="mt-2"><Ed v={note || ''} ph="Optional note" on={s => set([k, 'note'], s)} style={{ fontSize: 14 }} /></div>
            : (note ? <p className="mt-2 text-[15px]" style={{ color: 'rgba(22,32,75,.65)', maxWidth: 720 }}>{note}</p> : null)}
        </div>
        {edit ? <Btn onClick={() => toggle(k)} tone="ghost">{hidden(k) ? 'Show' : 'Hide'} section</Btn> : null}
      </div>
    </div>
  )

  const wrap = 'mx-auto w-full max-w-6xl px-5 sm:px-8'

  return (
    <div style={{ ...vars, background: 'var(--sand)', minHeight: '100vh', color: 'var(--ink)' }}>
      {/* dangerouslySetInnerHTML, not a text child: React escapes quotes in a <style> child, which
          breaks the @import and produces a server/client hydration mismatch. */}
      <style dangerouslySetInnerHTML={{ __html: GUIDE_CSS }} />

      {/* top bar */}
      <div style={{ position: 'sticky', top: 0, zIndex: 40, background: 'rgba(255,255,255,.86)', backdropFilter: 'blur(10px)', borderBottom: '1px solid rgba(22,32,75,.08)' }}>
        <div className={wrap + ' flex items-center gap-4 py-3'}>
          <div className="font-semibold tracking-tight" style={{ fontFamily: SERIF, fontSize: 18 }}>{g.hero?.eyebrow ? String(g.hero.eyebrow).split(' - ')[0] : 'Your stay'}</div>
          <nav className="hidden md:flex items-center gap-5 text-[13px]" style={{ color: 'rgba(22,32,75,.7)' }}>
            {nav.map(n => <a key={n.id} href={'#' + n.id} style={{ textDecoration: 'none', color: 'inherit' }}>{n.label}</a>)}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            {canEdit ? (
              <>
                <Btn onClick={() => setEdit(!edit)} tone={edit ? 'solid' : 'ghost'}>{edit ? 'Editing' : 'Edit page'}</Btn>
                {edit ? <Btn onClick={save} tone="solid">{busy ? 'Saving...' : 'Save'}</Btn> : null}
                <Btn onClick={copyLink}>{copied ? 'Copied' : 'Guest link'}</Btn>
              </>
            ) : (
              <a href={(g.hero?.ctas && g.hero.ctas[0]?.url) || '#dine'} target="_blank" rel="noreferrer"
                style={{ background: 'var(--ink)', color: '#fff', borderRadius: 999, padding: '7px 16px', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>
                {(g.hero?.ctas && g.hero.ctas[0]?.label) || 'Reserve'}
              </a>
            )}
          </div>
        </div>
        {msg ? <div className={wrap + ' pb-2 text-[12px]'} style={{ color: msg === 'Saved' ? 'var(--leaf)' : '#b42318' }}>{msg}</div> : null}
      </div>

      {/* password */}
      {askPw ? (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(14,21,51,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div className="gd-card gd-shadow" style={{ maxWidth: 380, width: '100%', padding: 24 }}>
            <Eyebrow>Admin</Eyebrow>
            <h3 style={{ fontFamily: SERIF, fontSize: 24, margin: '6px 0 4px' }}>Unlock editing</h3>
            <p className="text-sm" style={{ color: 'rgba(22,32,75,.6)' }}>Use the Lighthouse admin password. Guests never see this.</p>
            <input type="password" value={pw} onChange={e => setPw(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') unlock() }}
              placeholder="Admin password" autoFocus
              style={{ width: '100%', marginTop: 14, padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(22,32,75,.2)', outline: 'none' }} />
            {pwErr ? <div className="text-[13px] mt-2" style={{ color: '#b42318' }}>{pwErr}</div> : null}
            <div className="flex gap-2 mt-4">
              <Btn onClick={unlock} tone="solid">{busy ? 'Checking...' : 'Unlock'}</Btn>
              <Btn onClick={() => setAskPw(false)}>Cancel</Btn>
            </div>
          </div>
        </div>
      ) : null}

      {/* hero */}
      <header style={{ position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, background: g.hero?.image ? 'url(' + g.hero.image + ') center/cover no-repeat' : 'linear-gradient(120deg,var(--ink),var(--leaf))' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(14,21,51,.35) 0%, rgba(14,21,51,.62) 55%, rgba(14,21,51,.85) 100%)' }} />
        <div className={wrap} style={{ position: 'relative', paddingTop: 88, paddingBottom: 72, color: '#fff' }}>
          <div style={{ maxWidth: 760 }}>
            {edit
              ? <Ed v={g.hero?.eyebrow || ''} on={s => set(['hero', 'eyebrow'], s)} ph="Eyebrow" style={{ color: '#16204B', maxWidth: 460 }} />
              : <div style={{ fontSize: 12, letterSpacing: '.2em', textTransform: 'uppercase', fontWeight: 700, color: 'rgba(255,255,255,.85)' }}>{g.hero?.eyebrow}</div>}
            {edit
              ? <div className="mt-3"><Ed v={g.hero?.title || ''} on={s => set(['hero', 'title'], s)} area rows={2} style={{ color: '#16204B', fontFamily: SERIF, fontSize: 30 }} /></div>
              : <h1 style={{ fontFamily: SERIF, fontSize: 52, lineHeight: 1.05, marginTop: 14, letterSpacing: '-.01em' }}>{g.hero?.title}</h1>}
            {edit
              ? <div className="mt-3"><Ed v={g.hero?.subtitle || ''} on={s => set(['hero', 'subtitle'], s)} area rows={3} style={{ color: '#16204B' }} /></div>
              : <p style={{ fontSize: 18, lineHeight: 1.6, marginTop: 16, color: 'rgba(255,255,255,.92)', maxWidth: 640 }}>{g.hero?.subtitle}</p>}

            <div className="flex flex-wrap gap-2 mt-7">
              {(g.hero?.chips || []).map((c, i) => (
                <span key={i} style={{ background: 'rgba(255,255,255,.14)', border: '1px solid rgba(255,255,255,.28)', color: '#fff', borderRadius: 999, padding: '6px 14px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {edit ? <Ed v={c} on={s => set(['hero', 'chips', i], s)} style={{ width: 150, background: 'rgba(255,255,255,.92)', color: '#16204B' }} /> : c}
                  {edit ? <button type="button" onClick={() => drop(['hero', 'chips'], i)} style={{ color: '#fff', opacity: .8 }}>x</button> : null}
                </span>
              ))}
              {edit ? <Btn onClick={() => push(['hero', 'chips'], 'New highlight')}>+ highlight</Btn> : null}
            </div>

            <div className="flex flex-wrap gap-3 mt-8 items-center">
              {(g.hero?.ctas || []).map((c, i) => (
                <span key={i} className="inline-flex items-center gap-2">
                  {edit ? (
                    <span className="inline-flex gap-1">
                      <Ed v={c.label} on={s => set(['hero', 'ctas', i, 'label'], s)} ph="Label" style={{ width: 150 }} />
                      <Ed v={c.url} on={s => set(['hero', 'ctas', i, 'url'], s)} ph="https://" style={{ width: 220 }} />
                      <Btn onClick={() => drop(['hero', 'ctas'], i)} tone="danger">Remove</Btn>
                    </span>
                  ) : (
                    <a href={c.url} target="_blank" rel="noreferrer"
                      style={{ background: i === 0 ? '#fff' : 'transparent', color: i === 0 ? 'var(--ink)' : '#fff', border: '1px solid ' + (i === 0 ? '#fff' : 'rgba(255,255,255,.5)'), borderRadius: 999, padding: '11px 24px', fontWeight: 600, fontSize: 15, textDecoration: 'none' }}>
                      {c.label}
                    </a>
                  )}
                </span>
              ))}
              {edit ? <Btn onClick={() => push(['hero', 'ctas'], { label: 'Button', url: 'https://' })}>+ button</Btn> : null}
            </div>
            {edit ? <div className="mt-4" style={{ maxWidth: 620 }}><Ed v={g.hero?.image || ''} on={s => set(['hero', 'image'], s)} ph="Hero image URL" /></div> : null}
          </div>
        </div>
      </header>

      {/* quick info */}
      {!hidden('quick') || edit ? (
        <section className={wrap} style={{ marginTop: -40, position: 'relative', zIndex: 10 }}>
          <div className="gd-card gd-shadow" style={{ padding: 24 }}>
            <div className="flex items-center justify-between gap-3 mb-4">
              {edit ? <Ed v={g.quick?.title || ''} on={s => set(['quick', 'title'], s)} style={{ maxWidth: 280, fontWeight: 700 }} />
                : <Eyebrow>{g.quick?.title}</Eyebrow>}
              {edit ? <div className="flex gap-2"><Btn onClick={() => push(['quick', 'items'], { label: 'Label', value: 'Value', note: '' })}>+ item</Btn><Btn onClick={() => toggle('quick')}>{hidden('quick') ? 'Show' : 'Hide'}</Btn></div> : null}
            </div>
            <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
              {(g.quick?.items || []).map((it, i) => (
                <div key={i} style={{ borderLeft: '2px solid var(--leaf)', paddingLeft: 14 }}>
                  {edit ? (
                    <div className="space-y-1">
                      <Ed v={it.label} on={s => set(['quick', 'items', i, 'label'], s)} ph="Label" />
                      <Ed v={it.value} on={s => set(['quick', 'items', i, 'value'], s)} ph="Value" />
                      <Ed v={it.note || ''} on={s => set(['quick', 'items', i, 'note'], s)} ph="Note" />
                      <Btn onClick={() => drop(['quick', 'items'], i)} tone="danger">Remove</Btn>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: 'rgba(22,32,75,.5)', fontWeight: 700 }}>{it.label}</div>
                      <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{it.value}</div>
                      {it.note ? <div style={{ fontSize: 13, color: 'rgba(22,32,75,.6)', marginTop: 2 }}>{it.note}</div> : null}
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* activations - real dates, driven by each item's schedule */}
      {!hidden('activations') || edit ? (
        <section className={wrap} style={{ paddingTop: 64 }}>
          <SectionHead id="week" k="activations" title={g.activations?.title || ''} note={g.activations?.note} />

          <div className="flex flex-wrap items-center gap-2 mb-5">
            <div style={{ display: 'inline-flex', background: '#fff', border: '1px solid rgba(22,32,75,.12)', borderRadius: 999, padding: 3 }}>
              <button type="button" onClick={() => { setCalOpen(false); setPickDay('') }} style={tabStyle(!calOpen && !pickDay)}>This week</button>
              <button type="button" onClick={openCal} style={tabStyle(calOpen || !!pickDay)}>Calendar</button>
            </div>
            {pickDay ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--ink)', color: '#fff', borderRadius: 999, padding: '6px 14px', fontSize: 13, fontWeight: 600 }}>
                {dayLabel(pickDay, today)}
                <button type="button" onClick={() => setPickDay('')} style={{ color: '#fff', opacity: .75 }}>x</button>
              </span>
            ) : null}
            {edit ? <Btn onClick={() => addActivation(pickDay)} tone="solid">+ Add{pickDay ? ' on ' + shortDate(pickDay) : ' an activation'}</Btn> : null}
          </div>

          {/* month calendar - floats over the page so nothing below it jumps */}
          {calOpen ? (
            <div onClick={() => setCalOpen(false)}
              style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(14,21,51,.5)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
              <div className="gd-card gd-shadow" onClick={e => e.stopPropagation()}
                style={{ padding: 18, width: '100%', maxWidth: 760, maxHeight: '88vh', overflowY: 'auto' }}>
              <div className="flex items-center justify-between mb-3">
                <Btn onClick={() => setCalMonth(shiftMonth(calMonth, -1))}>Prev</Btn>
                <div style={{ fontFamily: SERIF, fontSize: 21 }}>{monthLabel(calMonth)}</div>
                <div className="flex gap-2">
                  <Btn onClick={() => { setCalMonth(monthOfIso(today)); setPickDay(today); setCalOpen(false) }}>Today</Btn>
                  <Btn onClick={() => setCalMonth(shiftMonth(calMonth, 1))}>Next</Btn>
                  <Btn onClick={() => setCalOpen(false)} tone="solid">Close</Btn>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-1">
                {DOW_SHORT.map(d => (
                  <div key={d} style={{ fontSize: 10.5, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700, color: 'rgba(22,32,75,.45)', textAlign: 'center', paddingBottom: 4 }}>{d}</div>
                ))}
                {monthCells.map((iso, i) => {
                  if (!iso) return <div key={'b' + i} />
                  const evs = byDay[iso] || []
                  const isToday = iso === today
                  const isPick = iso === pickDay
                  const past = iso < today
                  return (
                    <button key={iso} type="button" onClick={() => { setPickDay(isPick ? '' : iso); setCalOpen(false) }}
                      style={{
                        textAlign: 'left', minHeight: 76, borderRadius: 12, padding: '6px 7px',
                        border: '1px solid ' + (isPick ? 'var(--ink)' : isToday ? 'var(--leaf)' : 'rgba(22,32,75,.10)'),
                        background: isPick ? 'var(--ink)' : (past ? 'rgba(22,32,75,.03)' : '#fff'),
                        color: isPick ? '#fff' : 'inherit', opacity: past && !isToday && !isPick ? .6 : 1, cursor: 'pointer',
                      }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: isPick ? '#fff' : (isToday ? 'var(--leaf)' : 'rgba(22,32,75,.6)') }}>
                        {Number(iso.slice(8, 10))}
                      </div>
                      {evs.slice(0, 2).map((o, k) => (
                        <div key={k} style={{ fontSize: 10.5, lineHeight: 1.25, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: isPick ? 'rgba(255,255,255,.9)' : 'var(--ink)' }}>
                          <span style={{ display: 'inline-block', width: 5, height: 5, borderRadius: 999, background: isPick ? '#fff' : 'var(--leaf)', marginRight: 4, verticalAlign: 'middle' }} />
                          {o.item.name}
                        </div>
                      ))}
                      {evs.length > 2 ? <div style={{ fontSize: 10, marginTop: 2, color: isPick ? 'rgba(255,255,255,.75)' : 'rgba(22,32,75,.5)' }}>+{evs.length - 2} more</div> : null}
                    </button>
                  )
                })}
              </div>
              <p className="text-[12px] mt-3" style={{ color: 'rgba(22,32,75,.55)' }}>
                {edit
                  ? 'Tap a date to see that day, then use Add to drop a one-off on it. Weekly events keep repeating on their own.'
                  : 'Tap any date to see what is on that day.'}
              </p>
              </div>
            </div>
          ) : null}

          {/* editor: every activation with its schedule */}
          {edit ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(g.activations?.items || []).map((it, i) => {
                if (pickDay && !runsOn(it, pickDay)) return null
                const sch = inferSchedule(it)
                return (
                  <div key={i} className="gd-card" style={{ padding: 18 }}>
                    <div className="space-y-1.5">
                      <Ed v={it.name} on={s => set(['activations', 'items', i, 'name'], s)} ph="Event" />
                      <div className="flex gap-1.5">
                        <select value={sch.repeat} onChange={e => setRepeat(i, e.target.value)} style={selStyle}>
                          <option value="daily">Every day</option>
                          <option value="weekly">Every week</option>
                          <option value="once">One-off</option>
                        </select>
                        {sch.repeat === 'weekly' ? (
                          <select value={String(sch.dow)} onChange={e => setDow(i, Number(e.target.value))} style={selStyle}>
                            {DOW_NAMES.map((d, k) => <option key={d} value={String(k)}>{d}</option>)}
                          </select>
                        ) : null}
                        {sch.repeat === 'once' ? (
                          <input type="date" value={sch.date} onChange={e => setOnce(i, e.target.value)} style={selStyle} />
                        ) : null}
                      </div>
                      <div className="flex gap-1.5">
                        <Ed v={it.time} on={s => set(['activations', 'items', i, 'time'], s)} ph="Time shown, e.g. 3 - 6 PM" />
                        <input type="time" value={it.at || ''} onChange={e => set(['activations', 'items', i, 'at'], e.target.value)} style={selStyle} title="Sort time" />
                      </div>
                      <Ed v={it.where} on={s => set(['activations', 'items', i, 'where'], s)} ph="Where" />
                      <Ed v={it.desc} on={s => set(['activations', 'items', i, 'desc'], s)} ph="Description" area rows={2} />
                      <details>
                        <summary style={{ fontSize: 12, color: 'rgba(22,32,75,.6)', cursor: 'pointer' }}>Runs between (optional)</summary>
                        <div className="flex gap-1.5 pt-1.5">
                          <input type="date" value={it.start || ''} onChange={e => set(['activations', 'items', i, 'start'], e.target.value)} style={selStyle} />
                          <input type="date" value={it.end || ''} onChange={e => set(['activations', 'items', i, 'end'], e.target.value)} style={selStyle} />
                        </div>
                      </details>
                      <div className="flex items-center gap-1.5 pt-1">
                        <span style={{ fontSize: 11, color: 'rgba(22,32,75,.5)', fontWeight: 600 }}>{repeatLabel(it)}</span>
                        <span style={{ flex: 1 }} />
                        <Btn onClick={() => drop(['activations', 'items'], i)} tone="danger">Remove</Btn>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            /* guest view: real dates, grouped by day */
            <div className="space-y-6">
              {!pickDay && dailyActs.length ? (
                <div className="gd-card" style={{ padding: 20 }}>
                  <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--leaf)', marginBottom: 12 }}>Every day</div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {dailyActs.map((a, i) => {
                      const w = windowOf(a)
                      const live = nowMin >= 0 && nowMin >= w.start && nowMin <= w.end
                      return (
                        <div key={i}>
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span style={{ fontFamily: SERIF, fontSize: 19 }}>{a.name}</span>
                            {live ? (
                              <span style={{ background: 'var(--leaf)', color: '#fff', borderRadius: 999, padding: '2px 9px', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' }}>Now</span>
                            ) : null}
                          </div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--leaf)', marginTop: 3 }}>{a.time}</div>
                          {a.where ? <div style={{ fontSize: 12.5, color: 'rgba(22,32,75,.55)', marginTop: 1 }}>{a.where}</div> : null}
                          {a.desc ? <p style={{ fontSize: 13, lineHeight: 1.5, color: 'rgba(22,32,75,.7)', marginTop: 6 }}>{a.desc}</p> : null}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}
              {groupedUpcoming.length === 0 ? (
                <p style={{ color: 'rgba(22,32,75,.6)' }}>Nothing on the calendar for this day - the front desk always knows what is on.</p>
              ) : null}
              {groupedUpcoming.map(grp => (
                <div key={grp.iso}>
                  <div className="flex items-center gap-3 mb-3">
                    <span style={{ fontSize: 12, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, color: grp.iso === today ? 'var(--leaf)' : 'rgba(22,32,75,.55)' }}>
                      {dayLabel(grp.iso, today)}
                    </span>
                    <span style={{ flex: 1, height: 1, background: 'rgba(22,32,75,.10)' }} />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {grp.items.map((o, k) => {
                      const win = windowOf(o.item)
                      const isNow = o.iso === today && nowMin >= 0 && nowMin >= win.start && nowMin <= win.end
                      const isToday = o.iso === today
                      return (
                      <div key={k} className="gd-card" style={{ padding: 20, position: 'relative', overflow: 'hidden', borderColor: isNow ? 'var(--leaf)' : undefined }}>
                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'var(--leaf)' }} />
                        <div className="flex items-baseline gap-2 flex-wrap">
                          {isNow ? (
                            <span style={{ background: 'var(--leaf)', color: '#fff', borderRadius: 999, padding: '3px 11px', fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ width: 6, height: 6, borderRadius: 999, background: '#fff', display: 'inline-block' }} />
                              Happening now
                            </span>
                          ) : null}
                          {/* the day header above already carries the date - the card only needs the hour */}
                          <span style={{ fontSize: 14, fontWeight: 700, color: isToday ? 'var(--leaf)' : 'rgba(22,32,75,.7)' }}>{o.item.time}</span>
                        </div>
                        <div style={{ fontFamily: SERIF, fontSize: 22, marginTop: 12 }}>{o.item.name}</div>
                        {o.item.where ? <div style={{ fontSize: 13, color: 'rgba(22,32,75,.55)', marginTop: 2 }}>{o.item.where}</div> : null}
                        {o.item.desc ? <p style={{ fontSize: 14, lineHeight: 1.55, color: 'rgba(22,32,75,.75)', marginTop: 10 }}>{o.item.desc}</p> : null}
                        <div style={{ fontSize: 11, color: 'rgba(22,32,75,.42)', marginTop: 10, fontWeight: 600 }}>{repeatLabel(o.item)}</div>
                      </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {/* venues */}
      {!hidden('venues') || edit ? (
        <section className={wrap} style={{ paddingTop: 72 }}>
          <SectionHead id="dine" k="venues" title={g.venues?.title || ''} note={g.venues?.note} />
          <div className="grid gap-5 lg:grid-cols-2">
            {(g.venues?.items || []).map((v, i) => (
              <div key={i} className="gd-card" style={{ overflow: 'hidden' }}>
                {v.image && !edit && imgOk(v.image) ? <img src={v.image} alt="" onError={() => imgFailed(v.image)} style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block' }} /> : null}
                <div style={{ padding: 22 }}>
                  {edit ? (
                    <div className="space-y-1.5">
                      <Ed v={v.name} on={s => set(['venues', 'items', i, 'name'], s)} ph="Venue name" />
                      <Ed v={v.tagline} on={s => set(['venues', 'items', i, 'tagline'], s)} ph="One line about it" area rows={2} />
                      <Ed v={v.image} on={s => set(['venues', 'items', i, 'image'], s)} ph="Image URL" />
                      <div className="pt-2 text-[12px] font-semibold" style={{ color: 'rgba(22,32,75,.6)' }}>Hours</div>
                      {(v.hours || []).map((h, hi) => (
                        <div key={hi} className="flex gap-1.5">
                          <Ed v={h.label} on={s => set(['venues', 'items', i, 'hours', hi, 'label'], s)} ph="Label" />
                          <Ed v={h.value} on={s => set(['venues', 'items', i, 'hours', hi, 'value'], s)} ph="Hours" />
                          <Btn onClick={() => drop(['venues', 'items', i, 'hours'], hi)} tone="danger">x</Btn>
                        </div>
                      ))}
                      <Btn onClick={() => push(['venues', 'items', i, 'hours'], { label: 'Open', value: 'Daily 7 AM - 5 PM' })}>+ hours line</Btn>
                      <Ed v={v.note} on={s => set(['venues', 'items', i, 'note'], s)} ph="Note (dress code, reservations...)" area rows={2} />
                      <div className="flex gap-1.5">
                        <Ed v={v.phone} on={s => set(['venues', 'items', i, 'phone'], s)} ph="Phone" />
                        <Ed v={v.link} on={s => set(['venues', 'items', i, 'link'], s)} ph="Link" />
                        <Ed v={v.linkLabel} on={s => set(['venues', 'items', i, 'linkLabel'], s)} ph="Link label" />
                      </div>
                      <div className="flex gap-1.5 pt-1">
                        <Btn onClick={() => move(['venues', 'items'], i, -1)}>Up</Btn>
                        <Btn onClick={() => move(['venues', 'items'], i, 1)}>Down</Btn>
                        <Btn onClick={() => drop(['venues', 'items'], i)} tone="danger">Remove venue</Btn>
                      </div>
                    </div>
                  ) : (
                    <>
                      <h3 style={{ fontFamily: SERIF, fontSize: 26 }}>{v.name}</h3>
                      {v.tagline ? <p style={{ fontSize: 14.5, lineHeight: 1.6, color: 'rgba(22,32,75,.75)', marginTop: 8 }}>{v.tagline}</p> : null}
                      {(v.hours || []).length ? (
                        <div style={{ marginTop: 16, borderTop: '1px solid rgba(22,32,75,.08)' }}>
                          {(v.hours || []).map((h, hi) => (
                            <div key={hi} className="flex items-baseline justify-between gap-4" style={{ padding: '8px 0', borderBottom: '1px solid rgba(22,32,75,.06)' }}>
                              <span style={{ fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(22,32,75,.5)', fontWeight: 700 }}>{h.label}</span>
                              <span style={{ fontSize: 14, fontWeight: 600, textAlign: 'right' }}>{h.value}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {v.note ? <p style={{ fontSize: 13, color: 'rgba(22,32,75,.6)', marginTop: 12, lineHeight: 1.5 }}>{v.note}</p> : null}
                      <div className="flex flex-wrap gap-2 mt-4">
                        {v.phone ? <a href={telHref(v.phone)} style={{ border: '1px solid rgba(22,32,75,.2)', borderRadius: 999, padding: '7px 15px', fontSize: 13, fontWeight: 600, textDecoration: 'none', color: 'var(--ink)' }}>Call {v.phone}</a> : null}
                        {v.link ? <a href={v.link} target="_blank" rel="noreferrer" style={{ background: 'var(--ink)', color: '#fff', borderRadius: 999, padding: '7px 15px', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>{v.linkLabel || 'Learn more'}</a> : null}
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          {edit ? <div className="mt-4"><Btn onClick={() => push(['venues', 'items'], { name: 'New venue', tagline: '', image: '', hours: [], note: '', phone: '', link: '', linkLabel: '' })}>+ Add a venue</Btn></div> : null}
        </section>
      ) : null}

      {/* menu */}
      {!hidden('menu') || edit ? (
        <section className={wrap} style={{ paddingTop: 72 }}>
          <SectionHead id="menu" k="menu" title={g.menu?.title || ''} note={g.menu?.note} />
          <div className="grid gap-5 lg:grid-cols-2">
            {(g.menu?.groups || []).map((grp, gi) => {
              const mw = menuWindow(grp)
              const serving = !!mw && nowMin >= 0 && nowMin >= mw.start && nowMin <= mw.end
              const open = edit || menuOpenIdx.indexOf(gi) >= 0
              return (
              <div key={gi} className="gd-card" style={{ padding: 22, borderColor: serving ? 'var(--leaf)' : undefined, alignSelf: 'start' }}>
                {edit ? (
                  <div className="space-y-1.5 mb-3">
                    <Ed v={grp.name} on={s => set(['menu', 'groups', gi, 'name'], s)} ph="Section name" />
                    <Ed v={grp.note} on={s => set(['menu', 'groups', gi, 'note'], s)} ph="Note / hours" />
                    <div className="flex items-center gap-1.5">
                      <span style={{ fontSize: 11, color: 'rgba(22,32,75,.55)', fontWeight: 600 }}>Served</span>
                      <input type="time" value={grp.from || ''} onChange={e => set(['menu', 'groups', gi, 'from'], e.target.value)} style={selStyle} />
                      <input type="time" value={grp.to || ''} onChange={e => set(['menu', 'groups', gi, 'to'], e.target.value)} style={selStyle} />
                      <span style={{ fontSize: 11, color: 'rgba(22,32,75,.45)' }}>{grp.from || grp.to ? '' : mw ? 'auto ' + hhmmLabel(mw.start) + '-' + hhmmLabel(mw.end) : 'always'}</span>
                    </div>
                    <div className="flex gap-1.5">
                      <Btn onClick={() => move(['menu', 'groups'], gi, -1)}>Up</Btn>
                      <Btn onClick={() => move(['menu', 'groups'], gi, 1)}>Down</Btn>
                      <Btn onClick={() => drop(['menu', 'groups'], gi)} tone="danger">Remove section</Btn>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => toggleMenu(gi)}
                    style={{ width: '100%', textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: 12, cursor: 'pointer', marginBottom: open ? 16 : 0 }}>
                    <span style={{ flex: 1 }}>
                      <span style={{ fontFamily: SERIF, fontSize: 21, display: 'block' }}>{grp.name}</span>
                      {grp.note ? <span style={{ fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--leaf)', fontWeight: 700, marginTop: 4, display: 'block' }}>{grp.note}</span> : null}
                      {!open ? <span style={{ fontSize: 12.5, color: 'rgba(22,32,75,.5)', marginTop: 6, display: 'block' }}>{(grp.items || []).filter(x => String(x.name || '').indexOf('## ') !== 0).length} items - tap to open</span> : null}
                    </span>
                    {serving ? (
                      <span style={{ background: 'var(--leaf)', color: '#fff', borderRadius: 999, padding: '3px 10px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>Serving now</span>
                    ) : (
                      <span style={{ fontSize: 18, color: 'rgba(22,32,75,.35)', lineHeight: 1 }}>{open ? '−' : '+'}</span>
                    )}
                  </button>
                )}
                <div className="space-y-3" style={{ display: open ? undefined : 'none' }}>
                  {(grp.items || []).map((it, ii) => (
                    <div key={ii}>
                      {edit ? (
                        <div className="space-y-1">
                          <div className="flex gap-1.5">
                            <Ed v={it.name} on={s => set(['menu', 'groups', gi, 'items', ii, 'name'], s)} ph="Dish" />
                            <Ed v={it.price} on={s => set(['menu', 'groups', gi, 'items', ii, 'price'], s)} ph="$" style={{ width: 90 }} />
                            <Btn onClick={() => drop(['menu', 'groups', gi, 'items'], ii)} tone="danger">x</Btn>
                          </div>
                          <Ed v={it.desc} on={s => set(['menu', 'groups', gi, 'items', ii, 'desc'], s)} ph="Ingredients / description" />
                        </div>
                      ) : (it.name || '').indexOf('## ') === 0 ? (
                        /* a course divider inside a section - "## Salads" */
                        <div style={{ paddingTop: ii ? 10 : 0 }}>
                          <div style={{ fontSize: 11.5, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--leaf)', borderTop: ii ? '1px solid rgba(22,32,75,.10)' : undefined, paddingTop: ii ? 12 : 0 }}>
                            {it.name.slice(3)}
                          </div>
                          {it.desc ? <div style={{ fontSize: 12.5, color: 'rgba(22,32,75,.55)', marginTop: 3 }}>{it.desc}</div> : null}
                        </div>
                      ) : (
                        <>
                          <div className="flex items-baseline gap-2">
                            <span style={{ fontWeight: 600, fontSize: 15 }}>{it.name}</span>
                            <span style={{ flex: 1, borderBottom: '1px dotted rgba(22,32,75,.25)', transform: 'translateY(-4px)' }} />
                            {it.price ? <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)' }}>{it.price}</span> : null}
                          </div>
                          {it.desc ? <div style={{ fontSize: 13, color: 'rgba(22,32,75,.6)', marginTop: 3, lineHeight: 1.5 }}>{it.desc}</div> : null}
                        </>
                      )}
                    </div>
                  ))}
                  {edit ? <Btn onClick={() => push(['menu', 'groups', gi, 'items'], { name: 'New item', desc: '', price: '' })}>+ item</Btn> : null}
                </div>
              </div>
              )
            })}
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-5">
            {edit ? (
              <>
                <Btn onClick={() => push(['menu', 'groups'], { name: 'New section', note: '', items: [] })}>+ Add a menu section</Btn>
                <Ed v={g.menu?.link || ''} on={s => set(['menu', 'link'], s)} ph="Full menu link" style={{ maxWidth: 320 }} />
                <Ed v={g.menu?.linkLabel || ''} on={s => set(['menu', 'linkLabel'], s)} ph="Link label" style={{ maxWidth: 200 }} />
              </>
            ) : (g.menu?.link ? (
              <a href={g.menu.link} target="_blank" rel="noreferrer" style={{ background: 'var(--ink)', color: '#fff', borderRadius: 999, padding: '11px 24px', fontSize: 15, fontWeight: 600, textDecoration: 'none' }}>
                {g.menu.linkLabel || 'See the full menu'}
              </a>
            ) : null)}
          </div>
        </section>
      ) : null}

      {/* quotes */}
      {(!hidden('quotes') && (quotes.length || edit)) || edit ? (
        <section style={{ background: 'var(--ink)', color: '#fff', marginTop: 80, padding: '72px 0' }}>
          <div className={wrap}>
            <div className="flex items-start justify-between gap-3 mb-8">
              <div>
                <div style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', fontWeight: 700, color: 'rgba(255,255,255,.6)' }}>In their words</div>
                {edit
                  ? <div className="mt-2" style={{ maxWidth: 420 }}><Ed v={g.quotes?.title || ''} on={s => set(['quotes', 'title'], s)} /></div>
                  : <h2 style={{ fontFamily: SERIF, fontSize: 32, marginTop: 6 }}>{g.quotes?.title}</h2>}
                {edit
                  ? <div className="mt-2" style={{ maxWidth: 560 }}><Ed v={g.quotes?.note || ''} on={s => set(['quotes', 'note'], s)} /></div>
                  : (g.quotes?.note ? <p style={{ color: 'rgba(255,255,255,.7)', marginTop: 8 }}>{g.quotes.note}</p> : null)}
              </div>
              {edit ? (
                <div className="flex flex-col gap-2 items-end">
                  <Btn onClick={pullQuotes}>{busy ? 'Pulling...' : 'Pull from reviews'}</Btn>
                  <Btn onClick={() => push(['quotes', 'items'], { text: 'New quote', who: 'Verified guest', source: '', date: '' })}>+ quote</Btn>
                  <Btn onClick={() => toggle('quotes')}>{hidden('quotes') ? 'Show' : 'Hide'} section</Btn>
                </div>
              ) : null}
            </div>
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {quotes.map((q, i) => (
                <div key={i} style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.14)', borderRadius: 20, padding: 22 }}>
                  <div style={{ fontFamily: SERIF, fontSize: 40, lineHeight: 1, color: 'var(--accent)' }}>&ldquo;</div>
                  {edit && qPinned.length ? (
                    <div className="space-y-1 mt-2">
                      <Ed v={q.text} on={s => set(['quotes', 'items', i, 'text'], s)} area rows={4} style={{ color: '#16204B' }} />
                      <div className="flex gap-1.5">
                        <Ed v={q.who} on={s => set(['quotes', 'items', i, 'who'], s)} ph="Who" style={{ color: '#16204B' }} />
                        <Ed v={q.source} on={s => set(['quotes', 'items', i, 'source'], s)} ph="Channel" style={{ color: '#16204B' }} />
                        <Ed v={q.date} on={s => set(['quotes', 'items', i, 'date'], s)} ph="Date" style={{ color: '#16204B' }} />
                      </div>
                      <Btn onClick={() => drop(['quotes', 'items'], i)} tone="danger">Remove</Btn>
                    </div>
                  ) : (
                    <>
                      <p style={{ fontSize: 16, lineHeight: 1.6, marginTop: -6 }}>{q.text}</p>
                      <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,.6)', marginTop: 14 }}>
                        {q.who}{q.source ? ' - ' + q.source : ''}{q.date ? ' - ' + q.date : ''}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
            {edit && !qPinned.length ? <p className="mt-4 text-sm" style={{ color: 'rgba(255,255,255,.6)' }}>Showing live quotes pulled from recent reviews. Press &quot;Pull from reviews&quot; to pin and edit a set.</p> : null}
          </div>
        </section>
      ) : null}

      {/* things to do */}
      {!hidden('todo') || edit ? (
        <section className={wrap} style={{ paddingTop: 72 }}>
          <SectionHead id="do" k="todo" title={g.todo?.title || ''} note={g.todo?.note} />
          <div className="space-y-8">
            {(g.todo?.groups || []).map((grp, gi) => (
              <div key={gi}>
                <div className="flex items-center gap-3 mb-4">
                  {edit
                    ? <Ed v={grp.name} on={s => set(['todo', 'groups', gi, 'name'], s)} style={{ maxWidth: 280, fontWeight: 700 }} />
                    : <h3 style={{ fontSize: 13, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--leaf)' }}>{grp.name}</h3>}
                  <span style={{ flex: 1, height: 1, background: 'rgba(22,32,75,.12)' }} />
                  {edit ? <Btn onClick={() => drop(['todo', 'groups'], gi)} tone="danger">Remove group</Btn> : null}
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {(grp.items || []).map((it, ii) => {
                    // Anything off-property is tappable: its own site if we have one, otherwise
                    // straight into Maps near the property. On-property lines stay plain.
                    const onsite = /on ?property|on-?site|at the (hotel|resort)|amenit|included/i.test(grp.name || '')
                    const href = it.url ? it.url : (onsite ? '' : mapSearch(it.name))
                    const linkLabel = it.url ? 'Visit site' : 'Open in Maps'
                    const body = (
                      <>
                        <div className="flex items-start justify-between gap-2">
                          <div style={{ fontWeight: 600, fontSize: 16 }}>{it.name}</div>
                          {it.meta ? <span style={{ background: 'var(--sand)', border: '1px solid rgba(22,32,75,.1)', borderRadius: 999, padding: '2px 9px', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>{it.meta}</span> : null}
                        </div>
                        {it.desc ? <p style={{ fontSize: 13.5, lineHeight: 1.55, color: 'rgba(22,32,75,.7)', marginTop: 6 }}>{it.desc}</p> : null}
                        {href ? (
                          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--leaf)', marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            {linkLabel}
                            <span aria-hidden="true">&rarr;</span>
                          </span>
                        ) : null}
                      </>
                    )
                    if (edit) {
                      return (
                        <div key={ii} className="gd-card" style={{ padding: 18 }}>
                          <div className="space-y-1.5">
                            <Ed v={it.name} on={s => set(['todo', 'groups', gi, 'items', ii, 'name'], s)} ph="Name" />
                            <Ed v={it.desc} on={s => set(['todo', 'groups', gi, 'items', ii, 'desc'], s)} ph="Description" area rows={2} />
                            <div className="flex gap-1.5">
                              <Ed v={it.meta} on={s => set(['todo', 'groups', gi, 'items', ii, 'meta'], s)} ph="Distance / tag" />
                              <Ed v={it.url} on={s => set(['todo', 'groups', gi, 'items', ii, 'url'], s)} ph="Website (blank = Maps)" />
                            </div>
                            <Btn onClick={() => drop(['todo', 'groups', gi, 'items'], ii)} tone="danger">Remove</Btn>
                          </div>
                        </div>
                      )
                    }
                    if (!href) return <div key={ii} className="gd-card" style={{ padding: 18 }}>{body}</div>
                    return (
                      <a key={ii} href={href} target="_blank" rel="noreferrer" className="gd-card gd-tap"
                        style={{ padding: 18, display: 'block', textDecoration: 'none', color: 'inherit' }}>
                        {body}
                      </a>
                    )
                  })}
                  {edit ? <Btn onClick={() => push(['todo', 'groups', gi, 'items'], { name: 'New thing to do', desc: '', meta: '', url: '' })}>+ item</Btn> : null}
                </div>
              </div>
            ))}
            {edit ? <Btn onClick={() => push(['todo', 'groups'], { name: 'New group', items: [] })}>+ Add a group</Btn> : null}
          </div>
        </section>
      ) : null}

      {/* gallery */}
      {!hidden('gallery') || edit ? (
        <section className={wrap} style={{ paddingTop: 72 }}>
          <SectionHead k="gallery" title={g.gallery?.title || ''} note={g.gallery?.note} />
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            {(g.gallery?.images || []).map((im, i) => (!edit && !imgOk(im.url)) ? null : (
              <figure key={i} style={{ borderRadius: 16, overflow: 'hidden', background: '#fff', border: '1px solid rgba(22,32,75,.1)' }}>
                {im.url && imgOk(im.url) ? <img src={im.url} alt="" onError={() => imgFailed(im.url)} style={{ width: '100%', height: 170, objectFit: 'cover', display: 'block' }} /> : null}
                {edit ? (
                  <div className="p-2 space-y-1">
                    <Ed v={im.url} on={s => set(['gallery', 'images', i, 'url'], s)} ph="Image URL" />
                    <Ed v={im.caption} on={s => set(['gallery', 'images', i, 'caption'], s)} ph="Caption" />
                    <Btn onClick={() => drop(['gallery', 'images'], i)} tone="danger">Remove</Btn>
                  </div>
                ) : (im.caption ? <figcaption style={{ padding: '9px 12px', fontSize: 12.5, color: 'rgba(22,32,75,.65)' }}>{im.caption}</figcaption> : null)}
              </figure>
            ))}
            {edit ? <button type="button" onClick={() => push(['gallery', 'images'], { url: '', caption: '' })} className="gd-card" style={{ borderStyle: 'dashed', minHeight: 120, fontWeight: 600, color: 'rgba(22,32,75,.6)' }}>+ photo</button> : null}
          </div>
        </section>
      ) : null}

      {/* place */}
      {!hidden('place') || edit ? (
        <section className={wrap} style={{ paddingTop: 72 }}>
          <SectionHead id="map" k="place" title={g.place?.title || ''} note={g.place?.note} />
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="gd-card" style={{ overflow: 'hidden', minHeight: 300 }}>
              {g.place?.mapQuery ? (
                <iframe title="Map" width="100%" height="100%" style={{ border: 0, minHeight: 300 }} loading="lazy"
                  src={'https://www.google.com/maps?q=' + encodeURIComponent(g.place.mapQuery) + '&output=embed'} />
              ) : null}
            </div>
            <div className="gd-card" style={{ padding: 24 }}>
              {edit ? (
                <div className="space-y-1.5">
                  <Ed v={g.place?.address || ''} on={s => set(['place', 'address'], s)} ph="Address" />
                  <Ed v={g.place?.mapQuery || ''} on={s => set(['place', 'mapQuery'], s)} ph="Map search query" />
                </div>
              ) : (
                <>
                  <Eyebrow>Address</Eyebrow>
                  <div style={{ fontFamily: SERIF, fontSize: 22, marginTop: 6 }}>{g.place?.address}</div>
                  {g.place?.mapQuery ? (
                    <a className="gd-link" style={{ fontSize: 13.5, display: 'inline-block', marginTop: 8 }} target="_blank" rel="noreferrer"
                      href={'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(g.place.mapQuery)}>Open in Maps</a>
                  ) : null}
                </>
              )}
              <div style={{ marginTop: 18 }}>
                {(g.place?.items || []).map((it, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-4" style={{ padding: '10px 0', borderTop: '1px solid rgba(22,32,75,.08)' }}>
                    {edit ? (
                      <div className="flex gap-1.5 w-full">
                        <Ed v={it.label} on={s => set(['place', 'items', i, 'label'], s)} ph="Label" />
                        <Ed v={it.value} on={s => set(['place', 'items', i, 'value'], s)} ph="Value" />
                        <Btn onClick={() => drop(['place', 'items'], i)} tone="danger">x</Btn>
                      </div>
                    ) : (
                      <>
                        <span style={{ fontSize: 12, letterSpacing: '.1em', textTransform: 'uppercase', color: 'rgba(22,32,75,.5)', fontWeight: 700 }}>{it.label}</span>
                        <span style={{ fontSize: 14, fontWeight: 600, textAlign: 'right' }}>{it.value}</span>
                      </>
                    )}
                  </div>
                ))}
                {edit ? <div className="pt-2"><Btn onClick={() => push(['place', 'items'], { label: 'Label', value: 'Value' })}>+ line</Btn></div> : null}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* contact */}
      {!hidden('contact') || edit ? (
        <section className={wrap} style={{ paddingTop: 72, paddingBottom: 24 }}>
          <SectionHead k="contact" title={g.contact?.title || ''} note={g.contact?.note} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(g.contact?.items || []).map((c, i) => (
              <div key={i} className="gd-card" style={{ padding: 20 }}>
                {edit ? (
                  <div className="space-y-1.5">
                    <Ed v={c.name} on={s => set(['contact', 'items', i, 'name'], s)} ph="Name" />
                    <Ed v={c.role} on={s => set(['contact', 'items', i, 'role'], s)} ph="What they handle" />
                    <Ed v={c.phone} on={s => set(['contact', 'items', i, 'phone'], s)} ph="Phone" />
                    <Ed v={c.email} on={s => set(['contact', 'items', i, 'email'], s)} ph="Email" />
                    <Ed v={c.note} on={s => set(['contact', 'items', i, 'note'], s)} ph="Note" />
                    <Btn onClick={() => drop(['contact', 'items'], i)} tone="danger">Remove</Btn>
                  </div>
                ) : (
                  <>
                    <div style={{ fontFamily: SERIF, fontSize: 20 }}>{c.name}</div>
                    {c.role ? <div style={{ fontSize: 13, color: 'rgba(22,32,75,.6)', marginTop: 2 }}>{c.role}</div> : null}
                    <div className="flex flex-wrap gap-2 mt-3">
                      {c.phone ? <a href={telHref(c.phone)} style={{ border: '1px solid rgba(22,32,75,.2)', borderRadius: 999, padding: '6px 13px', fontSize: 13, fontWeight: 600, textDecoration: 'none', color: 'var(--ink)' }}>{c.phone}</a> : null}
                      {c.email ? <a href={'mailto:' + c.email} style={{ border: '1px solid rgba(22,32,75,.2)', borderRadius: 999, padding: '6px 13px', fontSize: 13, fontWeight: 600, textDecoration: 'none', color: 'var(--ink)' }}>Email</a> : null}
                    </div>
                    {c.note ? <div style={{ fontSize: 12.5, color: 'rgba(22,32,75,.55)', marginTop: 10 }}>{c.note}</div> : null}
                  </>
                )}
              </div>
            ))}
            {edit ? <Btn onClick={() => push(['contact', 'items'], { name: 'New contact', role: '', phone: '', email: '', note: '' })}>+ contact</Btn> : null}
          </div>
        </section>
      ) : null}

      {/* footer */}
      <footer style={{ borderTop: '1px solid rgba(22,32,75,.1)', marginTop: 56 }}>
        <div className={wrap} style={{ paddingTop: 28, paddingBottom: 48, textAlign: 'center' }}>
          {edit ? (
            <div className="space-y-2" style={{ maxWidth: 520, margin: '0 auto' }}>
              <Ed v={g.footer?.note || ''} on={s => set(['footer', 'note'], s)} ph="Small print" />
              <Ed v={g.footer?.signature || ''} on={s => set(['footer', 'signature'], s)} ph="Signature" />
            </div>
          ) : (
            <>
              <p style={{ fontSize: 13, color: 'rgba(22,32,75,.55)', maxWidth: 620, margin: '0 auto' }}>{g.footer?.note}</p>
              <div style={{ fontFamily: SERIF, fontSize: 15, marginTop: 12, color: 'rgba(22,32,75,.75)' }}>{g.footer?.signature}</div>
            </>
          )}
          {g.updatedAt ? <div style={{ fontSize: 11, color: 'rgba(22,32,75,.35)', marginTop: 14 }}>Updated {new Date(g.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div> : null}
        </div>
      </footer>

      {edit ? (
        <div style={{ position: 'sticky', bottom: 0, zIndex: 50, background: 'var(--ink)', color: '#fff' }}>
          <div className={wrap + ' flex items-center gap-3 py-3'}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Editing {slug}</span>
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,.6)' }}>Every line on this page is editable. Nothing is live until you save.</span>
            <div className="ml-auto flex gap-2">
              <Btn onClick={() => setEdit(false)}>Preview</Btn>
              <Btn onClick={save} tone="ghost">{busy ? 'Saving...' : 'Save changes'}</Btn>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
