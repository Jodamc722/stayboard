'use client'
// Admin console — the Listing & Photo AI prompt library.
//
// Until 2026-08-21 the writing rules for the title and all six Guesty description sections were a
// hardcoded SECTION_DEFS array inside app/api/optimize-listing/route.ts. Changing how the
// Neighborhood section gets written meant shipping code. Everything editable now lives in
// app_settings 'listing_ai' and is edited here — same pattern as the review-reply voice profile.
//
// Two deliberate constraints:
//  • The HONESTY BLOCK is not editable. It is assembled inside the route on every call, so a prompt
//    experiment can never put a wrong fact on a live listing. It is shown here read-only.
//  • Enhance presets are clamped to hard caps on save (server side, in lib/listing-ai), so however
//    the numbers are edited an enhanced photo can never be pushed past "corrected" into "not the
//    same room".
import { useEffect, useMemo, useState } from 'react'
import {
  Sparkles, Save, Loader2, Check, AlertTriangle, RotateCcw, PlayCircle, Lock,
  ChevronDown, ChevronRight, Image as ImageIcon, Wand2, FileText,
} from 'lucide-react'
import {
  DEFAULT_LISTING_AI, SECTION_KEYS, ENHANCE_CAPS, sectionEdited,
  type ListingAi, type SectionKey,
} from '@/lib/listing-ai'

type Tab = 'copy' | 'photos' | 'enhance' | 'honesty'

const HONESTY_TEXT = `Use ONLY facts present in the listing data, location, current content, review signal, booking settings and photo index. If you are not certain of a distance, a business name, a drive time, an amenity, a view or a room count — omit it or stay general. Never guess, never embellish, never invent.

Never print the exact street address, unit number, lock or door codes, phone, email, or URLs anywhere in the copy.

Never claim a garage — no unit has one. If parking exists per the data, describe it generically.

Tell real photos of the home apart from generic area/stock imagery. Only ground home-feature claims in real photos of this unit or building.`

export function ListingAiAdmin({ isOwner }: { isOwner: boolean }) {
  const [cfg, setCfg] = useState<ListingAi | null>(null)
  const [tab, setTab] = useState<Tab>('copy')
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [openSection, setOpenSection] = useState<SectionKey | null>('title')

  // playground
  const [listings, setListings] = useState<{ id: string; label: string }[]>([])
  const [testId, setTestId] = useState('')
  const [testSection, setTestSection] = useState<SectionKey>('space')
  const [testing, setTesting] = useState(false)
  const [testOut, setTestOut] = useState<{ text: string; rationale: string; warnings: string[]; photosUsed?: number; photosLabelled?: boolean } | null>(null)

  useEffect(() => {
    fetch('/api/settings/listing-ai').then(r => r.json()).then(j => {
      if (j?.note) setNote(j.note)
      setCfg(j?.config && typeof j.config === 'object' ? j.config : DEFAULT_LISTING_AI)
      setLoaded(true)
    }).catch(() => { setCfg(DEFAULT_LISTING_AI); setLoaded(true) })
    fetch('/api/listings?slim=1').then(r => r.json()).then(j => {
      const rows = Array.isArray(j?.results) ? j.results : []
      setListings(rows
        .filter((l: any) => !['inactive', 'disabled', 'archived', 'deleted'].includes(String(l.status || '').toLowerCase()))
        .map((l: any) => ({ id: String(l.id), label: String(l.title || l.nickname || l.unit || l.id) }))
        .slice(0, 400))
    }).catch(() => {})
  }, [])

  const edited = useMemo(() => {
    if (!cfg) return new Set<string>()
    const s = new Set<string>()
    for (const k of SECTION_KEYS) if (sectionEdited(cfg, k)) s.add(k)
    if (cfg.voice !== DEFAULT_LISTING_AI.voice) s.add('voice')
    if (cfg.photos.orderPrompt !== DEFAULT_LISTING_AI.photos.orderPrompt) s.add('orderPrompt')
    if (cfg.photos.captionPrompt !== DEFAULT_LISTING_AI.photos.captionPrompt) s.add('captionPrompt')
    return s
  }, [cfg])

  function mutate(fn: (c: ListingAi) => void) {
    setCfg(prev => {
      if (!prev) return prev
      const next: ListingAi = JSON.parse(JSON.stringify(prev))
      fn(next)
      return next
    })
    setDirty(true); setMsg(null); setError(null)
  }

  async function save() {
    if (!cfg) return
    setSaving(true); setError(null); setMsg(null)
    try {
      const r = await fetch('/api/settings/listing-ai', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: cfg }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || 'Failed to save.')
      setCfg(j.config); setDirty(false); setNote(null)
      setMsg('Saved. Every optimize and photo run from now on uses these prompts.')
    } catch (e: any) { setError(e.message || String(e)) } finally { setSaving(false) }
  }

  async function resetSection(k: SectionKey) {
    mutate(c => { c.sections[k] = JSON.parse(JSON.stringify(DEFAULT_LISTING_AI.sections[k])) })
  }

  async function runTest() {
    if (!cfg) return
    if (!testId) { setError('Pick a unit to test against.'); return }
    setTesting(true); setError(null); setTestOut(null)
    try {
      const r = await fetch('/api/optimize-listing', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // promptPreview = the CURRENT editor state, saved or not. The route prefers it over the
        // stored key, so you can try wording before you commit it.
        body: JSON.stringify({ listingId: testId, section: testSection, promptPreview: cfg }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
      setTestOut({ text: j.text || '', rationale: j.rationale || '', warnings: Array.isArray(j.warnings) ? j.warnings : [], photosUsed: j.photosUsed, photosLabelled: j.photosLabelled })
    } catch (e: any) { setError(e.message || String(e)) } finally { setTesting(false) }
  }

  if (!loaded || !cfg) {
    return <div className="text-sm text-muted inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading prompts…</div>
  }

  const ro = !isOwner

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
        <p className="text-[12px] text-muted max-w-[62ch]">
          The prompts behind <b className="text-ink">Optimize</b> and the <b className="text-ink">photo AI</b>. Every field ships with the
          Stay default already in it, so changing nothing changes nothing. Edited fields are badged.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          {dirty && <span className="text-[11.5px] text-amber-700 font-semibold">Unsaved changes</span>}
          <button onClick={save} disabled={ro || saving || !dirty}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-40">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
          </button>
        </div>
      </div>

      {note && <Banner tone="warn">{note}</Banner>}
      {ro && <Banner tone="warn">These prompts write copy onto live OTA listings, so only an owner can change them. You can read everything here.</Banner>}
      {error && <Banner tone="bad">{error}</Banner>}
      {msg && <Banner tone="good">{msg}</Banner>}

      <div className="inline-flex rounded-xl border border-line bg-white p-1 mb-4">
        {([['copy', 'Copy', FileText], ['photos', 'Photos', ImageIcon], ['enhance', 'Enhance presets', Wand2], ['honesty', 'Honesty rules', Lock]] as const).map(([k, label, Icon]) => (
          <button key={k} onClick={() => setTab(k as Tab)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${tab === k ? 'bg-brand-600 text-white' : 'text-muted hover:text-ink'}`}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {/* ── COPY ─────────────────────────────────────────────────────────── */}
      {tab === 'copy' && (
        <div className="space-y-2.5">
          <Row title="House voice" sub="Shared by every section" badge={edited.has('voice')}>
            <Area value={cfg.voice} rows={10} disabled={ro} onChange={v => mutate(c => { c.voice = v })} />
            <div className="flex flex-wrap gap-2 mt-2.5">
              <Knob label="Style exemplar — building">
                <input value={cfg.exemplarMatch} disabled={ro}
                  onChange={e => mutate(c => { c.exemplarMatch = e.target.value })}
                  className="w-32 bg-transparent text-ink font-mono text-[11.5px] focus:outline-none" />
              </Knob>
              <Knob label="…or pin one unit">
                <select value={cfg.exemplarListingId || ''} disabled={ro}
                  onChange={e => mutate(c => { c.exemplarListingId = e.target.value || null })}
                  className="bg-transparent text-ink text-[11.5px] max-w-[200px] focus:outline-none">
                  <option value="">match by building</option>
                  {listings.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              </Knob>
              <button onClick={() => mutate(c => { c.voice = DEFAULT_LISTING_AI.voice })} disabled={ro}
                className="text-[11.5px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1 disabled:opacity-40">
                <RotateCcw size={11} /> Reset to Stay default
              </button>
            </div>
          </Row>

          {SECTION_KEYS.map(k => {
            const sc = cfg.sections[k]
            const isOpen = openSection === k
            return (
              <div key={k} className="rounded-xl border border-line bg-white overflow-hidden">
                <button onClick={() => setOpenSection(isOpen ? null : k)} aria-expanded={isOpen}
                  className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-app/50">
                  {isOpen ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
                  <span className="text-[13px] font-bold text-ink">{sc.label}</span>
                  <span className="text-[11.5px] text-muted">
                    {sc.targetMin}–{sc.targetMax} chars{sc.hardCap ? ` · hard cap ${sc.hardCap}` : ''}
                  </span>
                  {!sc.enabled && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-app text-muted">skipped</span>}
                  {edited.has(k) && <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">edited</span>}
                </button>
                {isOpen && (
                  <div className="px-3.5 pb-3.5 border-t border-line pt-3">
                    <Area value={sc.guide} rows={7} disabled={ro} onChange={v => mutate(c => { c.sections[k].guide = v })} />
                    <div className="flex flex-wrap gap-2 mt-2.5">
                      <Knob label="Target min"><Num value={sc.targetMin} disabled={ro} onChange={n => mutate(c => { c.sections[k].targetMin = n })} /></Knob>
                      <Knob label="Target max"><Num value={sc.targetMax} disabled={ro} onChange={n => mutate(c => { c.sections[k].targetMax = n })} /></Knob>
                      <Knob label="Hard cap"><Num value={sc.hardCap ?? 0} disabled={ro || k === 'title'} onChange={n => mutate(c => { c.sections[k].hardCap = n || null })} /></Knob>
                      <label className="text-[11.5px] text-muted border border-line rounded-lg px-2.5 py-1 bg-app/40 inline-flex items-center gap-1.5">
                        <input type="checkbox" checked={sc.enabled} disabled={ro || k === 'title'}
                          onChange={e => mutate(c => { c.sections[k].enabled = e.target.checked })} />
                        Include in a full run
                      </label>
                      {edited.has(k) && (
                        <button onClick={() => resetSection(k)} disabled={ro}
                          className="text-[11.5px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1 disabled:opacity-40">
                          <RotateCcw size={11} /> Reset
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2.5">
                      <Small label="Always work in (when true)" value={sc.mustInclude} disabled={ro} onChange={v => mutate(c => { c.sections[k].mustInclude = v })} />
                      <Small label="Never mention" value={sc.neverSay} disabled={ro} onChange={v => mutate(c => { c.sections[k].neverSay = v })} />
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* playground */}
          <div className="rounded-xl border border-brand-200 bg-brand-50 p-3.5">
            <div className="text-[13px] font-bold text-brand-700 mb-1.5 inline-flex items-center gap-1.5"><PlayCircle size={14} /> Test on a unit</div>
            <p className="text-[11.5px] text-brand-700/80 mb-2.5">Runs the text in this editor — including unsaved changes — against a real listing. Nothing is written to Guesty.</p>
            <div className="flex flex-wrap gap-2 items-center">
              <select value={testId} onChange={e => setTestId(e.target.value)}
                className="rounded-lg border border-brand-200 bg-white px-2.5 py-1.5 text-[12.5px] text-ink max-w-[260px]">
                <option value="">Pick a unit…</option>
                {listings.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
              </select>
              <select value={testSection} onChange={e => setTestSection(e.target.value as SectionKey)}
                className="rounded-lg border border-brand-200 bg-white px-2.5 py-1.5 text-[12.5px] text-ink">
                {SECTION_KEYS.map(k => <option key={k} value={k}>{cfg.sections[k].label}</option>)}
              </select>
              <button onClick={runTest} disabled={testing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[12.5px] font-semibold disabled:opacity-50">
                {testing ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Run
              </button>
            </div>
            {testOut && (
              <div className="mt-3 rounded-lg border border-brand-200 bg-white p-3">
                <div className="text-sm text-ink whitespace-pre-wrap leading-relaxed">{testOut.text}</div>
                <div className="text-[11px] text-muted mt-2">
                  {testOut.text.length} characters
                  {testOut.photosUsed != null && <> · {testOut.photosUsed} photos {testOut.photosLabelled ? 'labelled from the photo index' : 'unlabelled (photo AI has never run on this unit)'}</>}
                  {testOut.rationale && <> · {testOut.rationale}</>}
                </div>
                {testOut.warnings.map((w, i) => (
                  <div key={i} className="text-[11.5px] text-amber-700 mt-1.5 inline-flex items-start gap-1"><AlertTriangle size={12} className="mt-0.5 shrink-0" /> {w}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PHOTOS ───────────────────────────────────────────────────────── */}
      {tab === 'photos' && (
        <div className="space-y-2.5">
          <Row title="Ordering &amp; tagging" sub="How the analyst decides the display order and classifies each photo" badge={edited.has('orderPrompt')}>
            <Area value={cfg.photos.orderPrompt} rows={12} disabled={ro} onChange={v => mutate(c => { c.photos.orderPrompt = v })} />
            <div className="flex flex-wrap gap-2 mt-2.5">
              <Knob label="Photos per run"><Num value={cfg.photos.maxPhotos} disabled={ro} onChange={n => mutate(c => { c.photos.maxPhotos = n })} /></Knob>
              <button onClick={() => mutate(c => { c.photos.orderPrompt = DEFAULT_LISTING_AI.photos.orderPrompt })} disabled={ro}
                className="text-[11.5px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1 disabled:opacity-40"><RotateCcw size={11} /> Reset</button>
            </div>
            <p className="text-[11.5px] text-muted mt-2">
              Room grouping is enforced in code after the model answers, so this prompt steers the judgement, not the mechanics.
              The photo the host picked as the cover is never reordered.
            </p>
          </Row>

          <Row title="Photo descriptions" sub="One caption per photo — this is what pushes to Guesty and what the copywriter reads" badge={edited.has('captionPrompt')}>
            <Area value={cfg.photos.captionPrompt} rows={6} disabled={ro} onChange={v => mutate(c => { c.photos.captionPrompt = v })} />
            <div className="flex flex-wrap gap-2 mt-2.5">
              <Knob label="Max words"><Num value={cfg.photos.captionMaxWords} disabled={ro} onChange={n => mutate(c => { c.photos.captionMaxWords = n })} /></Knob>
              <Knob label="Max characters"><Num value={cfg.photos.captionMaxChars} disabled={ro} onChange={n => mutate(c => { c.photos.captionMaxChars = n })} /></Knob>
              <Knob label="Photos shown to the copywriter"><Num value={cfg.photos.photosToCopywriter} disabled={ro} onChange={n => mutate(c => { c.photos.photosToCopywriter = n })} /></Knob>
              <button onClick={() => mutate(c => { c.photos.captionPrompt = DEFAULT_LISTING_AI.photos.captionPrompt })} disabled={ro}
                className="text-[11.5px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1 disabled:opacity-40"><RotateCcw size={11} /> Reset</button>
            </div>
            <p className="text-[11.5px] text-muted mt-2">
              A caption a person wrote is never overwritten — the AI only fills blanks and junk (a UUID or a filename Guesty stored as a caption).
            </p>
          </Row>
        </div>
      )}

      {/* ── ENHANCE ──────────────────────────────────────────────────────── */}
      {tab === 'enhance' && (
        <div className="space-y-2.5">
          <div className="rounded-xl border border-line bg-white p-3.5">
            <div className="text-[13px] font-bold text-ink mb-1">What Enhance does</div>
            <p className="text-[12px] text-muted max-w-[70ch]">
              A photographic <b className="text-ink">correction</b> — exposure, contrast, colour balance and sharpness — never a repaint.
              No generative fill, no sky replacement, no straightening a room that is not straight. The untouched original is
              copied to Stay storage before anything is processed, so every edit can be reverted.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <label className="text-[11.5px] text-muted border border-line rounded-lg px-2.5 py-1 bg-app/40 inline-flex items-center gap-1.5">
                <input type="checkbox" checked={cfg.enhance.autoPick} disabled={ro}
                  onChange={e => mutate(c => { c.enhance.autoPick = e.target.checked })} />
                Let the AI pick a preset per photo
              </label>
              <Knob label="Fallback preset">
                <select value={cfg.enhance.fallbackPreset} disabled={ro}
                  onChange={e => mutate(c => { c.enhance.fallbackPreset = e.target.value })}
                  className="bg-transparent text-ink text-[11.5px] focus:outline-none">
                  {cfg.enhance.presets.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
                </select>
              </Knob>
            </div>
            <p className="text-[11.5px] text-muted mt-2">
              Hard caps, enforced on save whatever is typed below: brightness {ENHANCE_CAPS.brightness} · saturation {ENHANCE_CAPS.saturation} · contrast {ENHANCE_CAPS.contrast} · sharpen {ENHANCE_CAPS.sharpen}.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {cfg.enhance.presets.map((p, i) => (
              <div key={p.key} className="rounded-xl border border-line bg-white p-3.5">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[13px] font-bold text-ink">{p.name}</span>
                  <span className="text-[10px] font-mono text-muted">{p.key}</span>
                </div>
                <input value={p.when} disabled={ro}
                  onChange={e => mutate(c => { c.enhance.presets[i].when = e.target.value })}
                  placeholder="When the AI should choose this…"
                  className="w-full text-[11.5px] text-muted bg-app/40 border border-line rounded-lg px-2 py-1 mb-2.5 focus:outline-none focus:ring-2 focus:ring-brand-200" />
                <div className="flex flex-wrap gap-1.5">
                  <Knob label="Brightness"><Num step={0.01} value={p.brightness} disabled={ro} onChange={n => mutate(c => { c.enhance.presets[i].brightness = n })} /></Knob>
                  <Knob label="Saturation"><Num step={0.01} value={p.saturation} disabled={ro} onChange={n => mutate(c => { c.enhance.presets[i].saturation = n })} /></Knob>
                  <Knob label="Contrast"><Num step={0.01} value={p.contrast} disabled={ro} onChange={n => mutate(c => { c.enhance.presets[i].contrast = n })} /></Knob>
                  <Knob label="Sharpen"><Num step={0.1} value={p.sharpen} disabled={ro} onChange={n => mutate(c => { c.enhance.presets[i].sharpen = n })} /></Knob>
                  <Knob label="Warmth"><Num step={1} value={p.warmth} disabled={ro} onChange={n => mutate(c => { c.enhance.presets[i].warmth = n })} /></Knob>
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => mutate(c => { c.enhance = JSON.parse(JSON.stringify(DEFAULT_LISTING_AI.enhance)) })} disabled={ro}
            className="text-[11.5px] font-semibold text-muted hover:text-ink inline-flex items-center gap-1 disabled:opacity-40"><RotateCcw size={11} /> Reset all presets to Stay defaults</button>
        </div>
      )}

      {/* ── HONESTY ──────────────────────────────────────────────────────── */}
      {tab === 'honesty' && (
        <div className="rounded-xl border border-line bg-white p-3.5">
          <div className="text-[13px] font-bold text-ink mb-1 inline-flex items-center gap-1.5"><Lock size={13} /> Not editable, by design</div>
          <p className="text-[12px] text-muted mb-3 max-w-[70ch]">
            These rules are assembled inside the route on every call and sit under every prompt above. They are what stops a
            prompt experiment putting a wrong fact on a live listing, so they are not something the settings page can switch off.
          </p>
          <div className="rounded-lg border border-line bg-app/40 px-3 py-2.5 text-[12px] text-ink whitespace-pre-wrap font-mono leading-relaxed">{HONESTY_TEXT}</div>
        </div>
      )}
    </div>
  )
}

/* ---------------- small pieces ---------------- */
function Banner({ tone, children }: { tone: 'good' | 'warn' | 'bad'; children: React.ReactNode }) {
  const c = tone === 'good' ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
    : tone === 'bad' ? 'border-rose-200 bg-rose-50 text-rose-800'
      : 'border-amber-200 bg-amber-50 text-amber-800'
  const Icon = tone === 'good' ? Check : AlertTriangle
  return <div className={`mb-3 rounded-xl border px-3.5 py-2.5 text-[12.5px] inline-flex items-start gap-2 ${c}`}><Icon size={14} className="mt-0.5 shrink-0" />{children}</div>
}

function Row({ title, sub, badge, children }: { title: string; sub?: string; badge?: boolean; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-white overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2.5 bg-app/40 border-b border-line">
        <span className="text-[13px] font-bold text-ink">{title}</span>
        {sub && <span className="text-[11.5px] text-muted">— {sub}</span>}
        {badge && <span className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">edited</span>}
      </div>
      <div className="p-3.5">{children}</div>
    </div>
  )
}

function Area({ value, rows, disabled, onChange }: { value: string; rows: number; disabled?: boolean; onChange: (v: string) => void }) {
  return (
    <textarea
      value={value} rows={rows} disabled={disabled}
      onChange={e => onChange(e.target.value)}
      className="w-full rounded-lg border border-line bg-app/40 px-3 py-2.5 text-[12px] font-mono leading-relaxed text-ink focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-70"
    />
  )
}

function Small({ label, value, disabled, onChange }: { label: string; value: string; disabled?: boolean; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-wider text-muted font-semibold mb-1">{label}</span>
      <input value={value} disabled={disabled} onChange={e => onChange(e.target.value)}
        placeholder="none"
        className="w-full rounded-lg border border-line bg-app/40 px-2.5 py-1.5 text-[12px] text-ink focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:opacity-70" />
    </label>
  )
}

function Knob({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted border border-line rounded-lg px-2.5 py-1 bg-app/40">
      {label} {children}
    </span>
  )
}

function Num({ value, onChange, disabled, step }: { value: number; onChange: (n: number) => void; disabled?: boolean; step?: number }) {
  return (
    <input type="number" value={value} step={step ?? 1} disabled={disabled}
      onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n)) onChange(n) }}
      className="w-16 bg-transparent text-ink font-mono text-[11.5px] tabular-nums focus:outline-none disabled:opacity-70" />
  )
}
