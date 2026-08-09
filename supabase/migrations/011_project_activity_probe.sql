create table if not exists public.project_activity_probe (
  id smallint primary key,
  label text not null default 'keepalive'
);

insert into public.project_activity_probe (id, label)
values (1, 'keepalive')
on conflict (id) do nothing;

alter table public.project_activity_probe enable row level security;
revoke all on table public.project_activity_probe from public, anon, authenticated;
grant select on table public.project_activity_probe to anon, authenticated;

drop policy if exists "project activity probe read" on public.project_activity_probe;
create policy "project activity probe read"
on public.project_activity_probe
for select
to anon, authenticated
using (id = 1);

comment on table public.project_activity_probe is
  'Single-row, non-sensitive probe used by scheduled clients to generate real user database activity for Free-plan project availability.';
