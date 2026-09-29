// UPLOAD A FILE FOR AN AGENT (lib/files/extract). multipart { file, for: 'eve' | 'adam' | 'handbook' }
// → { text, words, method, path, name }. The caller files the text (Eve's library, Adam's files,
// or a handbook entry); the original stays in the private agent-files bucket.
//   eve       admins (Eve's written policy is admin-only)
//   adam      hotel role with edit on Adam
//   handbook  hotel role with edit on the Handbook
import { NextRequest, NextResponse } from 'next/server'
import { extractFile } from '@/lib/files/extract'
import { gateFor } from '../gate'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const form = await req.formData().catch(() => null)
  const who = String(form?.get('for') || '')
  const gate = await gateFor(who)
  if (!gate.ok) return gate.res
  const file = form?.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 })
  const out = await extractFile(file, who)
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: 400 })
  return NextResponse.json(out)
}
