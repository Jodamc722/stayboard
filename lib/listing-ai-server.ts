// Server-side loader for the Listing & Photo AI config (app_settings key 'listing_ai').
// Split out from lib/listing-ai.ts so the admin UI can import the types and defaults without
// pulling supabase-admin into a client bundle.
//
// Every caller gets a fully-populated config: an unset key, a malformed value or a missing
// app_settings table all fall back to DEFAULT_LISTING_AI, which is the exact text that used to be
// hardcoded. A settings problem can never leave a route without a prompt.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { DEFAULT_LISTING_AI, mergeListingAi, type ListingAi } from '@/lib/listing-ai'

export const LISTING_AI_KEY = 'listing_ai'

// app_settings.value is TEXT — JSON-stringify in, parse out. A BARE SCALAR round-trips to the
// fallback, which is why everything here is wrapped in an object. See reference-user-management.
export function parseSettingValue(v: any): any {
  if (v && typeof v === 'object') return v
  if (typeof v === 'string' && v) { try { const j = JSON.parse(v); if (j && typeof j === 'object') return j } catch { /* not json */ } }
  return null
}

export async function loadListingAi(): Promise<ListingAi> {
  try {
    const { data, error } = await supabaseAdmin()
      .from('app_settings').select('value').eq('key', LISTING_AI_KEY).maybeSingle()
    if (error) return DEFAULT_LISTING_AI
    return mergeListingAi(parseSettingValue(data?.value))
  } catch {
    return DEFAULT_LISTING_AI
  }
}

// Used by the "Test on a unit" playground: the editor sends its CURRENT (possibly unsaved) config
// and the route prefers it over the stored key, exactly like voicePreview in /api/reviews/draft.
export async function loadListingAiWithPreview(preview: any): Promise<ListingAi> {
  if (preview && typeof preview === 'object') return mergeListingAi(preview)
  return loadListingAi()
}
