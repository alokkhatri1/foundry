-- 014: Review-gated DMs for the Stage 5c "draft-and-review" primitive.
--
-- An AI coworker drafts its work, sends the draft to a human for approval via
-- a DM whose `kind` marks it as a review request. The reviewer's UI renders
-- the DM with Approve / Reject buttons; their response is a DM with kind
-- 'review_response' whose `metadata` carries { action, feedback }. When the
-- response is 'approved', the coworker's tool creates the file; otherwise the
-- feedback comes back to the coworker as a tool_result so it can revise.

alter table direct_messages
  add column if not exists kind text not null default 'chat'
    check (kind in ('chat', 'review_request', 'review_response'));

alter table direct_messages
  add column if not exists metadata jsonb;

create index if not exists direct_messages_kind_idx
  on direct_messages(kind)
  where kind != 'chat';
