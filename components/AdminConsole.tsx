'use client'
// THE ADMIN CONSOLE (/users).
//
// ── WHY THIS WAS REBUILT (Jon, 2026-08-26) ──────────────────────────────────────────────────────
// "We need to improve the user and setting tab, it's so bad, hard to manoeuvre, clunky and not
// user friendly. Customization should be easier to understand, manage and update. We need this to
// be operated without the need of Claude."
//
// What was actually wrong, in order of how much it hurt:
//
//   1. FOURTEEN ACCORDIONS IN ONE SCROLL, six of them open on arrival. Finding "where do I change
//      who gets the morning brief" meant reading fourteen headlines and guessing. There was no
//      search, and the titles were a mix of nouns ("PAR levels") and sentences ("People, crews &
//      agencies") that did not say what they controlled.
//   2. OPENING THE TAB FIRED TEN API CALLS before you had asked for anything, because those six
//      panels all load on mount.
//   3. EVERY PANEL SHIPPED IN ONE BUNDLE — 66kB of JavaScript to change a password, because Eve's
//      memory editor and the guest-order catalog were in the same chunk.
//   4. WHEN A SETTING DID NOTHING, NOTHING SAID WHY. The Vault panel worked perfectly and every
//      save failed, because VAULT_KEY was not set on the server and no screen mentioned it.
//
// So: Settings is now a DIRECTORY. You see a searchable list of what can be configured, each with
// a sentence saying what it controls; you open one at a time; and the panels load only when opened.
// Search matches keywords as well as titles, so "spanish" finds the brief and "password" finds
// share links — you look for the thing you want to change, not the panel somebody filed it under.
//
// System check is first on the list on purpose. It is the answer to #4 and the single biggest
// reason somebody had to come and ask me what was wrong.
import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  Users, ShieldCheck, Sliders, ChevronRight, Search, X, ArrowLeft, Loader2, Lock,
  Activity, ListChecks, Mail, Bot, ShoppingBag, HardHat, Package, MessageSquare,
  DollarSign, Sparkles, Star, Building2, ShieldQuestion, Share2, CalendarClock,
} from 'lucide-react'
import { UsersAdmin } from '@/components/UsersAdmin'
import { RolesAdmin } from '@/components/RolesAdmin'
import { SystemCheck } from '@/components/SystemCheck'

// ── LAZY PANELS ─────────────────────────────────────────────────────────────────────────────────
// One chunk each, fetched the moment you open that setting and never before. This is what takes
// the tab from "download everything to change one number" back to something a phone can open.
const spin = () => (
  <div className="py-8 flex items-center justify-center gap-2 text-muted text-[13px]">
    <Loader2 size={14} className="animate-spin" /> Loading&hellip;
  </div>
)
const L = {
  eve: dynamic(() => import('@/components/EveAdmin').then(m => m.EveAdmin), { loading: spin, ssr: false }),
  ops: dynamic(() => import('@/components/OpsPresetsAdmin').then(m => m.OpsPresetsAdmin), { loading: spin, ssr: false }),
  brief: dynamic(() => import('@/components/OpsBriefAdmin').then(m => m.OpsBriefAdmin), { loading: spin, ssr: false }),
  automation: dynamic(() => import('@/components/TaskAutomationAdmin').then(m => m.TaskAutomationAdmin), { loading: spin, ssr: false }),
  orders: dynamic(() => import('@/components/GuestOrdersAdmin').then(m => m.GuestOrdersAdmin), { loading: spin, ssr: false }),
  crews: dynamic(() => import('@/components/CrewRolesAdmin').then(m => m.CrewRolesAdmin), { loading: spin, ssr: false }),
  par: dynamic(() => import('@/components/ParAdmin').then(m => m.ParAdmin), { loading: spin, ssr: false }),
  slack: dynamic(() => import('@/components/SlackRulesAdmin').then(m => m.SlackRulesAdmin), { loading: spin, ssr: false }),
  approvals: dynamic(() => import('@/components/ApprovalLimitsAdmin').then(m => m.ApprovalLimitsAdmin), { loading: spin, ssr: false }),
  listingAi: dynamic(() => import('@/components/ListingAiAdmin').then(m => m.ListingAiAdmin), { loading: spin, ssr: false }),
  reviewVoice: dynamic(() => import('@/components/ReviewVoiceAdmin').then(m => m.ReviewVoiceAdmin), { loading: spin, ssr: false }),
  notices: dynamic(() => import('@/components/ReservationEmailsAdmin').then(m => m.ReservationEmailsAdmin), { loading: spin, ssr: false }),
  salato: dynamic(() => import('@/components/SalatoVerifyEmailAdmin').then(m => m.SalatoVerifyEmailAdmin), { loading: spin, ssr: false }),
  share: dynamic(() => import('@/components/ShareLinksCard').then(m => m.ShareLinksCard), { loading: spin, ssr: false }),
  nav: dynamic(() => import('@/components/NavLayoutAdmin').then(m => m.NavLayoutAdmin), { loading: spin, ssr: false }),
  taskCats: dynamic(() => import('@/components/TaskCategoriesAdmin').then(m => m.TaskCategoriesAdmin), { loading: spin, ssr: false }),
  revAudit: dynamic(() => import('@/components/ReviewAuditPanel').then(m => m.ReviewAuditPanel), { loading: spin, ssr: false }),
  cadences: dynamic(() => import('@/components/CadencesAdmin').then(m => m.CadencesAdmin), { loading: spin, ssr: false }),
}

// ── THE DIRECTORY ───────────────────────────────────────────────────────────────────────────────
// `blurb` is the promise this entry makes; `find` is everything somebody might type when looking
// for it, including words that appear nowhere in the title. Both are the difference between a list
// you scan and a list you search.
type Entry = {
  key: string
  title: string
  blurb: string
  find: string
  group: string
  Icon: any
  ownerOnly?: boolean
  render: (p: { isOwner: boolean }) => React.ReactNode
}

const ENTRIES: Entry[] = [
  {
    key: 'health', title: 'System check', group: 'Start here', Icon: Activity,
    blurb: 'Whether the integrations and keys these settings depend on are actually working — and what to do when one is not.',
    find: 'health status broken error vault key homebase slack email api down not working missing env',
    render: () => <SystemCheck />,
  },

  {
    key: 'nav', title: 'Sidebar & tabs', group: 'Start here', Icon: Sliders,
    blurb: 'Rename any tab, move it to another section, reorder it or take it off the sidebar — no deploy, and one click back to standard.',
    find: 'sidebar nav navigation tab menu rename reorder move hide section order layout left',
    render: p => <L.nav isAdmin />,
  },

  {
    key: 'review-audit', title: 'Review audit', group: 'Start here', Icon: Star,
    blurb: 'Are guest reviews still arriving? Compares checkouts against reviews per channel, and names the recent stays with no review so you can spot-check one on Airbnb.',
    find: 'review reviews audit airbnb vrbo booking missing not coming in stopped channel guesty stale',
    render: () => <L.revAudit />,
  },

  {
    key: 'task-cats', title: 'Task categories', group: 'Operations', Icon: Bot,
    blurb: 'The counters on Today in Ops and in the daily briefs — add a category, change a symbol, or fix which task names land where.',
    find: 'category categories counter tile departure cleaning glitch maintenance inspection audit pool pest rule regex classify type symbol icon',
    render: () => <L.taskCats isAdmin />,
  },
  {
    key: 'ops', title: 'Today-in-Ops presets', group: 'Operations', Icon: ListChecks, ownerOnly: true,
    blurb: 'Which vendor cleans which building, the cleaner roster and ratios, the 4pm deadline and the at-risk window.',
    find: 'vendor botanica cleaner roster ratio deadline 4pm at risk timing audit cadence clean time benchmark',
    render: p => <L.ops isOwner={p.isOwner} />,
  },
  {
    key: 'cadences', title: 'Preventative cadences', group: 'Operations', Icon: CalendarClock, ownerOnly: true,
    blurb: 'The work that comes due on a clock — A/C deep cleans, filters, batteries, deep cleans — and the caps that keep the daily suggestion list short enough to actually work.',
    find: 'preventative preventive cadence suggestion suggestions battery batteries ac air conditioning filter deep clean dryer vent water heater interval every six months schedule due overdue automation cap proximity pm',
    render: p => <L.cadences isOwner={p.isOwner} />,
  },
  {
    key: 'automation', title: 'Task automation', group: 'Operations', Icon: Bot, ownerOnly: true,
    blurb: 'Inspections the app creates by itself: pre-arrival for big or VIP stays, and a quality walk after a bad review.',
    find: 'auto inspection arrival vip owner stay bad review rating threshold breezeway automatic notice draft long stay',
    render: p => <L.automation isOwner={p.isOwner} />,
  },
  {
    key: 'par', title: 'PAR levels (restock)', group: 'Operations', Icon: Package, ownerOnly: true,
    blurb: 'How much of each essential a unit should hold, per unit, guest, bedroom, bathroom or bed.',
    find: 'par restock inventory supplies essentials towels linen amenities quantity',
    render: p => <L.par isOwner={p.isOwner} />,
  },

  {
    key: 'brief', title: 'Morning brief & daily emails', group: 'Communications', Icon: Mail, ownerOnly: true,
    blurb: 'Who receives the ops brief, the day sheets and the maintenance briefs — and which language each crew gets them in.',
    find: 'morning brief email recipients day sheet spanish english language maintenance brief labor true-up salato digest sender mailbox staffing margin',
    render: p => <L.brief isOwner={p.isOwner} />,
  },
  {
    key: 'slack', title: 'Slack alerts & rules', group: 'Communications', Icon: MessageSquare, ownerOnly: true,
    blurb: 'Where each alert goes, who approves what, and the thresholds behind "worth knowing".',
    find: 'slack channel alert notification approver overtime expiry tone big booking long stay area building',
    render: p => <L.slack isOwner={p.isOwner} />,
  },
  {
    key: 'notices', title: 'Front-desk notices', group: 'Communications', Icon: Building2, ownerOnly: true,
    blurb: 'The arrival notice each building gets: recipients, subject, body and how far ahead it sends.',
    find: 'front desk notice building elser reservation email template lead hours attach form preview',
    render: p => <L.notices isOwner={p.isOwner} />,
  },
  {
    key: 'salato', title: 'Salato verification email', group: 'Communications', Icon: ShieldQuestion,
    blurb: 'Who is told when a Salato guest finishes ID verification.',
    find: 'salato verification id selfie email recipients cc notify',
    render: () => <L.salato />,
  },

  {
    key: 'crews', title: 'People, crews & agencies', group: 'Team & money', Icon: HardHat, ownerOnly: true,
    blurb: 'Which crew each person works in, which agency they come from, and what that agency costs.',
    find: 'crew housekeeping maintenance agency atlantic fee hourly rate loaded cost w2 contractor department supervisor',
    render: p => <L.crews isOwner={p.isOwner} />,
  },
  {
    key: 'approvals', title: 'Approval limits', group: 'Team & money', Icon: DollarSign, ownerOnly: true,
    blurb: 'How much can be approved without you, in general and per owner.',
    find: 'approval limit spend ceiling gm auto approve owner override purchase money',
    render: p => <L.approvals isOwner={p.isOwner} />,
  },
  {
    key: 'orders', title: 'Guest orders', group: 'Team & money', Icon: ShoppingBag, ownerOnly: true,
    blurb: 'The pre-arrival extras guests can buy: catalog, pricing, cutoffs and which buildings offer them.',
    find: 'guest order pre-arrival extras catalog product price tax cutoff charge hub building branding',
    render: p => <L.orders isOwner={p.isOwner} />,
  },

  {
    key: 'eve', title: 'Eve — memory, voice & direction', group: 'AI', Icon: Sparkles, ownerOnly: true,
    blurb: 'What Eve knows, how she sounds, what she is told to push on, and where her approvals land.',
    find: 'eve ai memory voice direction recommendation approvals channel audit questions learn',
    render: p => <L.eve canEdit={p.isOwner} />,
  },
  {
    key: 'listing-ai', title: 'Listing copy — voice & training', group: 'AI', Icon: Star, ownerOnly: true,
    blurb: 'Teach the AI how your listings should sound — the house voice, real examples per field, the phrases it must never write, and the length rules. Also the photo and enhance prompts.',
    find: 'listing ai copy prompt photo enhance preset title description honesty optimize voice tone training train retrain example examples banned never write cliche nestled style writing copywriter',
    render: p => <L.listingAi isOwner={p.isOwner} />,
  },
  {
    key: 'review-voice', title: 'Review-reply voice', group: 'AI', Icon: Star,
    blurb: 'How replies to guest reviews should sound, with examples and a playground to test it.',
    find: 'review reply voice tone guideline example playground airbnb response',
    render: () => <L.reviewVoice />,
  },

  {
    key: 'share', title: 'Share links & passwords', group: 'Access', Icon: Share2,
    blurb: 'The passwords on the vendor board, owner audit, marketing links, Salato rules and the Vault code.',
    find: 'password share link vendor owner audit marketing salato rules vault code secret access',
    render: () => <L.share />,
  },
]

const GROUP_ORDER = ['Start here', 'Operations', 'Communications', 'Team & money', 'AI', 'Access']

type Tab = 'people' | 'roles' | 'settings'
const TABS: { key: Tab; label: string; Icon: any }[] = [
  { key: 'people', label: 'People', Icon: Users },
  { key: 'roles', label: 'Roles', Icon: ShieldCheck },
  { key: 'settings', label: 'Settings', Icon: Sliders },
]

export function AdminConsole({ myEmail, isOwner }: { myEmail: string; isOwner: boolean }) {
  const [tab, setTab] = useState<Tab>('people')
  const [panel, setPanel] = useState<string | null>(null)
  const [q, setQ] = useState('')

  // Deep links: /users?tab=settings&panel=brief opens straight into the morning brief.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const t = sp.get('tab')
    if (t === 'roles' || t === 'settings' || t === 'people') setTab(t)
    const p = sp.get('panel')
    if (p && ENTRIES.some(e => e.key === p)) { setTab('settings'); setPanel(p) }
  }, [])
  const writeUrl = (t: Tab, p: string | null) => {
    const url = new URL(window.location.href)
    url.searchParams.set('tab', t)
    if (p) url.searchParams.set('panel', p); else url.searchParams.delete('panel')
    window.history.replaceState(null, '', url.toString())
  }
  const pickTab = (t: Tab) => { setTab(t); setPanel(null); writeUrl(t, null) }
  const openPanel = (k: string) => { setPanel(k); writeUrl('settings', k); window.scrollTo({ top: 0 }) }
  const closePanel = () => { setPanel(null); writeUrl('settings', null) }

  const hits = useMemo(() => {
    const n = q.trim().toLowerCase()
    if (!n) return ENTRIES
    return ENTRIES.filter(e => (e.title + ' ' + e.blurb + ' ' + e.find + ' ' + e.group).toLowerCase().includes(n))
  }, [q])

  const current = panel ? ENTRIES.find(e => e.key === panel) || null : null

  return (
    <div>
      <div className="sticky top-0 z-20 -mx-3 px-3 py-1.5 bg-app/95 backdrop-blur sm:static sm:mx-0 sm:px-0 sm:py-0 sm:bg-transparent sm:backdrop-blur-none mb-3 sm:mb-5">
        <div className="inline-flex rounded-xl border border-line bg-white p-1">
          {TABS.map(({ key, label, Icon }) => (
            <button key={key} onClick={() => pickTab(key)}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${tab === key ? 'bg-brand-600 text-white' : 'text-muted hover:text-ink'}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'people' && <UsersAdmin myEmail={myEmail} isOwner={isOwner} />}
      {tab === 'roles' && <RolesAdmin isOwner={isOwner} />}

      {tab === 'settings' && (current ? (
        // ── ONE SETTING, FULL WIDTH ──
        <div>
          <button onClick={closePanel}
            className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-muted hover:text-ink mb-2.5">
            <ArrowLeft size={13} /> All settings
          </button>
          <div className="rounded-2xl border border-line bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-line bg-app/40">
              <div className="flex items-center gap-2 flex-wrap">
                <current.Icon size={15} className="text-muted shrink-0" />
                <h2 className="text-[15px] font-bold text-ink">{current.title}</h2>
                {current.ownerOnly && !isOwner && (
                  <span className="text-[10.5px] font-bold px-1.5 py-0.5 rounded-md bg-app text-muted border border-line inline-flex items-center gap-1">
                    <Lock size={9} /> View only
                  </span>
                )}
              </div>
              <p className="text-[12.5px] text-muted mt-1">{current.blurb}</p>
            </div>
            <div className="p-4">{current.render({ isOwner })}</div>
          </div>
        </div>
      ) : (
        // ── THE DIRECTORY ──
        <div>
          <div className="relative mb-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} autoComplete="off"
              placeholder="What do you want to change? Try “spanish”, “password”, “approve”…"
              className="w-full rounded-xl border-2 border-line bg-white pl-9 pr-8 py-2.5 text-[13.5px] focus:outline-none focus:border-ink" />
            {q && <button onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink"><X size={13} /></button>}
          </div>

          {hits.length === 0 && (
            <div className="rounded-2xl border border-line bg-white px-4 py-8 text-center">
              <p className="text-[13.5px] font-semibold text-ink">Nothing matches &ldquo;{q}&rdquo;.</p>
              <p className="text-[12.5px] text-muted mt-1">Try a word for the thing itself &mdash; a channel, an email, a price, a password.</p>
            </div>
          )}

          {GROUP_ORDER.map(g => {
            const rows = hits.filter(e => e.group === g)
            if (!rows.length) return null
            return (
              <div key={g} className="mb-4">
                <p className="text-[10.5px] font-bold uppercase tracking-wider text-muted mb-1.5">{g}</p>
                <div className="rounded-2xl border border-line bg-white overflow-hidden divide-y divide-line">
                  {rows.map(e => (
                    <button key={e.key} onClick={() => openPanel(e.key)}
                      className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-app/50">
                      <e.Icon size={15} className="text-muted shrink-0 mt-0.5" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[13.5px] font-bold text-ink">{e.title}</span>
                          {e.ownerOnly && !isOwner && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-app text-muted border border-line inline-flex items-center gap-1">
                              <Lock size={8} /> view only
                            </span>
                          )}
                        </span>
                        <span className="block text-[12px] text-muted mt-0.5 leading-snug">{e.blurb}</span>
                      </span>
                      <ChevronRight size={15} className="text-muted shrink-0 mt-0.5" />
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
