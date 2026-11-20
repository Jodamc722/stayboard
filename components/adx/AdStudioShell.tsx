'use client'
// AD STUDIO REBUILD (Jon, 2026-11-20: "Need the same engine that you use here to build them. Rebuild it completely.").
//
// The Ad Studio page now holds two engines side by side. The calendar's special-date pieces (lib/adx/composition
// ADX_MOMENTS: Thanksgiving, Christmas, New Year's Eve, Art Basel) are made by the NEW one: guided brief → three ideas
// → script → a composition authored for the piece. Everything else — the other calendar moments, video ads, owner
// stories, the two sales films and every piece already saved (shown as "Classic") — stays on the earlier studio,
// untouched, which is kept mounted underneath so nothing open in it is lost.
import { useCallback, useEffect, useState } from 'react'
import AdStudio from '@/components/AdStudio'
import type { HomeAdx } from '@/components/StudioHome'
import { ADX_MOMENTS } from '@/lib/adx/composition'
import AdxStudio, { type AdxStart } from './AdxStudio'

// `newEngine` (2026-11-20): pilots ship off. Until Jon turns it on for the team (app setting `adx`, {"on":true}),
// only he sees the new special-date designer; everyone else gets the earlier studio exactly as it was.
type Props = { display: string; body: string; serif?: string; condensed?: string; elegant?: string; canEdit: boolean; canDelete: boolean; full?: boolean; newEngine?: boolean }

export default function AdStudioShell(props: Props) {
  const [open, setOpen] = useState<AdxStart | null>(null)
  const [rows, setRows] = useState<HomeAdx['rows']>([])
  const load = useCallback(() => {
    fetch('/api/adx/pieces').then(r => r.json()).then(j => { if (j?.ok && Array.isArray(j.pieces)) setRows(j.pieces) }).catch(() => {})
  }, [])
  useEffect(() => { if (props.newEngine) load() }, [load, props.newEngine])
  const adx: HomeAdx = {
    moments: ADX_MOMENTS, rows,
    onStart: m => setOpen({ moment: m.key }),
    onHouse: m => setOpen({ house: m.key }),
    onOpen: id => setOpen({ openId: id }),
    onDelete: async id => {
      const r = rows.find(x => x.id === id)
      if (!window.confirm('Delete “' + (r?.title || 'this piece') + '”? This cannot be undone.')) return
      setRows(rs => rs.filter(x => x.id !== id))
      await fetch('/api/adx/pieces?id=' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => {})
      load()
    },
  }
  return (
    <>
      <div style={{ display: open ? 'none' : 'block' }}><AdStudio {...props} adx={props.newEngine ? adx : undefined} /></div>
      {open ? <div style={{ padding: props.full ? 0 : '0 12px' }}><AdxStudio start={open} canEdit={props.canEdit} display={props.display} onClose={changed => { setOpen(null); if (changed) load(); try { window.scrollTo(0, 0) } catch { /* fine */ } }} /></div> : null}
    </>
  )
}
