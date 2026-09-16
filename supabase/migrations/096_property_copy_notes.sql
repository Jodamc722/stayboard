-- OTHER NOTES BELONGS AT BOTH LEVELS.
--
-- Jon, 2026-09-16, looking at the property panel: "Can we also make sure that 'Other things to note'
-- is on that list too, because right now I only see three?"
--
-- 095 put Other notes at the portfolio level only, on the reasoning that it is house boilerplate and
-- pinning it to a building would invent a per-property meaning. That reasoning was half right. The
-- boilerplate is real and still lives at the portfolio level — but a property also has notes of its
-- own ("the pool is closed through November", "the garage entrance moved"), and those are neither
-- unit-specific nor true of every building we manage. Both exist; neither cancels the other, and the
-- level you are standing on decides which listings the text reaches.
--
-- So a property can now keep its Other notes the same way it keeps its lobby directions.
alter table property_copy_standards add column if not exists notes text;

comment on table property_copy_standards is
  'The approved Guest access / Neighborhood / Getting around / Other notes text for one property. The listings in Guesty are copies of this; drift is measured against it. Portfolio-wide Other notes is pushed from the Properties page and is not stored per property.';
