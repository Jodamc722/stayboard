'use client'
// Admin console — RESERVATION EMAILS. One card per building we must notify before a guest arrives.
//
// Several buildings will not let a guest in unless their front desk has been told in writing who
// is coming. This card owns that: who to write to, what the email says, how much lead time the
// building demands, and whether the Elser registration form rides along. Adding a building is
// typing here, never a code change.
//
// Owner-only to edit — this text goes out to an outside building on our letterhead.
import { useEffect, useMemo, useState } from 'react'
import {
  Mail, Loader2, Check, AlertTriangle, Save, ChevronDown, ChevronRight, Eye, Plus, Trash2, Paperclip,
} from 'lucide-react'
import {
  EMAIL_TOKENS, DEFAULT_SUBJECT, DEFAULT_DOC_NAME, STANDARD_BODY, configProblems, type PropertyEmail,
} from '@/lib/reservation-emails'

type Counts = Record<string, { units: number; sample: string[] }>
type Preview = {
  real: boolean; note?: string; guest?: string; checkIn?: string
  to?: string; cc?: string; subject?: string; body?: string; attach?: boolean
}

const field = 'w-full rounded-lg border border-line px-2.5 py-1.5 text-[13px] bg-white disabled:bg-app'
const label = 'text-[11px] uppercase tracking-wider text-muted font-semibold mb-1 block'

export function ReservationEmailsAdmin({ isOwner }: { isOwner: boolean }) {
  const [props, setProps] = useState<PropertyEmail[]>([])
  const [saved, setSaved] = useState('')
  const [counts, setCounts] = useState<Counts>({})
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewFor, setPreviewFor] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)

  useEffect(() => {
    fetch('/api/settings/reservation-emails', { cache: 'no-store' })
      .then(r => r.json())
      .then(j => {
        const list: PropertyEmail[] = Array.isArray(j && j.properties) ? j.properties : []
        setProps(list); setSaved(JSON.stringify(list)); setCounts((j && j.counts) || {}); setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  const dirty = useMemo(() => loaded && JSON.stringify(props) !== saved, [props, saved, loaded])
  const live = props.filter(p => p.enabled && !configProblems(p).length).length

  function patch(id: string, up: Partial<PropertyEmail>) {
    setProps(list => list.map(p => (p.id === id ? { ...p, ...up } : p)))
  }

  async function save() {
    setBusy(true); setErr(null); setMsg(null)
    try {
      const r = await fetch('/api/settings/reservation-emails', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ properties: props }),
      })
      const j = await r.json(); if (!r.ok) throw new Error((j && j.error) || 'Could not save.')
      const list: PropertyEmail[] = Array.isArray(j.properties) ? j.properties : props
      setProps(list); setSaved(JSON.stringify(list))
      setMsg('Saved. Drafts build from these settings from here on.')
    } catch (e: any) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }

  async function loadPreview(id: string) {
    setPreviewing(true); setPreviewFor(id); setPreview(null)
    try {
      const r = await fetch('/api/settings/reservation-emails?preview=' + encodeURIComponent(id), { cache: 'no-store' })
      const j = await r.json()
      setPreview((j && j.preview) || { real: false, note: 'Could not build a preview.' })
    } catch { setPreview({ real: false, note: 'Could not build a preview.' }) } finally { setPreviewing(false) }
  }

  function addProperty() {
    const name = (window.prompt('Building name') || '').trim()
    if (!name) return
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
    if (!id || props.some(p => p.id === id)) { setErr('That building is already on the list.'); return }
    setProps(list => list.concat([{
      id, name, enabled: false, match: [name.toLowerCase()], to: '', cc: '',
      subject: DEFAULT_SUBJECT, body: STANDARD_BODY, leadHours: 2, timing: 'arrival-day',
      autoCreate: true, autoBuildForm: false, attachPdf: false,
      folder: name + '/Reservations', extraLines: '', docName: DEFAULT_DOC_NAME,
    }]))
    setOpen(id)
  }

  return (
    <div className="rounded-2xl border border-line bg-white overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center gap-2 flex-wrap">
        <Mail size={15} className="text-brand-600" />
        <span className="text-sm font-bold text-ink">Reservation emails</span>
        <span className="text-[12px] text-muted">{live} of {props.length} ready to send</span>
        {dirty && <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Unsaved</span>}
        <button onClick={save} disabled={!isOwner || busy || !dirty}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[12px] font-semibold hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
        </button>
      </div>

      <div className="p-4 space-y-4">
        <p className="text-[13px] text-muted">Buildings that must be told who is arriving before the guest gets there. Each one keeps its own recipients, wording and lead time. A building with no <strong>To</strong> address is switched off &mdash; it will never quietly send nothing.</p>

        {!isOwner && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800 flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" /> Only the owner can change reservation emails.
          </div>
        )}
        {err && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {err}</div>}
        {msg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-700 flex items-center gap-2"><Check size={14} /> {msg}</div>}

        <div className="space-y-2">
          {props.map(p => {
            const problems = configProblems(p)
            const c = counts[p.id] || { units: 0, sample: [] }
            const isOpen = open === p.id
            return (
              <div key={p.id} className="rounded-xl border border-line overflow-hidden">
                {/* Name + PDF badge + unit count + a warning + the On switch was more than one
                    phone line, and the On switch was the piece that fell off the right. */}
                <div className="flex items-center gap-2 gap-y-1.5 flex-wrap px-3 py-2.5 bg-app">
                  <button onClick={() => setOpen(isOpen ? null : p.id)} className="text-muted hover:text-ink" aria-label="Toggle">
                    {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>
                  <span className="text-[13px] font-semibold text-ink">{p.name}</span>
                  {p.attachPdf && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-brand-50 text-brand-700" title="Sends the registration form as an attachment">
                      <Paperclip size={10} /> PDF
                    </span>
                  )}
                  <span className="text-[12px] text-muted" title={c.sample.join(', ')}>
                    {c.units} unit{c.units === 1 ? '' : 's'}
                  </span>
                  {c.units === 0 && <span className="text-[11px] font-semibold text-rose-600">matches nothing</span>}
                  {problems.length > 0 && <span className="text-[11px] font-semibold text-amber-700">{problems[0]}</span>}
                  <label className="ml-auto inline-flex items-center gap-1.5 text-[12px] text-muted cursor-pointer">
                    <input type="checkbox" checked={p.enabled} disabled={!isOwner}
                      onChange={e => patch(p.id, { enabled: e.target.checked })} />
                    On
                  </label>
                </div>

                {isOpen && (
                  <div className="p-3 space-y-3 border-t border-line">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <span className={label}>To</span>
                        <input value={p.to} disabled={!isOwner} placeholder="frontdesk@building.com, manager@building.com"
                          onChange={e => patch(p.id, { to: e.target.value })} className={field} />
                      </div>
                      <div>
                        <span className={label}>CC</span>
                        <input value={p.cc} disabled={!isOwner}
                          onChange={e => patch(p.id, { cc: e.target.value })} className={field} />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <span className={label}>Listing keywords</span>
                        <input value={p.match.join(', ')} disabled={!isOwner}
                          onChange={e => patch(p.id, { match: e.target.value.split(',').map(s => s.toLowerCase().trim()).filter(Boolean) })}
                          className={field} />
                        <span className="text-[11px] text-muted mt-1 block">
                          {c.units > 0 ? 'Matches ' + c.sample.join(', ') + (c.units > c.sample.length ? ' +' + (c.units - c.sample.length) + ' more' : '') : 'No listing matches these words.'}
                        </span>
                      </div>
                      <div>
                        <span className={label}>Lead time (hours)</span>
                        <input type="number" min={0} max={168} value={p.leadHours} disabled={!isOwner}
                          onChange={e => patch(p.id, { leadHours: Math.max(0, Math.min(168, Math.round(Number(e.target.value) || 0))) })}
                          className={field} />
                        <span className="text-[11px] text-muted mt-1 block">Warn if unsent this close to check-in.</span>
                        {/* Decides how far ahead the auto-pull files this building's bookings. Elser is
                            told on the day; Salato, Nomad and District 225 as soon as the booking exists. */}
                        <span className={label + ' mt-2'}>Tell them</span>
                        <select value={p.timing} disabled={!isOwner}
                          onChange={e => patch(p.id, { timing: e.target.value as any })} className={field}>
                          <option value="arrival-day">On the day of arrival</option>
                          <option value="on-booking">As soon as it&apos;s booked</option>
                        </select>
                      </div>
                      <div>
                        <span className={label}>Document folder</span>
                        <input value={p.folder} disabled={!isOwner}
                          onChange={e => patch(p.id, { folder: e.target.value })} className={field} />
                        <label className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-ink cursor-pointer">
                          <input type="checkbox" checked={p.attachPdf} disabled={!isOwner}
                            onChange={e => patch(p.id, { attachPdf: e.target.checked })} />
                          Attach registration form
                        </label>
                        <label className="inline-flex items-center gap-1.5 text-[12px] text-ink cursor-pointer">
                          <input type="checkbox" checked={p.autoCreate} disabled={!isOwner}
                            onChange={e => patch(p.id, { autoCreate: e.target.checked })} />
                          Create notices automatically
                        </label>
                        <label className={'inline-flex items-center gap-1.5 text-[12px] cursor-pointer ' + (p.attachPdf ? 'text-ink' : 'text-muted')}>
                          <input type="checkbox" checked={p.autoBuildForm} disabled={!isOwner || !p.attachPdf}
                            onChange={e => patch(p.id, { autoBuildForm: e.target.checked })} />
                          Build today&apos;s forms automatically
                        </label>
                      </div>
                    </div>

                    <div>
                      <span className={label}>Subject</span>
                      <input value={p.subject} disabled={!isOwner}
                        onChange={e => patch(p.id, { subject: e.target.value })} className={field} />
                    </div>

                    {/* Only shown where a form actually rides along — a filename for a building
                        that never attaches anything is a setting with nothing behind it. */}
                    {p.attachPdf && (
                      <div>
                        <span className={label}>Attachment filename</span>
                        <input value={p.docName} disabled={!isOwner}
                          placeholder={DEFAULT_DOC_NAME}
                          onChange={e => patch(p.id, { docName: e.target.value })} className={field} />
                        <p className="text-[11px] text-muted mt-1">
                          What the front desk sees on the file. Name it after the form they asked for.
                          <code className="ml-1">.pdf</code> is added for you.
                        </p>
                      </div>
                    )}

                    <div>
                      <span className={label}>Body</span>
                      <textarea value={p.body} disabled={!isOwner} rows={12}
                        onChange={e => patch(p.id, { body: e.target.value })}
                        className={field + ' font-mono text-[12px] leading-relaxed'} />
                    </div>

                    <div>
                      <span className={label}>Extra lines</span>
                      <textarea value={p.extraLines} disabled={!isOwner} rows={2}
                        placeholder="Appended below the body — e.g. a front-desk link"
                        onChange={e => patch(p.id, { extraLines: e.target.value })}
                        className={field + ' font-mono text-[12px]'} />
                    </div>

                    <div className="rounded-lg bg-app border border-line px-3 py-2">
                      <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-1">Tokens</div>
                      <div className="flex flex-wrap gap-1">
                        {EMAIL_TOKENS.map(t => (
                          <code key={t} className="text-[11px] px-1.5 py-0.5 rounded bg-white border border-line text-ink">{'{{' + t + '}}'}</code>
                        ))}
                      </div>
                      <div className="text-[11px] text-muted mt-1.5">A line whose tokens are all empty is dropped, so a missing ETA never sends a bare label. Wrap an optional phrase in <code className="px-1 rounded bg-white border border-line">[[ … ]]</code> to drop just that part.</div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => loadPreview(p.id)} disabled={previewing}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-brand-300 text-brand-700 px-2.5 py-1.5 text-[12px] font-semibold hover:bg-brand-50 disabled:opacity-40">
                        {previewing && previewFor === p.id ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />} Preview with a real booking
                      </button>
                      {problems.length > 0 && <span className="text-[12px] text-amber-700">{problems.join(' · ')}</span>}
                      {!(props.some(d => d.id === p.id && ['elser', 'salato', 'amrit', 'nomad', 'district225'].includes(d.id))) && (
                        <button onClick={() => setProps(list => list.filter(x => x.id !== p.id))} disabled={!isOwner}
                          className="ml-auto text-muted hover:text-rose-600 disabled:opacity-30" title="Remove this building"><Trash2 size={14} /></button>
                      )}
                    </div>

                    {previewFor === p.id && preview && (
                      <div className="rounded-lg border border-line overflow-hidden">
                        {preview.real ? (
                          <>
                            <div className="px-3 py-2 bg-app border-b border-line text-[12px] text-muted">
                              Built from a real upcoming booking &mdash; {preview.guest} arriving {preview.checkIn}
                            </div>
                            <div className="px-3 py-2 text-[12px] space-y-0.5 border-b border-line">
                              <div><strong>To:</strong> {preview.to || <span className="text-rose-600">nobody — add a recipient</span>}</div>
                              <div><strong>CC:</strong> {preview.cc}</div>
                              <div><strong>Subject:</strong> {preview.subject}</div>
                              {preview.attach && <div><strong>Attach:</strong> Registration form (PDF)</div>}
                            </div>
                            <pre className="px-3 py-2 text-[12px] whitespace-pre-wrap font-sans text-ink">{preview.body}</pre>
                          </>
                        ) : (
                          <div className="px-3 py-2 text-[12px] text-muted">{preview.note}</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <button onClick={addProperty} disabled={!isOwner}
          className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-line text-muted hover:border-brand-300 hover:text-ink disabled:opacity-40">
          <Plus size={13} /> Add a building
        </button>
      </div>
    </div>
  )
}
