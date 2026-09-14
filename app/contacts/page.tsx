// CONTACTS — the mailing list (Jon, 2026-09-14).
import { Shell } from '@/components/Shell'
import { ContactList } from '@/components/ContactList'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Contacts — Lighthouse' }

export default function ContactsPage() {
  return (
    <Shell>
      <div className="max-w-6xl">
        <h1 className="text-xl font-bold text-ink mb-1">Contacts</h1>
        <p className="text-[12.5px] text-muted mb-5 max-w-3xl leading-relaxed">
          Every guest of the last two years as a mailing list — name split for a merge field, the best email and
          phone we hold, how they booked, what they booked, how often, and whether they left a review. Export it,
          or push it straight into a Mailchimp audience. Channel forwarding addresses are kept visible but are
          never mailed.
        </p>
        <ContactList />
      </div>
    </Shell>
  )
}
