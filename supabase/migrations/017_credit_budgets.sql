-- 017: Per-participant credit budgets.
--
-- 100 credits = $0.50 at current rates (1 credit = $0.005). Each workshop
-- starts with a default allocation per participant; the admin can bump the
-- allocation for the whole room at any time, and can grant bonus credits
-- to a specific participant if someone's burning through faster than
-- expected. Credits "used" is derived live from the llm_usage table —
-- not stored here — so every call's spend is automatically counted.
--
-- Display is visible from Stage 1; enforcement (hard-stop at 0, soft-
-- warning at 10) runs on the client before every Claude call.

alter table rooms
  add column if not exists credit_allocation int not null default 100;

alter table participants
  add column if not exists credit_bonus int not null default 0;
