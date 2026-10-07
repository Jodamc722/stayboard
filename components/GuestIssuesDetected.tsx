'use client'
// WHAT WE HEARD (Jon, 2026-10-07: "please have a way to get a better understanding of guest issues
// by reading transcripts or guest messages, and there should be a way in the app to review that").
//
// One row per thing a guest told us that sounded wrong — from a recorded call or from their message
// thread — with their own words, what the watch decided, and the link to read the whole transcript
// or thread. A person can file one it left alone, or dismiss one it raised; both are one click and
// both are recorded, so the watch's judgement is always reviewable rather than mysterious.
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Check, ExternalLink, Loader2, Phone, MessageSquare, RefreshCw, ShieldAlert, X } from 'lucide-react'
import { Tag, Pill, IconBtn } from '@/components/lean'

const API = '/api/guest-issues'
type Row = {
  source_key: string; kind: 'call' | 'message'; detected_at: string; occurred_at: string | null
  reservation_id: string | null; conversation_id: string | null; listing_id: string | null
  unit: string | null; guest_name: string | null; channel: string | null
  severity: 'security' | 'issue' | 'watch' | 'none'; category: string | null; headline: string | null
  issues: string[]; evidence: string | null; link: string | null
  verdict: string; glitch_id: string | null; alerted: boolean; note: string | null
}
const fmt = (s?: string | null) => s ? new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : ''
const GHOST = 'inline-flex items-center gap-1 text-[12px] font-semibold px-2 py-1 rounded-lg border border-line bg-white text-ink hover:border-ink/40 disabled:opacity-50'
const DARK = 'inline-flex items-center gap-1 text-[12px] font-semibold px-2 py-1 rounded-lg bg-ink text-white disabled:opacity-50'

export function GuestIssuesDetected({ onFiled }: { onFiled?: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [settings, setSettings] = useState<{ on: boolean }>({ on: true })
  const [canEdit, setCanEdit] = useState(false)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [only, setOnly] = useState<'all' | 'open' | 'security'>('all')
  const [needsMigration, setNeedsMigration] = useState(false)

  const load = useCallback(async () => {
    setErr('')
    try {
      const j = await fetch(API + '?days=14', { cache: 'no-store' }).then(r => r.json())
      if (!j.ok) { setNeedsMigration(!!j.needsMigration); setErr(j.error || 'Could not load.'); setRows([]); return }
      setRows(j.rows || []); setSettings(j.settings || { on: true }); setCanEdit(!!j.canEdit)
    } catch (e: any) { setErr(String(e?.message || e)); setRows([]) }
  }, [])
  useEffect(() => { load() }, [load])

  const run = async () => {
    setBusy('run'); setErr(''); setMsg('')
    try {
      const j = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hours: 48 }) }).then(r => r.json())
      if (!j.ok) throw new Error(j.error || 'The watch could not finish.')
      setMsg(j.found === 0 ? 'Nothing new in the last 48 hours.' : `Looked at ${j.looked.calls} calls and ${j.looked.threads} threads · ${j.filed} filed · ${j.alerted} flagged to customer care · ${j.skipped} left for a person.`)
      await load(); onFiled?.()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
  const decide = async (sourceKey: string, decision: 'file' | 'dismiss') => {
    setBusy(sourceKey); setErr(''); setMsg('')
    try {
      const j = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceKey, decision }) }).then(r => r.json())
      if (!j.ok) throw new Error(j.error || 'Could not save.')
      setMsg(decision === 'file' ? 'Filed as a glitch.' : 'Dismissed — the watch will leave it alone.')
      await load(); onFiled?.()
    } catch (e: any) { setErr(String(e?.message || e)) }
    setBusy('')
  }
  const toggle = async () => {
    setBusy('toggle')
    try { const j = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on: !settings.on }) }).then(r => r.json()); if (j.ok) setSettings(j.settings) } catch { /* nothing */ }
    setBusy('')
  }

  const all = rows || []
  const open_ = (r: Row) => !r.glitch_id && r.verdict !== 'dismissed'
  const shown = all.filter(r => only === 'all' ? true : only === 'security' ? r.severity === 'security' : open_(r))
  const nSec = all.filter(r => r.severity === 'security').length
  const nOpen = all.filter(open_).length

  return (
    <div className="rounded-2xl border border-line bg-white p-3 sm:p-4 mb-3">
      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-[13px] font-bold text-ink">What we heard</span>
        <span className="text-[11.5px] text-muted">guest issues picked up from recorded calls and message threads — filed, flagged to customer care and posted to Slack automatically</span>
        <span className="grow" />
        {nSec > 0 && <Pill tone="rose" title="Safety or security — these also go to leadership">{nSec} safety</Pill>}
        <Pill tone={nOpen ? 'amber' : 'slate'} title="Heard, but no glitch filed — waiting on a person">{nOpen} to look at</Pill>
        <div className="inline-flex rounded-lg border border-line overflow-hidden text-[12px]">
          {([['all', 'All'], ['open', 'To look at'], ['security', 'Safety']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setOnly(k)} className={'px-2.5 py-1 font-semibold border-l border-line first:border-l-0 ' + (only === k ? 'bg-ink text-white' : 'bg-white text-muted')}>{l}</button>
          ))}
        </div>
        {canEdit && <button onClick={run} disabled={!!busy} className={DARK} title="Read the last 48 hours of calls and threads now">{busy === 'run' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Check now</button>}
        {canEdit && <button onClick={toggle} disabled={!!busy} className={GHOST} title={settings.on ? 'The watch runs every half hour' : 'The watch is off — nothing is filed or flagged automatically'}>{settings.on ? 'Watch on' : 'Watch off'}</button>}
        <IconBtn title="Reload" onClick={load}><RefreshCw size={13} /></IconBtn>
      </div>

      {needsMigration && <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900 mb-2">Run <code>supabase/migrations/148_guest_issue_watch.sql</code> in Supabase, then reload.</p>}
      {err && !needsMigration && <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700 mb-2">{err}</p>}
      {msg && <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800 mb-2">{msg}</p>}
      {rows === null && <p className="text-[13px] text-muted py-4 text-center">Loading…</p>}
      {rows !== null && shown.length === 0 && <p className="text-[13px] text-muted py-4 text-center">{only === 'all' ? 'Nothing heard in the last 14 days.' : 'Nothing here.'}</p>}

      <div className="divide-y divide-line">
        {shown.map(r => {
          const b = busy === r.source_key
          const sec = r.severity === 'security'
          return (
            <div key={r.source_key} className={'py-2.5 ' + (sec ? 'bg-rose-50/40 -mx-3 px-3 sm:-mx-4 sm:px-4' : '')}>
              <div className="flex items-start gap-2 flex-wrap">
                <span className={'mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ' + (sec ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-muted')}>
                  {sec ? <ShieldAlert size={14} /> : r.kind === 'call' ? <Phone size={14} /> : <MessageSquare size={14} />}
                </span>
                <div className="min-w-0 grow basis-64">
                  <div className="text-[13.5px] font-bold text-ink">
                    {r.guest_name || 'A guest'}{r.unit ? <span className="font-semibold text-muted"> · {r.unit}</span> : null}
                  </div>
                  <p className="mt-0.5 text-[13px] leading-[1.5] text-ink">{r.headline}</p>
                  {r.evidence && r.evidence !== r.headline ? <p className="mt-1 text-[12px] leading-[1.5] text-muted italic">“{r.evidence}”</p> : null}
                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                    {sec ? <Tag tone="rose">safety / security</Tag> : <Tag tone={r.severity === 'issue' ? 'amber' : 'slate'}>{r.severity === 'issue' ? 'guest issue' : 'worth a look'}</Tag>}
                    <Tag>{r.kind === 'call' ? 'on the phone' : 'in the messages'}</Tag>
                    {r.channel ? <Tag>{r.channel}</Tag> : null}
                    {r.category ? <Tag>{r.category.replace(/^Maintenance - /, '')}</Tag> : null}
                    <Tag tone="slate" title={fmt(r.occurred_at)}>{fmt(r.occurred_at) || fmt(r.detected_at)}</Tag>
                    {r.glitch_id ? <Tag tone="emerald">glitch filed</Tag> : r.verdict === 'dismissed' ? <Tag>dismissed</Tag> : r.verdict === 'pending' ? <Tag tone="amber">waiting on you</Tag> : <Tag tone="amber">no glitch yet</Tag>}
                    {r.alerted ? <Tag tone="violet" title="Customer care got the pop-up and the Slack post">customer care flagged</Tag> : null}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {r.link ? <a href={r.link} target={r.link.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className={GHOST} title={r.kind === 'call' ? 'Read the whole transcript' : 'Open the message thread'}><ExternalLink size={12} /> {r.kind === 'call' ? 'Transcript' : 'Thread'}</a> : null}
                  {r.glitch_id ? <a href={'/glitches?id=' + r.glitch_id} className={GHOST}><AlertTriangle size={12} /> Glitch</a> : null}
                  {canEdit && !r.glitch_id && r.verdict !== 'dismissed' && <button onClick={() => decide(r.source_key, 'file')} disabled={b} className={DARK}>{b ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} File it</button>}
                  {canEdit && !r.glitch_id && r.verdict !== 'dismissed' && <button onClick={() => decide(r.source_key, 'dismiss')} disabled={b} className={GHOST} title="Not a guest issue"><X size={12} /></button>}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-[11.5px] text-muted">A safety or security matter also goes to #leadership. Everything else goes to #vr-customercareteam as a pop-up the team has to acknowledge, tagging Roberto, Karla and Silvia.</p>
    </div>
  )
}
