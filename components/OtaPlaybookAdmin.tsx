'use client'
// THE OTA PLAYBOOK EDITOR — Settings → Eve → OTA playbook.
//
// One channel at a time, eight topics down the page. Each cell shows OUR process (editable, with a
// "Confirmed" switch that is Jon's signature) above the PLATFORM's rule (editable, dated). An empty
// Stay half is shown as a gap with the exact question Eve has open for it. "Teach her now" runs the
// sync: memories, probes, questions. Saving a cell teaches it on its own.
import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, RefreshCw, AlertTriangle, RotateCcw, ShieldCheck, ExternalLink, HelpCircle } from 'lucide-react'
import type { OtaChannel, OtaTopic, Playbook } from '@/lib/ota-playbook'

type Data = {
  ok: boolean
  channels: OtaChannel[]
  topics: Array<{ key: OtaTopic; label: string; ask: string }>
  playbook: Playbook
  overridden: Record<string, true>
  taught: number
  gaps: Array<{ channel: OtaChannel; topic: OtaTopic; label: string }>
  openQuestions: number
  lastSync: any
  canEdit: boolean
}

const card = 'bg-white border border-line rounded-2xl shadow-soft'
const ta = 'w-full text-[13px] leading-snug text-ink bg-app border border-line rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-200'
const ago = (iso: string | null | undefined) => {
  if (!iso) return 'never'
  const h = (Date.now() - Date.parse(iso)) / 3600_000
  return h < 1 ? 'just now' : h < 48 ? `${Math.round(h)}h ago` : `${Math.round(h / 24)}d ago`
}

export function OtaPlaybookAdmin({ canEdit }: { canEdit: boolean }) {
  const [d, setD] = useState<Data | null>(null)
  const [err, setErr] = useState('')
  const [ch, setCh] = useState<OtaChannel>('Airbnb')
  const [draft, setDraft] = useState<Record<string, { stay: string; platform: string }>>({})
  const [busy, setBusy] = useState('')
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/eve/ota').then(x => x.json())
      if (!r?.ok) { setErr(r?.message || r?.error || 'Could not load.'); return }
      setD(r); setErr(''); setDraft({})
    } catch (e: any) { setErr(e?.message || String(e)) }
  }, [])
  useEffect(() => { load() }, [load])

  async function post(body: any, key: string, okNote?: string) {
    if (busy) return
    setBusy(key); setNote('')
    try {
      const r = await fetch('/api/eve/ota', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(x => x.json())
      if (!r?.ok && r?.error) { setNote(r.message || r.error); return }
      const rc = r?.receipt
      setNote(okNote || (rc ? `Taught: ${rc.taught} new, ${rc.updated} updated, ${rc.unchanged} unchanged · ${rc.probes} probes written · ${rc.asked} questions asked · ${rc.gaps} gaps${rc.errors?.length ? ` · ${rc.errors.length} errors` : ''}` : 'Saved.'))
      await load()
    } catch (e: any) { setNote(e?.message || String(e)) } finally { setBusy('') }
  }

  if (err) return <div className={`${card} p-4 text-sm text-[#B42318]`}>{err}</div>
  if (!d) return <div className="text-sm text-muted p-4 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading the playbook…</div>

  const gapsHere = d.gaps.filter(g => g.channel === ch).length
  const edit = canEdit && d.canEdit

  return (
    <div className="space-y-4">
      {/* HEADER */}
      <div className={`${card} p-4`}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] font-bold text-ink">What each channel does with money — and what we do</div>
            <div className="text-[11px] text-muted mt-0.5">
              Every cell has two halves. <b>Our process</b> is Stay&apos;s rule and is only right because someone here said so — tick <b>Confirmed</b> and Eve carries it at weight 9, in your name. <b>The platform&apos;s rule</b> is what the channel publishes, dated when it was last checked. She reads both, keeps them apart, and treats an empty &quot;our process&quot; as a question for you, never as permission to assume.
            </div>
            <div className="text-[11px] text-muted mt-1.5">
              {d.taught} cells taught · {d.gaps.length} gaps · {d.openQuestions} open questions to you · last taught {ago(d.lastSync?.at)}
            </div>
          </div>
          {edit && (
            <button onClick={() => post({ op: 'sync' }, 'sync')} disabled={!!busy}
              className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg px-3 py-2 hover:bg-brand-700 disabled:opacity-50">
              {busy === 'sync' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Teach her now
            </button>
          )}
        </div>
        {note && <div className="mt-2 text-[12px] text-ink bg-app border border-line rounded-lg px-3 py-1.5">{note}</div>}
      </div>

      {/* CHANNEL TABS */}
      <div className="flex gap-1 overflow-x-auto">
        {d.channels.filter(c => c !== 'Other').map(c => {
          const n = d.gaps.filter(g => g.channel === c).length
          return (
            <button key={c} onClick={() => setCh(c)}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold border ${ch === c ? 'bg-ink text-white border-ink' : 'bg-white text-ink border-line hover:bg-app'}`}>
              {c}{n > 0 && <span className={`text-[10px] rounded-full px-1.5 ${ch === c ? 'bg-white/20' : 'bg-[#FEF3C7] text-[#92400E]'}`}>{n}</span>}
            </button>
          )
        })}
      </div>

      {gapsHere > 0 && (
        <div className="text-[12px] text-[#92400E] bg-[#FFFBEB] border border-[#FDE68A] rounded-xl px-3 py-2 inline-flex items-start gap-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" /> {gapsHere} of the {d.topics.length} {ch} cells have no Stay process yet. Eve has a question open for each; answer it here or on Telegram and the cell fills itself in.
        </div>
      )}

      {/* CELLS */}
      {d.topics.map(t => {
        const c = d.playbook[ch][t.key]
        const k = `${ch}|${t.key}`
        const dr = draft[k] || { stay: c.stay || '', platform: c.platform || '' }
        const dirty = dr.stay !== (c.stay || '') || dr.platform !== (c.platform || '')
        const gap = !String(c.stay || '').trim()
        return (
          <div key={k} className={`${card} overflow-hidden`}>
            <div className="px-4 py-2.5 border-b border-line flex flex-wrap items-center gap-2">
              <div className="text-[13px] font-bold text-ink flex-1 min-w-0">{t.label}</div>
              {gap
                ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#92400E] bg-[#FEF3C7] rounded-full px-2 py-0.5"><HelpCircle size={11} /> gap — she asks you</span>
                : c.verified
                  ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0F7B52] bg-[#E6F4EE] rounded-full px-2 py-0.5"><ShieldCheck size={11} /> confirmed · weight 9</span>
                  : <span className="text-[11px] font-semibold text-muted bg-app rounded-full px-2 py-0.5">unconfirmed · weight 6</span>}
              {d.overridden[k] && <span className="text-[10px] text-muted">edited {c.by ? `by ${String(c.by).split('@')[0]}` : ''} {ago(c.at)}</span>}
            </div>
            <div className="p-4 grid lg:grid-cols-2 gap-4">
              <div>
                <div className="text-[11px] font-bold text-ink mb-1">Our process</div>
                {gap && !edit && <div className="text-[12px] text-muted italic">Not recorded. Eve has asked: “On {ch} bookings, what is our process for {t.label.toLowerCase()} — {t.ask}?”</div>}
                {edit
                  ? <textarea value={dr.stay} onChange={e => setDraft(s => ({ ...s, [k]: { ...dr, stay: e.target.value } }))} rows={4} className={ta}
                      placeholder={`What we actually do on ${ch}: ${t.ask}.`} />
                  : !gap && <div className="text-[13px] text-ink whitespace-pre-wrap">{c.stay}</div>}
              </div>
              <div>
                <div className="text-[11px] font-bold text-ink mb-1 flex items-center gap-2">
                  {ch}&apos;s own rule <span className="font-normal text-muted">· checked {c.asOf || '—'}</span>
                  {(c.sources || []).slice(0, 2).map(u => <a key={u} href={u} target="_blank" rel="noreferrer" className="text-brand-700 inline-flex items-center gap-0.5 font-normal"><ExternalLink size={10} /> source</a>)}
                </div>
                {edit
                  ? <textarea value={dr.platform} onChange={e => setDraft(s => ({ ...s, [k]: { ...dr, platform: e.target.value } }))} rows={4} className={ta} placeholder="What the platform itself does." />
                  : <div className="text-[13px] text-ink whitespace-pre-wrap">{c.platform || <span className="text-muted italic">—</span>}</div>}
              </div>
            </div>
            {edit && (
              <div className="px-4 pb-3 flex flex-wrap items-center gap-2">
                <button onClick={() => post({ op: 'save', channel: ch, topic: t.key, stay: dr.stay, platform: dr.platform }, k)} disabled={!!busy || !dirty}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold bg-brand-600 text-white rounded-lg px-3 py-1.5 hover:bg-brand-700 disabled:opacity-50">
                  {busy === k ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save &amp; teach
                </button>
                <label className={`inline-flex items-center gap-1.5 text-[12px] ${gap ? 'text-muted' : 'text-ink'}`}>
                  <input type="checkbox" checked={!!c.verified} disabled={!!busy || gap || dirty}
                    onChange={e => post({ op: 'save', channel: ch, topic: t.key, verified: e.target.checked }, k + ':v', e.target.checked ? 'Confirmed — she carries it at weight 9 in your name.' : 'Unconfirmed — back to weight 6.')} />
                  Confirmed — this is what we do
                </label>
                {d.overridden[k] && (
                  <button onClick={() => post({ op: 'reset', channel: ch, topic: t.key }, k + ':r', 'Back to the researched default.')} disabled={!!busy}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted hover:text-ink border border-line rounded-lg px-2 py-1 disabled:opacity-50">
                    <RotateCcw size={11} /> Default
                  </button>
                )}
                {dirty && <span className="text-[11px] text-muted">unsaved</span>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
