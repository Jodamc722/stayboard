-- A SHARED PROJECT BOARD THE OWNERS CAN OPEN AND WORK IN (Jon, 2026-10-09: "this should be
-- sharable with the owners, and password protected. They should have edit access too").
--
-- The vendor link was built for a contractor: no login, see the job, tick your steps, add a note
-- and a photo. An owner is a different reader — they are being handed a board for their own units
-- and expected to use it — so the link grows two settings, both off by default so nothing that is
-- already shared changes behaviour the moment this runs:
--
--   share_passcode  a code the link asks for before it shows anything. Null = open link, as now.
--   share_can_edit  true lets the holder add tasks and change status, not just tick ours.
--
-- The passcode is stored as typed rather than hashed, deliberately: it is a door code for a page,
-- not a credential tied to a person, and whoever shares the link has to be able to read it back to
-- send it again. It is served ONLY to a signed-in project editor, never by the public endpoint.
alter table projects add column if not exists share_passcode text;
alter table projects add column if not exists share_can_edit boolean not null default false;

-- A task the link holder wrote is marked as theirs, the same way a shared note and a shared photo
-- already are, so the team can tell at a glance what came in from outside.
alter table project_steps add column if not exists via_share boolean not null default false;
