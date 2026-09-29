'use client'
// Users & admin → Settings → Homebase (labor), on the Garden Hotel side. Connect the hotel's Homebase
// (its own account, or its location inside Stay's), pull people and punches, see the week's hours.
import { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, KeyRound, Check } from 'lucide-react'
import { LeanSection, LeanList, LeanRow, LeanEmpty, Tag, IconBtn } from '@/components/lean'

const j = async (url: string, init?: RequestInit) => { const r = await fetch(url, { cache: 'no-store', ...init }); return r.json().catch(() => ({})) }
const post = (b: any) => j('/api/garden/homebase', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) })
const when = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'never'

export function GardenHomebase({ owner, canEdit }: { owner: boolean; canEdit: boolean }) {
  const [d, setD] = useState<any | null>(null)
  const [pick, setPick] = useState<string[]>([])
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState('')
  const load = useCallback(async () => { const r = await j('/api/garden/homebase'); setD(r); setPick(r?.settings?.locationUuids || []) }, [])
  useEffect(() => { load() }, [load])
  if (!d) return <p className="text-[13px] text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</p>
  if (!d.ok) return <LeanEmpty>{d.message || d.error}</LeanEmpty>
  const shared = d.mode.mode === 'shared', none = d.mode.mode === 'none'
  const dirty = JSON.stringify([...pick].sort()) !== JSON.stringify([...(d.settings.locationUuids || [])].sort())
  const sync = async (full: boolean) => { setBusy('sync'); const r = await post({ op: 'sync', full }); setBusy(''); setMsg(r?.result?.skipped || (r?.result?.timecards?.error || r?.result?.employees?.error) || `Pulled ${r?.result?.timecards?.cards ?? 0} punches; ${r?.result?.employees?.matched ?? 0} of ${r?.result?.employees?.total ?? 0} people linked to the roster.`); load() }
  return (
    <div className="space-y-4">
      {msg ? <p className="text-[12.5px] text-emerald-800 inline-flex items-center gap-1.5"><Check size={13} /> {msg}</p> : null}
      <LeanSection title="Connection">
        <LeanList>
          <LeanRow name="Homebase" meta={none ? 'No Homebase key on the server.' : d.mode.mode === 'own' ? 'The hotel\'s own Homebase account (GARDEN_HOMEBASE_API_KEY)' : 'Stay Hospitality\'s Homebase account — the hotel is one of its locations (HOMEBASE_API_KEY)'}
            tags={<Tag tone={none ? 'rose' : pick.length || d.mode.mode === 'own' ? 'emerald' : 'amber'}>{none ? 'not connected' : pick.length || d.mode.mode === 'own' ? 'connected' : 'pick the hotel\'s location'}</Tag>}
            actions={canEdit && !none ? <><IconBtn title="Test the key (lists the locations it can see)" onClick={async () => { const r = await post({ op: 'test' }); setMsg(r?.ok ? `Homebase answered: ${r.locations.map((l: any) => l.name).join(', ')}` : r?.error) }}><KeyRound size={14} /></IconBtn><IconBtn title={busy ? 'Pulling…' : 'Pull the last 30 days now'} onClick={() => sync(true)} disabled={!!busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}</IconBtn></> : undefined} />
        </LeanList>
        {none && owner ? (
          <ol className="list-decimal pl-5 text-[12.5px] text-ink/85 space-y-0.5 mt-2">
            <li>If the hotel has its <b>own</b> Homebase company: Homebase → Settings → API → create a key → Vercel → add <code>GARDEN_HOMEBASE_API_KEY</code> → redeploy.</li>
            <li>If the hotel is a <b>location in Stay&apos;s</b> Homebase: nothing to add — the existing <code>HOMEBASE_API_KEY</code> reaches it; pick the location below.</li>
          </ol>
        ) : null}
      </LeanSection>

      {!none ? (
        <LeanSection title="The hotel's locations">
          {d.locError ? <p className="text-[12.5px] text-rose-700">{d.locError}</p> : (
            <div className="rounded-2xl border border-line bg-white divide-y divide-line">
              {d.locations.map((l: any) => (
                <label key={l.uuid} className="flex items-center gap-2.5 px-3 py-2 text-[13px]">
                  <input type="checkbox" disabled={!owner} checked={pick.includes(l.uuid)} onChange={e => setPick(p => e.target.checked ? [...p, l.uuid] : p.filter(x => x !== l.uuid))} />
                  <span className="font-semibold text-ink">{l.name}</span>
                  {shared && pick.includes(l.uuid) ? <Tag tone="amber">left out of Stay&apos;s labor</Tag> : null}
                </label>
              ))}
            </div>
          )}
          <p className="text-[11.5px] text-muted mt-1.5">{shared ? 'Tick the hotel\'s location(s). Ticked locations belong to the hotel only — they stop counting in the Stay Hospitality labor board, cost per clean and the briefs.' : 'Leave all unticked to use every location on the hotel\'s account, or tick the ones that are the hotel.'}</p>
          {owner && dirty ? <button onClick={async () => { await post({ op: 'settings', locationUuids: pick }); setMsg('Saved — the next sync pulls these locations.'); load() }} className="mt-2 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[12px] font-semibold">Save locations</button> : null}
        </LeanSection>
      ) : null}

      <LeanSection title="Feeds">
        <LeanList>
          {['homebase_staff', 'homebase_timecards'].map(k => { const s = d.status.find((x: any) => x.entity === k); return (
            <LeanRow key={k} name={k === 'homebase_staff' ? 'People' : 'Timecards'} meta={`last ${when(s?.last_sync_at)}${s?.count != null ? ` · ${s.count}` : ''}${k === 'homebase_staff' ? ` · ${d.roster.linked} of ${d.roster.total} roster people linked` : ''}`}
              tags={<Tag tone={s?.last_error ? 'rose' : s ? 'emerald' : 'slate'}>{s?.last_error ? 'error' : s ? 'ok' : 'never'}</Tag>}>{s?.last_error ? <p className="text-[12px] text-rose-700">{s.last_error}</p> : null}</LeanRow>
          ) })}
        </LeanList>
        <p className="text-[11.5px] text-muted mt-1.5">Pulled with every Garden sync (every 30 minutes): the roster is matched by Homebase id, email, then name — add unmatched people to Staff roster — and the last {d.settings.lookbackDays} days of punches are refreshed.</p>
      </LeanSection>

      {d.labor && d.labor.people.length ? (
        <LeanSection title={`Last 7 days · ${d.labor.hours}h · $${d.labor.cost.toLocaleString()}`}>
          <LeanList>{d.labor.people.map((p: any) => (
            <LeanRow key={p.name} name={p.name} meta={`${p.hours}h · ${p.shifts} shifts${p.cost ? ` · $${p.cost.toLocaleString()}` : ''}`} tags={p.matched ? undefined : <Tag tone="amber">not on roster</Tag>} />
          ))}</LeanList>
        </LeanSection>
      ) : null}
    </div>
  )
}
