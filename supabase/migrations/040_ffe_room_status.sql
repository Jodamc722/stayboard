-- COMPLETENESS MOVES FROM THE ITEM TO THE ROOM (Jon, 2026-08-14).
--
--   "Instead of having standard things on the checklist, you can click into the living room and you
--    can click Add... That way you don't have a hundred different things that you're going through,
--    but you're giving the auditor the ability to just determine what needs to be checked off."
--
-- THE PROBLEM THIS SOLVES. The walk used to be a survey: 64 questions on a 3-bedroom, answer every
-- one. Measured on the real form, that is 6,807 pixels — about eight and a half phone screens — and
-- 65 buttons, to record maybe six findings. So it becomes an exception log instead: rooms start
-- empty and the walker adds only what needs doing.
--
-- BUT AN EMPTY ROOM IS AMBIGUOUS, and that is what this table fixes. "No findings in the living
-- room" and "nobody went into the living room" look identical in an exception log, and the
-- difference matters the day an owner holding a $30,000 order asks whether anyone checked the guest
-- bedroom. One tap per room — "I've checked this room" — buys the coverage proof back at the level
-- people actually ask about, for seven taps a unit instead of sixty-four.
--
-- WHY NOT REUSE ffe_unit_status. That table records the walker's statement about the WHOLE unit
-- ("this one is finished"). This is a statement about one room, and a unit is legitimately part-way
-- through with four rooms checked and three not. Two different facts, two rows.
--
-- NOT a foreign key to anything: rooms are checklist keys ('living', 'master', 'guest1'), not rows.
-- The checklist is code plus the overlay table, so there is nothing here to point at.

create table if not exists ffe_room_status (
  listing_id  text not null,
  room        text not null,               -- checklist room key: living, dining, master, guest1…
  checked_at  timestamptz,                 -- null = not checked; set = somebody stood in it
  checked_by  text,
  updated_at  timestamptz not null default now(),
  primary key (listing_id, room)
);

create index if not exists ffe_room_status_listing on ffe_room_status (listing_id);

-- Same posture as every other FF&E table: RLS on with no policies, so nothing reaches this except
-- the service role behind our own gated routes. The walk form reads and writes it through the
-- capability link, never directly.
alter table ffe_room_status enable row level security;
