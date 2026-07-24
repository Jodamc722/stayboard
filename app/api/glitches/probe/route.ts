// TEMP diagnostic (auth-gated): inspect a Breezeway task's raw payload and probe the
// task-template endpoints, so glitch pushes can instantiate the built template.
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { bzApi, retrieveBreezewayTask } from '@/lib/breezeway'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const id = String(req.nextUrl.searchParams.get('id') || '')
  const probe = String(req.nextUrl.searchParams.get('probe') || '')
  try {
    if (probe) {
      const r = await bzApi(probe)
      return NextResponse.json({ ok: r.ok, status: r.status, body: (r.text || '').slice(0, 4000) })
    }
    if (!id) return NextResponse.json({ ok: false, error: 'id or probe required' }, { status: 400 })
    const r = await retrieveBreezewayTask(id)
    return NextResponse.json({ ok: r.ok, status: r.status, task: r.data || null, text: r.ok ? undefined : (r.text || '').slice(0, 500) })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
