// Open an uploaded original: GET ?path=<folder>/<file> → a 5-minute signed link. Gated by the folder.
import { NextRequest, NextResponse } from 'next/server'
import { signedUrl } from '@/lib/files/extract'
import { gateFor } from '../gate'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const path = String(req.nextUrl.searchParams.get('path') || '')
  if (!/^(eve|adam|handbook)\/[^/]+$/.test(path)) return NextResponse.json({ error: 'bad path' }, { status: 400 })
  const gate = await gateFor(path.split('/')[0], true)
  if (!gate.ok) return gate.res
  const url = await signedUrl(path)
  return url ? NextResponse.redirect(url) : NextResponse.json({ error: 'not found' }, { status: 404 })
}
