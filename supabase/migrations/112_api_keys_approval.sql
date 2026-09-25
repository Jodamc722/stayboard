-- KEYS ARE APPROVED BY JON (2026-09-25: "keys must be approved by me, super user, and are only
-- read only; they can read whatever they want"). A new key is pending until the superadmin
-- approves it; only then does it answer. Once approved it reads every v1 endpoint, not just the
-- pages its owner's role can open — the approval is the gate, not the role.
alter table api_keys add column if not exists approved_at timestamptz;
alter table api_keys add column if not exists approved_by text;
alter table api_keys add column if not exists rejected_at timestamptz;
alter table api_keys add column if not exists rejected_by text;
create index if not exists api_keys_pending_idx on api_keys (created_at) where approved_at is null and rejected_at is null and revoked_at is null;
