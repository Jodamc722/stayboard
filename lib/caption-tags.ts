// CAPTION TAGS — per listing, the things every photo caption should work in where a photo shows them
// ("steps to Las Olas", "rooftop pool with bay view", "free garage parking"). Kept in app_settings
// `caption_tags` ({ [listingId]: text }) rather than on the listing row, which the Guesty sync rewrites.
import 'server-only'
import { supabaseAdmin } from '@/lib/supabase-admin'

const KEY = 'caption_tags'

export async function readCaptionTags(): Promise<Record<string, string>> {
  try {
    const { data } = await supabaseAdmin().from('app_settings').select('value').eq('key', KEY).maybeSingle()
    const v = (data as any)?.value
    const o = typeof v === 'string' ? JSON.parse(v) : v
    return o && typeof o === 'object' ? o : {}
  } catch { return {} }
}
export async function captionTagFor(listingId: string): Promise<string> {
  return (await readCaptionTags())[listingId] || ''
}
export async function setCaptionTag(listingId: string, text: string, by: string): Promise<void> {
  const all = await readCaptionTags()
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 400)
  if (t) all[listingId] = t; else delete all[listingId]
  const { error } = await supabaseAdmin().from('app_settings').upsert({ key: KEY, value: JSON.stringify(all), updated_by: by || 'caption-tag', updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw new Error(error.message)
}
