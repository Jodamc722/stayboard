-- PARKING PERMITS — the QR codes a garage vendor issues for 17 West stays.
--
-- Jon, 2026-09-16: "a shareable link that's password protected for all reservations at 17 West…
-- send this to a parking vendor that needs to generate QR codes. We should have them upload a QR
-- code into the system for that reservation."
--
-- The link itself is NOT new plumbing: it is a row in `share_links` with a `parking` section, the
-- same table, builder, passcode and revoke as every other link Jon shares. What is new is the
-- permit — the artefact the vendor hands back — and it needs a home of its own for three reasons:
-- it is a file, it belongs to one stay, and it is a credential to a physical garage.
--
-- ── WHY A SPARE POOL ────────────────────────────────────────────────────────────────────────────
-- Jon's own constraint, and it shaped the table: "it's better to have the QR codes generated
-- versus waiting for the vendor, in case the guest books last minute and the vendor doesn't work
-- weekends. They're going to provide a couple of extra codes just in case."
--
-- So a permit does not have to be born attached to anything. A row with `reservation_id is null`
-- and `status = 'spare'` is a code sitting in the drawer; binding it to a stay is an UPDATE, which
-- is what makes a Saturday arrival solvable without the vendor. The partial unique index below is
-- what stops two people claiming the same spare, or one stay collecting two live permits.
--
-- ── WHY THE FILE IS NOT IN A PUBLIC BUCKET ──────────────────────────────────────────────────────
-- A parking QR opens a gate. `getPublicUrl()` would be a permanent, un-revokable, no-login link to
-- it — the exact mistake glitch photos were moved off in August. Bytes live in the private
-- `parking-qr` bucket and are read only through a short-lived signed URL, scoped to the link that
-- is asking (see lib/parking.ts).

create table if not exists parking_permits (
  id              uuid primary key default gen_random_uuid(),
  -- Canonical building label from lib/segments (e.g. '17WEST'), never the raw Guesty text — that
  -- column holds 78 spellings for 23 buildings and is why a share link once meant 15 of 53 units.
  building        text not null,
  -- Null while the permit is in the spare pool. Set when it is bound to a stay.
  reservation_id  text,
  listing_id      text,
  unit            text,
  check_in        date,
  check_out       date,
  -- Where the bytes are in the private `parking-qr` bucket. Never a URL.
  storage_path    text not null,
  mime            text,
  bytes           integer,
  -- The vendor's own reference for this permit — a plate, a permit number, a garage row. Their
  -- words, shown back to them, never parsed.
  label           text,
  -- assigned = bound to a stay · spare = in the pool · void = replaced or withdrawn
  status          text not null default 'assigned',
  -- Which share link uploaded it. Provenance, so a revoked vendor's permits can be found.
  source_code     text,
  uploaded_by     text,
  uploaded_at     timestamptz not null default now(),
  assigned_at     timestamptz,
  assigned_by     text,
  voided_at       timestamptz,
  voided_by       text,
  void_reason     text,
  -- Stamped by the send-on-payment automation when it exists. Nothing writes these yet, and that
  -- is deliberate: the columns are the anchor that makes the automation exactly-once when it lands.
  sent_at         timestamptz,
  sent_via        text
);

-- ONE LIVE PERMIT PER STAY. A re-upload voids the old row rather than racing it, and two people
-- claiming the same spare for different stays cannot both win.
create unique index if not exists parking_permits_one_live_per_res
  on parking_permits (reservation_id)
  where reservation_id is not null and status = 'assigned';

create index if not exists parking_permits_pool_idx on parking_permits (building, status);
create index if not exists parking_permits_res_idx  on parking_permits (reservation_id);

-- ── THE LOG ─────────────────────────────────────────────────────────────────────────────────────
-- Two jobs in one table. It is the audit trail for a credential a third party can mint and read —
-- who opened the link, who uploaded what, who claimed which spare. And it is the wrong-passcode
-- counter: counted from the log rather than from memory, so the limit survives a redeploy and is
-- visible in the same place as everything else. That is how the vault code already works.
create table if not exists parking_access_log (
  id          bigserial primary key,
  code        text,
  action      text not null,      -- open | denied | upload | assign | void | view
  detail      text,
  ip          text,
  created_at  timestamptz not null default now()
);
create index if not exists parking_log_code_idx on parking_access_log (code, action, created_at desc);
create index if not exists parking_log_time_idx on parking_access_log (created_at desc);

-- Service role only, like every other table carrying a capability (see 061_rls_lockdown).
alter table parking_permits   enable row level security;
alter table parking_access_log enable row level security;
