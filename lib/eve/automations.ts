// THE AUTOMATION REGISTRY — one place that knows what this app does while nobody is watching.
//
// Jon, 2026-08-26: "she needs to understand all automations."
//
// The audit that started this work found that Eve — who can read almost every table in the
// business — had no route to a single automation SWITCH. She could not answer "is guest orders
// on", "who gets the 7am brief", "what fires a late-clean alert", "did the sentiment scan run
// today". Not because the data was hidden, but because nothing had ever written down what the
// automations ARE. The schedules lived in vercel.json, the switches in a dozen app_settings keys,
// the descriptions in the head of whoever built each one.
//
// So this file is that written-down thing, and it is deliberately the ONLY copy:
//   - `lib/eve/audit.ts` builds its expected-cron list from here, so adding an automation
//     automatically puts it under the audit's watch instead of quietly outside it. Three crons
//     were silently dropped by a merge once; the audit only noticed the fourteen it had been told
//     about by hand.
//   - the `automations` tool reads it, resolves each switch against the LIVE setting, and joins
//     the last recorded run.
//   - the settings page it points at is where a human goes to change the answer.
//
// WHAT MAKES AN ENTRY HONEST. `enabledPath` is a dot-path into the stored config, and a missing
// key is reported as "unset (off)" rather than assumed on — the maintenance briefs were
// `enabled:true` with empty recipient lists for weeks, sending nothing, and every dashboard said
// they were fine. Default-off automations are marked so, because "no orders today" and "the orders
// automation has never been switched on" are different sentences. The one exception is a switch the
// CODE reads as on when it is missing (`defaultOn`): that entry is reported on, because calling a
// live automation off is the same lie told the other way.
import 'server-only'
import { getSetting } from '@/lib/app-settings'

export type AutomationArea = 'sync' | 'guests' | 'ops' | 'money' | 'slack' | 'eve'

export type AutomationDef = {
  key: string
  label: string
  /** Plain English, one sentence, written for someone who has never seen the code. */
  what: string
  area: AutomationArea
  /** The vercel.json path (crons) or a note for event-driven ones. */
  path?: string
  trigger?: string
  /** app_settings key holding its configuration, when it has one. */
  configKey?: string
  /** Dot-path inside that config to the on/off switch. Absent = always on. */
  enabledPath?: string
  /** Dot-paths to recipient lists worth surfacing. */
  recipientPaths?: string[]
  /** Where a human changes it. */
  settingsPath?: string
  /** True when the shipped default is OFF and someone must switch it on deliberately. */
  defaultOff?: boolean
  /** True when the code reads a MISSING switch as ON — only an explicit false turns it off. */
  defaultOn?: boolean
  /** What it records into automation_runs / email_log, when it records anything. */
  receipt?: 'automation_runs' | 'email_log' | 'slack_outbox' | 'none'
  notes?: string
}

export const AUTOMATIONS: AutomationDef[] = [
  // ---- Keeping the mirror true to Guesty / Breezeway / Homebase ------------------------------
  { key: 'reservations', label: 'Bookings sync', area: 'sync', path: '/api/cron/reservations',
    what: 'Pulls new and changed Guesty reservations into our mirror every five minutes. Everything dated in this app rests on it.', receipt: 'automation_runs' },
  { key: 'reservations-full', label: 'Bookings full resync', area: 'sync', path: '/api/cron/reservations-full',
    what: 'Once a day, re-pulls every booking checking out from 45 days ago onward rather than trusting the incremental watermark, so a missed webhook, a late refund or an owner-stay reclassification on a stay already over cannot rot quietly.', receipt: 'automation_runs' },
  { key: 'sync-reviews', label: 'Reviews sync', area: 'guests', path: '/api/cron/sync-reviews',
    what: 'Pulls guest reviews from Guesty on their own cadence, per channel — the feed whose per-channel death hid behind a portfolio-wide freshness check for a week.', receipt: 'automation_runs' },
  { key: 'guesty-full', label: 'Guesty full reconcile', area: 'sync', path: '/api/sync/guesty', trigger: 'manual — Sync button',
    what: 'When someone presses Sync now (Home, Messages): re-pulls custom fields, listings, reservations, conversations, reviews and recent messages in one pass. Not on a schedule — each of those has its own cron.', receipt: 'none' },
  { key: 'guesty-catalog', label: 'Listings & custom fields sync', area: 'sync', path: '/api/cron/guesty-catalog',
    what: 'Twice a day, re-pulls listings and custom-field definitions from Guesty — the only entities nothing else syncs — then runs the channel-connections check on the fresh listings.', receipt: 'automation_runs' },
  { key: 'guest-comms', label: 'Conversations & messages sync', area: 'guests', path: '/api/cron/guest-comms',
    what: 'Pulls guest conversations and their recent messages, then recomputes response times for anything that moved.', receipt: 'automation_runs' },
  { key: 'breezeway-tasks', label: 'Breezeway task mirror', area: 'ops', path: '/api/cron/breezeway-tasks',
    what: 'Mirrors Breezeway tasks and their comments, and raises the behind-schedule signal the ops board reads.', receipt: 'automation_runs' },
  { key: 'owner-statements', label: 'Owner statements sync', area: 'money', path: '/api/sync/owner-statements',
    what: 'Mirrors Guesty owner statements and their line items — the source of truth for anything owner-facing.', receipt: 'automation_runs' },
  { key: 'revenue-sync', label: 'Revenue app mirror', area: 'money', path: '/api/cron/revenue-sync',
    what: "Every four hours, pulls the boss's revenue app feeds (snapshots, budget, owner map) into the rev_* mirror.", receipt: 'automation_runs' },
  { key: 'schedule-sync', label: 'Scheduler refresh', area: 'ops', path: '/api/schedule/sync', trigger: 'manual — Sync button',
    what: 'When someone presses Sync on the Scheduler (or its Weekly tab): re-pulls the reservations and the Breezeway task mirror and rebuilds the schedule, so a change made moments ago shows at once. Not on a schedule.', receipt: 'none' },
  { key: 'billing-detail', label: 'Billable-hours backfill', area: 'money', path: '/api/cron/billing-detail',
    what: 'Walks Breezeway task cost and supply detail into the billing mirror, current month first then backwards.', receipt: 'automation_runs',
    notes: 'Until it catches up, every maintenance recovery rate reads LOWER than reality.' },
  { key: 'billing-ai', label: 'Routine-task billing check', area: 'money', path: '/api/cron/billing-ai',
    what: 'Nightly: every routine task (unit check / strip) with a real description, this month and last, gets one model verdict — no charge (it closes itself at $0) or bill (it stays open with the reason and a suggested amount). A human still approves every dollar; a blank or template description closes at $0 with no model call.', receipt: 'automation_runs',
    notes: 'lib/billing-ai.ts. Up to three batches per month per night; the billing desk judges the rest on demand.' },

  { key: 'channel-check', label: 'Channel connections check', area: 'sync', trigger: 'chained — runs inside the listings sync (/api/cron/guesty-catalog), twice a day',
    what: 'Reads every listing\u2019s channel connections from the fresh Guesty pull, compares them with the last snapshot, and says in Slack when a listing has dropped off Airbnb, Booking.com, Vrbo or Expedia. Opens an audit finding per listing until it is live again.', receipt: 'automation_runs',
    settingsPath: '/users \u2192 Settings \u2192 Slack alerts \u2192 Listing dropped off a channel' },

  // ---- Watching the machine ------------------------------------------------------------------
  { key: 'watchdog', label: 'Sync watchdog', area: 'sync', path: '/api/cron/watchdog',
    what: 'Checks that each feed actually ran, per channel, and says so in Slack when one dies or recovers.', receipt: 'automation_runs' },
  { key: 'eve-audit', label: "Eve's standing audit", area: 'eve', path: '/api/cron/eve-audit',
    what: 'Runs her own audit of what is broken right now and posts only NEW findings, with one roll-up after 7am.', receipt: 'automation_runs',
    settingsPath: '/users → Settings → Eve → Audits' },
  { key: 'eve-metrics', label: 'Daily baselines', area: 'eve', path: '/api/cron/eve-metrics',
    what: 'Snapshots the day\'s numbers so trends and anomalies have a history to sit against, and grades recommendations that came due.', receipt: 'automation_runs',
    notes: 'Without this, trend() and anomaly_scan() have nothing to compare against.' },
  { key: 'eve-brain', label: "Eve's nightly reflection", area: 'eve', path: '/api/cron/eve-metrics', trigger: 'chained — the 08:50 UTC pass of /api/cron/eve-metrics',
    what: 'At 08:50 UTC (4:50am ET; 3:50am in winter): grades yesterday\'s predictions against the records, strengthens or weakens the beliefs behind them, retires faded self-made beliefs and merges duplicates, reflects on yesterday (journal, new patterns, beliefs borne out or contradicted, at most one question for Jon), then makes today\'s checkable calls on late cleans and guest issues against the plain base rate.', receipt: 'automation_runs',
    notes: 'Rides the eve-metrics cron line: its 08:50 UTC pass (a signed-in admin can run it with ?phase=brain). Stored in eve_knowledge as journal:<day> and predictions:<day>; belief confidence on eve_memory. Two model calls (task eve-brain). A person\'s belief is never lowered by data, only asked about.' },
  { key: 'eve-dossiers', label: "Eve's dossiers", area: 'eve', path: '/api/cron/eve-metrics', trigger: 'chained — the 09:50 UTC pass of /api/cron/eve-metrics',
    what: 'At 09:50 UTC (5:50am ET; 4:50am in winter): rebuilds a file on every building, every unit with something going on, and every cleaner active in the last 30 days: cleans and how many were done before 4pm, guest issues, reviews, arrivals, what changed since the last file, and her two-line read of each building. Loaded into her head whenever one comes up.', receipt: 'automation_runs',
    notes: 'Rides the eve-metrics cron line: its 09:50 UTC pass (?phase=dossiers by hand). eve_knowledge type dossier. One model call for all the building reads. People\'s files are facts, not verdicts, and stay out of shared rooms.' },
  { key: 'slack-eve', label: '@Eve in Slack', area: 'eve', trigger: 'Slack Events API — app_mention',
    what: 'Answers when somebody @-mentions her at the FRONT of a Slack message (or in the middle of a sentence), in a thread, shaped for a shared room. The asker\'s Lighthouse permissions govern the answer, money redaction included. A receipt per answer since 2026-09-30.',
    receipt: 'automation_runs',
    notes: 'Deliberately does NOT subscribe to message.im: reading a DM needs im:history, and not having that scope is the only reason she is structurally unable to read the team\'s direct messages. Every answer goes in a thread so the channel only ever shows one line.' },
  { key: 'slack-translate', label: 'Eve translates in Slack', area: 'eve', trigger: 'Slack Events API — app_mention, tag at the END of the message',
    what: 'A message with @Eve tagged at the very end is translated in its thread — Spanish to English, English to Spanish, translation only, in every channel she is in. People tagged in the message stay tagged in the translation. One receipt per tag: translated, fell back to the apology line, nothing to translate, or the Slack post failed and why.',
    receipt: 'automation_runs',
    notes: 'The rule lives in lib/eve/tag-position.ts and runs before Eve is called at all (one Haiku call). The event is acknowledged to Slack at once and the work runs after, so Slack never times out; a retry rescues an attempt that died. Silence is the failure to look for: check the last receipt here first, then whether the person selected Eve from the autocomplete (a typed "@Eve" is plain text and sends no event).' },
  { key: 'eve-ask', label: 'Morning ask', area: 'eve', path: '/api/cron/eve-ask',
    what: 'Once each morning, sends the few things most worth a human answer — broken things first, then what she cannot work out for herself — to a bound Telegram contact, and turns the reply into a memory or a decision.',
    configKey: 'eve_ask', enabledPath: 'enabled', receipt: 'automation_runs',
    settingsPath: '/users → Settings → Eve → Telegram',
    notes: 'Budget is app_settings eve_ask.maxPerDay (default 3) and is counted from what actually went out, so a double-fired cron cannot double-tap anyone. Silence for three days closes an ask rather than repeating it.' },
  { key: 'eve-learn', label: 'Nightly learning pass', area: 'eve', path: '/api/eve/learn',
    what: 'Mines messages, reviews and her own chat log into knowledge, expires beliefs that stopped being true, and writes new questions for a human.', receipt: 'automation_runs',
    settingsPath: '/users → Settings → Eve → Memory' },
  { key: 'eve-review', label: "The operator's review", area: 'eve', path: '/api/cron/eve-review',
    what: 'Monday 06:30 ET, and on demand from the Review tab or by asking Eve for a plan: reads one evidence pack (the week\'s KPIs vs last week, anomalies, sweep findings, audits, Slack items, glitches, low reviews, checklist ticks, app usage, her own track record) and writes what moved and why, three to six ranked plans, critiques with evidence, and at most four questions the data cannot answer. Plans land in the recommendation ledger to be accepted and graded; questions land on /command.',
    receipt: 'automation_runs', settingsPath: '/users → Settings → Eve → Review',
    notes: 'One Fable-tier call a week (task eve-review). The first run also retires the old per-building template questions. ?focus= steers a run. Needs migration 099.' },
  { key: 'quality-audit', label: 'Quality auditor (Monday)', area: 'eve', path: '/api/cron/eve-review',
    what: 'Rides the Monday review. One review-tier call over a 90-day quality pack — repeat guest issues per unit, low-review themes by building, crew catch / miss / caught-not-fixed rates, bad-review inspections raised vs walked, unhappy guest threads — and names the three weaknesses most costing reviews and revenue, each with evidence, a root cause, one action, an owner role and a metric. Each is filed as a plan in area quality and graded in 21 days; a short version goes to #leadership (slack_post rung).',
    receipt: 'automation_runs', settingsPath: '/users → Settings → Eve → Direction',
    notes: 'lib/eve/quality-audit.ts. Skip with ?quality=0 on the review route. A thin block is reported as "no signal", never filled in.' },
  { key: 'schedule-check', label: 'Schedule check (5pm)', area: 'eve', path: '/api/cron/slack-watch',
    what: 'Rides the hourly line at 5pm ET. Looks at tomorrow the way the schedule manager does, with what Eve has learned about the team (lib/eve/schedule-knowledge: who cleans what, cleans a day, real minutes a clean, the week): departure cleans with nobody on them (same-day first, with the check-in time), people OFF on Homebase but assigned, people over their own usual day, same-day turns sitting late, the day short against the people rostered, and the next three days. One post per market in its housekeeping room (Spanish first), one line to #leadership only when a day is short. Suggests the usual people; never assigns.',
    receipt: 'automation_runs', settingsPath: '/users → Settings → Eve → Agent mode (slack_post rung)',
    notes: 'lib/eve/schedule-check.ts. GET /api/eve/schedule-check?preview=1 shows tomorrow\'s text without posting; ?date=YYYY-MM-DD for another day. Knowledge is rebuilt daily into app_settings eve_schedule_knowledge and filed as memories.' },
  { key: 'eve-scorecard', label: 'Team-Member Score (Monday)', area: 'eve', path: '/api/cron/eve-review',
    what: 'Rides the Monday review. The Eve Team-Member Score (0–100) from the 2026-09-30 audit: Accuracy, Work moved, Autonomy, Learning, Reliability, Safety & trust, Cost, Adoption — five pulled from her own records (agent log, loops, learning audit, receipts, AI usage), three from a graded sample of her Slack posts that a person enters at /api/eve/scorecard. No model call.',
    receipt: 'automation_runs', settingsPath: '/users → Settings → Eve → Learning',
    notes: 'lib/eve/scorecard.ts. GET /api/eve/scorecard?days=7 shows it any time; POST enters the graded sample (correct/useful/tone 0–2, thanked/corrected/followUp 0–1, incidents). Baseline Sept 2026: 46 (Assistant).' },
  { key: 'expectations', label: 'Expectations desk (Monday)', area: 'eve', path: '/api/cron/eve-review',
    what: 'Rides the Monday review, and runs on demand from the Eve tab. Reads 45 days of reviews (every rating), inbound guest messages that ask about or hit something upfront copy should have covered (parking, fees, deposits, check-in, codes, wifi, pool and gym hours, building rules, noise, what is in the unit) and the threads the sentiment scan flagged, per building, and writes one note per building × theme for the CS and admin team: what guests hit, their words, what we did not say, where the fix belongs (listing, house rules, pre-arrival message, check-in guide, FAQ, guidebook) and the proposed copy. Nothing is published; a person marks a note updated on the Eve tab.',
    receipt: 'automation_runs', settingsPath: '/eve → Expectations',
    notes: 'lib/eve/expectations.ts. Skip with ?expectations=0 on the review route. One sonnet-tier call (task expectations). A note marked updated that guests hit again reopens and says so.' },
  { key: 'slack-watch', label: 'Keeping tabs on Slack', area: 'eve', path: '/api/cron/slack-watch',
    what: 'Reads the team channels at :48 past the hour in UTC hours 0–4 and 11–23 (7:48am to 12:48am ET in summer, an hour earlier in winter; nothing in the small hours). Pulls out commitments, open problems, unanswered questions, decisions and GUEST ASKS (a discount, an extension, a call back, a refund, a booking inquiry); closes them from thread replies, finished Breezeway tasks, closed glitches or — for a guest ask — the booking itself in Guesty; nudges the owner (once after a day; a guest ask after 60 min and again at 4h); escalates a guest ask on Salato or a big booking to Jon, Karla, Roberto and Bernadette in its thread at once; posts a CCS handoff list of open guest asks at 7am, 3pm and 11pm ET in #ccs-and-jon; posts a morning roll-up in #vr-eve; and files what it learned into memory.', receipt: 'automation_runs',
    configKey: 'eve_ccs_desk', settingsPath: '/vr-eve in Slack · desk settings in app_settings eve_ccs_desk',
    notes: 'Hard caps per run: 12 channels, 60 candidates per model call, 8 model calls, 80 thread reads. A quiet hour costs a Slack read and nothing else. Every post goes through the slack_post Agent mode rung (propose = a ✅ in #vr-eve sends it). Needs migration 084. The CCS desk lives in lib/eve/ccs-desk.ts.' },
  { key: 'on-watch', label: 'Eve on watch (command rooms)', area: 'eve', path: '/api/cron/slack-watch',
    what: 'Hourly 11am–7pm ET, right after the Slack read: finds what is slipping between Slack, the glitch board and Breezeway (a field report nobody picked up in 45 min, a glitch 2h old with no Breezeway task, a task still open 6h with the guest in the unit, a fix the guest has not been told about) and says it in one short message per room: #vr-eve for ops, #vr-ccs-and-jon for guest follow-ups, #leadership for a glitch gap nobody touched in 3h. Each item is said once; a ✅ goes in the thread when it resolves. Late cleans are left to the late-clean reminders. Never posts in the field channels.',
    configKey: 'eve_on_watch', receipt: 'automation_runs',
    notes: 'Rides the slack-watch cron line (vercel.json is at its cron cap). Rooms, hours and on/off live in app_settings eve_on_watch; state in eve_on_watch_state. Posts go through the slack_post Agent mode rung. No model call.' },

  { key: 'pm-recurrence', label: 'Preventative work books itself', area: 'ops', path: '/api/cron/auto-inspections',
    what: 'A completed cadence task (A/C deep clean, filter change, batteries, deep clean, or any cadence you add) puts the next one on the PM ledger for done + interval, and 14 days before it is due the next task is created in Breezeway — on the unit\'s best empty day when it needs one. A cadence on "suggest" asks Eve for a ✅ (task_create rung); on "auto" it is created outright. A successor whose day passes unfinished is moved forward weekly and counted. Manage the jobs and see the ledger in Users & admin → Settings → Preventative cadences.',
    configKey: 'preventative_cadences', receipt: 'none', settingsPath: '/users → Settings → Preventative cadences',
    notes: 'lib/pm-recurrence.ts, riding the hourly auto-inspections cron at most every 6 hours. Needs migration 113 (pm_schedule) and the cadences master switch on. Manual: POST /api/pm/schedule {dryRun}.' },
  { key: 'ops-desk', label: 'Eve runs the day\'s task list', area: 'eve', path: '/api/cron/slack-watch',
    what: '7am ET: today\'s plan in #vr-eve — one summary line (open work, people, arrivals, unowned → /plan), then the work nobody has with the check-in time that sets each deadline, and the shadow scheduler\'s suggested assignments once it has earned them. 11am–6pm hourly: every task due today with nobody on it (never a departure clean) gets a proposed assignee — the least-loaded person from that department already working in the building — through the task_assign rung, once per task. 6pm: end-of-day recap — what is still open, by person, and which of it sits in a unit with a guest landing tomorrow.',
    configKey: 'eve_ops_desk', receipt: 'automation_runs',
    notes: 'lib/eve/ops-desk.ts, riding the hourly slack-watch cron. Hours and room in app_settings eve_ops_desk. Preview: GET /api/cron/slack-watch?desk=plan|recap. No model call.' },
  { key: 'scheduler-shadow', label: 'Scheduler in shadow', area: 'eve', path: '/api/cron/slack-watch',
    what: 'Evenings (8–11pm ET): builds tomorrow\'s departure-clean assignments with the Schedule page\'s own suggester (fewer people, fuller days, one building per person, same-day turns first) and, the next evening, scores that plan against what actually happened — a win is no more people, no more than 110% of the travel, and nothing left unassigned that reality covered. It is scored only on the cleans in both the plan and the day; a win also needs every same-day turn to land before its check-in; days scored before 2026-09-28 do not count toward readiness. Sunday readout in #vr-eve. When 10 of the last 14 days are wins, the 7am plan carries her suggested assignments for unowned cleans as a proposal. Never assigns anything itself.',
    configKey: 'eve_scheduler_shadow', receipt: 'automation_runs',
    notes: 'lib/eve/scheduler-shadow.ts, riding the hourly slack-watch cron. State: 21 days in app_settings eve_scheduler_shadow. Run now: GET /api/cron/slack-watch?shadow=1 (signed in).' },
  { key: 'garden-sync', label: 'Garden Hotel ← Cloudbeds', area: 'ops', path: '/api/cron/breezeway-tasks',
    what: 'Every 30 minutes with the task mirror: pulls the hotel\'s rooms, the next 60 days of reservations (plus anything modified since the last run) and each room\'s condition from Cloudbeds into the garden_* tables, creates the departure cleans and stayovers for today and tomorrow, writes what changed to the event inbox (new booking, cancellation, check-in/out, arrival tomorrow, room dirty), rebuilds the call desk (welcome calls, verifications, post-stay), runs the hotel\'s triggers over the inbox, and pulls calls from the phone system. Not connected is a quiet no-op recorded on the Setup tab, never an error.',
    receipt: 'automation_runs', settingsPath: '/garden/setup',
    notes: 'lib/garden/sync.ts. Needs migration 115 and CLOUDBEDS_API_KEY + CLOUDBEDS_PROPERTY_ID (or the OAuth trio). Own route for a manual run: GET /api/cron/garden-sync?full=1 (signed in).' },
  { key: 'salato-watch', label: 'Salato booking watch', area: 'guests', path: '/api/cron/reservations',
    what: 'After every booking sync (every 5 minutes): each new Salato booking goes to #ccs-and-jon with @channel (unit, dates, nights, guest, channel, code). A 1-night booking is flagged NOT PERMITTED (Salato has a 2-night minimum) and must be canceled or extended; it gets a reminder in its thread every 3 hours in the daytime until it is, and a ✅ when it is. The Salato front desk board shows 1-night stays in red with who to call.',
    configKey: 'salato_watch', enabledPath: 'enabled', defaultOn: true,
    receipt: 'none', notes: 'lib/salato-watch.ts. Off switch: app_settings salato_watch.enabled = false — missing means on; it stops the 5-minute hook only, a manual run still works. State in app_settings salato_watch_state; each message claimed once in telegram_updates. Manual check: GET /api/salato/watch (dry run). Front-desk contact line: app_settings salato_desk_contact.' },

  // ---- Guests ---------------------------------------------------------------------------------
  { key: 'sentiment', label: 'Guest sentiment scan', area: 'guests', path: '/api/sentiment/scan',
    what: 'Scores recently active guest threads for unhappiness and flags the reservation Sensitive in Guesty when it is bad.', receipt: 'automation_runs' },
  { key: 'eve-watches', label: "Eve's watches", area: 'eve', path: '/api/sentiment/scan', trigger: 'chained — every scheduled pass of /api/sentiment/scan (every 30 minutes)',
    what: 'Eight standing watches over the day picture — a guest waiting on a reply, a late clean with nobody on it, a big arrival nobody has walked, a bad review that just landed, a listing that fell off a channel, a glitch past due with no task, guest-order stock running low, a guest arriving today who never answered. Each prepares one action and puts it through her Agent mode rung (act, ask, draft or just observe); the same subject is never asked about twice inside its cooldown, and at most five per watch per run. Outside 7am–10pm ET only the guest-waiting and silent-arrival watches run.',
    receipt: 'automation_runs', settingsPath: '/users → Settings → Eve → Agent mode → Watches',
    notes: 'lib/eve/watches.ts. Switch, cooldown and rung per watch live in the eve_watches table (migration 102); without it the runner does nothing and says so.' },
  { key: 'eve-deferred', label: "Eve's held work", area: 'eve', path: '/api/sentiment/scan', trigger: 'chained — every pass of /api/sentiment/scan (every 30 minutes)',
    what: 'Carries out whatever Eve held for quiet hours (a roll-up, a nudge) once quiet hours end.', receipt: 'automation_runs',
    notes: 'Writes a receipt only when something was held.' },
  { key: 'reservation-notices', label: 'Front-desk notice queue', area: 'guests', path: '/api/cron/reservation-notices',
    what: 'Builds the per-building front-desk notice queue for arrivals.', configKey: 'reservation_emails',
    settingsPath: '/users → Settings → Front-desk notices', receipt: 'automation_runs' },
  { key: 'notice-drafts', label: 'Notice drafts into Gmail', area: 'guests', path: '/api/cron/reservation-notices',
    what: 'Drafts those notices into the sending mailbox so a human only has to read and press send.',
    configKey: 'task_automation', enabledPath: 'noticeDrafts.enabled', defaultOff: true,
    settingsPath: '/users → Settings → Task automation', receipt: 'none', trigger: 'chained — runs inside /api/cron/reservation-notices',
    notes: 'It has no route or cron line of its own: the hourly notice-queue cron runs it at 03:28, 11:28, 15:28, 19:28 and 23:28 UTC, on the scheduler\'s own call only. Exactly-once per notice.' },
  { key: 'guest-orders', label: 'Guest orders', area: 'guests', path: '/api/cron/guest-orders',
    what: 'Writes the per-reservation order link into Guesty, and on the delivery day pushes paid orders to Breezeway, Slack and email.',
    configKey: 'guest_orders', enabledPath: 'enabled', defaultOff: true,
    settingsPath: '/users → Settings → Guest orders', receipt: 'automation_runs' },
  { key: 'parking-guesty', label: 'Parking permits into Guesty', area: 'guests', path: '/api/cron/guest-orders', trigger: 'chained — every pass of /api/cron/guest-orders (every 2 hours)',
    what: 'Retries writing a parking permit link (/permit/<token>) onto its Guesty reservation when the vendor upload\'s own write missed — up to twenty a run, usually none. Runs whether or not guest orders is on.',
    configKey: 'parking_cfg', enabledPath: 'writeToGuesty', defaultOn: true, receipt: 'automation_runs',
    notes: 'lib/parking.ts retryPendingGuestyWrites. Off only when parking_cfg.writeToGuesty is false.' },
  { key: 'guide-activations', label: 'Guidebook events', area: 'guests', path: '/api/cron/guide-activations',
    what: 'Scrapes building event calendars into the guest guidebook so what a guest reads is current.', receipt: 'automation_runs' },
  { key: 'welcome-calls', label: 'Welcome calls', area: 'guests', trigger: 'in-app',
    what: 'The pre-arrival welcome call, worked from the Calls desk: a completed call in the call log (or the Guesty field ticked) closes it. Not scheduled; the nightly close-out marks the missed ones incomplete.', receipt: 'none' },
  { key: 'calls-closeout', label: 'Calls desk close-out', area: 'guests', path: '/api/cron/calls-closeout',
    what: 'Nightly, after midnight ET: every welcome call whose arrival day is over, and every post-checkout call past its 48 hours, with no completed outcome is closed incomplete in the call log — exactly the rows the Calls desk shows as Missed.', receipt: 'automation_runs' },
  { key: 'talkroute-sync', label: 'Phone system sync', area: 'guests', path: '/api/cron/talkroute',
    what: 'Every 30 minutes: mirrors Talkroute calls, changed text threads and voicemails and matches them to bookings — the backstop that never misses what the webhook did. Does nothing until Talkroute is connected.', receipt: 'automation_runs' },
  { key: 'call-notes', label: 'Call notes', area: 'guests', path: '/api/cron/call-notes',
    what: 'Every 30 minutes: transcribes recorded calls and turns each into a note on the booking (Contact history) and a one-line summary in the Guesty reservation notes — newest first, time-boxed, a backlog drains over several passes.', receipt: 'automation_runs',
    notes: 'lib/call-notes.ts. Does nothing until Talkroute is connected.' },

  // ---- Ops ------------------------------------------------------------------------------------
  { key: 'auto-inspections', label: 'Automatic inspections', area: 'ops', path: '/api/cron/auto-inspections',
    what: 'Creates and assigns an inspection ahead of big, VIP or owner arrivals, and for units whose reviews have slipped.',
    configKey: 'task_automation', enabledPath: 'enabled', defaultOff: true,
    settingsPath: '/users → Settings → Task automation', receipt: 'automation_runs',
    notes: 'Writes to auto_inspections — a DIFFERENT table from the manual unit_inspections the inspections tool reads.' },
  { key: 'suggestions', label: 'Preventative suggestions', area: 'ops', path: '/api/cron/suggestions',
    what: 'Each morning works out which preventative jobs are due, throws away everything that cannot happen today, and proposes a capped handful on Today in Ops — creating only the cadences set to run themselves.',
    configKey: 'preventative_cadences', enabledPath: 'enabled', defaultOn: true,
    settingsPath: '/users \u2192 Settings \u2192 Preventative cadences', receipt: 'automation_runs',
    notes: 'On by default: a saved config without the switch keeps it on; only an explicit false turns it off. On a heavy turn day it deliberately proposes and creates nothing — that is the day read working, not a failure.' },
  { key: 'stay-window', label: 'Minimum-stay switch', area: 'ops', path: '/api/cron/stay-window',
    what: 'Flips the minimum-stay rule at the hour Jon set, so the calendar opens up without anyone remembering to do it.',
    configKey: 'stay_window', enabledPath: 'enabled', defaultOff: true, receipt: 'automation_runs' },
  { key: 'claims-nudge', label: 'Claims nudge', area: 'ops', path: '/api/cron/claims',
    what: 'Chases claims that are unfiled, overdue, or about to fall outside the channel filing window.', receipt: 'automation_runs' },
  { key: 'ops-focus', label: 'Today in Ops focus read', area: 'ops', path: '/api/cron/ops-focus',
    what: 'Four considered looks a day — 7am, noon, 3pm and 8pm ET: one model read per market of the day as a whole (the crew against the work), ready on Today in Ops before anyone opens it. Between those the board ranks in code. Fires at both candidate UTC hours for each slot and acts only on the Eastern one, once per slot.', receipt: 'automation_runs',
    notes: 'lib/ops-focus.ts. A market whose candidates have not changed since the last read is not asked again.' },

  // ---- Slack ----------------------------------------------------------------------------------
  { key: 'slack-alerts', label: 'Slack alert engines', area: 'slack', path: '/api/cron/slack',
    what: 'Every half hour, runs twelve alert engines (late cleans, glitches, overtime, readiness, walk-in risk, door codes, handover and the rest) — plus the morning digest on its 07:19 ET pass — and dispatches whatever has been approved.',
    configKey: 'slack_rules', settingsPath: '/users → Settings → Slack alerts & rules', receipt: 'automation_runs' },
  { key: 'slack-digest', label: 'Morning Slack digest', area: 'slack', path: '/api/cron/slack', trigger: 'chained — the 07:19 ET pass of /api/cron/slack',
    what: 'Posts the day-ahead summary into the ops channel, once a morning.', configKey: 'slack_rules', enabledPath: 'events.digest.enabled', defaultOff: true,
    settingsPath: '/users → Settings → Slack alerts & rules', receipt: 'slack_outbox',
    notes: 'Its own cron line went on 2026-09-28; the Slack alerts cron runs it only on the pass inside 07:15–07:45 ET, all year. Its receipt is the Slack alerts run (slack-alerts).' },
  { key: 'weekly-planner', label: 'Weekly plan', area: 'slack', path: '/api/cron/weekly-planner',
    what: 'Sunday night, posts next week\'s plan per market.', configKey: 'slack_rules', enabledPath: 'events.weekly_planner.enabled',
    settingsPath: '/users → Settings → Slack alerts & rules', receipt: 'slack_outbox' },

  // ---- The morning mail -----------------------------------------------------------------------
  { key: 'ops-brief', label: 'Morning ops brief', area: 'ops', path: '/api/cron/ops-brief',
    what: 'The 7am email: Miami, Broward, the full portfolio, the GM edition and the vendor buildings.',
    configKey: 'ops_brief', enabledPath: 'enabled', recipientPaths: ['miami', 'broward', 'full', 'gm', 'vendors.botanica', 'vendors.pt', 'vendors.north'],
    settingsPath: '/users → Settings → Morning brief', receipt: 'email_log' },
  { key: 'labor-trueup', label: 'Daily labor email', area: 'money', path: '/api/cron/labor-trueup',
    what: 'Yesterday against the last 7 and 30 days: cleans completed, actual clocked hours, revenue and profit. Then it runs the labor integrity checks on the same 30 days and emails the owner only when one fails.',
    configKey: 'labor_weekly', enabledPath: 'enabled', defaultOn: true, settingsPath: '/users → Settings → Morning brief', receipt: 'email_log',
    notes: 'Goes to labor_weekly.to plus the older labor_daily.to (the Daily Labor list on the Morning brief card), CC Roberto; with nobody set it goes to the owner alone. Either key saying enabled: false switches it off.' },
  { key: 'salato-daily', label: 'Salato daily', area: 'guests', path: '/api/cron/salato-daily',
    what: 'The arrivals-and-departures email for the Salato front desk.', configKey: 'salato_daily', enabledPath: 'enabled',
    recipientPaths: ['to'], defaultOff: true, settingsPath: '/users → Settings → Morning brief', receipt: 'automation_runs' },
  { key: 'eod-recap', label: 'End-of-day recap', area: 'ops', path: '/api/cron/eod-recap',
    what: 'The evening email (00:15 UTC, about 8:15pm ET): the priorities the 7am brief set and whether they got done, tomorrow (who is on, what is booked and unassigned, the staffing forecast per market), one money line, then housekeeping, supervision and maintenance economics, the cleans completed and the last 7 days.',
    configKey: 'ops_brief', recipientPaths: ['full'], settingsPath: '/users → Settings → Morning brief', receipt: 'automation_runs',
    notes: 'Goes to the Ops Command list (ops_brief.full) plus the owner. Same engine as the Labor board (lib/labor-econ).' },
  { key: 'forecast-ledger', label: 'Staffing forecast ledger', area: 'ops', path: '/api/cron/eod-recap', trigger: 'chained — runs after the EOD recap on /api/cron/eod-recap',
    what: 'Nightly after the EOD recap: records the next 14 days of the staffing forecast and grades every past forecast day against the departure cleans that finished.', receipt: 'automation_runs',
    notes: 'lib/forecast/staffing.ts; needs migration 133. Runs even when the recap email fails.' },

  // ---- Projects -------------------------------------------------------------------------------
  { key: 'project-notify', label: 'Project notifications', area: 'ops', path: '/api/cron/project-notify',
    what: 'Every 30 minutes: the immediate project emails — assigned, mentioned, a comment, added — one message per person.', receipt: 'automation_runs' },
  { key: 'project-recur', label: 'Recurring projects', area: 'ops', path: '/api/cron/project-notify', trigger: 'chained — the 6am ET passes of /api/cron/project-notify',
    what: 'Creates the next instance of every recurring project that has come due, before the morning reminders are built. Running twice creates nothing the second time.', receipt: 'automation_runs' },
  { key: 'project-digest', label: 'Project reminders & morning digest', area: 'ops', path: '/api/cron/project-notify', trigger: 'chained — the 7am ET passes of /api/cron/project-notify',
    what: 'Builds the due-soon and overdue reminders and sends each person their morning project digest — once a morning (20-hour guard).', receipt: 'automation_runs' },

  // ---- The only job whose purpose is to destroy data -------------------------------------------
  { key: 'trash-sweep', label: 'Trash sweep', area: 'ops', path: '/api/cron/trash-sweep',
    what: 'Once a day, removes for good the things that have sat in the trash past their 60 days. Anything somebody restored is left alone — that row is history now, not a countdown.', receipt: 'automation_runs',
    settingsPath: '/projects → Trash',
    notes: 'Reads the rows before deleting them so the receipt names what went, not just how many. Caps at 500 a run. Needs migration 093.' },

  // ---- Event-driven ----------------------------------------------------------------------------
  { key: 'breezeway-webhook', label: 'Breezeway webhook', area: 'ops', trigger: 'webhook', path: '/api/breezeway/webhook',
    what: 'Breezeway calls us the moment a task changes; we re-fetch the task rather than trusting the payload.', receipt: 'none' },
  { key: 'telegram', label: 'Eve on Telegram', area: 'eve', trigger: 'webhook', path: '/api/telegram/webhook',
    what: 'Approved people can ask Eve anything from Telegram; unapproved ones get one polite refusal and a row waiting for a human.',
    settingsPath: '/users → Settings → Eve → Telegram', receipt: 'none' },
]

export const AUTOMATION_KEYS = AUTOMATIONS.map(a => a.key)

/** Every cron path the app expects to be scheduled. The audit's watch list, derived not retyped. */
export function expectedCronPaths(): string[] {
  const out: string[] = []
  for (const a of AUTOMATIONS) {
    // Anything with its own trigger (a webhook, an in-app action, a Sync button, a chained run inside
    // another cron) is not a vercel.json line and must not be reported as a missing one.
    if (a.trigger) continue
    if (a.path && out.indexOf(a.path) < 0) out.push(a.path)
  }
  return out
}

export function findAutomation(key: string): AutomationDef | null {
  const k = String(key || '').toLowerCase().trim()
  if (!k) return null
  return AUTOMATIONS.find(a => a.key === k)
    || AUTOMATIONS.find(a => a.path === k)
    || AUTOMATIONS.find(a => a.label.toLowerCase() === k)
    || AUTOMATIONS.find(a => a.key.includes(k) || a.label.toLowerCase().includes(k))
    || null
}

/** Dot-path read that treats a missing key as missing rather than as false. */
export function readPath(obj: any, path: string): any {
  if (!obj || !path) return undefined
  let cur: any = obj
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined
    cur = cur[part]
  }
  return cur
}

function recipientsOf(cfg: any, def: AutomationDef): { path: string; count: number; to: string[] }[] {
  const out: { path: string; count: number; to: string[] }[] = []
  for (const p of (def.recipientPaths || [])) {
    const v = readPath(cfg, p)
    const list = Array.isArray(v) ? v.map((x: any) => String(x?.email || x)).filter(Boolean)
      : (v && typeof v === 'object' && Array.isArray(v.recipients)) ? v.recipients.map((x: any) => String(x?.email || x)).filter(Boolean)
      : []
    out.push({ path: p, count: list.length, to: list.slice(0, 12) })
  }
  return out
}

export type AutomationState = {
  key: string
  label: string
  what: string
  area: AutomationArea
  runs: string           // human-readable schedule, or the trigger
  path?: string
  on: boolean | null     // null = no switch, i.e. always on
  onWhy: string
  settings?: string
  recipients?: { path: string; count: number; to: string[] }[]
  notes?: string
  receipt: string
}

/** Turn a cron expression into something a person reads without decoding it. */
export function describeSchedule(expr: string): string {
  const e = String(expr || '').trim()
  if (!e) return 'not scheduled'
  const [min, hour, dom, mon, dow] = e.split(/\s+/)
  const et = (h: string) => {
    // vercel crons are UTC; the business runs on ET. Show both, because every argument about
    // "the 7am brief" has been an argument about which clock.
    const n = Number(h)
    if (!Number.isFinite(n)) return `${h} UTC`
    const e1 = (n + 24 - 4) % 24
    return `${String(n).padStart(2, '0')}:00 UTC (${String(e1).padStart(2, '0')}:00 ET)`
  }
  if (min?.includes('/') || hour === '*') {
    if (min === '*') return 'every minute'
    if (min?.includes('/')) return `every ${min.split('/')[1]} minutes`
    return `hourly at :${min}`
  }
  if (dow && dow !== '*') return `weekly (day ${dow}) at ${et(hour)}`
  if (dom && dom !== '*') return `monthly (day ${dom}) at ${et(hour)}`
  return `daily at ${et(hour)} :${min}`
}

let _schedules: Record<string, string[]> | null = null
async function schedules(): Promise<Record<string, string[]>> {
  if (_schedules) return _schedules
  const out: Record<string, string[]> = {}
  try {
    const cfg: any = await import('@/vercel.json').then((m: any) => m.default || m)
    for (const c of (cfg?.crons || [])) {
      const p = String(c?.path || '')
      if (!p) continue
      ;(out[p] = out[p] || []).push(String(c?.schedule || ''))
    }
  } catch { /* the automations list still works without schedules */ }
  _schedules = out
  return out
}

/**
 * The live state of one automation: is it on, on what schedule, with which recipients.
 * A config key that has never been saved reads as OFF and SAYS SO — the difference between
 * "switched off" and "never set up" is the whole answer to half of Jon's questions.
 */
export async function automationState(def: AutomationDef): Promise<AutomationState> {
  const cfg = def.configKey ? await getSetting<any>(def.configKey, null) : null
  let on: boolean | null = null
  let onWhy = 'always on — no switch'
  if (def.enabledPath) {
    const v = readPath(cfg, def.enabledPath)
    if (v === undefined || v === null) {
      // A switch the code itself reads as ON when missing (defaultOn) is on — only false is off.
      on = !!def.defaultOn
      onWhy = def.defaultOn ? `on by default (${def.configKey}.${def.enabledPath} is not set; only false turns it off)`
        : cfg ? `never set (${def.configKey}.${def.enabledPath} is missing) — treated as off`
        : `never configured (${def.configKey} has no saved value) — treated as off`
    } else {
      on = def.defaultOn ? v !== false : v === true
      onWhy = on ? `on (${def.configKey}.${def.enabledPath})` : `off (${def.configKey}.${def.enabledPath})`
    }
  } else if (def.configKey) {
    on = null
    onWhy = cfg ? `always runs; configured by ${def.configKey}` : `always runs; ${def.configKey} has no saved config yet`
  }
  const sch = (await schedules())[def.path || ''] || []
  const runs = def.trigger === 'webhook' ? 'when the other system calls us'
    : def.trigger === 'in-app' ? 'when someone uses it'
    // Chained into another cron, or a button: the trigger says when — the host's own schedule would
    // not (the digest rides a half-hourly line but runs once a morning).
    : def.trigger ? def.trigger
    : sch.length ? sch.map(describeSchedule).join(' and ')
    : 'NOT SCHEDULED — no cron entry found'
  return {
    key: def.key, label: def.label, what: def.what, area: def.area, runs, path: def.path,
    on, onWhy, settings: def.settingsPath, notes: def.notes, receipt: def.receipt || 'none',
    recipients: def.recipientPaths ? recipientsOf(cfg, def) : undefined,
  }
}

export async function allAutomationStates(area?: string): Promise<AutomationState[]> {
  const a = String(area || '').toLowerCase().trim()
  const defs = a ? AUTOMATIONS.filter(d => d.area === a) : AUTOMATIONS
  return Promise.all(defs.map(automationState))
}
