'use client'
// Lost & Found (Jon, 2026-11-04: "views lost and found items, assign to reservation and manage this
// … pull from our slack channel"). Every item a cleaner found in a unit — read from the Slack
// channel every 15 minutes (lib/lost-found-slack) or logged here by hand — with the stay it
// belongs to, who has been told, and how it got back to the guest (or didn't).
//
// THE PAGE LEADS WITH WHAT NEEDS A PERSON (2026-11-09 audit). Every open item is in exactly one
// stage, and each stage has ONE next step, shown as the row's button:
//   Paid · not shipped        → the guest paid and is waiting — the only red on the page
//   No stay attached          → Attach stay
//   Contact guest             → tell them we have it
//   Guest waiting on a quote  → cost + address, ask them to pay
//   Waiting on payment        → Mark paid (that sends the Breezeway delivery task)
//   Waiting on guest          → they were told; no answer yet
//   Shipped                   → add tracking, then close
// House process, unchanged: shipping is paid by the guest, the cost is worked out before the ask,
// and the delivery task goes out only once it is paid.
// Clean-up (2026-11-05): Delete (one row or many), "Not lost & found" to close a row that isn't a
// find, and Held / Contacted items 30 days past the find with nothing requested are Discarded
// automatically (lib/lost-found-cleanup) — those then wait under "Hold ended" until someone says
// the thing itself was tossed or donated.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Shell } from '@/components/Shell'
import { RefreshCw, Search, ExternalLink, Plus, X, Camera, Ban, CheckSquare, Square, Link2, Slack, Settings2, Phone, Mail, Truck, Check, Trash2, Gift, PackageCheck, DollarSign, Send, ClipboardList, ImagePlus, RotateCcw } from 'lucide-react'
import { QUOTE_CHASE_DAYS, QUOTE_EXPIRE_DAYS, SHIPPED_CLOSE_DAYS, isValuable, holdDaysLeft, trackingSentAt } from '@/lib/lost-found-rules'
import { LeanHead, LeanTabs, Pill, Tag, LeanList, LeanRow, LeanSection, LeanEmpty, Tip, type Tone } from '@/components/lean'

type Stay = { reservationId: string; listingId: string; unit: string; market: string; guestName: string; guestPhone: string | null; guestEmail: string | null; checkIn: string; checkOut: string; channel: string | null; confirmationCode: string | null; guestyUrl: string }
type Item = {
  id: string; listing_id: string | null; unit: string; market: string | null; item: string; description: string | null; category: string
  found_where: string | null; found_date: string; found_by: string | null; storage_location: string | null; photos: string[]
  reservation_id: string | null; guest_name: string | null; guest_phone: string | null; guest_email: string | null; check_in: string | null; check_out: string | null
  status: string; contacted_at: string | null; contact_note: string | null; shipping_carrier: string | null; tracking: string | null; shipping_cost: number | null; shipping_paid: boolean
  ship_to?: string | null; pay_requested_at?: string | null; pay_requested_via?: string | null; paid_at?: string | null; paid_by?: string | null; paid_via?: string | null
  folio_item_ids?: string[]; breezeway_task_id?: string | null; breezeway_error?: string | null; receipts?: string[]; sent_at?: string | null; sent_by?: string | null
  // Where the Breezeway delivery task stands (read from the mirror with the list; absent right after it is created).
  delivery?: { status: string; date: string | null; assignees: string[] }
  resolved_at: string | null; notes: string | null; history: { at: string; who: string; what: string; note?: string }[]; slack_ts: string | null; slack_permalink: string | null; created_by: string | null; created_at: string
}
type Listing = { id: string; name: string }
type Patch = (id: string, body: any) => Promise<Item | null>

// The stored status, in the words the page uses everywhere.
const STATUS: Record<string, string> = {
  held: 'Held', contacted: 'Guest contacted', claimed: 'Guest wants it', shipping: 'Shipped',
  returned: 'Returned to guest', donated: 'Donated', discarded: 'Discarded', not_lost_found: 'Not lost & found',
}
const CATS = ['clothing', 'electronics', 'documents', 'jewelry', 'toiletries', 'toys', 'keys_cards', 'other']
const catLabel = (c: string) => c === 'keys_cards' ? 'Keys / cards' : c.charAt(0).toUpperCase() + c.slice(1)
const RESOLVED = ['returned', 'donated', 'discarded', 'not_lost_found']

// ── the stage: where an item is, and the one thing to do next ───────────────────────────────────
type StageKey = 'quote_expired' | 'hold_decision' | 'sent_tell' | 'paid_no_task' | 'task_cancelled' | 'paid_waiting' | 'sent_no_tracking' | 'sent' | 'no_stay' | 'contact' | 'quote' | 'awaiting_pay' | 'waiting_guest' | 'closed'
type GroupKey = 'ship' | 'you' | 'decide' | 'guest' | 'shipped' | 'closed'
const STAGE: Record<StageKey, { label: string; tone: Tone; group: GroupKey; next: string }> = {
  paid_no_task:     { label: 'Paid · no delivery task', tone: 'rose', group: 'ship', next: 'The guest paid, but the delivery task was not created. Create it so the team ships it.' },
  task_cancelled:   { label: 'Paid · task cancelled', tone: 'rose', group: 'ship', next: 'The guest paid, but the delivery task was cancelled in Breezeway. Create a new one so the team ships it.' },
  quote_expired:    { label: 'Quote expired', tone: 'amber', group: 'you', next: 'The guest was asked to pay ' + QUOTE_EXPIRE_DAYS + ' or more days ago and has not. Close it — or mark it paid if the money did come in. Nothing is sent to the guest.' },
  hold_decision:    { label: 'Hold ended · decide', tone: 'amber', group: 'decide', next: 'The 30-day hold has ended. Valuables are never discarded automatically — decide: keep holding, donate or discard.' },
  sent_tell:        { label: 'Shipped · send tracking', tone: 'amber', group: 'you', next: 'It shipped and the tracking number is in. Send it to the guest.' },
  paid_waiting:     { label: 'Paid · not shipped', tone: 'rose', group: 'ship', next: 'The guest paid and is waiting. The team ships it on delivery day — add the tracking number when it goes out.' },
  sent_no_tracking: { label: 'Shipped · no tracking', tone: 'amber', group: 'you', next: 'It has shipped. Add the tracking number so there is a record for the guest.' },
  sent:             { label: 'Shipped', tone: 'emerald', group: 'shipped', next: 'Shipped, and the guest has the tracking number. It closes on its own ' + SHIPPED_CLOSE_DAYS + ' days after shipping — or close it now.' },
  no_stay:          { label: 'No stay attached', tone: 'amber', group: 'you', next: 'Attach the stay this belongs to, so the guest can be contacted.' },
  contact:          { label: 'Contact guest', tone: 'amber', group: 'you', next: 'Tell the guest we have it and ask whether they want it back.' },
  quote:            { label: 'Guest waiting on a quote', tone: 'amber', group: 'you', next: 'The guest wants it back. Work out the shipping cost, then ask them to pay.' },
  awaiting_pay:     { label: 'Waiting on payment', tone: 'sky', group: 'guest', next: 'The guest has been asked to pay. Once they have, mark it paid — that sends the delivery task.' },
  waiting_guest:    { label: 'Waiting on guest', tone: 'slate', group: 'guest', next: 'The guest has been told. When they answer, record it here.' },
  closed:           { label: 'Closed', tone: 'slate', group: 'closed', next: '' },
}
function stageOf(i: Item, today: string): StageKey {
  if (RESOLVED.includes(i.status)) return 'closed'
  if (i.sent_at || i.status === 'shipping') return !i.tracking ? 'sent_no_tracking' : trackingSentAt(i) ? 'sent' : 'sent_tell'
  if (i.shipping_paid) {
    if (!i.breezeway_task_id) return 'paid_no_task'
    if (i.delivery && /cancel|delet/i.test(i.delivery.status)) return 'task_cancelled'
    return 'paid_waiting'
  }
  // The hold ended and the clock did not discard it (a valuable, or a person reopened it): someone decides.
  if ((i.status === 'held' || i.status === 'contacted') && !i.pay_requested_at && holdDaysLeft(i, today) <= 0) return 'hold_decision'
  if (!i.reservation_id) return 'no_stay'
  if (i.pay_requested_at) return (daysSince(i.pay_requested_at) ?? 0) >= QUOTE_EXPIRE_DAYS ? 'quote_expired' : 'awaiting_pay'
  if (i.status === 'claimed') return 'quote'
  if (i.status === 'contacted') return 'waiting_guest'
  return 'contact'
}

function fmtShort(iso: string | null | undefined) { if (!iso) return ''; const d = new Date(iso.slice(0, 10) + 'T12:00:00'); if (isNaN(d.getTime())) return iso; return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
function fmtWhen(iso: string) { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
function daysBetween(a: string, b: string) { return Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 86400000) }
function daysSince(iso: string | null | undefined): number | null { if (!iso) return null; const t = Date.parse(iso); return isNaN(t) ? null : Math.max(0, Math.floor((Date.now() - t) / 86400000)) }
function ago(n: number | null) { return n == null ? '' : n === 0 ? 'today' : n === 1 ? 'yesterday' : n + 'd ago' }
function photoSrc(p: string) { return /^https?:/.test(p) ? p : '/api/lost-found/photo?path=' + encodeURIComponent(p) }
function todayISO() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) }
const fmt$ = (n: number) => '$' + n.toFixed(2)

// Inputs are 16px on a phone (anything smaller makes iPhone zoom the page on focus) and every button
// is at least 36px tall — the team logs finds on a phone, standing in the unit.
const inp = 'text-[16px] sm:text-[12.5px] border border-line rounded-lg px-2.5 py-2 sm:py-1.5 bg-white w-full focus:outline-none focus:ring-2 focus:ring-brand-200'
const btn = 'inline-flex items-center justify-center gap-1.5 min-h-[36px] text-[12.5px] font-semibold rounded-lg px-3 py-1.5 border border-line bg-white text-ink hover:bg-slate-50 disabled:opacity-50'
const btnP = 'inline-flex items-center justify-center gap-1.5 min-h-[36px] text-[12.5px] font-semibold rounded-lg px-3 py-1.5 bg-brand-700 text-white hover:bg-brand-800 disabled:opacity-50'
const tool = 'shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-lg border border-line bg-white text-muted hover:text-ink hover:bg-slate-50 disabled:opacity-40'
const cap = 'text-[10.5px] uppercase tracking-wide text-muted font-semibold'

// ── uploads: shrink on the phone, say so when one fails ─────────────────────────────────────────
// A phone photo is 3–12 MB; sent as-is it was refused ("Image too large") and the failure was
// swallowed, so the photo simply never appeared. Photos are now scaled to 1600px JPEG in the browser
// (a few hundred KB), sent side by side, and a failure is reported.
function readB64(f: File): Promise<string> {
  return new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('Could not read ' + f.name)); r.readAsDataURL(f) })
}
async function fileToUpload(f: File): Promise<{ b64: string; contentType: string; filename: string }> {
  const type = f.type || (/\.pdf$/i.test(f.name) ? 'application/pdf' : 'image/jpeg')
  if (/^image\/(jpeg|jpg|png|webp)$/i.test(type) && typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(f)
      const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height, 1))
      const c = document.createElement('canvas')
      c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k))
      const ctx = c.getContext('2d')
      if (ctx) {
        ctx.drawImage(bmp, 0, 0, c.width, c.height)
        const b64 = c.toDataURL('image/jpeg', 0.82).split(',')[1] || ''
        if (b64) return { b64, contentType: 'image/jpeg', filename: f.name.replace(/\.[^.]+$/, '') + '.jpg' }
      }
    } catch { /* fall through to the file as it is */ }
  }
  return { b64: await readB64(f), contentType: type, filename: f.name }
}
async function uploadAll(files: File[], itemId: string, prefix: string): Promise<{ paths: string[]; error: string }> {
  const out = await Promise.all(files.map(async f => {
    try {
      const u = await fileToUpload(f)
      const r = await fetch('/api/lost-found/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ b64: u.b64, filename: prefix + u.filename, contentType: u.contentType, itemId }) })
      const j: any = await r.json().catch(() => ({}))
      return j && j.ok && j.path ? { path: String(j.path), error: '' } : { path: '', error: String((j && j.error) || 'Upload failed (' + r.status + ')') }
    } catch (e: any) { return { path: '', error: String(e?.message || e) } }
  }))
  const bad = out.filter(o => o.error)
  return { paths: out.filter(o => o.path).map(o => o.path), error: bad.length ? (bad.length === 1 ? 'A file' : bad.length + ' files') + ' did not upload: ' + bad[0].error : '' }
}

export default function LostFoundPage() {
  const [tab, setTab] = useState<'open' | 'resolved' | 'all'>('open')
  const [items, setItems] = useState<Item[]>([])
  const [tossQueue, setTossQueue] = useState<Item[]>([])
  const [holdDays, setHoldDays] = useState(30)
  const [today, setToday] = useState(todayISO())
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [listings, setListings] = useState<Listing[]>([])
  const [slack, setSlack] = useState<any>(null)
  const [slackOpen, setSlackOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  // CLEAN-UP MODE: tick rows, then close them as not lost & found or delete them.
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const togglePick = (id: string) => setPicked(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  const load = useCallback(async () => {
    try {
      setErr('')
      const r = await fetch('/api/lost-found?status=' + tab, { cache: 'no-store' })
      const j: any = await r.json().catch(() => ({}))
      if (!r.ok || j.ok === false) { setErr(j.error || 'Could not load the list (' + r.status + ')'); return }
      setItems(j.items || []); setTossQueue(Array.isArray(j.tossQueue) ? j.tossQueue : []); setHoldDays(j.holdDays || 30); setToday(j.today || todayISO())
    } catch { setErr('Could not load the list — check the connection and reload.') } finally { setLoading(false) }
  }, [tab])
  useEffect(() => { setLoading(true); load() }, [load])
  // Opened from the Today strip's Lost & Found tile (?item=<id>): that item opens and scrolls into view.
  const [focusId] = useState(() => { try { return new URLSearchParams(window.location.search).get('item') || '' } catch { return '' } })
  // Opened from the Today tile's "Log a find" (?new=1): the form is already open.
  useEffect(() => { try { if (new URLSearchParams(window.location.search).get('new') === '1') setAdding(true) } catch { /* fine */ } }, [])
  useEffect(() => { if (focusId && items.some(i => i.id === focusId)) document.getElementById('lf-' + focusId)?.scrollIntoView({ block: 'center' }) }, [focusId, items])
  // A link to an item that has since been closed (the Breezeway task links here) used to open nothing:
  // if it is not among the open ones, look in All once.
  const triedAll = useRef(false)
  useEffect(() => {
    if (!focusId || loading || triedAll.current || tab !== 'open') return
    if (items.some(i => i.id === focusId) || tossQueue.some(i => i.id === focusId)) return
    triedAll.current = true; setTab('all')
  }, [focusId, loading, tab, items, tossQueue])
  const loadSlack = useCallback(() => { fetch('/api/lost-found/slack', { cache: 'no-store' }).then(r => r.json()).then(setSlack).catch(() => {}) }, [])
  useEffect(() => {
    fetch('/api/listings?slim=1', { cache: 'no-store' }).then(r => r.json()).then(j => {
      const arr: any[] = Array.isArray(j) ? j : (j.results || j.listings || [])
      setListings(arr.map(l => ({ id: String(l.id), name: String(l.nickname || l.title || l.name || l.id) })).sort((a, b) => a.name.localeCompare(b.name)))
    }).catch(() => {})
    loadSlack()
  }, [loadSlack])

  const syncNow = async (days?: number) => {
    setSyncing(true)
    try {
      const r = await fetch('/api/lost-found/slack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(days ? { days } : {}) })
      const j: any = await r.json().catch(() => ({}))
      if (!j.ok) setErr(j.error || 'Slack could not be read (' + r.status + ')'); else setErr('')
      loadSlack()
      await load()
    } catch { setErr('Slack could not be read — check the connection.') } finally { setSyncing(false) }
  }
  const patch: Patch = useCallback(async (id: string, body: any): Promise<Item | null> => {
    try {
      const r = await fetch('/api/lost-found', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) })
      const j: any = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok || !j.item) { setErr(j.error || 'Could not save (' + r.status + ')'); return null }
      const it = j.item as Item
      setItems(list => list.map(i => i.id === id ? { ...it, delivery: it.breezeway_task_id && it.breezeway_task_id === i.breezeway_task_id ? i.delivery : undefined } : i))
      // Paid is saved even when Breezeway refuses the task — say so where it will be seen.
      if (j.task && j.task.ok === false) setErr('The payment is saved, but the Breezeway delivery task was not created: ' + (j.task.error || 'unknown reason') + ' — open the item and try the delivery task again.')
      return it
    } catch { setErr('Could not save — check the connection and try again.'); return null }
  }, [])

  const remove = async (ids: string[]) => {
    if (!ids.length) return false
    if (!confirm(ids.length === 1 ? 'Delete this item for good? It cannot be undone.' : 'Delete ' + ids.length + ' items for good? This cannot be undone.')) return false
    try {
      const r = await fetch('/api/lost-found', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) })
      const j: any = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { setErr(j.error || 'Could not delete (' + r.status + ')'); return false }
      setItems(list => list.filter(i => ids.indexOf(i.id) < 0)); setTossQueue(list => list.filter(i => ids.indexOf(i.id) < 0)); setPicked(new Set())
      return true
    } catch { setErr('Could not delete — check the connection.'); return false }
  }
  const closeNotLF = async (ids: string[]) => {
    if (ids.length > 1 && !confirm('Close ' + ids.length + ' items as not lost & found?')) return
    const done = await Promise.all(ids.map(id => patch(id, { status: 'not_lost_found', note: 'Not a lost & found item' })))
    const ok = ids.filter((_, k) => !!done[k])
    if (tab === 'open' && ids.length > 1) setItems(list => list.filter(i => ok.indexOf(i.id) < 0))
    setPicked(new Set())
  }
  // "Hold ended" rows: the clock closed them; a person says what happened to the thing itself.
  const settleToss = async (it: Item, how: 'tossed' | 'donated' | 'keep') => {
    const body = how === 'tossed' ? { note: 'Tossed — confirmed' } : how === 'donated' ? { status: 'donated', note: 'Donated after the hold ended' } : { status: 'held', note: 'Reopened' }
    try {
      const r = await fetch('/api/lost-found', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: it.id, ...body }) })
      const j: any = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok || !j.item) { setErr(j.error || 'Could not save (' + r.status + ')'); return }
      setTossQueue(list => list.filter(x => x.id !== it.id))
      if (how === 'keep') setItems(list => [j.item as Item, ...list.filter(x => x.id !== it.id)])
    } catch { setErr('Could not save — check the connection and try again.') }
  }

  const rows = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return items
    return items.filter(i => {
      const hay = [i.unit, i.item, i.description, i.guest_name, i.guest_phone, i.guest_email, i.found_by, i.found_where, i.storage_location, i.tracking, i.ship_to, catLabel(i.category)].map(v => String(v || '').toLowerCase()).join(' \n ')
      return words.every(w => hay.includes(w))
    })
  }, [items, q])

  // Header numbers come from the list on screen, so they move the moment an item does (they used to be
  // the server's counts from the last load, and "to toss" counted items that are never tossed).
  const n = useMemo(() => {
    const c: Record<StageKey, number> = { quote_expired: 0, hold_decision: 0, sent_tell: 0, paid_no_task: 0, task_cancelled: 0, paid_waiting: 0, sent_no_tracking: 0, sent: 0, no_stay: 0, contact: 0, quote: 0, awaiting_pay: 0, waiting_guest: 0, closed: 0 }
    for (const i of items) c[stageOf(i, today)]++
    return c
  }, [items, today])
  const nShip = n.paid_no_task + n.task_cancelled + n.paid_waiting
  const nOpen = items.length - n.closed

  const groups = useMemo(() => {
    const g: Record<GroupKey, Item[]> = { ship: [], you: [], decide: [], guest: [], shipped: [], closed: [] }
    for (const i of rows) g[STAGE[stageOf(i, today)].group].push(i)
    const oldest = (a: Item, b: Item) => a.found_date < b.found_date ? -1 : a.found_date > b.found_date ? 1 : 0
    g.ship.sort((a, b) => String(a.paid_at || '').localeCompare(String(b.paid_at || '')))   // longest-waiting guest first
    g.you.sort(oldest); g.decide.sort(oldest); g.guest.sort(oldest)
    return g
  }, [rows, today])

  // The same find logged twice (once by hand, once from Slack): same unit, a day apart at most, and a word in common.
  const dupIds = useMemo(() => {
    const s = new Set<string>()
    const open = items.filter(i => !RESOLVED.includes(i.status))
    const words = (t: string) => t.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4)
    for (let a = 0; a < open.length; a++) for (let b = a + 1; b < open.length; b++) {
      const x = open[a], y = open[b]
      if ((x.listing_id || x.unit) !== (y.listing_id || y.unit)) continue
      if (Math.abs(daysBetween(x.found_date, y.found_date)) > 1) continue
      const wy = new Set(words(y.item))
      if (words(x.item).some(w => wy.has(w))) { s.add(x.id); s.add(y.id) }
    }
    return s
  }, [items])

  const jump = (id: string) => { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  const list = (arr: Item[]) => (
    <LeanList>
      {arr.map(i => (
        <div key={i.id} id={'lf-' + i.id} className={selecting ? 'flex items-stretch' : undefined}>
          {selecting && <button onClick={() => togglePick(i.id)} aria-label={picked.has(i.id) ? 'Unselect' : 'Select'} className="shrink-0 w-11 flex items-center justify-center text-muted hover:text-ink">{picked.has(i.id) ? <CheckSquare size={18} className="text-brand-700" /> : <Square size={18} />}</button>}
          <div className={selecting ? 'flex-1 min-w-0' : undefined}>
            <ItemRow i={i} today={today} holdDays={holdDays} patch={patch} focus={i.id === focusId} dup={dupIds.has(i.id)} listings={listings} onErr={setErr} onDelete={() => remove([i.id])} onNotLF={() => closeNotLF([i.id])} />
          </div>
        </div>
      ))}
    </LeanList>
  )

  const slackBad = !!slack?.state?.lastError
  return (
    <Shell>
      <LeanHead title="Lost & Found" sub={tab === 'open' && !loading ? (nOpen ? nOpen + ' open · ' + (nShip + n.no_stay + n.contact + n.quote + n.sent_no_tracking + n.sent_tell + n.quote_expired + n.hold_decision) + ' need you' : 'Nothing open') : undefined}>
        <button onClick={() => { setAdding(true); try { window.scrollTo({ top: 0, behavior: 'smooth' }) } catch { /* fine */ } }} className={btnP + ' lh-primary'}><Camera size={14} /> Log a find</button>
        {tab === 'open' && nShip > 0 && <Pill tone="rose" onClick={() => jump('lf-sec-ship')} title="The guest paid and is waiting for it to ship">{nShip} paid, not shipped</Pill>}
        {tab === 'open' && n.quote > 0 && <Pill tone="amber" onClick={() => jump('lf-sec-you')} title="The guest wants it back — work out the shipping cost and ask them to pay">{n.quote} waiting on a quote</Pill>}
        {tab === 'open' && n.contact > 0 && <Pill tone="amber" onClick={() => jump('lf-sec-you')} title="Stay attached, guest not told yet">{n.contact} to contact</Pill>}
        {tab === 'open' && n.quote_expired > 0 && <Pill tone="amber" onClick={() => jump('lf-sec-you')} title={'Asked to pay ' + QUOTE_EXPIRE_DAYS + '+ days ago and still unpaid — close it'}>{n.quote_expired} quote expired</Pill>}
        {tab === 'open' && n.hold_decision > 0 && <Pill tone="amber" onClick={() => jump('lf-sec-decide')} title="The hold ended on something valuable — it is never discarded automatically">{n.hold_decision} need a decision</Pill>}
        {tab === 'open' && n.no_stay > 0 && <Pill tone="amber" onClick={() => jump('lf-sec-you')} title="Nobody knows whose it is yet">{n.no_stay} with no stay</Pill>}
        {tab === 'open' && tossQueue.length > 0 && <Pill tone="slate" onClick={() => jump('lf-sec-toss')} title={'Past the ' + holdDays + '-day hold with nothing requested — toss or donate'}>{tossQueue.length} hold ended</Pill>}
        {slackBad && <Pill tone="amber" onClick={() => setSlackOpen(true)} title={String(slack.state.lastError)}>Slack not reading</Pill>}
      </LeanHead>

      <LeanTabs value={tab} onChange={setTab}
        tabs={[
          { key: 'open', label: 'Open', n: tab === 'open' ? nOpen : null },
          { key: 'resolved', label: 'Closed' },
          { key: 'all', label: 'All' },
        ]}
        right={<>
          <span className="relative flex-1 min-w-[11rem] sm:flex-none">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Guest, unit, item, tracking…" aria-label="Search lost and found" className={inp + ' pl-8 sm:w-56'} />
            {q && <button onClick={() => setQ('')} aria-label="Clear search" className="absolute right-1 top-1/2 -translate-y-1/2 w-8 h-8 inline-flex items-center justify-center text-muted hover:text-ink"><X size={13} /></button>}
          </span>
          <Tip label={slack?.channel ? 'Read #' + slack.channel.name + ' now' : 'Choose the Slack channel first'}><button aria-label="Read Slack now" onClick={() => slack?.channel ? syncNow() : setSlackOpen(true)} disabled={syncing} className={tool}><Slack size={14} className={syncing ? 'animate-pulse' : ''} /></button></Tip>
          <Tip label="Slack channel settings"><button aria-label="Slack channel settings" onClick={() => setSlackOpen(o => !o)} className={tool}><Settings2 size={14} /></button></Tip>
          <Tip label="Reload"><button aria-label="Reload" onClick={() => { setLoading(true); load() }} className={tool}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button></Tip>
          <button onClick={() => { setSelecting(v => !v); setPicked(new Set()) }} className={btn}>{selecting ? 'Done' : 'Clean up'}</button>
        </>} />

      {err && <div role="alert" className="sticky top-2 z-20 text-[12.5px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 flex items-start gap-2 shadow-sm"><span className="flex-1">{err}</span><button onClick={() => setErr('')} aria-label="Dismiss" className="w-8 h-8 -my-1 -mr-1.5 inline-flex items-center justify-center shrink-0"><X size={14} /></button></div>}

      {selecting && (
        <div className="sticky top-2 z-10 mb-2 flex items-center gap-2 flex-wrap rounded-lg border border-line bg-white px-3 py-2 text-[12.5px] shadow-sm">
          <button onClick={() => setPicked(picked.size === rows.length ? new Set() : new Set(rows.map(r => r.id)))} className="inline-flex items-center gap-1.5 font-semibold min-h-[36px]">
            {picked.size && picked.size === rows.length ? <CheckSquare size={16} /> : <Square size={16} />} {picked.size ? picked.size + ' selected' : 'Select all'}
          </button>
          <span className="flex-1" />
          <button disabled={!picked.size} onClick={() => closeNotLF(Array.from(picked))} className={btn}><Ban size={13} /> Not lost &amp; found</button>
          <button disabled={!picked.size} onClick={() => remove(Array.from(picked))} className={btn}><Trash2 size={13} /> Delete</button>
        </div>
      )}

      {slackOpen && <SlackPanel slack={slack} syncing={syncing} onSync={syncNow} onPick={async (id: string) => {
        try {
          const r = await fetch('/api/lost-found/slack', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelId: id }) })
          const j: any = await r.json().catch(() => ({}))
          if (!j.ok) { setErr(j.error || 'Could not save the channel (' + r.status + ')'); return }
          loadSlack()
        } catch { setErr('Could not save the channel — check the connection.') }
      }} onClose={() => setSlackOpen(false)} />}

      {adding && <NewItemForm listings={listings} existing={items} onErr={setErr} onDone={it => { setAdding(false); if (it) { setItems(l => [it, ...l]); if (tab === 'resolved') setTab('open') } }} />}

      {loading && !items.length ? <LeanEmpty>Loading…</LeanEmpty>
        : err && !items.length && !tossQueue.length ? <LeanEmpty>The list did not load. <button onClick={() => { setLoading(true); load() }} className="font-semibold text-brand-700 underline">Try again</button></LeanEmpty>
        : rows.length === 0 && !(tab === 'open' && tossQueue.length && !q.trim()) ? (
          <LeanEmpty>{q.trim() ? <>Nothing matches “{q.trim()}”{tab !== 'all' ? <> here. <button onClick={() => setTab('all')} className="font-semibold text-brand-700 underline">Search everything</button></> : '.'}</>
            : tab === 'open' ? 'Nothing open. Finds posted in the Slack channel appear here within 15 minutes — or tap “Log a find”.'
            : tab === 'resolved' ? 'Nothing closed yet.' : 'No items yet.'}</LeanEmpty>
        ) : tab === 'open' ? (
          <>
            {groups.ship.length > 0 && <div id="lf-sec-ship" className="scroll-mt-4"><LeanSection title="Paid — ship it" n={groups.ship.length} tone="rose" right="The guest has paid and is waiting">{list(groups.ship)}</LeanSection></div>}
            {groups.you.length > 0 && <div id="lf-sec-you" className="scroll-mt-4"><LeanSection title="Needs you" n={groups.you.length} right="Oldest find first">{list(groups.you)}</LeanSection></div>}
            {groups.decide.length > 0 && <div id="lf-sec-decide" className="scroll-mt-4"><LeanSection title="Hold ended — needs a decision" n={groups.decide.length} right="Valuables are never discarded automatically">{list(groups.decide)}</LeanSection></div>}
            {groups.guest.length > 0 && <LeanSection title="Waiting on the guest" n={groups.guest.length}>{list(groups.guest)}</LeanSection>}
            {groups.shipped.length > 0 && <LeanSection title="Shipped" n={groups.shipped.length} right={'Closes on its own ' + SHIPPED_CLOSE_DAYS + ' days after shipping'}>{list(groups.shipped)}</LeanSection>}
            {groups.closed.length > 0 && <LeanSection title="Closed just now" n={groups.closed.length}>{list(groups.closed)}</LeanSection>}
            {tossQueue.length > 0 && !q.trim() && (
              <div id="lf-sec-toss" className="scroll-mt-4">
                <LeanSection title="Hold ended — toss or donate" n={tossQueue.length} right={'Nothing requested within ' + holdDays + ' days'}>
                  <LeanList>
                    {tossQueue.map(i => (
                      <LeanRow key={i.id}
                        lead={<Thumb i={i} />}
                        name={i.item}
                        meta={<>{i.unit} · found {fmtShort(i.found_date)}{i.storage_location ? ' · kept at ' + i.storage_location : ''}</>}
                        actions={<span className="inline-flex items-center gap-1.5 flex-wrap">
                          <button onClick={() => settleToss(i, 'tossed')} className={btnP}><Trash2 size={13} /> Tossed</button>
                          <button onClick={() => settleToss(i, 'donated')} className={btn}><Gift size={13} /> Donated</button>
                          <button onClick={() => settleToss(i, 'keep')} title="A guest asked for it after all — put it back on the open list" className={btn}><RotateCcw size={13} /> Keep</button>
                        </span>} />
                    ))}
                  </LeanList>
                </LeanSection>
              </div>
            )}
          </>
        ) : list(rows)}

      <p className="text-[11.5px] text-muted mt-3 px-1">Items nobody collects or asks for within {holdDays} days of the find — or of the last contact with the guest — are closed as Discarded automatically and listed under “Hold ended” until someone confirms. Valuables (electronics, jewellery, documents, wallets, IDs) and anything a guest asked for are never tossed automatically. Shipped items close {SHIPPED_CLOSE_DAYS} days after shipping.</p>
    </Shell>
  )
}

function Thumb({ i }: { i: Item }) {
  return i.photos?.length
    ? <img src={photoSrc(i.photos[0])} alt="" loading="lazy" decoding="async" className="w-11 h-11 rounded-lg object-cover border border-line shrink-0 bg-slate-100" />
    : <div className="w-11 h-11 rounded-lg bg-slate-100 border border-line shrink-0 flex items-center justify-center text-muted"><Camera size={16} /></div>
}

// ── found → contacted → quoted → paid → shipped ─────────────────────────────────────────────────
function Timeline({ i }: { i: Item }) {
  const closed = RESOLVED.includes(i.status)
  const shipped = !!i.sent_at || i.status === 'shipping'
  const quoted = !!i.pay_requested_at || i.shipping_paid
  const contacted = !!i.contacted_at || quoted || shipped || i.status === 'contacted' || i.status === 'claimed'
  const cost = i.shipping_cost != null ? fmt$(Number(i.shipping_cost)) : ''
  const steps: { label: string; done: boolean; when: string }[] = [
    { label: 'Found', done: true, when: fmtShort(i.found_date) },
    { label: 'Contacted', done: contacted, when: i.contacted_at ? fmtShort(i.contacted_at) : '' },
  ]
  // An item closed without shipping (picked up, donated, discarded) ends there; everything else walks the paid-shipping path.
  if (closed && !quoted && !shipped) steps.push({ label: STATUS[i.status] || 'Closed', done: true, when: fmtShort(i.resolved_at) })
  else {
    steps.push({ label: 'Quoted', done: quoted, when: i.pay_requested_at ? [cost, fmtShort(i.pay_requested_at)].filter(Boolean).join(' · ') : quoted ? cost : '' })
    steps.push({ label: 'Paid', done: i.shipping_paid, when: i.shipping_paid ? (i.paid_at ? fmtShort(i.paid_at) : cost) : '' })
    steps.push({ label: 'Shipped', done: shipped, when: shipped ? (i.sent_at ? fmtShort(i.sent_at) : i.tracking ? 'tracking added' : '') : '' })
    if (closed) steps.push({ label: STATUS[i.status] || 'Closed', done: true, when: fmtShort(i.resolved_at) })
  }
  const nextIdx = closed ? -1 : steps.findIndex(s => !s.done)
  return (
    <ol className="flex items-start" aria-label="Progress">
      {steps.map((s, k) => (
        <li key={s.label + k} className="flex-1 min-w-0">
          <div className="flex items-center">
            <span className={'w-2.5 h-2.5 rounded-full shrink-0 ' + (s.done ? 'bg-emerald-500' : k === nextIdx ? 'bg-white ring-2 ring-brand-500' : 'bg-slate-200')} />
            {k < steps.length - 1 && <span className={'h-0.5 flex-1 mx-1 rounded ' + (steps[k + 1].done ? 'bg-emerald-300' : 'bg-slate-200')} />}
          </div>
          <div className={'mt-1 text-[11px] font-semibold truncate pr-1 ' + (s.done ? 'text-ink' : k === nextIdx ? 'text-brand-700' : 'text-muted')}>{s.label}</div>
          <div className="text-[10.5px] text-muted truncate pr-1 min-h-[14px]">{s.when}</div>
        </li>
      ))}
    </ol>
  )
}

// ── one item ────────────────────────────────────────────────────────────────────────────────────
function ItemRow({ i, today, holdDays, patch, focus, dup, listings, onErr, onDelete, onNotLF }: { i: Item; today: string; holdDays: number; patch: Patch; focus?: boolean; dup: boolean; listings: Listing[]; onErr: (e: string) => void; onDelete: () => void; onNotLF: () => void }) {
  const sk = stageOf(i, today)
  const sm = STAGE[sk]
  const open = sk !== 'closed'
  const age = daysBetween(i.found_date, today)
  const holdLeft = holdDaysLeft(i, today)   // from the find, or the last contact with the guest
  const valuable = isValuable(i)
  // The hold clock only runs on items nobody has asked for (the server never tosses anything else).
  const onClock = (i.status === 'held' || i.status === 'contacted') && !i.pay_requested_at && !i.shipping_paid
  const [isOpen, setIsOpen] = useState(!!focus)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [pickOpen, setPickOpen] = useState(false)
  const [fixUnit, setFixUnit] = useState(false)
  const run = async (body: any) => { setBusy(true); try { await patch(i.id, body) } finally { setBusy(false) } }
  // A status button carries whatever is typed in the note box with it.
  const withNote = async (body: any) => { const t = note.trim(); const r = await patch(i.id, t ? { ...body, note: t } : body); if (r) setNote('') }
  const go = async (body: any) => { setBusy(true); try { await withNote(body) } finally { setBusy(false) } }

  // A quote nobody paid: a person closes it. Nothing goes to the guest.
  const closeNoPay = () => {
    const onFolio = Array.isArray(i.folio_item_ids) && i.folio_item_ids.length > 0
    if (!confirm('Close this — the guest never paid?' + (onFolio ? '\n\nThe “Lost & found shipping” line is still on the Guesty folio: remove it in Guesty so the guest is not charged later.' : '') + '\n\nNothing is sent to the guest.')) return
    void run({ status: 'discarded', note: 'Quote expired — no payment within ' + QUOTE_EXPIRE_DAYS + ' days of the ask. Closed by a person; nothing was sent to the guest.' })
  }
  // Shipping an unpaid item is a goodwill shipment: the server refuses it without a reason.
  const shipFree = () => {
    const why = (prompt('Ship this at no charge to the guest? Say why (kept on the item):') || '').trim()
    if (why.length < 3) return
    void run({ status: 'shipping', goodwill: true, note: why })
  }
  // THE ONE NEXT STEP, as the row's button.
  let pLabel = 'Open'
  let pGo: () => void = () => setIsOpen(true)
  switch (sk) {
    case 'paid_no_task': pLabel = 'Create delivery task'; pGo = () => { void run({ action: 'push_task' }) }; break
    case 'task_cancelled': pLabel = 'New delivery task'; pGo = () => { void run({ action: 'recreate_task' }) }; break
    case 'quote_expired': pLabel = 'Close — no payment'; pGo = closeNoPay; break
    case 'hold_decision': pLabel = 'Decide'; break
    case 'sent_tell': pLabel = 'Send tracking'; break
    case 'paid_waiting': pLabel = 'Add tracking'; break
    case 'sent_no_tracking': pLabel = 'Add tracking'; break
    case 'sent': pLabel = 'Close — delivered'; pGo = () => { void run({ status: 'returned', note: 'Shipped and delivered — closed' }) }; break
    case 'no_stay': pLabel = 'Attach stay'; break
    case 'contact': pLabel = 'Contact guest'; break
    case 'quote': pLabel = 'Quote shipping'; break
    case 'awaiting_pay': pLabel = 'Mark paid'; break
    case 'waiting_guest': pLabel = 'Guest wants it'; pGo = () => { void run({ status: 'claimed' }) }; break
    case 'closed': pLabel = 'Reopen'; pGo = () => { void run({ status: 'held', note: 'Reopened' }) }; break
  }
  const waited = sk === 'awaiting_pay' ? daysSince(i.pay_requested_at) : sk === 'waiting_guest' ? daysSince(i.contacted_at) : sm.group === 'ship' ? daysSince(i.paid_at) : null
  const mailHref = i.guest_email ? 'mailto:' + i.guest_email + '?subject=' + encodeURIComponent('Something you left behind — ' + i.unit) + '&body=' + encodeURIComponent('Hi ' + (i.guest_name || '').split(' ')[0] + ',\n\nOur housekeeping team found ' + i.item.toLowerCase() + ' in the unit after your stay. We are holding it for you — let us know if you would like it shipped (at cost) or prefer to pick it up.\n\nStay Hospitality') : ''
  const showShip = (!!i.reservation_id || sk === 'sent_tell' || sk === 'sent' || sk === 'sent_no_tracking') && (sk === 'quote' || sk === 'awaiting_pay' || sk === 'quote_expired' || sk === 'sent_tell' || sm.group === 'ship' || sk === 'sent' || sk === 'sent_no_tracking' || (!open && (i.shipping_paid || !!i.pay_requested_at)))

  return (
    <LeanRow
      open={isOpen} onToggle={() => setIsOpen(o => !o)}
      tint={sm.group === 'ship' ? 'rose' : undefined}
      lead={<Thumb i={i} />}
      name={i.item}
      meta={<>{i.unit} · found {fmtShort(i.found_date)}{i.guest_name ? ' · ' + i.guest_name : ''}</>}
      tags={<>
        <Tag tone={open ? sm.tone : 'slate'}>{open ? sm.label : (STATUS[i.status] || 'Closed')}</Tag>
        {waited != null && waited >= 1 && <Tag tone={sm.group === 'ship' ? 'rose' : waited >= 3 ? 'amber' : 'slate'} title={sk === 'awaiting_pay' ? 'When the guest was asked to pay' : sk === 'waiting_guest' ? 'When the guest was contacted' : 'When the guest paid'}>{sk === 'awaiting_pay' ? (waited >= QUOTE_CHASE_DAYS ? 'chase · asked ' : 'asked ') : sk === 'waiting_guest' ? 'told ' : 'paid '}{ago(waited)}</Tag>}
        {open && onClock && holdLeft <= 7 && <Tag tone="amber" title={'Not collected or requested within ' + holdDays + ' days of the find or the last contact → ' + (valuable ? 'needs a decision (valuables are never discarded automatically)' : 'closed as Discarded')}>{holdLeft <= 0 ? 'hold ended' : 'hold ends in ' + holdLeft + 'd'}</Tag>}
        {open && !onClock && age > holdDays && sm.group !== 'ship' && sm.group !== 'shipped' && <Tag title="The guest asked for it, so it is never tossed — but it has been a while">found {age}d ago</Tag>}
        {dup && open && <Tag title="Another open item from the same unit, found within a day, with a similar name — close one as Not lost & found if it is the same thing">possible duplicate</Tag>}
      </>}
      actions={<button disabled={busy} onClick={e => { e.stopPropagation(); pGo() }} className={(open ? btnP : btn) + ' whitespace-nowrap'}>{busy ? 'Saving…' : pLabel}</button>}
    >
      {/* NEXT STEP — what to do, and the controls to do it */}
      {open && (
        <div className={'rounded-xl border px-3 py-2.5 space-y-2 ' + (sm.group === 'ship' ? 'border-rose-200 bg-rose-50/50' : 'border-brand-200 bg-brand-50/40')}>
          <div><div className={cap}>Next step</div><div className="text-[13px] font-semibold text-ink">{sm.next}</div></div>
          {sk === 'hold_decision' && (
            <div className="flex flex-wrap gap-1.5">
              <button disabled={busy} onClick={() => run({ action: 'extend_hold' })} className={btnP}><RotateCcw size={13} /> Keep holding {holdDays} more days</button>
              <button disabled={busy} onClick={() => go({ status: 'donated' })} className={btn}><Gift size={13} /> Donated</button>
              <button disabled={busy} onClick={() => { if (confirm('Mark as discarded? This closes the item.')) void go({ status: 'discarded' }) }} className={btn}><Trash2 size={13} /> Discarded</button>
              {i.guest_phone && <a href={'tel:' + i.guest_phone} className={btn}><Phone size={13} /> Call guest</a>}
            </div>
          )}
          {sk === 'quote_expired' && <div><button disabled={busy} onClick={closeNoPay} className={btnP}><X size={13} /> Close — no payment</button></div>}
          {sk === 'no_stay' && (
            <>
              {!i.listing_id && (listings.length > 0
                ? <label className="block"><span className={cap}>Which unit? (Slack said “{i.unit}”)</span><UnitPick listings={listings} value="" onPick={l => run({ listingId: l.id })} /></label>
                : <div className="text-[12px] text-muted">The unit could not be matched — search the guest by name.</div>)}
              <StayPicker listingId={i.listing_id} unit={i.unit} date={i.found_date} onPick={s => run({ stay: s })} onClose={() => {}} auto={false} />
            </>
          )}
          {(sk === 'contact' || sk === 'waiting_guest') && (
            <div className="flex flex-wrap gap-1.5">
              {i.guest_phone && <a href={'tel:' + i.guest_phone} className={btn}><Phone size={13} /> Call</a>}
              {mailHref && <a href={mailHref} className={btn}><Mail size={13} /> Email</a>}
              {sk === 'contact' && <button disabled={busy} onClick={() => go({ status: 'contacted' })} className={btnP}><Check size={13} /> Guest contacted</button>}
              <button disabled={busy} onClick={() => go({ status: 'claimed' })} className={sk === 'waiting_guest' ? btnP : btn}><Truck size={13} /> Guest wants it shipped</button>
              <button disabled={busy} onClick={() => go({ status: 'returned' })} className={btn}><PackageCheck size={13} /> Picked up</button>
            </div>
          )}
          {showShip && <ShipPay i={i} run={run} busy={busy} onErr={onErr} />}
          <div className="flex gap-1.5">
            <input value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && note.trim()) void go({}) }} placeholder="Note — left voicemail, wants it sent to NYC…" aria-label="Note" className={inp} />
            <button disabled={busy || !note.trim()} onClick={() => go({})} className={btn + ' shrink-0'}>Add note</button>
          </div>
        </div>
      )}

      <Timeline i={i} />

      <div className="grid sm:grid-cols-2 gap-3 text-[12.5px]">
        <div className="space-y-1.5">
          <div className={cap}>The guest</div>
          {i.reservation_id ? (
            <div className="rounded-lg border border-line bg-white px-2.5 py-2 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{i.guest_name || 'Guest'}</span>
                <span className="text-muted">{fmtShort(i.check_in)} → {fmtShort(i.check_out)}</span>
                <a href={'https://app.guesty.com/reservations/' + i.reservation_id + '/summary'} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline inline-flex items-center gap-0.5 py-1">Guesty <ExternalLink size={10} /></a>
                {open && !i.pay_requested_at && !i.shipping_paid && <button onClick={() => setPickOpen(o => !o)} className="text-muted hover:text-ink underline py-1">{pickOpen ? 'cancel' : 'wrong guest?'}</button>}
              </div>
              <div className="flex items-center gap-x-3 gap-y-1 text-muted flex-wrap">
                {i.guest_phone && <a href={'tel:' + i.guest_phone} className="inline-flex items-center gap-1 hover:text-ink py-1"><Phone size={11} /> {i.guest_phone}</a>}
                {mailHref && <a href={mailHref} className="inline-flex items-center gap-1 hover:text-ink py-1 break-all"><Mail size={11} /> {i.guest_email}</a>}
                {!i.guest_phone && !i.guest_email && <span>No phone or email on the booking — message them from Guesty.</span>}
              </div>
            </div>
          ) : <div className="text-muted">{i.guest_name ? 'Slack mentioned “' + i.guest_name + '” — no stay attached yet.' : 'Nobody attached yet.'}</div>}
          {pickOpen && i.reservation_id && <StayPicker listingId={i.listing_id} unit={i.unit} date={i.found_date} onPick={async s => { await run({ stay: s }); setPickOpen(false) }} onClose={() => setPickOpen(false)} auto />}
          {!open && showShip && <ShipPay i={i} run={run} busy={busy} onErr={onErr} />}
        </div>

        <div className="space-y-1.5">
          <div className={cap}>The item</div>
          {i.description && <div className="whitespace-pre-wrap text-ink/90">{i.description}</div>}
          <div className="text-muted">
            {catLabel(i.category)} · {i.unit}{i.found_where ? ' · ' + i.found_where : ''}{i.found_by ? ' · found by ' + i.found_by : ''}
            {open && listings.length > 0 && <> · <button onClick={() => setFixUnit(v => !v)} className="underline hover:text-ink">{fixUnit ? 'cancel' : 'wrong unit?'}</button></>}
          </div>
          {fixUnit && <UnitPick listings={listings} value="" onPick={async l => { await run({ listingId: l.id }); setFixUnit(false) }} />}
          <InlineField label="Kept at" value={i.storage_location} onSave={v => run({ storageLocation: v })} placeholder="Broward office, bin 3" />
          {i.photos?.length > 0 && <div className="flex gap-1.5 flex-wrap pt-1">{i.photos.map(p => <a key={p} href={photoSrc(p)} target="_blank" rel="noreferrer"><img src={photoSrc(p)} alt="" loading="lazy" decoding="async" className="w-20 h-20 rounded-lg object-cover border border-line bg-slate-100" /></a>)}</div>}
          <div className="flex items-center gap-2 flex-wrap">
            <FilePick label="Add photos" icon={<Camera size={13} />} accept="image/*" max={6} itemId={i.id} prefix="" onErr={onErr} onAdded={paths => run({ addPhotos: paths })} />
            {i.slack_permalink && <a href={i.slack_permalink} target="_blank" rel="noreferrer" className={btn}><Slack size={13} /> Slack post <ExternalLink size={11} /></a>}
          </div>
        </div>
      </div>

      {/* Everything that is NOT the next step lives down here, out of the way of a thumb. */}
      <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-line/70">
        <span className={cap + ' mr-1'}>Other</span>
        {open && sk !== 'contact' && sk !== 'waiting_guest' && <button disabled={busy} onClick={() => go({ status: 'returned' })} className={btn}><PackageCheck size={13} /> Picked up / returned</button>}
        {open && holdLeft <= 0 && sk !== 'hold_decision' && <>
          <button disabled={busy} onClick={() => go({ status: 'donated' })} className={btn}><Gift size={13} /> Donated</button>
          <button disabled={busy} onClick={() => { if (confirm('Mark as discarded? This closes the item.')) void go({ status: 'discarded' }) }} className={btn}><Trash2 size={13} /> Discarded</button>
        </>}
        {open && !i.shipping_paid && !i.sent_at && i.status !== 'shipping' && <button disabled={busy} title="A goodwill shipment: we pay the postage. Asks for the reason." onClick={shipFree} className={btn}><Truck size={13} /> Shipped at no charge</button>}
        {open && <button disabled={busy} title="Not a lost & found item — close it and keep the record" onClick={onNotLF} className={btn}><Ban size={13} /> Not lost &amp; found</button>}
        {!open && <button disabled={busy} onClick={() => run({ status: 'held', note: 'Reopened' })} className={btn}><RotateCcw size={13} /> Reopen</button>}
        <button title="Delete for good" onClick={onDelete} className={btn + ' text-muted'}><Trash2 size={13} /> Delete</button>
      </div>

      {Array.isArray(i.history) && i.history.length > 0 && (
        <details className="text-[11.5px] text-muted">
          <summary className="cursor-pointer select-none py-1.5">History ({i.history.length})</summary>
          <ul className="mt-1 space-y-0.5">{i.history.slice().reverse().map((h, k) => <li key={k}><span className="text-ink/70">{fmtWhen(h.at)}</span> · {String(h.who || '').replace(/@.*/, '')} · {h.what}{h.note ? ' — ' + h.note : ''}</li>)}</ul>
        </details>
      )}
    </LeanRow>
  )
}

function InlineField({ label, value, onSave, placeholder, inputMode }: { label: string; value: string | null | undefined; onSave: (v: string) => void; placeholder?: string; inputMode?: 'text' | 'decimal' }) {
  const [v, setV] = useState(value || '')
  useEffect(() => { setV(value || '') }, [value])
  return (
    <label className="block">
      <span className="text-[10.5px] uppercase tracking-wide text-muted">{label}</span>
      <input value={v} inputMode={inputMode} onChange={e => setV(e.target.value)} onBlur={() => { if (v !== (value || '')) onSave(v) }} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} placeholder={placeholder} className={inp} />
    </label>
  )
}

// One upload button. `capture` opens the phone's camera directly.
function FilePick({ label, icon, accept, max, itemId, prefix, capture, primary, onAdded, onErr }: { label: string; icon: JSX.Element; accept: string; max: number; itemId: string; prefix: string; capture?: boolean; primary?: boolean; onAdded: (paths: string[]) => void; onErr: (e: string) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const up = async (files: FileList | null) => {
    if (!files || !files.length) return
    setBusy(true)
    try {
      const r = await uploadAll(Array.from(files).slice(0, max), itemId, prefix)
      if (r.error) onErr(r.error)
      if (r.paths.length) onAdded(r.paths)
    } finally { setBusy(false); if (ref.current) ref.current.value = '' }
  }
  return <>
    <input ref={ref} type="file" accept={accept} multiple={!capture} capture={capture ? 'environment' : undefined} className="hidden" onChange={e => up(e.target.files)} />
    <button type="button" onClick={() => ref.current?.click()} disabled={busy} className={primary ? btnP : btn}>{icon} {busy ? 'Uploading…' : label}</button>
  </>
}

// ── whose is it? ────────────────────────────────────────────────────────────────────────────────
function StayPicker({ listingId, unit, date, onPick, onClose, auto }: { listingId: string | null; unit: string; date: string; onPick: (s: Stay) => void; onClose: () => void; auto: boolean }) {
  const [stays, setStays] = useState<Stay[] | null>(null)
  const [guest, setGuest] = useState('')
  const [mode, setMode] = useState<'unit' | 'name'>(listingId ? 'unit' : 'name')
  const [failed, setFailed] = useState(false)
  useEffect(() => { setMode(listingId ? 'unit' : 'name') }, [listingId])
  useEffect(() => {
    const ctrl = new AbortController()
    const url = mode === 'unit' && listingId ? '/api/lost-found?stays=1&listing=' + encodeURIComponent(listingId) + '&date=' + date
      : guest.trim().length >= 2 ? '/api/lost-found?stays=1&guest=' + encodeURIComponent(guest.trim()) : null
    setFailed(false)
    if (!url) { setStays([]); return }
    setStays(null)
    const t = setTimeout(() => {
      fetch(url, { cache: 'no-store', signal: ctrl.signal }).then(r => r.json()).then(j => { if (j && j.ok === false) setFailed(true); setStays(j.stays || []) })
        .catch(e => { if (e?.name !== 'AbortError') { setFailed(true); setStays([]) } })
    }, mode === 'name' ? 300 : 0)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [mode, guest, listingId, date])
  return (
    <div className="rounded-lg border border-line bg-white px-2.5 py-2 space-y-1.5">
      <div className="flex items-center gap-1.5 text-[12.5px] flex-wrap">
        <span className="font-semibold mr-1">Whose is it?</span>
        {listingId && <button onClick={() => setMode('unit')} className={'min-h-[32px] px-2 rounded-md text-[12px] ' + (mode === 'unit' ? 'font-semibold bg-brand-50 text-brand-700' : 'text-muted')}>Stays in {unit}</button>}
        <button onClick={() => setMode('name')} className={'min-h-[32px] px-2 rounded-md text-[12px] ' + (mode === 'name' ? 'font-semibold bg-brand-50 text-brand-700' : 'text-muted')}>Search by name</button>
        {auto && <button onClick={onClose} aria-label="Close" className="ml-auto w-8 h-8 inline-flex items-center justify-center text-muted hover:text-ink"><X size={14} /></button>}
      </div>
      {mode === 'name' && <input value={guest} onChange={e => setGuest(e.target.value)} placeholder="Guest name…" autoComplete="off" className={inp} />}
      {mode === 'unit' && <div className="text-[11.5px] text-muted">Checked out of {unit} in the 45 days before {fmtShort(date)} — the most recent first.</div>}
      {stays === null ? <div className="text-[12px] text-muted">Looking…</div>
        : failed ? <div className="text-[12px] text-amber-800">Could not read the bookings — try again in a moment.</div>
        : stays.length === 0 ? <div className="text-[12px] text-muted">{mode === 'unit' ? 'No stays found for that unit — try searching by name.' : guest.trim().length >= 2 ? 'No guest by that name.' : 'Type at least two letters.'}</div> : (
          <ul className="space-y-1">{stays.map((s, k) => (
            <li key={s.reservationId}>
              <button onClick={() => onPick(s)} className="w-full text-left rounded-lg border border-line bg-white px-2.5 py-2 min-h-[40px] hover:border-brand-300 text-[12.5px] flex items-center gap-2 flex-wrap">
                <Link2 size={12} className="text-muted" />
                <span className="font-semibold">{s.guestName || 'Guest'}</span>
                <span className="text-muted">{s.unit}</span>
                <span className="text-muted">{fmtShort(s.checkIn)} → {fmtShort(s.checkOut)}</span>
                {s.channel && <Tag>{s.channel}</Tag>}
                {mode === 'unit' && k === 0 && <Tag tone="emerald">most likely</Tag>}
              </button>
            </li>
          ))}</ul>
        )}
    </div>
  )
}

// ── unit picker: type a few characters ("1704"), tap the unit ───────────────────────────────────
function UnitPick({ listings, value, onPick }: { listings: Listing[]; value: string; onPick: (l: Listing) => void }) {
  const [t, setT] = useState('')
  const [editing, setEditing] = useState(!value)
  useEffect(() => { if (value) setEditing(false) }, [value])
  const hits = useMemo(() => {
    const words = t.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return [] as Listing[]
    return listings.filter(l => { const nm = l.name.toLowerCase(); return words.every(w => nm.includes(w)) }).slice(0, 8)
  }, [t, listings])
  if (value && !editing) return <button type="button" onClick={() => { setEditing(true); setT('') }} className={inp + ' text-left flex items-center justify-between gap-2'}><span className="truncate font-semibold">{value}</span><span className="text-muted text-[11.5px] shrink-0">change</span></button>
  return (
    <div>
      <input value={t} onChange={e => setT(e.target.value)} placeholder="Type the unit — 1704, Elser 31…" autoComplete="off" autoCorrect="off" className={inp} />
      {t.trim() ? (hits.length
        ? <div className="mt-1.5 flex flex-wrap gap-1.5">{hits.map(l => <button key={l.id} type="button" onClick={() => { onPick(l); setT(''); setEditing(false) }} className={btn}>{l.name}</button>)}</div>
        : <div className="text-[12px] text-muted mt-1">No unit matches “{t.trim()}”.</div>) : null}
    </div>
  )
}

// ── log a find: photo first, unit, what — the rest is optional ──────────────────────────────────
function NewItemForm({ listings, existing, onDone, onErr }: { listings: Listing[]; existing: Item[]; onDone: (it: Item | null) => void; onErr: (e: string) => void }) {
  const [f, setF] = useState({ listingId: '', unit: '', item: '', description: '', category: 'other', foundWhere: '', foundDate: todayISO(), foundBy: '', storageLocation: '' })
  const [photos, setPhotos] = useState<string[]>([])
  const [stay, setStay] = useState<Stay | null>(null)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: string) => setF(x => ({ ...x, [k]: v }))
  // Already logged? Same unit, within two days — shown before the same find goes in twice.
  const same = useMemo(() => f.listingId ? existing.filter(i => i.listing_id === f.listingId && !RESOLVED.includes(i.status) && Math.abs(daysBetween(i.found_date, f.foundDate)) <= 2).slice(0, 4) : [], [existing, f.listingId, f.foundDate])
  // Photos go up the moment they are taken, before the item exists. If the form is cancelled (or a
  // photo is taken off), they are removed again instead of being left in storage.
  const drop = (paths: string[]) => { if (paths.length) fetch('/api/lost-found/photo', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths }), keepalive: true }).catch(() => {}) }
  const cancel = () => { drop(photos); onDone(null) }
  const submit = async () => {
    if (busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/lost-found', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, photos, stay }) })
      const j: any = await r.json().catch(() => ({}))
      if (!r.ok || !j.ok) { onErr(j.error || 'Could not save (' + r.status + ')'); return }
      onDone(j.item)
    } catch { onErr('Could not save — check the connection and try again. Nothing was lost; the form is still open.') } finally { setBusy(false) }
  }
  return (
    <div className="rounded-2xl border border-line bg-white p-3 sm:p-4 mb-3 space-y-3">
      <div className="flex items-center justify-between"><div className="text-[14px] font-semibold">Log a find</div><button onClick={cancel} aria-label="Close" className="w-9 h-9 -mr-1.5 inline-flex items-center justify-center text-muted hover:text-ink"><X size={16} /></button></div>

      <div>
        <div className={cap + ' mb-1'}>1 · Photo</div>
        <div className="flex items-center gap-2 flex-wrap">
          {photos.map(p => (
            <span key={p} className="relative">
              <img src={photoSrc(p)} alt="" className="w-16 h-16 rounded-lg object-cover border border-line bg-slate-100" />
              <button onClick={() => { drop([p]); setPhotos(a => a.filter(x => x !== p)) }} aria-label="Remove photo" className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-white border border-line shadow-sm inline-flex items-center justify-center text-muted"><X size={12} /></button>
            </span>
          ))}
          <FilePick label={photos.length ? 'Another photo' : 'Take a photo'} icon={<Camera size={14} />} accept="image/*" max={1} itemId="new" prefix="" capture primary={!photos.length} onErr={onErr} onAdded={p => setPhotos(a => [...a, ...p].slice(0, 12))} />
          <FilePick label="From library" icon={<ImagePlus size={14} />} accept="image/*" max={6} itemId="new" prefix="" onErr={onErr} onAdded={p => setPhotos(a => [...a, ...p].slice(0, 12))} />
        </div>
      </div>

      <div>
        <div className={cap + ' mb-1'}>2 · Unit</div>
        {listings.length
          ? <UnitPick listings={listings} value={f.unit} onPick={l => { setF(x => ({ ...x, listingId: l.id, unit: l.name })); setStay(null) }} />
          : <input value={f.unit} onChange={e => set('unit', e.target.value)} placeholder="Arya 1704/1" className={inp} />}
        {same.length > 0 && <div className="mt-1.5 text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">Already logged for this unit: {same.map(i => i.item + ' (' + fmtShort(i.found_date) + ')').join(', ')}. Only save if this is a different thing.</div>}
      </div>

      <div>
        <div className={cap + ' mb-1'}>3 · What is it?</div>
        <input value={f.item} onChange={e => set('item', e.target.value)} placeholder="Grey Nike hoodie, size M" className={inp} />
        <div className="mt-1.5 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Category">
          {CATS.map(c => <button key={c} type="button" role="radio" aria-checked={f.category === c} onClick={() => set('category', c)} className={'min-h-[36px] px-3 rounded-lg border text-[12.5px] font-semibold ' + (f.category === c ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted hover:text-ink')}>{catLabel(c)}</button>)}
        </div>
      </div>

      {f.listingId && !stay && <StayPicker listingId={f.listingId} unit={f.unit} date={f.foundDate} onPick={setStay} onClose={() => {}} auto={false} />}
      {stay && <div className="text-[12.5px] flex items-center gap-2 flex-wrap">Belongs to <span className="font-semibold">{stay.guestName || 'Guest'}</span> <span className="text-muted">{fmtShort(stay.checkIn)} → {fmtShort(stay.checkOut)}</span> <button onClick={() => setStay(null)} className="text-muted hover:text-ink underline py-1">change</button></div>}

      {more ? (
        <div className="grid sm:grid-cols-2 gap-2">
          <label className="block"><span className="text-[10.5px] uppercase tracking-wide text-muted">Where in the unit</span><input value={f.foundWhere} onChange={e => set('foundWhere', e.target.value)} placeholder="Closet shelf" className={inp} /></label>
          <label className="block"><span className="text-[10.5px] uppercase tracking-wide text-muted">Kept at</span><input value={f.storageLocation} onChange={e => set('storageLocation', e.target.value)} placeholder="Broward office, bin 3" className={inp} /></label>
          <label className="block"><span className="text-[10.5px] uppercase tracking-wide text-muted">Found by</span><input value={f.foundBy} onChange={e => set('foundBy', e.target.value)} placeholder="Cleaner / inspector" className={inp} /></label>
          <label className="block"><span className="text-[10.5px] uppercase tracking-wide text-muted">Found on</span><input type="date" value={f.foundDate} max={todayISO()} onChange={e => set('foundDate', e.target.value || todayISO())} className={inp} /></label>
          <label className="block sm:col-span-2"><span className="text-[10.5px] uppercase tracking-wide text-muted">Details</span><input value={f.description} onChange={e => set('description', e.target.value)} placeholder="Anything that identifies it" className={inp} /></label>
        </div>
      ) : <button onClick={() => setMore(true)} className="text-[12.5px] text-brand-700 font-semibold underline py-1">Add where it was, where it is kept, who found it (optional)</button>}

      <div className="flex gap-2">
        <button onClick={submit} disabled={busy || !f.item.trim() || !f.unit.trim()} className={btnP + ' flex-1 sm:flex-none min-h-[44px] sm:min-h-[36px] sm:px-6'}>{busy ? 'Saving…' : !f.unit.trim() ? 'Pick the unit first' : !f.item.trim() ? 'Say what it is' : 'Save find'}</button>
        <button onClick={cancel} disabled={busy} className={btn + ' min-h-[44px] sm:min-h-[36px]'}>Cancel</button>
      </div>
    </div>
  )
}

// ── Slack channel ───────────────────────────────────────────────────────────────────────────────
function SlackPanel({ slack, syncing, onSync, onPick, onClose }: { slack: any; syncing: boolean; onSync: (days?: number) => void; onPick: (id: string) => void; onClose: () => void }) {
  const st = slack?.state
  const chans: { id: string; name: string; isMember: boolean }[] = slack?.channels || []
  return (
    <div className="rounded-2xl border border-line bg-white p-3 mb-3 space-y-2 text-[12.5px]">
      <div className="flex items-center justify-between"><div className="font-semibold flex items-center gap-1.5"><Slack size={14} /> Pulling from Slack</div><button onClick={onClose} aria-label="Close" className="w-9 h-9 -mr-1.5 inline-flex items-center justify-center text-muted hover:text-ink"><X size={16} /></button></div>
      <p className="text-muted">Every 15 minutes Lighthouse reads new posts in the channel below. Each find becomes an item here, with the unit, what was found and the photos. The guest is attached automatically when only one stay checked out of that unit in the three days before — otherwise you pick.</p>
      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1.5">Channel
          <select value={slack?.channel?.id || ''} onChange={e => onPick(e.target.value)} className="text-[16px] sm:text-[12.5px] min-h-[36px] border border-line rounded-lg px-2 py-1 bg-white">
            <option value="">— choose —</option>
            {chans.map(c => <option key={c.id} value={c.id}>#{c.name}{c.isMember ? '' : ' (invite @Eve first)'}</option>)}
          </select>
        </label>
        <button onClick={() => onSync()} disabled={syncing || !slack?.channel} className={btnP}><RefreshCw size={13} className={syncing ? 'animate-spin' : ''} /> {syncing ? 'Reading…' : 'Read now'}</button>
        <button onClick={() => onSync(10)} disabled={syncing || !slack?.channel} className={btn}>Re-read the last 10 days</button>
      </div>
      {slack && !chans.length && <div className="text-amber-800">Slack is not connected, or the bot can see no channels — check Integrations.</div>}
      {slack?.channel && !chans.find(c => c.id === slack.channel.id)?.isMember && chans.length > 0 && <div className="text-amber-800">Lighthouse is not in #{slack.channel.name} yet. In that channel type <code>/invite @Eve</code>.</div>}
      {st?.lastScanAt && <div className="text-muted">Last read {fmtWhen(st.lastScanAt)}{st.lastAdded ? ' — ' + st.lastAdded + ' new' : ''}{st.lastError ? <span className="text-amber-800"> — {st.lastError}</span> : null}</div>}
    </div>
  )
}

// ── PAID SHIPPING (Jon, 2026-11-05: "once you identify cost you can update here, then ask for guest to
// pay, once paid mark paid in the tab and then once paid should send breezeway task"). Cost and address
// → Ask the guest to pay (a message on their booking, plus the folio line for bookings Guesty bills;
// Airbnb guests through the Resolution Center) → Mark paid → the Breezeway ship task goes out.
// Where the guest follows the parcel. USPS unless the carrier says otherwise; no link for a carrier we do not know.
function trackLink(carrier: string | null | undefined, tracking: string): string {
  const c = String(carrier || '').toLowerCase(), t = encodeURIComponent(tracking.trim())
  if (!c || /usps|postal|priority|first.?class/.test(c)) return 'https://tools.usps.com/go/TrackConfirmAction?tLabels=' + t
  if (/ups/.test(c)) return 'https://www.ups.com/track?tracknum=' + t
  if (/fedex|fed ex/.test(c)) return 'https://www.fedex.com/fedextrack/?trknbr=' + t
  if (/dhl/.test(c)) return 'https://www.dhl.com/us-en/home/tracking.html?tracking-id=' + t
  return ''
}
const PAID_VIA = ['Card on file', 'Payment link', 'Airbnb Resolution Center', 'Cash / other']
function ShipPay({ i, run, busy, onErr }: { i: Item; run: (body: any) => Promise<void>; busy: boolean; onErr: (e: string) => void }) {
  const [asking, setAsking] = useState(false)
  const [paying, setPaying] = useState(false)
  const [via, setVia] = useState(PAID_VIA[0])
  const [telling, setTelling] = useState(false)
  const toldAt = trackingSentAt(i)
  const cost = i.shipping_cost != null ? Number(i.shipping_cost) : null
  const closed = RESOLVED.includes(i.status)
  const shipped = !!i.sent_at || i.status === 'shipping'
  const cancelled = !!i.delivery && /cancel|delet/i.test(i.delivery.status)
  const zip = (String(i.ship_to || '').match(/\b\d{5}(?:-\d{4})?\b(?!.*\b\d{5}\b)/) || [])[0]
  const markPaid = async () => {
    if (!String(i.ship_to || '').trim() && !confirm('There is no ship-to address yet, so the delivery task will say ADDRESS MISSING. Mark it paid anyway?')) return
    await run({ action: 'paid', via }); setPaying(false)
  }
  return (
    <div className="rounded-lg border border-line bg-white px-2.5 py-2 space-y-2">
      <div className={cap}>Shipping · paid by the guest</div>

      {/* THE COST COMES FROM USPS (Jon, 2026-11-05: "https://postcalc.usps.com/ here how you calculate"):
          weigh and measure the item, open the USPS calculator with the ship-to ZIP, type the price here. */}
      {!i.shipping_paid && shipped && <div className="text-[12.5px] text-muted">Shipped at no charge to the guest (goodwill) — the reason is in the history.</div>}
      {!i.shipping_paid && !closed && !shipped && (
        <div className="text-[12px] text-muted flex items-center gap-1.5 flex-wrap">
          Weigh and measure it, then
          <a href="https://postcalc.usps.com/" target="_blank" rel="noreferrer" className="text-brand-700 font-semibold hover:underline inline-flex items-center gap-0.5 py-1">get the price on USPS <ExternalLink size={10} /></a>
          {zip ? <span>· destination ZIP <b className="text-ink">{zip}</b></span> : <span>· add the ship-to address for the destination ZIP</span>}
        </div>
      )}
      <InlineField label="Ship to" value={i.ship_to} onSave={v => run({ shipTo: v })} placeholder="Name, street, city, state, ZIP" />
      <div className="grid grid-cols-2 gap-1.5">
        {i.shipping_paid
          ? <div><span className="text-[10.5px] uppercase tracking-wide text-muted">Shipping cost</span><div className="py-1.5 font-semibold">{cost != null ? fmt$(cost) : 'not recorded'}</div></div>
          : <InlineField label="Shipping cost $ (from USPS)" inputMode="decimal" value={cost != null ? String(cost) : ''} onSave={v => run({ shippingCost: v })} placeholder="18.50" />}
        <InlineField label="Carrier" value={i.shipping_carrier} onSave={v => run({ shippingCarrier: v })} placeholder="USPS" />
      </div>

      {/* 1 · ask */}
      {!i.shipping_paid && !closed && !shipped && (
        i.pay_requested_at
          ? <div className="text-[12.5px] text-muted">Asked {fmtWhen(i.pay_requested_at)} · {i.pay_requested_via}{cost != null ? ' · ' + fmt$(cost) : ''} <button onClick={() => setAsking(a => !a)} className="underline hover:text-ink ml-1 py-1">{asking ? 'cancel' : 'send a reminder'}</button></div>
          : <span className="flex gap-1.5 flex-wrap"><button disabled={busy || !cost} onClick={() => setAsking(a => !a)} className={btnP}><DollarSign size={13} /> {cost ? 'Ask guest to pay ' + fmt$(cost) : 'Type the cost to ask the guest'}</button>
            {cost ? <button disabled={busy} onClick={() => run({ action: 'request_pay', amount: cost, via: 'by hand' })} title="The team already messaged the guest (Guesty, phone, text)" className={btn}><Check size={13} /> Already asked</button> : null}</span>
      )}
      {asking && cost != null && !i.shipping_paid && !shipped && <PayAsk i={i} cost={cost} onDone={() => setAsking(false)} run={run} />}

      {/* 2 · paid */}
      {!i.shipping_paid ? (
        closed || shipped ? null : paying ? (
          <div className="flex items-center gap-1.5 flex-wrap rounded-lg bg-app/60 border border-line p-2">
            <span className="text-[12.5px]">Paid via</span>
            <select value={via} onChange={e => setVia(e.target.value)} className="text-[16px] sm:text-[12.5px] min-h-[36px] border border-line rounded-lg px-2 py-1 bg-white">{PAID_VIA.map(v => <option key={v}>{v}</option>)}</select>
            <button disabled={busy} onClick={markPaid} className={btnP}><Check size={13} /> {busy ? 'Saving…' : 'Paid — send the delivery task'}</button>
            <button onClick={() => setPaying(false)} className={btn}>Cancel</button>
          </div>
        ) : cost ? <button disabled={busy} onClick={() => setPaying(true)} className={i.pay_requested_at ? btnP : btn}><Check size={13} /> Mark paid</button> : null
      ) : (
        <div className="text-[12.5px] text-emerald-700">Paid{cost != null ? ' ' + fmt$(cost) : ''} · {i.paid_via}{i.paid_at ? ' · ' + fmtWhen(i.paid_at) : ''}{i.paid_by ? ' · ' + i.paid_by.replace(/@.*/, '') : ''}</div>
      )}

      {/* 3 · Breezeway */}
      {i.shipping_paid && (i.breezeway_task_id
        ? <div className="text-[12.5px] flex items-center gap-1.5 flex-wrap"><ClipboardList size={13} className={i.sent_at ? 'text-emerald-700' : 'text-muted'} />
          {i.sent_at ? <b className="text-emerald-700">Shipped {fmtWhen(i.sent_at)}{i.sent_by ? ' · ' + i.sent_by : ''}</b>
            : cancelled ? <><b className="text-rose-700">The delivery task was cancelled in Breezeway</b> <button disabled={busy} onClick={() => run({ action: 'recreate_task' })} className={btnP}>{busy ? 'Creating…' : 'Create a new delivery task'}</button></>
            : <span>Delivery task{i.delivery?.date ? ' set for ' + fmtShort(i.delivery.date) : ' for the next delivery Tuesday'}{i.delivery ? (i.delivery.assignees.length ? ' · ' + i.delivery.assignees.join(', ') : ' · nobody assigned in Breezeway') : ''} — completing it marks this Shipped</span>}
          <a href={'https://app.breezeway.io/task/' + i.breezeway_task_id} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline inline-flex items-center gap-0.5 py-1">#{i.breezeway_task_id} <ExternalLink size={10} /></a></div>
        : <div className="text-[12.5px] text-rose-700 flex items-center gap-2 flex-wrap">The delivery task was not created{i.breezeway_error ? ' — ' + i.breezeway_error : ''} <button disabled={busy} onClick={() => run({ action: 'push_task' })} className={btnP}>{busy ? 'Creating…' : 'Create delivery task'}</button></div>)}

      {(i.shipping_paid || shipped) && (
        <div className="flex items-end gap-1.5">
          <div className="flex-1"><InlineField label={shipped ? 'Tracking number' : 'Tracking number (adding it marks this Shipped)'} value={i.tracking} onSave={v => run({ tracking: v, ...(i.status !== 'shipping' && !closed && v ? { status: 'shipping' } : {}) })} placeholder="9400…" /></div>
          {i.tracking && trackLink(i.shipping_carrier, i.tracking) && <a href={trackLink(i.shipping_carrier, i.tracking)} target="_blank" rel="noreferrer" className={btn}>Track <ExternalLink size={11} /></a>}
        </div>
      )}

      {/* TRACKING TO THE GUEST (2026-11-10): a draft a person reads, edits and sends — never automatic. */}
      {i.tracking && shipped && (
        <div className="text-[12.5px] flex items-center gap-2 flex-wrap">
          {toldAt ? <span className="text-emerald-700">Tracking sent to the guest {fmtWhen(toldAt)}</span> : <span className="text-muted">The guest has not been sent the tracking number yet.</span>}
          {!telling && <button disabled={busy} onClick={() => setTelling(true)} className={toldAt ? btn : btnP}><Send size={13} /> {toldAt ? 'Send again' : 'Send tracking to guest'}</button>}
        </div>
      )}
      {telling && i.tracking && <TrackSend i={i} run={run} onDone={() => setTelling(false)} />}

      {/* RECEIPTS (Jon, 2026-11-05: "can we also have receipt attached") — the payment confirmation
          and the postage receipt, photos or PDFs, kept on the item. */}
      <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
        <span className="text-[10.5px] uppercase tracking-wide text-muted">Receipts</span>
        {(i.receipts || []).map((p, k) => <a key={p} href={photoSrc(p)} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline inline-flex items-center gap-0.5 py-1">{/\.pdf$/i.test(p) ? 'PDF' : 'Receipt'} {k + 1} <ExternalLink size={10} /></a>)}
        <FilePick label="Attach receipt" icon={<Plus size={13} />} accept="image/*,application/pdf" max={4} itemId={i.id} prefix="receipt_" onErr={onErr} onAdded={paths => run({ addReceipts: paths })} />
      </div>
    </div>
  )
}

function PayAsk({ i, cost, run, onDone }: { i: Item; cost: number; run: (body: any) => Promise<void>; onDone: () => void }) {
  const [ctx, setCtx] = useState<{ airbnb: boolean; conversationId: string | null; guestFirst: string; signOff: string } | null>(null)
  const [text, setText] = useState('')
  const [folio, setFolio] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  // The shipping line is already on the Guesty folio from an earlier ask: a reminder never adds it again
  // (it used to — every "ask again" billed the guest a second time).
  const onFolio = Array.isArray(i.folio_item_ids) && i.folio_item_ids.length > 0
  useEffect(() => {
    fetch('/api/lost-found?pay=' + encodeURIComponent(String(i.reservation_id)) + '&unit=' + encodeURIComponent(i.unit), { cache: 'no-store' }).then(r => r.json()).then(j => {
      if (!j.ok) { setMsg(j.error || 'Could not read the booking'); return }
      setCtx(j); setFolio(!j.airbnb && !onFolio)
      const first = j.guestFirst || (i.guest_name || '').split(' ')[0] || 'there'
      const amt = '$' + cost.toFixed(2)
      setText('Hi ' + first + ',\n\nOur housekeeping team found your ' + i.item.toLowerCase() + ' in ' + i.unit + ' after your stay, and we have it safe. We can ship it to you — shipping is ' + amt + '. '
        + (j.airbnb ? 'We will send the ' + amt + ' as a payment request through Airbnb; once it is accepted, it goes out.' : 'We have added it to your booking — you can pay with the card on file or the payment link we send you; once it is paid, it goes out.')
        + (i.ship_to ? '\n\nWe will send it to: ' + i.ship_to + ' — let us know if that should change.' : '\n\nPlease reply with the full address you would like it sent to.')
        + '\n\n' + (j.signOff || 'Stay Hospitality'))
    }).catch(() => setMsg('Could not read the booking — check the connection.'))
  }, [i.reservation_id, i.unit, i.item, i.ship_to, i.guest_name, cost, onFolio])

  const send = async (how: 'message' | 'by hand') => {
    if (busy) return
    setBusy(true); setMsg('')
    try {
      const addFolio = !!(ctx && !ctx.airbnb && folio && !onFolio)
      // Record the ask (and the folio line) first: if Guesty refuses the folio line, nothing goes to the guest.
      const r = await fetch('/api/lost-found', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: i.id, action: 'request_pay', amount: cost, folio: addFolio, via: how === 'by hand' ? 'by hand' : ctx?.airbnb ? 'guesty message + Airbnb request' : 'guesty message' }) })
      const j: any = await r.json().catch(() => ({}))
      if (!j.ok) { setMsg(j.error || 'Could not record it (' + r.status + ')'); return }
      if (how === 'message' && ctx?.conversationId) {
        const m = await fetch('/api/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: ctx.conversationId, body: text }) })
        const mj: any = await m.json().catch(() => ({}))
        if (!m.ok || !mj.ok) {
          setMsg('The ask is recorded' + (addFolio ? ' and the folio line is on the booking' : '') + ', but the message did not go: ' + (mj.error || m.status) + ' — copy it and send from Guesty.')
          // On the item's history too, so the next person does not assume the guest was told.
          await run({ note: 'The payment message did NOT send through Guesty (' + String(mj.error || m.status).slice(0, 120) + ') — send it by hand' })
          return
        }
      }
      await run({}); onDone()
    } catch { setMsg('Could not reach Lighthouse — check the connection, then look at the item before trying again.') } finally { setBusy(false) }
  }

  if (!ctx) return <div className="text-[12.5px] text-muted">{msg || 'Reading the booking…'}</div>
  return (
    <div className="rounded-lg bg-app/60 border border-line p-2 space-y-1.5">
      {ctx.airbnb
        ? <div className="text-[12.5px] text-amber-800">Airbnb booking — request <b>${cost.toFixed(2)}</b> in the Airbnb Resolution Center (Guesty can’t bill an Airbnb guest), and send the message below so the guest knows it’s coming.</div>
        : onFolio
          ? <div className="text-[12.5px] text-muted">The “Lost &amp; found shipping” line is already on the Guesty folio — this only sends the message again.{i.shipping_cost != null ? ' If the cost has changed since, fix the folio line in Guesty.' : ''}</div>
          : <label className="flex items-start gap-2 text-[12.5px] py-1"><input type="checkbox" checked={folio} onChange={e => setFolio(e.target.checked)} className="mt-0.5 w-4 h-4" /> <span>Add ${cost.toFixed(2)} “Lost &amp; found shipping” to the Guesty folio (so the card on file or payment link covers it)</span></label>}
      <textarea value={text} onChange={e => setText(e.target.value)} rows={7} aria-label="Message to the guest" className={inp + ' font-normal'} />
      {msg && <div role="alert" className="text-[12.5px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">{msg}</div>}
      <div className="flex flex-wrap gap-1.5 items-center">
        {ctx.conversationId
          ? <button disabled={busy || !text.trim()} onClick={() => send('message')} className={btnP}><Send size={13} /> {busy ? 'Sending…' : 'Send to guest'}</button>
          : <span className="text-[12.5px] text-muted">No Guesty conversation for this booking in Lighthouse — send it from Guesty, then mark it sent:</span>}
        <button disabled={busy} onClick={() => send('by hand')} className={btn}>Mark message sent</button>
        <button onClick={() => { try { void navigator.clipboard.writeText(text) } catch { /* no clipboard */ } }} className={btn}>Copy</button>
        <button onClick={onDone} className={btn}>Cancel</button>
      </div>
    </div>
  )
}

// ── TRACKING TO THE GUEST: an editable draft, sent by a person through the Guesty message path ────
// Nothing here sends on its own. The draft names the unit, the item, the carrier and the tracking
// link; the person edits it, presses Send (the same /api/messages/send the payment ask uses, with its
// duplicate guard), and "tracking sent" is written on the item's history.
function TrackSend({ i, run, onDone }: { i: Item; run: (body: any) => Promise<void>; onDone: () => void }) {
  const [ctx, setCtx] = useState<{ conversationId: string | null } | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const tracking = String(i.tracking || '').trim()
  useEffect(() => {
    let live = true
    fetch('/api/lost-found?pay=' + encodeURIComponent(String(i.reservation_id || 'none')) + '&unit=' + encodeURIComponent(i.unit), { cache: 'no-store' }).then(r => r.json()).then(j => {
      if (!live) return
      const ok = !!j && j.ok !== false
      const first = (ok && j.guestFirst) || (i.guest_name || '').split(' ')[0] || 'there'
      const link = trackLink(i.shipping_carrier, tracking)
      setCtx({ conversationId: ok && i.reservation_id ? (j.conversationId || null) : null })
      setText('Hi ' + first + ',\n\nYour ' + i.item.toLowerCase() + ' from ' + i.unit + ' is on its way' + (i.shipping_carrier ? ' with ' + i.shipping_carrier : '') + '.'
        + '\n\nTracking number: ' + tracking + (link ? '\nTrack it here: ' + link : '')
        + '\n\n' + ((ok && j.signOff) || 'Stay Hospitality'))
    }).catch(() => { if (live) setMsg('Could not read the booking — check the connection.') })
    return () => { live = false }
  }, [i.reservation_id, i.unit, i.item, i.guest_name, i.shipping_carrier, tracking])

  const send = async (how: 'message' | 'by hand') => {
    if (busy) return
    setBusy(true); setMsg('')
    try {
      if (how === 'message') {
        if (!ctx?.conversationId) return
        const m = await fetch('/api/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: ctx.conversationId, body: text }) })
        const mj: any = await m.json().catch(() => ({}))
        if (!m.ok || !mj.ok) { setMsg('The message did not go: ' + (mj.error || m.status) + ' — copy it and send it from Guesty, then press “Mark as sent”.'); return }
      }
      await run({ action: 'tracking_sent', via: how === 'message' ? 'Guesty message' : 'by hand' })
      onDone()
    } catch { setMsg('Could not reach Lighthouse — check the thread in Guesty before sending again.') } finally { setBusy(false) }
  }

  if (!ctx) return <div className="text-[12.5px] text-muted">{msg || 'Reading the booking…'}</div>
  return (
    <div className="rounded-lg bg-app/60 border border-line p-2 space-y-1.5">
      <div className="text-[12px] text-muted">Draft — read it, change anything, then send. Nothing goes to the guest until you press Send.</div>
      <textarea value={text} onChange={e => setText(e.target.value)} rows={7} aria-label="Tracking message to the guest" className={inp + ' font-normal'} />
      {msg && <div role="alert" className="text-[12.5px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">{msg}</div>}
      <div className="flex flex-wrap gap-1.5 items-center">
        {ctx.conversationId
          ? <button disabled={busy || !text.trim()} onClick={() => send('message')} className={btnP}><Send size={13} /> {busy ? 'Sending…' : 'Send to guest'}</button>
          : <span className="text-[12.5px] text-muted">No Guesty conversation for this item in Lighthouse — copy it, send it from Guesty, then mark it sent:</span>}
        <button disabled={busy} onClick={() => send('by hand')} className={btn}>Mark as sent</button>
        <button onClick={() => { try { void navigator.clipboard.writeText(text) } catch { /* no clipboard */ } }} className={btn}>Copy</button>
        <button onClick={onDone} className={btn}>Cancel</button>
      </div>
    </div>
  )
}
