-- 094 — THE PERMIT'S OWN ADDRESS, AND THE WRITE BACK INTO GUESTY.
--
-- Jon, 2026-09-16: "Once the QR code is uploaded, we need to find a way to map that QR code to the
-- reservation in Guesty."
--
-- The mapping is a URL on the reservation. Not the image — the bucket is private and a signed URL
-- expires in five minutes, so pasting one into a custom field would give the reservation a link
-- that is dead by the time anyone opens it. Instead every permit gets a token of its own and the
-- field holds /permit/<token>, which resolves to a FRESH signed read each time it is opened and
-- 404s the moment the permit is voided. One stable address, revocable, nothing public.
--
-- WHY THE TOKEN IS NOT THE PERMIT'S UUID: the uuid is the id the vendor's own page passes around
-- (view, replace, assign), so it travels through a browser a garage shares. A capability that ends
-- up in a guest's confirmation email should not be the same string that authorises the vendor UI.
alter table public.parking_permits
  add column if not exists permit_token    text,
  -- The write-back is best-effort and RETRYABLE. A Guesty outage must not fail an upload — the QR
  -- is safely stored either way — but a failure that leaves no trace is a reservation silently
  -- missing its code, which nobody discovers until a guest is at a gate.
  add column if not exists guesty_written_at timestamptz,
  add column if not exists guesty_error    text,
  add column if not exists guesty_field_id text,
  -- RETRIES HAVE TO END. A reservation cancelled in Guesty after its permit was assigned can never
  -- be written to, and without a counter that row keeps its place at the head of the retry queue
  -- forever: the batch is a fixed size, so a handful of permanently-dead rows starve every real
  -- permit behind them while the cron cheerfully reports "tried 20, wrote 0" every hour.
  add column if not exists guesty_tries    int not null default 0;

-- The token is the capability, so collisions are not merely untidy.
create unique index if not exists parking_permits_token
  on public.parking_permits (permit_token) where permit_token is not null;

-- Backfill: rows written before this migration have no token. gen_random_uuid() twice gives 64
-- hex characters with the dashes stripped — the same shape the app mints.
update public.parking_permits
   set permit_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
 where permit_token is null;

-- Finding the permits whose Guesty write still has to be retried.
create index if not exists parking_permits_guesty_pending
  on public.parking_permits (status, guesty_written_at, guesty_tries)
  where reservation_id is not null and status = 'assigned';
