-- Guest orders: the guest says WHEN they want it (Jon, 2026-08-24: "once marked as paid it will
-- prompt day they want to receive — ASAP if in house, arrival day is auto if completed before
-- arrival, or set date"). Stored at submit time, applied when the order is paid, editable by staff.
alter table guest_orders add column if not exists requested_delivery text not null default 'auto';  -- auto | asap | arrival | date
alter table guest_orders add column if not exists requested_date date;
