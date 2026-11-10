'use client'
// THE CALLS DESK, DRAWN FIRST — THEN THE PHONES THE MIRROR IS MISSING (2026-11-09).
//
// The page used to wait on Guesty for every stub guest's phone before it sent anything. It now
// renders the desk straight away with what the mirror has, and this wrapper asks
// /api/calls/guest-phones for the blanks. When they arrive the desk is given the filled rows.
//
// The desk keeps its rows in its own state, so handing it new rows means starting it again (the
// `key`). That is only done if nobody has touched the desk yet — a tap or a keystroke before the
// phones arrive means someone is already working, and their place is worth more than a number that
// will be there on the next open anyway (each guest's phone is cached for 30 minutes server-side).
import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { CallsDesk } from './CallsDesk'

type DeskProps = ComponentProps<typeof CallsDesk>

export function CallsDeskPhones(props: DeskProps) {
  const [rows, setRows] = useState(props.rows)
  const [filled, setFilled] = useState(0)
  const touched = useRef(false)
  // A new server render (another date, a refresh) hands down its rows. `touched` is deliberately
  // not reset: once someone is working the desk it is never restarted under them.
  useEffect(() => { setRows(props.rows) }, [props.rows])

  useEffect(() => {
    const missing = props.rows.filter(r => !r.phone && r.guestId).map(r => String(r.id))
    if (!missing.length) return
    let dead = false
    ;(async () => {
      try {
        const r = await fetch('/api/calls/guest-phones', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationIds: missing }) })
        const j = await r.json().catch(() => ({} as any))
        const phones: Record<string, string> = (j && j.ok && j.phones) || {}
        if (dead || touched.current || !Object.keys(phones).length) return
        setRows(props.rows.map(x => (!x.phone && phones[String(x.id)]) ? { ...x, phone: phones[String(x.id)] } : x))
        setFilled(n => n + 1)
      } catch { /* the desk simply stays as it was drawn */ }
    })()
    return () => { dead = true }
  }, [props.rows])

  return (
    <div className="contents" onPointerDownCapture={() => { touched.current = true }} onKeyDownCapture={() => { touched.current = true }}>
      <CallsDesk key={filled} {...props} rows={rows} />
    </div>
  )
}
