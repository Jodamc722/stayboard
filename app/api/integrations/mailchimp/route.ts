// MAILCHIMP — connect, and push the audience (Jon, 2026-09-14).
//
// The API key never comes back out of this route. GET returns publicMailchimp() and nothing else;
// the only way the key leaves the server is in the Authorization header of a call to Mailchimp.
//
// GET                                  connection status (no secret)
// POST { op:'probe', apiKey }          verify a key, list its audiences — stores nothing
// POST { op:'connect', apiKey, audienceId, audienceName, consentConfirmed }
// POST { op:'consent', on }            flip the marketing-consent declaration
// POST { op:'sync', seg?, dryRun? }    push contacts into the audience
// POST { op:'disconnect' }
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { getMailchimp, setMailchimp, publicMailchimp, probe, syncContacts, dcFromKey } from '@/lib/mailchimp'
import { loadContacts } from '@/lib/contacts-load'
import type { Contact } from '@/lib/guest-contacts'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const str = (v: any) => typeof v === 'string' ? v : (v == null ? '' : String(v))

export async function GET() {
  const gate = await requireLevel('contacts', 'view')
  if (!gate.ok) return gate.res
  const conn = await getMailchimp()
  return NextResponse.json({ ok: true, mailchimp: publicMailchimp(conn) })
}

export async function POST(req: NextRequest) {
  // Connecting an outside service and exporting the guest list are both full-access acts.
  const gate = await requireLevel('contacts', 'full')
  if (!gate.ok) return gate.res
  const actor = gate.access.email || ''
  const body = await req.json().catch(() => ({} as any))
  const op = str(body.op)

  try {
    if (op === 'probe') {
      const apiKey = str(body.apiKey).trim()
      if (!apiKey) return NextResponse.json({ ok: false, error: 'Paste your Mailchimp API key first.' }, { status: 400 })
      const info = await probe(apiKey)
      return NextResponse.json({ ok: true, ...info })
    }

    if (op === 'connect') {
      const apiKey = str(body.apiKey).trim()
      const audienceId = str(body.audienceId).trim()
      if (!apiKey || !audienceId) return NextResponse.json({ ok: false, error: 'An API key and an audience are both required.' }, { status: 400 })
      // Verified before it is stored, so a bad key can never be saved and discovered at 2am.
      const info = await probe(apiKey)
      const picked = info.audiences.find(a => a.id === audienceId)
      if (!picked) return NextResponse.json({ ok: false, error: 'That audience does not exist on this account.' }, { status: 400 })
      await setMailchimp({
        apiKey, dc: dcFromKey(apiKey), audienceId, audienceName: picked.name,
        accountName: info.accountName, connectedBy: actor, connectedAt: new Date().toISOString(),
        consentConfirmed: body.consentConfirmed === true, lastSyncAt: null, lastSyncCount: null,
      }, actor)
      return NextResponse.json({ ok: true, mailchimp: publicMailchimp(await getMailchimp()) })
    }

    if (op === 'consent') {
      const conn = await getMailchimp()
      if (!conn) return NextResponse.json({ ok: false, error: 'Mailchimp is not connected.' }, { status: 400 })
      await setMailchimp({ ...conn, consentConfirmed: body.on === true }, actor)
      return NextResponse.json({ ok: true, mailchimp: publicMailchimp(await getMailchimp()) })
    }

    if (op === 'disconnect') {
      await setMailchimp(null, actor)
      return NextResponse.json({ ok: true, mailchimp: { connected: false } })
    }

    if (op === 'sync') {
      const conn = await getMailchimp()
      if (!conn) return NextResponse.json({ ok: false, error: 'Connect Mailchimp first.' }, { status: 400 })
      const { contacts } = await loadContacts()
      const seg = str(body.seg)
      const pick = (c: Contact) =>
        seg === 'direct' ? c.everDirect
        : seg === 'repeat' ? c.stays >= 2
        : seg === 'vip' ? c.vip
        : true
      const result = await syncContacts(conn, contacts.filter(pick), { dryRun: body.dryRun === true })
      if (body.dryRun !== true) {
        await setMailchimp({
          ...conn, lastSyncAt: new Date().toISOString(),
          lastSyncCount: result.created + result.updated,
        }, actor)
      }
      return NextResponse.json({ ok: true, result, mailchimp: publicMailchimp(await getMailchimp()) })
    }

    return NextResponse.json({ ok: false, error: 'Unknown operation.' }, { status: 400 })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: str(e?.message || e).slice(0, 300) }, { status: 500 })
  }
}
