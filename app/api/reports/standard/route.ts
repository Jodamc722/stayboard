// MAKE THIS DECK THE STANDARD (Jon, 2026-09-24: "lock in this format and wording as the new
// standard — the 602, 902 and 302 one").
//
// POST { id }  → copy the deck's house copy into the onboarding template, so every deck generated
//                from now on starts exactly like it: headlines and subtitles per section, the
//                pitch bodies and rows, the agenda, the property pictures, the channels, the
//                checklist, the on-the-call questions, and which sections are shown.
// GET          → what the standard was taken from, if anything.
//
// WHAT IS DELIBERATELY NOT COPIED: anything about THAT owner — the welcome subtitle (their name),
// the listing cards, the unit walk, the go-live date, the hero photo, the owner portal login, the
// team's market filter, the notes. A standard is the wording, not the customer.
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { requireLevel } from '@/lib/access'
import { getSetting, setSetting } from '@/lib/app-settings'
import { ONBOARDING_TEMPLATE_KEY } from '@/lib/onboarding-report'

export const dynamic = 'force-dynamic'

const str = (v: any) => (typeof v === 'string' ? v : '')
const arr = (v: any) => (Array.isArray(v) ? v : null)
const has = (v: any) => (Array.isArray(v) ? v.length > 0 : typeof v === 'string' ? v.trim().length > 0 : v != null)

export async function GET() {
  const g = await requireLevel('reports', 'view')
  if (!g.ok) return g.res
  const t = (await getSetting<any>(ONBOARDING_TEMPLATE_KEY, {}).catch(() => ({}))) || {}
  return NextResponse.json({ ok: true, standardFrom: t.standardFrom || null })
}

export async function POST(req: NextRequest) {
  const g = await requireLevel('reports', 'full')
  if (!g.ok) return g.res
  const b = await req.json().catch(() => ({}))
  const id = str(b?.id)
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const db = supabaseAdmin()
  const { data: rep, error } = await db.from('owner_reports').select('id,title,content').eq('id', id).maybeSingle()
  if (error || !rep) return NextResponse.json({ error: 'report not found' }, { status: 404 })
  const c: any = (rep as any).content || {}
  const sec = (k: string): any => (c[k] && typeof c[k] === 'object') ? c[k] : {}

  let tpl: any = {}
  try { tpl = (await getSetting<any>(ONBOARDING_TEMPLATE_KEY, {})) || {} } catch { tpl = {} }
  const next: any = { ...tpl }
  const put = (field: string, v: any) => { if (has(v)) next[field] = v }

  // Headlines and subtitles, per section, for everything that has them.
  const heads: Record<string, { headline?: string; subtitle?: string }> = { ...(tpl.heads || {}) }
  const HEAD_SECTIONS = ['welcome', 'agenda', 'overview', 'experience', 'craft', 'channels', 'guestcare', 'revenue', 'stack', 'listings', 'season', 'ramp', 'rampsteps', 'guesty', 'statement', 'checklist', 'notes', 'comms', 'tech', 'money', 'strategy', 'ai']
  for (const k of HEAD_SECTIONS) {
    const s = sec(k); if (!Object.keys(s).length) continue
    const h: { headline?: string; subtitle?: string } = {}
    if (has(s.headline)) h.headline = str(s.headline)
    // The welcome subtitle is the owner's name; never part of the standard.
    if (k !== 'welcome' && typeof s.subtitle === 'string') h.subtitle = s.subtitle
    if (Object.keys(h).length) heads[k] = h
  }
  next.heads = heads

  put('welcomeBody', str(sec('welcome').body))
  put('agenda', arr(sec('agenda').items))
  put('overviewBody', str(sec('overview').body)); put('companyStats', arr(sec('overview').stats))
  // The pitch.
  put('experienceBody', str(sec('experience').body))
  if (typeof sec('experience').intro === 'string') next.experienceIntro = sec('experience').intro
  const items = arr(sec('experience').items)
  if (items) {
    put('experienceItems', items.map((it: any) => ({ k: str(it.k), v: str(it.v), b: it.b || undefined })))
    // Pictures chosen on this deck become the pictures for every deck.
    const pics: Record<string, string> = { ...(tpl.propertyPics || {}) }
    for (const it of items) if (it && (it.b || it.k) && has(it.pic)) pics[String(it.b || it.k)] = String(it.pic)
    next.propertyPics = pics
  }
  put('experienceProof', arr(sec('experience').proof))
  put('craftBody', str(sec('craft').body)); put('craftRows', arr(sec('craft').rows))
  put('guestBody', str(sec('guestcare').body)); put('guestStages', arr(sec('guestcare').stages)); put('guestBreezeway', str(sec('guestcare').note))
  put('revenueBody', str(sec('revenue').body)); put('revenueLevers', arr(sec('revenue').rows)); put('revenueNote', str(sec('revenue').note))
  put('revenuePartnerHead', str(sec('revenue').partnerHead)); put('revenuePartner', arr(sec('revenue').partner)); put('revenuePartnerGroups', arr(sec('revenue').partnerGroups)); put('revenuePartnerLogo', str(sec('revenue').partnerLogo))
  if (typeof sec('revenue').partnerIntro === 'string') next.revenuePartnerIntro = sec('revenue').partnerIntro
  put('rampActions', arr(sec('rampsteps').rows)); put('rampActionsNote', str(sec('rampsteps').note))
  put('stackBody', str(sec('stack').body)); put('stackTools', arr(sec('stack').tools)); put('stackChannels', arr(sec('stack').rows)); put('stackNote', str(sec('stack').note))
  // Channels, season, ramp, portal, comms, money, statement, checklist.
  put('channelsBody', str(sec('channels').subtitle) || str(sec('channels').body))
  put('channelsPrimary', arr(sec('channels').primary)); put('channelsMore', arr(sec('channels').more)); put('channelsCount', str(sec('channels').count)); put('channelsLogos', arr(sec('channels').logos))
  put('strategyBody', str(sec('strategy').body))
  put('rampBands', arr(sec('ramp').bands)); put('rampNote', str(sec('ramp').note))
  put('seasonBody', str(sec('season').body)); put('peakShare', str(sec('season').peakShare)); put('peakLabel', str(sec('season').peakLabel)); put('seasonLowNote', str(sec('season').lowNote))
  put('commsBody', str(sec('comms').body)); put('commsRows', arr(sec('comms').rows))
  put('guestyBody', str(sec('guesty').body)); put('portalItems', arr(sec('guesty').items)); put('portalShots', arr(sec('guesty').shots))
  put('techRows', arr(sec('tech').rows))
  put('moneyBody', str(sec('money').body)); put('moneyRules', arr(sec('money').rules))
  put('statementAlso', arr(sec('statement').also))
  put('checklist', arr(sec('checklist').rows))
  const support = sec('team').support || {}
  put('supportLabel', str(support.label)); put('supportNote', str(support.note)); put('supportEmail', str(support.email))
  // The on-the-call questions, per section.
  const asks: Record<string, any[]> = { ...(tpl.asks || {}) }
  for (const k of Object.keys(c)) { const a = c[k]?.asks; if (Array.isArray(a)) asks[k] = a }
  next.asks = asks
  // The format: which sections this deck shows.
  if (Array.isArray(c.omit)) next.omit = c.omit.map(String)

  next.standardFrom = { id, title: str((rep as any).title), by: g.access.email || null, at: new Date().toISOString() }
  const res = await setSetting(ONBOARDING_TEMPLATE_KEY, next, g.access.email || null)
  if (res && (res as any).ok === false) return NextResponse.json({ error: (res as any).error || 'could not save' }, { status: 500 })
  return NextResponse.json({ ok: true, standardFrom: next.standardFrom, sections: Object.keys(heads).length })
}
