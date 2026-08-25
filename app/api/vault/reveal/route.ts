// REVEAL ONE SECRET — the only endpoint in the app that returns vault plaintext.
//
// It is deliberately its own route, POST-only, one item at a time, and it always writes an audit
// row BEFORE it answers. Reading a secret is an event, not a side effect of loading a page:
//   - POST, so it can never be triggered by a link, an <img>, a prefetch or browser history.
//   - One id per call, so "who saw what, when" has a single unambiguous answer.
//   - no-store, so the plaintext is not sitting in a disk cache afterwards.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess, isSuperadmin } from '@/lib/access'
import { supabaseAdmin } from '@/lib/supabase-admin'
import {
  ITEMS, accessFor, decryptSecret, logAccess, vaultKeyReady, checkVaultCode, codeFrom, codeEntered,
  unlockValid, UNLOCK_COOKIE,
} from '@/lib/vault'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

const ipOf = (req: NextRequest) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null

export async function POST(req: NextRequest) {
  const access = await getAccess()
  if (!access.allowed) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const me = String(access.email || '')

  const b = await req.json().catch(() => ({} as any))
  const id = String(b?.id || '').trim()
  // Why someone is opening a credential is worth capturing while they are already thinking about it.
  const reason = String(b?.reason || '').trim().slice(0, 200)
  if (!id) return NextResponse.json({ ok: false, error: 'Which item?' }, { status: 400 })
  if (!vaultKeyReady()) return NextResponse.json({ ok: false, error: 'VAULT_KEY is not set on the server, so nothing can be decrypted.' }, { status: 503 })

  try {
    const db = supabaseAdmin()
    const { data: item } = await db.from(ITEMS)
      .select('id, owner_email, collection_id, title, secret_cipher').eq('id', id).is('deleted_at', null).maybeSingle()
    if (!item) return NextResponse.json({ ok: false, error: 'That item no longer exists.' }, { status: 404 })

    const level = await accessFor(item as any, me, isSuperadmin(access.email), { accessRole: access.accessRole })
    if (!level) {
      // A refused attempt is the single most interesting line in the log. Record it first.
      await logAccess({ itemId: id, email: me, action: 'denied', detail: 'reveal', ip: ipOf(req) })
      return NextResponse.json({ ok: false, error: 'You do not have access to this item.' }, { status: 403 })
    }
    if (!(item as any).secret_cipher) return NextResponse.json({ ok: false, error: 'This item has no stored secret.' }, { status: 404 })

    // THE CODE, or an open window (Jon, 2026-08-25: "give us 1 min, still have to click reveal,
    // that how we can track"). Either way this is a deliberate per-item click and it gets its own
    // audit row — the window changes how often you type, never what is recorded.
    const open = unlockValid(req.cookies.get(UNLOCK_COOKIE)?.value, me)
    if (!open) {
      const gate = await checkVaultCode({ code: codeFrom(req, b), email: me, ip: ipOf(req), itemId: id, purpose: 'reveal' })
      if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error, codeUnset: !!gate.codeUnset, wrongCode: !!gate.wrongCode, locked: true }, { status: gate.status })
    }

    // Log BEFORE answering: if the response never arrives, the attempt still happened.
    await logAccess({ itemId: id, email: me, action: 'reveal', detail: open ? 'in unlock window' + (reason ? ' · ' + reason : '') : codeEntered(reason), ip: ipOf(req) })

    let secret: string
    try {
      secret = decryptSecret(String((item as any).secret_cipher))
    } catch {
      // Wrong key or tampered ciphertext. Say so plainly — a vault that returns garbage that looks
      // like a password is how someone locks themselves out of a building at 11pm.
      return NextResponse.json({
        ok: false,
        error: 'That secret could not be decrypted. If VAULT_KEY was changed, items stored under the old key must be re-entered.',
      }, { status: 500 })
    }

    return new NextResponse(JSON.stringify({ ok: true, secret }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, max-age=0' },
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 })
  }
}
