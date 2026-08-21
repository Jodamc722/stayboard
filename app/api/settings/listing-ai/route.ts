// Listing & Photo AI settings — the editable prompt library behind /users -> App settings.
// Stored in app_settings key 'listing_ai'. GET is open to anyone who can use the optimizer (the
// admin UI and the "test on a unit" playground both read it); PUT is owner/full-level only,
// because these prompts write copy onto live OTA listings.
//
// An unset key is NORMAL and means "use the Stay defaults" — GET returns the merged defaults so the
// editor always opens pre-filled with exactly what the routes are using.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getAccess, requireLevel } from '@/lib/access'
import { mergeListingAi, DEFAULT_LISTING_AI, SECTION_KEYS, clampPreset, type ListingAi } from '@/lib/listing-ai'
import { LISTING_AI_KEY, parseSettingValue, loadListingAi } from '@/lib/listing-ai-server'

export const dynamic = 'force-dynamic'

const MISSING_TABLE = 'This needs the workspaces migration — run supabase/migrations/013_user_workspaces.sql in Supabase, then try again.'

export async function GET() {
  const access = await getAccess()
  if (!access.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const { data, error } = await supabaseAdmin()
      .from('app_settings').select('value, updated_by, updated_at').eq('key', LISTING_AI_KEY).maybeSingle()
    if (error) return NextResponse.json({ config: DEFAULT_LISTING_AI, defaults: DEFAULT_LISTING_AI, saved: false, note: MISSING_TABLE })
    const stored = parseSettingValue(data?.value)
    return NextResponse.json({
      config: mergeListingAi(stored),
      defaults: DEFAULT_LISTING_AI,
      saved: !!stored,
      updated_by: data?.updated_by || null,
      updated_at: data?.updated_at || null,
    })
  } catch {
    return NextResponse.json({ config: DEFAULT_LISTING_AI, defaults: DEFAULT_LISTING_AI, saved: false, note: MISSING_TABLE })
  }
}

export async function PUT(req: NextRequest) {
  // These prompts generate copy that gets pushed to live listings — full level, not just edit.
  const gate = await requireLevel('optimize', 'full')
  if (!gate.ok) return gate.res
  const access = await getAccess()

  const body = await req.json().catch(() => ({} as any))
  // Merge through the same normalizer the routes use, so nothing unclamped or malformed is ever
  // stored — the enhance caps in particular are enforced here, not just in the UI.
  const cfg: ListingAi = mergeListingAi(body?.config)
  cfg.enhance.presets = cfg.enhance.presets.map(p => clampPreset(p))

  const { error } = await supabaseAdmin().from('app_settings').upsert(
    { key: LISTING_AI_KEY, value: JSON.stringify(cfg), updated_by: access.email, updated_at: new Date().toISOString() },
    { onConflict: 'key' })
  if (error) {
    const msg = /app_settings/i.test(error.message || '') || /relation/i.test(error.message || '') ? MISSING_TABLE : error.message
    return NextResponse.json({ error: msg }, { status: 500 })
  }
  return NextResponse.json({ ok: true, config: cfg })
}

// Reset one section (or everything) back to the Stay default, without the client having to
// round-trip the whole object.
export async function DELETE(req: NextRequest) {
  const gate = await requireLevel('optimize', 'full')
  if (!gate.ok) return gate.res
  const access = await getAccess()
  const section = new URL(req.url).searchParams.get('section') || ''

  if (!section || section === 'all') {
    const { error } = await supabaseAdmin().from('app_settings').delete().eq('key', LISTING_AI_KEY)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, config: DEFAULT_LISTING_AI })
  }
  if (!(SECTION_KEYS as string[]).includes(section)) {
    return NextResponse.json({ error: `Unknown section "${section}".` }, { status: 400 })
  }
  const cfg = await loadListingAi()
  cfg.sections[section as (typeof SECTION_KEYS)[number]] = DEFAULT_LISTING_AI.sections[section as (typeof SECTION_KEYS)[number]]
  const { error } = await supabaseAdmin().from('app_settings').upsert(
    { key: LISTING_AI_KEY, value: JSON.stringify(cfg), updated_by: access.email, updated_at: new Date().toISOString() },
    { onConflict: 'key' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, config: cfg })
}
