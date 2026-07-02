'use client'
// Guidebook builder v2 launcher. Interview + UPLOADS (high-quality photos used ahead of Guesty's,
// plus PDF context docs the AI reads before writing) + tone/audience/highlights direction.
// POSTs /api/guidebook and routes to the finished guidebook.
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, Loader2, X, ImagePlus, FileUp, Trash2 } from 'lucide-react'

const QUESTIONS: { key: string; label: string; hint: string; required?: boolean }[] = [
  { key: 'entry', label: 'Arrival & entry', hint: 'How does the guest get in? Front desk / fob / lockbox / smart lock — step by step.', required: true },
  { key: 'parking', label: 'Parking', hint: 'Valet, assigned spot, garage level, permits…', required: true },
  { key: 'appliances', label: 'Non-traditional appliances worth highlighting', hint: 'Induction cooktop, Wolf range, Sub-Zero, smart blinds, sauna… Leave blank if everything is standard (the book stays lean).' },
  { key: 'thermostat', label: 'Thermostat / AC notes', hint: 'Only if there is something a guest would not guess. Optional.' },
  { key: 'trash', label: 'Trash & disposal', hint: 'Chute floor, pickup days, disposal quirks. Optional.' },
  { key: 'quietHours', label: 'Building rules worth stating', hint: 'Quiet hours, elevator reservations… Optional.' },
  { key: 'localPlaces', label: 'Local picks (optional)', hint: 'We auto-fill from our building guide — add or override here, comma-separated.' },
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

  async function generate() {
    if (missing.length) { setErr('Please answer: ' + missing.join(', ')); return }
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/guidebook', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          listingId, answers, theme, tone, audience, highlights,
          uploadedPhotos: ups.filter(u => u.kind === 'photo').map(u => u.url),
          docUrls: ups.filter(u => u.kind === 'doc').map(u => u.url),
        }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || !d?.id) throw new Error(d?.error || 'Generation failed')
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
                    <p className="text-[11px] text-muted mt-0.5">Upload high-quality photos (used ahead of Guesty's) and PDFs — building packets, appliance sheets, old guidebooks. The AI reads them for context.</p>
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

            <div className="flex items-center justify-between border-t border-line px-5 py-4">
              <p className="text-xs text-red-600 max-w-[55%]">{err}</p>
              <button onClick={generate} disabled={busy || uploading}
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
