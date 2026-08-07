// app/api/homebase/probe/route.ts
// TEMPORARY connection test v2 — tries every plausible auth strategy with the
// client ID + secret pair from Vercel env and reports which one Homebase
// accepts. Delete this route once the libs are locked to the working strategy.
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'
const BASE = process.env.HOMEBASE_BASE_URL || 'https://app.joinhomebase.com/api/public'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const id = process.env['Homebase_client_ID'] || process.env.HOMEBASE_CLIENT_ID || ''
  const secret = process.env['Homebase_Secret_id'] || process.env.HOMEBASE_SECRET_ID || process.env.HOMEBASE_API_KEY || ''
  const present = { clientId: !!id, secret: !!secret }
  if (!id && !secret) return NextResponse.json({ ok: false, present, error: 'no Homebase env vars visible' })

  const basic = Buffer.from(id + ':' + secret).toString('base64')
  const strategies: Record<string, Record<string, string>> = {
    bearer_secret: { Authorization: 'Bearer ' + secret },
    bearer_id: { Authorization: 'Bearer ' + id },
    basic_id_secret: { Authorization: 'Basic ' + basic },
    apikey_header: { 'X-Api-Key': secret, 'Client-Id': id },
  }

  const results: any = {}
  for (const [name, headers] of Object.entries(strategies)) {
    try {
      const r = await fetch(BASE + '/locations', {
        headers: { ...headers, Accept: 'application/vnd.homebase-v1+json' },
        cache: 'no-store',
      })
      const text = await r.text()
      let sample: any = null
      try {
        const j = JSON.parse(text)
        const a = Array.isArray(j) ? j : j?.data ?? j?.locations
        sample = Array.isArray(a) && a[0] ? { count: a.length, keysOfFirst: Object.keys(a[0]) } : { topLevelKeys: Object.keys(j) }
      } catch { sample = { raw: text.slice(0, 100) } }
      results[name] = { status: r.status, sample }
    } catch (e: any) { results[name] = { error: String(e?.message || e) } }
  }

  return NextResponse.json({ ok: true, present, base: BASE, results })
}
