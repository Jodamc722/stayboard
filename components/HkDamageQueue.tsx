'use client'
// HK DAMAGE REPORTS — the queue at the top of the Claims board (lib/hk-damage, /api/claims/hk).
// Jon, 2026-10-07: "It should populate as 'Hey, new HK damage report added. Here are the general
// details.' Autofill it. The team will then click on it, either autofill it or close it, meaning it's
// not claimable."
// Each card: the unit, what housekeeping found, the guest who just left, the filing clock, the
// photos — and two buttons. Autofill claim makes the draft (stay, items, photos, the post as
// evidence) and opens it; Not claimable files it with a reason. Handled ones fold away underneath.
import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, ExternalLink, Wand2, X, ChevronDown, Pencil, Camera } from 'lucide-react'
import { Tag, Pill, type Tone } from '@/components/lean'

type Stay = { reservationId: string; guestName: string; channel: string; confirmationCode: string | null; checkIn: string; checkOut: string; ownerStay: boolean; deadline: string | null; due: string | null }
type Report = {
  id: string; postedAt: string; author: string; text: string; permalink: string | null
  photos: string[]; photoCount: number; photoError: string | null
  unitAsWritten: string; listingId: string | null; unit: string | null
  summary: string; items: { description: string; qty: number }[]; category: string
  claimable: 'likely' | 'maybe' | 'no'; reason: string; stay: Stay | null
  status: 'new' | 'claimed' | 'closed'; claimId?: string | null; closedReason?: string | null; handledBy?: string | null; handledAt?: string | null
}
type Payload = { ok: boolean; reports: Report[]; lastScanAt: string | null; lastError: string | null; closeReasons: string[]; error?: string }

const CLAIM_TONE: Record<string, Tone> = { likely: 'emerald', maybe: 'amber', no: 'slate' }
const CLAIM_WORD: Record<string, string> = { likely: 'Likely claimable', maybe: 'Maybe claimable', no: 'Probably not claimable' }
const fileHref = (p: string) => '/api/claims/file?path=' + encodeURIComponent(p)
const md = (d: string | null | undefined) => d ? new Date(d.slice(0, 10) + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : ''
function ago(iso: string) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (m < 60) return m + 'm ago'
  const h = Math.round(m / 60); if (h < 24) return h + 'h ago'
  return Math.round(h / 24) + 'd ago'
}
function daysTo(ymd: string | null) {
  if (!ymd) return null
  const t = new Date(); const today = Date.UTC(t.getFullYear(), t.getMonth(), t.getDate())
  return Math.round((Date.parse(ymd + 'T00:00:00Z') - today) / 86400000)
}
async function post(body: any) {
  const r = await fetch('/api/claims/hk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || !j.ok) throw new Error(j.error || 'Something went wrong.')
  return j
}

export function HkDamageQueue({ onOpenClaim, onClaimsChanged, focusId }: { onOpenClaim: (id: string) => void; onClaimsChanged: () => void; focusId?: string | null }) {
  const [data, setData] = useState<Payload | null>(null)
  const [scanning, setScanning] = useState(false)
  const [err, setErr] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [note, setNote] = useState('')
  const load = useCallback(async () => {
    try { const r = await fetch('/api/claims/hk', { cache: 'no-store' }); const j = await r.json(); if (j.ok) setData(j); else setErr(j.error || 'Could not load HK reports.') } catch (e: any) { setErr(String(e?.message || e)) }
  }, [])
  useEffect(() => { load(); const t = setInterval(load, 120000); return () => clearInterval(t) }, [load])
  const scan = async () => { setScanning(true); setErr(''); try { await post({ action: 'scan' }); await load() } catch (e: any) { setErr(e.message) } finally { setScanning(false) } }
  const patch = (r: Report) => setData(d => d ? { ...d, reports: d.reports.map(x => x.id === r.id ? r : x) } : d)

  if (!data) return null
  // TOO LATE IS NOT NEW (2026-11-10). A report whose stay is already past the channel's filing
  // cutoff sat in the queue as "new" for good, wearing the same badge as one posted this morning.
  // It is marked "Too late to file", sorted under the live ones and left out of the "new" count —
  // still there to close with a reason, or to autofill if someone knows better.
  const tooLate = (r: Report) => { const h = daysTo(r.stay?.deadline || null); return h != null && h < 0 }
  // SAME STAY, SEVERAL POSTS: kept next to each other and labelled — Autofill already puts every
  // report about one stay onto ONE claim.
  const keyOf = (r: Report) => r.stay?.reservationId ? 's:' + r.stay.reservationId : r.listingId ? 'u:' + r.listingId + ':' + r.postedAt.slice(0, 10) : 'r:' + r.id
  const allOpen = data.reports.filter(r => r.status === 'new')
  const groupN: Record<string, number> = {}
  for (const r of allOpen) groupN[keyOf(r)] = (groupN[keyOf(r)] || 0) + 1
  const firstAt: Record<string, string> = {}
  for (const r of allOpen) { const k = keyOf(r); if (!firstAt[k] || r.postedAt > firstAt[k]) firstAt[k] = r.postedAt }
  const open = allOpen.slice().sort((a, b) =>
    Number(tooLate(a)) - Number(tooLate(b))
    || firstAt[keyOf(b)].localeCompare(firstAt[keyOf(a)]) || keyOf(a).localeCompare(keyOf(b))
    || b.postedAt.localeCompare(a.postedAt))
  const nLate = open.filter(tooLate).length
  const nLive = open.length - nLate
  const done = data.reports.filter(r => r.status !== 'new')
  return (
    <section className="mb-5">
      <div className="flex items-baseline gap-2 flex-wrap px-1 mb-1.5">
        <h2 className="text-[13px] font-bold text-ink">HK damage reports</h2>
        <span className="text-[12px] text-muted">from #vr-hkdamagereports — autofill a claim or close it as not claimable</span>
        {nLive ? <Pill tone="amber">{nLive} new</Pill> : null}
        {nLate ? <Pill title="Past the channel's filing cutoff — close them with a reason">{nLate} too late to file</Pill> : null}
        <span className="ml-auto inline-flex items-center gap-2 text-[11.5px] text-muted">
          {data.lastScanAt ? 'Read ' + ago(data.lastScanAt) : 'Not read yet'}
          <button onClick={scan} disabled={scanning} title="Read the channel now" className="inline-flex items-center gap-1 font-semibold text-ink hover:text-brand-700 disabled:opacity-50">
            {scanning ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Read now
          </button>
        </span>
      </div>
      {data.lastError ? <p className="text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mb-2">{data.lastError}</p> : null}
      {err ? <p className="text-[12px] text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-1.5 mb-2">{err}</p> : null}
      {note ? <p role="status" className="text-[12px] text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mb-2 flex items-start gap-2"><span className="flex-1">{note}</span><button onClick={() => setNote('')} aria-label="Dismiss" className="shrink-0 font-semibold">✕</button></p> : null}
      {open.length === 0 ? (
        <div className="rounded-xl border border-line bg-white px-3 py-2.5 text-[12.5px] text-muted">Nothing new from housekeeping.</div>
      ) : (
        <ul className="space-y-2">
          {open.map(r => <Card key={r.id} r={r} reasons={data.closeReasons} focus={focusId === r.id} late={tooLate(r)} siblings={groupN[keyOf(r)] || 1} onNote={setNote} onPatch={patch} onOpenClaim={onOpenClaim} onClaimsChanged={onClaimsChanged} />)}
        </ul>
      )}
      {done.length ? (
        <div className="mt-2">
          <button onClick={() => setShowDone(!showDone)} className="text-[12px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1">
            <ChevronDown size={12} className={'transition ' + (showDone ? 'rotate-180' : '')} /> Handled ({done.length})
          </button>
          {showDone ? (
            <ul className="mt-1.5 rounded-xl border border-line bg-white divide-y divide-line">
              {done.map(r => (
                <li key={r.id} className="px-3 py-2 flex items-center gap-2 flex-wrap text-[12.5px]">
                  <b className="text-ink">{r.unit || r.unitAsWritten || 'Unit?'}</b>
                  <span className="text-ink/80 truncate max-w-[420px]">{r.summary}</span>
                  {r.status === 'claimed'
                    ? <button onClick={() => r.claimId && onOpenClaim(r.claimId)}><Tag tone="emerald">Claim made</Tag></button>
                    : <Tag title={r.handledBy ? 'By ' + r.handledBy : undefined}>{r.closedReason || 'Not claimable'}</Tag>}
                  <span className="text-[11.5px] text-muted">{ago(r.postedAt)}</span>
                  <button onClick={async () => { try { const j = await post({ action: 'reopen', id: r.id }); patch(j.report) } catch (e: any) { setErr(e.message) } }} className="ml-auto text-[11.5px] font-semibold text-muted hover:text-ink">Reopen</button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

function Card({ r, reasons, focus, late, siblings, onNote, onPatch, onOpenClaim, onClaimsChanged }: { r: Report; reasons: string[]; focus: boolean; late: boolean; siblings: number; onNote: (s: string) => void; onPatch: (r: Report) => void; onOpenClaim: (id: string) => void; onClaimsChanged: () => void }) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [closing, setClosing] = useState(false)
  const [fixing, setFixing] = useState(false)
  const s = r.stay
  const due = daysTo(s?.due || null)
  const autofill = async () => {
    setBusy('claim'); setErr('')
    if (late && !window.confirm('This stay is past the channel\'s filing cutoff' + (s?.deadline ? ' (' + md(s.deadline) + ')' : '') + '. Make the claim anyway?')) return
    try {
      const j = await post({ action: 'claim', id: r.id })
      // Said out loud, because the card is about to leave the queue: what did NOT make it onto the claim.
      const said: string[] = []
      if (j.existing) said.push('Added to the claim already open for this stay.')
      if (j.itemsError) said.push('The items could not be written onto the claim (' + j.itemsError + ') — add them by hand.')
      if (j.photosMissing > 0) said.push(j.photosMissing + ' photo' + (j.photosMissing === 1 ? ' is' : 's are') + ' still only in Slack' + (j.photoError ? ' (' + j.photoError + ')' : '') + ' — open the post and add ' + (j.photosMissing === 1 ? 'it' : 'them') + ' to the claim by hand.')
      onNote(said.length ? (r.unit || 'Report') + ': ' + said.join(' ') : '')
      onPatch({ ...r, status: 'claimed', claimId: j.claimId }); onClaimsChanged(); onOpenClaim(j.claimId)
    } catch (e: any) { setErr(e.message) } finally { setBusy('') }
  }
  const copyPhotos = async () => {
    setBusy('photos'); setErr('')
    try {
      const j = await post({ action: 'photos', id: r.id })
      onPatch(j.report)
      if (j.photosMissing > 0) setErr('Still not copied: ' + (j.photoError || 'Slack did not hand them over') + '.')
    } catch (e: any) { setErr(e.message) } finally { setBusy('') }
  }
  const close = async (reason: string) => {
    setBusy('close'); setErr('')
    try { const j = await post({ action: 'close', id: r.id, reason }); onPatch(j.report) } catch (e: any) { setErr(e.message) } finally { setBusy(''); setClosing(false) }
  }
  return (
    <li ref={el => { if (focus && el) el.scrollIntoView({ block: 'center' }) }} className={'rounded-xl border bg-white px-3 py-2.5 ' + (focus ? 'border-brand-400 ring-2 ring-brand-100' : 'border-line')}>
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            {late ? <Tag tone="slate" title={'The channel\'s filing cutoff' + (s?.deadline ? ' was ' + md(s.deadline) : ' has passed') + ' — close it with a reason unless you know better'}>Too late to file</Tag> : <Tag tone="brand">New HK damage report</Tag>}
            {siblings > 1 ? <Tag tone="amber" title="More than one post about this stay — Autofill puts them all on one claim">{siblings} reports · same stay</Tag> : null}
            <b className="text-[13.5px] text-ink">{r.unit || <span className="text-amber-800">{r.unitAsWritten || 'Unit?'} — not matched</span>}</b>
            <span className="text-[11.5px] text-muted">{r.author} · {ago(r.postedAt)}</span>
            {r.permalink ? <a href={r.permalink} target="_blank" rel="noreferrer" title="Open the post in Slack" className="text-muted hover:text-ink"><ExternalLink size={12} /></a> : null}
          </div>
          <p className="text-[13px] text-ink mt-1">{r.summary}</p>
          {r.items.length ? (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {r.items.map((it, i) => <span key={i} className="text-[11.5px] rounded-md bg-app border border-line px-1.5 py-0.5 text-ink/80">{it.qty > 1 ? it.qty + ' × ' : ''}{it.description}</span>)}
            </div>
          ) : null}
          <div className="flex items-center gap-1.5 flex-wrap mt-1.5 text-[12px]">
            <Tag tone={CLAIM_TONE[r.claimable]} title={r.reason}>{CLAIM_WORD[r.claimable]}</Tag>
            <span className="text-muted">{r.reason}</span>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mt-1.5 text-[12px]">
            {s ? (<>
              <span className="text-ink"><b>{s.guestName || 'Guest'}</b> · {s.channel}{s.confirmationCode ? ' · ' + s.confirmationCode : ''} · {md(s.checkIn)}–{md(s.checkOut)}</span>
              {s.ownerStay ? <Tag tone="violet">Owner / F&amp;F stay</Tag> : null}
              {s.due ? <Tag tone={due != null && due < 0 ? 'roseSolid' : due != null && due <= 3 ? 'rose' : 'slate'} title={'Our filing target' + (s.deadline ? ' · channel cutoff ' + s.deadline : '')}>{due == null ? '' : due < 0 ? 'File by ' + md(s.due) + ' — passed' : 'File by ' + md(s.due) + ' (' + due + 'd)'}</Tag> : s.channel === 'Direct' ? <Tag>No channel window</Tag> : null}
            </>) : <span className="text-amber-800">No checkout matched for {r.unit || 'this unit'} — fix the match to pick the stay.</span>}
          </div>
          {r.photos.length ? (
            <div className="flex gap-1.5 flex-wrap mt-2">
              {r.photos.slice(0, 8).map(p => (
                <a key={p} href={fileHref(p)} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fileHref(p)} alt="" loading="lazy" className="w-14 h-14 object-cover rounded-lg border border-line" />
                </a>
              ))}
            </div>
          ) : r.photoCount ? (
            <p className="text-[11.5px] text-muted mt-1.5 inline-flex items-center gap-1" title={r.photoError || undefined}><Camera size={12} /> {r.photoCount} photo{r.photoCount === 1 ? '' : 's'} in Slack{r.photoError ? ' — not copied yet' : ''}{r.photoError ? <button onClick={copyPhotos} disabled={!!busy} className="ml-1 font-semibold text-ink underline disabled:opacity-50">{busy === 'photos' ? 'Copying…' : 'Copy now'}</button> : null}</p>
          ) : null}
          {r.text && r.text !== r.summary ? <details className="mt-1.5"><summary className="text-[11.5px] text-muted cursor-pointer">What was posted</summary><p className="text-[12px] text-ink/80 whitespace-pre-line mt-1">{r.text}</p></details> : null}
        </div>
        <div className="flex flex-row sm:flex-col flex-wrap items-stretch gap-1.5 shrink-0 w-full sm:w-[150px] [&>button]:flex-1 sm:[&>button]:flex-none">
          <button onClick={autofill} disabled={!!busy || !s} title={s ? 'Make a draft claim against ' + s.guestName + ' with these items and photos, and open it' : 'Fix the match first — no stay picked'}
            className="h-9 sm:h-8 px-2 rounded-lg bg-ink text-white text-[12px] font-semibold inline-flex items-center justify-center gap-1 disabled:opacity-40">
            {busy === 'claim' ? <Loader2 size={12} className="animate-spin" /> : <Wand2 size={12} />} Autofill claim
          </button>
          <button onClick={() => setClosing(!closing)} disabled={!!busy} className="h-9 sm:h-8 px-2 rounded-lg border border-line text-[12px] font-semibold text-ink inline-flex items-center justify-center gap-1 hover:border-ink/40">
            {busy === 'close' ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />} Not claimable
          </button>
          <button onClick={() => setFixing(!fixing)} className="min-h-[36px] sm:min-h-0 text-[11.5px] font-semibold text-muted hover:text-ink inline-flex items-center justify-center gap-1"><Pencil size={11} /> Fix unit / guest</button>
        </div>
      </div>
      {closing ? (
        <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-line">
          {(late ? ['Too late to file'].concat(reasons.filter(x => x !== 'Too late to file')) : reasons).map(x => <button key={x} onClick={() => close(x)} className="text-[12px] rounded-full border border-line px-2.5 py-1 min-h-[36px] sm:min-h-0 hover:border-ink/40 text-ink">{x}</button>)}
        </div>
      ) : null}
      {fixing ? <FixMatch r={r} onPatch={x => { onPatch(x); setFixing(false) }} /> : null}
      {err ? <p className="text-[12px] text-rose-700 mt-1.5">{err}</p> : null}
    </li>
  )
}

function FixMatch({ r, onPatch }: { r: Report; onPatch: (r: Report) => void }) {
  const [units, setUnits] = useState<{ id: string; name: string }[]>([])
  const [listingId, setListingId] = useState(r.listingId || '')
  const [stays, setStays] = useState<Stay[] | null>(null)
  const [err, setErr] = useState('')
  const day = new Date(Date.parse(r.postedAt) - 4 * 3600000).toISOString().slice(0, 10)
  useEffect(() => { fetch('/api/claims/hk?units=1').then(x => x.json()).then(j => setUnits(j.units || [])).catch(() => setErr('Could not load the unit list — reload and try again.')) }, [])
  useEffect(() => {
    if (!listingId) { setStays(null); return }
    setStays(null)
    fetch('/api/claims/hk?stays=' + encodeURIComponent(listingId) + '&day=' + day).then(x => x.json()).then(j => setStays(j.stays || [])).catch(() => { setStays([]); setErr('Could not load the stays for that unit — try again.') })
  }, [listingId, day])
  const pick = async (reservationId: string) => {
    setErr('')
    try { const j = await post({ action: 'match', id: r.id, listingId: listingId !== r.listingId ? listingId : undefined, reservationId }); onPatch(j.report) } catch (e: any) { setErr(e.message) }
  }
  return (
    <div className="mt-2 pt-2 border-t border-line space-y-2">
      <label className="flex items-center gap-2 text-[12px]"><span className="text-muted w-12">Unit</span>
        <select value={listingId} onChange={e => setListingId(e.target.value)} className="h-8 rounded-lg border border-line bg-white px-2 text-[12.5px] flex-1 max-w-[320px]">
          <option value="">Pick the unit…</option>
          {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
      </label>
      {listingId ? (
        stays === null ? <p className="text-[12px] text-muted">Loading stays…</p>
        : stays.length === 0 ? <p className="text-[12px] text-muted">No stays at that unit in the three weeks before the report.</p>
        : <ul className="space-y-1">
            {stays.map(s => (
              <li key={s.reservationId}>
                <button onClick={() => pick(s.reservationId)} className={'w-full text-left rounded-lg border px-2.5 py-1.5 text-[12.5px] hover:border-ink/40 ' + (r.stay?.reservationId === s.reservationId ? 'border-brand-400 bg-brand-50/50' : 'border-line')}>
                  <b>{s.guestName || 'Guest'}</b> · {s.channel} · {md(s.checkIn)}–{md(s.checkOut)}{s.ownerStay ? ' · owner/F&F' : ''}
                </button>
              </li>
            ))}
          </ul>
      ) : null}
      {err ? <p className="text-[12px] text-rose-700">{err}</p> : null}
    </div>
  )
}
