// THE EVENT AD (2026-11-12). Jon, playing with Ad Studio on Ultra and Art Basel: "we should have more imagery
// generations to highlight the events, things going on there, promotions of it and highlight book with us" ·
// "Like Event, things to do, and then hit them with book your Stay now."
//
// Three acts, always in this order:
//   1. THE EVENT      1–2 scenes · the vibe of it (energy, crowd, art, boats) · AI image (or stock)
//   2. THINGS TO DO   2–3 scenes · real places near our listings that week (lib/ad-places THINGS_TO_DO) · AI or stock
//   3. BOOK YOUR STAY 1–2 scenes · OUR real listing photos from the event's area · ends on "Book your Stay now",
//                     the dates and stay-hospitality.com. Always 'ours' — never stock, never AI.
//
// The writer (app/api/ads/script) is told the structure (eventBrief) and its answer is forced into it
// (shapeEventScenes), so a writer that wanders still produces three acts; if the writer is unavailable, the calendar's
// own words build the same shape (eventSkeleton). Client-safe, no server imports.
import type { AdAct, AdImgSource, AdKind } from './ad-engine'
import { MOMENTS, type Moment } from './marketing-calendar'
import { AREA_LABEL, buildingsIn, thingsToDo, type AreaKey } from './ad-places'
import { EVENT_NAME_NOTE, scrubNames } from './ad-image-prompt'

export const ACT_LABEL: Record<AdAct, string> = { event: 'Event', todo: 'Things to do', book: 'Book' }
export const ACT_COLOR: Record<AdAct, string> = { event: '#A06CE0', todo: '#4CC4A8', book: '#D2B077' }
export const BOOK_ROW = 'Book at stay-hospitality.com'
const ACTS: AdAct[] = ['event', 'todo', 'book']
/** How many scenes each act may have. */
export const ACT_RANGE: Record<AdAct, [number, number]> = { event: [1, 2], todo: [2, 3], book: [1, 2] }

/** 'DEC 4–6' style dates for a moment (same as the studio's flyer date block). */
export function whenShortOf(m: Moment): string {
  const f = (iso: string) => new Date(iso + 'T12:00:00')
  const a = f(m.start), b = f(m.end)
  const mo = (d: Date) => d.toLocaleDateString('en-US', { month: 'short' })
  return a.getTime() === b.getTime() ? mo(a) + ' ' + a.getDate() : a.getMonth() === b.getMonth() ? mo(a) + ' ' + a.getDate() + '–' + b.getDate() : mo(a) + ' ' + a.getDate() + ' – ' + mo(b) + ' ' + b.getDate()
}
/** A short event name for headlines: "Art Basel", "Ultra", "Boat show". */
export function shortName(m: Moment): string {
  const map: Record<string, string> = { basel: 'Art Basel', ultra: 'Ultra', f1: 'Race week', 'boat-show-miami': 'Boat show', flibs: 'Boat show', sobewff: 'Wine & Food Festival', 'miami-open': 'Miami Open', marathon: 'Marathon weekend', nye: 'New Year’s Eve', july4: 'Fourth of July' }
  return map[m.key] || m.name
}

/** A calendar moment is an event (gets the event ad) when it is flagged so and is not owners-only. */
export const isEventMoment = (m?: Moment | null): m is Moment => !!m && !!m.event && m.audience !== 'owners'
export const eventByKey = (k?: string | null): Moment | null => { const m = MOMENTS.find(x => x.key === k); return isEventMoment(m) ? m : null }
/** "make an event ad for Ultra" → the Ultra moment. Only when the text asks for an event ad. */
export function eventAsked(text: string): Moment | null {
  const t = String(text || '')
  if (!/\bevent\s+(ad|video|spot)\b/i.test(t)) return null
  const words: [RegExp, string][] = [[/\bart\s*basel|\bbasel\b/i, 'basel'], [/\bultra\b/i, 'ultra'], [/\bformula\s*(1|one)|\bf1\b|grand\s+prix/i, 'f1'], [/\bmiami\s+open\b/i, 'miami-open'], [/sobewff|wine\s*(&|and)\s*food/i, 'sobewff'], [/fort\s+lauderdale.{0,30}boat\s+show|\bflibs\b/i, 'flibs'], [/\bboat\s+show\b/i, 'boat-show-miami'], [/\bmarathon\b/i, 'marathon'], [/new\s+year/i, 'nye'], [/fourth\s+of\s+july|july\s*4/i, 'july4']]
  for (const [re, k] of words) if (re.test(t)) return eventByKey(k)
  return null
}

/** The part of the writer's prompt that lays down the three acts. */
export function eventBrief(m: Moment, where: AreaKey[]): string {
  const when = whenShortOf(m)
  const area = where.length ? where : (m.where || [])
  const ours = buildingsIn(area)
  const todo = thingsToDo(area, 8)
  return `THIS IS AN EVENT AD for ${m.name} (${when}${m.approx ? ', dates to confirm' : ''}) — three acts, in this order, nothing else:
ACT 1 · THE EVENT (1 or 2 scenes): the vibe of the event — the energy, the crowd, the art, the boats, the night. Kinds: "cinema", "kinetic", "mask" or "event" (date block). The headline may name the event as a plain fact with its dates, e.g. "${shortName(m)} · ${when}" — NEVER "official", "partner", "presented by", "sponsor", never the event's slogan or logo, never anything implying we are connected to it. ${EVENT_NAME_NOTE}
ACT 2 · THINGS TO DO (2 or 3 scenes): one real place near our listings per scene, from this list (use the name as written; on-screen only for any name the voice would stumble on):
${todo.map(t => `- ${t.name} — ${t.what}`).join('\n')}
Kinds: "cinema", "polaroid", "panel", "callouts" or "reveal". Headlines name the place, e.g. "${todo[0] ? todo[0].what.split(' ')[0] + ' in **' + todo[0].name.replace(/^The /, '') + '**' : 'Rooftops in **Brickell**'}".
ACT 3 · BOOK YOUR STAY (1 or 2 scenes): OUR real listings in ${area.map(k => AREA_LABEL[k]).join(' and ') || 'South Florida'}${ours.length ? ` (${ours.join(', ')})` : ''}. The last scene is kind "cta", headline like "Book your **Stay** now", sub = the dates ("${when}"), items ["${BOOK_ROW}"]. A scene before it may show one of our places (kind "reveal" or "cinema", photoQuery = the property name + a subject, e.g. "${(ours[0] || 'Elser').toLowerCase()} rooftop").
EACH SCENE ALSO CARRIES:
- "act": "event" | "todo" | "book"
- "source": where its picture comes from — "ai" (an AI-generated photo) or "stock" for acts 1 and 2; ALWAYS "ours" for act 3.
- "imagePrompt" (acts 1 and 2): the picture to generate, described GENERICALLY — what is seen, the light, the mood — e.g. "a waterfront electronic music festival at night, lasers over the bay, a crowd silhouetted". NEVER the event's name, a brand, a logo, a stage design, signage, text, a real artwork or a real or famous person.
- "stockQuery" (acts 1 and 2): 2 to 4 words to search stock photos for the same picture.
- "photoQuery" (act 3 only): our photo library search, starting with one of our property names above.`
}
/** The JSON line the writer is asked for in an event ad (added after the usual reply format). */
export const EVENT_REPLY = 'For this event ad each scene object ALSO has "act", "source", "imagePrompt" and "stockQuery" as described above: {"kind": "...", "act": "event", "source": "ai", "imagePrompt": "...", "stockQuery": "...", "vo": "...", "head": "...", "sub": "...", "items": [], "photoQuery": ""}'

/** One scene as the writer (or the skeleton) hands it over, before photos. */
export type EventRawScene = { kind: AdKind | string; act: AdAct; source: AdImgSource; imagePrompt: string; stockQuery: string; vo: string; head: string; sub: string; items: string[]; photoQuery: string; badge?: string }

/** The event ad built from the calendar alone — used when the writer is not available, and to fill a missing act. */
export function eventSkeleton(m: Moment, where: AreaKey[]): EventRawScene[] {
  const when = whenShortOf(m)
  const area = where.length ? where : (m.where || [])
  const ours = buildingsIn(area)
  const todo = thingsToDo(area, 3)
  const vibe = m.vibe || []
  const place = area.map(k => AREA_LABEL[k]).join(' · ') || 'South Florida'
  const out: EventRawScene[] = [
    { kind: 'cinema', act: 'event', source: 'ai', imagePrompt: vibe[0] || '', stockQuery: m.vibeStock || m.photo, vo: '', head: m.headline, sub: shortName(m) + ' · ' + when, items: [], photoQuery: '' },
  ]
  if (vibe[1]) out.push({ kind: 'kinetic', act: 'event', source: 'ai', imagePrompt: vibe[1], stockQuery: m.vibeStock || m.photo, vo: '', head: 'The whole city **comes alive.**', sub: '', items: [], photoQuery: '' })
  const kinds = ['polaroid', 'cinema', 'panel']
  todo.forEach((t, i) => out.push({ kind: kinds[i % kinds.length], act: 'todo', source: 'ai', imagePrompt: t.visual, stockQuery: t.stock, vo: '', head: t.what.split(',')[0] + ' · **' + t.name.replace(/^The /, '') + '**', sub: place, items: [], photoQuery: '' }))
  if (ours[0]) out.push({ kind: 'reveal', act: 'book', source: 'ours', imagePrompt: '', stockQuery: '', vo: '', head: 'Stay **steps from it all.**', sub: ours[0] + ' · ' + place, items: [], photoQuery: ours[0].toLowerCase() + ' view' })
  out.push({ kind: 'cta', act: 'book', source: 'ours', imagePrompt: '', stockQuery: '', vo: '', head: 'Book your **Stay** now', sub: when, items: [BOOK_ROW], photoQuery: (ours[0] || '').toLowerCase() + ' pool' })
  return out
}

const actOf = (x: any, i: number, n: number): AdAct => (ACTS.indexOf(x?.act) >= 0 ? x.act : i >= n - 1 ? 'book' : i === 0 ? 'event' : 'todo')
const str = (v: any, n: number) => String(v ?? '').slice(0, n)

/** Forces whatever the writer returned into the three acts: grouped and ordered, each act within its range (a missing
 *  or short act is filled from the skeleton), act 3 always our photos and ending on the Book card. */
export function shapeEventScenes(raw: any[], m: Moment, where: AreaKey[]): EventRawScene[] {
  const sk = eventSkeleton(m, where)
  const rows: EventRawScene[] = (Array.isArray(raw) ? raw : []).filter(x => x && x.kind !== 'contact').map((x, i, a) => {
    const act = actOf(x, i, a.length)
    const source: AdImgSource = act === 'book' ? 'ours' : x?.source === 'stock' ? 'stock' : 'ai'
    return { kind: str(x.kind, 20), act, source, imagePrompt: act === 'book' ? '' : scrubNames(str(x.imagePrompt, 600)), stockQuery: act === 'book' ? '' : str(x.stockQuery, 60), vo: str(x.vo, 600), head: str(x.head, 300), sub: str(x.sub, 300), items: Array.isArray(x.items) ? x.items.map((y: any) => str(y, 160)) : [], photoQuery: act === 'book' ? str(x.photoQuery, 60) : '', ...(x.badge ? { badge: str(x.badge, 22) } : {}) }
  })
  const out: EventRawScene[] = []
  for (const act of ACTS) {
    const [lo, hi] = ACT_RANGE[act]
    let got = rows.filter(r => r.act === act).slice(0, hi)
    const fill = sk.filter(r => r.act === act)
    // a short act is topped up from the skeleton (the Book card last, so a writer's own reveal stays first)
    if (got.length < lo) got = act === 'book' ? got.concat(fill.slice(-1)) : got.concat(fill.slice(got.length, lo))
    // no AI prompt from the writer → the calendar's vibe / the place's picture
    got = got.map((r, i) => (r.act !== 'book' && !r.imagePrompt ? { ...r, imagePrompt: (fill[i] || fill[0] || r).imagePrompt, stockQuery: r.stockQuery || (fill[i] || fill[0] || r).stockQuery } : r))
    out.push(...got)
  }
  // the end card: the last book scene is the Book card, with the dates and the site
  const lastBook = out.length - 1
  const end = out[lastBook]
  if (end && end.act === 'book') {
    end.kind = 'cta'
    if (!end.head.trim()) end.head = 'Book your **Stay** now'
    if (!end.sub.trim()) end.sub = whenShortOf(m)
    if (!end.items.some(r => /stay-hospitality\.com/i.test(r))) end.items = [BOOK_ROW].concat(end.items.filter(Boolean)).slice(0, 2)
    if (!end.photoQuery) end.photoQuery = sk[sk.length - 1].photoQuery
  }
  return out
}
