// Eve — Stay Hospitality's operating brain. This route is now only the DOOR: it checks who is
// knocking and hands the question to the one shared agent loop in lib/eve/run.ts.
//
// WHAT CHANGED IN v2 (2026-08-19):
//   ACCESS  — the hardcoded `email !== jon@` check is gone. Eve is now a real feature key, so she is
//             owner + admin by default and can be switched on for any role from /users -> Roles
//             without a code change.
//   REACH   — 13 tools over 6 tables became 48 tools over ~38, split into domains that load on
//             demand (lib/eve/registry.ts explains why that beats handing her all 48 at once).
//   MEMORY  — what she learns survives the conversation (lib/eve/memory.ts).
//   LOGGING — every exchange lands in eve_chats with the tools she used, so a thumbs-down can be
//             turned into a correction instead of evaporating.
//
// 2026-08-25 — THE LOOP MOVED OUT. Telegram needed the same brain (Jon: "add eve to telegram so i
// can ask questions directly there"), and the one thing this app has already paid for twice is a
// second copy of Eve drifting away from the first. So the loop lives in lib/eve/run.ts and both
// surfaces call it. Everything above still holds — it just is not written here any more.
import { NextRequest, NextResponse } from 'next/server'
import { getAccess } from '@/lib/access'
import { runEve, canUseEve } from '@/lib/eve/run'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** Eve is owner + admin by default; a role can be granted `eve` explicitly from /users. */
export async function eveGate() {
  const access = await getAccess()
  if (!access.user) return { ok: false as const, res: NextResponse.json({ error: 'unauthorized' }, { status: 401 }), access }
  if (!access.allowed) return { ok: false as const, res: NextResponse.json({ error: 'no-access' }, { status: 403 }), access }
  if (!canUseEve(access)) {
    return { ok: false as const, res: NextResponse.json({ error: 'forbidden', message: 'Eve is available to admins. Ask Jon to switch her on for your role.' }, { status: 403 }), access }
  }
  return { ok: true as const, access }
}

export async function POST(req: NextRequest) {
  const gate = await eveGate()
  if (!gate.ok) return gate.res

  const body = await req.json().catch(() => ({} as any))
  const messages = Array.isArray(body?.messages) ? body.messages : []
  const domains = Array.isArray(body?.domains) ? body.domains : []

  const out = await runEve({ access: gate.access, messages, domains, source: 'web' })
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status })
  return NextResponse.json({ reply: out.reply, chatId: out.chatId, meta: out.meta })
}
