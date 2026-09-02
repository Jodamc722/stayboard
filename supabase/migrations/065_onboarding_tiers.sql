-- ONBOARDING: item tiers (Jon, 2026-09-02: "must haves should be a section there, recommended,
-- suggestions"). The standard carries a tier per row; the generated item keeps it so the room view
-- can group Must have / Recommended / Suggested. Custom items default to must.
alter table public.onboarding_items add column if not exists tier text not null default 'must';
notify pgrst, 'reload schema';
