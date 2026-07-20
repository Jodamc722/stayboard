// Send-to-Drive (P6). POST { fileName, base64 } — the report page builds the PPTX in the
// browser (pptxgenjs) and posts it here; we upload it to the user's Google Drive with
// conversion to Google Slides and return the webViewLink. 428 { needAuth: true } when the
// user hasn't connected Google yet (client then opens /api/google/auth in a popup).
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function str(v: any): string { return typeof v === 'string' ? v : (v == null ? '' : String(v)) }

async function accessTokenFor(email: string): Promise<string | null> {
  const { data } = await supabaseAdmin().from('google_tokens').select('refresh_token').eq('user_email', email).limit(1)
  const refresh = (data || [])[0]?.refresh_token
  if (!refresh) return null
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  const body = new URLSearchParams({
    refresh_token: refresh,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
  })
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const d: any = await r.json().catch(() => ({}))
  return r.ok && d?.access_token ? d.access_token : null
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({} as any))
  const fileName = str(body?.fileName).replace(/\.pptx$/i, '').slice(0, 120) || 'Owner Review'
  const base64 = str(body?.base64)
  if (!base64) return NextResponse.json({ error: 'base64 required' }, { status: 400 })
  const bytes = Buffer.from(base64, 'base64')
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) {
    return NextResponse.json({ error: 'file empty or over 8MB' }, { status: 400 })
  }
  const token = await accessTokenFor(user.email)
  if (!token) return NextResponse.json({ needAuth: true, error: 'Google Drive not connected yet' }, { status: 428 })

  const boundary = 'stayboard_' + Math.random().toString(36).slice(2)
  const meta = JSON.stringify({ name: fileName, mimeType: 'application/vnd.google-apps.presentation' })
  const head = '--' + boundary + '\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n' + meta
    + '\r\n--' + boundary + '\r\ncontent-type: application/vnd.openxmlformats-officedocument.presentationml.presentation\r\n\r\n'
  const tail = '\r\n--' + boundary + '--'
  const payload = Buffer.concat([Buffer.from(head, 'utf8'), bytes, Buffer.from(tail, 'utf8')])

  const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + token,
      'content-type': 'multipart/related; boundary=' + boundary,
    },
    body: payload as any,
  })
  const d: any = await r.json().catch(() => ({}))
  if (!r.ok || !d?.id) {
    return NextResponse.json({ error: 'Drive upload failed: ' + str(d?.error?.message || r.status) }, { status: 502 })
  }
  return NextResponse.json({ ok: true, id: d.id, link: d.webViewLink || ('https://docs.google.com/presentation/d/' + d.id) })
}
