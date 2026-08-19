// QUALITY domain — health scores, walk findings, the review action board, sentiment, FF&E, projects.
//
// The signal Eve was missing most here is review_actions.reopened_count: an action that keeps
// reopening is a real, structural problem, not a task somebody forgot. That number is the single
// best "this building has something actually wrong with it" indicator in the whole database.
import 'server-only'
import { computeListingHealth, rollupBuildingHealth } from '@/lib/health-score'
import { openWorkByListing } from '@/lib/open-work'
import { THEMES } from '@/lib/review-themes'
import { listProjects } from '@/lib/projects'
import type { EveTool, EveDomain } from './types'
import { obj, S } from './types'
import { clampLimit, clampDays, shiftDay, lc, has, safe, cap, chunk, resolveListing, normStar, DEAD_LISTING } from './ctx'

export const QUALITY_TOOLS: EveTool[] = [
  {
    name: 'property_health',
    description: 'The five-pillar health score for a unit or a building: overall score and band (elite/healthy/watch/risk/critical), the ops pillar (rating, review volume, response rate, open work), the listing-setup pillar, the revenue pillar, per-channel scores against each OTA\'s badge threshold (Superhost 4.8, Premier 4.6, Superb 9.0), and a ranked ISSUES list with the action and the point gain for each. Use this for "what is wrong with X" and "which units are dragging Y down".',
    input_schema: obj({ name: S.str, id: S.str, building: S.str, limit: S.num }),
    run: async (input, ctx) => {
      const unit = resolveListing(ctx, input)
      const ids = unit ? [unit.id]
        : input?.building ? ctx.idsForBuilding(String(input.building))
        : []
      if (!ids.length) return { error: 'Give me a unit (name/id) or a building.' }
      const live = ids.filter(id => !DEAD_LISTING.test(ctx.listingMeta[id].status))
      const use = (live.length ? live : ids).slice(0, 60)
      const [listRes, openWork] = await Promise.all([
        safe(ctx.db.from('guesty_listings').select('id,nickname,title,status,building,address_city,amenities,pictures,raw,last_optimized').in('id', use).order('id'), { data: [] } as any),
        safe(openWorkByListing(ctx.db) as any, {} as any),
      ])
      const revByListing: Record<string, any[]> = {}
      const parts = chunk(use, 40)
      for (const part of parts) {
        const { data } = await ctx.db.from('guesty_reviews').select('listing_id,rating,content,created_at,has_reply,channel,excluded_from_score').in('listing_id', part).eq('excluded_from_score', false).order('created_at', { ascending: false }).limit(2000)
        for (const r of (data || [])) { const k = String((r as any).listing_id); (revByListing[k] = revByListing[k] || []).push(r) }
      }
      const results = (listRes.data || []).map((l: any) => {
        const reviews = (revByListing[String(l.id)] || []).map((r: any) => ({ rating: r.rating, channel: r.channel, content: r.content, created_at: r.created_at, hasReply: !!r.has_reply }))
        const h: any = computeListingHealth(l, reviews, { openWork: (openWork as any)[String(l.id)] || 0 })
        return {
          unit: l.nickname || l.title, listing_id: l.id, building: ctx.buildingOf(l.id),
          score: h.score, band: h.band, unrated: h.unrated, pillars: h.pillars,
          reviews: h.review, channels: (h.channels || []).map((c: any) => ({ channel: c.label, score: c.score, stars: c.avgStars, reviews: c.reviewCount, badge: c.badge })),
          issues: (h.issues || []).slice(0, 8).map((i: any) => ({ severity: i.severity, title: i.title, action: i.action, owner: i.owner, gain: i.gain })),
        }
      }).sort((a: any, b: any) => (a.score ?? 999) - (b.score ?? 999))
      const scores = results.map((r: any) => r.score).filter((s: any) => Number.isFinite(s))
      const roll: any = scores.length ? rollupBuildingHealth(scores) : null
      return {
        scope: unit ? unit.meta.name : String(input?.building || ''),
        units_scored: results.length,
        building_rollup: roll ? { score: roll.score, band: roll.band, mean: roll.mean, weak_units: roll.weak, worst: roll.min } : null,
        units: results.slice(0, clampLimit(input?.limit, 25, 60)),
      }
    },
  },

  {
    name: 'walk_findings',
    description: 'What the walks and audits actually found — real findings only (the per-room OK checkmarks and the walk-template tag rows are filtered out). Returns room, kind (maintenance|replace|add|clean|faq|inventory), title, severity and status. Filter by unit, building, kind, severity, open_only, days.',
    input_schema: obj({ name: S.str, id: S.str, building: S.str, kind: S.str, severity: S.str, open_only: S.bool, days: S.num, limit: S.num }),
    run: async (input, ctx) => {
      const lim = clampLimit(input?.limit, 50, 150)
      const days = clampDays(input?.days, 180, 730)
      const unit = resolveListing(ctx, input)
      let q = ctx.db.from('audit_items').select('id,listing_id,room,kind,item_type,title,note,severity,status,created_at')
        .gte('created_at', new Date(Date.now() - days * 86400000).toISOString())
      if (unit) q = q.eq('listing_id', unit.id)
      if (input?.kind) q = q.eq('kind', lc(input.kind))
      if (input?.severity) q = q.eq('severity', lc(input.severity))
      if (input?.open_only !== false) q = q.in('status', ['open', 'task_created', 'approved', 'ordered', 'arriving'])
      const { data, error } = await q.order('created_at', { ascending: false }).order('id').limit(lim)
      if (error) return { error: 'Audit items unavailable: ' + error.message.slice(0, 120) }
      // pm-ok rows are the per-room OK/FLAG checkmarks; kind 'tag' rows record which walk template ran.
      let rows = (data || []).filter((a: any) => a.item_type !== 'pm-ok' && a.kind !== 'tag').map((a: any) => ({
        unit: ctx.nameOf(a.listing_id), building: ctx.buildingOf(a.listing_id), listing_id: a.listing_id,
        room: a.room, kind: a.kind, title: a.title, note: String(a.note || '').slice(0, 180),
        severity: a.severity, status: a.status, found: String(a.created_at).slice(0, 10),
      }))
      if (input?.building) rows = rows.filter((r: any) => has(r.building, input.building))
      const byKind: Record<string, number> = {}
      const byRoom: Record<string, number> = {}
      for (const r of rows) { byKind[r.kind] = (byKind[r.kind] || 0) + 1; byRoom[String(r.room || 'unknown')] = (byRoom[String(r.room || 'unknown')] || 0) + 1 }
      return { window_days: days, count: rows.length, truncated: cap(data || [], lim).truncated, by_kind: byKind, by_room: byRoom, high_severity: rows.filter((r: any) => r.severity === 'high').length, findings: rows.slice(0, 80) }
    },
  },

  {
    name: 'review_actions',
    description: 'The review ACTION board — recurring complaint themes turned into work, one row per (unit, theme). THE KEY FIELD IS reopened_count: a theme that keeps coming back after being marked done is a structural problem, not a forgotten task. Returns theme, unit, building, who owns it (clean|inspection|maintenance), mentions, worst rating, guest quotes as evidence, status and severity. Filter by status (open|doing|done|dismissed|live), kind, building.',
    input_schema: obj({ status: S.str, kind: S.str, building: S.str, limit: S.num }),
    run: async (input, ctx) => {
      const lim = clampLimit(input?.limit, 50, 120)
      let q = ctx.db.from('review_actions').select('id,listing_id,unit,building,theme_key,kind,title,action,severity,mentions,worst_rating,evidence,first_seen,last_seen,status,reopened_count,note')
      const st = lc(input?.status || 'live')
      if (st === 'live') q = q.in('status', ['open', 'doing'])
      else if (st !== 'all') q = q.eq('status', st)
      if (input?.kind) q = q.eq('kind', lc(input.kind))
      const { data, error } = await q.order('reopened_count', { ascending: false }).order('mentions', { ascending: false }).limit(lim)
      if (error) return { error: 'Review actions unavailable (migration 022 may not have run).' }
      let rows = (data || []).map((r: any) => ({
        theme: r.theme_key, title: r.title, action: r.action, owner: r.kind,
        unit: r.unit || ctx.nameOf(r.listing_id), building: r.building || ctx.buildingOf(r.listing_id),
        mentions: r.mentions, worst_rating: normStar(r.worst_rating), severity: r.severity,
        status: r.status, reopened_count: r.reopened_count,
        first_seen: r.first_seen, last_seen: r.last_seen,
        quotes: (Array.isArray(r.evidence) ? r.evidence : []).slice(0, 3).map((e: any) => String(e?.quote || '').slice(0, 160)),
      }))
      if (input?.building) rows = rows.filter((r: any) => has(r.building, input.building))
      const byTheme: Record<string, number> = {}
      for (const r of rows) byTheme[r.theme] = (byTheme[r.theme] || 0) + 1
      return {
        count: rows.length, by_theme: byTheme,
        repeat_offenders: rows.filter((r: any) => (r.reopened_count || 0) > 0).length,
        urgent: rows.filter((r: any) => r.severity === 'urgent').length,
        known_themes: THEMES.map((t: any) => t.key),
        actions: rows,
      }
    },
  },

  {
    name: 'sentiment',
    description: 'Guest sentiment from the actual message threads: which guests are unhappy RIGHT NOW, their score 1-5, band, the top issue, an excerpt of what they said, whether we still owe them a reply, and whether the reservation got auto-flagged sensitive. Filter by days, band (negative|neutral|positive), dissatisfied_only, awaiting_reply_only, building.',
    input_schema: obj({ days: S.num, band: S.str, dissatisfied_only: S.bool, awaiting_reply_only: S.bool, building: S.str, limit: S.num }),
    run: async (input, ctx) => {
      const days = clampDays(input?.days, 30, 120)
      const lim = clampLimit(input?.limit, 40, 100)
      let q = ctx.db.from('guesty_conversation_sentiment')
        .select('conversation_id,guest_name,channel,reservation_id,listing_id,score,band,dissatisfied,triggers,top_issue,reason,guest_excerpt,last_message_at,last_guest_at,awaiting_reply,status,marked_sensitive_at')
        .gte('last_message_at', new Date(Date.now() - days * 86400000).toISOString())
      if (input?.band) q = q.eq('band', lc(input.band))
      if (input?.dissatisfied_only) q = q.eq('dissatisfied', true)
      if (input?.awaiting_reply_only) q = q.eq('awaiting_reply', true)
      const { data, error } = await q.order('last_message_at', { ascending: false }).limit(lim)
      if (error) return { error: 'Sentiment unavailable: ' + error.message.slice(0, 120) }
      let rows = (data || []).map((s: any) => ({
        guest: s.guest_name, channel: s.channel, unit: ctx.nameOf(s.listing_id), building: ctx.buildingOf(s.listing_id),
        score: s.score, band: s.band, dissatisfied: !!s.dissatisfied, top_issue: s.top_issue,
        why: String(s.reason || '').slice(0, 200), quote: String(s.guest_excerpt || '').slice(0, 200),
        awaiting_reply: !!s.awaiting_reply, triggers: s.triggers, status: s.status,
        sensitive: !!s.marked_sensitive_at, last_message: s.last_message_at,
        conversation_id: s.conversation_id, reservation_id: s.reservation_id,
      }))
      if (input?.building) rows = rows.filter((r: any) => has(r.building, input.building))
      const byIssue: Record<string, number> = {}
      for (const r of rows) { const k = lc(r.top_issue).slice(0, 40); if (k) byIssue[k] = (byIssue[k] || 0) + 1 }
      return {
        window_days: days, count: rows.length, truncated: cap(data || [], lim).truncated,
        dissatisfied: rows.filter((r: any) => r.dissatisfied).length,
        awaiting_reply: rows.filter((r: any) => r.awaiting_reply).length,
        top_issues: byIssue, threads: rows,
      }
    },
  },

  {
    name: 'ffe_status',
    description: 'Furniture and equipment: how far through the FF&E walk each unit is, what was marked add/replace/fix/keep, the open FIX list with estimated costs, and order lines by stage (draft/sent/approved/ordered/delivered/installed). Filter by unit, building, or open_fixes_only.',
    input_schema: obj({ name: S.str, id: S.str, building: S.str, open_fixes_only: S.bool, limit: S.num }),
    money: true,
    run: async (input, ctx) => {
      const lim = clampLimit(input?.limit, 40, 100)
      const unit = resolveListing(ctx, input)
      const ids = unit ? [unit.id] : input?.building ? ctx.idsForBuilding(String(input.building)) : []
      const [fixRes, statusRes, lineRes] = await Promise.all([
        safe(ctx.db.from('ffe_fixes').select('listing_id,unit_name,building,room,title,note,est_cost,status,assigned_to,created_at').order('created_at', { ascending: false }).limit(lim), { data: [] } as any),
        safe(ctx.db.from('ffe_unit_status').select('listing_id,completed_at,completed_by,notes').limit(400), { data: [] } as any),
        safe(ctx.db.from('ffe_order_lines').select('listing_id,unit_name,building,room,title,product,qty,unit_cost,stage,vendor').order('created_at', { ascending: false }).limit(lim), { data: [] } as any),
      ])
      const inScope = (lid: any) => !ids.length || ids.indexOf(String(lid)) >= 0
      let fixes = (fixRes.data || []).filter((f: any) => inScope(f.listing_id))
      if (input?.open_fixes_only !== false) fixes = fixes.filter((f: any) => ['open', 'doing'].indexOf(lc(f.status)) >= 0)
      const lines = (lineRes.data || []).filter((l: any) => inScope(l.listing_id))
      const done = (statusRes.data || []).filter((s: any) => inScope(s.listing_id) && s.completed_at)
      const byStage: Record<string, number> = {}
      for (const l of lines) byStage[String(l.stage)] = (byStage[String(l.stage)] || 0) + 1
      return {
        scope: unit ? unit.meta.name : (input?.building || 'portfolio'),
        walks_completed: done.length,
        walks_scope: ids.length || Object.keys(ctx.listingMeta).length,
        open_fixes: fixes.map((f: any) => ({ unit: f.unit_name || ctx.nameOf(f.listing_id), building: f.building, room: f.room, item: f.title, note: String(f.note || '').slice(0, 140), est_cost: f.est_cost, status: f.status, assigned_to: f.assigned_to })),
        order_lines_by_stage: byStage,
        order_lines: lines.slice(0, 40).map((l: any) => ({ unit: l.unit_name || ctx.nameOf(l.listing_id), room: l.room, item: l.title, product: l.product, qty: l.qty, unit_cost: l.unit_cost, stage: l.stage, vendor: l.vendor })),
      }
    },
  },

  {
    name: 'projects',
    description: 'Renovations, rollouts, onboardings and other work that is a PROJECT rather than a task. Returns each project with stage, priority, lead, due date, budget vs spent, progress %, and a health state (ok|due|late|blocked|done). Filter by stage, market, lead, or open_only.',
    input_schema: obj({ stage: S.str, market: S.str, lead: S.str, open_only: S.bool, limit: S.num }),
    money: true,
    run: async (input, ctx) => {
      const rows: any[] = await safe(listProjects({ market: input?.market ? String(input.market) : undefined, lead: input?.lead ? String(input.lead) : undefined }) as any, [] as any)
      let list = rows
      if (input?.stage) list = list.filter((p: any) => lc(p.stage) === lc(input.stage))
      else if (input?.open_only !== false) list = list.filter((p: any) => ['done', 'cancelled'].indexOf(lc(p.stage)) < 0)
      const byStage: Record<string, number> = {}
      for (const p of list) byStage[String(p.stage)] = (byStage[String(p.stage)] || 0) + 1
      return {
        count: list.length, by_stage: byStage,
        late: list.filter((p: any) => p.health?.state === 'late').length,
        blocked: list.filter((p: any) => p.health?.state === 'blocked').length,
        projects: list.slice(0, clampLimit(input?.limit, 30, 60)).map((p: any) => ({
          ref: p.ref, title: p.title, stage: p.stage, priority: p.priority, lead: p.lead_email,
          market: p.market, building: p.building, due_on: p.due_on,
          budget: p.budget_cents != null ? p.budget_cents / 100 : null,
          spent: p.spent_cents != null ? p.spent_cents / 100 : null,
          progress_pct: p.progress?.pct ?? null, health: p.health?.state, health_reason: p.health?.reason,
        })),
      }
    },
  },
]

export const QUALITY_DOMAIN: EveDomain = {
  key: 'quality',
  label: 'Quality',
  blurb: 'Health scores with their issue lists, walk/audit findings, the review action board (watch reopened_count), guest sentiment, FF&E and projects. Also holds the review and listing lookups.',
  tools: QUALITY_TOOLS,
}
