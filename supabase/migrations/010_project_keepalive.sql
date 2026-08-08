create or replace function public.project_keepalive()
returns timestamptz
language sql
stable
security invoker
set search_path = public
as $$
  select now();
$$;

revoke all on function public.project_keepalive() from public;
grant execute on function public.project_keepalive() to anon, authenticated;

comment on function public.project_keepalive() is
  'Minimal health query used by scheduled automation to keep this Free project active without reading application data.';
