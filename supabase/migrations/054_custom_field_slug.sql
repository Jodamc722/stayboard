-- GUESTY CUSTOM FIELDS — STORE THE MERGE TAG (2026-08-25).
--
-- Guesty's account endpoint returns each definition as:
--   { fieldId, key, displayName, object, type, options, isPublic }
--   e.g. { fieldId:'695af1454ebbdc00137c3f41', key:'Door code', displayName:'door_code',
--          object:'listing', type:'text' }
--
-- `key` is the human label; `displayName` is the MERGE TAG used in Guesty templates ({{door_code}}).
-- The mapper produced both, but this table had no `slug` column, so every upsert was rejected and
-- the mirror stayed EMPTY — on top of the id being read from `_id` instead of `fieldId`. Between
-- them, 35 live definitions resolved to nothing and anything that looks a field up BY NAME
-- (guest-order form link, door codes, welcome-call flags) silently found none.
--
-- Storing the tag matters because it is what an operator actually has in front of them: Jon named
-- the reservation field by its tag, {{guest_order_form1}}, not by its label.
alter table if exists public.guesty_custom_fields
  add column if not exists slug text;

create index if not exists guesty_custom_fields_slug_idx on public.guesty_custom_fields (lower(slug));
create index if not exists guesty_custom_fields_name_idx on public.guesty_custom_fields (lower(name));

comment on column public.guesty_custom_fields.slug is
  'Guesty displayName — the merge tag used in templates, e.g. door_code for {{door_code}}';
comment on column public.guesty_custom_fields.name is
  'Guesty key — the human label shown in the Guesty UI, e.g. "Door code"';

notify pgrst, 'reload schema';
