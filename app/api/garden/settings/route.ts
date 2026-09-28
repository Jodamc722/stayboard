// GARDEN HOTEL SETTINGS — hotel profile, voice, phone. GET for anyone on the hotel; PUT owner-only.
//   GET                       → { hotel, voice, phone, phoneStatus }
//   PUT { hotel? | voice? | phone? }
import { NextRequest, NextResponse } from 'next/server'
import { requireLevel, requireAdmin } from '@/lib/access'
import { getHotel, getVoice, getPhone, saveHotel, saveVoice, savePhone } from '@/lib/garden/settings'
import { ADAPTERS } from '@/lib/garden/phone'

export const dynamic = 'force-dynamic'

export async function GET() {
  const gate = await requireLevel('garden', 'view')
  if (!gate.ok) return gate.res
  const [hotel, voice, phone] = await Promise.all([getHotel(), getVoice(), getPhone()])
  const ad = ADAPTERS[phone.provider]
  const configured = ad ? await ad.configured().catch(() => false) : false
  return NextResponse.json({ ok: true, hotel, voice, phone: { ...phone, webhookToken: phone.webhookToken ? '•••' + phone.webhookToken.slice(-4) : null }, phoneStatus: { configured, hasToken: !!phone.webhookToken } })
}

export async function PUT(req: NextRequest) {
  const gate = await requireAdmin('owner')
  if (!gate.ok) return gate.res
  const b = await req.json().catch(() => ({}))
  const by = gate.access.email || 'owner'
  if (b?.hotel && typeof b.hotel === 'object') await saveHotel(b.hotel, by)
  if (b?.voice && typeof b.voice === 'object') await saveVoice(b.voice, by)
  if (b?.phone && typeof b.phone === 'object') {
    const p = { ...b.phone }
    if (p.numbers && !Array.isArray(p.numbers)) p.numbers = String(p.numbers).split(/[,\s]+/).filter(Boolean)
    if (p.rotateToken) { p.webhookToken = Array.from({ length: 32 }, () => 'abcdefghjkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 31)]).join(''); delete p.rotateToken }
    else delete p.webhookToken
    await savePhone(p, by)
  }
  const [hotel, voice, phone] = await Promise.all([getHotel(), getVoice(), getPhone()])
  return NextResponse.json({ ok: true, hotel, voice, phone: { ...phone, webhookToken: phone.webhookToken ? '•••' + phone.webhookToken.slice(-4) : null }, newToken: b?.phone?.rotateToken ? phone.webhookToken : undefined })
}
