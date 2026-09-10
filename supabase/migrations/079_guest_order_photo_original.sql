-- KEEP THE ORIGINAL PHOTO (Jon, 2026-09-10: "need to be able to customize or edit the photos").
--
-- Every edit re-renders from the ORIGINAL, never from the last render. Editing a JPEG that was
-- already cropped, levelled and re-compressed stacks the losses: crop in twice and you cannot get
-- back out, sharpen twice and the edges crunch. With the original kept, zoom is reversible, "reset"
-- is real, and the tenth edit is exactly as good as the first.
alter table guest_order_catalog add column if not exists image_original text;
comment on column guest_order_catalog.image_original is 'Untouched upload. image_url is the rendered version guests see; edits always start here.';
notify pgrst, 'reload schema';
