// TEMPORARY diagnostic — finds where cancellation policy + instant book actually live in the
// raw Guesty listing object so the Optimize Score reads the right paths. Logged-in only.
// Call: /api/diag-fields  (uses first listing) or /api/diag-fields?id=<listingId>
// Returns matching paths + values. DELETE after use.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

const RX = /cancel|instant|book|term|policy|refund|minnight|min_night|checkin|checkout|night/i

function walk(obj: any, path: string, out: Record<string, any>, depth: number) {
  if (depth > 4 || obj == null) return
  if (Array.isArray(obj)) {
    if (obj.length && typeof obj[0] !== 'object') return
    obj.slice(0, 3).forEach((v, i) => walk(v, `${path}[${i}]`, out, depth + 1))
    return
  }
  if (typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      const p = path ? `${path}.${k}` : k
      const v = (obj as any)[k]
      if (RX.test(k)) {
        if (v == null || typeof v !== 'object') out[p] = v
        else if (Array.isArray(v)) out[p] = `[array len ${v.length}]`
        else out[p] = `{keys: ${Object.keys(v).slice(0, 12).join(', ')}}`
      }
      if (v && typeof v === 'object') walk(v, p, out, depth + 1)
    }
  }
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const id = new URL(req.url).searchParams.get('id')
  const sb = supabaseAdmin()
  const q = sb.from('guesty_listings').select('id, title, nickname, raw')
  const { data: listing } = id ? await q.eq('id', id).maybeSingle() : await q.limit(1).maybeSingle()
  if (!listing) return NextResponse.json({ error: 'no listing' }, { status: 404 })

  const raw = (listing as any).raw || {}
  const matches: Record<string, any> = {}
  walk(raw, '', matches, 0)

  const ints = Array.isArray(raw.integrations) ? raw.integrations : []
  const integrationsSummary = ints.map((it: any) => {
    const out: any = {}
    for (const ck of Object.keys(it || {})) {
      const c = (it as any)[ck]
      if (c && typeof c === 'object') {
        const urlish: any = {}
        for (const k of Object.keys(c)) { if (/url|link|listingid|roomid|listing_id|room_id|propertyid|hotelid|externalid|external_id|id$/i.test(k)) urlish[k] = (c as any)[k] }
        out[ck] = { keys: Object.keys(c).slice(0, 40), urlish }
      }
    }
    return out
  })
  return NextResponse.json({
    id: listing.id,
    name: (listing as any).title || (listing as any).nickname,
    address: raw.address || null,
    amenities: raw.amenities || null,
    integrationsSummary,
    matchedPaths: matches,
  })
}
