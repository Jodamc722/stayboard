'use client'
// Owner Report renderer + edit-in-place. Renders the ReportContent JSON as a stacked
// "deck" of sections in the Capri look (navy/coral/gold on cream). When canEdit,
// an Edit toggle turns every text/number into an inline input, lets quotes/themes/
// project items be removed/added, and sections be hidden/shown (content.omit).
// Save PUTs the whole content JSON to /api/reports. Subcomponents live at module
// scope (never inline in render) so inputs keep focus while typing.
import { useRef, useState } from 'react'
import { Pencil, Save, Loader2, Eye, EyeOff, X, Plus, Link as LinkIcon, Check, Paperclip, Image as ImageIcon } from 'lucide-react'

type Any = any

const NAVY = '#102A43'
const CORAL = '#E2725B'
const GOLD = '#C9A227'
const CREAM = '#FAF6EF'

// ---------- tiny editable primitives (module scope: keeps input focus) ----------
function Ed({ v, set, edit, className, multiline, placeholder }: {
  v: string; set: (s: string) => void; edit: boolean; className?: string; multiline?: boolean; placeholder?: string
}) {
  if (!edit) return <span className={className}>{v}</span>
  if (multiline) {
    return (
      <textarea
        value={v}
        placeholder={placeholder}
        onChange={e => set(e.target.value)}
        rows={Math.max(2, Math.ceil((v || '').length / 60))}
        className={(className || '') + ' w-full bg-white/70 border border-dashed border-[#C9A227] rounded-md px-1.5 py-0.5 outline-none'}
        style={{ color: 'inherit', font: 'inherit', letterSpacing: 'inherit' }}
      />
    )
  }
  return (
    <input
      value={v}
      placeholder={placeholder}
      onChange={e => set(e.target.value)}
      className={(className || '') + ' bg-white/70 border border-dashed border-[#C9A227] rounded-md px-1.5 outline-none min-w-0'}
      style={{ color: 'inherit', font: 'inherit', letterSpacing: 'inherit', width: Math.max(4, (v || '').length + 2) + 'ch' }}
    />
  )
}

function SectionShell({ id, title, hidden, edit, onToggle, children }: {
  id: string; title: string; hidden: boolean; edit: boolean; onToggle: () => void; children: React.ReactNode
}) {
  if (hidden && !edit) return null
  return (
    <section className="relative">
      {edit && (
        <button
          onClick={onToggle}
          className="absolute -top-3 right-4 z-10 inline-flex items-center gap-1 rounded-full bg-white shadow border border-[#e5decf] px-2.5 py-1 text-[11px] font-semibold text-[#102A43]"
        >
          {hidden ? <Eye size={11} /> : <EyeOff size={11} />} {hidden ? 'Show ' + title : 'Hide ' + title}
        </button>
      )}
      <div className={hidden ? 'opacity-30 pointer-events-none select-none' : ''}>{children}</div>
    </section>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-bold uppercase tracking-[0.28em]" style={{ color: CORAL }}>{children}</p>
}

// ---------- main ----------
export function ReportView({ initial, canEdit }: { initial: Any; canEdit: boolean }) {
  const [c, setC] = useState<Any>(initial.content || {})
  const [edit, setEdit] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState('')
  const [attachMsg, setAttachMsg] = useState('')
  const [picker, setPicker] = useState(false)
  const [pool, setPool] = useState<{ url: string; thumb: string; listing: string }[] | null>(null)
  const pacingRef = useRef<HTMLInputElement>(null)
  const stmtRef = useRef<HTMLInputElement>(null)
  const heroRef = useRef<HTMLInputElement>(null)

  // path setter: patch('voices.quotes.0.text', v)
  function patch(path: string, value: Any) {
    setC((prev: Any) => {
      const next = JSON.parse(JSON.stringify(prev))
      const parts = path.split('.')
      let node = next
      for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]]
      node[parts[parts.length - 1]] = value
      return next
    })
  }
  function mutate(fn: (draft: Any) => void) {
    setC((prev: Any) => { const next = JSON.parse(JSON.stringify(prev)); fn(next); return next })
  }
  const omit: string[] = Array.isArray(c.omit) ? c.omit : []
  const isHidden = (k: string) => omit.indexOf(k) >= 0
  function toggleSection(k: string) {
    mutate(d => {
      d.omit = Array.isArray(d.omit) ? d.omit : []
      const i = d.omit.indexOf(k)
      if (i >= 0) d.omit.splice(i, 1); else d.omit.push(k)
    })
  }

  async function save() {
    setSaving(true)
    try {
      const r = await fetch('/api/reports', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: initial.id, content: c }),
      })
      const d = await r.json()
      if (d?.ok) { setSavedFlash(true); setTimeout(() => setSavedFlash(false), 2000) }
    } catch {}
    setSaving(false)
  }

  function copyLink() {
    try { navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {}
  }

  // ---- attachments on an existing report (P3.5) ----
  async function uploadOne(file: File): Promise<string | null> {
    const fd = new FormData()
    fd.append('file', file)
    try {
      const r = await fetch('/api/guidebook/upload', { method: 'POST', body: fd })
      const d = await r.json()
      if (d?.ok && d?.url) return d.url
      setAttachMsg(d?.error || 'Upload failed')
    } catch { setAttachMsg('Upload failed') }
    return null
  }
  async function parseAttach(payload: Any): Promise<Any | null> {
    try {
      const r = await fetch('/api/reports/attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: initial.id, ...payload }),
      })
      const d = await r.json()
      if (d?.ok && d?.section) return d.section
      setAttachMsg(d?.error || 'Could not read that PDF')
    } catch { setAttachMsg('Could not read that PDF') }
    return null
  }
  async function onPacingPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    setAttachMsg(''); setBusy('pacing')
    const url = await uploadOne(f)
    if (url) {
      const section = await parseAttach({ kind: 'pacing', url })
      if (section) patch('pacing', section)
    }
    setBusy(''); e.target.value = ''
  }
  async function onStatementsPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files).slice(0, 4) : []
    if (!files.length) return
    setAttachMsg(''); setBusy('statements')
    const urls: string[] = []
    for (const f of files) {
      const url = await uploadOne(f)
      if (url) urls.push(url)
    }
    if (urls.length) {
      const section = await parseAttach({ kind: 'statements', urls })
      if (section) patch('statement', section)
    }
    setBusy(''); e.target.value = ''
  }
  async function onHeroPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    setAttachMsg(''); setBusy('hero')
    const url = await uploadOne(f)
    if (url) { patch('hero.heroImage', url); setPicker(false) }
    setBusy(''); e.target.value = ''
  }
  function openPicker() {
    setPicker(!picker)
    if (pool === null) {
      fetch('/api/reports/attach?photos=' + encodeURIComponent(initial.id)).then(r => r.json()).then(d => {
        setPool(Array.isArray(d?.photos) ? d.photos : [])
      }).catch(() => setPool([]))
    }
  }

  const meta = c.meta || {}
  const hero = c.hero || {}
  const snap = c.snapshot || {}
  const plan = c.plan
  const ahead = c.ahead || {}
  const voices = c.voices || {}
  const projects = c.projects || {}
  const footer = (hero.title || '') + '  ·  ' + (hero.dateLabel || 'OWNER REVIEW')

  return (
    <div className="min-h-screen" style={{ background: CREAM, color: NAVY }}>
      {/* toolbar (edit only appears for logged-in team) */}
      {canEdit && (
        <div className="sticky top-0 z-20 flex items-center justify-end gap-2 px-4 py-2.5 flex-wrap" style={{ background: 'rgba(250,246,239,0.92)', backdropFilter: 'blur(6px)', borderBottom: '1px solid #eadfc9' }}>
          {attachMsg && <span className="mr-auto text-[11px] font-semibold" style={{ color: CORAL }}>{attachMsg}</span>}
          {edit && (
            <>
              <input ref={pacingRef} type="file" accept="application/pdf" className="hidden" onChange={onPacingPick} />
              <input ref={stmtRef} type="file" accept="application/pdf" multiple className="hidden" onChange={onStatementsPick} />
              <input ref={heroRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onHeroPick} />
              <button onClick={() => pacingRef.current && pacingRef.current.click()} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full border border-[#d9d0bc] bg-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50">
                {busy === 'pacing' ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />} Pacing PDF
              </button>
              <button onClick={() => stmtRef.current && stmtRef.current.click()} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full border border-[#d9d0bc] bg-white px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50">
                {busy === 'statements' ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />} Statements
              </button>
              <button onClick={openPicker} disabled={!!busy} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold disabled:opacity-50" style={picker ? { background: NAVY, color: 'white' } : { background: 'white', border: '1px solid #d9d0bc' }}>
                {busy === 'hero' ? <Loader2 size={12} className="animate-spin" /> : <ImageIcon size={12} />} Hero photo
              </button>
            </>
          )}
          <button onClick={copyLink} className="inline-flex items-center gap-1.5 rounded-full border border-[#d9d0bc] bg-white px-3.5 py-1.5 text-[12px] font-semibold">
            {copied ? <Check size={12} /> : <LinkIcon size={12} />} {copied ? 'Copied' : 'Copy share link'}
          </button>
          {edit && (
            <button onClick={save} disabled={saving} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60" style={{ background: CORAL }}>
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} {savedFlash ? 'Saved ✓' : 'Save changes'}
            </button>
          )}
          <button onClick={() => setEdit(!edit)} className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold" style={edit ? { background: NAVY, color: 'white' } : { background: 'white', border: '1px solid #d9d0bc' }}>
            <Pencil size={12} /> {edit ? 'Done editing' : 'Edit report'}
          </button>
        </div>
      )}

      {/* hero photo picker: pick from the scoped listings' Guesty photos, or upload */}
      {canEdit && edit && picker && (
        <div className="px-4 py-3 border-b" style={{ background: '#fffdf7', borderColor: '#eadfc9' }}>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: GOLD }}>HERO PHOTO  ·  FROM THE LISTING</p>
            <button onClick={() => heroRef.current && heroRef.current.click()} disabled={!!busy} className="inline-flex items-center gap-1 rounded-full border border-[#d9d0bc] bg-white px-2.5 py-1 text-[11px] font-semibold disabled:opacity-50">
              <Plus size={11} /> Upload instead
            </button>
            {hero.heroImage && (
              <button onClick={() => patch('hero.heroImage', null)} className="inline-flex items-center gap-1 rounded-full border border-[#d9d0bc] bg-white px-2.5 py-1 text-[11px] font-semibold" style={{ color: CORAL }}>
                <X size={11} /> Remove current
              </button>
            )}
            <button onClick={() => setPicker(false)} className="ml-auto" style={{ color: '#93a3b3' }}><X size={14} /></button>
          </div>
          {pool === null ? (
            <p className="mt-2 text-[12px] italic" style={{ color: '#93a3b3' }}>Loading listing photos&hellip;</p>
          ) : pool.length ? (
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {pool.map((p, i) => (
                <button key={i} onClick={() => { patch('hero.heroImage', p.url); setPicker(false) }} className="shrink-0 rounded-lg overflow-hidden border-2" style={{ borderColor: hero.heroImage === p.url ? CORAL : '#efe8d8' }} title={p.listing}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.thumb} alt="" loading="lazy" className="h-20 w-28 object-cover" />
                </button>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[12px] italic" style={{ color: '#93a3b3' }}>No listing photos found for this report&rsquo;s properties &mdash; use Upload instead.</p>
          )}
        </div>
      )}

      <div className="max-w-4xl mx-auto px-5 sm:px-8 pb-20">

        {/* ---------- HERO ---------- */}
        <header className="pt-14 pb-12 text-center border-b" style={{ borderColor: '#eadfc9' }}>
          <Eyebrow>{hero.eyebrow || ''}</Eyebrow>
          <p className="mt-5 text-[12px] font-bold uppercase tracking-[0.3em]" style={{ color: GOLD }}>
            <Ed v={hero.dateLabel || 'OWNER REVIEW'} set={v => patch('hero.dateLabel', v)} edit={edit} />
          </p>
          <h1 className="mt-2 text-5xl sm:text-6xl font-black tracking-tight" style={{ color: NAVY }}>
            <Ed v={hero.title || ''} set={v => patch('hero.title', v)} edit={edit} />
          </h1>
          <p className="mt-5 text-lg sm:text-xl font-medium max-w-2xl mx-auto" style={{ color: '#41586e' }}>
            <Ed v={hero.headline || ''} set={v => patch('hero.headline', v)} edit={edit} multiline />
          </p>
          {hero.heroImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={hero.heroImage} alt="" className="mt-8 w-full rounded-2xl shadow-md object-cover" style={{ maxHeight: 420 }} />
          )}
          <p className="mt-8 text-[12px] uppercase tracking-[0.18em] font-semibold" style={{ color: '#8b8674' }}>
            <Ed v={hero.preparedFor || ''} set={v => patch('hero.preparedFor', v)} edit={edit} />  ·  STAY HOSPITALITY
          </p>
        </header>

        {/* ---------- SNAPSHOT ---------- */}
        <SectionShell id="snapshot" title="Snapshot" hidden={isHidden('snapshot')} edit={edit} onToggle={() => toggleSection('snapshot')}>
          <div className="pt-12">
            <Eyebrow>SNAPSHOT</Eyebrow>
            <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
              <Ed v={snap.headline || ''} set={v => patch('snapshot.headline', v)} edit={edit} multiline />
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: '#6b7c8d' }}>
              <Ed v={snap.subtitle || ''} set={v => patch('snapshot.subtitle', v)} edit={edit} />
            </p>
            <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
              {(snap.cards || []).map((card: Any, i: number) => (
                <div key={card.key || i} className="relative rounded-2xl bg-white p-5 shadow-sm border" style={{ borderColor: '#efe8d8' }}>
                  {edit && (
                    <button onClick={() => mutate(d => d.snapshot.cards.splice(i, 1))} className="absolute top-2 right-2" style={{ color: CORAL }}><X size={13} /></button>
                  )}
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: CORAL }}>
                    <Ed v={card.label || ''} set={v => patch('snapshot.cards.' + i + '.label', v)} edit={edit} />
                  </p>
                  <p className="mt-2 text-4xl font-black tabular-nums" style={{ color: NAVY }}>
                    <Ed v={card.value || ''} set={v => patch('snapshot.cards.' + i + '.value', v)} edit={edit} />
                  </p>
                  <p className="mt-2 text-[11px] leading-snug" style={{ color: '#6b7c8d' }}>
                    <Ed v={card.sub || ''} set={v => patch('snapshot.cards.' + i + '.sub', v)} edit={edit} multiline />
                  </p>
                </div>
              ))}
            </div>
            {snap.ytd && (
              <div className="mt-5 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-5" style={{ background: NAVY, color: 'white' }}>
                <div className="flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: GOLD }}>{meta.asOf ? String(meta.asOf).slice(0, 4) : ''} YEAR-TO-DATE</p>
                  <p className="mt-1.5 text-sm text-white/85">
                    <Ed v={snap.ytd.text || ''} set={v => patch('snapshot.ytd.text', v)} edit={edit} multiline />
                  </p>
                </div>
                <div className="flex gap-6">
                  {(snap.ytd.stats || []).map((s: Any, i: number) => (
                    <div key={i} className="text-center">
                      <p className="text-2xl font-black tabular-nums"><Ed v={s.value || ''} set={v => patch('snapshot.ytd.stats.' + i + '.value', v)} edit={edit} /></p>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-white/60 font-semibold mt-0.5">{s.label}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </SectionShell>

        {/* ---------- PACING (only when data exists) ---------- */}
        {c.pacing && (
          <SectionShell id="pacing" title="Pacing" hidden={isHidden('pacing')} edit={edit} onToggle={() => toggleSection('pacing')}>
            <div className="pt-12">
              <Eyebrow>PACING VS. MARKET</Eyebrow>
              <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
                <Ed v={c.pacing.headline || ''} set={v => patch('pacing.headline', v)} edit={edit} multiline />
              </h2>
              <p className="mt-1 text-[13px]" style={{ color: '#6b7c8d' }}>
                <Ed v={c.pacing.subtitle || ''} set={v => patch('pacing.subtitle', v)} edit={edit} />
              </p>
              <div className="mt-6 space-y-4">
                {(c.pacing.rows || []).map((r: Any, i: number) => (
                  <div key={i} className="relative rounded-2xl bg-white p-5 shadow-sm border flex items-center gap-4" style={{ borderColor: '#efe8d8' }}>
                    {edit && (
                      <button onClick={() => mutate(d => d.pacing.rows.splice(i, 1))} className="absolute top-2 right-2" style={{ color: CORAL }}><X size={13} /></button>
                    )}
                    <div className="w-28 text-sm font-bold">{r.metric}</div>
                    <div className="flex-1 grid grid-cols-2 gap-3 text-center">
                      <div>
                        <p className="text-2xl font-black tabular-nums" style={{ color: NAVY }}><Ed v={r.ours || ''} set={v => patch('pacing.rows.' + i + '.ours', v)} edit={edit} /></p>
                        <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: CORAL }}>{meta.scopeLabel || 'Us'}</p>
                      </div>
                      <div>
                        <p className="text-2xl font-black tabular-nums" style={{ color: '#93a3b3' }}><Ed v={r.comps || ''} set={v => patch('pacing.rows.' + i + '.comps', v)} edit={edit} /></p>
                        <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#93a3b3' }}>Comp set</p>
                      </div>
                    </div>
                    <div className="w-24 text-right">
                      <p className="text-lg font-black" style={{ color: (String(r.delta || '').trim().indexOf('-') === 0 || String(r.delta || '').trim().indexOf('−') === 0) ? '#a6b1bc' : '#1a7f4f' }}><Ed v={r.delta || ''} set={v => patch('pacing.rows.' + i + '.delta', v)} edit={edit} /></p>
                      <p className="text-[10px] uppercase tracking-wider" style={{ color: '#93a3b3' }}>vs. comps</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </SectionShell>
        )}

        {/* ---------- PERFORMANCE VS PLAN ---------- */}
        {plan && (
          <SectionShell id="plan" title="Plan" hidden={isHidden('plan')} edit={edit} onToggle={() => toggleSection('plan')}>
            <div className="pt-12">
              <Eyebrow>PERFORMANCE VS. PLAN</Eyebrow>
              <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
                <Ed v={plan.headline || ''} set={v => patch('plan.headline', v)} edit={edit} multiline />
              </h2>
              <div className="mt-6 space-y-4">
                {(plan.months || []).map((m: Any, mi: number) => (
                  <div key={mi} className="relative rounded-2xl bg-white p-5 shadow-sm border" style={{ borderColor: '#efe8d8' }}>
                    {edit && (
                      <button onClick={() => mutate(d => d.plan.months.splice(mi, 1))} className="absolute top-2 right-2" style={{ color: CORAL }}><X size={13} /></button>
                    )}
                    <div className="flex items-center gap-2.5">
                      <span className="text-sm font-black tracking-[0.14em]">{m.label}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider" style={m.status === 'IN MONTH' ? { background: '#fdeee9', color: CORAL } : { background: '#eef3f7', color: '#5a7186' }}>
                        <Ed v={m.status || ''} set={v => patch('plan.months.' + mi + '.status', v)} edit={edit} />
                      </span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {(m.rows || []).map((r: Any, ri: number) => (
                        <div key={ri} className="rounded-xl px-3 py-2.5" style={{ background: '#faf8f2' }}>
                          <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: '#93a3b3' }}>{r.metric}</p>
                          <p className="text-xl font-black tabular-nums mt-0.5"><Ed v={r.actual || ''} set={v => patch('plan.months.' + mi + '.rows.' + ri + '.actual', v)} edit={edit} /></p>
                          <p className="text-[11px]" style={{ color: '#93a3b3' }}><Ed v={r.budget || ''} set={v => patch('plan.months.' + mi + '.rows.' + ri + '.budget', v)} edit={edit} /></p>
                          <p className="text-[12px] font-bold mt-0.5" style={{ color: r.good ? '#1a7f4f' : '#a6b1bc' }}>
                            <Ed v={r.delta || ''} set={v => patch('plan.months.' + mi + '.rows.' + ri + '.delta', v)} edit={edit} />
                          </p>
                        </div>
                      ))}
                    </div>
                    {(m.note || edit) && (
                      <p className="mt-3 text-[13px]" style={{ color: '#41586e' }}>
                        <Ed v={m.note || ''} set={v => patch('plan.months.' + mi + '.note', v)} edit={edit} multiline placeholder="One-line commentary…" />
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </SectionShell>
        )}

        {/* ---------- OWNER STATEMENT (P3 — renders when present) ---------- */}
        {c.statement && (
          <SectionShell id="statement" title="Statement" hidden={isHidden('statement')} edit={edit} onToggle={() => toggleSection('statement')}>
            <div className="pt-12">
              <Eyebrow>OWNER STATEMENT</Eyebrow>
              <div className="mt-4 space-y-3">
                {(c.statement.items || []).map((it: Any, i: number) => (
                  <div key={i} className="relative rounded-2xl bg-white p-5 shadow-sm border" style={{ borderColor: '#efe8d8' }}>
                    {edit && (
                      <button onClick={() => mutate(d => d.statement.items.splice(i, 1))} className="absolute top-2 right-2" style={{ color: CORAL }}><X size={13} /></button>
                    )}
                    <p className="text-sm font-bold"><Ed v={it.title || ''} set={v => patch('statement.items.' + i + '.title', v)} edit={edit} /></p>
                    <p className="text-[13px] mt-1" style={{ color: '#41586e' }}><Ed v={it.summary || ''} set={v => patch('statement.items.' + i + '.summary', v)} edit={edit} multiline /></p>
                  </div>
                ))}
              </div>
            </div>
          </SectionShell>
        )}

        {/* ---------- LOOKING AHEAD ---------- */}
        <SectionShell id="ahead" title="Looking Ahead" hidden={isHidden('ahead')} edit={edit} onToggle={() => toggleSection('ahead')}>
          <div className="pt-12">
            <Eyebrow>LOOKING AHEAD</Eyebrow>
            <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
              <Ed v={ahead.headline || ''} set={v => patch('ahead.headline', v)} edit={edit} multiline />
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: '#6b7c8d' }}>
              <Ed v={ahead.subtitle || ''} set={v => patch('ahead.subtitle', v)} edit={edit} />
            </p>
            <div className="mt-6 grid sm:grid-cols-2 gap-4">
              {(ahead.months || []).map((m: Any, i: number) => (
                <div key={i} className="relative rounded-2xl bg-white p-5 shadow-sm border" style={{ borderColor: '#efe8d8' }}>
                  {edit && (
                    <button onClick={() => mutate(d => d.ahead.months.splice(i, 1))} className="absolute top-2 right-2" style={{ color: CORAL }}><X size={13} /></button>
                  )}
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-black tracking-[0.14em]"><Ed v={m.label || ''} set={v => patch('ahead.months.' + i + '.label', v)} edit={edit} /></span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider" style={{ background: '#fdeee9', color: CORAL }}>{m.status}</span>
                  </div>
                  <p className="mt-3 text-4xl font-black tabular-nums">
                    {edit ? <Ed v={String(m.occPct ?? 0)} set={v => patch('ahead.months.' + i + '.occPct', Number(v) || 0)} edit /> : (m.occPct ?? 0)}%
                    <span className="text-sm font-semibold ml-2" style={{ color: '#93a3b3' }}>on the books</span>
                  </p>
                  <p className="mt-1.5 text-[13px] font-semibold" style={{ color: '#41586e' }}>
                    ADR <Ed v={m.adr || ''} set={v => patch('ahead.months.' + i + '.adr', v)} edit={edit} />   ·   RevPAR <Ed v={m.revpar || ''} set={v => patch('ahead.months.' + i + '.revpar', v)} edit={edit} />
                  </p>
                  {(m.note || edit) && (
                    <p className="mt-3 text-[13px]" style={{ color: '#6b7c8d' }}>
                      <Ed v={m.note || ''} set={v => patch('ahead.months.' + i + '.note', v)} edit={edit} multiline placeholder="Commentary…" />
                    </p>
                  )}
                </div>
              ))}
            </div>
            {Array.isArray(ahead.strip) && ahead.strip.length > 0 && (
              <div className="mt-6 rounded-2xl bg-white p-5 shadow-sm border" style={{ borderColor: '#efe8d8' }}>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] mb-4" style={{ color: '#93a3b3' }}>MONTHS AHEAD  ·  OCCUPANCY %</p>
                <div className="flex items-end gap-3 h-36">
                  {ahead.strip.map((s: Any, i: number) => (
                    <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
                      <span className="text-[12px] font-black tabular-nums mb-1">{s.occPct}%</span>
                      <div className="w-full rounded-t-md" style={{ height: Math.max(4, (Number(s.occPct) || 0)) + '%', background: i === 1 ? CORAL : NAVY, opacity: i === 0 ? 0.35 : 1 }} />
                      <span className="text-[11px] font-semibold mt-1.5" style={{ color: '#6b7c8d' }}>{s.month}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </SectionShell>

        {/* ---------- GUEST VOICES ---------- */}
        <SectionShell id="voices" title="Guest Voices" hidden={isHidden('voices')} edit={edit} onToggle={() => toggleSection('voices')}>
          <div className="pt-12">
            <Eyebrow>GUEST VOICES</Eyebrow>
            <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
              <Ed v={voices.headline || ''} set={v => patch('voices.headline', v)} edit={edit} multiline />
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: '#6b7c8d' }}>
              <Ed v={voices.subtitle || ''} set={v => patch('voices.subtitle', v)} edit={edit} />
            </p>
            <div className="mt-6 grid sm:grid-cols-2 gap-4">
              {(voices.quotes || []).map((q: Any, i: number) => (
                <div key={i} className="relative rounded-2xl bg-white p-5 shadow-sm border" style={{ borderColor: '#efe8d8' }}>
                  {edit && (
                    <button onClick={() => mutate(d => d.voices.quotes.splice(i, 1))} className="absolute top-2 right-2 rounded-full p-1 hover:bg-red-50" style={{ color: CORAL }}><X size={13} /></button>
                  )}
                  <span className="text-4xl leading-none font-serif" style={{ color: GOLD }}>“</span>
                  <p className="mt-1 text-[14px] leading-relaxed" style={{ color: '#2c4257' }}>
                    <Ed v={q.text || ''} set={v => patch('voices.quotes.' + i + '.text', v)} edit={edit} multiline />
                  </p>
                  <p className="mt-3 text-[11px] font-bold tracking-[0.14em]" style={{ color: NAVY }}>
                    <Ed v={q.guest || ''} set={v => patch('voices.quotes.' + i + '.guest', v)} edit={edit} />
                    <span className="font-semibold ml-2" style={{ color: '#93a3b3' }}>
                      <Ed v={q.unit || ''} set={v => patch('voices.quotes.' + i + '.unit', v)} edit={edit} /> · <Ed v={q.br || ''} set={v => patch('voices.quotes.' + i + '.br', v)} edit={edit} />
                    </span>
                  </p>
                </div>
              ))}
            </div>
            {edit && (
              <button onClick={() => mutate(d => { d.voices.quotes = d.voices.quotes || []; d.voices.quotes.push({ text: '', guest: 'GUEST', unit: '', br: '' }) })} className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: CORAL }}><Plus size={12} /> Add quote</button>
            )}

            <div className="mt-8 rounded-2xl p-6" style={{ background: NAVY, color: 'white' }}>
              <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: GOLD }}>WHAT WE&rsquo;RE HEARING  ·  AND WHAT WE&rsquo;RE DOING</p>
              <div className="mt-4 space-y-4">
                {(voices.themes || []).map((t: Any, i: number) => (
                  <div key={i} className="relative border-l-2 pl-4" style={{ borderColor: CORAL }}>
                    {edit && (
                      <button onClick={() => mutate(d => d.voices.themes.splice(i, 1))} className="absolute top-0 right-0 rounded-full p-1 text-white/50 hover:text-white"><X size={13} /></button>
                    )}
                    <p className="text-sm font-bold"><Ed v={t.title || ''} set={v => patch('voices.themes.' + i + '.title', v)} edit={edit} /></p>
                    <p className="text-[13px] text-white/75 mt-0.5"><Ed v={t.body || ''} set={v => patch('voices.themes.' + i + '.body', v)} edit={edit} multiline /></p>
                    <p className="text-[13px] mt-0.5" style={{ color: GOLD }}><Ed v={t.action || ''} set={v => patch('voices.themes.' + i + '.action', v)} edit={edit} multiline /></p>
                  </div>
                ))}
              </div>
              {edit && (
                <button onClick={() => mutate(d => { d.voices.themes = d.voices.themes || []; d.voices.themes.push({ title: 'New theme', body: '', action: '' }) })} className="mt-4 inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: GOLD }}><Plus size={12} /> Add theme</button>
              )}
            </div>
          </div>
        </SectionShell>

        {/* ---------- PROJECTS ---------- */}
        <SectionShell id="projects" title="Projects" hidden={isHidden('projects')} edit={edit} onToggle={() => toggleSection('projects')}>
          <div className="pt-12">
            <Eyebrow>PROJECTS</Eyebrow>
            <h2 className="mt-1.5 text-3xl font-extrabold tracking-tight">
              <Ed v={projects.headline || ''} set={v => patch('projects.headline', v)} edit={edit} multiline />
            </h2>
            <p className="mt-1 text-[13px]" style={{ color: '#6b7c8d' }}>
              <Ed v={projects.subtitle || ''} set={v => patch('projects.subtitle', v)} edit={edit} />
            </p>
            <div className="mt-6 grid md:grid-cols-3 gap-4">
              {(projects.weeks || []).map((w: Any, wi: number) => (
                <div key={wi} className="relative rounded-2xl bg-white p-5 shadow-sm border" style={{ borderColor: '#efe8d8' }}>
                  {edit && (
                    <button onClick={() => mutate(d => d.projects.weeks.splice(wi, 1))} className="absolute top-2 right-2" style={{ color: CORAL }}><X size={13} /></button>
                  )}
                  <p className="text-[11px] font-black tracking-[0.16em] pb-2 border-b" style={{ color: CORAL, borderColor: '#f3ecdd' }}>
                    <Ed v={w.label || ''} set={v => patch('projects.weeks.' + wi + '.label', v)} edit={edit} />
                  </p>
                  {(w.groups || []).map((g: Any, gi: number) => (
                    <div key={gi} className="mt-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: '#93a3b3' }}>
                        <Ed v={g.category || ''} set={v => patch('projects.weeks.' + wi + '.groups.' + gi + '.category', v)} edit={edit} />
                      </p>
                      <ul className="mt-1.5 space-y-1.5">
                        {(g.items || []).map((it: string, ii: number) => (
                          <li key={ii} className="relative text-[12.5px] leading-snug pl-3" style={{ color: '#2c4257' }}>
                            <span className="absolute left-0 top-[7px] w-1 h-1 rounded-full" style={{ background: GOLD }} />
                            <Ed v={it} set={v => patch('projects.weeks.' + wi + '.groups.' + gi + '.items.' + ii, v)} edit={edit} multiline />
                            {edit && (
                              <button onClick={() => mutate(d => d.projects.weeks[wi].groups[gi].items.splice(ii, 1))} className="absolute -left-4 top-0.5" style={{ color: CORAL }}><X size={11} /></button>
                            )}
                          </li>
                        ))}
                      </ul>
                      {edit && (
                        <button onClick={() => mutate(d => d.projects.weeks[wi].groups[gi].items.push(''))} className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: CORAL }}><Plus size={11} /> Add item</button>
                      )}
                    </div>
                  ))}
                  {edit && (
                    <button onClick={() => mutate(d => d.projects.weeks[wi].groups.push({ category: 'NEW GROUP', items: [''] }))} className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: '#93a3b3' }}><Plus size={11} /> Add group</button>
                  )}
                </div>
              ))}
            </div>

            {(Array.isArray(projects.tracking) && projects.tracking.length > 0) || edit ? (
              <div className="mt-6 rounded-2xl p-5 border-2 border-dashed" style={{ borderColor: GOLD, background: '#fffdf7' }}>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: GOLD }}>IN PROGRESS  ·  ITEMS WE&rsquo;RE TRACKING</p>
                <div className="mt-3 grid sm:grid-cols-2 gap-4">
                  {(projects.tracking || []).map((t: Any, i: number) => (
                    <div key={i} className="relative">
                      {edit && (
                        <button onClick={() => mutate(d => d.projects.tracking.splice(i, 1))} className="absolute top-0 right-0" style={{ color: CORAL }}><X size={13} /></button>
                      )}
                      <p className="text-sm font-bold"><Ed v={t.title || ''} set={v => patch('projects.tracking.' + i + '.title', v)} edit={edit} /></p>
                      <p className="text-[12.5px] mt-0.5" style={{ color: '#41586e' }}><Ed v={t.body || ''} set={v => patch('projects.tracking.' + i + '.body', v)} edit={edit} multiline /></p>
                    </div>
                  ))}
                </div>
                {edit && (
                  <button onClick={() => mutate(d => { d.projects.tracking = d.projects.tracking || []; d.projects.tracking.push({ title: 'New item', body: '' }) })} className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: GOLD }}><Plus size={12} /> Add tracked item</button>
                )}
              </div>
            ) : null}
          </div>
        </SectionShell>

        {/* footer */}
        <footer className="mt-16 pt-6 border-t text-center" style={{ borderColor: '#eadfc9' }}>
          <p className="text-[10px] uppercase tracking-[0.22em] font-semibold" style={{ color: '#a89f8a' }}>{footer}</p>
          <p className="text-[10px] mt-1" style={{ color: '#c2baa4' }}>Prepared by Stay Hospitality</p>
        </footer>
      </div>
    </div>
  )
}
