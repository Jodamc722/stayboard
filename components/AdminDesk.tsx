'use client'
// THE ADMIN DESK — the administrator's page (Jon, 2026-10-26: "a full admin dashboard page that
// directs our administrator": listing optimization, review management, photo captions, offline and
// online listings — suspended, removed, not live — blocked units, listings on Airbnb, which OTAs are
// live, last optimized, photo analysis; "think of the perfect dashboard for administrative staff";
// "a review tab, filters by date and window, stats, top issue, directional feedback").
//
// Three tabs, one truth:
//   Desk      Stopped selling (most bookings lost first) · by channel · Do now (every line a verb and
//             a deep link, worst first) · all counts (each tile is a filter) · admin projects ·
//             listings offline in Guesty
//   Listings  one row per listing — channel chips, score, last optimized, photos, reviews, blocked —
//             with search, market / building / quick-view buttons
//   Copy audit  every listing's copy: over the channel limits, wrong facts, empty sections, Regenerate
//             pushes that did not stick — Check live re-reads Guesty (components/CopyAuditTab)
//   Reviews   the review report on the same engine as /reviews: window, market, building, channel;
//             stats, top issues, what guests praise, where it is heading
// Rules live in lib/admin-desk-shared.ts (tested); rows come from /api/admin-desk; blocks from
// /api/blocked-units; the report from /api/reviews/kpi. Clean rows and tags, buttons not menus, and
// every icon explains itself on hover (lib/lean rules).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ExternalLink, Home, Images, MessageSquareText, Radio, RefreshCw, Search, Wrench, ArrowUpRight, ArrowDownRight, Minus, Sparkles } from 'lucide-react'
import { useCachedFetch, invalidateCache } from '@/lib/swr'
import { GuidebookWalk } from '@/components/GuidebookWalk'
import { ChannelConnections } from '@/components/ChannelConnections'
import { LeanHead, Pill, Tag, LeanTabs, LeanSection, LeanList, LeanRow, LeanEmpty, IconBtn, LeanPick, Tip, type Tone } from '@/components/lean'
import { TILES, tileCounts, rowInTile, worklist, channelCounts, rowWeight, optimizeState, photoFlags, performance, coverVerdict, agoShort, RULES, channelLabel, type AdminRow, type TileKey, type WorkItem, type Severity } from '@/lib/admin-desk-shared'
import { VERDICT_LABEL, type CellVerdict } from '@/lib/channel-types'
import { CopyAuditTab } from '@/components/CopyAuditTab'
import { AdminBaseRates } from '@/components/AdminBaseRates'

type DeskRes = { ok: boolean; error?: string; at: string; today: string; rows: AdminRow[]; channels: { key: string; label: string; major: boolean }[]; channelCheckedAt: string | null; read: { listings: number; reviews: number } }
type BlockedRes = { ok: boolean; error?: string; runs?: any[]; linkedRuns?: any[]; liveNow?: number }
type ProjectsRes = { ok?: boolean; projects?: any[] }

const DESK_URL = '/api/admin-desk'
const SEV_TONE: Record<Severity, Tone> = { high: 'rose', medium: 'amber', low: 'slate' }
const SEV_WORD: Record<Severity, string> = { high: 'Now', medium: 'This week', low: 'When you can' }
const VERDICT_TONE: Record<CellVerdict, Tone> = { delisted: 'roseSolid', suspended: 'roseSolid', failed: 'rose', disconnected: 'rose', missing: 'amber', unknown: 'amber', stale: 'sky', live: 'emerald' }
const CH_SHORT: Record<string, string> = { airbnb2: 'A', bookingCom: 'B', homeaway2: 'V', expedia: 'E', googleVacationRentals: 'G', hopper: 'H', bluegroundNestpick: 'Bg', whimstay: 'W', homesVillasByMarriott: 'M' }
const KIND_ICON: Record<WorkItem['kind'], any> = { channel: Radio, reply: MessageSquareText, refresh: Sparkles, optimize: Wrench, photos: Images, blocked: Home }
const KIND_WORD: Record<WorkItem['kind'], string> = { channel: 'Channel', reply: 'Reviews', refresh: 'Refresh', optimize: 'Optimize', photos: 'Photos', blocked: 'Blocked' }
const KIND_HINT: Record<WorkItem['kind'], string> = { channel: 'A channel problem', reply: 'A review to answer', refresh: 'Performing poorly against its building — new cover, re-order, re-optimize', optimize: 'Listing copy, settings or score', photos: 'Photos, captions or the analysis', blocked: 'The Guesty calendar' }
const ADMIN_PROJECT_CATEGORIES = ['onboarding', 'offboarding', 'rollout']
// One name per thing on this page and in the morning email: "stopped selling", not also "not for sale".
const TILE_LABEL: Partial<Record<TileKey, string>> = { notForSale: 'Stopped selling' }
const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
const agoText = (iso?: string | null) => { if (!iso) return ''; const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? 'just now' : m < 60 ? m + 'm ago' : Math.round(m / 60) + 'h ago' }
const btn = 'inline-flex items-center gap-1 rounded-lg bg-ink text-white px-2.5 py-1 text-[12px] font-bold hover:opacity-90 shrink-0'
const ghost = 'inline-flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-1 text-[12px] font-semibold text-ink hover:border-ink/40 shrink-0'

// CLEAN-UP (Jon, 2026-11-20): one page, not two. /admin?tab=channels (and every other tab) is a real
// address, so the Channels page can live here: ?tab= picks the tab, ?show= the Listings filter, and
// the channel links on this desk open its own Channels tab with the same ?channel= / ?listing= /
// ?problems= the Channels page reads.
type TabKey = 'desk' | 'listings' | 'rates' | 'channels' | 'copy' | 'reviews' | 'guidebooks'
const TAB_KEYS: TabKey[] = ['desk', 'listings', 'rates', 'channels', 'copy', 'reviews', 'guidebooks']
const tabOf = (v: string | null): TabKey => (TAB_KEYS as string[]).indexOf(String(v || '')) >= 0 ? (v as TabKey) : 'desk'
const tileOf = (v: string | null): TileKey | null => v === 'all' || TILES.some(t => t.key === v) ? (v as TileKey) : null
const here = (href: string) => href === '/channels' ? '/admin?tab=channels' : href.indexOf('/channels?') === 0 ? '/admin?tab=channels&' + href.slice('/channels?'.length) : href
const shortDay = (iso?: string | null) => { const s = String(iso || '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return ''; return new Date(s + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) }
/** The stopped-selling lines and the standing "never connected" gap are drawn in their own sections. */
const isStopped = (w: WorkItem) => w.kind === 'channel' && w.severity === 'high' && !!w.listingId
const isChannelGap = (w: WorkItem) => w.kind === 'channel' && !isStopped(w)

export function AdminDesk({ canEdit }: { canEdit: boolean }) {
  const params = useSearchParams()
  const qs = params.toString()
  const [tab, setTabState] = useState<TabKey>(() => tabOf(params.get('tab')))
  const [tile, setTile] = useState<TileKey>(() => tileOf(params.get('show')) || 'all')
  // The address follows the tab (so a refresh, a shared link or Back lands on the same tab), and the
  // tab follows the address (so a link on this desk to /admin?tab=channels&listing=… switches it).
  const setTab = useCallback((k: TabKey, show?: TileKey) => {
    setTabState(k)
    try { window.history.replaceState(null, '', window.location.pathname + (k === 'desk' ? '' : '?tab=' + k + (show && show !== 'all' ? '&show=' + show : ''))) } catch { /* the tab still changed */ }
  }, [])
  useEffect(() => {
    const p = new URLSearchParams(qs)
    setTabState(tabOf(p.get('tab')))
    const t = tileOf(p.get('show')); if (t) setTile(t)
  }, [qs])
  const desk = useCachedFetch<DeskRes>(DESK_URL, { ttl: 300_000 })
  // Blocks walk Guesty's live calendar — slow, and a Guesty hiccup must never blank the rest.
  // SPEED (Jon, 2026-11-20): the calendar walk and the projects list feed the Desk and Listings tabs
  // only. Opening /admin?tab=channels (or Reviews, Copy audit, …) no longer starts them; they start
  // the first time one of those two tabs is shown, and stay loaded after that.
  const [wantLists, setWantLists] = useState(tab === 'desk' || tab === 'listings')
  useEffect(() => { if (tab === 'desk' || tab === 'listings') setWantLists(true) }, [tab])
  const blocked = useCachedFetch<BlockedRes>(wantLists ? '/api/blocked-units?days=14' : null, { ttl: 600_000 })
  const projects = useCachedFetch<ProjectsRes>(wantLists ? '/api/projects' : null, { ttl: 300_000 })
  const [refreshing, setRefreshing] = useState(false)
  const today = desk.data?.today || todayET()

  // The rows, with each unit's live block folded in (the tile and the Do-now line read it from the row).
  const rows = useMemo<AdminRow[]>(() => {
    const base = desk.data?.rows || []
    const byId: Record<string, AdminRow['blocked']> = {}
    const take = (runs: any[] | undefined, linked: boolean) => {
      for (const r of runs || []) {
        if (!r || !r.live) continue
        const id = String(r.listingId || '')
        if (!id || byId[id]) continue
        byId[id] = { nights: Number(r.nights) || 0, reason: String(r.guestyLabel || r.reason || 'Blocked'), openEnded: !!r.openEnded, from: String(r.blockStart || r.from || ''), linked }
      }
    }
    take(blocked.data?.runs, false)
    take(blocked.data?.linkedRuns, true)
    return base.map(r => ({ ...r, blocked: byId[r.id] || null }))
  }, [desk.data, blocked.data])

  const counts = useMemo(() => tileCounts(rows, today), [rows, today])
  const work = useMemo(() => worklist(rows, today), [rows, today])
  const strip = useMemo(() => channelCounts(rows, (desk.data?.channels || []).filter(c => c.major || c.key === 'googleVacationRentals').map(c => c.key)), [rows, desk.data])
  const offline = useMemo(() => rows.filter(r => !r.active), [rows])
  const adminProjects = useMemo(() => (projects.data?.projects || []).filter((p: any) => ADMIN_PROJECT_CATEGORIES.indexOf(String(p.category || '').toLowerCase()) >= 0 && !p.archived && p.stage !== 'done' && p.stage !== 'cancelled'), [projects.data])

  const openTile = (k: TileKey) => { setTile(k); setTab('listings', k) }
  const refresh = async () => {
    setRefreshing(true)
    try { await fetch(DESK_URL + '?refresh=1', { cache: 'no-store' }); invalidateCache(DESK_URL); await desk.refresh() } finally { setRefreshing(false) }
  }

  return (
    <div className="max-w-[1400px]">
      <LeanHead title="Admin desk" sub={desk.data ? `${counts.all - counts.offline} active listings · ${counts.offline} offline in Guesty · updated ${agoText(desk.data.at)}` : desk.error ? 'Could not load: ' + desk.error : 'Reading the portfolio…'}>
        {/* CLEAN-UP (Jon, 2026-11-20): the header carries the two counts with a clock on them, in the
            morning email's words. "Not connected", "never optimized" and "blocked" were here AND on the
            tiles below; they are standing work, so they stay on the tiles only. Nothing is printed
            before the rows arrive (it read "0 not for sale" in green while loading). */}
        {desk.data && <Pill tone={counts.notForSale ? 'rose' : 'emerald'} title="Was selling on Airbnb, Booking.com, Vrbo or Expedia and stopped: page removed, suspended, failed or disconnected. Each one is lost bookings." onClick={() => openTile('notForSale')}>{counts.notForSale} stopped selling</Pill>}
        {desk.data && counts.replyOwed > 0 && <Pill tone="amber" title={TILES.find(t => t.key === 'replyOwed')!.hint} onClick={() => openTile('replyOwed')}>{counts.replyOwed} reply owed</Pill>}
        {canEdit && <IconBtn title={refreshing ? 'Rebuilding…' : 'Rebuild the desk now (otherwise every 5 minutes)'} onClick={refresh} disabled={refreshing}><RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /></IconBtn>}
      </LeanHead>

      <LeanTabs value={tab} onChange={setTab} tabs={[
        { key: 'desk', label: 'Desk', n: work.filter(w => w.severity === 'high').length || null },
        { key: 'listings', label: 'Listings', n: rows.length || null },
        { key: 'rates', label: 'Base rates' },
        { key: 'channels', label: 'Channels' },
        { key: 'copy', label: 'Copy audit' },
        { key: 'reviews', label: 'Reviews' },
        { key: 'guidebooks', label: 'Guidebooks' },
      ]} />

      {tab === 'desk' && (
        <DeskTab work={work} rows={rows} counts={counts} strip={strip} offline={offline} projects={adminProjects} projectsLoading={projects.loading} loading={desk.loading && !desk.data} blockedState={blocked.error ? 'error' : blocked.data ? 'ok' : 'loading'} onTile={openTile} onChannels={() => setTab('channels')} channelCheckedAt={desk.data?.channelCheckedAt || null} />
      )}
      {tab === 'listings' && (
        <ListingsTab rows={rows} today={today} tile={tile} setTile={setTile} counts={counts} channels={(desk.data?.channels || []).filter(c => c.major || c.key === 'googleVacationRentals')} loading={desk.loading && !desk.data} />
      )}
      {/* CHANNELS (Jon, 2026-11-09): the channel page is the admin's standard channel view — same component. */}
      {tab === 'rates' && <AdminBaseRates canEdit={canEdit} />}
      {tab === 'channels' && <ChannelConnections canRun={canEdit} embedded />}
      {tab === 'copy' && <CopyAuditTab />}
      {tab === 'reviews' && <ReviewsTab />}
      {/* GUIDEBOOKS (Jon, 2026-11-06): approve them one by one, property by property, without opening each. */}
      {tab === 'guidebooks' && <GuidebookWalk />}
    </div>
  )
}

// ── DESK ────────────────────────────────────────────────────────────────────────────────────────
// SIGNAL (Jon, 2026-11-20): the desk opens on the listings that STOPPED SELLING on a channel, because
// each one is lost bookings today; the ones that were booking there come first. Then the per-channel
// picture (where "not connected" is the standing gap, in plain text), then the rest of the work, and
// only then the twelve counts. The order used to be: counts, one long list, channels.
function DeskTab({ work, rows, counts, strip, offline, projects, projectsLoading, loading, blockedState, onTile, onChannels, channelCheckedAt }: {
  work: WorkItem[]; rows: AdminRow[]; counts: Record<TileKey, number>; strip: ReturnType<typeof channelCounts>; offline: AdminRow[]
  projects: any[]; projectsLoading: boolean; loading: boolean; blockedState: 'ok' | 'loading' | 'error'; onTile: (k: TileKey) => void; onChannels: () => void; channelCheckedAt: string | null
}) {
  const [all, setAll] = useState(false)
  const [allStopped, setAllStopped] = useState(false)
  // STOPPED SELLING, ranked by what is being lost: bookings that channel sent this listing in the last
  // 90 days, then how recently it last booked there. (A ranking by building income waits for the
  // property tier; this one uses only what the row already knows.)
  const stopped = useMemo(() => {
    const byId = new Map(rows.map(r => [r.id, r]))
    return work.filter(isStopped).map(w => {
      const r = byId.get(w.listingId)
      const cell = r && w.channel ? r.channels[w.channel] : undefined
      return { w, cell, url: (cell && cell.url) || (r && w.channel ? (r.links || {})[w.channel] : '') || '' }
    }).sort((a, b) => ((b.cell?.bookings90d || 0) - (a.cell?.bookings90d || 0))
      || String(b.cell?.lastBookingAt || '').localeCompare(String(a.cell?.lastBookingAt || ''))
      || a.w.building.localeCompare(b.w.building) || a.w.name.localeCompare(b.w.name, undefined, { numeric: true }))
  }, [work, rows])
  const stoppedShown = allStopped ? stopped : stopped.slice(0, 30)
  // The rest of the work. "Not connected" lines are not in it: a channel that was never set up is a
  // standing gap the Channels section counts, not forty amber lines ahead of a review reply.
  const rest = useMemo(() => work.filter(w => !isStopped(w) && !isChannelGap(w)), [work])
  const shown = all ? rest : rest.slice(0, 25)
  const nSev = (sv: Severity) => rest.filter(w => w.severity === sv).length
  return (
    <div className="space-y-5">
      {/* STOPPED SELLING */}
      <LeanSection title="Stopped selling" n={loading ? undefined : counts.notForSale} tone={stopped.length ? 'rose' : undefined}
        right={stopped.length ? <span className="text-[11px] text-muted">{stopped.length !== counts.notForSale ? stopped.length + ' channel connections on ' + counts.notForSale + ' listings · ' : ''}most bookings lost first</span> : undefined}>
        {loading ? <LeanEmpty>Reading the portfolio…</LeanEmpty> : stopped.length === 0 ? <LeanEmpty>Nothing that was selling has stopped.</LeanEmpty> : (
          <LeanList>
            {stoppedShown.map(({ w, cell, url }) => (
              <LeanRow key={w.listingId + ':' + (w.channel || '')}
                lead={<Link href={here(w.href)} className={btn} title={w.why}>{w.verb}</Link>}
                name={w.name} meta={<>{w.building ? w.building + ' · ' : ''}{w.title}{cell?.since ? ' · since ' + shortDay(cell.since) : ''}</>}
                tags={cell ? <Tag title={'Bookings ' + channelLabel(w.channel || '') + ' sent this listing in the last 90 days' + (cell.lastBookingAt ? ' · last one ' + String(cell.lastBookingAt).slice(0, 10) : ' · none in 12 months')}>{cell.bookings90d ? cell.bookings90d + ' booked in 90d' : cell.lastBookingAt ? 'last booked ' + shortDay(cell.lastBookingAt) : 'never booked there'}</Tag> : undefined}
                actions={<>
                  {url ? <IconBtn title={'Open the ' + channelLabel(w.channel || '') + ' page'} href={url}><ExternalLink size={14} /></IconBtn> : null}
                  <IconBtn title="Open the unit page" href={'/listings/' + encodeURIComponent(w.listingId)}><Home size={14} /></IconBtn>
                </>}>
                <p className="text-[12.5px] text-ink/85">{w.why}</p>
              </LeanRow>
            ))}
            {stopped.length > stoppedShown.length && <li className="px-4 py-2 text-center"><button onClick={() => setAllStopped(true)} className="text-[12.5px] font-semibold text-muted hover:text-ink">Show all {stopped.length}</button></li>}
          </LeanList>
        )}
      </LeanSection>

      {/* BY CHANNEL — "not connected" is the standing gap: counted here, in plain text. */}
      <LeanSection title="By channel" right={<button onClick={onChannels} className="text-[11.5px] font-semibold text-muted hover:text-ink">Open Channels →</button>}>
        <LeanList>
          {strip.map(c => (
            <LeanRow key={c.key} name={c.label} meta={<>{c.live + c.stale} live{c.stale ? ` (${c.stale} quiet)` : ''} of {c.live + c.stale + c.delisted + c.suspended + c.failed + c.disconnected + c.missing + c.unknown} active listings</>}
              tags={<>
                {c.delisted > 0 && <Tag tone="rose" title="Guesty says connected, but the channel's own page for the listing is gone">{c.delisted} page removed</Tag>}
                {c.suspended > 0 && <Tag tone="rose" title="Listed but not for sale — the channel's own verdict">{c.suspended} suspended</Tag>}
                {c.failed > 0 && <Tag tone="rose" title="Guesty reports the sync FAILED">{c.failed} failed</Tag>}
                {c.disconnected > 0 && <Tag tone="rose" title="The channel says DISCONNECTED">{c.disconnected} disconnected</Tag>}
                {c.missing > 0 && <Tag title="Never set up on this channel — a standing gap, not something that broke">{c.missing} never connected</Tag>}
                {c.unknown > 0 && <Tag tone="amber" title="A status this app has not seen before — shown, never assumed fine">{c.unknown} unknown</Tag>}
              </>}
              actions={<IconBtn title={'Open ' + c.label + ' on the Channels tab'} href={'/admin?tab=channels&channel=' + encodeURIComponent(c.key) + '&problems=1'}><ExternalLink size={14} /></IconBtn>} />
          ))}
        </LeanList>
        {channelCheckedAt && <p className="mt-1 px-1 text-[11px] text-muted">Channels last checked {agoText(channelCheckedAt)}.</p>}
      </LeanSection>

      {/* DO NOW — everything that is not a channel */}
      <LeanSection title="Do now" n={loading ? undefined : nSev('high')} tone={nSev('high') ? 'rose' : undefined}
        right={<span className="text-[11px] text-muted">{[nSev('medium') ? nSev('medium') + ' this week' : '', nSev('low') ? nSev('low') + ' when you can' : '', 'worst first'].filter(Boolean).join(' · ')}</span>}>
        {loading ? <LeanEmpty>Reading the portfolio…</LeanEmpty> : rest.length === 0 ? <LeanEmpty>Nothing else needs an administrator right now.</LeanEmpty> : (
          <LeanList>
            {shown.map((w, i) => {
              const I = KIND_ICON[w.kind]
              return (
                <LeanRow key={w.kind + ':' + w.listingId + ':' + (w.channel || '') + ':' + i}
                  lead={<Link href={here(w.href)} className={btn} title={w.why}>{w.verb}</Link>}
                  name={w.name} meta={<>{w.building ? w.building + ' · ' : ''}{w.title}</>}
                  tags={<><Tag tone={SEV_TONE[w.severity]} title={w.why}>{SEV_WORD[w.severity]}</Tag><Tag title={KIND_HINT[w.kind]}><I size={11} className="inline -mt-0.5 mr-1" />{KIND_WORD[w.kind]}</Tag></>}
                  actions={w.listingId ? <IconBtn title="Open the unit page" href={'/listings/' + encodeURIComponent(w.listingId)}><Home size={14} /></IconBtn> : undefined}>
                  {w.steps && w.steps.length ? (
                    <ol className="list-decimal pl-5 space-y-0.5 text-[12.5px] text-ink/85">{w.steps.map((st, j) => <li key={j}>{st}</li>)}</ol>
                  ) : <p className="text-[12.5px] text-ink/85">{w.why}</p>}
                </LeanRow>
              )
            })}
            {rest.length > shown.length && <li className="px-4 py-2 text-center"><button onClick={() => setAll(true)} className="text-[12.5px] font-semibold text-muted hover:text-ink">Show all {rest.length}</button></li>}
          </LeanList>
        )}
      </LeanSection>

      {/* THE NUMBERS — each one is the filter its click applies on the Listings tab. Colour only where
          a person has to act (stopped selling, replies, low reviews); the rest are plain counts. */}
      <LeanSection title="All counts" right={<span className="text-[11px] text-muted">click one to see those listings</span>}>
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-6 gap-1.5">
          {TILES.map(t => {
            const n = counts[t.key]
            const pending = loading || (t.key === 'blocked' && blockedState !== 'ok')
            const tone = n === 0 ? 'text-muted/60' : t.key === 'notForSale' ? 'text-rose-700' : (t.key === 'replyOwed' || t.key === 'lowReviews') ? 'text-amber-800' : 'text-ink'
            return (
              <button key={t.key} onClick={() => onTile(t.key)} title={t.hint + (t.key === 'blocked' && blockedState !== 'ok' ? (blockedState === 'error' ? ' — the calendar could not be read' : ' — reading the calendar…') : '') + ' — click to see these listings'}
                className="text-left rounded-xl border border-line bg-white px-2.5 py-2 min-w-0 hover:border-ink/30 transition">
                <span className={'block text-[20px] leading-none font-bold tabular-nums ' + (pending ? 'text-muted/60' : tone)}>{pending ? '…' : n}</span>
                <span className="block mt-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted truncate">{TILE_LABEL[t.key] || t.label}</span>
              </button>
            )
          })}
        </div>
      </LeanSection>

      {/* ADMIN PROJECTS */}
      <LeanSection title="Admin projects" n={projects.length} right={<Link href="/projects" className="text-[11.5px] font-semibold text-muted hover:text-ink">All projects →</Link>}>
        {projectsLoading && !projects.length ? <LeanEmpty>Reading projects…</LeanEmpty> : projects.length === 0 ? <LeanEmpty>No open onboarding, offboarding or rollout project.</LeanEmpty> : (
          <LeanList>
            {projects.slice(0, 12).map((p: any) => (
              <LeanRow key={p.id} lead={<Link href={'/projects/' + encodeURIComponent(p.id)} className={ghost}>Open</Link>}
                name={p.title} meta={<>{String(p.category || '').replace(/^\w/, (c: string) => c.toUpperCase())}{p.lead ? ' · ' + String(p.lead).split('@')[0] : ''}</>}
                tags={<>
                  {p.progress && p.progress.total > 0 && <Tag title={p.progress.done + ' of ' + p.progress.total + ' ' + p.progress.basis + ' done'}>{p.progress.done}/{p.progress.total}</Tag>}
                  {p.health?.state === 'late' && <Tag tone="rose">{p.health.reason}</Tag>}
                  {p.health?.state === 'due' && <Tag tone="amber">{p.health.reason}</Tag>}
                  {p.health?.state === 'blocked' && <Tag tone="rose">Blocked</Tag>}
                </>} />
            ))}
          </LeanList>
        )}
      </LeanSection>

      {/* OFFLINE IN GUESTY */}
      <LeanSection title="Offline in Guesty" n={offline.length} right={<span className="text-[11px] text-muted">not active in Guesty — off every channel</span>}>
        {offline.length === 0 ? <LeanEmpty>Every listing in Guesty is active.</LeanEmpty> : (
          <LeanList>
            {offline.slice(0, 40).map(r => {
              const stillOn = Object.keys(r.channels).filter(k => r.channels[k].verdict === 'live')
              return (
                <LeanRow key={r.id} name={r.name} meta={r.building}
                  tags={<><Tag tone="slate" title="Guesty's own status on the listing">{r.guestyStatus}</Tag>{stillOn.length > 0 && <Tag tone="amber" title={'Integration still reads live on: ' + stillOn.map(channelLabel).join(', ')}>{stillOn.length} channel{stillOn.length === 1 ? '' : 's'} still attached</Tag>}</>}
                  actions={<><IconBtn title="Open the unit page" href={'/listings/' + encodeURIComponent(r.id)}><Home size={14} /></IconBtn><IconBtn title="See its channels" href={'/admin?tab=channels&listing=' + encodeURIComponent(r.id)}><Radio size={14} /></IconBtn></>} />
              )
            })}
            {offline.length > 40 && <li className="px-4 py-2 text-[12px] text-muted text-center">and {offline.length - 40} more — the Listings tab lists them all under "Offline in Guesty"</li>}
          </LeanList>
        )}
      </LeanSection>
    </div>
  )
}

// ── LISTINGS ────────────────────────────────────────────────────────────────────────────────────
function ListingsTab({ rows, today, tile, setTile, counts, channels, loading }: {
  rows: AdminRow[]; today: string; tile: TileKey; setTile: (k: TileKey) => void; counts: Record<TileKey, number>
  channels: { key: string; label: string; major: boolean }[]; loading: boolean
}) {
  const [q, setQ] = useState('')
  const [market, setMarket] = useState('all')
  const [building, setBuilding] = useState('all')
  const [sort, setSort] = useState<'needs' | 'name' | 'score' | 'optimized'>('needs')
  const markets = useMemo(() => Array.from(new Set(rows.map(r => r.market).filter(Boolean))).sort(), [rows])
  const buildings = useMemo(() => Array.from(new Set(rows.filter(r => market === 'all' || r.market === market).map(r => r.building).filter(Boolean))).sort(), [rows, market])
  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const out = rows.filter(r => rowInTile(r, tile, today)
      && (market === 'all' || r.market === market)
      && (building === 'all' || r.building === building)
      && (words.length === 0 || words.every(w => squash(r.name + ' ' + r.building).includes(squash(w)) || (r.name + ' ' + r.building).toLowerCase().includes(w))))
    const w = new Map(out.map(r => [r.id, rowWeight(r, today)]))
    return out.sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name)
      : sort === 'score' ? ((a.score ?? 101) - (b.score ?? 101))
      : sort === 'optimized' ? String(a.lastOptimized || '').localeCompare(String(b.lastOptimized || ''))
      : (w.get(b.id)! - w.get(a.id)!) || a.building.localeCompare(b.building) || a.name.localeCompare(b.name))
  }, [rows, tile, market, building, q, sort, today])

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-line bg-white p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Unit or building…" className="w-56 rounded-lg border border-line bg-white pl-7 pr-2 py-1.5 text-[12.5px]" />
          </div>
          <LeanPick value={market} onPick={setMarket} options={[{ v: 'all', label: 'All markets' }, ...markets.map(m => ({ v: m, label: m }))]} />
          <span className="ml-auto flex items-center gap-1.5"><span className="text-[11px] text-muted">Sort</span>
            <LeanPick size="sm" value={sort} onPick={setSort as any} options={[{ v: 'needs', label: 'Needs most', title: 'Channel trouble, replies owed, blocks, then optimization and photos' }, { v: 'score', label: 'Lowest score' }, { v: 'optimized', label: 'Longest since optimized' }, { v: 'name', label: 'Name' }]} /></span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted mr-1">Show</span>
          <LeanPick size="sm" value={tile} onPick={setTile} options={[{ v: 'all' as TileKey, label: <>All <span className="opacity-60 tabular-nums">{counts.all}</span></>, title: 'Every listing in Guesty, active or not' }, ...TILES.map(t => ({ v: t.key, label: <>{TILE_LABEL[t.key] || t.label} <span className="opacity-60 tabular-nums">{counts[t.key]}</span></>, title: t.hint }))]} />
        </div>
        {buildings.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted mr-1">Building</span>
            <LeanPick size="sm" value={building} onPick={setBuilding} options={[{ v: 'all', label: 'All' }, ...buildings.map(b => ({ v: b, label: b }))]} />
          </div>
        )}
      </div>

      <p className="px-1 text-[11.5px] text-muted">{list.length} listing{list.length === 1 ? '' : 's'} · chips: <b>A</b> Airbnb · <b>B</b> Booking.com · <b>V</b> Vrbo · <b>E</b> Expedia · <b>G</b> Google — green live, amber not connected, red not for sale; hover any chip for the status and the last booking.</p>

      {loading ? <LeanEmpty>Reading the portfolio…</LeanEmpty> : list.length === 0 ? <LeanEmpty>No listing matches.</LeanEmpty> : (
        <LeanList>
          {list.map(r => <ListingRow key={r.id} r={r} today={today} channels={channels} />)}
        </LeanList>
      )}
    </div>
  )
}

function ListingRow({ r, today, channels }: { r: AdminRow; today: string; channels: { key: string; label: string; major: boolean }[] }) {
  const os = optimizeState(r, today)
  const pf = photoFlags(r.photos, today)
  const perf = performance(r)
  const cover = coverVerdict(r.cover)
  const items = useMemo(() => worklist([r], today), [r, today])
  const unitHref = '/listings/' + encodeURIComponent(r.id)
  return (
    <LeanRow name={r.name} meta={<>{r.building} · {r.market}</>} tint={!r.active ? undefined : r.verdict === 'delisted' || r.verdict === 'suspended' || r.verdict === 'failed' || r.verdict === 'disconnected' ? 'rose' : undefined}
      tags={<>
        {!r.active && <Tag tone="slate" title={'Guesty status: ' + r.guestyStatus}>offline · {r.guestyStatus}</Tag>}
        {r.active && channels.map(c => {
          const cell = r.channels[c.key]; if (!cell) return null
          const title = c.label + ': ' + VERDICT_LABEL[cell.verdict]
            + (cell.approval ? ' · approval ' + cell.approval : '')
            + (cell.status && cell.verdict !== 'missing' ? ' · ' + cell.status : '')
            + (cell.since ? ' · since ' + String(cell.since).slice(0, 10) : '')
            + (cell.lastBookingAt ? ' · last booking ' + String(cell.lastBookingAt).slice(0, 10) : ' · no booking in 12 months')
            + (cell.bookings90d ? ' · ' + cell.bookings90d + ' in 90d' : '')
          // Click a channel to open the live listing there, in a new tab (Jon, 2026-11-09).
          const href = cell.url || (r.links || {})[c.key] || ''
          const tag = <Tag tone={VERDICT_TONE[cell.verdict]} title={title + (href ? ' · click to open the live listing' : '')}>{CH_SHORT[c.key] || c.label}{href ? ' ↗' : ''}</Tag>
          return href ? <a key={c.key} href={href} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="hover:opacity-80">{tag}</a> : <span key={c.key}>{tag}</span>
        })}
        {r.score != null && <Tag tone={r.score >= 80 ? 'emerald' : r.score >= RULES.lowScore ? 'slate' : 'amber'} title={'Optimize score ' + r.score + ' of 100 (title, description, photos, amenities, settings, reviews)'}>{r.score}</Tag>}
        {r.active && <Tag tone={os === 'ok' ? 'slate' : os === 'stale' ? 'slate' : 'amber'} title={r.lastOptimized ? 'Last optimized ' + String(r.lastOptimized).slice(0, 10) : 'The optimizer has never written this listing'}>{os === 'never' ? 'never optimized' : 'opt ' + agoShort(r.lastOptimized, today)}</Tag>}
        {r.active && <Tag tone={pf.length ? 'amber' : 'slate'} title={r.photos.count + ' photos · ' + r.photos.noCaption + ' without a real caption · ' + (r.photos.analyzedAt ? 'analyzed ' + String(r.photos.analyzedAt).slice(0, 10) + (r.photos.photoScore != null ? ' (quality ' + r.photos.photoScore + ')' : '') : 'never analyzed')}>{r.photos.count} photos{r.photos.noCaption ? ' · ' + r.photos.noCaption + ' no caption' : ''}{pf.indexOf('unanalyzed') >= 0 ? ' · not analyzed' : ''}</Tag>}
        {r.active && (r.reviews.count > 0 || r.reviews.owed > 0) && <Tag tone={r.reviews.owedLow ? 'rose' : r.reviews.owed ? 'amber' : 'slate'} title={r.reviews.count + ' reviews in 12 months' + (r.reviews.avg != null ? ' · average ' + r.reviews.avg : '') + ' · ' + r.reviews.owed + ' waiting for a reply · ' + r.reviews.low30 + ' low in ' + RULES.lowReviewDays + ' days' + (r.reviews.last ? ' · newest ' + r.reviews.last : '')}>{r.reviews.avg != null ? '★ ' + r.reviews.avg : 'no rating'}{r.reviews.owed ? ' · ' + r.reviews.owed + ' owed' : ''}{r.reviews.low30 ? ' · ' + r.reviews.low30 + ' low' : ''}</Tag>}
        {r.active && perf.state === 'poor' && <Tag tone="rose" title={perf.why + ' — refresh recommended: ' + (r.cover ? 'cover ' + cover.why : 'cover not analyzed')}>−{Math.round((1 - (r.perf?.revparIndex ?? 1)) * 100)}% RevPAR · refresh</Tag>}
        {r.active && perf.state === 'watch' && <Tag tone="amber" title={perf.why}>−{Math.round((1 - (r.perf?.revparIndex ?? 1)) * 100)}% RevPAR</Tag>}
        {r.active && r.cover && cover.weak && <Tag tone="amber" title={'Weak cover photo: ' + cover.why + ' — the cover decides the click in search'}>cover {cover.why}</Tag>}
        {r.blocked && !r.blocked.linked && <Tag tone="rose" title={'Out of service since ' + r.blocked.from + (r.blocked.openEnded ? ' with no end date' : ' for ' + r.blocked.nights + ' nights') + ' — ' + r.blocked.reason}>blocked{r.blocked.nights ? ' ' + r.blocked.nights + 'n' : ''}</Tag>}
        {r.blocked && r.blocked.linked && <Tag tone="slate" title="Closed by Guesty because a linked listing on the same room sold — not a fault">sibling booked</Tag>}
      </>}
      actions={<>
        <IconBtn title="Open the unit page" href={unitHref}><Home size={14} /></IconBtn>
        <IconBtn title="Photos: order, captions, analysis" href={unitHref + '#photos'}><Images size={14} /></IconBtn>
        <IconBtn title="Content: title, description, optimizer" href={unitHref + '#content'}><Wrench size={14} /></IconBtn>
        <IconBtn title="Reviews on this unit" href={unitHref + '#reviews'}><MessageSquareText size={14} /></IconBtn>
      </>}>
      {items.length ? (
        <ul className="space-y-1">
          {items.map((w, i) => <li key={i} className="text-[12.5px] text-ink/85 flex items-start gap-2"><Tag tone={SEV_TONE[w.severity]}>{SEV_WORD[w.severity]}</Tag><span><b>{w.title}</b> — {w.steps && w.steps.length ? <>{w.why.split('. ')[0]}.<ol className="list-decimal pl-5 mt-0.5 space-y-0.5">{w.steps.map((st, j) => <li key={j}>{st}</li>)}</ol></> : w.why} <Link href={here(w.href)} className="font-semibold text-ink hover:underline">{w.verb} →</Link></span></li>)}
        </ul>
      ) : <p className="text-[12.5px] text-muted">{r.active ? 'Nothing needs an administrator on this listing.' : 'Offline in Guesty — turn it back on there when it should sell again.'}</p>}
      {r.active && r.perf && <p className="text-[11.5px] text-muted">{perf.why}{r.perf.bookings90 ? ' · ' + r.perf.bookings90 + ' booking' + (r.perf.bookings90 === 1 ? '' : 's') + ' made in 90 days' : ' · no booking made in 90 days'}{r.cover ? ' · cover ' + cover.why : ' · cover not analyzed'}</p>}
      {r.active && (
        <div className="flex items-center gap-1.5 flex-wrap pt-1">
          {channels.map(c => { const cell = r.channels[c.key]; return cell && cell.url ? <a key={c.key} href={cell.url} target="_blank" rel="noopener noreferrer" className={ghost} title={'Open the live ' + c.label + ' page'}><ExternalLink size={11} /> {c.label}</a> : null })}
          <Link href={'/admin?tab=channels&listing=' + encodeURIComponent(r.id)} className={ghost}><Radio size={11} /> Channels</Link>
        </div>
      )}
    </LeanRow>
  )
}

// ── REVIEWS — the report (Jon, 2026-10-26: "a review tab, filters by date and window, stats, top
// issue, directional feedback"). Same engine as /reviews (/api/reviews/kpi), so the numbers agree. ──
type Win = '30' | '90' | '180' | '365' | 'custom'
function ReviewsTab() {
  const [win, setWin] = useState<Win>('90')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [market, setMarket] = useState('all')
  const [building, setBuilding] = useState('all')
  const [channel, setChannel] = useState('all')
  const custom = win === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to)
  const qs = new URLSearchParams()
  if (custom) { qs.set('from', from); qs.set('to', to) } else qs.set('days', win === 'custom' ? '90' : win)
  if (market !== 'all') qs.set('market', market)
  if (building !== 'all') qs.set('building', building)
  if (channel !== 'all') qs.set('channel', channel)
  const k = useCachedFetch<any>('/api/reviews/kpi?' + qs.toString(), { ttl: 300_000 })
  const d = k.data && k.data.ok !== false ? k.data : null
  const h = d?.headline || {}
  const fmt = (n: any, dp = 2) => (n == null || !Number.isFinite(Number(n))) ? '—' : Number(n).toFixed(dp)
  const Delta = ({ v, pts, good = 'up' }: { v: number | null | undefined; pts?: boolean; good?: 'up' | 'down' }) => {
    if (v == null || !Number.isFinite(Number(v))) return null
    const n = Number(v); if (Math.abs(n) < 0.005) return <span className="inline-flex items-center text-[11px] text-muted"><Minus size={11} /> flat</span>
    const up = n > 0; const isGood = good === 'up' ? up : !up
    return <span className={'inline-flex items-center gap-0.5 text-[11px] font-semibold ' + (isGood ? 'text-emerald-700' : 'text-rose-700')}>{up ? <ArrowUpRight size={11} /> : <ArrowDownRight size={11} />}{up ? '+' : ''}{pts ? Math.round(n * 10) / 10 + ' pts' : n.toFixed(2)}</span>
  }
  const months: any[] = (d?.months || []).slice(-6)
  const themes: any[] = (d?.themes || []).slice(0, 8)
  const praise: any[] = (d?.praise || []).slice(0, 5)
  const cats: any[] = d?.categories || []
  const buildings: any[] = (d?.buildings || []).slice().sort((a: any, b: any) => (a.vsPar ?? 9) - (b.vsPar ?? 9))
  const units: any[] = (d?.units || []).filter((u: any) => u.ranked && u.vsPar != null && u.vsPar <= -(d?.belowPar ?? 0.15)).slice(0, 8)
  const direction = useMemo(() => {
    if (!d) return [] as { text: string; tone: Tone; href?: string }[]
    const out: { text: string; tone: Tone; href?: string }[] = []
    if (h.prevAvg != null && h.avg != null) { const ch = h.avg - h.prevAvg; out.push({ text: `Average ${fmt(h.avg)} vs ${fmt(h.prevAvg)} the period before (${ch >= 0 ? '+' : ''}${fmt(ch)})`, tone: ch >= 0 ? 'emerald' : 'rose' }) }
    if (h.prevFiveShare != null && h.fiveShare != null) { const ch = h.fiveShare - h.prevFiveShare; out.push({ text: `Five-star share ${fmt(h.fiveShare, 0)}% vs ${fmt(h.prevFiveShare, 0)}% (${ch >= 0 ? '+' : ''}${fmt(ch, 1)} pts) — the number that moves first`, tone: ch >= 0 ? 'emerald' : 'rose' }) }
    if (themes[0]) out.push({ text: `Biggest complaint: ${themes[0].tag} in ${themes[0].n} review${themes[0].n === 1 ? '' : 's'}${themes[0].units?.[0] ? ', most often ' + themes[0].units[0].unit : ''}`, tone: 'amber', href: themes[0].units?.[0] ? '/listings/' + encodeURIComponent(themes[0].units[0].listingId) + '#reviews' : undefined })
    const worstCat = cats[0]
    if (worstCat && d.categoryBase != null) out.push({ text: `Lowest category: ${worstCat.label} ${fmt(worstCat.avg)} vs ${fmt(d.categoryBase)} Airbnb base${worstCat.ops ? ' — the field team can move this one' : ' — this one is the listing and the price'}${worstCat.units?.[0] ? '; weakest unit ' + worstCat.units[0].unit + ' (' + fmt(worstCat.units[0].avg) + ')' : ''}`, tone: worstCat.ops ? 'amber' : 'sky' })
    const falling = buildings.filter((b: any) => b.change != null && b.change <= -0.1).slice(0, 3)
    const rising = buildings.filter((b: any) => b.change != null && b.change >= 0.1).slice(0, 3)
    if (falling.length) out.push({ text: `Slipping vs the period before: ${falling.map((b: any) => b.building + ' (' + (b.change > 0 ? '+' : '') + fmt(b.change) + ')').join(', ')}`, tone: 'rose' })
    if (rising.length) out.push({ text: `Improving: ${rising.map((b: any) => b.building + ' (+' + fmt(b.change) + ')').join(', ')}`, tone: 'emerald' })
    if (h.awaitingReply) out.push({ text: `${h.awaitingReply} review${h.awaitingReply === 1 ? '' : 's'} still waiting for a reply — reply coverage ${fmt(h.replyCoverage, 0)}%${h.medianReplyHours != null ? ', median ' + fmt(h.medianReplyHours, 1) + 'h' : ''}`, tone: 'amber', href: '/reviews?tab=reply' })
    if (praise[0]) out.push({ text: `What guests praise most: ${praise.slice(0, 3).map((p: any) => p.tag + ' (' + p.n + ')').join(', ')} — keep it in the listing copy`, tone: 'emerald' })
    return out
  }, [d, h.avg, h.prevAvg, h.fiveShare, h.prevFiveShare, h.awaitingReply, h.replyCoverage, h.medianReplyHours, themes, cats, buildings, praise])

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line bg-white p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted mr-1">Window</span>
          <LeanPick value={win} onPick={setWin} options={[{ v: '30' as Win, label: '30 days' }, { v: '90' as Win, label: '90 days' }, { v: '180' as Win, label: '6 months' }, { v: '365' as Win, label: '12 months' }, { v: 'custom' as Win, label: 'Dates' }]} />
          {win === 'custom' && <span className="inline-flex items-center gap-1.5 text-[12px]"><input type="date" value={from} onChange={e => setFrom(e.target.value)} className="rounded-lg border border-line bg-white px-2 py-1 text-[12px]" /><span className="text-muted">to</span><input type="date" value={to} onChange={e => setTo(e.target.value)} className="rounded-lg border border-line bg-white px-2 py-1 text-[12px]" /></span>}
          {d && <span className="ml-auto text-[11px] text-muted">{d.from} → {d.to} · compared with the {d.days} days before</span>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted mr-1">Market</span>
          <LeanPick size="sm" value={market} onPick={setMarket} options={[{ v: 'all', label: 'All' }, ...((d?.markets || []) as string[]).map(m => ({ v: m, label: m }))]} />
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted ml-2 mr-1">Channel</span>
          <LeanPick size="sm" value={channel} onPick={setChannel} options={[{ v: 'all', label: 'All' }, ...((d?.channelList || []) as string[]).map(c => ({ v: c, label: c }))]} />
        </div>
        {(d?.buildingList || []).length > 1 && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted mr-1">Building</span>
            <LeanPick size="sm" value={building} onPick={setBuilding} options={[{ v: 'all', label: 'All' }, ...((d?.buildingList || []) as string[]).map(b => ({ v: b, label: b }))]} />
          </div>
        )}
      </div>

      {k.error && !d && <LeanEmpty>Could not read the review report: {k.error}</LeanEmpty>}
      {!d && !k.error && <LeanEmpty>Reading reviews…</LeanEmpty>}
      {d && (
        <>
          {/* STATS */}
          <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-1.5">
            <Stat label="Reviews" value={String(h.n ?? 0)} sub={h.reviewRate != null ? h.reviewRate + '% of stays' : h.staysEnded ? h.staysEnded + ' stays ended' : ''} hint="Reviews received in the window; the rate is against stays that ended in time to be reviewed" />
            <Stat label="Average" value={fmt(h.avg)} sub={<Delta v={h.prevAvg != null && h.avg != null ? h.avg - h.prevAvg : null} />} hint="All channels on the 5-star scale (Booking's /10 halved); the arrow is against the period before" />
            <Stat label="Five-star share" value={h.fiveShare != null ? fmt(h.fiveShare, 0) + '%' : '—'} sub={<Delta v={h.prevFiveShare != null && h.fiveShare != null ? h.fiveShare - h.prevFiveShare : null} pts />} hint="Airbnb/Vrbo 4.9+ and Booking 9/10+ — moves earlier than the average" />
            <Stat label="Low reviews" value={String(h.lowCount ?? 0)} sub={h.unitsInRecovery ? h.unitsInRecovery + ' units in recovery' : ''} hint="Airbnb/Vrbo 3★ or under, Booking 7/10 or under" tone={h.lowCount ? 'rose' : undefined} />
            <Stat label="Reply coverage" value={h.replyCoverage != null ? fmt(h.replyCoverage, 0) + '%' : '—'} sub={h.medianReplyHours != null ? 'median ' + fmt(h.medianReplyHours, 1) + 'h' : ''} hint="Answered replies over the reviews that could be answered" />
            <Stat label="Awaiting reply" value={String(h.awaitingReply ?? 0)} sub="" hint="Reviews with no reply, not dismissed, on active units" tone={h.awaitingReply ? 'amber' : undefined} href="/reviews?tab=reply" />
            <Stat label="Below par" value={String(h.unitsBelowPar ?? 0)} sub="units" hint={'Ranked units at least ' + (d.belowPar ?? 0.15) + ' under the portfolio\'s own average on their channel'} tone={h.unitsBelowPar ? 'amber' : undefined} />
            <Stat label="Channels" value={String((d.channels || []).length)} sub={(d.channels || []).slice(0, 3).map((c: any) => c.channel + ' ' + fmt(c.avg)).join(' · ')} hint="Average per channel in the window" />
          </div>

          {/* DIRECTION */}
          <LeanSection title="Where it is heading">
            {direction.length === 0 ? <LeanEmpty>Not enough reviews in this window to say.</LeanEmpty> : (
              <ul className="rounded-2xl border border-line bg-white divide-y divide-line/70">
                {direction.map((x, i) => (
                  <li key={i} className="flex items-start gap-2.5 px-4 py-2 text-[13px] text-ink">
                    <span className={'mt-[6px] w-2 h-2 rounded-full shrink-0 ' + (x.tone === 'emerald' ? 'bg-emerald-500' : x.tone === 'rose' ? 'bg-rose-500' : x.tone === 'amber' ? 'bg-amber-500' : 'bg-sky-500')} />
                    <span className="flex-1 min-w-0">{x.text}</span>
                    {x.href && <Link href={x.href} className="shrink-0 text-[12px] font-semibold text-muted hover:text-ink inline-flex items-center gap-0.5">Open <ArrowUpRight size={12} /></Link>}
                  </li>
                ))}
              </ul>
            )}
          </LeanSection>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* TOP ISSUES */}
            <LeanSection title="Top issues" n={themes.length}>
              {themes.length === 0 ? <LeanEmpty>No complaint tags in this window.</LeanEmpty> : (
                <LeanList>
                  {themes.map((t: any) => (
                    <LeanRow key={t.tag} name={t.tag} meta={t.unitCount ? t.unitCount + ' unit' + (t.unitCount === 1 ? '' : 's') : ''} tags={<Tag tone="amber">{t.n}</Tag>}>
                      <div className="flex items-center gap-1.5 flex-wrap">{(t.units || []).slice(0, 6).map((u: any) => <Link key={u.listingId} href={'/listings/' + encodeURIComponent(u.listingId) + '#reviews'} className={ghost}>{u.unit} <span className="text-muted">{u.n}</span></Link>)}</div>
                      {(t.samples || []).slice(0, 2).map((s: any, i: number) => <p key={i} className="text-[12px] text-ink/80 italic">“{String(s.text || s.content || s.comment || '').slice(0, 180)}”</p>)}
                    </LeanRow>
                  ))}
                </LeanList>
              )}
            </LeanSection>

            {/* CATEGORIES */}
            <LeanSection title="Categories" right={<span className="text-[11px] text-muted">Airbnb sub-scores vs {fmt(d.categoryBase)} base</span>}>
              {cats.length === 0 ? <LeanEmpty>No category ratings in this window.</LeanEmpty> : (
                <LeanList>
                  {cats.map((c: any) => (
                    <LeanRow key={c.key} name={c.label} meta={c.n + ' ratings'} tags={<><Tag tone={d.categoryBase != null && c.avg < d.categoryBase - 0.1 ? 'rose' : d.categoryBase != null && c.avg > d.categoryBase + 0.05 ? 'emerald' : 'slate'}>{fmt(c.avg)}</Tag>{c.ops && <Tag tone="sky" title="Cleanliness, check-in and communication are the field team's to move">ops</Tag>}</>}>
                      <div className="flex items-center gap-1.5 flex-wrap">{(c.units || []).slice(0, 6).map((u: any) => <Link key={u.listingId} href={'/listings/' + encodeURIComponent(u.listingId) + '#reviews'} className={ghost}>{u.unit} <span className="text-muted">{fmt(u.avg)}</span></Link>)}</div>
                    </LeanRow>
                  ))}
                </LeanList>
              )}
            </LeanSection>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* BY MONTH */}
            <LeanSection title="By month">
              {months.length === 0 ? <LeanEmpty>Nothing in this window.</LeanEmpty> : (
                <LeanList>
                  {months.map((m: any) => <LeanRow key={m.month} name={m.month} meta={m.n + ' reviews'} tags={<><Tag title="Average">{fmt(m.avg)}</Tag><Tag tone={m.fiveShare >= 70 ? 'emerald' : m.fiveShare >= 55 ? 'slate' : 'amber'} title="Five-star share">{fmt(m.fiveShare, 0)}% 5★</Tag>{m.lowCount > 0 && <Tag tone="rose" title="Low reviews">{m.lowCount} low</Tag>}</>} />)}
                </LeanList>
              )}
            </LeanSection>

            {/* BUILDINGS */}
            <LeanSection title="Buildings" right={<span className="text-[11px] text-muted">worst vs par first</span>}>
              {buildings.length === 0 ? <LeanEmpty>Nothing in this window.</LeanEmpty> : (
                <LeanList>
                  {buildings.slice(0, 12).map((b: any) => <LeanRow key={b.building} name={b.building} meta={b.n + ' reviews' + (b.unitsReviewed ? ' · ' + b.unitsReviewed + ' units' : '')} tags={<><Tag title="Average">{fmt(b.avg)}</Tag><Tag tone={b.vsPar != null && b.vsPar <= -(d.belowPar ?? 0.15) ? 'rose' : b.vsPar > 0.05 ? 'emerald' : 'slate'} title="Against the portfolio's own average on each channel">{b.vsPar > 0 ? '+' : ''}{fmt(b.vsPar)} vs par</Tag><Delta v={b.change} />{b.awaiting > 0 && <Tag tone="amber">{b.awaiting} to reply</Tag>}</>} />)}
                </LeanList>
              )}
            </LeanSection>
          </div>

          <div className="grid lg:grid-cols-2 gap-4">
            {/* UNITS BELOW PAR */}
            <LeanSection title="Units below par" n={units.length}>
              {units.length === 0 ? <LeanEmpty>No ranked unit is below par in this window.</LeanEmpty> : (
                <LeanList>
                  {units.map((u: any) => <LeanRow key={u.listingId} lead={<Link href={'/listings/' + encodeURIComponent(u.listingId) + '#reviews'} className={ghost}>Open</Link>} name={u.unit} meta={u.building + ' · ' + u.n + ' reviews'} tags={<><Tag tone="rose">{fmt(u.vsPar)} vs par</Tag><Tag>{fmt(u.avg)}</Tag>{u.topTheme && <Tag tone="amber" title="Most-mentioned complaint">{u.topTheme.tag}</Tag>}{u.awaiting > 0 && <Tag tone="amber">{u.awaiting} to reply</Tag>}</>} />)}
                </LeanList>
              )}
            </LeanSection>

            {/* PRAISE */}
            <LeanSection title="What guests praise" n={praise.length}>
              {praise.length === 0 ? <LeanEmpty>No praise tags in this window.</LeanEmpty> : (
                <LeanList>
                  {praise.map((t: any) => <LeanRow key={t.tag} name={t.tag} meta={t.unitCount ? t.unitCount + ' units' : ''} tags={<Tag tone="emerald">{t.n}</Tag>} />)}
                </LeanList>
              )}
            </LeanSection>
          </div>
          <p className="px-1 text-[11px] text-muted">Same engine as the Reviews page: thresholds are per channel (five-star = Airbnb/Vrbo 4.9+, Booking 9/10+; low = 3★ or 7/10 and under) and "par" is the portfolio's own average on that channel in this window.</p>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, sub, hint, tone, href }: { label: string; value: string; sub?: ReactNode; hint: string; tone?: 'rose' | 'amber'; href?: string }) {
  const inner = (
    <>
      <span className={'block text-[20px] leading-none font-bold tabular-nums ' + (tone === 'rose' ? 'text-rose-700' : tone === 'amber' ? 'text-amber-800' : 'text-ink')}>{value}</span>
      <span className="block mt-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted truncate">{label}</span>
      {sub ? <span className="block text-[11px] text-muted truncate">{sub}</span> : null}
    </>
  )
  const cls = 'text-left rounded-xl border border-line bg-white px-2.5 py-2 min-w-0 block'
  return (
    <Tip label={hint}>
      {href ? <Link href={href} className={cls + ' hover:border-ink/30 w-full'}>{inner}</Link> : <div className={cls + ' w-full'}>{inner}</div>}
    </Tip>
  )
}
