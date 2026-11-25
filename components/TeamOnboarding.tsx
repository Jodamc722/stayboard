'use client'
// TEAM ONBOARDING — the manager's side (Jon, 2026-11-25). Opened from Training → People:
//
//   ProfileSheet   one person's page exactly as they see it, plus the Record tab (issues, retraining,
//                  every action they took), Resend invite, tick an app for them, and Send retraining
//   OnboardSheet   a new hire: name, email, phone, role track, market, language, start date → their
//                  track's training is assigned and the invite email goes out
//   PushSheet      post a market's week: it appears on everyone's page in that market and each person
//                  working that week is emailed their days
//   QuizEditor     the questions on one item, English + Spanish, the right answer marked; 100% passes
//
// No drop-downs: every choice is a row of buttons.
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Loader2, Check, Mail, RotateCcw, Plus, Trash2, Send, Link2, Copy } from 'lucide-react'
import { Sheet } from '@/components/Sheet'
import { LeanPick, Tag } from '@/components/lean'
import { MemberProfile, type Profile, type Lang } from '@/components/MemberProfile'

const field = 'w-full rounded-xl border border-line px-3 py-2 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-brand-200'
const btn = (tone: 'ink' | 'ghost' | 'ok' | 'bad' = 'ink') => `inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold disabled:opacity-50 ${tone === 'ink' ? 'bg-ink text-white hover:opacity-90' : tone === 'ok' ? 'bg-emerald-600 text-white hover:opacity-90' : tone === 'bad' ? 'bg-rose-600 text-white hover:opacity-90' : 'border border-line bg-white text-ink hover:bg-app'}`
const Label = ({ children, hint }: { children: ReactNode; hint?: string }) => <span className="block text-[11px] font-semibold uppercase tracking-wider text-muted mb-1">{children}{hint ? <span className="normal-case tracking-normal font-normal"> · {hint}</span> : null}</span>
const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const addDays = (ymd: string, n: number) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const sunOf = (ymd: string) => addDays(ymd, -new Date(ymd + 'T12:00:00Z').getUTCDay())
const dayShort = (ymd: string) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export const TRACKS = [
  { v: 'housekeeping', label: 'Housekeeping' },
  { v: 'maintenance', label: 'Maintenance' },
  { v: 'ops', label: 'Supervisors / Ops' },
  { v: 'ccs_admin', label: 'CCS + Admin' },
]
const MARKETS = ['Miami', 'Broward', 'North']

async function member(body: Record<string, any>) {
  const r = await fetch('/api/training/member', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || j?.ok === false) throw new Error(j?.error || `HTTP ${r.status}`)
  return j
}

// ---------------------------------------------------------------- one person
export function ProfileSheet({ personKey, items, onClose, say }: { personKey: string; items: { id: string; title: { en: string } }[]; onClose: () => void; say: (m: string) => void }) {
  const [data, setData] = useState<Profile | null>(null)
  const [err, setErr] = useState('')
  const [lang, setLang] = useState<Lang>('en')
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/training/member?key=' + encodeURIComponent(personKey), { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setData(j); setErr('')
    } catch (e: any) { setErr(e?.message || String(e)) }
  }, [personKey])
  useEffect(() => { load() }, [load])
  // The manager acts for the person only where it makes sense (ticking an app); quizzes and the signature stay theirs.
  const act = async (body: Record<string, any>) => {
    if (body.action === 'app') return member({ ...body, personKey })
    throw new Error('Only they can do that, from their own page.')
  }
  const invite = async () => {
    setBusy('invite')
    try { await member({ action: 'invite', personKey }); say('Invite emailed.'); load() } catch (e: any) { say(e?.message || String(e)) } finally { setBusy(null) }
  }
  const link = data ? (typeof window !== 'undefined' ? window.location.origin : '') + '/learn/' + data.person.code : ''
  return (
    <Sheet open onClose={onClose} wide title={data?.person.name || 'Profile'}
      subtitle={data ? <span className="flex items-center gap-1.5 flex-wrap">
        {data.onboarding.trackLabel ? <Tag>{data.onboarding.trackLabel}</Tag> : <Tag tone="amber">No role track</Tag>}
        {data.onboarding.onboardedAt ? <Tag tone="emerald">Onboarded {dayShort(data.onboarding.onboardedAt.slice(0, 10))}</Tag> : <Tag tone="amber">Onboarding {data.onboarding.percent}%</Tag>}
        {data.onboarding.inviteError ? <Tag tone="rose" title={data.onboarding.inviteError}>Invite failed</Tag> : data.onboarding.invitedAt ? <Tag tone="sky">Invited {dayShort(data.onboarding.invitedAt.slice(0, 10))}</Tag> : null}
        {data.stats.openIssues ? <Tag tone="rose">{data.stats.openIssues} retraining open</Tag> : null}
      </span> : null}>
      {err ? <p className="text-[12.5px] text-rose-700">{err}</p> : null}
      {!data && !err ? <div className="flex items-center gap-2 text-muted text-[13px] py-10 justify-center"><Loader2 size={15} className="animate-spin" /> Loading their page…</div> : null}
      {data ? <>
        {!data.migrated ? <div className="rounded-xl border border-amber-200 bg-amber-50 text-amber-900 px-3 py-2 text-[12.5px] mb-3">Onboarding, quizzes and retraining switch on once migration 182 is run in Supabase.</div> : null}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <button onClick={invite} disabled={!!busy || !data.person.email} title={data.person.email ? `Email ${data.person.email} their page` : 'Add an email first (Onboard)'} className={btn('ghost')}>{busy === 'invite' ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />} {data.onboarding.invitedAt ? 'Resend invite' : 'Email invite'}</button>
          <button onClick={async () => { try { await navigator.clipboard.writeText(link); say('Link copied.') } catch { say(link) } }} className={btn('ghost')}><Copy size={13} /> Copy their link</button>
          <a href={link} target="_blank" rel="noopener noreferrer" className={btn('ghost')}><Link2 size={13} /> Open as them</a>
          <span className="ml-auto"><LeanPick<Lang> value={lang} size="sm" onPick={setLang} options={[{ v: 'en', label: 'EN' }, { v: 'es', label: 'ES' }]} /></span>
        </div>
        <MemberProfile data={data} lang={lang} mode="manager" act={act} onChanged={load}
          managerSlot={<RetrainForm personKey={personKey} name={data.person.name} items={items} training={data.training} onSent={(m) => { say(m); load() }} />} />
      </> : null}
    </Sheet>
  )
}

// ---------------------------------------------------------------- retraining
const KINDS = [{ v: 'red_button', label: 'Red-button' }, { v: 'inspection', label: 'Inspection' }, { v: 'guest', label: 'Guest issue' }, { v: 'other', label: 'Other' }]
function RetrainForm({ personKey, name, items, training, onSent }: { personKey: string; name: string; items: { id: string; title: { en: string } }[]; training: Profile['training']; onSent: (m: string) => void }) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState('red_button')
  const [note, setNote] = useState('')
  const [ref, setRef] = useState('')
  const [ids, setIds] = useState<string[]>([])
  const [due, setDue] = useState(addDays(todayET(), 3))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const theirs = training.map(t => t.id)
  const list = items.slice().sort((a, b) => (theirs.indexOf(b.id) >= 0 ? 1 : 0) - (theirs.indexOf(a.id) >= 0 ? 1 : 0))
  const send = async () => {
    setBusy(true); setErr('')
    try {
      const r = await member({ action: 'retrain', personKey, kind, note, ref, itemIds: ids, dueOn: due })
      setOpen(false); setNote(''); setRef(''); setIds([])
      onSent(ids.length ? `Retraining sent to ${name}${r.emailed ? ' — emailed' : r.emailError ? ` — ${r.emailError}` : ''}.` : 'Issue logged.')
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(false) }
  }
  if (!open) return <div className="mt-4"><button onClick={() => setOpen(true)} className={btn('bad')}><RotateCcw size={13} /> Log an issue + send retraining</button></div>
  return (
    <div className="mt-4 rounded-2xl border border-line bg-white p-3 space-y-3">
      <div><Label>What happened</Label><LeanPick value={kind} size="sm" onPick={setKind} options={KINDS} /></div>
      <div className="grid sm:grid-cols-[1fr_200px] gap-2">
        <div><Label hint="what they did, in a line">Note</Label><input value={note} onChange={e => setNote(e.target.value)} className={field} placeholder="Entered 1705 without PTE" /></div>
        <div><Label hint="task, reservation">Reference</Label><input value={ref} onChange={e => setRef(e.target.value)} className={field} /></div>
      </div>
      <div>
        <Label hint="re-opened; the quiz must be passed again">Training to redo</Label>
        <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto">
          {list.map(i => <button key={i.id} type="button" onClick={() => setIds(s => s.indexOf(i.id) >= 0 ? s.filter(x => x !== i.id) : s.concat([i.id]))} className={`rounded-full border px-2.5 py-1 text-[12px] font-semibold ${ids.indexOf(i.id) >= 0 ? 'bg-ink text-white border-ink' : 'bg-white border-line text-muted hover:text-ink'}`}>{i.title.en}</button>)}
        </div>
      </div>
      <div className="flex items-end gap-2 flex-wrap">
        <div><Label>Due</Label><input type="date" value={due} onChange={e => setDue(e.target.value)} className={field + ' w-44'} /></div>
        <button onClick={() => setOpen(false)} className={btn('ghost') + ' ml-auto'}>Cancel</button>
        <button onClick={send} disabled={busy} className={btn('bad')}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {ids.length ? `Send ${ids.length} to redo` : 'Log the issue only'}</button>
      </div>
      {err ? <p className="text-[12.5px] text-rose-700">{err}</p> : null}
    </div>
  )
}

// ---------------------------------------------------------------- a new hire
export function OnboardSheet({ preset, candidates, onClose, onDone }: { preset?: { key?: string; name?: string; email?: string | null; market?: string | null } | null; candidates: { key: string; name: string; email: string | null; market: string | null; dept: string | null }[]; onClose: () => void; onDone: (m: string, key: string) => void }) {
  const [f, setF] = useState({ key: preset?.key || '', name: preset?.name || '', email: preset?.email || '', phone: '', track: 'housekeeping', market: preset?.market || 'Miami', lang: 'es' as Lang, startDate: todayET() })
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k: keyof typeof f, v: any) => setF(s => ({ ...s, [k]: v }))
  const matches = q.trim().length >= 2 ? candidates.filter(c => c.name.toLowerCase().indexOf(q.trim().toLowerCase()) >= 0).slice(0, 8) : []
  const go = async () => {
    setBusy(true); setErr('')
    try {
      const r = await member({ action: 'onboard', ...f })
      onDone(`${f.name} is onboarding: ${r.assigned} training item${r.assigned === 1 ? '' : 's'} assigned${r.emailed ? ', invite emailed' : r.emailError ? ` — invite not sent: ${r.emailError}` : ' — no email, share their link'}.`, r.person.key)
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setBusy(false) }
  }
  return (
    <Sheet open onClose={onClose} title="Onboard a team member" subtitle="Their track's training is assigned and their page is emailed to them."
      footer={<div className="flex items-center justify-between gap-2">{err ? <span className="text-[12px] text-rose-700">{err}</span> : <span className="text-[12px] text-muted">Due a week from the start date.</span>}<div className="flex gap-2"><button onClick={onClose} className={btn('ghost')}>Cancel</button><button onClick={go} disabled={busy || !f.name.trim()} className={btn()}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Onboard + email</button></div></div>}>
      <div className="space-y-4">
        {!preset?.key ? <div>
          <Label hint="already on the roster? pick them so their hours and tasks match">Find on the roster</Label>
          <input value={q} onChange={e => setQ(e.target.value)} className={field} placeholder="Type a name…" />
          {matches.length ? <div className="flex flex-wrap gap-1.5 mt-2">{matches.map(c => <button key={c.key} type="button" onClick={() => { setF(s => ({ ...s, key: c.key, name: c.name, email: c.email || s.email, market: c.market ? c.market[0].toUpperCase() + c.market.slice(1) : s.market })); setQ('') }} className="rounded-full border border-line bg-white px-2.5 py-1 text-[12px] font-semibold hover:bg-app">{c.name}</button>)}</div> : null}
        </div> : null}
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label>Full name</Label><input value={f.name} onChange={e => set('name', e.target.value)} className={field} /></div>
          <div><Label hint="their page goes here">Email</Label><input type="email" value={f.email} onChange={e => set('email', e.target.value)} className={field} /></div>
          <div><Label>Phone</Label><input value={f.phone} onChange={e => set('phone', e.target.value)} className={field} /></div>
          <div><Label>Start date</Label><input type="date" value={f.startDate} onChange={e => set('startDate', e.target.value)} className={field} /></div>
        </div>
        <div><Label>Role track</Label><LeanPick value={f.track} size="sm" onPick={v => set('track', v)} options={TRACKS} /></div>
        <div className="flex gap-6 flex-wrap">
          <div><Label>Market</Label><LeanPick value={f.market} size="sm" onPick={v => set('market', v)} options={MARKETS.map(m => ({ v: m, label: m }))} /></div>
          <div><Label>Language</Label><LeanPick<Lang> value={f.lang} size="sm" onPick={v => set('lang', v)} options={[{ v: 'es', label: 'Español' }, { v: 'en', label: 'English' }]} /></div>
        </div>
        {f.key ? <p className="text-[12px] text-muted">Linked to roster record <b>{f.key}</b>.</p> : null}
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------- push the week
export function PushSheet({ onClose, say }: { onClose: () => void; say: (m: string) => void }) {
  const thisSun = sunOf(todayET())
  const [week, setWeek] = useState(addDays(thisSun, 7))
  const [pushes, setPushes] = useState<{ market: string; pushedAt: string; pushedBy: string | null; emailed: number }[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [last, setLast] = useState('')
  const load = useCallback(async () => {
    try { const r = await fetch('/api/training/member?pushes=' + week, { cache: 'no-store' }); const j = await r.json(); setPushes(j.pushes || []) } catch { setPushes([]) }
  }, [week])
  useEffect(() => { load() }, [load])
  const push = async (market: string) => {
    setBusy(market); setLast('')
    try {
      const r = await member({ action: 'schedule.push', weekStart: week, market })
      const m = `${market}: ${r.emailed} of ${r.people} emailed${r.missingEmail?.length ? ` · no email for ${r.missingEmail.join(', ')}` : ''}.`
      setLast(m); say(m); load()
    } catch (e: any) { setLast(e?.message || String(e)) } finally { setBusy(null) }
  }
  return (
    <Sheet open onClose={onClose} title="Post the schedule" subtitle="The week appears on each person's page in that market, and everyone working it is emailed their days.">
      <div className="space-y-4">
        <div><Label>Week</Label><LeanPick value={week} size="sm" onPick={setWeek} options={[{ v: thisSun, label: `This week · ${dayShort(thisSun)}` }, { v: addDays(thisSun, 7), label: `Next week · ${dayShort(addDays(thisSun, 7))}` }]} /></div>
        <ul className="divide-y divide-line rounded-xl border border-line bg-white">
          {MARKETS.map(m => {
            const p = pushes.find(x => x.market === m)
            return (
              <li key={m} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
                <span className="font-semibold w-24">{m}</span>
                <span className="flex-1 text-muted text-[12px]">{p ? `Posted ${new Date(p.pushedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${p.pushedBy ? ` by ${p.pushedBy}` : ''} · ${p.emailed} emailed` : 'Not posted'}</span>
                <button onClick={() => push(m)} disabled={!!busy} className={btn(p ? 'ghost' : 'ink')}>{busy === m ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} {p ? 'Post again' : 'Post + email'}</button>
              </li>
            )
          })}
        </ul>
        <p className="text-[12px] text-muted">Shifts come from Homebase with your Turnover Schedule edits on top. Posting again re-sends the emails with any changes.</p>
        {last ? <p className="text-[12.5px] text-ink">{last}</p> : null}
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------- the quiz on one item
type QRow = { qEn: string; qEs: string; optsEn: string[]; optsEs: string[]; answer: number }
const blank = (): QRow => ({ qEn: '', qEs: '', optsEn: ['', '', ''], optsEs: ['', '', ''], answer: 0 })
export function QuizEditor({ itemId }: { itemId: string }) {
  const [rows, setRows] = useState<QRow[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    fetch('/api/training/member?quiz=' + itemId, { cache: 'no-store' }).then(r => r.json()).then(j => {
      setRows((j.questions || []).map((q: any) => ({ qEn: q.q.en, qEs: q.q.es || '', optsEn: q.options.en, optsEs: q.options.es || q.options.en.map(() => ''), answer: q.answer })))
    }).catch(() => setRows([]))
  }, [itemId])
  const upd = (i: number, patch: Partial<QRow>) => setRows(rs => rs ? rs.map((r, j) => j === i ? { ...r, ...patch } : r) : rs)
  const save = async () => {
    if (!rows) return
    setBusy(true); setMsg('')
    try {
      const r = await member({ action: 'quiz.save', itemId, questions: rows.map(r => ({ q: { en: r.qEn, es: r.qEs }, options: { en: r.optsEn, es: r.optsEs }, answer: r.answer })) })
      setMsg(r.questions?.length ? `Saved — ${r.questions.length} question${r.questions.length === 1 ? '' : 's'}. 100% to pass.` : 'No quiz on this item.')
    } catch (e: any) { setMsg(e?.message || String(e)) } finally { setBusy(false) }
  }
  if (!rows) return <p className="text-[12px] text-muted"><Loader2 size={12} className="animate-spin inline" /> Loading the quiz…</p>
  return (
    <div className="rounded-xl border border-line p-3 space-y-3">
      <div className="flex items-center gap-2"><Label hint="all answers right to pass; they can retake it">Quiz</Label><button type="button" onClick={() => setRows(rows.concat([blank()]))} className={btn('ghost') + ' ml-auto !py-1'}><Plus size={12} /> Question</button></div>
      {!rows.length ? <p className="text-[12.5px] text-muted">No quiz. Without one, Done is a tap; with one, Done means they passed it.</p> : null}
      {rows.map((r, i) => (
        <div key={i} className="rounded-xl bg-app/40 border border-line p-2.5 space-y-2">
          <div className="grid sm:grid-cols-2 gap-2">
            <input value={r.qEn} onChange={e => upd(i, { qEn: e.target.value })} className={field} placeholder={`Question ${i + 1} · English`} />
            <input value={r.qEs} onChange={e => upd(i, { qEs: e.target.value })} className={field} placeholder={`Pregunta ${i + 1} · Español`} />
          </div>
          {r.optsEn.map((o, oi) => (
            <div key={oi} className="grid grid-cols-[auto_1fr_1fr_auto] gap-2 items-center">
              <button type="button" title="The right answer" onClick={() => upd(i, { answer: oi })} className={`w-7 h-7 rounded-full border inline-flex items-center justify-center ${r.answer === oi ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-line text-muted'}`}>{r.answer === oi ? <Check size={13} /> : String.fromCharCode(65 + oi)}</button>
              <input value={o} onChange={e => upd(i, { optsEn: r.optsEn.map((x, j) => j === oi ? e.target.value : x) })} className={field} placeholder="Answer · English" />
              <input value={r.optsEs[oi] || ''} onChange={e => upd(i, { optsEs: r.optsEn.map((_, j) => j === oi ? e.target.value : (r.optsEs[j] || '')) })} className={field} placeholder="Respuesta · Español" />
              <button type="button" title="Remove answer" disabled={r.optsEn.length <= 2} onClick={() => upd(i, { optsEn: r.optsEn.filter((_, j) => j !== oi), optsEs: r.optsEs.filter((_, j) => j !== oi), answer: r.answer >= oi && r.answer > 0 ? r.answer - 1 : r.answer })} className="text-muted hover:text-rose-600 disabled:opacity-30"><Trash2 size={13} /></button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            {r.optsEn.length < 5 ? <button type="button" onClick={() => upd(i, { optsEn: r.optsEn.concat(['']), optsEs: r.optsEs.concat(['']) })} className="text-[12px] font-semibold text-muted hover:text-ink">+ answer</button> : null}
            <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="ml-auto text-[12px] font-semibold text-rose-600">Remove question</button>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2"><button type="button" onClick={save} disabled={busy} className={btn()}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save quiz</button>{msg ? <span className="text-[12px] text-muted">{msg}</span> : null}</div>
    </div>
  )
}
