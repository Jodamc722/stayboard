// Photo ENHANCE + MIRROR. POST { listingId, photoIds?, preset?, presets?, mirrorOnly? }
// For each listing photo: (1) MIRRORS the untouched original into Supabase Storage (our own copy,
// independent of Guesty/OTA CDNs), (2) creates an ENHANCED version using a NAMED PRESET.
// Generate-only: returns { photos: [{ _id, enhancedUrl, mirroredUrl, preset, ... }] } — nothing
// touches Guesty here. The human approves in the UI; /api/photo-order swaps the URLs on push.
// Mirror bookkeeping lives in guesty_listings.raw._photoMirror = { [photoId]: { orig, enhanced, at } }.
//
// WHAT "ENHANCE" MEANS (2026-08-21). It is a photographic CORRECTION, never a repaint: exposure,
// contrast, colour balance and sharpness only. No generative fill, no sky replacement, no
// straightening a room that is not straight. Until this date one fixed recipe ran on every photo
// (brightness 1.04, saturation 1.08, linear 1.06/-6, sharpen 0.9) — good numbers, but invisible,
// unnamed, and identical for a dark bathroom and a sunlit balcony. Now:
//   • the recipe is a named preset, editable at /users -> App settings, and
//   • lib/listing-ai clamps every preset to hard caps (brightness 1.15 / saturation 1.20 /
//     contrast 1.15 / sharpen 1.5) that no amount of editing can exceed, and
//   • the analyst in /api/optimize-photos picks the preset PER PHOTO and stores it on
//     raw._photoIndex[id].enhance, so a dim bathroom gets Bright and a good shot gets None.
// The preset "classic" is the exact pre-2026-08-21 recipe, so an untouched install behaves the same.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { requireLevel } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { loadListingAi } from '@/lib/listing-ai-server'
import { presetByKey, NONE_PRESET, type EnhancePreset } from '@/lib/listing-ai'
import sharp from 'sharp'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const BUCKET = 'listing-photos'
const CONCURRENCY = 4
const MAX_PER_CALL = 40 // matches the analyst's photo cap; the UI can page if a listing has more

function str(v: any): string { return typeof v === 'string' ? v : '' }

async function ensureBucket(sb: ReturnType<typeof supabaseAdmin>) {
  const { data } = await sb.storage.getBucket(BUCKET)
  if (data) return
  // public: photo URLs must be fetchable by Guesty + OTAs
  const { error } = await sb.storage.createBucket(BUCKET, { public: true })
  if (error && !/already exists/i.test(error.message || '')) throw new Error(`storage bucket: ${error.message}`)
}

// Turn a preset into a sharp pipeline. Everything here is a correction with a dial — nothing
// invents pixels. Contrast uses sharp's linear(a, b) with the offset derived from the multiplier
// so mid-tones hold (this reproduces the old 1.06 / -6 exactly). Warmth is a mild white-balance
// shift: red up, blue down by the same fraction, which is why it never tints toward monochrome.
function applyPreset(pipe: sharp.Sharp, p: EnhancePreset): sharp.Sharp {
  let out = pipe
  if (p.brightness !== 1 || p.saturation !== 1) out = out.modulate({ brightness: p.brightness, saturation: p.saturation })
  if (p.contrast !== 1) out = out.linear(p.contrast, -Math.round((p.contrast - 1) * 100))
  if (p.warmth > 0) {
    const w = p.warmth / 200
    out = out.recomb([[1 + w, 0, 0], [0, 1, 0], [0, 0, 1 - w]])
  }
  if (p.sharpen > 0) out = out.sharpen({ sigma: p.sharpen })
  return out
}

async function processOne(
  sb: ReturnType<typeof supabaseAdmin>,
  listingId: string,
  pic: any,
  preset: EnhancePreset,
  mirrorOnly = false,
) {
  const id = String(pic?._id || '')
  const src = str(pic?.original) || str(pic?.large) || str(pic?.thumbnail)
  if (!id || !src) return { _id: id, error: 'no source url' }

  const ir = await fetch(src, { cache: 'no-store' })
  if (!ir.ok) return { _id: id, error: `download ${ir.status}` }
  const buf = Buffer.from(await ir.arrayBuffer())
  if (buf.length < 1024) return { _id: id, error: 'source too small' }

  // 1) MIRROR the untouched original (jpeg-normalized so the copy is always web-servable).
  // This happens FIRST and ALWAYS, which is what makes "revert to original" possible later.
  const origOut = await sharp(buf, { failOn: 'none' }).rotate().jpeg({ quality: 95, mozjpeg: true }).toBuffer()
  const origPath = `${listingId}/${id}/original.jpg`
  const up1 = await sb.storage.from(BUCKET).upload(origPath, origOut, { contentType: 'image/jpeg', upsert: true })
  if (up1.error) return { _id: id, error: `mirror upload: ${up1.error.message}` }
  const mirroredUrl = sb.storage.from(BUCKET).getPublicUrl(origPath).data.publicUrl
  if (mirrorOnly) return { _id: id, mirroredUrl, preset: 'none', presetName: 'None', bytesBefore: buf.length }

  // "None" means the photo is already good — back it up and leave it alone. There is nothing to
  // approve, so no enhanced version is created.
  if (preset.key === 'none') return { _id: id, mirroredUrl, preset: 'none', presetName: 'None', bytesBefore: buf.length }

  // 2) ENHANCE with the chosen preset — deliberately gentle: real-estate honest, never fake-looking.
  const base = sharp(buf, { failOn: 'none' })
    .rotate()
    .resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true })
  const enhOut = await applyPreset(base, preset).jpeg({ quality: 88, mozjpeg: true }).toBuffer()
  const enhPath = `${listingId}/${id}/enhanced-${Date.now()}.jpg` // timestamped so CDNs never serve a stale edit
  const up2 = await sb.storage.from(BUCKET).upload(enhPath, enhOut, { contentType: 'image/jpeg', upsert: true })
  if (up2.error) return { _id: id, error: `enhanced upload: ${up2.error.message}` }
  const enhancedUrl = sb.storage.from(BUCKET).getPublicUrl(enhPath).data.publicUrl

  return { _id: id, mirroredUrl, enhancedUrl, preset: preset.key, presetName: preset.name, bytesBefore: buf.length, bytesAfter: enhOut.length }
}

export async function POST(req: NextRequest) {
  // 2026-08-21: these routes write to LIVE OTA listings (photo-order PUTs the picture array to
  // Guesty and honours a remove[] that permanently drops photos) yet only checked "is signed in",
  // while the copy route next door required optimize/edit. Same gate on both now.
  const gate = await requireLevel('optimize', 'edit')
  if (!gate.ok) return gate.res
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({} as any))
  const listingId = body?.listingId
  if (!listingId) return NextResponse.json({ error: 'listingId required' }, { status: 400 })
  const wanted: Set<string> | null = Array.isArray(body?.photoIds) && body.photoIds.length > 0
    ? new Set(body.photoIds.filter((x: any) => typeof x === 'string')) : null
  // mirrorOnly: back up originals to Stay storage WITHOUT creating enhanced versions.
  const mirrorOnly = body?.mirrorOnly === true
  // One preset for the whole run (the "apply Bright to everything" button).
  const globalPreset: string = str(body?.preset).trim()
  // Per-photo overrides from the UI: { photoId: presetKey }.
  const perPhoto: Record<string, string> = (body?.presets && typeof body.presets === 'object') ? body.presets : {}

  const cfg = await loadListingAi()

  const sb = supabaseAdmin()
  const { data: row, error } = await sb.from('guesty_listings').select('raw, pictures').eq('id', listingId).single()
  if (error || !row) return NextResponse.json({ error: 'listing not found' }, { status: 404 })
  const raw: any = (row.raw && typeof row.raw === 'object') ? row.raw : {}
  const all: any[] = Array.isArray(raw.pictures) ? raw.pictures
    : (Array.isArray((row as any).pictures) ? (row as any).pictures : [])
  if (all.length === 0) return NextResponse.json({ error: 'listing has no pictures' }, { status: 400 })

  // What the analyst decided for each photo, if it has been run. This is the whole point of
  // persisting _photoIndex — the dim bathroom gets Bright without anyone picking it by hand.
  const photoIndex: Record<string, any> = (raw._photoIndex && typeof raw._photoIndex === 'object') ? raw._photoIndex : {}
  const presetFor = (id: string): EnhancePreset => {
    if (perPhoto[id]) return presetByKey(cfg, perPhoto[id])
    if (globalPreset) return presetByKey(cfg, globalPreset)
    if (cfg.enhance.autoPick && photoIndex[id]?.enhance) return presetByKey(cfg, photoIndex[id].enhance)
    return presetByKey(cfg, cfg.enhance.fallbackPreset)
  }

  const targets = all
    .filter(p => !wanted || wanted.has(String(p?._id || '')))
    .slice(0, MAX_PER_CALL)
  if (targets.length === 0) return NextResponse.json({ error: 'no matching photos' }, { status: 400 })

  try { await ensureBucket(sb) } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'storage bucket unavailable' }, { status: 500 })
  }

  // Small-batch concurrency so 40 downloads + sharp passes stay well inside maxDuration.
  const results: any[] = []
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const chunk = targets.slice(i, i + CONCURRENCY)
    const settled = await Promise.all(chunk.map(p => {
      const id = String(p?._id || '')
      return processOne(sb, listingId, p, mirrorOnly ? NONE_PRESET : presetFor(id), mirrorOnly)
        .catch((e: any) => ({ _id: id, error: e?.message || String(e) }))
    }))
    results.push(...settled)
  }

  const ok = results.filter(r => (r as any).mirroredUrl)
  const failed = results.filter(r => !(r as any).mirroredUrl)

  // Best-effort mirror bookkeeping in raw (sync preserves _-prefixed keys).
  if (ok.length > 0) {
    try {
      const mirror: any = (raw._photoMirror && typeof raw._photoMirror === 'object') ? { ...raw._photoMirror } : {}
      const at = new Date().toISOString()
      for (const r of ok) mirror[r._id] = { ...(mirror[r._id] || {}), orig: r.mirroredUrl, ...(r.enhancedUrl ? { enhanced: r.enhancedUrl, preset: r.preset } : {}), at }
      await sb.from('guesty_listings').update({ raw: { ...raw, _photoMirror: mirror } }).eq('id', listingId)
    } catch { /* bookkeeping is best-effort */ }
  }

  return NextResponse.json({
    ok: true,
    count: ok.length,
    failedCount: failed.length,
    mirrorOnly,
    // Photos the model judged already good — reported so "nothing happened" is explained, not silent.
    skippedNone: ok.filter(r => !r.enhancedUrl && !mirrorOnly).length,
    photos: ok.map(r => ({
      _id: r._id,
      ...(r.enhancedUrl ? { enhancedUrl: r.enhancedUrl } : {}),
      mirroredUrl: r.mirroredUrl,
      preset: r.preset, presetName: r.presetName,
      enhanceWhy: str(photoIndex[r._id]?.enhanceWhy),
    })),
    presets: cfg.enhance.presets,
    errors: failed.map(r => ({ _id: r._id, error: r.error })),
  })
}
