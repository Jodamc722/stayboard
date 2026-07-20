-- P6 Send-to-Drive: per-user Google OAuth refresh tokens (drive.file scope only).
create table if not exists google_tokens (
  user_email text primary key,
  refresh_token text not null,
  updated_at timestamptz default now()
);
alter table google_tokens enable row level security;
-- No policies on purpose: only the service-role key (server) reads/writes this table.
