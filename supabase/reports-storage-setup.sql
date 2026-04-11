-- LPV - Supabase Storage setup (direct upload mode)
-- Execute this file in Supabase SQL Editor.

begin;

insert into storage.buckets (id, name, public)
values ('reports', 'reports', false)
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public;

drop policy if exists "reports_anon_insert" on storage.objects;
drop policy if exists "reports_anon_select" on storage.objects;
drop policy if exists "reports_anon_delete" on storage.objects;

create policy "reports_anon_insert"
on storage.objects
for insert
to anon
with check (
  bucket_id = 'reports'
  and name like 'tasks/%'
);

create policy "reports_anon_select"
on storage.objects
for select
to anon
using (
  bucket_id = 'reports'
  and name like 'tasks/%'
);

create policy "reports_anon_delete"
on storage.objects
for delete
to anon
using (
  bucket_id = 'reports'
  and name like 'tasks/%'
);

commit;
