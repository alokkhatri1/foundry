-- Recalibrate the credit budget display: same $0.50 dollar cap, but surfaced
-- as 1000 credits instead of 100. Bigger numbers counting down feel more
-- generous and give finer per-action resolution (a typical chat is ~10
-- credits instead of ~1). No change to actual spend — just the scale.

-- Bump every existing room's allocation by 10× so participants keep the
-- same real budget. Admin overrides persist proportionally.
update rooms
  set credit_allocation = credit_allocation * 10
  where credit_allocation is not null;

-- New default for rooms created going forward.
alter table rooms
  alter column credit_allocation set default 1000;
