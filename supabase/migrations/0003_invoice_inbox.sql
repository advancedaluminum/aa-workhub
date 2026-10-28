-- WorkHub: emailed invoice inbox
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
--
-- Vendor invoices that arrive by email land here first (written by the
-- "invoice-inbox" edge function). The app files the sure matches onto their
-- job's material bills and lists the rest under "Needs a job".

create table if not exists public.invoices (
  id          text primary key,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);

drop trigger if exists invoices_stamp on public.invoices;
create trigger invoices_stamp before insert or update on public.invoices
  for each row execute function public.stamp_row();

alter table public.invoices enable row level security;

-- Team members can see them; editors file or dismiss them.
-- New rows only come from the edge function (it uses the secret key).
drop policy if exists "members read invoices"   on public.invoices;
drop policy if exists "editors change invoices" on public.invoices;
drop policy if exists "editors delete invoices" on public.invoices;
create policy "members read invoices"   on public.invoices for select to authenticated using (public.is_member());
create policy "editors change invoices" on public.invoices for update to authenticated using (public.can_edit()) with check (public.can_edit());
create policy "editors delete invoices" on public.invoices for delete to authenticated using (public.can_edit());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'invoices') then
    alter publication supabase_realtime add table public.invoices;
  end if;
end $$;
