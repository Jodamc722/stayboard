// GUIDEBOOK REVIEW QUEUE (Jon, 2026-11-06: "generate guidebooks for all units … if unsure on rules,
// can't pull or assume things please let me know in admin (Guidebook section) … a place to go one by one
// and approve each one … once approved it should push to Guesty … flag no Wi-Fi info, no parking details").
//
// Every unit, building by building — Surfside first, then Salato (Jon's order), then the rest A–Z:
// its book's stage (draft → approved → live in Guesty), the flags lib/guidebook-audit raises, how many
// review pages are ticked, and a Review button. Units with no book link to the bulk builder for their
// building. At the top: everything we could not pull or had to assume, across all books.
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase-server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { Shell } from '@/components/Shell'
import { ArrowRight } from 'lucide-react'
import { LeanHead, Pill, Tag, LeanSection } from '@/components/lean'
import { pageRows } from '@/lib/db-page'
import { rollupBuilding } from '@/lib/optimize-score'
import { auditGuidebook, flagCounts, reviewOf, stageOf, REVIEW_PAGES, type Flag } from '@/lib/guidebook-audit'
import { guestUnitFull } from '@/lib/guest-unit'
import { CheckPhotosAll } from '@/components/CheckPhotosAll'

export const dynamic = 'force-dynamic'

const ORDER = [/surfside|boynton/i, /salato/i]
const rank = (b: string) => { const i = ORDER.findIndex(re => re.test(b)); return i < 0 ? 99 : i }
// "These rules are our standard defaults, not this property's: No Smoking, Pets — …" → "These rules are our standard defaults"
const kindOf = (t: string) => t.split(/ — |: |\(/)[0].trim()

export default async function GuidebookReviewQueue({ searchParams }: { searchParams?: { b?: string; show?: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const db = supabaseAdmin()

  let books: any[] = []
  try {
    const { rows } = await pageRows<any>((a, b) => db.from('guidebooks').select('id, listing_id, listing_name, title, status, updated_at, sections, answers').order('updated_at', { ascending: false }).order('id').range(a, b), 6)
    books = rows || []
  } catch { /* table missing */ }
  const newest: Record<string, any> = {}
  for (const b of books) { const k = String(b.listing_id || b.id); if (!newest[k]) newest[k] = b }

  let listings: any[] = []
  try {
    const { data } = await db.from('guesty_listings').select('id, nickname, title, building, unit, status').not('building', 'is', null).limit(1000)
    listings = (data || []).filter((l: any) => !/\bfull\b/i.test(String(l.nickname || l.title || '')) && !/inactive|disabled|archived|deleted/i.test(String(l.status || '')))
  } catch { /* none */ }
  const byId: Record<string, any> = {}
  for (const l of listings) byId[l.id] = l

  type Row = { listing: any; book: any | null; flags: Flag[]; ticked: number; label: string }
  const groups: Record<string, Row[]> = {}
  for (const l of listings) {
    const b = rollupBuilding(String(l.building || '').trim())
    if (!b || b === 'Unassigned') continue
    const book = newest[l.id] || null
    const flags = book && book.sections ? auditGuidebook(book, l) : []
    const ticked = book ? Object.keys(reviewOf(book).pages || {}).length : 0
    ;(groups[b] = groups[b] || []).push({ listing: l, book, flags, ticked, label: guestUnitFull(l) || String(l.nickname || l.title) })
  }
  const names = Object.keys(groups).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  const onlyB = String(searchParams?.b || '')
  const show = String(searchParams?.show || '')

  const all = names.flatMap(n => groups[n])
  const withBook = all.filter(r => r.book)
  const nDraft = withBook.filter(r => stageOf(r.book) === 'draft').length
  const nApproved = withBook.filter(r => stageOf(r.book) === 'approved').length
  const nLive = withBook.filter(r => stageOf(r.book) === 'live').length
  const nMissing = all.length - withBook.length

  // WHAT WE COULD NOT PULL OR HAD TO ASSUME — across every draft book.
  const agg: Record<string, { level: Flag['level']; n: number; ids: { id: string; label: string }[] }> = {}
  for (const r of withBook) {
    if (stageOf(r.book) !== 'draft') continue
    for (const f of r.flags) {
      if (f.level === 'tidy') continue
      const k = kindOf(f.text)
      const a = (agg[k] = agg[k] || { level: f.level, n: 0, ids: [] })
      if (!a.ids.some(x => x.id === r.book.id)) { a.n++; a.ids.push({ id: r.book.id, label: r.label }) }
    }
  }
  const aggList = Object.entries(agg).sort((a, b) => (a[1].level === 'block' ? 0 : 1) - (b[1].level === 'block' ? 0 : 1) || b[1].n - a[1].n)

  return (
    <Shell>
      <LeanHead title="Guidebook review">
        <Pill tone="amber" title="Drafts waiting for review">{nDraft} to review</Pill>
        <Pill tone="sky" title="Approved, not yet in Guesty">{nApproved} approved</Pill>
        <Pill tone="emerald" title="Approved and pushed to Guesty">{nLive} live</Pill>
        {nMissing ? <Pill tone="rose" title="Active units with no guidebook">{nMissing} no book</Pill> : null}
        <Link href="/guidebooks/bulk" className="inline-flex items-center gap-1 text-[12px] font-semibold rounded-lg bg-neutral-900 text-white px-2.5 py-1 hover:bg-neutral-700">Bulk create <ArrowRight size={13} /></Link>
        <Link href="/guidebooks" className="text-[12px] font-semibold text-muted hover:text-ink px-1">All guidebooks</Link>
      </LeanHead>

      {aggList.length ? (
        <LeanSection title="Needs your answer — what we couldn't pull or had to assume" n={aggList.length}>
          <ul className="rounded-2xl border border-line bg-white divide-y divide-line/70">
            {aggList.map(([k, a]) => (
              <li key={k} className="px-3 sm:px-4 py-2">
                <details>
                  <summary className="flex cursor-pointer items-center gap-2 text-[13px]">
                    <Tag tone={a.level === 'block' ? 'rose' : 'amber'}>{a.level === 'block' ? 'Missing' : 'Confirm'}</Tag>
                    <span className="flex-1 font-semibold text-ink">{k}</span>
                    <span className="text-[12px] text-muted tabular-nums">{a.n} book{a.n === 1 ? '' : 's'}</span>
                  </summary>
                  <div className="mt-2 flex flex-wrap gap-1.5 pl-1">
                    {a.ids.map(x => <Link key={x.id} href={'/guidebooks/review/' + x.id} className="rounded-md bg-app px-2 py-1 text-[12px] font-semibold text-ink hover:bg-line/60">{x.label}</Link>)}
                  </div>
                </details>
              </li>
            ))}
          </ul>
        </LeanSection>
      ) : null}

      <div className="mb-3 flex flex-wrap gap-1.5">
        <Link href="/guidebooks/review" className={'rounded-lg px-2.5 py-1 text-[12px] font-semibold ' + (!onlyB ? 'bg-ink text-white' : 'bg-white border border-line text-ink')}>All buildings</Link>
        {names.map(n => <Link key={n} href={'/guidebooks/review?b=' + encodeURIComponent(n)} className={'rounded-lg px-2.5 py-1 text-[12px] font-semibold ' + (onlyB === n ? 'bg-ink text-white' : 'bg-white border border-line text-ink')}>{n}</Link>)}
      </div>

      {names.filter(n => !onlyB || n === onlyB).map(n => {
        const rows = groups[n].slice().sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
        const missing = rows.filter(r => !r.book).length
        const shown = rows.filter(r => show !== 'open' || !r.book || stageOf(r.book) === 'draft')
        return (
          <LeanSection key={n} title={n} n={rows.length} right={<span className="flex items-center gap-3"><CheckPhotosAll ids={rows.filter(r => r.book && !reviewOf(r.book).photosCheckedAt).map(r => r.book.id)} />{missing ? <Link href={'/guidebooks/bulk?building=' + encodeURIComponent(n)} className="text-[12px] font-semibold text-brand-700 hover:underline">Create {missing} missing →</Link> : null}</span>}>
            <ul className="rounded-2xl border border-line bg-white divide-y divide-line/70">
              {shown.map(r => {
                const c = flagCounts(r.flags)
                const st = r.book ? stageOf(r.book) : null
                return (
                  <li key={r.listing.id}>
                    {r.book ? (
                      <Link href={'/guidebooks/review/' + r.book.id} className="group flex items-center gap-2.5 px-3 sm:px-4 py-2 hover:bg-app/60">
                        <span className="text-[13.5px] font-semibold text-ink truncate max-w-[14rem]">{r.label}</span>
                        <span className="hidden sm:inline text-[12px] text-muted truncate max-w-[16rem]">{String(r.book.listing_name || '').split(/\s+\|\s+/)[0]}</span>
                        <span className="flex-1" />
                        {c.block ? <Tag tone="rose" title={r.flags.filter(f => f.level === 'block').map(f => f.text).join('\n')}>{c.block} missing</Tag> : null}
                        {c.ask ? <Tag tone="amber" title={r.flags.filter(f => f.level === 'ask').map(f => f.text).join('\n')}>{c.ask} to confirm</Tag> : null}
                        {reviewOf(r.book).needsFix ? <Tag tone="roseSolid" title={reviewOf(r.book).needsFix?.note}>Needs fix</Tag> : null}
                        <Tag tone="slate" title="Review pages ticked">{r.ticked}/{REVIEW_PAGES.length} pages</Tag>
                        <Tag tone={st === 'live' ? 'emerald' : st === 'approved' ? 'sky' : 'amber'}>{st === 'live' ? 'Live in Guesty' : st === 'approved' ? 'Approved' : 'Draft'}</Tag>
                        <ArrowRight size={15} className="shrink-0 text-muted group-hover:text-ink" />
                      </Link>
                    ) : (
                      <div className="flex items-center gap-2.5 px-3 sm:px-4 py-2">
                        <span className="text-[13.5px] font-semibold text-muted truncate max-w-[14rem]">{r.label}</span>
                        <span className="flex-1" />
                        <Tag tone="rose">No guidebook</Tag>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </LeanSection>
        )
      })}
    </Shell>
  )
}
