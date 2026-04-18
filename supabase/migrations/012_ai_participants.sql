-- 012: AI coworkers as first-class DM participants.
--
-- Stage 5c (Collaboration) introduces the ask_human primitive: an AI coworker
-- calls a tool mid-task, a DM is sent to a human, the human replies, the AI
-- resumes with the reply in context. For that to feel like a peer-to-peer DM
-- on the human's side, each AI coworker needs its own row in `participants`
-- so it can appear as a first-class sender/recipient in `direct_messages`.
--
-- One participant mirror per coworker. On coworker delete, cascade the mirror.

alter table participants
  add column if not exists kind text not null default 'human'
    check (kind in ('human', 'ai'));

alter table participants
  add column if not exists coworker_id text null
    references coworkers(id) on delete cascade;

-- At most one participant mirror per coworker.
create unique index if not exists participants_coworker_unique
  on participants(coworker_id)
  where coworker_id is not null;

create index if not exists participants_kind_idx
  on participants(kind);
