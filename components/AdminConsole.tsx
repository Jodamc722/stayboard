'use client'
// The admin console shell (/users). Was seven cards stacked in one giant scroll — now three tabs:
//   People       — teammates, roles, profiles, notifications, passwords
//   Roles        — member types: which tabs each role sees and at what level (owner-only editing)
//   App settings — everything else that used to live on this page (ops presets, PAR, approval
//                  limits, review voice, front-desk notices, share links), one collapsible each.
// Deep-linkable: /users?tab=roles opens the Roles tab.
import { useEffect, useState } from 'react'
import { Users, ShieldCheck, Sliders, ChevronDown, ChevronRight } from 'lucide-react'
import { UsersAdmin } from '@/components/UsersAdmin'
import { RolesAdmin } from '@/components/RolesAdmin'
import { OpsPresetsAdmin } from '@/components/OpsPresetsAdmin'
import { ParAdmin } from '@/components/ParAdmin'
import { ApprovalLimitsAdmin } from '@/components/ApprovalLimitsAdmin'
import { ReviewVoiceAdmin } from '@/components/ReviewVoiceAdmin'
import { ReservationEmailsAdmin } from '@/components/ReservationEmailsAdmin'
import { ShareLinksCard } from '@/components/ShareLinksCard'

type Tab = 'people' | 'roles' | 'settings'

const TABS: { key: Tab; label: string; Icon: any }[] = [
  { key: 'people', label: 'People', Icon: Users },
  { key: 'roles', label: 'Roles', Icon: ShieldCheck },
  { key: 'settings', label: 'App settings', Icon: Sliders },
]

export function AdminConsole({ myEmail, isOwner }: { myEmail: string; isOwner: boolean }) {
  const [tab, setTab] = useState<Tab>('people')
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t === 'roles' || t === 'settings' || t === 'people') setTab(t)
  }, [])
  const pick = (t: Tab) => {
    setTab(t)
    const url = new URL(window.location.href)
    url.searchParams.set('tab', t)
    window.history.replaceState(null, '', url.toString())
  }
  return (
    <div>
      <div className="inline-flex rounded-xl border border-line bg-white p-1 mb-5">
        {TABS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => pick(key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[13px] font-semibold transition-colors ${tab === key ? 'bg-brand-600 text-white' : 'text-muted hover:text-ink'}`}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      {tab === 'people' && <UsersAdmin myEmail={myEmail} isOwner={isOwner} />}
      {tab === 'roles' && <RolesAdmin isOwner={isOwner} />}
      {tab === 'settings' && (
        <div className="space-y-3">
          <Fold title="Today-in-Ops presets" defaultOpen><OpsPresetsAdmin isOwner={isOwner} /></Fold>
          <Fold title="PAR levels (restock)"><ParAdmin isOwner={isOwner} /></Fold>
          <Fold title="Approval limits"><ApprovalLimitsAdmin isOwner={isOwner} /></Fold>
          <Fold title="Review-reply AI voice"><ReviewVoiceAdmin /></Fold>
          <Fold title="Front-desk notices"><ReservationEmailsAdmin isOwner={isOwner} /></Fold>
          <Fold title="Share links & passwords"><ShareLinksCard /></Fold>
        </div>
      )}
    </div>
  )
}

function Fold({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen)
  return (
    <div className="rounded-2xl border border-line bg-white overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-app/50">
        {open ? <ChevronDown size={14} className="text-muted" /> : <ChevronRight size={14} className="text-muted" />}
        <span className="text-sm font-bold text-ink">{title}</span>
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  )
}
