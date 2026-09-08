'use client'
import { Fragment, useEffect, useRef, useState } from 'react'
import { buildOrder as engineOrder, type PhotoFacts } from '@/lib/photo-order'
import { Images, Wand2, Sparkles, AlertTriangle, Check, RotateCcw, UploadCloud, Star, ArrowUp, ArrowDown, Crown, Gauge, Trash2, MapPinned, Sun, ImagePlus, Archive, RefreshCw, Loader2 } from 'lucide-react'

type Photo = {
  _id: string; url: string; caption?: string; category?: string; reason?: string; kind?: string
  /** The server invented this caption from the category — a label for the copywriter, not copy. */
  captionIsPlaceholder?: boolean
  // 2026-08-21: the analyst now names the SPECIFIC room ("bedroom-1"), which is what keeps every
  // photo of one room together, and picks a named enhance preset with a reason.
  room?: string; enhance?: string; enhanceWhy?: string
  mirrorUrl?: string | null   // the untouched original we mirrored — makes "revert" possible
  // 2026-09-08 (v2): facts from the analyst + where the engine put the photo and why.
  subject?: string; shotType?: 'wide' | 'medium' | 'detail'; quality?: number; faults?: string[]; sellingPoints?: string[]; duplicateOf?: string | null; heroWorthy?: boolean
  placement?: { slot: 'cover' | 'showcase' | 'tour' | 'building' | 'demoted'; group: string; why: string; flag?: 'duplicate' | 'fault' | 'stock' | null }
}
type Section = { slot: 'cover' | 'showcase' | 'tour' | 'building' | 'demoted'; label: string; ids: string[] }
type HeroCandidate = { _id: string; score: number; why: string }
type Preset = { key: string; name: string; when: string }
type Result = {
  heroId: string
  proposedOrder: string[]
  photos: Photo[]
  heroSuggestion?: { _id: string; why: string } | null
  assessment?: { quality: number | null; coverage: string; notes: string[] } | null
  recommendRemove?: { _id: string; reason: string }[]
  overflow?: number
  presets?: Preset[]
  orderRule?: string
  sections?: Section[]
  heroCandidates?: HeroCandidate[]
  titleIdeas?: string[]
  titleHooks?: { hook: string; strength: number }[]
  partial?: string | null
  profile?: { bedrooms: number | null; bathrooms?: number | null; isStudio: boolean }
  rooms?: string[]
  roomVocab?: string[]
}

const CAT_COLORS: Record<string, string> = {
  living: 'bg-sky-100 text-sky-700', kitchen: 'bg-amber-100 text-amber-700', dining: 'bg-orange-100 text-orange-700',
  bedroom: 'bg-violet-100 text-violet-700', bathroom: 'bg-cyan-100 text-cyan-700', outdoor: 'bg-emerald-100 text-emerald-700',
  view: 'bg-blue-100 text-blue-700', amenity: 'bg-teal-100 text-teal-700', exterior: 'bg-slate-100 text-slate-700',
  detail: 'bg-zinc-100 text-zinc-600', other: 'bg-zinc-100 text-zinc-600',
}

const CATS = ['living', 'kitchen', 'dining', 'bedroom', 'bathroom', 'outdoor', 'view', 'amenity', 'exterior', 'detail', 'other']

export function PhotoOrganizer({ listingId, name }: { listingId: string; name: string }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pushedMsg, setPushedMsg] = useState<string | null>(null)
  const [photos, setPhotos] = useState<Record<string, Photo>>({})
  const [heroId, setHeroId] = useState<string | null>(null)
  const [order, setOrder] = useState<string[]>([])           // working order incl. hero at index 0
  const [proposed, setProposed] = useState<string[]>([])      // AI's proposed order (for reset)
  const [heroSug, setHeroSug] = useState<Result['heroSuggestion']>(null)
  const [overflow, setOverflow] = useState(0)
  const [assessment, setAssessment] = useState<Result['assessment']>(null)
  const [removeList, setRemoveList] = useState<{ _id: string; reason: string }[]>([])
  const [toRemove, setToRemove] = useState<Set<string>>(new Set())
  const [dragId, setDragId] = useState<string | null>(null)
  const [guidance, setGuidance] = useState('')
  // ENHANCE state: enhanced[id] = hosted enhanced URL; useEnhanced = ids whose enhanced version
  // will replace the live photo on push. Originals are always mirrored to our storage first.
  const [enhanced, setEnhanced] = useState<Record<string, string>>({})
  const [useEnhanced, setUseEnhanced] = useState<Set<string>>(new Set())
  const [enhancing, setEnhancing] = useState(false)
  // Named enhance presets + which one applies to each photo. The AI proposes one per photo; this is
  // the human's override. Nothing here can exceed the hard caps enforced server-side.
  const [presets, setPresets] = useState<Preset[]>([])
  const [presetPick, setPresetPick] = useState<Record<string, string>>({})
  const [orderRule, setOrderRule] = useState<string>('')
  const [sections, setSections] = useState<Section[]>([])
  const [heroCands, setHeroCands] = useState<HeroCandidate[]>([])
  const [titleIdeas, setTitleIdeas] = useState<string[]>([])
  const [titleHooks, setTitleHooks] = useState<{ hook: string; strength: number }[]>([])
  const [copiedTitle, setCopiedTitle] = useState<string | null>(null)
  const [profile, setProfile] = useState<Result['profile']>(undefined)
  const [roomVocab, setRoomVocab] = useState<string[]>([])
  // Press-and-hold compare: shows the OTHER version of the photo while held.
  const [peek, setPeek] = useState<string | null>(null)
  // Photos to put back to their mirrored original on push.
  const [revert, setRevert] = useState<Set<string>>(new Set())
  // UPLOADS: brand-new photos added by the host. uploads[id].orig = mirrored original URL.
  // They live in `photos`/`order` like any other photo and are pushed via photo-order's adds map.
  const [uploads, setUploads] = useState<Record<string, { orig: string }>>({})
  const [uploadingCount, setUploadingCount] = useState(0)
  const [mirroring, setMirroring] = useState(false)
  const [capBusy, setCapBusy] = useState<Set<string>>(new Set())
  const [metaBusy, setMetaBusy] = useState<Set<string>>(new Set())
  const [metaSaved, setMetaSaved] = useState<Set<string>>(new Set())
  const capTimer = useRef<Record<string, any>>({})
  const fileRef = useRef<HTMLInputElement | null>(null)
  // REPLACEMENTS: overwrite an existing photo's image with a new upload (keeps position + caption).
  // replaced[id] = { orig: new uploaded original URL, prevUrl: the old image (for undo) }.
  const [replaced, setReplaced] = useState<Record<string, { orig: string; prevUrl: string }>>({})
  const replaceRef = useRef<HTMLInputElement | null>(null)
  const replaceTargetRef = useRef<string | null>(null)
  const uploadsRef = useRef<Record<string, { orig: string }>>({})
  uploadsRef.current = uploads
  const photosRef = useRef<Record<string, Photo>>({})
  photosRef.current = photos

  async function analyze(hero?: string, guidanceText?: string, regenerateCaptions = false, autoHero = false): Promise<string[] | null> {
    setBusy(true); setError(null); setPushedMsg(null)
    try {
      const r = await fetch('/api/optimize-photos', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          listingId,
          ...(hero ? { heroId: hero } : {}),
          ...(guidanceText && guidanceText.trim() ? { guidance: guidanceText.trim() } : {}),
          ...(regenerateCaptions ? { regenerateCaptions: true } : {}),
          ...(autoHero ? { autoHero: true } : {}),
        }),
      })
      const raw = await r.text()
      let j: any = null; try { j = raw ? JSON.parse(raw) : null } catch { j = null }
      if (!r.ok || !j) throw new Error((j && j.error) || (r.status === 504 ? 'The photo organizer timed out - this listing may have a lot of photos. Try again, or hide a few first.' : 'Failed to analyze photos. Please try again.'))
      const map: Record<string, Photo> = {}
      ;(j.photos || []).forEach((p: Photo) => { map[p._id] = p })
      // Keep any not-yet-pushed uploads: they aren't in Guesty so the AI doesn't know them.
      const upIds = Object.keys(uploadsRef.current)
      upIds.forEach(id => { if (photosRef.current[id]) map[id] = photosRef.current[id] })
      const fullOrder = [...j.proposedOrder, ...upIds.filter((id: string) => !j.proposedOrder.includes(id))]
      setPhotos(map); setHeroId(j.heroId); setOrder(fullOrder); setProposed(fullOrder)
      setHeroSug(j.heroSuggestion || null); setOverflow(j.overflow || 0); setAssessment(j.assessment || null); setRemoveList(j.recommendRemove || [])
      if (Array.isArray(j.presets)) setPresets(j.presets)
      if (typeof j.orderRule === 'string') setOrderRule(j.orderRule)
      setSections(Array.isArray(j.sections) ? j.sections : [])
      setHeroCands(Array.isArray(j.heroCandidates) ? j.heroCandidates : [])
      setTitleIdeas(Array.isArray(j.titleIdeas) ? j.titleIdeas : [])
      setTitleHooks(Array.isArray(j.titleHooks) ? j.titleHooks : [])
      setProfile(j.profile); setRoomVocab(Array.isArray(j.roomVocab) ? j.roomVocab : [])
      // Duplicates, faults and stock come pre-flagged; ticking them is one click, not ten.
      setToRemove(new Set())
      if (j.partial) setError(String(j.partial))
      // Seed each photo's preset from the AI's verdict; the dropdown on the card overrides it.
      const picks: Record<string, string> = {}
      ;(j.photos || []).forEach((ph: Photo) => { if (ph.enhance) picks[ph._id] = ph.enhance })
      setPresetPick(prev => ({ ...picks, ...prev }))
      return j.proposedOrder as string[]
    } catch (e: any) { setError(e.message || String(e)); return null } finally { setBusy(false) }
  }

  // Enhance (and mirror) the photos: gentle brightness/saturation/contrast + sharpen, hosted on our
  // storage. Defaults every successfully enhanced photo to "use enhanced" — each card can opt out.
  // `overrides` exists because a preset change calls this immediately: React state has not
  // committed yet, so the new pick has to be passed in rather than read from the closure.
  async function enhance(ids?: string[], overrides?: Record<string, string>) {
    setOpen(true); setEnhancing(true); setError(null); setPushedMsg(null)
    try {
      const r = await fetch('/api/photo-enhance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, ...(ids && ids.length ? { photoIds: ids } : {}), ...((() => { const m = { ...presetPick, ...(overrides || {}) }; return Object.keys(m).length ? { presets: m } : {} })()) }),
      })
      const raw = await r.text()
      let j: any = null; try { j = raw ? JSON.parse(raw) : null } catch { j = null }
      if (!r.ok || !j) throw new Error((j && j.error) || (r.status === 504 ? 'Enhancing timed out - try again (results so far are saved).' : 'Failed to enhance photos. Please try again.'))
      const map: Record<string, string> = {}
      const usedPreset: Record<string, string> = {}
      ;(j.photos || []).forEach((p: { _id: string; enhancedUrl?: string; mirroredUrl?: string; preset?: string }) => {
        if (p._id && p.enhancedUrl) map[p._id] = p.enhancedUrl
        if (p._id && p.preset) usedPreset[p._id] = p.preset
      })
      if (Array.isArray(j.presets)) setPresets(j.presets)
      setPresetPick(prev => ({ ...prev, ...usedPreset }))
      setEnhanced(prev => ({ ...prev, ...map }))
      // 2026-08-21: enhanced versions are SHOWN, not pre-approved. They used to be ticked to push
      // automatically, so "enhance" quietly decided what went live. Compare, then tick.
      const made = Object.keys(map).length
      const skipped = Number(j.skippedNone) || 0
      setPushedMsg(made
        ? `${made} photo${made === 1 ? '' : 's'} enhanced${skipped ? `, ${skipped} left alone (already good)` : ''} — press and hold the compare button on a card to see before/after, then tick the ones to use.`
        : `Nothing needed enhancing${skipped ? ` — the AI judged ${skipped} photo${skipped === 1 ? '' : 's'} already good.` : '.'}`)
      if (j.failedCount > 0) setError(`${j.failedCount} photo(s) could not be enhanced — the rest are ready below.`)
    } catch (e: any) { setError(e.message || String(e)) } finally { setEnhancing(false) }
  }

  function toggleEnhanced(id: string) {
    setUseEnhanced(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function useAllEnhanced() {
    setUseEnhanced(new Set(Object.keys(enhanced)))
  }
  function toggleRevert(id: string) {
    setRevert(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
    // Reverting and using the enhanced version are contradictory — reverting wins, so untick.
    setUseEnhanced(prev => { const n = new Set(prev); n.delete(id); return n })
  }
  // Change one photo's preset and re-run just that photo, so before/after is immediate.
  function pickPreset(id: string, key: string) {
    setPresetPick(prev => ({ ...prev, [id]: key }))
    if (key === 'none') {
      setEnhanced(prev => { const n = { ...prev }; delete n[id]; return n })
      setUseEnhanced(prev => { const n = new Set(prev); n.delete(id); return n })
      return
    }
    enhance([id], { [id]: key })
  }

  // MIRROR ONLY: back up every original to Stay storage — no filter, no changes, nothing pushed.
  async function mirror(only?: string[]) {
    setMirroring(true); setError(null); setPushedMsg(null)
    try {
      const ids = (only && Array.isArray(only) && only.length ? only : order.filter(id => !uploads[id]))
      const r = await fetch('/api/photo-enhance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, mirrorOnly: true, ...(ids.length ? { photoIds: ids } : {}) }),
      })
      const raw = await r.text()
      let j: any = null; try { j = raw ? JSON.parse(raw) : null } catch { j = null }
      if (!r.ok || !j) throw new Error((j && j.error) || 'Failed to mirror photos. Please try again.')
      setPushedMsg(`\u2713 Mirrored ${j.count} photo(s) to Stay storage \u2014 untouched originals safely backed up.${j.failedCount ? ` ${j.failedCount} failed.` : ''}`)
    } catch (e: any) { setError(e.message || String(e)) } finally { setMirroring(false) }
  }

  // Downscale in the browser (\u22642048px JPEG) so each upload stays small; falls back to the raw file.
  async function resizeToJpeg(file: File): Promise<Blob> {
    try {
      const url = URL.createObjectURL(file)
      const img = await new Promise<HTMLImageElement>((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url })
      const scale = Math.min(1, 2048 / Math.max(img.width, img.height))
      const w = Math.max(1, Math.round(img.width * scale)); const h = Math.max(1, Math.round(img.height * scale))
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const ctx = c.getContext('2d'); if (!ctx) throw new Error('no canvas')
      ctx.drawImage(img, 0, 0, w, h)
      URL.revokeObjectURL(url)
      const blob = await new Promise<Blob | null>(res => c.toBlob(res, 'image/jpeg', 0.92))
      if (!blob) throw new Error('encode failed')
      return blob
    } catch { return file }
  }

  // UPLOAD new photos: each file is mirrored (untouched original) + enhanced on the server, then
  // appears in the grid like any other photo (enhanced by default). Pushed via photo-order `adds`.
  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return
    const files = Array.from(list).slice(0, 20)
    setError(null); setPushedMsg(null); setUploadingCount(files.length); setOpen(true)
    for (const f of files) {
      try {
        const blob = await resizeToJpeg(f)
        const fd = new FormData()
        fd.append('listingId', listingId)
        fd.append('file', blob, (f.name || 'photo').replace(/\.[a-z0-9]+$/i, '') + '.jpg')
        const r = await fetch('/api/photo-upload', { method: 'POST', body: fd })
        const raw = await r.text()
        let j: any = null; try { j = raw ? JSON.parse(raw) : null } catch { j = null }
        if (!r.ok || !j || !j._id) throw new Error((j && j.error) || 'Upload failed. Please try again.')
        const id = j._id as string
        setPhotos(prev => ({ ...prev, [id]: { _id: id, url: j.originalUrl, caption: '', category: 'other', kind: 'upload' } }))
        setUploads(prev => ({ ...prev, [id]: { orig: j.originalUrl } }))
        setEnhanced(prev => ({ ...prev, [id]: j.enhancedUrl }))
        setUseEnhanced(prev => { const n = new Set(prev); n.add(id); return n })
        setOrder(prev => [...prev, id])
        setProposed(prev => [...prev, id])
      } catch (e: any) { setError(e.message || String(e)) }
      finally { setUploadingCount(c => Math.max(0, c - 1)) }
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  // REPLACE an existing photo's image: pick a file, it's mirrored + enhanced like an upload, then
  // swaps in at this photo's position. Pushed via photo-order's urls map (Guesty re-ingests it).
  function startReplace(id: string) { replaceTargetRef.current = id; replaceRef.current?.click() }

  async function replaceFile(list: FileList | null) {
    const f = list && list[0]; const target = replaceTargetRef.current
    if (!f || !target) return
    setError(null); setPushedMsg(null); setUploadingCount(1)
    try {
      const blob = await resizeToJpeg(f)
      const fd = new FormData()
      fd.append('listingId', listingId)
      fd.append('file', blob, 'replacement.jpg')
      const r = await fetch('/api/photo-upload', { method: 'POST', body: fd })
      const raw = await r.text()
      let j: any = null; try { j = raw ? JSON.parse(raw) : null } catch { j = null }
      if (!r.ok || !j || !j.originalUrl) throw new Error((j && j.error) || 'Replacement upload failed. Please try again.')
      setReplaced(prev => ({ ...prev, [target]: { orig: j.originalUrl, prevUrl: photosRef.current[target]?.url || '' } }))
      setPhotos(prev => ({ ...prev, [target]: { ...prev[target], url: j.originalUrl } }))
      setEnhanced(prev => ({ ...prev, [target]: j.enhancedUrl }))
      setUseEnhanced(prev => { const n = new Set(prev); n.add(target); return n })
    } catch (e: any) { setError(e.message || String(e)) }
    finally {
      setUploadingCount(0)
      if (replaceRef.current) replaceRef.current.value = ''
      replaceTargetRef.current = null
    }
  }

  function undoReplace(id: string) {
    const rep = replaced[id]; if (!rep) return
    setPhotos(prev => ({ ...prev, [id]: { ...prev[id], url: rep.prevUrl } }))
    setEnhanced(prev => { const n = { ...prev }; delete n[id]; return n })
    setUseEnhanced(prev => { const n = new Set(prev); n.delete(id); return n })
    setReplaced(prev => { const n = { ...prev }; delete n[id]; return n })
  }

  // Uploads aren't in Guesty yet, so "removing" one just drops it locally.
  function removeUpload(id: string) {
    setOrder(prev => prev.filter(x => x !== id)); setProposed(prev => prev.filter(x => x !== id))
    setPhotos(prev => { const n = { ...prev }; delete n[id]; return n })
    setUploads(prev => { const n = { ...prev }; delete n[id]; return n })
    setEnhanced(prev => { const n = { ...prev }; delete n[id]; return n })
    setUseEnhanced(prev => { const n = new Set(prev); n.delete(id); return n })
  }

  // RECREATE 2.0: when the listing optimizer runs a full Recreate, it fires this event so the photo
  // pass (analyze order + captions + enhance every image) runs automatically alongside the new copy.
  useEffect(() => {
    const run = async () => {
      setOpen(true)
      const ord = await analyze()
      if (ord && ord.length > 0) await enhance(ord)
    }
    const handler = () => { run() }
    window.addEventListener('stay:recreate-listing', handler)
    return () => window.removeEventListener('stay:recreate-listing', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId])

  function move(id: string, dir: -1 | 1) {
    setOrder(prev => {
      const i = prev.indexOf(id)
      const j = i + dir
      if (i <= 0 || j <= 0 || j >= prev.length) return prev // never move into hero slot (0)
      const next = prev.slice(); [next[i], next[j]] = [next[j], next[i]]; return next
    })
  }
  function setAsHero(id: string) {
    // Make this photo the hero (#1). Re-run analysis with the new hero so the rest re-orders around it.
    setHeroId(id); analyze(id)
  }
  function onDrop(targetId: string) {
    if (!dragId || dragId === targetId) { setDragId(null); return }
    setOrder(prev => {
      const from = prev.indexOf(dragId); const to = prev.indexOf(targetId)
      if (from <= 0 || to <= 0) return prev // hero slot is locked
      const next = prev.slice(); next.splice(from, 1); next.splice(to, 0, dragId); return next
    })
    setDragId(null)
  }

  function toggleRemove(id: string) {
    setToRemove(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  function setCaption(id: string, v: string) {
    setPhotos(prev => ({ ...prev, [id]: { ...prev[id], caption: v, captionIsPlaceholder: false } }))
    // Saved back to _photoIndex on a pause, not on every keystroke. Without this a hand-written
    // caption survived only until the next Analyze, and the copywriter kept reading the older AI
    // text because _photoIndex still held it.
    if (capTimer.current[id]) clearTimeout(capTimer.current[id])
    capTimer.current[id] = setTimeout(() => {
      fetch('/api/photo-meta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, photoId: id, caption: v }),
      }).catch(() => { /* the push still carries it; this is the durable copy */ })
    }, 900)
  }
  // ── THE TAG EDIT IS REAL NOW ──────────────────────────────────────────────────────────────
  // This used to write React state and stop. The value was never in the push body, no route ever
  // accepted a category, and the next Analyze or page reload wiped it — so every correction anyone
  // made here since the panel shipped was silently thrown away. It saves to _photoIndex marked as a
  // human edit, which the vision pass now respects instead of overwriting on its next run.
  // RE-GROUP IN THE BROWSER. The order engine is pure and isomorphic, so a room or category
  // correction rebuilds the order instantly from the facts already on screen — no second vision
  // call. Uploads (not yet in Guesty) stay appended; the cover stays where it is.
  function regroup(nextPhotos: Record<string, Photo>) {
    const ids = order.filter(id => !uploads[id])
    const facts: PhotoFacts[] = ids.map(id => { const p = nextPhotos[id]; return {
      _id: id, url: p.url, room: p.room || p.category || 'other', category: p.category || 'other', subject: p.subject || '',
      shotType: p.shotType || 'medium', quality: typeof p.quality === 'number' ? p.quality : 50, kind: p.kind === 'stock' ? 'stock' : 'property',
      faults: p.faults || [], sellingPoints: p.sellingPoints || [], duplicateOf: p.duplicateOf || null, heroWorthy: !!p.heroWorthy,
      caption: p.caption || '', captionSource: 'ai', enhance: p.enhance, enhanceWhy: p.enhanceWhy,
    } })
    const r = engineOrder(facts, heroId || ids[0] || null, profile || { bedrooms: null, isStudio: false })
    const merged: Record<string, Photo> = { ...nextPhotos }
    for (const pl of r.placed) merged[pl._id] = { ...merged[pl._id], placement: pl.placement, reason: pl.placement.why }
    setPhotos(merged)
    const newOrder = [...r.placed.map(p => p._id), ...order.filter(id => uploads[id])]
    setOrder(newOrder); setProposed(newOrder)
    setRemoveList(r.placed.filter(p => p.placement.slot === 'demoted').map(p => ({ _id: p._id, reason: p.placement.why })))
    setHeroCands(r.heroCandidates)
  }
  async function setRoom(id: string, v: string) {
    const before = photos[id]?.room
    const next = { ...photos, [id]: { ...photos[id], room: v } }
    regroup(next)
    setMetaBusy(prev => { const n = new Set(prev); n.add(id); return n })
    try {
      const r = await fetch('/api/photo-meta', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId, photoId: id, room: v }) })
      const j: any = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error || 'Could not save that room.')
      setMetaSaved(prev => { const n = new Set(prev); n.add(id); return n })
      setTimeout(() => setMetaSaved(prev => { const n = new Set(prev); n.delete(id); return n }), 2000)
    } catch (e: any) { regroup({ ...photos, [id]: { ...photos[id], room: before } }); setError(e.message || String(e)) }
    finally { setMetaBusy(prev => { const n = new Set(prev); n.delete(id); return n }) }
  }
  async function setCategory(id: string, v: string) {
    const before = photos[id]?.category
    regroup({ ...photos, [id]: { ...photos[id], category: v } })
    setMetaBusy(prev => { const n = new Set(prev); n.add(id); return n })
    try {
      const r = await fetch('/api/photo-meta', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, photoId: id, category: v }),
      })
      const j: any = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j?.error || 'Could not save that tag.')
      setMetaSaved(prev => { const n = new Set(prev); n.add(id); return n })
      setTimeout(() => setMetaSaved(prev => { const n = new Set(prev); n.delete(id); return n }), 2000)
    } catch (e: any) {
      // Put the old value back rather than leaving the screen claiming something that did not save.
      regroup({ ...photos, [id]: { ...photos[id], category: before } })
      setError(e.message || String(e))
    } finally {
      setMetaBusy(prev => { const n = new Set(prev); n.delete(id); return n })
    }
  }
  // Per-photo AI description: regenerates ONE photo's caption on demand (deliberate overwrite).
  async function regenCaption(id: string) {
    setCapBusy(prev => { const n = new Set(prev); n.add(id); return n })
    try {
      const r = await fetch('/api/photo-caption', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listingId, photoId: id }) })
      const j: any = await r.json().catch(() => ({}))
      if (!r.ok || !j?.caption) throw new Error(j?.error || 'Could not generate a description - try again.')
      setCaption(id, j.caption)
    } catch (e: any) { setError(e.message || String(e)) }
    finally { setCapBusy(prev => { const n = new Set(prev); n.delete(id); return n }) }
  }

  async function push() {
    const remove = Array.from(toRemove)
    const addCount = order.filter(id => uploads[id]).length
    const swapCount = order.filter(id => !uploads[id] && (replaced[id] || (useEnhanced.has(id) && enhanced[id]))).length
    if ((remove.length > 0 || swapCount > 0 || addCount > 0) && !window.confirm(`This pushes the new photo order${addCount ? ` AND adds ${addCount} new photo(s)` : ''}${swapCount ? ` AND replaces ${swapCount} photo(s) with their enhanced versions` : ''}${remove.length ? ` AND permanently removes ${remove.length} photo(s)` : ''} on every channel (Airbnb, Vrbo, etc.). Continue?`)) return
    setPushing(true); setError(null); setPushedMsg(null)
    try {
      const captions: Record<string, string> = {}
      // NEVER PUSH A PLACEHOLDER. Every photo is guaranteed a caption server-side so the copywriter
      // always has a label — but for the hero and any photo past the AI's limit that caption is a
      // category stub the model never saw. Those were going to Airbnb as real captions, which is
      // how the literal words "Property photo" ended up on live listings.
      order.forEach(id => {
        const p = photos[id]
        const c = p?.caption
        if (typeof c !== 'string' || !c.trim()) return
        if (p?.captionIsPlaceholder) return
        captions[id] = c
      })
      const urls: Record<string, string> = {}
      const adds: Record<string, { url: string; caption: string }> = {}
      order.forEach(id => {
        if (uploads[id]) { adds[id] = { url: (useEnhanced.has(id) && enhanced[id]) ? enhanced[id] : uploads[id].orig, caption: photos[id]?.caption || '' }; return }
        // Revert wins over everything: put the untouched mirrored original back on the listing.
        if (revert.has(id) && photos[id]?.mirrorUrl) { urls[id] = photos[id].mirrorUrl as string; return }
        if (replaced[id]) { urls[id] = (useEnhanced.has(id) && enhanced[id]) ? enhanced[id] : replaced[id].orig; return }
        if (useEnhanced.has(id) && enhanced[id]) urls[id] = enhanced[id]
      })
      const r = await fetch('/api/photo-order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listingId, order, remove: Array.from(toRemove), captions, ...(Object.keys(urls).length ? { urls } : {}), ...(Object.keys(adds).length ? { adds } : {}) }),
      })
      const raw = await r.text()
      let j: any = null; try { j = raw ? JSON.parse(raw) : null } catch { j = null }
      if (!r.ok || !j) throw new Error((j && j.error) || 'Failed to push order. Please try again.')
      const base = `${j.count} photos (order + descriptions)${j.added ? `, ${j.added} added` : ''}${j.swapped ? `, ${j.swapped} enhanced` : ''}${j.removed ? `, ${j.removed} removed` : ''}`
      setPushedMsg(j.verified
        ? `\u2713 Pushed to Guesty and verified live: ${base}. Now syncing to all channels (Airbnb, Vrbo, etc.).`
        : `Pushed to Guesty: ${base}. ${j.verifyNote || 'Guesty is applying it across channels \u2014 give it a moment.'}`)
      setToRemove(new Set())
      // Pushed uploads are now real Guesty photos — clear temp state so a re-push can't duplicate them.
      if (Object.keys(adds).length) setUploads({})
      if (Object.keys(urls).length) setReplaced({}) // replacements are live now
    } catch (e: any) { setError(e.message || String(e)) } finally { setPushing(false) }
  }

  const changed = order.length > 0 && JSON.stringify(order) !== JSON.stringify(proposed)

  return (
    <section className="rounded-2xl border border-brand-200 bg-white overflow-hidden">
      {/* THE ACTIONS SIT AT THE TOP (Jon, 2026-08-27: "photos at top too"). The explanation used to
          be three lines of paragraph that pushed the button row below the fold on a phone, and it
          said the same thing on every visit to somebody who already knows what the tool does. One
          line now, and on small screens the buttons come FIRST — `order-first` — so the thing you
          came to press is the thing you see. */}
      <div className="px-4 py-3 bg-gradient-to-r from-brand-50 to-white flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0 order-last sm:order-none">
          <h2 className="text-sm font-bold text-ink inline-flex items-center gap-1.5"><Images size={15} className="text-brand-600" /> Organize photos with AI</h2>
          <p className="text-[12px] text-muted mt-0.5">Reads every photo, ranks cover candidates, builds the order room by room, flags duplicates and weak shots, writes descriptions and title ideas. Nothing goes live until you push.</p>
        </div>
        <div className="lh-actions flex flex-wrap items-center gap-2 sm:flex-nowrap sm:flex-shrink-0 order-first sm:order-none w-full sm:w-auto">
          <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => addFiles(e.target.files)} />
          <input ref={replaceRef} type="file" accept="image/*" className="hidden" onChange={e => replaceFile(e.target.files)} />
          <button onClick={() => fileRef.current?.click()} disabled={uploadingCount > 0 || pushing}
            title="Upload new photos — each is saved to Stay storage (original kept) and gently enhanced; place and push them like any other photo"
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-white text-ink px-3.5 py-2.5 text-sm font-semibold hover:bg-app disabled:opacity-50">
            {uploadingCount > 0 ? <Sparkles size={15} className="animate-pulse" /> : <ImagePlus size={15} />}
            {uploadingCount > 0 ? `Uploading ${uploadingCount}\u2026` : 'Add photos'}
          </button>
          <button onClick={() => mirror()} disabled={mirroring || pushing}
            title="Back up every photo's untouched original to Stay storage — no changes, nothing pushed"
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-white text-ink px-3.5 py-2.5 text-sm font-semibold hover:bg-app disabled:opacity-50">
            {mirroring ? <Sparkles size={15} className="animate-pulse" /> : <Archive size={15} />}
            {mirroring ? 'Mirroring\u2026' : 'Mirror'}
          </button>
          <button onClick={() => enhance(order.length > 0 ? order : undefined)} disabled={enhancing || busy || pushing}
            title="Back up every original, then create a corrected version using the preset the AI picked per photo (exposure, contrast, colour, sharpness — never a repaint). You compare and tick before anything goes live."
            className="inline-flex items-center gap-2 rounded-xl border border-brand-300 bg-white text-brand-700 px-3.5 py-2.5 text-sm font-semibold hover:bg-brand-50 disabled:opacity-50">
            {enhancing ? <Sparkles size={15} className="animate-pulse" /> : <Sun size={15} />}
            {enhancing ? 'Enhancing…' : 'Enhance photos'}
          </button>
          {/* DESCRIBE EVERY PHOTO. The ordinary run never overwrites a caption Guesty already has —
              right for a human-written one, but it also meant the AI captions were generated, paid
              for and silently discarded on any listing that already had captions, so "optimize
              photos" produced no new descriptions at all. This is the explicit opt-in. */}
          {open && order.length > 0 && (
            <button onClick={() => { if (window.confirm('Rewrite the description on EVERY photo, replacing what is there now? Nothing goes live until you push.')) analyze(heroId || undefined, undefined, true) }}
              disabled={busy || pushing}
              title="Regenerate a description for every photo, including ones that already have a caption"
              className="inline-flex items-center gap-2 rounded-xl border border-line bg-white text-ink px-3.5 py-2.5 text-sm font-semibold hover:bg-app disabled:opacity-50">
              <Wand2 size={15} /> Describe all
            </button>
          )}
          <button onClick={() => { setOpen(o => !o); if (!open && order.length === 0) analyze() }} disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-brand-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">
            {busy ? <Sparkles size={15} className="animate-pulse" /> : <Wand2 size={15} />}
            {busy ? 'Organizing…' : open ? 'Hide' : 'Organize photos'}
          </button>
        </div>
      </div>

      {open && (
        <div className="px-4 py-4 border-t border-line space-y-4">
          {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-700 flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>}
          {pushedMsg && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-700 flex items-center gap-2"><Check size={14} /> {pushedMsg}</div>}
          {busy && order.length === 0 && <div className="rounded-xl border border-line bg-app/40 px-4 py-10 text-center text-sm text-muted">Studying every photo and ranking the best order…</div>}

          {assessment && (
            <div className="rounded-xl border border-brand-200 bg-brand-50/50 px-3.5 py-3">
              <div className="flex items-center gap-2 mb-1.5">
                <Gauge size={15} className="text-brand-600" />
                <span className="text-[13px] font-semibold text-ink">Photo quality score</span>
                {assessment.quality != null && (
                  <span className={`text-[13px] font-bold px-2 py-0.5 rounded-md ${assessment.quality >= 75 ? 'bg-emerald-100 text-emerald-700' : assessment.quality >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{assessment.quality}/100</span>
                )}
                <span className="text-[11px] text-muted ml-auto">feeds the listing &amp; health score</span>
              </div>
              {assessment.coverage && <p className="text-[12px] text-ink/80 mb-1">{assessment.coverage}</p>}
              {assessment.notes.length > 0 && (
                <ul className="text-[12px] text-muted space-y-0.5">
                  {assessment.notes.map((n, i) => <li key={i} className="flex items-start gap-1.5"><span className="mt-0.5 text-brand-500">+</span> {n}</li>)}
                </ul>
              )}
            </div>
          )}

          {/* TITLE IDEAS — written from what the photos PROVE, so the title never promises a pool
              the photos do not show. Copy one into the optimizer's title field. */}
          {titleIdeas.length > 0 && (
            <div className="rounded-xl border border-line bg-white px-3.5 py-3">
              <div className="flex items-center gap-2 mb-1.5">
                <Sparkles size={15} className="text-brand-600" />
                <span className="text-[13px] font-semibold text-ink">Title ideas from the photos</span>
                {titleHooks.length > 0 && <span className="text-[11px] text-muted ml-auto truncate">proven: {titleHooks.map(h => h.hook.replace(/-/g, ' ')).join(' · ')}</span>}
              </div>
              <ul className="space-y-1">
                {titleIdeas.map(t => (
                  <li key={t} className="flex items-center gap-2">
                    <span className="flex-1 text-[13px] text-ink">{t} <span className="text-[10.5px] text-muted">({t.length})</span></span>
                    <button onClick={async () => { try { await navigator.clipboard.writeText(t); setCopiedTitle(t); setTimeout(() => setCopiedTitle(null), 1500); window.dispatchEvent(new CustomEvent('stay:suggest-title', { detail: { title: t } })) } catch {} }}
                      className="text-[11px] font-semibold px-2 py-1 rounded-md border border-line bg-white text-ink hover:bg-app">{copiedTitle === t ? 'Copied' : 'Copy'}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {order.length > 0 && (
            <>
              <div className="flex items-center justify-between gap-2 flex-wrap text-[12px] text-muted">
                <span><span className="font-semibold text-ink">{order.length}</span> photos · cover photo locked at #1{overflow > 0 ? ` · ${overflow} extra kept at the end` : ''}</span>
                <div className="flex items-center gap-2">
                  {changed && <button onClick={() => setOrder(proposed)} className="inline-flex items-center gap-1 text-[12px] text-muted hover:text-ink"><RotateCcw size={12} /> Reset to AI order</button>}
                  {removeList.length > 0 && <button onClick={() => setToRemove(prev => prev.size === removeList.length ? new Set() : new Set(removeList.map(r => r._id)))} className="inline-flex items-center gap-1 text-[12px] text-rose-700 hover:text-rose-800"><Trash2 size={12} /> {toRemove.size === removeList.length ? 'Unmark all' : `Mark all ${removeList.length} flagged`}</button>}
                  <button onClick={() => analyze(undefined, undefined, false, true)} disabled={busy} title="Let the engine choose the cover from its ranked candidates" className="inline-flex items-center gap-1 text-[12px] text-amber-700 hover:text-amber-800 disabled:opacity-50"><Crown size={12} /> AI picks cover</button>
                  <button onClick={() => analyze(heroId || undefined)} disabled={busy} className="inline-flex items-center gap-1 text-[12px] text-brand-600 hover:text-brand-700 disabled:opacity-50"><Wand2 size={12} /> Re-run</button>
                </div>
              </div>

              {/* The ordering rule, printed. It used to be a black box: the model proposed an order
                  and the server then regrouped it, and nothing on screen said how. */}
              {orderRule && (
                <div className="rounded-xl border border-line bg-app/40 px-3 py-2 text-[11.5px] text-muted">
                  <b className="text-ink">How this order is built:</b> {orderRule}
                </div>
              )}

              {Object.keys(enhanced).length > 0 && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 flex items-center gap-2 flex-wrap text-[12px] text-emerald-900">
                  <Sun size={14} className="shrink-0" />
                  <span><b>{useEnhanced.size}</b> of {Object.keys(enhanced).length} enhanced photos ticked to go live. Hold <b>A/B</b> on a card to compare.</span>
                  <div className="ml-auto flex items-center gap-2">
                    <button onClick={useAllEnhanced} className="rounded-lg border border-emerald-300 bg-white px-2 py-0.5 text-[11.5px] font-semibold text-emerald-800">Use all</button>
                    <button onClick={() => setUseEnhanced(new Set())} className="rounded-lg border border-emerald-300 bg-white px-2 py-0.5 text-[11.5px] font-semibold text-emerald-800">Use none</button>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-brand-200 bg-brand-50/40 px-3 py-2.5 flex items-center gap-2 flex-wrap">
                <Wand2 size={14} className="text-brand-600 shrink-0" />
                <input value={guidance} onChange={e => setGuidance(e.target.value)}
                  placeholder="Tell the AI what to fix — e.g. &lsquo;the dining photos are tagged amenity, classify them as dining&rsquo;"
                  className="flex-1 min-w-[220px] text-[12px] rounded-lg border border-line bg-white px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-200" />
                <button onClick={() => analyze(heroId || undefined, guidance)} disabled={busy || !guidance.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 text-white px-3 py-1.5 text-[12px] font-semibold hover:bg-brand-700 disabled:opacity-50">
                  <Wand2 size={13} /> Apply correction &amp; re-run
                </button>
              </div>

              <ol className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {order.map((id, idx) => {
                  const p = photos[id]; if (!p) return null
                  const isHero = idx === 0
                  // Storyboard headers: a new row whenever the engine's group changes as the order
                  // stands NOW (a dragged photo simply starts its own group — honest, not stale).
                  const grp = isHero ? 'Cover' : (p.placement?.slot === 'showcase' ? 'Showcase' : p.placement?.slot === 'demoted' ? 'Consider removing' : (p.placement?.group || 'Photos'))
                  const prev = idx > 0 ? photos[order[idx - 1]] : null
                  const prevGrp = idx === 0 ? null : idx === 1 ? 'Cover' : (prev?.placement?.slot === 'showcase' ? 'Showcase' : prev?.placement?.slot === 'demoted' ? 'Consider removing' : (prev?.placement?.group || 'Photos'))
                  const header = grp !== prevGrp ? grp : null
                  const slotTone = p.placement?.slot === 'demoted' ? 'bg-rose-50 text-rose-700 border-rose-200' : p.placement?.slot === 'showcase' ? 'bg-brand-50 text-brand-700 border-brand-200' : p.placement?.slot === 'building' ? 'bg-teal-50 text-teal-700 border-teal-200' : 'bg-app text-muted border-line'
                  return (
                    <Fragment key={id}>
                    {header && (
                      <li className="col-span-full flex items-center gap-2 pt-2 first:pt-0">
                        <span className={`text-[11px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md border ${slotTone}`}>{header}</span>
                        <span className="text-[11px] text-muted">{header === 'Cover' ? 'position 1 — yours' : header === 'Showcase' ? 'positions 2–5 — one photo per key space' : header === 'Consider removing' ? 'duplicates, weak shots and stock — tick to remove on push' : 'the tour, room by room'}</span>
                        <span className="flex-1 border-t border-line" />
                      </li>
                    )}
                    <li
                      draggable={!isHero}
                      onDragStart={() => !isHero && setDragId(id)}
                      onDragOver={e => { if (!isHero) e.preventDefault() }}
                      onDrop={() => onDrop(id)}
                      className={`relative rounded-xl border overflow-hidden bg-app/30 ${isHero ? 'border-amber-300 ring-1 ring-amber-200' : 'border-line cursor-move'} ${dragId === id ? 'opacity-50' : ''}`}>
                      <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-1">
                        <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md ${isHero ? 'bg-amber-500 text-white' : 'bg-black/60 text-white'}`}>{idx + 1}</span>
                        {isHero && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-800 inline-flex items-center gap-0.5"><Star size={10} /> Cover</span>}
                        {(() => { const ci = heroCands.findIndex(c => c._id === id); return ci >= 0 && ci < 3 && !isHero ? <button onClick={() => setAsHero(id)} title={`Cover pick #${ci + 1} (score ${heroCands[ci].score}) — click to make it the cover`} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-500 text-white inline-flex items-center gap-0.5"><Crown size={10} /> Cover pick #{ci + 1}</button> : null })()}
                        {p.kind === 'stock' && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-orange-100 text-orange-800 inline-flex items-center gap-0.5"><MapPinned size={10} /> Stock</span>}
                        {uploads[id] && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-sky-100 text-sky-800 inline-flex items-center gap-0.5"><ImagePlus size={10} /> New</span>}
                        {replaced[id] && <button onClick={() => undoReplace(id)} title="Image replaced — click to undo and keep the old photo" className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-violet-100 text-violet-800 inline-flex items-center gap-0.5"><RefreshCw size={10} /> Replaced</button>}
                        {removeList.some(r => r._id === id) && !toRemove.has(id) && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-rose-100 text-rose-700 inline-flex items-center gap-0.5"><Trash2 size={10} /> Suggest</span>}
                        {toRemove.has(id) && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-rose-600 text-white inline-flex items-center gap-0.5"><Trash2 size={10} /> Removing</span>}
                      </div>
                      {/* Held A/B always shows the OTHER version, so the comparison is honest. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={(() => {
                          const showEnhanced = !!enhanced[id] && useEnhanced.has(id) && !revert.has(id)
                          const flipped = peek === id ? !showEnhanced : showEnhanced
                          if (revert.has(id) && p.mirrorUrl && peek !== id) return p.mirrorUrl
                          return flipped && enhanced[id] ? enhanced[id] : p.url
                        })()}
                        alt={p.caption || `photo ${idx + 1}`} className="w-full aspect-[4/3] object-cover" loading="lazy" />
                      <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1">
                        {enhanced[id] && (
                          <button
                            onMouseDown={() => setPeek(id)} onMouseUp={() => setPeek(null)} onMouseLeave={() => setPeek(null)}
                            onTouchStart={() => setPeek(id)} onTouchEnd={() => setPeek(null)}
                            title="Hold to compare before / after"
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-white/90 text-zinc-700 border border-line select-none">A/B</button>
                        )}
                        {enhanced[id] && (
                          <button onClick={() => toggleEnhanced(id)}
                            title={useEnhanced.has(id) ? 'The enhanced version will go live — click to keep the original instead' : 'The original will stay live — click to use the enhanced version'}
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md inline-flex items-center gap-0.5 ${useEnhanced.has(id) ? 'bg-emerald-500 text-white' : 'bg-white/90 text-zinc-600 border border-line'}`}>
                            <Sun size={10} /> {useEnhanced.has(id) ? 'Enhanced' : 'Original'}
                          </button>
                        )}
                        {p.mirrorUrl && !uploads[id] && (
                          <button onClick={() => toggleRevert(id)}
                            title={revert.has(id) ? 'Will restore the untouched original on push — click to cancel' : 'Restore the untouched original we backed up before any enhancement'}
                            className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md inline-flex items-center gap-0.5 ${revert.has(id) ? 'bg-violet-600 text-white' : 'bg-white/90 text-zinc-600 border border-line'}`}>
                            <RotateCcw size={10} /> {revert.has(id) ? 'Reverting' : 'Revert'}
                          </button>
                        )}
                      </div>
                      <div className="p-2 space-y-1">
                        <div className="flex items-center gap-1 flex-wrap">
                          {typeof p.quality === 'number' && <span title="Conversion quality of this photo (light, sharpness, staging, sense of space)" className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${p.quality >= 75 ? 'bg-emerald-100 text-emerald-700' : p.quality >= 55 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{p.quality}</span>}
                          {p.shotType && <span className="text-[10px] font-medium text-muted">{p.shotType}</span>}
                          {p.placement?.flag === 'duplicate' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">Duplicate</span>}
                          {p.placement?.flag === 'fault' && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">Weak</span>}
                          {p.subject && <span className="text-[10px] text-ink/80 truncate" title={p.subject}>{p.subject}</span>}
                        </div>
                        {p.placement?.slot === 'demoted' && !isHero && (
                          <button onClick={() => toggleRemove(id)} className={`w-full text-left text-[10.5px] leading-snug rounded-md px-1.5 py-1 border ${toRemove.has(id) ? 'bg-rose-600 border-rose-600 text-white' : 'bg-rose-50 border-rose-200 text-rose-800 hover:bg-rose-100'}`}>
                            <b>{toRemove.has(id) ? 'Removing on push' : 'Suggest removing'}</b> — {p.placement.why}
                          </button>
                        )}
                        {isHero && heroCands[0] && heroCands[0]._id !== id && (
                          <button onClick={() => setAsHero(heroCands[0]._id)} className="w-full text-left text-[10.5px] leading-snug rounded-md px-1.5 py-1 border bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100"><b>Stronger cover available</b> — {heroCands[0].why} (score {heroCands[0].score}). Click to use it.</button>
                        )}
                        <select value={p.room || ''} onChange={e => { const v = e.target.value === '__new' ? (window.prompt('Room id (e.g. bedroom-2, bath-guest, balcony)') || '').trim().toLowerCase().replace(/\s+/g, '-') : e.target.value; if (v) setRoom(id, v) }} title="Which room this photo shows — photos of one room stay together" className="text-[10px] font-semibold pl-1.5 pr-4 py-0.5 rounded border border-line bg-white text-ink cursor-pointer appearance-none focus:outline-none focus:ring-1 focus:ring-brand-300">
                          {Array.from(new Set([...(roomVocab || []), ...Object.values(photos).map(x => x.room || '').filter(Boolean), p.room || ''])).filter(Boolean).map(r => <option key={r} value={r}>{r.replace(/-/g, ' ')}</option>)}
                          <option value="__new">other room…</option>
                        </select>
                        <select value={p.category || 'other'} onChange={e => setCategory(id, e.target.value)} title="Photo category — correct the AI's tag" className={`text-[10px] font-semibold pl-1.5 pr-4 py-0.5 rounded border-0 cursor-pointer appearance-none focus:outline-none focus:ring-1 focus:ring-brand-300 ${CAT_COLORS[p.category || 'other'] || CAT_COLORS.other}`}>
                          {CATS.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        {/* Saving state on the tag, because a control that silently does nothing is
                            exactly what this dropdown used to be. */}
                        {metaBusy.has(id) && <Loader2 size={10} className="animate-spin text-muted ml-1 inline" />}
                        {metaSaved.has(id) && <span className="text-[10px] font-semibold text-emerald-600 ml-1">saved</span>}
                        {p.reason && <p className="text-[11px] text-muted leading-snug">{p.reason}</p>}
                        {presets.length > 0 && !uploads[id] && (
                          <div className="flex items-center gap-1">
                            <select
                              value={presetPick[id] || 'none'}
                              onChange={e => pickPreset(id, e.target.value)}
                              disabled={enhancing}
                              title="How this photo is corrected. The AI proposes one; you decide."
                              className="text-[10px] font-semibold pl-1.5 pr-4 py-0.5 rounded border border-line bg-white text-ink cursor-pointer appearance-none focus:outline-none focus:ring-1 focus:ring-brand-300 disabled:opacity-50">
                              <option value="none">No correction</option>
                              {presets.map(pr => <option key={pr.key} value={pr.key}>{pr.name}</option>)}
                            </select>
                            {p.enhanceWhy && <span className="text-[10px] text-muted truncate" title={p.enhanceWhy}>{p.enhanceWhy}</span>}
                          </div>
                        )}
                        <input value={p.caption || ''} onChange={e => setCaption(id, e.target.value)} placeholder="Add a description…" title="Guest-facing photo description — pushed to Guesty" className="w-full text-[11px] rounded border border-line bg-white px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-brand-200" />
                        <div className="flex items-center gap-1 pt-0.5">
                          {!isHero && <button onClick={() => move(id, -1)} disabled={idx <= 1} title="Move earlier" className="p-1 rounded border border-line text-muted hover:text-ink disabled:opacity-30"><ArrowUp size={12} /></button>}
                          {!isHero && <button onClick={() => move(id, 1)} disabled={idx >= order.length - 1} title="Move later" className="p-1 rounded border border-line text-muted hover:text-ink disabled:opacity-30"><ArrowDown size={12} /></button>}
                          {!uploads[id] && <button onClick={() => startReplace(id)} disabled={uploadingCount > 0} title="Replace this photo's image with a new upload — keeps its spot and description" className="p-1 rounded border border-line text-muted hover:text-ink disabled:opacity-30"><RefreshCw size={12} /></button>}
                          <button onClick={() => regenCaption(id)} disabled={capBusy.has(id)} title="AI: write a description for this photo (overwrites the current one)" className="p-1 rounded border border-line text-brand-600 hover:text-brand-700 disabled:opacity-40">{capBusy.has(id) ? <RefreshCw size={12} className="animate-spin" /> : <Wand2 size={12} />}</button>
                          {!uploads[id] && <button onClick={() => enhance([id])} disabled={enhancing} title="Enhance this photo (brightness / contrast / sharpen)" className="p-1 rounded border border-line text-muted hover:text-ink disabled:opacity-30"><Sun size={12} /></button>}
                          {!uploads[id] && <button onClick={() => mirror([id])} disabled={mirroring} title="Back up this photo's original to Stay storage" className="p-1 rounded border border-line text-muted hover:text-ink disabled:opacity-30"><Archive size={12} /></button>}
                          {!isHero && <button onClick={() => setAsHero(id)} title="Make this the cover photo" className="ml-auto p-1 rounded border border-line text-amber-600 hover:text-amber-700"><Star size={12} /></button>}
                          {!isHero && <button onClick={() => uploads[id] ? removeUpload(id) : toggleRemove(id)} title={uploads[id] ? 'Discard this new photo (not uploaded to Guesty yet)' : toRemove.has(id) ? 'Keep this photo' : 'Remove this photo from the listing'} className={`p-1 rounded border ${toRemove.has(id) ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-line text-muted hover:text-rose-600'}`}><Trash2 size={12} /></button>}
                        </div>
                      </div>
                    </li>
                    </Fragment>
                  )
                })}
              </ol>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button onClick={push} disabled={pushing || busy}
                  className="inline-flex items-center gap-2 rounded-xl bg-brand-600 text-white px-4 py-2.5 text-sm font-semibold hover:bg-brand-700 disabled:opacity-50">
                  {pushing ? <Sparkles size={15} className="animate-pulse" /> : <UploadCloud size={15} />}
                  {pushing ? 'Pushing…' : 'Push to Guesty'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
