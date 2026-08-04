-- OWNER STATEMENT AUDIT — the end-of-month statement review, moved off the Google Sheet.
--
-- The audit itself is COMPUTED live from the owner-statement mirror (guesty_owner_statements +
-- guesty_owner_ledger), so there is nothing to store about the numbers. What has to persist is
-- the REVIEW: which rows a human has looked at, which need action, and what was said about them.
--
-- One row per audited item per statement month. An item is usually a reservation (item_key =
-- the Guesty confirmation code) but can also be a grouped non-reservation ledger line
-- (item_key = 'line:<charge_code>:<label>'). Absence of a row means "untouched": the UI derives
-- the default status from the item's flags (flagged -> needs review, clean -> completed).
--
-- Run via Supabase SQL editor on project: ugbtsppfsgkkrdyyuxxg (Ops App)

create table if not exists owner_audit_reviews (
  month       text not null,                       -- statement month, yyyy-MM
  owner_id    text not null,                       -- guesty_owners.id
  item_key    text not null,                       -- confirmation code, or line:<code>:<label>
  status      text not null default 'review'
              check (status in ('review', 'action', 'done')),
  note        text not null default '',
  -- Append-only comment log: [{ author, body, at }]. Kept on the row (not the system-wide
  -- comments table) because share-link reviewers are not app users and this data is
  -- owner-money-sensitive — it should live and die with the audit row.
  comments    jsonb not null default '[]'::jsonb,
  updated_by  text,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  primary key (month, owner_id, item_key)
);

create index if not exists owner_audit_reviews_month_idx on owner_audit_reviews (month);

-- RLS on with NO permissive policy: every read and write goes through the service role inside
-- our own API routes, same as claims and deleted_records.
alter table owner_audit_reviews enable row level security;

-- ROLE LEVELS: the Owner Audit tab is owner/admin-only in the app, same policy as Revenue.
-- Every non-admin role gets an explicit 'off' so the admin seed's {"*":"full"} stays the only
-- grant. Guarded so this migration still runs cleanly if 023 (app_roles) has not been run yet.
do $$
begin
  if to_regclass('public.app_roles') is not null then
    update app_roles set perms = perms || '{"owner-audit":"off"}'::jsonb where key <> 'admin';
  end if;
end $$;

-- PostgREST must re-read the schema before the API can see the new table.
notify pgrst, 'reload schema';
