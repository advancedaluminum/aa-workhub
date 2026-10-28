-- Field estimator: saved estimates.
-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.
-- It is safe to run again.
-- (The price book needs no new table: it is saved as the "pricebook" row in settings.)

create table if not exists public.estimates (
  id          text primary key,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);

drop trigger if exists estimates_stamp on public.estimates;
create trigger estimates_stamp before insert or update on public.estimates
  for each row execute function public.stamp_row();

alter table public.estimates enable row level security;

drop policy if exists "members read estimates"   on public.estimates;
drop policy if exists "editors add estimates"    on public.estimates;
drop policy if exists "editors change estimates" on public.estimates;
drop policy if exists "editors delete estimates" on public.estimates;
create policy "members read estimates"   on public.estimates for select to authenticated using (public.is_member());
create policy "editors add estimates"    on public.estimates for insert to authenticated with check (public.can_edit());
create policy "editors change estimates" on public.estimates for update to authenticated using (public.can_edit()) with check (public.can_edit());
create policy "editors delete estimates" on public.estimates for delete to authenticated using (public.can_edit());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'estimates') then
    alter publication supabase_realtime add table public.estimates;
  end if;
end $$;
