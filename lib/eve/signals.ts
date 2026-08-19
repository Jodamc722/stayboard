// External demand + risk signals that cost nothing.
//
// I researched the paid market-data vendors before writing this (AirDNA, Key Data, Beyond,
// Wheelhouse, Transparent/Lighthouse, Mashvisor, AirROI). The honest conclusion was that PriceLabs'
// API covers ~80% of what any of them would give a 235-unit operator, and the two genuinely
// valuable things NOT in PriceLabs are both free:
//
//   1. HURRICANES. A named storm whose cone crosses South Florida is the single largest short-notice
//      revenue event in this portfolio — it cancels bookings in waves, days ahead, across every
//      building at once. NOAA/NWS and the National Hurricane Center publish this openly with no API
//      key. This is the highest-value-per-dollar signal available to this business, and it is $0.
//
//   2. EVENTS. Art Basel, F1, Ultra, Miami Open, the two boat shows. I checked: there is NO usable
//      API. Ticketmaster's terms of use forbid caching their event data for exactly this purpose,
//      and PredictHQ (the purpose-built product) is enterprise-priced. But the South Florida list is
//      SHORT, STABLE and ANNUALLY RECURRING — about twenty things. A hand-maintained table beats a
//      scraper here on accuracy, cost and legal risk. Roughly four hours of upkeep a year.
//      Stored in app_settings so Jon edits it himself without a deploy.
import 'server-only'
import { getSetting, setSetting } from '@/lib/app-settings'
import { todayET, shiftDay, lc } from './ctx'

export const EVENTS_KEY = 'sofla_events'

export type SoflaEvent = {
  name: string
  start: string            // YYYY-MM-DD
  end: string              // YYYY-MM-DD
  markets: string[]        // Miami | Broward | North
  impact: 'high' | 'medium' | 'low'
  note?: string
}

/**
 * Seed list. Dates for the CURRENT cycle only — these move year to year, which is exactly why this
 * is an editable setting and not a hardcoded constant. Anything past its end date is filtered out
 * of the "upcoming" view rather than silently reported as live.
 */
export const DEFAULT_EVENTS: SoflaEvent[] = [
  { name: 'Art Basel Miami Beach', start: '2026-12-03', end: '2026-12-06', markets: ['Miami'], impact: 'high', note: 'The single biggest rate week of the year on Miami Beach. Book minimums early.' },
  { name: 'Miami F1 Grand Prix', start: '2027-05-07', end: '2027-05-09', markets: ['Miami', 'Broward'], impact: 'high', note: 'Spills into Broward once Miami sells out.' },
  { name: 'Ultra Music Festival', start: '2027-03-26', end: '2027-03-28', markets: ['Miami'], impact: 'high', note: 'Younger crowd, higher damage risk — worth pre-staging claims evidence.' },
  { name: 'Miami Open (tennis)', start: '2027-03-17', end: '2027-03-28', markets: ['Miami'], impact: 'medium', note: 'Two-week tail, not a spike. Longer stays.' },
  { name: 'Discover Boating Miami International Boat Show', start: '2027-02-11', end: '2027-02-15', markets: ['Miami'], impact: 'high', note: "Presidents' Day weekend. High-spend, short stays." },
  { name: 'Fort Lauderdale International Boat Show', start: '2026-10-28', end: '2026-11-01', markets: ['Broward'], impact: 'high', note: 'The Broward equivalent of Art Basel for rate.' },
  { name: 'Spring Break peak', start: '2027-03-05', end: '2027-03-31', markets: ['Miami', 'Broward'], impact: 'medium', note: 'Sustained demand, elevated damage and noise risk.' },
  { name: 'Winter Music Conference', start: '2027-03-23', end: '2027-03-26', markets: ['Miami'], impact: 'medium' },
  { name: 'South Beach Wine & Food Festival', start: '2027-02-18', end: '2027-02-21', markets: ['Miami'], impact: 'medium' },
  { name: 'Formula 1 / Art Basel shoulder — holiday peak', start: '2026-12-26', end: '2027-01-02', markets: ['Miami', 'Broward', 'North'], impact: 'high', note: 'New Year week. Minimum-night rules matter more than rate here.' },
]

export async function getEvents(): Promise<SoflaEvent[]> {
  const v = await getSetting<any>(EVENTS_KEY, null)
  const list = v && typeof v === 'object' && Array.isArray(v.events) ? v.events : null
  return (list && list.length ? list : DEFAULT_EVENTS) as SoflaEvent[]
}
export async function setEvents(events: SoflaEvent[], by: string) {
  // app_settings.value is TEXT and a BARE SCALAR round-trips to the fallback — always wrap.
  return setSetting(EVENTS_KEY, { events: events.slice(0, 100) }, by)
}

export async function upcomingEvents(days = 120): Promise<{ window_days: number; events: any[]; note?: string }> {
  const all = await getEvents()
  const today = todayET()
  const until = shiftDay(today, days)
  const live = all
    .filter(e => String(e.end) >= today && String(e.start) <= until)
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))
    .map(e => ({
      ...e,
      days_away: Math.round((new Date(String(e.start) + 'T12:00:00Z').getTime() - new Date(today + 'T12:00:00Z').getTime()) / 86400000),
      in_progress: String(e.start) <= today && String(e.end) >= today,
    }))
  const stale = all.filter(e => String(e.end) < today).length
  return {
    window_days: days,
    events: live,
    note: !live.length
      ? `No events on the calendar inside ${days} days.${stale ? ` ${stale} past event(s) need their dates rolled to next year — that is a 5-minute edit on /eve.` : ''}`
      : (stale ? `${stale} event(s) on the list have passed and need next year's dates.` : undefined),
  }
}

// ---------------------------------------------------------------------------------------------
// Weather + hurricanes. api.weather.gov and the NHC feed need no key; both just want a User-Agent.
// ---------------------------------------------------------------------------------------------
const UA = 'LighthouseOps/1.0 (Stay Hospitality ops app; contact jon@stay-hospitality.com)'

/** Rough bounding box for the portfolio: Palm Beach down to South Beach. */
const PORTFOLIO_BOX = { north: 26.9, south: 25.6, west: -80.5, east: -80.0 }

export type StormRisk = {
  checked: string
  active_storms: number
  threats: any[]
  alerts: any[]
  level: 'clear' | 'watch' | 'threat'
  note: string
}

export async function stormRisk(): Promise<StormRisk> {
  const now = new Date().toISOString()
  const out: StormRisk = { checked: now, active_storms: 0, threats: [], alerts: [], level: 'clear', note: '' }

  // 1. Active tropical systems from the National Hurricane Center.
  try {
    const r = await fetch('https://www.nhc.noaa.gov/CurrentStorms.json', { headers: { 'User-Agent': UA, Accept: 'application/json' }, cache: 'no-store' })
    if (r.ok) {
      const j: any = await r.json().catch(() => ({}))
      const storms: any[] = Array.isArray(j?.activeStorms) ? j.activeStorms : []
      out.active_storms = storms.length
      for (const s of storms) {
        const lat = Number(s?.latitudeNumeric ?? s?.latitude)
        const lon = Number(s?.longitudeNumeric ?? s?.longitude)
        const basin = lc(s?.binNumber || s?.id)
        // Atlantic systems only, and only those already west of ~55W — anything further east is
        // days from being actionable and would just cry wolf.
        const relevant = /^a|al/.test(basin) && Number.isFinite(lon) && lon > -100 && lon < -40
        if (!relevant) continue
        const dLat = Number.isFinite(lat) ? Math.abs(lat - 26.2) : 99
        const dLon = Number.isFinite(lon) ? Math.abs(lon + 80.2) : 99
        const near = dLat < 12 && dLon < 20
        out.threats.push({
          name: s?.name || s?.tcType || 'Unnamed system',
          classification: s?.classification, intensity_kt: s?.intensity,
          lat, lon, movement: s?.movementDir ? `${s.movementDir}deg at ${s.movementSpeed}kt` : null,
          advisory: s?.publicAdvisory?.url || null,
          bearing_on_south_florida: near ? 'WITHIN RANGE — track this one' : 'distant',
        })
        if (near) out.level = 'threat'
      }
    }
  } catch { /* the feed being down must never break a turn */ }

  // 2. Active NWS alerts over the portfolio box (hurricane/tropical/flood watches and warnings).
  try {
    const url = `https://api.weather.gov/alerts/active?status=actual&message_type=alert`
      + `&area=FL`
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/geo+json' }, cache: 'no-store' })
    if (r.ok) {
      const j: any = await r.json().catch(() => ({}))
      const feats: any[] = Array.isArray(j?.features) ? j.features : []
      const RELEVANT = /hurricane|tropical|storm surge|flood|tornado|evacuat/i
      for (const f of feats.slice(0, 60)) {
        const p = f?.properties || {}
        if (!RELEVANT.test(String(p.event || ''))) continue
        const area = String(p.areaDesc || '')
        // Keep it to our three counties rather than the whole state.
        if (!/miami|dade|broward|palm beach|coastal/i.test(area)) continue
        out.alerts.push({ event: p.event, severity: p.severity, urgency: p.urgency, area: area.slice(0, 200), effective: p.effective, ends: p.ends, headline: String(p.headline || '').slice(0, 200) })
        if (/warning/i.test(String(p.event)) && out.level !== 'threat') out.level = 'threat'
        else if (out.level === 'clear') out.level = 'watch'
      }
    }
  } catch { /* same */ }

  out.note = out.level === 'threat'
    ? 'ACTIVE THREAT. Expect a cancellation wave within days. Get ahead of it: freeze non-essential spend, confirm which units have guests in house, and pre-draft guest comms.'
    : out.level === 'watch'
      ? 'Weather watch in effect for one or more of our counties. Worth a look, not yet a scramble.'
      : 'Nothing tropical bearing on South Florida right now.'
  return out
}

export { PORTFOLIO_BOX }
