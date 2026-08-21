import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  // ?slim=1 — id/name/building only. `select('*')` pulls the full Guesty `raw` blob for every
  // listing (tens of MB across 233 rows), which is wasteful for anything that just needs a picker.
  const slim = new URL(req.url).searchParams.get('slim') === '1'
  const { data, error } = await supabase
    .from('guesty_listings')
    .select(slim ? 'id, title, nickname, building, unit, status' : '*')
    .order('building', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ results: data })
}
