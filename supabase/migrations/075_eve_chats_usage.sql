-- EVE TOKEN ACCOUNTING (2026-09-09, the API bill).
--
-- Eve was the biggest line on the Anthropic invoice and nobody could say what one answer cost.
-- Each chat row now carries the token counts the API returned across every turn of the loop:
--   { input, output, cacheRead, cacheWrite }
-- cacheRead is the one to watch: it is how many input tokens were served from the prompt cache at
-- a tenth of the price. If it stays near zero after this deploy, caching is not working.
alter table public.eve_chats add column if not exists usage jsonb;
notify pgrst, 'reload schema';
