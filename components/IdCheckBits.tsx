'use client'
// THE ID STATE ON A ROW, AND THE BUTTONS THAT CHANGE IT (Jon, 2026-10-21). One set for the Calls
// desk's ID & deposits tab and for Today's tile, so both say the same thing with the same words:
//
//   verified  — green. Hover says how: the guest's link (name on the ID read and matching the
//               booking), the booking page, the Salato iPad, seen in person, sent on the thread,
//               verified on the platform, or the "verified" tick in Guesty.
//   check     — a photo is on file but a person has to look. Rose when the name on the ID is not
//               the booking's, amber for everything else (unreadable, expired, name not read,
//               selfie doubt). The reasons are on hover and under the row. "Looks right" clears it;
//               "Not them" sends it back to pending with the photos kept.
//   pending   — "ID to verify", or "link sent … waiting". "Verified by hand" is the manual close
//               Jon asked for when nothing picked it up: seen in person · on the thread · on the
//               platform. Buttons, no drop-downs.
import { useState } from 'react'
import { Check, X, Eye, Send, Copy, Loader2, ScanSearch, UserCheck, MessageSquare, Globe, Undo2 } from 'lucide-react'
import { Tag } from '@/components/lean'
import type { GuestCheckRow } from '@/app/api/guest-checks/route'

export const ID_METHOD_LABEL: Record<string, string> = {
  link: 'guest link', direct: 'booking page', salato: 'Salato iPad', manual: 'seen in person', message: 'sent on the thread', platform: 'verified on the platform', guesty: 'ticked in Guesty',
}
export const fmtAt = (s?: string | null) => s ? new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : ''
const who = (s?: string | null) => String(s || '').split('@')[0]

/** The one tag that says where the ID check stands. */
export function IdTag({ r }: { r: GuestCheckRow }) {
  if (!r.needId) return null
  const how = ID_METHOD_LABEL[String(r.idMethod || '')] || (r.idMethod ? String(r.idMethod) : 'by the desk')
  const reasons = (r.idCheckReasons || []).join(' · ')
  if (r.idStatus === 'verified') {
    const why = r.idMatch === 'match' ? 'Name on the ID matches the booking' + (r.idReadName ? ' (' + r.idReadName + ')' : '') : r.idCheckedBy ? 'Cleared by ' + who(r.idCheckedBy) + (reasons ? ' — the read said: ' + reasons : '') : r.idMethod === 'guesty' ? 'The "verified" field is ticked on the booking in Guesty' : r.idMethod === 'link' ? 'Photos on file — nothing has read the name yet' : ''
    return <Tag tone="emerald" title={[why, r.idCapturedAt ? 'Captured ' + fmtAt(r.idCapturedAt) : '', r.idName ? 'Name: ' + r.idName : ''].filter(Boolean).join(' · ')}>ID verified · {how}{r.idCapturedAt ? ' · ' + fmtAt(r.idCapturedAt) : ''}</Tag>
  }
  if (r.idStatus === 'check') {
    const mismatch = r.idMatch === 'mismatch'
    return <Tag tone={mismatch ? 'rose' : 'amber'} title={(reasons || 'A person has to look at the photos') + (r.idReadName ? ' · ID reads "' + r.idReadName + '"' : '')}>{mismatch ? 'ID — name mismatch, check' : 'ID — check the photo'}</Tag>
  }
  if (r.idStatus === 'waived') return <Tag title="No ID check for this stay">ID waived</Tag>
  return <Tag tone="amber" title={r.idLinkSentAt ? 'The guest has the link; nothing back yet' : 'Nothing received, no link sent'}>{r.idLinkSentAt ? 'link sent ' + fmtAt(r.idLinkSentAt) + (r.idLinkSentVia === 'guesty' ? ' on ' + r.channel : ' (copied)') + ' · waiting' : 'ID to verify'}</Tag>
}

/** One line under a flagged row: why, and what the ID reads. */
export function IdCheckWhy({ r }: { r: GuestCheckRow }) {
  if (r.idStatus !== 'check' || !(r.idCheckReasons || []).length) return null
  return <p className="text-[11.5px] text-amber-900/90">{r.idCheckReasons.join(' · ')}{r.idReadName ? <> · ID reads <b>{r.idReadName}</b></> : null}{r.idName && r.idName !== r.idReadName ? <> · guest typed <b>{r.idName}</b></> : null}</p>
}

export type IdPatch = Record<string, any>
/**
 * The buttons for the ID side of a row. `ghost` / `dark` are the host's button classes. `onPatch`
 * posts a desk entry; `byHand` says whether this row's by-hand strip is open.
 */
export function IdActions({ r, canEdit, busy, ghost, dark, onPatch, onSendLink, onCopyLink, onView, onRecheck, byHand, setByHand }: {
  r: GuestCheckRow; canEdit: boolean; busy: boolean; ghost: string; dark: string
  onPatch: (patch: IdPatch, ok?: string) => void
  onSendLink?: () => void; onCopyLink?: () => void
  onView: (which: 'id' | 'selfie') => void
  onRecheck?: () => void
  byHand: boolean; setByHand: (v: boolean) => void
}) {
  if (!r.needId) return null
  const open = r.idStatus === 'pending', check = r.idStatus === 'check', verified = r.idStatus === 'verified'
  return (
    <>
      {r.hasIdPhoto && <button onClick={() => onView('id')} className={ghost} title="Opens a 10-minute link; the view is logged"><Eye size={12} /> ID</button>}
      {r.hasSelfie && <button onClick={() => onView('selfie')} className={ghost} title="Opens a 10-minute link; the view is logged"><Eye size={12} /> Selfie</button>}
      {canEdit && check && <button onClick={() => onPatch({ id_status: 'verified', confirm: true }, 'ID confirmed — marked verified and ticked in Guesty.')} disabled={busy} className={dark} title="You looked: this is the guest — mark verified (and tick the booking in Guesty)">{busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Looks right</button>}
      {canEdit && check && <button onClick={() => onPatch({ id_status: 'pending' }, 'Sent back — the photos stay on file; send the link again if you want new ones.')} disabled={busy} className={ghost} title="Not the guest, or not good enough — back to pending (photos kept)"><X size={12} /> Not them</button>}
      {canEdit && open && onSendLink && <button onClick={onSendLink} disabled={busy} className={dark} title="Message the guest the verification link on their booking thread">{busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} {r.idLinkSentAt ? 'Send again' : 'Send ID link'}</button>}
      {canEdit && open && onCopyLink && r.verifyUrl && <button onClick={onCopyLink} disabled={busy} className={ghost} title="Copy the link to send by text or email"><Copy size={12} /></button>}
      {canEdit && open && <button onClick={() => setByHand(!byHand)} aria-pressed={byHand} className={ghost + (byHand ? ' !bg-ink !text-white' : '')} title="Close this ID check yourself — seen in person, received on the thread, or verified on the platform"><UserCheck size={12} /> Verified by hand</button>}
      {canEdit && (open || check) && <button onClick={() => onPatch({ id_status: 'waived' }, 'ID check waived for this stay.')} disabled={busy} className={ghost} title="No ID check for this stay">Waive</button>}
      {canEdit && verified && !r.salatoVerified && r.hasIdPhoto && !r.idMatch && onRecheck && <button onClick={onRecheck} disabled={busy} className={ghost} title="Nothing has read these photos yet — read the ID against the booking name now"><ScanSearch size={12} /> Read ID</button>}
      {canEdit && (verified || r.idStatus === 'waived') && !r.salatoVerified && <button onClick={() => onPatch({ id_status: 'pending' }, 'ID reopened' + (r.guestyVerified ? ' — and unticked in Guesty.' : '.'))} disabled={busy} className={ghost} title={'Reopen the ID check (keeps the photos on file' + (r.guestyVerified ? '; unticks "verified" on the booking in Guesty' : '') + ')'}><Undo2 size={12} /></button>}
    </>
  )
}

/** The by-hand strip: how was it verified, and the name as it read. Three buttons, one save each. */
export function ByHandStrip({ r, busy, ghost, dark, field, onPatch, onClose }: {
  r: GuestCheckRow; busy: boolean; ghost: string; dark: string; field: string
  onPatch: (patch: IdPatch, ok?: string) => void; onClose: () => void
}) {
  const [name, setName] = useState(r.idName || r.guest || '')
  const go = (id_method: 'manual' | 'message' | 'platform', ok: string) => onPatch({ id_status: 'verified', id_method, id_name: name.trim() || r.guest }, ok)
  return (
    <div className="mt-2 flex items-center gap-2 flex-wrap rounded-xl border border-line bg-app/50 p-2.5">
      <span className="text-[12px] font-semibold text-ink">How was the ID verified?</span>
      <button onClick={() => go('manual', 'ID marked verified — seen in person.')} disabled={busy} className={dark} title="You saw the ID yourself"><UserCheck size={12} /> Seen in person</button>
      <button onClick={() => go('message', 'ID marked verified — received on the booking thread.')} disabled={busy} className={ghost} title="The guest sent a photo of the ID on the booking thread or by text"><MessageSquare size={12} /> On the thread</button>
      {r.channel !== 'Direct' && <button onClick={() => go('platform', 'ID marked verified — on the platform.')} disabled={busy} className={ghost} title={'Verified on ' + r.channel + ' (the platform\'s own ID check)'}><Globe size={12} /> On {r.channel}</button>}
      <input value={name} onChange={e => setName(e.target.value)} placeholder="Name as it reads on the ID" className={field + ' w-56 py-1 text-[12px]'} title="Optional — the name as it reads on the ID" />
      <button onClick={onClose} className={ghost} title="Close"><X size={12} /></button>
      <span className="text-[11px] text-muted">Also ticks “verified” on the booking in Guesty.</span>
    </div>
  )
}
