-- Advanced Aluminum Hub: database setup
-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.
-- It is safe to run again; everything uses "if not exists" / "or replace".

-- ---------------------------------------------------------------
-- Team members: only people listed here can open the app.
--   role 'admin'  = can edit everything and manage the team list
--   role 'editor' = can add and change jobs, bills and rates
--   role 'viewer' = can look but not change anything
-- ---------------------------------------------------------------
create table if not exists public.members (
  email       text primary key check (email = lower(email)),
  name        text,
  role        text not null default 'editor' check (role in ('admin', 'editor', 'viewer')),
  created_at  timestamptz not null default now()
);

-- Jobs: one row per job. The whole job (estimate, bills, actuals, insights)
-- is kept in "data", exactly as the app saved it in Claude.
create table if not exists public.jobs (
  id          text primary key,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  text
);

-- Settings: company-wide values such as the team and overhead rates.
create table if not exists public.settings (
  id          text primary key,
  data        jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

-- Who is signed in, and what may they do?
create or replace function public.current_email() returns text
  language sql stable
  as $$ select lower(coalesce(auth.jwt() ->> 'email', '')) $$;

create or replace function public.is_member() returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from public.members m where m.email = public.current_email()) $$;

create or replace function public.can_edit() returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from public.members m where m.email = public.current_email() and m.role in ('admin', 'editor')) $$;

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public
  as $$ select exists (select 1 from public.members m where m.email = public.current_email() and m.role = 'admin') $$;

-- Stamp who changed a row and when.
create or replace function public.stamp_row() returns trigger
  language plpgsql
  as $$
  begin
    new.updated_at := now();
    new.updated_by := public.current_email();
    return new;
  end $$;

drop trigger if exists jobs_stamp on public.jobs;
create trigger jobs_stamp before insert or update on public.jobs
  for each row execute function public.stamp_row();
drop trigger if exists settings_stamp on public.settings;
create trigger settings_stamp before insert or update on public.settings
  for each row execute function public.stamp_row();

-- ---------------------------------------------------------------
-- Row-level security: nobody outside the members list sees anything.
-- ---------------------------------------------------------------
alter table public.members  enable row level security;
alter table public.jobs     enable row level security;
alter table public.settings enable row level security;

drop policy if exists "members read team"   on public.members;
drop policy if exists "admins manage team"  on public.members;
create policy "members read team"  on public.members for select to authenticated using (public.is_member());
create policy "admins manage team" on public.members for all    to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "members read jobs"   on public.jobs;
drop policy if exists "editors add jobs"    on public.jobs;
drop policy if exists "editors change jobs" on public.jobs;
drop policy if exists "editors delete jobs" on public.jobs;
create policy "members read jobs"   on public.jobs for select to authenticated using (public.is_member());
create policy "editors add jobs"    on public.jobs for insert to authenticated with check (public.can_edit());
create policy "editors change jobs" on public.jobs for update to authenticated using (public.can_edit()) with check (public.can_edit());
create policy "editors delete jobs" on public.jobs for delete to authenticated using (public.can_edit());

drop policy if exists "members read settings"   on public.settings;
drop policy if exists "editors write settings"  on public.settings;
drop policy if exists "editors change settings" on public.settings;
create policy "members read settings"   on public.settings for select to authenticated using (public.is_member());
create policy "editors write settings"  on public.settings for insert to authenticated with check (public.can_edit());
create policy "editors change settings" on public.settings for update to authenticated using (public.can_edit()) with check (public.can_edit());

-- ---------------------------------------------------------------
-- Live updates: changes one person makes show up for everyone.
-- ---------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'jobs') then
    alter publication supabase_realtime add table public.jobs;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'settings') then
    alter publication supabase_realtime add table public.settings;
  end if;
end $$;

-- ---------------------------------------------------------------
-- Bill files (PDFs and photos): a private storage bucket.
-- Files are only reachable through short-lived links the app creates
-- for signed-in team members.
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('bills', 'bills', false, 26214400)
on conflict (id) do nothing;

drop policy if exists "members read bill files"   on storage.objects;
drop policy if exists "editors add bill files"    on storage.objects;
drop policy if exists "editors delete bill files" on storage.objects;
create policy "members read bill files"   on storage.objects for select to authenticated using (bucket_id = 'bills' and public.is_member());
create policy "editors add bill files"    on storage.objects for insert to authenticated with check (bucket_id = 'bills' and public.can_edit());
create policy "editors delete bill files" on storage.objects for delete to authenticated using (bucket_id = 'bills' and public.can_edit());

-- Starting rates (the app keeps them up to date after this).
insert into public.settings (id, data)
values ('rates', '{"teamRate": 113.15, "overheadRate": 242.65}')
on conflict (id) do nothing;

-- ---------------------------------------------------------------
-- LAST STEP: add yourself as the first admin. Change the email below
-- to the one you will sign in with, then run just this line.
-- ---------------------------------------------------------------
-- insert into public.members (email, name, role) values ('you@advancedaluminum.com', 'Your Name', 'admin');
