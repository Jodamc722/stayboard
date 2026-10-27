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
  CLOSE_HEADLINE, CLOSE_SUBTITLE, CLOSE_ROWS, CLOSE_NOTE,
  VIDEO_HEADLINE, VIDEO_SUBTITLE, VIDEO_BODY,
  SALES_AGENDA,
} from './sales-copy'

/** The sales-only sections, laid over an onboarding document. Every one is optional, so an
 *  onboarding deck generated before today renders exactly as it did — the slides are gated on the
 *  section being present, not on the document's kind. */
export type SalesSections = {
  contact?: { headline: string; subtitle: string; body: string; card: ContactCard }
  ops?: { headline: string; subtitle: string; body: string; rows: KV[]; note: string; photo?: string }
  marketing?: { headline: string; subtitle: string; body: string; rows: KV[]; photo?: string }
  dist?: { headline: string; subtitle: string; body: string; rows: KV[] }
  direct?: { headline: string; subtitle: string; body: string; rows: KV[]; note: string }
  lighthouse?: { headline: string; subtitle: string; body: string; rows: KV[]; note: string; shots?: string[] }
  onbsteps?: { headline: string; subtitle: string; body: string; steps: Step[]; note: string }
  gpo?: { headline: string; subtitle: string; body: string; rows: KV[]; note: string }
  market?: { headline: string; subtitle: string; rows: KV[]; photo?: string }
  /** The projection for THIS property, when one has been built or uploaded. */
  plan?: { headline: string; subtitle: string; body: string; rows: KV[]; note: string; source?: string }
  close?: { headline: string; subtitle: string; rows: KV[]; note: string }
  /** Empty url = no slide, so an unfinished video never shows a prospect a grey box. */
  video?: { headline: string; subtitle: string; body: string; url: string; poster?: string }
}

export type SalesContent = Omit<OnboardingContent, 'meta'> & SalesSections & {
  meta: Omit<OnboardingContent['meta'], 'kind'> & { kind: 'sales'; prospect?: string; presenter?: string }
}

export type SalesInput = {
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
}

/** Sections written for someone who has already signed. A prospect is deciding, not answering. */
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

  const omit = Array.from(new Set((Array.isArray(base.omit) ? base.omit : []).concat(SALES_OMIT)))

  return {
    ...base,
    meta: { ...base.meta, kind: 'sales', prospect: i.ownerName, presenter: card.name },
    hero: {
      ...base.hero,
      dateLabel: 'MANAGEMENT PROPOSAL',
      title: i.scopeLabel,
      headline: 'A hospitality company that runs whole buildings, offered to one property at a time.',
      preparedFor: i.ownerName ? 'Prepared for ' + i.ownerName : 'Prepared for the owners of ' + i.scopeLabel,
    },
    welcome: {
      ...base.welcome,
      headline: 'Thank you for your time',
      subtitle: i.ownerName || i.scopeLabel,
      body: 'What follows is how we would run your property: the people, the technology, the marketing, and what the first four weeks look like. Every number in it is one you can check, and every claim is one we can show you the record of.',
    },
    agenda: { ...base.agenda, headline: 'What we will cover', subtitle: 'In this order.', items: SALES_AGENDA },

    contact: { headline: CONTACT_HEADLINE, subtitle: CONTACT_SUBTITLE, body: CONTACT_BODY, card },
    ops: { headline: OPS_HEADLINE, subtitle: OPS_SUBTITLE, body: OPS_BODY, rows: OPS_ROWS, note: OPS_NOTE, photo: pic(2) },
    marketing: { headline: MARKETING_HEADLINE, subtitle: MARKETING_SUBTITLE, body: MARKETING_BODY, rows: MARKETING_ROWS, photo: pic(6) },
    dist: { headline: DIST_HEADLINE, subtitle: DIST_SUBTITLE, body: DIST_BODY, rows: DIST_ROWS },
    direct: { headline: DIRECT_HEADLINE, subtitle: DIRECT_SUBTITLE, body: DIRECT_BODY, rows: DIRECT_ROWS, note: DIRECT_NOTE },
    lighthouse: { headline: LH_HEADLINE, subtitle: LH_SUBTITLE, body: LH_BODY, rows: LH_ROWS, note: LH_NOTE, shots: [] },
    onbsteps: { headline: ONB_HEADLINE, subtitle: ONB_SUBTITLE, body: ONB_BODY, steps: ONB_STEPS, note: ONB_NOTE },
    gpo: { headline: GPO_HEADLINE, subtitle: GPO_SUBTITLE, body: GPO_BODY, rows: GPO_ROWS, note: GPO_NOTE },
    market: { headline: MARKET_HEADLINE, subtitle: MARKET_SUBTITLE, rows: MARKET_PROMPTS.map(r => ({ ...r })), photo: pic(8) },
    close: { headline: CLOSE_HEADLINE, subtitle: CLOSE_SUBTITLE, rows: CLOSE_ROWS, note: CLOSE_NOTE },
    video: { headline: VIDEO_HEADLINE, subtitle: VIDEO_SUBTITLE, body: VIDEO_BODY, url: '', poster: '' },

    omit,
  }
}
