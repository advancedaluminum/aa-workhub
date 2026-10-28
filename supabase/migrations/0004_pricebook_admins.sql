-- WorkHub: only admins can change the price book
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.
--
-- Everyone on the team can still read the price book (estimates need it).
-- Editors can still change other settings, such as the team and overhead rates.

drop policy if exists "editors write settings"  on public.settings;
drop policy if exists "editors change settings" on public.settings;
drop policy if exists "admins write price book"  on public.settings;
drop policy if exists "admins change price book" on public.settings;

create policy "editors write settings" on public.settings for insert to authenticated
  with check (public.can_edit() and (id <> 'pricebook' or public.is_admin()));
create policy "editors change settings" on public.settings for update to authenticated
  using (public.can_edit() and (id <> 'pricebook' or public.is_admin()))
  with check (public.can_edit() and (id <> 'pricebook' or public.is_admin()));
