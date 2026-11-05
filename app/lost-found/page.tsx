'use client'
// Lost & Found (Jon, 2026-11-04: "views lost and found items, assign to reservation and manage this
// … pull from our slack channel"). Every item a cleaner found in a unit — read from the Slack
// channel every 15 minutes (lib/lost-found-slack) or logged here by hand — with the stay it
// belongs to, who has been told, and how it got back to the guest (or didn't).
//   Held      → just logged, nobody contacted yet; the hold clock runs from the found date
//   Contacted → guest told; waiting on them
//   Claimed   → guest wants it back (pick up or ship)
//   Shipping  → in the mail (carrier + tracking + who paid)
//   Returned / Donated / Discarded → closed
import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Shell } from '@/components/Shell'
import { RefreshCw, Search, ExternalLink, Plus, X, Camera, Link2, Slack, Settings2, Phone, Mail, Truck, Check, Trash2, Gift, PackageCheck, DollarSign, Send, ClipboardList } from 'lucide-react'
import { LeanHead, LeanTabs, Pill, Tag, IconBtn, LeanList, LeanRow, LeanEmpty, type Tone } from '@/components/lean'

type Stay = { reservationId: string; listingId: string; unit: string; market: string; guestName: string; guestPhone: string | null; guestEmail: string | null; checkIn: string; checkOut: string; channel: string | null; confirmationCode: string | null; guestyUrl: string }
type Item = {
  id: string; listing_id: string | null; unit: string; market: string | null; item: string; description: string | null; category: string
  found_where: string | null; found_date: string; found_by: string | null; storage_location: string | null; photos: string[]
  reservation_id: string | null; guest_name: string | null; guest_phone: string | null; guest_email: string | null; check_in: string | null; check_out: string | null
  status: string; contacted_at: string | null; contact_note: string | null; shipping_carrier: string | null; tracking: string | null; shipping_cost: number | null; shipping_paid: boolean
  ship_to?: string | null; pay_requested_at?: string | null; pay_requested_via?: string | null; paid_at?: string | null; paid_by?: string | null; paid_via?: string | null
  breezeway_task_id?: string | null; breezeway_error?: string | null; receipts?: string[]; sent_at?: string | null; sent_by?: string | null
  resolved_at: string | null; notes: string | null; history: { at: string; who: string; what: string; note?: string }[]; slack_ts: string | null; slack_permalink: string | null; created_by: string | null; created_at: string
}
type Listing = { id: string; name: string }

const STATUS: Record<string, { label: string; tone: Tone }> = {
  held: { label: 'Held', tone: 'amber' }, contacted: { label: 'Contacted', tone: 'sky' }, claimed: { label: 'Claimed', tone: 'violet' },
  shipping: { label: 'Sent', tone: 'brand' }, returned: { label: 'Returned', tone: 'emerald' }, donated: { label: 'Donated', tone: 'slate' }, discarded: { label: 'Discarded', tone: 'slate' },
}
const CATS = ['clothing', 'electronics', 'documents', 'jewelry', 'toiletries', 'toys', 'keys_cards', 'other']
const catLabel = (c: string) => c === 'keys_cards' ? 'Keys / cards' : c.charAt(0).toUpperCase() + c.slice(1)
const RESOLVED = ['returned', 'donated', 'discarded']
function fmtShort(iso: string | null) { if (!iso) return ''; const d = new Date(iso.slice(0, 10) + 'T12:00:00'); if (isNaN(d.getTime())) return iso; return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
function fmtWhen(iso: string) { const d = new Date(iso); return isNaN(d.getTime()) ? iso : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) }
function daysBetween(a: string, b: string) { return Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / 86400000) }
function photoSrc(p: string) { return /^https?:/.test(p) ? p : '/api/lost-found/photo?path=' + encodeURIComponent(p) }
function todayISO() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date()) }

const inp = 'text-[12.5px] border border-line rounded-lg px-2 py-1.5 bg-white w-full focus:outline-none focus:ring-2 focus:ring-brand-200'
const btn = 'inline-flex items-center gap-1 text-[12px] font-semibold rounded-lg px-2.5 py-1.5 border border-line bg-white hover:bg-slate-50 disabled:opacity-50'
const btnP = 'inline-flex items-center gap-1 text-[12px] font-semibold rounded-lg px-2.5 py-1.5 bg-brand-700 text-white hover:bg-brand-800 disabled:opacity-50'

export default function LostFoundPage() {
  const [tab, setTab] = useState<'open' | 'resolved' | 'all'>('open')
  const [items, setItems] = useState<Item[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
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

  const load = useCallback(async () => {
    try {
      setErr('')
      const r = await fetch('/api/lost-found?status=' + tab, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || j.ok === false) { setErr(j.error || 'Failed to load'); return }
      setItems(j.items || []); setCounts(j.counts || {}); setHoldDays(j.holdDays || 30); setToday(j.today || todayISO())
    } catch (e: any) { setErr(String(e?.message || e)) } finally { setLoading(false) }
  }, [tab])
  useEffect(() => { setLoading(true); load() }, [load])
  // Opened from the Today strip's Lost & Found tile (?item=<id>): that item opens and scrolls into view.
  const [focusId] = useState(() => { try { return new URLSearchParams(window.location.search).get('item') || '' } catch { return '' } })
  useEffect(() => { if (focusId && items.some(i => i.id === focusId)) document.getElementById('lf-' + focusId)?.scrollIntoView({ block: 'center' }) }, [focusId, items])
  useEffect(() => {
    fetch('/api/listings?slim=1', { cache: 'no-store' }).then(r => r.json()).then(j => {
      const arr: any[] = Array.isArray(j) ? j : (j.results || j.listings || [])
      setListings(arr.map(l => ({ id: String(l.id), name: String(l.nickname || l.title || l.name || l.id) })).sort((a, b) => a.name.localeCompare(b.name)))
    }).catch(() => {})
    fetch('/api/lost-found/slack', { cache: 'no-store' }).then(r => r.json()).then(setSlack).catch(() => {})
  }, [])

  const syncNow = async (days?: number) => {
    setSyncing(true)
    try {
      const r = await fetch('/api/lost-found/slack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(days ? { days } : {}) })
      const j = await r.json()
      if (!j.ok) setErr(j.error || 'Slack sync failed'); else setErr('')
      fetch('/api/lost-found/slack', { cache: 'no-store' }).then(r => r.json()).then(setSlack).catch(() => {})
      load()
    } finally { setSyncing(false) }
  }
  const patch = async (id: string, body: any) => {
    const r = await fetch('/api/lost-found', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) })
    const j = await r.json()
    if (!r.ok || !j.ok) { setErr(j.error || 'Save failed'); return null }
    setItems(list => list.map(i => i.id === id ? j.item : i))
    return j.item as Item
  }

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return items
    return items.filter(i => [i.unit, i.item, i.description, i.guest_name, i.found_by, i.storage_location].some(v => String(v || '').toLowerCase().includes(needle)))
  }, [items, q])

  const held = counts.held || 0, contacted = counts.contacted || 0, inMotion = (counts.claimed || 0) + (counts.shipping || 0)
  const overdue = items.filter(i => !RESOLVED.includes(i.status) && daysBetween(i.found_date, today) > holdDays).length

  return (
    <Shell>
      <LeanHead title="Lost & Found">
        {tab !== 'resolved' && held > 0 && <Pill tone="amber" title="Logged, guest not yet contacted">{held} held</Pill>}
        {tab !== 'resolved' && contacted > 0 && <Pill tone="sky" title="Guest told, waiting on them">{contacted} contacted</Pill>}
        {tab !== 'resolved' && inMotion > 0 && <Pill tone="brand" title="Claimed or in the mail">{inMotion} going back</Pill>}
        {overdue > 0 && <Pill tone="rose" title={'Unresolved past the ' + holdDays + '-day hold'}>{overdue} past hold</Pill>}
        {slack?.channel && <Pill tone={slack.state?.lastError ? 'rose' : 'slate'} onClick={() => setSlackOpen(o => !o)} title={slack.state?.lastScanAt ? 'Last read ' + fmtWhen(slack.state.lastScanAt) + (slack.state.lastError ? ' — ' + slack.state.lastError : '') : 'Not read yet'}>#{slack.channel.name}</Pill>}
      </LeanHead>

      <LeanTabs value={tab} onChange={setTab}
        tabs={[
          { key: 'open', label: 'Open', n: tab === 'open' ? items.length : null },
          { key: 'resolved', label: 'Resolved' },
          { key: 'all', label: 'All' },
        ]}
        right={<>
          <span className="relative">
            <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Unit, item, guest…" className="text-[12px] border border-line rounded-lg pl-6 pr-2 py-1 bg-white w-40 focus:outline-none focus:ring-2 focus:ring-brand-200" />
          </span>
          <IconBtn title={slack?.channel ? 'Read #' + slack.channel.name + ' now' : 'Choose the Slack channel first'} onClick={() => slack?.channel ? syncNow() : setSlackOpen(true)} disabled={syncing}><Slack size={13} className={syncing ? 'animate-pulse' : ''} /></IconBtn>
          <IconBtn title="Slack channel settings" onClick={() => setSlackOpen(o => !o)}><Settings2 size={13} /></IconBtn>
          <IconBtn title="Reload" onClick={() => { setLoading(true); load() }}><RefreshCw size={13} /></IconBtn>
          <button onClick={() => setAdding(a => !a)} className={btnP}><Plus size={13} /> Log a find</button>
        </>} />

      {err && <div className="text-[12.5px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 mb-3 flex items-start gap-2"><span className="flex-1">{err}</span><button onClick={() => setErr('')}><X size={13} /></button></div>}

      {slackOpen && <SlackPanel slack={slack} syncing={syncing} onSync={syncNow} onPick={async (id: string) => {
        const r = await fetch('/api/lost-found/slack', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channelId: id }) })
        const j = await r.json(); if (!j.ok) { setErr(j.error || 'Could not save'); return }
        fetch('/api/lost-found/slack', { cache: 'no-store' }).then(r => r.json()).then(setSlack).catch(() => {})
      }} onClose={() => setSlackOpen(false)} />}

      {adding && <NewItemForm listings={listings} onDone={(it) => { setAdding(false); if (it) { setItems(l => [it, ...l]); setCounts(c => ({ ...c, held: (c.held || 0) + 1 })) } }} onErr={setErr} />}

      {loading && !items.length ? <LeanEmpty>Loading…</LeanEmpty> : rows.length === 0 ? (
        <LeanEmpty>{tab === 'open' ? 'Nothing held right now. Finds posted in Slack appear here within 15 minutes, or log one by hand.' : 'Nothing here.'}</LeanEmpty>
      ) : (
        <LeanList>
          {rows.map(i => <div key={i.id} id={'lf-' + i.id}><ItemRow i={i} today={today} holdDays={holdDays} patch={patch} focus={i.id === focusId} /></div>)}
        </LeanList>
      )}
    </Shell>
  )
}

// ── one item ────────────────────────────────────────────────────────────────────────────────────
function ItemRow({ i, today, holdDays, patch, focus }: { i: Item; today: string; holdDays: number; patch: (id: string, body: any) => Promise<Item | null>; focus?: boolean }) {
  const st = STATUS[i.status] || STATUS.held
  const age = daysBetween(i.found_date, today)
  const holdLeft = holdDays - age
  const open = !RESOLVED.includes(i.status)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [pickOpen, setPickOpen] = useState(false)
  const run = async (body: any) => { setBusy(true); try { await patch(i.id, body) } finally { setBusy(false) } }

  return (
    <LeanRow
      defaultOpen={focus}
      tint={open && holdLeft < 0 ? 'rose' : i.status === 'held' ? 'amber' : undefined}
      lead={i.photos?.length ? <img src={photoSrc(i.photos[0])} alt="" className="w-9 h-9 rounded-md object-cover border border-line shrink-0" /> : <div className="w-9 h-9 rounded-md bg-slate-100 border border-line shrink-0 flex items-center justify-center text-muted"><Camera size={14} /></div>}
      name={i.item}
      meta={<>{i.unit} · found {fmtShort(i.found_date)}{i.found_by ? ' by ' + i.found_by : ''}</>}
      tags={<>
        <Tag tone={st.tone}>{st.label}</Tag>
        {i.guest_name ? <Tag tone="emerald" title={(i.check_in ? fmtShort(i.check_in) + ' → ' + fmtShort(i.check_out) : '')}>{i.guest_name}</Tag> : open && <Tag tone="rose">No stay attached</Tag>}
        {open && (holdLeft < 0 ? <Tag tone="rose">{-holdLeft}d past hold</Tag> : holdLeft <= 7 ? <Tag tone="amber">hold ends in {holdLeft}d</Tag> : null)}
        {i.slack_ts && <Tag title="Read from Slack">Slack</Tag>}
      </>}
      actions={open && !i.reservation_id ? <button onClick={e => { e.stopPropagation(); setPickOpen(true) }} className={btn}><Link2 size={12} /> Attach stay</button> : null}
    >
      <div className="grid sm:grid-cols-2 gap-3 text-[12.5px]">
        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">The item</div>
          {i.description && <div className="whitespace-pre-wrap text-ink/90">{i.description}</div>}
          <div className="text-muted">{catLabel(i.category)}{i.found_where ? ' · ' + i.found_where : ''}{i.storage_location ? ' · kept at ' + i.storage_location : ''}</div>
          <InlineField label="Kept at" value={i.storage_location} onSave={v => run({ storageLocation: v })} placeholder="Broward office, bin 3" />
          {i.photos?.length > 0 && <div className="flex gap-1.5 flex-wrap pt-1">{i.photos.map(p => <a key={p} href={photoSrc(p)} target="_blank" rel="noreferrer"><img src={photoSrc(p)} alt="" className="w-16 h-16 rounded-md object-cover border border-line" /></a>)}</div>}
          <PhotoAdd id={i.id} onAdded={paths => run({ addPhotos: paths })} />
          {i.slack_permalink && <a href={i.slack_permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline"><Slack size={11} /> Open the Slack post <ExternalLink size={10} /></a>}
        </div>

        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-wide text-muted font-semibold">The guest</div>
          {i.reservation_id ? (
            <div className="rounded-lg border border-line bg-white px-2.5 py-2 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{i.guest_name || 'Guest'}</span>
                <span className="text-muted">{fmtShort(i.check_in)} → {fmtShort(i.check_out)}</span>
                <a href={'https://app.guesty.com/reservations/' + i.reservation_id + '/summary'} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline inline-flex items-center gap-0.5">Guesty <ExternalLink size={10} /></a>
                {open && <button onClick={() => setPickOpen(true)} className="text-muted hover:text-ink text-[11.5px]">change</button>}
              </div>
              <div className="flex items-center gap-3 text-muted flex-wrap">
                {i.guest_phone && <a href={'tel:' + i.guest_phone} className="inline-flex items-center gap-1 hover:text-ink"><Phone size={11} /> {i.guest_phone}</a>}
                {i.guest_email && <a href={'mailto:' + i.guest_email + '?subject=' + encodeURIComponent('Something you left behind — ' + i.unit) + '&body=' + encodeURIComponent('Hi ' + (i.guest_name || '').split(' ')[0] + ',\n\nOur housekeeping team found ' + i.item.toLowerCase() + ' in the unit after your stay. We are holding it for you — let us know if you would like it shipped (at cost) or prefer to pick it up.\n\nStay Hospitality')} className="inline-flex items-center gap-1 hover:text-ink"><Mail size={11} /> {i.guest_email}</a>}
              </div>
            </div>
          ) : <div className="text-muted">Nobody attached yet. {open && 'Attach the stay to see the guest’s phone and email.'}</div>}
          {(pickOpen || (open && !i.reservation_id && !i.listing_id)) && <StayPicker listingId={i.listing_id} unit={i.unit} date={i.found_date} onPick={async s => { await run({ stay: s }); setPickOpen(false) }} onClose={() => setPickOpen(false)} auto={pickOpen} />}

          {open && (
            <>
              <div className="text-[11px] uppercase tracking-wide text-muted font-semibold pt-1">Move it along</div>
              <div className="flex flex-wrap gap-1.5">
                {i.status === 'held' && <button disabled={busy} onClick={() => run({ status: 'contacted', note })} className={btnP}><Phone size={12} /> Guest contacted</button>}
                {(i.status === 'held' || i.status === 'contacted') && <button disabled={busy} onClick={() => run({ status: 'claimed', note })} className={btn}><Check size={12} /> Guest wants it</button>}
                {(i.status === 'claimed' || i.status === 'contacted') && <button disabled={busy} onClick={() => run({ status: 'shipping', note })} className={btn}><Truck size={12} /> Sent</button>}
                <button disabled={busy} onClick={() => run({ status: 'returned', note })} className={btn}><PackageCheck size={12} /> Returned</button>
                {holdLeft <= 0 && <>
                  <button disabled={busy} onClick={() => run({ status: 'donated', note })} className={btn}><Gift size={12} /> Donated</button>
                  <button disabled={busy} onClick={() => confirm('Mark as discarded? This closes the item.') && run({ status: 'discarded', note })} className={btn}><Trash2 size={12} /> Discarded</button>
                </>}
              </div>
              <input value={note} onChange={e => setNote(e.target.value)} placeholder="Note with the next step (optional) — e.g. left voicemail, guest wants it shipped to NYC" className={inp} />
              {i.reservation_id && <ShipPay i={i} run={run} busy={busy} />}
            </>
          )}
          {!open && <button disabled={busy} onClick={() => run({ status: 'held', note: 'Reopened' })} className={btn}>Reopen</button>}
        </div>
      </div>

      {Array.isArray(i.history) && i.history.length > 0 && (
        <details className="text-[11.5px] text-muted pt-1">
          <summary className="cursor-pointer select-none">History ({i.history.length})</summary>
          <ul className="mt-1 space-y-0.5">{i.history.slice().reverse().map((h, k) => <li key={k}><span className="text-ink/70">{fmtWhen(h.at)}</span> · {h.who.replace(/@.*/, '')} · {h.what}{h.note ? ' — ' + h.note : ''}</li>)}</ul>
        </details>
      )}
    </LeanRow>
  )
}

function InlineField({ label, value, onSave, placeholder }: { label: string; value: string | null | undefined; onSave: (v: string) => void; placeholder?: string }) {
  const [v, setV] = useState(value || '')
  useEffect(() => { setV(value || '') }, [value])
  return (
    <label className="block">
      <span className="text-[10.5px] uppercase tracking-wide text-muted">{label}</span>
      <input value={v} onChange={e => setV(e.target.value)} onBlur={() => { if (v !== (value || '')) onSave(v) }} placeholder={placeholder} className={inp} />
    </label>
  )
}

function PhotoAdd({ id, onAdded }: { id: string; onAdded: (paths: string[]) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const up = async (files: FileList | null) => {
    if (!files || !files.length) return
    setBusy(true)
    try {
      const paths: string[] = []
      for (const f of Array.from(files).slice(0, 6)) {
        const b64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(f) })
        const r = await fetch('/api/lost-found/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ b64, filename: f.name, contentType: f.type || 'image/jpeg', itemId: id }) })
        const j = await r.json(); if (j.ok && j.path) paths.push(j.path)
      }
      if (paths.length) onAdded(paths)
    } finally { setBusy(false); if (ref.current) ref.current.value = '' }
  }
  return <>
    <input ref={ref} type="file" accept="image/*" multiple className="hidden" onChange={e => up(e.target.files)} />
    <button onClick={() => ref.current?.click()} disabled={busy} className="inline-flex items-center gap-1 text-[11.5px] text-brand-700 hover:underline"><Camera size={11} /> {busy ? 'Uploading…' : 'Add photos'}</button>
  </>
}

// ── whose is it? ────────────────────────────────────────────────────────────────────────────────
function StayPicker({ listingId, unit, date, onPick, onClose, auto }: { listingId: string | null; unit: string; date: string; onPick: (s: Stay) => void; onClose: () => void; auto: boolean }) {
  const [stays, setStays] = useState<Stay[] | null>(null)
  const [guest, setGuest] = useState('')
  const [mode, setMode] = useState<'unit' | 'name'>(listingId ? 'unit' : 'name')
  useEffect(() => {
    const ctrl = new AbortController()
    const url = mode === 'unit' && listingId ? '/api/lost-found?stays=1&listing=' + encodeURIComponent(listingId) + '&date=' + date
      : guest.trim().length >= 2 ? '/api/lost-found?stays=1&guest=' + encodeURIComponent(guest.trim()) : null
    if (!url) { setStays([]); return }
    setStays(null)
    const t = setTimeout(() => fetch(url, { cache: 'no-store', signal: ctrl.signal }).then(r => r.json()).then(j => setStays(j.stays || [])).catch(() => setStays([])), mode === 'name' ? 300 : 0)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [mode, guest, listingId, date])
  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50/40 px-2.5 py-2 space-y-1.5">
      <div className="flex items-center gap-2 text-[12px]">
        <span className="font-semibold">Whose is it?</span>
        {listingId && <button onClick={() => setMode('unit')} className={'text-[11.5px] ' + (mode === 'unit' ? 'font-semibold text-brand-700' : 'text-muted')}>Stays in {unit}</button>}
        <button onClick={() => setMode('name')} className={'text-[11.5px] ' + (mode === 'name' ? 'font-semibold text-brand-700' : 'text-muted')}>Search by name</button>
        {auto && <button onClick={onClose} className="ml-auto text-muted hover:text-ink"><X size={13} /></button>}
      </div>
      {mode === 'name' && <input autoFocus value={guest} onChange={e => setGuest(e.target.value)} placeholder="Guest name…" className={inp} />}
      {mode === 'unit' && <div className="text-[11px] text-muted">Checked out of {unit} in the 45 days before {fmtShort(date)} — the most recent first.</div>}
      {stays === null ? <div className="text-[11.5px] text-muted">Looking…</div> : stays.length === 0 ? <div className="text-[11.5px] text-muted">{mode === 'unit' ? 'No stays found for that unit — try searching by name.' : guest.trim().length >= 2 ? 'No match.' : ''}</div> : (
        <ul className="space-y-1">{stays.map((s, k) => (
          <li key={s.reservationId}>
            <button onClick={() => onPick(s)} className="w-full text-left rounded-md border border-line bg-white px-2 py-1.5 hover:border-brand-300 text-[12px] flex items-center gap-2 flex-wrap">
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

// ── log by hand ─────────────────────────────────────────────────────────────────────────────────
function NewItemForm({ listings, onDone, onErr }: { listings: Listing[]; onDone: (it: Item | null) => void; onErr: (e: string) => void }) {
  const [f, setF] = useState({ listingId: '', unit: '', item: '', description: '', category: 'other', foundWhere: '', foundDate: todayISO(), foundBy: '', storageLocation: '' })
  const [stay, setStay] = useState<Stay | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: string, v: string) => setF(x => ({ ...x, [k]: v }))
  const submit = async () => {
    setBusy(true)
    try {
      const r = await fetch('/api/lost-found', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, stay }) })
      const j = await r.json()
      if (!r.ok || !j.ok) { onErr(j.error || 'Could not save'); return }
      onDone(j.item)
    } finally { setBusy(false) }
  }
  return (
    <div className="rounded-xl border border-line bg-white p-3 mb-3 space-y-2">
      <div className="flex items-center justify-between"><div className="text-[13px] font-semibold">Log a find</div><button onClick={() => onDone(null)} className="text-muted hover:text-ink"><X size={14} /></button></div>
      <div className="grid sm:grid-cols-3 gap-2">
        <label className="block sm:col-span-1"><span className="text-[10.5px] uppercase tracking-wide text-muted">Unit</span>
          {listings.length ? (
            <select value={f.listingId} onChange={e => { const l = listings.find(x => x.id === e.target.value); setF(x => ({ ...x, listingId: e.target.value, unit: l ? l.name : x.unit })); setStay(null) }} className={inp}>
              <option value="">Pick a unit…</option>{listings.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          ) : <input value={f.unit} onChange={e => set('unit', e.target.value)} placeholder="Arya 1704/1" className={inp} />}
        </label>
        <label className="block"><span className="text-[10.5px] uppercase tracking-wide text-muted">Found on</span><input type="date" value={f.foundDate} onChange={e => set('foundDate', e.target.value)} className={inp} /></label>
        <label className="block"><span className="text-[10.5px] uppercase tracking-wide text-muted">Found by</span><input value={f.foundBy} onChange={e => set('foundBy', e.target.value)} placeholder="Cleaner / inspector" className={inp} /></label>
        <label className="block sm:col-span-2"><span className="text-[10.5px] uppercase tracking-wide text-muted">What</span><input value={f.item} onChange={e => set('item', e.target.value)} placeholder="Grey Nike hoodie, size M" className={inp} /></label>
        <label className="block"><span className="text-[10.5px] uppercase tracking-wide text-muted">Category</span><select value={f.category} onChange={e => set('category', e.target.value)} className={inp}>{CATS.map(c => <option key={c} value={c}>{catLabel(c)}</option>)}</select></label>
        <label className="block"><span className="text-[10.5px] uppercase tracking-wide text-muted">Where in the unit</span><input value={f.foundWhere} onChange={e => set('foundWhere', e.target.value)} placeholder="Closet shelf" className={inp} /></label>
        <label className="block"><span className="text-[10.5px] uppercase tracking-wide text-muted">Kept at</span><input value={f.storageLocation} onChange={e => set('storageLocation', e.target.value)} placeholder="Broward office, bin 3" className={inp} /></label>
        <label className="block sm:col-span-3"><span className="text-[10.5px] uppercase tracking-wide text-muted">Details</span><input value={f.description} onChange={e => set('description', e.target.value)} placeholder="Anything that identifies it" className={inp} /></label>
      </div>
      {f.listingId && !stay && <StayPicker listingId={f.listingId} unit={f.unit} date={f.foundDate} onPick={setStay} onClose={() => {}} auto={false} />}
      {stay && <div className="text-[12px] flex items-center gap-2">Attached to <span className="font-semibold">{stay.guestName}</span> <span className="text-muted">{fmtShort(stay.checkIn)} → {fmtShort(stay.checkOut)}</span> <button onClick={() => setStay(null)} className="text-muted hover:text-ink"><X size={12} /></button></div>}
      <div className="flex justify-end gap-2"><button onClick={() => onDone(null)} className={btn}>Cancel</button><button onClick={submit} disabled={busy || !f.item || !f.unit} className={btnP}>Save</button></div>
    </div>
  )
}

// ── Slack channel ───────────────────────────────────────────────────────────────────────────────
function SlackPanel({ slack, syncing, onSync, onPick, onClose }: { slack: any; syncing: boolean; onSync: (days?: number) => void; onPick: (id: string) => void; onClose: () => void }) {
  const st = slack?.state
  const chans: { id: string; name: string; isMember: boolean }[] = slack?.channels || []
  return (
    <div className="rounded-xl border border-line bg-white p-3 mb-3 space-y-2 text-[12.5px]">
      <div className="flex items-center justify-between"><div className="font-semibold flex items-center gap-1.5"><Slack size={13} /> Pulling from Slack</div><button onClick={onClose} className="text-muted hover:text-ink"><X size={14} /></button></div>
      <p className="text-muted">Every 15 minutes Lighthouse reads new posts in the channel below. Each find becomes an item here, with the unit, what was found and the photos. The guest is attached automatically when only one stay checked out of that unit in the three days before — otherwise you pick.</p>
      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-1.5">Channel
          <select value={slack?.channel?.id || ''} onChange={e => onPick(e.target.value)} className="text-[12.5px] border border-line rounded-lg px-2 py-1 bg-white">
            <option value="">— choose —</option>
            {chans.map(c => <option key={c.id} value={c.id}>#{c.name}{c.isMember ? '' : ' (invite @Eve first)'}</option>)}
          </select>
        </label>
        <button onClick={() => onSync()} disabled={syncing || !slack?.channel} className={btnP}><RefreshCw size={12} className={syncing ? 'animate-spin' : ''} /> Read now</button>
        <button onClick={() => onSync(10)} disabled={syncing || !slack?.channel} className={btn}>Re-read the last 10 days</button>
      </div>
      {!chans.length && <div className="text-rose-700">Slack is not connected, or the bot can see no channels — check Integrations.</div>}
      {slack?.channel && !chans.find(c => c.id === slack.channel.id)?.isMember && chans.length > 0 && <div className="text-amber-700">Lighthouse is not in #{slack.channel.name} yet. In that channel type <code>/invite @Eve</code>.</div>}
      {st?.lastScanAt && <div className="text-muted">Last read {fmtWhen(st.lastScanAt)}{st.lastAdded ? ' — ' + st.lastAdded + ' new' : ''}{st.lastError ? <span className="text-rose-700"> — {st.lastError}</span> : null}</div>}
    </div>
  )
}

// ── PAID SHIPPING (Jon, 2026-11-05: "once you identify cost you can update here, then ask for guest to
// pay, once paid mark paid in the tab and then once paid should send breezeway task"). Cost and address
// → Ask the guest to pay (a message on their booking, plus the folio line for bookings Guesty bills;
// Airbnb guests through the Resolution Center) → Mark paid → the Breezeway ship task goes out.
const PAID_VIA = ['Card on file', 'Payment link', 'Airbnb Resolution Center', 'Cash / other']
function ShipPay({ i, run, busy }: { i: Item; run: (body: any) => Promise<void>; busy: boolean }) {
  const [asking, setAsking] = useState(false)
  const [paying, setPaying] = useState(false)
  const [via, setVia] = useState(PAID_VIA[0])
  const cost = i.shipping_cost != null ? Number(i.shipping_cost) : null
  const fmt$ = (n: number) => '$' + n.toFixed(2)
  const step = i.sent_at || i.status === 'shipping' ? 4 : i.shipping_paid ? (i.breezeway_task_id ? 3 : 2) : i.pay_requested_at ? 1 : 0
  return (
    <div className="rounded-lg border border-line bg-white px-2.5 py-2 space-y-1.5 mt-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] uppercase tracking-wide text-muted font-semibold">Ship it · paid by the guest</span>
        {(['Cost', 'Message sent', 'Paid', 'Delivery task', 'Sent'] as const).map((l, k) => (
          <span key={l} className={'text-[10.5px] px-1.5 py-0.5 rounded ' + (k <= step ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-muted')}>{k < step || (k === 0 && cost) ? '✓ ' : ''}{l}</span>
        ))}
      </div>
      {/* THE COST COMES FROM USPS (Jon, 2026-11-05: "https://postcalc.usps.com/ here how you calculate"):
          weigh and measure the item, open the USPS calculator with the ship-to ZIP, type the price here. */}
      <div className="text-[11.5px] text-muted flex items-center gap-1.5 flex-wrap">
        Weigh and measure it, then
        <a href="https://postcalc.usps.com/" target="_blank" rel="noreferrer" className="text-brand-700 font-semibold hover:underline inline-flex items-center gap-0.5">get the price on USPS <ExternalLink size={10} /></a>
        {(() => { const zip = (String(i.ship_to || '').match(/\b\d{5}(?:-\d{4})?\b(?!.*\b\d{5}\b)/) || [])[0]; return zip ? <span>· destination ZIP <b className="text-ink">{zip}</b></span> : <span>· add the ship-to address for the destination ZIP</span> })()}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <InlineField label="Shipping cost $ (from USPS)" value={cost != null ? String(cost) : ''} onSave={v => run({ shippingCost: v })} placeholder="18.50" />
        <InlineField label="Carrier" value={i.shipping_carrier} onSave={v => run({ shippingCarrier: v })} placeholder="USPS" />
      </div>
      <InlineField label="Ship to" value={i.ship_to} onSave={v => run({ shipTo: v })} placeholder="Name, street, city, state, ZIP" />

      {/* 1 · ask */}
      {!i.shipping_paid && (
        i.pay_requested_at
          ? <div className="text-[12px] text-muted">Asked {fmtWhen(i.pay_requested_at)} · {i.pay_requested_via}{cost != null ? ' · ' + fmt$(cost) : ''} <button onClick={() => setAsking(a => !a)} className="underline hover:text-ink ml-1">ask again</button></div>
          : <span className="inline-flex gap-1.5 flex-wrap"><button disabled={busy || !cost} onClick={() => setAsking(a => !a)} title={cost ? '' : 'Type the shipping cost first'} className={btnP}><DollarSign size={12} /> Ask guest to pay{cost ? ' ' + fmt$(cost) : ''}</button>
            <button disabled={busy || !cost} onClick={() => run({ action: 'request_pay', amount: cost, via: 'by hand' })} title="The team already messaged the guest (Guesty, phone, text)" className={btn}><Check size={12} /> Mark message sent</button></span>
      )}
      {asking && cost != null && <PayAsk i={i} cost={cost} onDone={() => setAsking(false)} run={run} />}

      {/* 2 · paid */}
      {!i.shipping_paid ? (
        paying ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[12px]">Paid via</span>
            <select value={via} onChange={e => setVia(e.target.value)} className="text-[12px] border border-line rounded-lg px-2 py-1 bg-white">{PAID_VIA.map(v => <option key={v}>{v}</option>)}</select>
            <button disabled={busy} onClick={async () => { await run({ action: 'paid', via }); setPaying(false) }} className={btnP}><Check size={12} /> Paid — create Lost &amp; Found Delivery</button>
            <button onClick={() => setPaying(false)} className={btn}>Cancel</button>
          </div>
        ) : <button disabled={busy || !cost} onClick={() => setPaying(true)} className={btn}><Check size={12} /> Mark paid</button>
      ) : (
        <div className="text-[12px] text-emerald-700">Paid{cost != null ? ' ' + fmt$(cost) : ''} · {i.paid_via}{i.paid_at ? ' · ' + fmtWhen(i.paid_at) : ''}{i.paid_by ? ' · ' + i.paid_by.replace(/@.*/, '') : ''}</div>
      )}

      {/* 3 · Breezeway */}
      {i.shipping_paid && (i.breezeway_task_id
        ? <div className="text-[12px] flex items-center gap-1.5 flex-wrap"><ClipboardList size={12} className="text-emerald-700" /> {i.sent_at ? <b className="text-emerald-700">Sent {fmtWhen(i.sent_at)}{i.sent_by ? ' · ' + i.sent_by : ''}</b> : 'Lost & Found Delivery (inspection, Lost and Found property, Tuesday) — Sent once the task is completed'} <a href={'https://app.breezeway.io/task/' + i.breezeway_task_id} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline inline-flex items-center gap-0.5">#{i.breezeway_task_id} <ExternalLink size={10} /></a></div>
        : <div className="text-[12px] text-rose-700 flex items-center gap-2 flex-wrap">Breezeway task not created{i.breezeway_error ? ' — ' + i.breezeway_error : ''} <button disabled={busy} onClick={() => run({ action: 'push_task' })} className={btn}>Retry</button></div>)}
      {/* RECEIPTS (Jon, 2026-11-05: "can we also have receipt attached") — the payment confirmation
          and the postage receipt, photos or PDFs, kept on the item. */}
      <div className="flex items-center gap-2 flex-wrap text-[12px]">
        <span className="text-[10.5px] uppercase tracking-wide text-muted">Receipts</span>
        {(i.receipts || []).map((p, k) => <a key={p} href={photoSrc(p)} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline inline-flex items-center gap-0.5">{/\.pdf$/i.test(p) ? 'PDF' : 'Receipt'} {k + 1} <ExternalLink size={10} /></a>)}
        <ReceiptAdd id={i.id} onAdded={paths => run({ addReceipts: paths })} />
      </div>
      {i.shipping_paid && <InlineField label="Tracking" value={i.tracking} onSave={v => run({ tracking: v, ...(i.status !== 'shipping' && v ? { status: 'shipping' } : {}) })} placeholder="9400… (marks it shipped)" />}
    </div>
  )
}

function PayAsk({ i, cost, run, onDone }: { i: Item; cost: number; run: (body: any) => Promise<void>; onDone: () => void }) {
  const [ctx, setCtx] = useState<{ airbnb: boolean; conversationId: string | null; guestFirst: string; signOff: string } | null>(null)
  const [text, setText] = useState('')
  const [folio, setFolio] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    fetch('/api/lost-found?pay=' + encodeURIComponent(String(i.reservation_id)) + '&unit=' + encodeURIComponent(i.unit), { cache: 'no-store' }).then(r => r.json()).then(j => {
      if (!j.ok) { setMsg(j.error || 'Could not read the booking'); return }
      setCtx(j); setFolio(!j.airbnb)
      const first = j.guestFirst || (i.guest_name || '').split(' ')[0] || 'there'
      const amt = '$' + cost.toFixed(2)
      setText('Hi ' + first + ',\n\nOur housekeeping team found your ' + i.item.toLowerCase() + ' in ' + i.unit + ' after your stay, and we have it safe. We can ship it to you — shipping is ' + amt + '. '
        + (j.airbnb ? 'We will send the ' + amt + ' as a payment request through Airbnb; once it is accepted, it goes out.' : 'We have added it to your booking — you can pay with the card on file or the payment link we send you; once it is paid, it goes out.')
        + (i.ship_to ? '\n\nWe will send it to: ' + i.ship_to + ' — let us know if that should change.' : '\n\nPlease reply with the full address you would like it sent to.')
        + '\n\n' + (j.signOff || 'Stay Hospitality'))
    }).catch(e => setMsg(String(e)))
  }, [i.reservation_id, i.unit, i.item, i.ship_to, i.guest_name, cost])

  const send = async (how: 'message' | 'by hand') => {
    setBusy(true); setMsg('')
    try {
      // Record the ask (and the folio line) first: if Guesty refuses the folio line, nothing goes to the guest.
      const r = await fetch('/api/lost-found', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: i.id, action: 'request_pay', amount: cost, folio: !!(ctx && !ctx.airbnb && folio), via: how === 'by hand' ? 'by hand' : ctx?.airbnb ? 'guesty message + Airbnb request' : 'guesty message' }) })
      const j = await r.json()
      if (!j.ok) { setMsg(j.error || 'Could not record it'); return }
      if (how === 'message' && ctx?.conversationId) {
        const m = await fetch('/api/messages/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: ctx.conversationId, body: text }) })
        const mj = await m.json().catch(() => ({}))
        if (!m.ok || !mj.ok) { setMsg('The ask is recorded' + (folio && !ctx.airbnb ? ' and the folio line is on the booking' : '') + ', but the message did not go: ' + (mj.error || m.status) + ' — copy it and send from Guesty.'); await run({}); return }
      }
      await run({}); onDone()
    } finally { setBusy(false) }
  }

  if (!ctx) return <div className="text-[12px] text-muted">{msg || 'Reading the booking…'}</div>
  return (
    <div className="rounded-lg bg-app/60 border border-line p-2 space-y-1.5">
      {ctx.airbnb
        ? <div className="text-[12px] text-amber-800">Airbnb booking — request <b>${cost.toFixed(2)}</b> in the Airbnb Resolution Center (Guesty can’t bill an Airbnb guest), and send the message below so the guest knows it’s coming.</div>
        : <label className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" checked={folio} onChange={e => setFolio(e.target.checked)} /> Add ${cost.toFixed(2)} “Lost &amp; found shipping” to the Guesty folio (so the card on file or payment link covers it)</label>}
      <textarea value={text} onChange={e => setText(e.target.value)} rows={7} className={inp + ' font-normal'} />
      {msg && <div className="text-[12px] text-rose-700">{msg}</div>}
      <div className="flex flex-wrap gap-1.5">
        {ctx.conversationId
          ? <button disabled={busy || !text.trim()} onClick={() => send('message')} className={btnP}><Send size={12} /> {busy ? 'Sending…' : 'Send to guest'}</button>
          : <span className="text-[12px] text-muted">No Guesty conversation for this booking in Lighthouse — send it from Guesty, then mark it sent:</span>}
        <button disabled={busy} onClick={() => send('by hand')} className={btn}>Mark message sent</button>
        <button onClick={() => { try { navigator.clipboard.writeText(text) } catch {} }} className={btn}>Copy</button>
        <button onClick={onDone} className={btn}>Cancel</button>
      </div>
    </div>
  )
}

function ReceiptAdd({ id, onAdded }: { id: string; onAdded: (paths: string[]) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const up = async (files: FileList | null) => {
    if (!files || !files.length) return
    setBusy(true)
    try {
      const paths: string[] = []
      for (const f of Array.from(files).slice(0, 4)) {
        const b64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(f) })
        const r = await fetch('/api/lost-found/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ b64, filename: 'receipt_' + f.name, contentType: f.type || 'application/octet-stream', itemId: id }) })
        const j = await r.json(); if (j.ok && j.path) paths.push(j.path)
      }
      if (paths.length) onAdded(paths)
    } finally { setBusy(false); if (ref.current) ref.current.value = '' }
  }
  return <>
    <input ref={ref} type="file" accept="image/*,application/pdf" multiple className="hidden" onChange={e => up(e.target.files)} />
    <button onClick={() => ref.current?.click()} disabled={busy} className="inline-flex items-center gap-1 text-[11.5px] text-brand-700 hover:underline"><Plus size={11} /> {busy ? 'Uploading…' : 'Attach receipt'}</button>
  </>
}
