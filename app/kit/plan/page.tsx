// THE FREE NEED LIST, FOR THE WEBSITE (Jon, 2026-11-10: "a free thing to share with people online to
// help them determine what they need — it can help us build SEO and get owner acquisition… one we can
// add to our website that asks for their email before they download the Excel"). /kit/plan is the
// calculator in its 'site' mode: indexable, with a title and description written for search, a short
// guide and FAQ under the tool (FAQPage structured data), Stay's contact, and an email gate on the
// Excel (leads land on Onboarding → Starter kits). /kit/list stays the plain, unindexed share link.
// It can be linked from stay-hospitality.com or embedded there in an <iframe>.
import type { Metadata } from 'next'
import { NeedListCalculator } from '@/components/NeedListCalculator'
import { STAY_CONTACT } from '@/lib/need-list-contact'

export const dynamic = 'force-dynamic'

const TITLE = 'Airbnb & Vacation Rental Supply List Calculator (Free) | Stay Hospitality'
const DESC = 'Free calculator: enter bedrooms, bathrooms, guests and kitchen and get exactly what your short-term rental needs, how many plates, glasses, towels, pans and more, with shop links and an Excel list. From Stay Hospitality, Miami-Dade and Broward.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  robots: { index: true, follow: true },
  alternates: { canonical: '/kit/plan' },
  openGraph: { title: 'What does your rental need? Free supply list calculator', description: DESC, type: 'website', siteName: STAY_CONTACT.company },
  twitter: { card: 'summary', title: 'Free vacation rental supply list calculator', description: DESC },
}

const FAQ: [string, string][] = [
  ['How many plates and bowls does a vacation rental need?', 'Plan two place settings per guest for what is used at every meal: dinner plates, bowls, everyday glasses, forks, knives and soup spoons. A home that sleeps 6 needs 12 of each, so a full house can eat twice before anything is washed. Side plates, mugs, wine glasses and teaspoons are one per guest.'],
  ['Should I buy dinnerware and flatware as sets?', 'Yes, where they are sold that way. Three 16-piece dinnerware sets (service for 4) cover a home for 6, and three 20-piece flatware sets cover the forks, knives and spoons. A knife block set covers the kitchen knives, steak knives and shears in one purchase.'],
  ['What does an Airbnb kitchen need besides dishes?', 'A cookware set with 8 and 12 inch pans, saucepans and a stock pot; sheet pans if there is an oven; cutting boards, mixing bowls, a colander, a cooking utensil set, a coffee maker, toaster and kettle, and the basics like a can opener and wine opener. With no dishwasher, add a dish rack.'],
  ['What goes in each bathroom and bedroom?', 'Each bathroom gets a hair dryer, a plunger and toilet brush, and a lidded trash can. Each bedroom gets about 20 hangers and a luggage rack. Every home needs a smoke alarm per bedroom plus one outside the bedrooms, a fire extinguisher, a first aid kit and, with gas appliances, a carbon monoxide alarm; check your local code.'],
  ['Is this calculator free?', 'Yes. Use it for one home or a whole building, switch between standard, mid and luxury picks, and download the list in Excel. Want help managing your rental in South Florida? Give Nick Carline, business development at Stay Hospitality, a call at (651) 200-8283 and see how we can help.'],
]

export default function NeedListPlanPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const one = (k: string) => { const v = searchParams?.[k]; return Array.isArray(v) ? v[0] : v }
  const ld = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: FAQ.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) }
  return (
    <NeedListCalculator mode="site" initial={{ bd: one('bd'), ba: one('ba'), g: one('g'), k: one('k'), no: one('no'), opt: one('opt'), u: one('u'), t: one('t') }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <section className="nlc-guide" aria-label="How to stock a short-term rental">
        <h2>How to stock a short-term rental</h2>
        <p>Guests judge a rental on the small things: enough clean glasses, a pan that is not warped, a hair dryer in every bathroom. This list is the standard {STAY_CONTACT.company} uses to set up the homes it manages, sized to your bedrooms, bathrooms, guests and kitchen. Count what is already there, buy the rest, and keep the Excel as your par list for restocking.</p>
        <h2>Common questions</h2>
        <dl>{FAQ.map(([q, a]) => <div key={q}><dt>{q}</dt><dd>{a}</dd></div>)}</dl>
      </section>
      <style dangerouslySetInnerHTML={{ __html: `.nlc-guide{margin-top:30px;color:var(--ink)}.nlc-guide h2{font-family:var(--display);font-weight:400;font-size:28px;margin:22px 0 8px}.nlc-guide p{color:var(--muted);max-width:68ch;margin:0}
.nlc-guide dl{margin:0;display:grid;gap:14px}.nlc-guide dt{font-weight:600}.nlc-guide dd{margin:4px 0 0;color:var(--muted);max-width:70ch}` }} />
    </NeedListCalculator>
  )
}
