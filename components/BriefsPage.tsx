'use client'
// BRIEFS (Jon, 2026-11-25): the morning plan for each market and for customer care, seen before it
// goes out. "Make them super nice and easy to view" · "make changes before they go out, add notes".
//
// One plan at a time. What is on this page is what the email says: the same plan, drawn wide here and
// narrow there (lib/brief-plan-rules). A note sits at the top of the email. A line added here leads the
// plan under "Also today". A row taken out stays here, greyed, so it can be put back; it is left out of
// what is sent. Changes are for today only.
import { useCallback, useEffect, useState } from 'react'
import { Loader2, Mail, RefreshCw, Send, X, Undo2, Plus } from 'lucide-react'
import { LeanHead, LeanTabs, Tag, Pill } from '@/components/lean'
import { PLAN_KEYS, PLAN_NAMES, sectionCount, type Plan, type PlanKey, type PlanRow, type PlanSection, type PlanSetting, type PlanTag } from '@/lib/brief-plan-rules'

type Res = { ok: boolean; error?: string; plan?: Plan; settings?: PlanSetting; me?: string }
const btn = 'h-8 px-3 rounded-lg border border-line bg-white text-[12.5px] font-semibold text-ink inline-flex items-center gap-1.5 hover:bg-app disabled:opacity-50'
const primary = 'h-8 px-3 rounded-lg bg-ink text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5 hover:opacity-90 disabled:opacity-50'
const TAG: Record<string, any> = { red: 'rose', amber: 'amber', green: 'emerald', gold: 'amber', grey: 'slate', none: 'slate' }
const bar = (t?: string) => (t === 'red' ? 'border-l-rose-500' : t === 'amber' ? 'border-l-amber-500' : t === 'green' ? 'border-l-emerald-500' : 'border-l-transparent')
const OLD = [['Ops morning', 'ops'], ['GM morning', 'gm'], ['Admin morning', 'admin'], ['Maintenance run', 'maint'], ['Field Run · Miami', 'field-miami'], ['Field Run · Broward', 'field-broward']]

export function BriefsPage() {
  const [key, setKey] = useState<PlanKey>('broward')
  const [data, setData] = useState<Res | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [note, setNote] = useState('')
  const [line, setLine] = useState('')
  const [to, setTo] = useState('')

  const load = useCallback(async (k: PlanKey, quiet = false) => {
    if (!quiet) { setLoading(true); setData(null) }
    const r: Res = await fetch('/api/briefs?plan=' + k, { cache: 'no-store' }).then(x => x.json()).catch(() => ({ ok: false, error: 'The plan did not load. Try again.' }))
    setData(r); setLoading(false)
    if (r.ok) { setNote(r.plan?.note || ''); setTo((r.settings?.to || []).join(', ')) }
  }, [])
  useEffect(() => { try { const h = window.location.hash.slice(1); if ((PLAN_KEYS as string[]).indexOf(h) >= 0) { setKey(h as PlanKey); load(h as PlanKey); return } } catch { /* no hash */ } load('broward') }, [load])
  const pick = (k: PlanKey) => { setKey(k); setMsg(''); setLine(''); try { window.location.hash = k } catch { /* fine */ } load(k) }

  const post = async (op: string, body: Record<string, unknown> = {}, done = '') => {
    setBusy(op + String(body.id || '')); setMsg('')
    const r = await fetch('/api/briefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: key, op, ...body }) }).then(x => x.json()).catch(() => ({ ok: false, error: 'That did not save. Try again.' }))
    setBusy('')
    if (!r.ok) { setMsg(r.error || 'That did not work.'); return false }
    if (done) setMsg(done.replace('{n}', String(r.n ?? '')))
    await load(key, true)
    return true
  }

  const plan = data?.plan, s = data?.settings
  const saved = (s?.to || []).join(', ')
  return (
    <div>
      <LeanHead title="Briefs" sub="The morning plan for each team. What you see is what is sent; change it here before it goes out.">
        <button className={btn} onClick={() => load(key)} disabled={loading} title="Build this plan again from the day as it stands now">{loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Refresh</button>
      </LeanHead>
      <LeanTabs tabs={PLAN_KEYS.map(k => ({ key: k, label: PLAN_NAMES[k] }))} value={key} onChange={pick} />

      {loading && <p className="mt-6 text-[13px] text-muted flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Building the {PLAN_NAMES[key]} plan…</p>}
      {!loading && data && !data.ok && <p className="mt-6 text-[13px] text-rose-700">{data.error}</p>}

      {plan && s && (
        <div className="mt-4 space-y-4">
          {/* THE DAY IN NUMBERS */}
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
            {plan.tiles.map(t => (
              <div key={t.label} className="rounded-xl border border-line bg-white px-3 py-2.5">
                <div className="text-[10.5px] font-bold uppercase tracking-wider text-muted">{t.label}</div>
                <div className={`text-[26px] leading-tight font-semibold tabular-nums ${t.tone === 'red' ? 'text-rose-700' : t.tone === 'amber' ? 'text-amber-700' : 'text-ink'}`}>{t.value}</div>
              </div>
            ))}
          </div>

          {/* BEFORE IT GOES OUT: the note, a line of your own, who gets it */}
          <div className="rounded-xl border border-line bg-white p-3 grid gap-3 lg:grid-cols-2">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted mb-1">Note at the top · today only</div>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} maxLength={1200} placeholder={`Anything the ${PLAN_NAMES[key]} team should read first today`} className="w-full rounded-lg border border-line px-2.5 py-2 text-[13px] leading-snug focus:outline-none focus:border-ink" />
              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                <button className={btn} disabled={!!busy || note.trim() === (plan.note || '')} onClick={() => post('note', { text: note }, note.trim() ? 'Note saved.' : 'Note removed.')}>{busy === 'note' ? <Loader2 size={13} className="animate-spin" /> : null} Save note</button>
                {plan.note ? <span className="text-[11.5px] text-muted">On the plan{plan.noteBy ? ', from ' + plan.noteBy : ''}</span> : null}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <input value={line} onChange={e => setLine(e.target.value)} maxLength={300} placeholder="Add a line of your own to the plan" onKeyDown={e => { if (e.key === 'Enter' && line.trim()) post('add', { text: line }).then(ok => ok && setLine('')) }} className="flex-1 min-w-0 h-8 rounded-lg border border-line px-2.5 text-[13px] focus:outline-none focus:border-ink" />
                <button className={btn} disabled={!!busy || !line.trim()} onClick={() => post('add', { text: line }).then(ok => ok && setLine(''))}><Plus size={13} /> Add</button>
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-muted mb-1">Who gets it</div>
              <textarea value={to} onChange={e => setTo(e.target.value)} rows={2} placeholder="Email addresses, separated by commas" className="w-full rounded-lg border border-line px-2.5 py-2 text-[13px] leading-snug focus:outline-none focus:border-ink" />
              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                <button className={btn} disabled={!!busy || to.trim() === saved} onClick={() => post('to', { emails: to }, 'Saved who gets it.')}>Save list</button>
                <span className="text-[11.5px] text-muted">{s.to.length} on the list</span>
              </div>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <button className={btn} disabled={!!busy} onClick={() => post('test', {}, 'Sent to you only. Check your inbox.')} title="Emails this plan, as it stands, to you and nobody else">{busy === 'test' ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />} Email it to me</button>
                <button className={primary} disabled={!!busy || !s.to.length} onClick={() => post('send', {}, 'Sent to {n}.')} title={s.to.length ? 'Emails this plan now to the ' + s.to.length + ' on the list' : 'Add who gets it first'}>{busy === 'send' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send now{s.to.length ? ' to ' + s.to.length : ''}</button>
                <span className="inline-flex rounded-lg border border-line overflow-hidden" title="On: this plan emails itself to the list every morning at about 7, with the note and changes made here">
                  <button className={`h-8 px-2.5 text-[12px] font-semibold ${!s.auto ? 'bg-ink text-white' : 'bg-white text-muted'}`} disabled={!!busy} onClick={() => s.auto && post('auto', { on: false }, 'It will not send on its own.')}>Off</button>
                  <button className={`h-8 px-2.5 text-[12px] font-semibold ${s.auto ? 'bg-emerald-600 text-white' : 'bg-white text-muted'}`} disabled={!!busy} onClick={() => !s.auto && post('auto', { on: true }, 'It will send every morning at about 7.')}>Sends at 7</button>
                </span>
              </div>
              <div className="mt-1.5 text-[11.5px] text-muted">{s.lastSent ? `Last sent ${s.lastSent.day} to ${s.lastSent.n}` : 'Not sent yet'}{msg ? <span className="ml-2 font-semibold text-ink">{msg}</span> : null}</div>
            </div>
          </div>

          {/* THE PLAN */}
          <div className="gap-4 lg:columns-2">
            {plan.sections.map(sec => <Section key={sec.key} sec={sec} busy={busy} onHide={id => post('hide', { id })} onShow={id => post('show', { id })} onRemove={id => post('remove', { id })} />)}
          </div>

          <div className="flex items-center gap-2 flex-wrap text-[11.5px] text-muted">
            <span>Other briefs, as they send today:</span>
            {OLD.map(([label, pv]) => <a key={pv} href={'/api/cron/ops-brief?preview=' + pv} target="_blank" rel="noreferrer" className="font-semibold text-ink hover:underline">{label}</a>)}
          </div>
        </div>
      )}
    </div>
  )
}

function TagRow({ tags }: { tags?: PlanTag[] }) {
  if (!tags || !tags.length) return null
  return <>{tags.map((t, i) => <Tag key={i} tone={TAG[t.tone || 'grey']}>{t.text}</Tag>)}</>
}

function Row({ r, n, busy, onHide, onShow, onRemove }: { r: PlanRow; n?: number; busy: string; onHide: (id: string) => void; onShow: (id: string) => void; onRemove: (id: string) => void }) {
  return (
    <div className={`group flex items-start gap-2 border-l-[3px] pl-2.5 pr-1 py-1.5 ${bar(r.hidden ? 'none' : r.tone)} ${r.hidden ? 'opacity-45' : ''}`}>
      {n != null && <span className="w-4 shrink-0 pt-0.5 text-[11px] font-bold tabular-nums text-muted">{n}</span>}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`text-[13.5px] font-semibold text-ink ${r.hidden ? 'line-through' : ''}`}>{r.title}</span>
          <TagRow tags={r.tags} />
          {r.hidden && <Tag tone="slate">Left out of the email</Tag>}
        </div>
        {r.meta && <div className="text-[12.5px] leading-snug text-muted">{r.meta}</div>}
        {r.note && <div className="text-[12px] leading-snug text-amber-800">{r.note}</div>}
        {r.custom && r.by && <div className="text-[11.5px] text-muted">Added by {r.by}</div>}
      </div>
      {r.custom
        ? <button className="shrink-0 h-6 w-6 grid place-items-center rounded-md text-muted hover:bg-app hover:text-ink" title="Remove this line" disabled={!!busy} onClick={() => onRemove(r.id)}><X size={13} /></button>
        : r.hidden
          ? <button className="shrink-0 h-6 px-1.5 rounded-md text-[11.5px] font-semibold text-ink hover:bg-app inline-flex items-center gap-1" title="Put it back on the plan" disabled={!!busy} onClick={() => onShow(r.id)}><Undo2 size={12} /> Put back</button>
          : <button className="shrink-0 h-6 w-6 grid place-items-center rounded-md text-muted opacity-60 lg:opacity-0 group-hover:opacity-100 hover:bg-app hover:text-ink" title="Leave this out of today's email" disabled={!!busy} onClick={() => onHide(r.id)}><X size={13} /></button>}
    </div>
  )
}

function Section({ sec, busy, onHide, onShow, onRemove }: { sec: PlanSection; busy: string; onHide: (id: string) => void; onShow: (id: string) => void; onRemove: (id: string) => void }) {
  const n = sectionCount(sec)
  const has = (sec.rows && sec.rows.length) || (sec.groups && sec.groups.length)
  return (
    <section className="mb-4 break-inside-avoid rounded-xl border border-line bg-white p-3">
      <h2 className={`mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider ${sec.tone === 'red' && n ? 'text-rose-700' : 'text-muted'}`}>{sec.title}{n ? <Pill tone={sec.tone === 'red' ? 'rose' : 'slate'}>{n}</Pill> : null}</h2>
      {sec.groups && sec.groups.map(g => (
        <div key={g.name} className="mt-2 first:mt-0">
          <div className="text-[13.5px] font-semibold text-ink">{g.name}{g.meta ? <span className="ml-1.5 text-[12px] font-normal text-muted">{g.meta}</span> : null}</div>
          <div className="divide-y divide-line/60">{g.rows.map((r, i) => <Row key={r.id} r={r} n={i + 1} busy={busy} onHide={onHide} onShow={onShow} onRemove={onRemove} />)}</div>
        </div>
      ))}
      {sec.rows && sec.rows.length > 0 && <div className="divide-y divide-line/60">{sec.rows.map(r => <Row key={r.id} r={r} busy={busy} onHide={onHide} onShow={onShow} onRemove={onRemove} />)}</div>}
      {!has && <p className="text-[12.5px] text-muted">{sec.empty || 'Nothing here today.'}</p>}
      {sec.more && <p className="mt-1 text-[11.5px] text-muted">{sec.more}</p>}
    </section>
  )
}
