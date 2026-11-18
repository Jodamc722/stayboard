// A BACKDROP FROM A BUILDING'S OWN PICTURE (Jon, 2026-11-17: "that image … needs to be modified so it's not the
// original image and potentially blurred. We do not own the rights to those images"). A photograph from a
// building's website is never placed on a deck as it is. It is cropped to a slide, blurred until no detail of the
// original survives, desaturated a little and darkened, so all that is left is the building's colour and mood
// behind our own words. Only that adaptation is stored; the original file is not kept.
//
// The Rider's two were made by hand (public/deck-img/rider). This makes them for any building, from the
// photographs lib/brand-read finds. Stored in a public bucket, because a deck is opened by people outside the app.
import 'server-only'
import crypto from 'crypto'
import { supabaseAdmin } from './supabase-admin'
import { safeGetBytes } from './safe-fetch'

const BUCKET = 'deck-backdrops'
let ready = false
async function ensureBucket() {
  if (ready) return
  const sb = supabaseAdmin()
  const { data } = await sb.storage.getBucket(BUCKET)
  if (!data) { const { error } = await sb.storage.createBucket(BUCKET, { public: true, fileSizeLimit: 4 * 1024 * 1024, allowedMimeTypes: ['image/jpeg'] }); if (error && !/already exists/i.test(error.message || '')) throw new Error('storage bucket: ' + error.message) }
  ready = true
}
/** One picture → a 1600×900 backdrop. Throws when it is not a usable photograph (too small, not an image). */
export async function backdropFrom(bytes: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  const img = sharp(bytes, { failOn: 'none' }).rotate()
  const meta = await img.metadata()
  if (!meta.width || !meta.height || meta.width < 700 || meta.height < 400) throw new Error('too small')
  return img.resize(1600, 900, { fit: 'cover', position: 'attention' })
    .blur(22)                                           // no detail of the original survives this
    .modulate({ saturation: 0.75, brightness: 0.62 })   // the mood, not the picture; dark enough for white words
    .jpeg({ quality: 74, mozjpeg: true }).toBuffer()
}
/** The first `n` usable photographs, as stored backdrops. Pictures that fail are skipped. */
export async function makeBackdrops(urls: string[], n = 2): Promise<string[]> {
  const out: string[] = []
  for (const u of urls.slice(0, 6)) {
    if (out.length >= n) break
    try {
      const src = await safeGetBytes(u)
      const jpg = await backdropFrom(src.bytes)
      await ensureBucket()
      const path = crypto.createHash('sha256').update(u).digest('hex').slice(0, 24) + '.jpg'
      const sb = supabaseAdmin()
      const { error } = await sb.storage.from(BUCKET).upload(path, jpg, { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' })
      if (error) continue
      out.push(sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl)
    } catch { /* not a photograph we can use: try the next */ }
  }
  return out
}
