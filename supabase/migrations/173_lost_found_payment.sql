-- 173_lost_found_payment.sql — LOST & FOUND, PAID SHIPPING (Jon, 2026-11-05: "once you identify cost
-- you can update here, then ask for guest to pay, once paid mark paid in the tab and then once paid
-- should send breezeway task"). Where the item goes, when and how payment was asked for, when it was
-- paid and by whom, the Guesty folio line(s) it was billed on, and the Breezeway task that ships it.
-- Safe to run twice.
alter table lost_found_items add column if not exists ship_to            text;
alter table lost_found_items add column if not exists pay_requested_at   timestamptz;
alter table lost_found_items add column if not exists pay_requested_via  text;         -- 'guesty message' | 'airbnb resolution' | 'by hand'
alter table lost_found_items add column if not exists folio_item_ids     jsonb not null default '[]'::jsonb;
alter table lost_found_items add column if not exists paid_at            timestamptz;
alter table lost_found_items add column if not exists paid_by            text;
alter table lost_found_items add column if not exists paid_via           text;         -- 'card on file' | 'payment link' | 'airbnb resolution' | 'cash/other'
alter table lost_found_items add column if not exists breezeway_task_id  text;
alter table lost_found_items add column if not exists breezeway_error    text;
-- Receipts (Jon, 2026-11-05: "can we also have receipt attached") — payment and postage receipts,
-- storage paths in the private lost-found-files bucket, like the item photos.
alter table lost_found_items add column if not exists receipts           jsonb not null default '[]'::jsonb;
-- "Once they complete task it show sent": when the Breezeway delivery task was completed, and by whom.
alter table lost_found_items add column if not exists sent_at            timestamptz;
alter table lost_found_items add column if not exists sent_by            text;
