'use client'
// Guidebook builder v2 launcher. Interview + UPLOADS (high-quality photos used ahead of Guesty's,
// plus PDF context docs the AI reads before writing) + tone/audience/highlights direction.
// POSTs /api/guidebook and routes to the finished guidebook.
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, Loader2, X, ImagePlus, FileUp, Trash2 } from 'lucide-react'

const QUESTIONS: { key: string; label: string; hint: string; required?: boolean }[] = [
  { key: 'entry', label: 'Arrival & entry', hint: 'How does the guest get in? Front desk / fob / lockbox / smart lock — step by step.', required: true },
  { key: 'parking', label: 'Parking', hint: 'Valet, assigned spot, garage level, permits…', required: true },
  { key: 'appliances', label: 'Non-traditional appliances worth highlighting', hint: 'Induction cooktop, Wolf range, Sub-Zero, smart blinds, sauna… TIP: also upload a photo of each one above so the How-To Guide shows it. Leave blank if everything is standard.' },
  { key: 'thermostat', label: 'Thermostat / AC notes', hint: 'Only if there is something a guest would not guess. Optional.' },
  { key: 'trash', label: 'Trash & disposal', hint: 'Chute floor, pickup days, disposal quirks. Optional.' },
  { key: 'quietHours', label: 'Building rules worth stating', hint: 'Quiet hours, elevator reservations… Optional.' },
  { key: 'localPlaces', label: 'Local picks (optional)', hint: 'We auto-fill from our building guide — add or override here, comma-separated.' },
  { key: 'gettingAround', label: 'Getting around (optional)', hint: 'Rideshare pickup spot, transit, walkability, bike/scooter rentals, beach shuttle… Leave blank to skip this section.' },
  { key: 'addons', label: 'Add-on services offered', hint: 'Comma-separated; leave blank to omit the page.' },
  { key: 'checkoutKey', label: 'Checkout — key/access return', hint: 'e.g. "Return the access card to the front desk."' },
]

type Up = { url: string; kind: 'photo' | 'doc'; name: string }

export function GuidebookLauncher({ listingId, name }: { listingId: string; name: string }) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [err, setErr] = useState('')
  const [theme, setTheme] = useState('editorial')
  const [tone, setTone] = useState('warm')
  const [audience, setAudience] = useState('all guests')
  const [highlights, setHighlights] = useState('')
  const [ups, setUps] = useState<Up[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [recs, setRecs] = useState<{ name: string; type?: string; blurb?: string; area?: string }[]>([])
  const [recPick, setRecPick] = useState<Record<number, boolean>>({})
  const [recBusy, setRecBusy] = useState(false)
  const [newRec, setNewRec] = useState('')
  const [extraRecs, setExtraRecs] = useState<string[]>([])

  const missing = QUESTIONS.filter(q => q.required && !String(answers[q.key] || '').trim()).map(q => q.label)

  async function onFiles(files: FileList | null) {
    if (!files || !files.length) return
    setUploading(true); setErr('')
    try {
      for (const f of Array.from(files).slice(0, 10)) {
        const fd = new FormData(); fd.append('file', f)
        const r = await fetch('/api/guidebook/upload', { method: 'POST', body: fd })
        const d = await r.json().catch(() => ({}))
        if (!r.ok || !d?.url) throw new Error(d?.error || 'Upload failed')
        setUps(u => [...u, { url: d.url, kind: d.kind, name: d.name || f.name }])
      }
    } catch (e: any) { setErr(e?.message || String(e)) } finally { setUploading(false); if (fileRef.current) fileRef.current.value = '' }
  }

  async function suggestRecs() {
    setRecBusy(true)
    try {
      const r = await fetch('/api/guidebook/suggest-recs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ listingId }) })
      const d = await r.json().catch(() => ({}))
      const list = Array.isArray(d?.recs) ? d.recs : []
      setRecs(list)
      const pick: Record<number, boolean> = {}
      list.forEach((_: any, i: number) => { pick[i] = i < 6 })
      setRecPick(pick)
    } catch {}
    setRecBusy(false)
  }
  function addExtraRec() {
    const n = newRec.trim()
    if (!n) return
    setExtraRecs((x) => [...x, n]); setNewRec('')
  }
  const [auditCands, setAuditCands] = useState<any[]>([])
  const [auditPick, setAuditPick] = useState<Record<number, boolean>>({})
  useEffect(() => {
    if (!listingId) return
    fetch('/api/guidebook/audit-howtos?listingId=' + encodeURIComponent(listingId)).then(r => r.json()).then(j => {
      const cs = (j && j.candidates) || []
      setAuditCands(cs)
      const pick: Record<number, boolean> = {}
      cs.forEach((c: any, i: number) => { pick[i] = !c.already })
      setAuditPick(pick)
    }).catch(() => {})
  }, [listingId])

  async function generate(force = false) {
    if (missing.length) { setErr('Please answer: ' + missing.join(', ')); return }
    setBusy(true); setErr('')
    const selectedRecs = [...recs.filter((_, i) => recPick[i]).map((r) => (r.blurb ? (r.name + ' — ' + r.blurb) : r.name)), ...extraRecs]
    try {
      const p = fetch('/api/guidebook', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          listingId, answers, theme, tone, audience, highlights, selectedRecs, force, selectedAuditHowTos: auditCands.filter((_: any, i: number) => auditPick[i]).map((c: any) => ({ title: c.title, body: c.body })),
          uploadedPhotos: ups.filter(u => u.kind === 'photo').map(u => u.url),
          docUrls: ups.filter(u => u.kind === 'doc').map(u => u.url),
        }),
      }).then((r) => r.json().catch(() => ({})))
      const d: any = await Promise.race([p, new Promise((res) => setTimeout(() => res('__BG__'), 4500))])
      if (d === '__BG__') {
        p.catch(() => {})
        router.push('/guidebooks?generating=1')
        return
      }
      if (d?.exists && !force) {
        setBusy(false)
        if (window.confirm(d?.message || 'Guidebook already created. Would you like to recreate?')) { generate(true) }
        return
      }
      if (!d?.id) throw new Error(d?.error || 'Generation failed')
      router.push(`/guidebooks/${d.id}`)
    } catch (e: any) { setErr(e?.message || String(e)); setBusy(false) }
  }

  const Seg = ({ value, options, onPick }: { value: string; options: [string, string][]; onPick: (v: string) => void }) => (
    <div className="mt-1 flex flex-wrap gap-2">
      {options.map(([v, label]) => (
        <button key={v} onClick={() => onPick(v)}
          className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${value === v ? 'border-ink bg-ink text-white' : 'border-line text-muted hover:text-ink'}`}>{label}</button>
      ))}
    </div>
  )

  return (
    <>
      <button onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-ink text-white px-4 py-2 text-sm font-semibold hover:opacity-90">
        <BookOpen size={16} /> Generate Guidebook
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl my-8">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <h3 className="font-bold text-ink">Guidebook builder — {name}</h3>
                <p className="text-xs text-muted mt-0.5">Description, photos, Wi-Fi, reviews and local recs come in automatically. Your notes below are raw material — the AI rewrites everything into polished copy.</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-muted hover:text-ink"><X size={18} /></button>
            </div>

            <div className="px-5 py-4 space-y-5 max-h-[62vh] overflow-y-auto">
              {/* Uploads */}
              <div className="rounded-xl border border-dashed border-line bg-neutral-50 p-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-xs font-semibold text-ink flex items-center gap-1.5"><ImagePlus size={14} /> Photos & context docs</p>
                    <p className="text-[11px] text-muted mt-0.5">Upload unit/building photos AND a photo of each special appliance (Wolf range, thermostat, smart lock…) — the AI writes a how-to item for every appliance it sees and pins the photo next to it. PDFs (manuals, building packets) are read too.</p>
                  </div>
                  <button onClick={() => fileRef.current?.click()} disabled={uploading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-3 py-1.5 text-xs font-semibold hover:border-ink/40">
                    {uploading ? <Loader2 size={13} className="animate-spin" /> : <FileUp size={13} />} Upload
                  </button>
                  <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={e => onFiles(e.target.files)} />
                </div>
                {ups.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {ups.map((u, i) => (
                      <div key={i} className="group relative">
                        {u.kind === 'photo'
                          ? <img src={u.url} alt="" className="h-16 w-16 rounded-lg object-cover ring-1 ring-line" />
                          : <div className="flex h-16 w-24 items-center justify-center rounded-lg bg-white ring-1 ring-line px-1 text-center text-[9px] font-semibold text-muted">{u.name.slice(0, 24)}</div>}
                        <button onClick={() => setUps(x => x.filter((_, j) => j !== i))}
                          className="absolute -right-1.5 -top-1.5 hidden rounded-full bg-red-600 p-0.5 text-white group-hover:block"><Trash2 size={10} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Direction */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-ink">Tone</label>
                  <Seg value={tone} onPick={setTone} options={[['warm', 'Warm'], ['luxe', 'Luxe'], ['minimal', 'Minimal']]} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink">Theme</label>
                  <Seg value={theme} onPick={setTheme} options={[['editorial', 'Coastal editorial'], ['dark', 'Dark luxe']]} />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-ink">Audience</label>
                <Seg value={audience} onPick={setAudience} options={[['all guests', 'All guests'], ['families', 'Families'], ['couples', 'Couples'], ['business travelers', 'Business']]} />
              </div>
              <div>
                <label className="text-xs font-semibold text-ink">Anything the book must feature?</label>
                <textarea rows={2} value={highlights} onChange={e => setHighlights(e.target.value)}
                  placeholder='e.g. "the rooftop pool at sunset", "walkability to the beach", "the Wolf range"'
                  className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink/20" />
              </div>

              {/* Things to do nearby — AI suggests, you pick */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-ink">Things to do nearby</label>
                  <button type="button" onClick={suggestRecs} disabled={recBusy} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:underline disabled:opacity-50">{recBusy ? 'Finding…' : (recs.length ? 'Refresh' : 'Suggest spots')}</button>
                </div>
                {recs.length > 0 && (
                  <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {recs.map((r, i) => (
                      <label key={i} className="flex items-start gap-2 rounded-lg border border-line px-2.5 py-2 text-sm cursor-pointer hover:bg-app">
                        <input type="checkbox" checked={!!recPick[i]} onChange={(e) => setRecPick((p) => ({ ...p, [i]: e.target.checked }))} className="mt-0.5 accent-ink" />
                        <span className="leading-tight"><span className="font-medium text-ink">{r.name}</span>{r.blurb ? <span className="text-neutral-500"> — {r.blurb}</span> : null}</span>
                      </label>
                    ))}
                  </div>
                )}
                <div className="mt-1.5 flex gap-2">
                  <input value={newRec} onChange={(e) => setNewRec(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExtraRec() } }} placeholder="Add your own spot…" className="flex-1 rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink/20" />
                  <button type="button" onClick={addExtraRec} className="rounded-lg border border-line px-3 py-2 text-sm font-semibold hover:bg-app">Add</button>
                </div>
                {extraRecs.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {extraRecs.map((x, i) => (
                      <span key={i} className="inline-flex items-center gap-1 rounded-full bg-app border border-line px-2 py-0.5 text-xs">{x}<button type="button" onClick={() => setExtraRecs((a) => a.filter((_, j) => j !== i))} className="text-neutral-400 hover:text-red-500">×</button></span>
                    ))}
                  </div>
                )}
                <p className="mt-1 text-[11px] text-neutral-500">Checked spots go into the book; leave empty to let the AI choose.</p>
              </div>

              {/* Interview */}
              {QUESTIONS.map(q => (
                <div key={q.key}>
                  <label className="text-xs font-semibold text-ink">{q.label}{q.required && <span className="text-red-500"> *</span>}</label>
                  <textarea rows={2} placeholder={q.hint} value={answers[q.key] || ''}
                    onChange={e => setAnswers(a => ({ ...a, [q.key]: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ink/20" />
                </div>
              ))}
            </div>

            {auditCands.length ? (
              <div className="border-t border-line px-5 py-4">
                <div className="text-[11px] uppercase tracking-wider text-muted font-semibold mb-2">From the property audit</div>
                <div className="space-y-1.5 max-h-48 overflow-auto">
                  {auditCands.map((c: any, i: number) => (
                    <label key={i} className={"flex gap-2 items-start text-xs rounded-md border border-line p-2 " + (c.already ? "opacity-60" : "")}>
                      <input type="checkbox" checked={!!auditPick[i]} onChange={(e) => setAuditPick((p: any) => ({ ...p, [i]: e.target.checked }))} className="mt-0.5" />
                      <span className="min-w-0"><span className="font-semibold text-ink">{c.title}</span>{c.already ? <span className="ml-1 text-[10px] px-1 rounded bg-neutral-100 text-neutral-500">in guidebook</span> : <span className="ml-1 text-[10px] px-1 rounded bg-emerald-100 text-emerald-700">new</span>}<span className="block text-[11px] text-muted">{String(c.body || '').slice(0, 90)}</span></span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="flex items-center justify-between border-t border-line px-5 py-4">
              <p className="text-xs text-red-600 max-w-[55%]">{err}</p>
              <button onClick={() => generate()} disabled={busy || uploading}
                className="inline-flex items-center gap-2 rounded-lg bg-ink text-white px-4 py-2 text-sm font-semibold disabled:opacity-50">
                {busy ? <Loader2 size={15} className="animate-spin" /> : <BookOpen size={15} />} {busy ? 'Analyzing photos & writing…' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
