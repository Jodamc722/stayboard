-- WHAT WAS ACTUALLY SENT — a snapshot of the email, taken at the moment someone marked it sent.
--
-- Until now the Sent list re-rendered each email from the CURRENT config. That looks fine until
-- somebody edits a template or a recipient list, at which point the record of what a building was
-- told silently rewrites itself. When a front desk says "you never told us about this guest", a
-- record that changes with the settings is worth nothing.
--
-- So mark-sent freezes the four things that make an email an email — to, cc, subject, body — onto
-- the notice. Nothing else can change them afterwards.
--
-- Run via Supabase SQL editor on project: ugbtsppfsgkkrdyyuxxg (Ops App)

alter table reservation_notices add column if not exists sent_to      text;
alter table reservation_notices add column if not exists sent_cc      text;
alter table reservation_notices add column if not exists sent_subject text;
alter table reservation_notices add column if not exists sent_body    text;

-- The filename the form was filed under AT SEND TIME. doc_name follows the current template and is
-- rewritten by Rebuild form; this one does not move, so the record says what the building received.
alter table reservation_notices add column if not exists sent_doc_name text;

comment on column reservation_notices.sent_body is
  'Frozen copy of the email body as it stood when marked sent. Never regenerate this.';

notify pgrst, 'reload schema';
