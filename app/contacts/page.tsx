// CONTACTS — the mailing list (Jon, 2026-09-14).
import { Shell } from '@/components/Shell'
import { ContactList } from '@/components/ContactList'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Contacts — Lighthouse' }

export default function ContactsPage() {
  return (
    <Shell>
      <div className="max-w-6xl">
        <ContactList />
      </div>
    </Shell>
  )
}
