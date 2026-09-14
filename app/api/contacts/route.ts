// CONTACTS — the mailing list (Jon, 2026-09-14).
//
// /guests answers "who is this person at my front desk?". This answers a different question:
// "who can I email, and what do I know about them that would make the email worth sending?"
// Same people, same key, same profile layer — a different shape, and one extra job: deciding
// which addresses are real. See lib/guest-contacts.ts for why that decision matters.
//
// GET                     the list + the audience summary
// GET ?format=csv         the same rows as a file (mailable only unless ?all=1)
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel } from '@/lib/access'
import { audienceSummary, type Contact } from '@/lib/guest-contacts'
import { loadContacts } from '@/lib/contacts-load'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const str = (v: any) => typeof v === 'string' ? v : (v == null ? '' : String(v))
const ymdET = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

function matches(c: Contact, q: string): boolean {
  if (!q) return true
  return (c.name + ' ' + (c.email || '') + ' ' + (c.phone || '') + ' ' + c.units.join(' ') + ' ' + c.tags.join(' ') + ' ' + c.channel)
    .toLowerCase().includes(q)
}

/** RFC 4180 — a guest called O'Brien, "Bob" must not shear the file in half. */
function csv(rows: (string | number | null)[][]): string {
  return rows.map(r => r.map(v => {
    const s = v == null ? '' : String(v)
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }).join(',')).join('\r\n')
}

export async function GET(req: NextRequest) {
  const gate = await requireLevel('contacts', 'view')
  if (!gate.ok) return gate.res

  const sp = req.nextUrl.searchParams
  const q = str(sp.get('q')).trim().toLowerCase()
  const seg = str(sp.get('seg')).trim()          // mailable | direct | ota | repeat | vip | relay
  const wantCsv = str(sp.get('format')) === 'csv'

  let all: Contact[]
  let truncated = false
  try {
    const r = await loadContacts()
    all = r.contacts
    truncated = r.truncated
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: str(e?.message || e).slice(0, 300) }, { status: 500 })
  }

  const inSeg = (c: Contact) =>
    seg === 'mailable' ? c.mail === 'mailable'
    : seg === 'relay' ? c.mail === 'relay'
    : seg === 'direct' ? c.everDirect
    : seg === 'ota' ? c.family === 'ota'
    : seg === 'repeat' ? c.stays >= 2
    : seg === 'vip' ? c.vip
    : true

  const picked = all.filter(c => inSeg(c) && matches(c, q))

  if (wantCsv) {
    // The export defaults to what you may actually mail. ?all=1 gives everything, relays included,
    // clearly labelled — for a support lookup, not for an upload.
    const rows = str(sp.get('all')) === '1' ? picked : picked.filter(c => c.mail === 'mailable')
    const head = ['First name', 'Last name', 'Email', 'Mailable', 'Why not', 'Phone', 'Last channel', 'Every channel',
      'Booked direct before', 'Stays', 'Nights', 'Lifetime value', 'First stay', 'Last stay', 'Next stay',
      'Last unit', 'Last building', 'All units', 'Reviews left', 'Average rating', 'VIP', 'Tags']
    const body = rows.map(c => [
      c.first, c.last, c.email || '', c.mail === 'mailable' ? 'yes' : 'no', c.mail === 'mailable' ? '' : c.mailReason,
      c.phone || '', c.channel, c.channels.join(' | '), c.everDirect ? 'yes' : 'no',
      c.stays, c.nights, Math.round(c.value), c.firstStay, c.lastStay, c.nextStay || '',
      c.lastUnit, c.lastBuilding || '', c.units.join(' | '), c.reviews, c.reviewAvg ?? '', c.vip ? 'yes' : 'no', c.tags.join(' | '),
    ])
    const name = 'contacts-' + ymdET(new Date()) + (seg ? '-' + seg : '') + '.csv'
    return new NextResponse('﻿' + csv([head, ...body]), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="' + name + '"',
      },
    })
  }

  return NextResponse.json({
    ok: true,
    q, seg, truncated,
    summary: audienceSummary(all),
    shown: picked.length,
    contacts: picked.slice(0, q || seg ? 1000 : 500),
  })
}
