// THE SALES DECK — one generated document per prospect (Jon, 2026-10-27: "build a sales deck for
// Nick... the goal is that he can customize a deck for an individual owner or building developer...
// be able to customize it and generate new sales decks for different owners").
//
// IT IS AN OWNER REPORT, WHICH IS THE WHOLE TRICK. Rather than a new document engine, a sales deck
// is an `owner_reports` row like any other, so on the day it ships it already has: a /r/<code>
// share link to send, PDF and PowerPoint export, Present mode, the inline editor where every word,
// figure and photograph is changeable, themes, slide reordering, add-a-slide and photo pickers.
// Jon asked for printable, linkable and customizable; all three were already built, and what was
// missing was only the words and the slides.
//
// WHAT IT BORROWS. The pitch half — the company, the properties, the process, the guest
// experience, revenue and Pacer, the ramp, the technology stack, the worked statement — is the
// onboarding deck's, generated through buildOnboardingContent so there is exactly one copy of it
// in the building. Improving a sentence for onboarding improves it here on the next generate.
//
// WHAT IT ADDS (lib/sales-copy): the person presenting it, how operations actually works,
// marketing, distribution, direct bookings, a tour of Lighthouse, onboarding from the owner's
// side, HostGPO, their own market, an embedded video and the close.
//
// WHAT IT DROPS. Everything written for someone who has already signed: the unit questionnaire,
// the agreed strategy, the internal who-does-what checklist, the call notes. A prospect is being
// asked to decide, not to answer.
import { buildOnboardingContent, type OnboardingContent, type OnboardingTemplate, type ListingCard, type KV } from './onboarding-report'
import {
  CONTACT_HEADLINE, CONTACT_SUBTITLE, CONTACT_BODY, CONTACT_DEFAULT, type ContactCard,
  OPS_HEADLINE, OPS_SUBTITLE, OPS_BODY, OPS_ROWS, OPS_NOTE,
  MARKETING_HEADLINE, MARKETING_SUBTITLE, MARKETING_BODY, MARKETING_ROWS,
  DIST_HEADLINE, DIST_SUBTITLE, DIST_BODY, DIST_ROWS,
  DIRECT_HEADLINE, DIRECT_SUBTITLE, DIRECT_BODY, DIRECT_ROWS, DIRECT_NOTE,
  LH_HEADLINE, LH_SUBTITLE, LH_BODY, LH_ROWS, LH_NOTE,
  ONB_HEADLINE, ONB_SUBTITLE, ONB_BODY, ONB_STEPS, ONB_NOTE, type Step,
  GPO_HEADLINE, GPO_SUBTITLE, GPO_BODY, GPO_ROWS, GPO_NOTE,
  MARKET_HEADLINE, MARKET_SUBTITLE, MARKET_PROMPTS,
  RETURNS_HEADLINE, RETURNS_SUBTITLE, RETURNS_BODY, RETURNS_NOTE,
  PROPERTY_HEADLINE, PROPERTY_SUBTITLE, PROPERTY_BODY, PROPERTY_FACTS,
  CLOSE_HEADLINE, CLOSE_SUBTITLE, CLOSE_ROWS, CLOSE_NOTE,
  VIDEO_HEADLINE, VIDEO_SUBTITLE, VIDEO_BODY,
  SALES_AGENDA, shortOmit, SALES_HERO, SALES_WELCOME,
  MAXREV_HEADLINE, MAXREV_SUBTITLE, MAXREV_BODY, MAXREV_ROWS, MAXREV_NOTE,
  TERMS_HEADLINE, TERMS_SUBTITLE, termRows, TERMS_NOTE, type TermRow,
  PROOF_HEADLINE, PROOF_SUBTITLE, PROOF_BODY, PROOF_NOTE,
  PLAN_HEADLINE, PLAN_SUBTITLE, PLAN_BODY, PLAN_NOTE,
  COMPS_HEADLINE, COMPS_SUBTITLE, COMPS_BODY, COMPS_NOTE,
} from './sales-copy'

/** The sales-only sections, laid over an onboarding document. Every one is optional, so an
 *  onboarding deck generated before today renders exactly as it did — the slides are gated on the
 *  section being present, not on the document's kind. */
/** The measured half of the market slide. Mirrors lib/sales-market's MarketIntel, minus the
 *  fields only the builder needs, so the client never imports a server-only module. */
export type MarketIntelLite = {
  label: string; units: number; basis: 'size' | 'market'; bedrooms: number | null
  window: string; occ: string; adr: string; revpar: string; grossPerUnit: string
  months: { label: string; iso: string; occPct: number; adr: string; peak?: boolean }[]
  peakLabel: string; lowLabel: string
}

export type SalesSections = {
  contact?: { headline: string; subtitle: string; body: string; card: ContactCard }
  ops?: { headline: string; subtitle: string; body: string; rows: KV[]; note: string; photo?: string }
  marketing?: { headline: string; subtitle: string; body: string; rows: KV[]; photo?: string }
  dist?: { headline: string; subtitle: string; body: string; rows: KV[] }
  direct?: { headline: string; subtitle: string; body: string; rows: KV[]; note: string }
  lighthouse?: { headline: string; subtitle: string; body: string; rows: KV[]; note: string; shots?: string[] }
  onbsteps?: { headline: string; subtitle: string; body: string; steps: Step[]; note: string }
  gpo?: { headline: string; subtitle: string; body: string; rows: KV[]; note: string }
  /** Their property: what we were told about it, and pictures of it. */
  property?: {
    headline: string; subtitle: string; body: string
    facts: KV[]
    photos: string[]
  }
  /**
   * Their market, built from OUR book in it — see lib/sales-market. `intel` is the measured half
   * and never invented; `rows` is the local knowledge a person adds. Either half can stand alone,
   * and with neither the slide does not print.
   */
  market?: {
    headline: string; subtitle: string; rows: KV[]; photo?: string
    intel?: MarketIntelLite | null
  }
  /** The short deck's one revenue slide; the full deck argues it across five. */
  maxrev?: { headline: string; subtitle: string; body: string; rows: KV[]; note: string }
  /** Management terms. Figures we hold are printed; the ones we do not are empty prompts. */
  terms?: { headline: string; subtitle: string; rows: TermRow[]; note: string }
  /**
   * What comparable properties actually earned. REVENUE ONLY — gross and net of channel fees —
   * and never an expense line; see lib/sales-copy and /api/reports/proof for why that is a rule
   * rather than a setting. Empty until someone pulls it, and an empty one does not print.
   */
  proof?: {
    headline: string; subtitle: string; body: string; note: string
    scope: string; window: string; names: boolean
    /** 'statements' = real owner revenue off the completed statements; 'bookings' = the mirror. */
    source?: 'statements' | 'bookings'
    rows: { label: string; sub: string; gross: string; net: string; occ: string; adr: string; nights: string }[]
    totals?: { gross: string; net: string; occ: string; adr: string; nights: string }
  }
  /**
   * What the buildings we run actually earn. Buildings, never owners — see lib/sales-copy. Empty
   * until someone pulls it, and an empty one does not print.
   */
  returns?: {
    headline: string; subtitle: string; body: string; note: string; window: string
    rows: { building: string; market: string; units: number; bedrooms: string; gross: string; perUnit: string; occ: string; adr: string; nights: string }[]
  }
  /**
   * The projection, in the shape of the one-pager the team already sends: a range, the rate and
   * occupancy behind it, and twelve months of base/high. `cols`/`rows` is the generic table a
   * model-built or hand-pasted projection still uses, and either half renders on its own.
   */
  plan?: {
    headline: string; subtitle: string; body: string; note: string; source?: string
    /** Every figure as printed, so nothing is re-derived at render time. */
    range?: {
      annualLow: string; annualHigh: string
      monthlyLow: string; monthlyHigh: string
      rateLow: string; rateHigh: string
      occLow: string; occHigh: string
    } | null
    months?: { label: string; base: string; high: string; rate: string; occ: string; baseNum?: number; highNum?: number }[]
    cols: string[]
    rows: { k: string; cells: string[] }[]
    totals?: { k: string; cells: string[] }
  }
  /** The comparable listings, hand-gathered and pasted — there is no comp feed in this system. */
  comps?: {
    headline: string; subtitle: string; body: string; note: string
    rows: { name: string; rev: string; rate: string; occ: string; beds: string; baths: string; rating: string }[]
  }
  close?: { headline: string; subtitle: string; rows: KV[]; note: string }
  /** Empty url = no slide, so an unfinished video never shows a prospect a grey box. */
  video?: { headline: string; subtitle: string; body: string; url: string; poster?: string }
}

export type SalesLength = 'short' | 'full'

export type SalesContent = Omit<OnboardingContent, 'meta'> & SalesSections & {
  meta: Omit<OnboardingContent['meta'], 'kind'> & {
    kind: 'sales'; prospect?: string; presenter?: string
    length?: SalesLength
    /** The short list in force when this deck was generated. */
    shortHidden?: string[]
  }
}

export type SalesInput = {
  /** 'short' is the deck you send to get a second conversation; 'full' is the one you present. */
  length?: SalesLength
  scopeLabel: string
  asOf: string
  market: string
  /** Who the deck is for — an owner's name, a developer, a building. */
  ownerName: string
  ownerEmail?: string
  ownerPhone?: string
  cards: ListingCard[]
  heroImage: string | null
  /** The person presenting. Carried on meta so the next deck can be seeded from the last one. */
  contact?: Partial<ContactCard>
  /** What the desk asked about the property before generating. */
  intake?: {
    address?: string; building?: string; kind?: string; units?: string
    bedrooms?: string; baths?: string; sleeps?: string; beds?: string
    furnished?: string; goal?: string
  }
  /** Their market, measured from our own book (lib/sales-market). */
  intel?: MarketIntelLite | null
  photos?: string[]
}

/** Sections written for someone who has already signed. A prospect is deciding, not answering. */
/** The four lines on the property slide, from what the desk was told. Blank in, blank out. */
function propertyFacts(x: NonNullable<SalesInput['intake']>): KV[] {
  const n = (v?: string) => String(v || '').trim()
  const unit = [
    n(x.bedrooms) ? (Number(n(x.bedrooms)) === 0 ? 'Studio' : n(x.bedrooms) + ' bed') : '',
    n(x.baths) ? n(x.baths) + ' bath' : '',
    n(x.sleeps) ? 'sleeps ' + n(x.sleeps) : '',
    n(x.beds),
  ].filter(Boolean).join(' · ')
  const building = [n(x.building), n(x.kind), n(x.units) && Number(n(x.units)) > 1 ? n(x.units) + ' units' : ''].filter(Boolean).join(' · ')
  const facts = PROPERTY_FACTS.map(r => ({ ...r }))
  const set = (k: string, v: string) => { const f = facts.find(f => f.k === k); if (f && v) f.v = v }
  set('The unit', unit)
  set('The building', building)
  set('Where it is', n(x.address))
  set('What it sells', n(x.goal))
  return facts
}

const SALES_OMIT = ['unit', 'strategy', 'listings', 'checklist', 'notes', 'linens', 'nextup', 'comms', 'tech']



export function buildSalesContent(t: OnboardingTemplate, i: SalesInput): SalesContent {
  const base = buildOnboardingContent(t, {
    scopeLabel: i.scopeLabel,
    asOf: i.asOf,
    market: i.market,
    ownerName: i.ownerName,
    ownerEmail: i.ownerEmail || '',
    ownerPhone: i.ownerPhone || '',
    goLive: '',
    cards: i.cards,
    unitLine: '',
    unitFacts: [],
    bedrooms: null,
    heroImage: i.heroImage,
    amenityCatalog: [],
    linens: null,
  })
  const pool: string[] = Array.isArray(base.photoPool) ? base.photoPool : []
  const pic = (n: number) => (pool.length ? pool[n % pool.length] : '')
  // SPREAD COPIES UNDEFINED, WHICH IS HOW THE JOB TITLE DISAPPEARED (2026-10-27). The desk sends
  // { name } only, and `{...DEFAULT, ...{role: undefined}}` overwrites the default role with
  // undefined rather than keeping it. Only keys that actually carry a value get to win.
  const given: Record<string, string> = {}
  for (const [k, v] of Object.entries(i.contact || {})) if (typeof v === 'string' && v.trim()) given[k] = v
  const card: ContactCard = { ...CONTACT_DEFAULT, ...given }

  // SHORT BY DEFAULT (Jon, 2026-10-27). The deck that gets sent is the one that has to earn a
  // second conversation; the long one is for the meeting it earns. Switching between them in the
  // editor only moves keys in and out of this list, so an edited slide keeps its edit either way.
  const omit = Array.from(new Set(
    (Array.isArray(base.omit) ? base.omit : [])
      .concat(SALES_OMIT)
      .concat(i.length === 'full' ? [] : shortOmit()),
  ))

  return {
    ...base,
    // The short list this deck was built with, so a later widening of it can reach this deck —
    // see SHORT_HIDDEN_HISTORY in lib/sales-copy.
    meta: {
      ...base.meta, kind: 'sales', prospect: i.ownerName, presenter: card.name,
      length: i.length === 'full' ? 'full' : 'short',
      shortHidden: i.length === 'full' ? [] : shortOmit(),
    },
    hero: {
      ...base.hero,
      dateLabel: 'MANAGEMENT PROPOSAL',
      title: i.scopeLabel,
      // THE SPINE OF THE DECK, IN ONE LINE (Jon, 2026-10-27: "how we manage revenue, tools and
      // team around the success of your property"). Everything after the cover is one of those
      // three, and the cover says so, so a prospect knows what they are being shown.
      headline: SALES_HERO,
      preparedFor: i.ownerName ? 'Prepared for ' + i.ownerName : 'Prepared for the owners of ' + i.scopeLabel,
    },
    welcome: {
      ...base.welcome,
      headline: 'Thank you for your time',
      subtitle: i.ownerName || i.scopeLabel,
      body: SALES_WELCOME,
    },
    agenda: { ...base.agenda, headline: 'What we will cover', subtitle: 'In this order.', items: SALES_AGENDA },
    // The onboarding deck's team line counts the cards and welcomes an owner who has signed. On a
    // proposal the same faces answer a different question, so the subtitle asks it.
    team: { ...base.team, subtitle: 'The people who would be on your property.' },

    contact: { headline: CONTACT_HEADLINE, subtitle: CONTACT_SUBTITLE, body: CONTACT_BODY, card },
    ops: { headline: OPS_HEADLINE, subtitle: OPS_SUBTITLE, body: OPS_BODY, rows: OPS_ROWS, note: OPS_NOTE, photo: pic(2) },
    marketing: { headline: MARKETING_HEADLINE, subtitle: MARKETING_SUBTITLE, body: MARKETING_BODY, rows: MARKETING_ROWS, photo: pic(6) },
    dist: { headline: DIST_HEADLINE, subtitle: DIST_SUBTITLE, body: DIST_BODY, rows: DIST_ROWS },
    direct: { headline: DIRECT_HEADLINE, subtitle: DIRECT_SUBTITLE, body: DIRECT_BODY, rows: DIRECT_ROWS, note: DIRECT_NOTE },
    lighthouse: { headline: LH_HEADLINE, subtitle: LH_SUBTITLE, body: LH_BODY, rows: LH_ROWS, note: LH_NOTE, shots: [] },
    onbsteps: { headline: ONB_HEADLINE, subtitle: ONB_SUBTITLE, body: ONB_BODY, steps: ONB_STEPS, note: ONB_NOTE },
    gpo: { headline: GPO_HEADLINE, subtitle: GPO_SUBTITLE, body: GPO_BODY, rows: GPO_ROWS, note: GPO_NOTE },
    // THEIR PROPERTY, FROM WHAT THE DESK ASKED (2026-10-27). Facts the person typed become the
    // four lines on the slide; anything they left blank simply does not print.
    property: {
      headline: PROPERTY_HEADLINE, subtitle: PROPERTY_SUBTITLE, body: PROPERTY_BODY,
      facts: propertyFacts(i.intake || {}),
      photos: (i.photos && i.photos.length ? i.photos : pool.slice(0, 4)),
    },
    market: {
      headline: MARKET_HEADLINE,
      subtitle: MARKET_SUBTITLE,
      rows: MARKET_PROMPTS.map(r => ({ ...r })),
      photo: pic(8),
      intel: i.intel || null,
    },
    maxrev: { headline: MAXREV_HEADLINE, subtitle: MAXREV_SUBTITLE, body: MAXREV_BODY, rows: MAXREV_ROWS, note: MAXREV_NOTE },
    terms: { headline: TERMS_HEADLINE, subtitle: TERMS_SUBTITLE, rows: termRows(t.mgmtPct, t.laborRate, t.approvalLimit), note: TERMS_NOTE },
    proof: { headline: PROOF_HEADLINE, subtitle: PROOF_SUBTITLE, body: PROOF_BODY, note: PROOF_NOTE, scope: '', window: '', names: false, rows: [] },
    returns: { headline: RETURNS_HEADLINE, subtitle: RETURNS_SUBTITLE, body: RETURNS_BODY, note: RETURNS_NOTE, window: '', rows: [] },
    plan: { headline: PLAN_HEADLINE, subtitle: PLAN_SUBTITLE, body: PLAN_BODY, note: PLAN_NOTE, range: null, months: [], cols: [], rows: [] },
    comps: { headline: COMPS_HEADLINE, subtitle: COMPS_SUBTITLE, body: COMPS_BODY, note: COMPS_NOTE, rows: [] },
    close: { headline: CLOSE_HEADLINE, subtitle: CLOSE_SUBTITLE, rows: CLOSE_ROWS, note: CLOSE_NOTE },
    video: { headline: VIDEO_HEADLINE, subtitle: VIDEO_SUBTITLE, body: VIDEO_BODY, url: '', poster: '' },

    omit,
  }
}
