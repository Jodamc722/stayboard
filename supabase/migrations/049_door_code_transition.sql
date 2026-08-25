-- ---------------------------------------------------------------------------------------------
-- The door-code TRANSITION WINDOW (Jon, 2026-08-24: "we create a new code and the old code should
-- also show, because the codes are changed physically after the clean is done by HK").
--
-- This is the fact that breaks the naive model. Guesty is not the lock. A new code is entered in
-- Guesty at turnover, but the keypad still holds the OLD one until housekeeping physically changes
-- it at the end of the clean. Between those two moments the code in Guesty is WRONG and the code
-- nobody is looking at is RIGHT — and that window is exactly when a maintenance tech is most likely
-- to be sent over, because the unit is empty.
--
-- So we keep the previous code alongside the current one and show BOTH at release, labelled by
-- which one we expect to work, with the reason. Whether housekeeping has been in is not a guess:
-- it is a finished cleaning task in Breezeway dated after the code changed.
--
-- ON STORING A CODE IN PLAINTEXT HERE. The earlier integrity work deliberately stored only
-- fingerprints, on the principle that a code should not spread beyond guesty_listings.raw. This
-- reverses that for exactly one value — the previous code — because a fingerprint cannot be typed
-- into a keypad, and a tech standing at a door with the wrong code is a worse outcome than one more
-- row holding a number that is already in the database twice over. It is never sent to Slack, never
-- returned to the model, and only ever rendered on the single-use release page after a human has
-- approved. That is the same bar the current code already has to clear.
-- ---------------------------------------------------------------------------------------------
-- current_code exists so that when the field moves we can MOVE the old value into previous_code.
-- A fingerprint cannot be demoted into something a person types at a keypad.
alter table door_code_state add column if not exists current_code     text;
alter table door_code_state add column if not exists previous_code    text;
alter table door_code_state add column if not exists previous_fp      text;
alter table door_code_state add column if not exists previous_seen_at timestamptz;

-- Which code a report was about, so "the old one worked" is recorded as the useful fact it is:
-- housekeeping has not changed the lock yet.
alter table door_code_verifications add column if not exists which text;   -- new | old | neither
