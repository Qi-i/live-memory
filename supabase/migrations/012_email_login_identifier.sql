create or replace function live_memory_private.resolve_login_username(input_identifier text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized_identifier text := lower(trim(coalesce(input_identifier, '')));
  matched_username text;
  matched_count integer;
begin
  if length(normalized_identifier) < 4 or length(normalized_identifier) > 320 then
    return null;
  end if;

  if normalized_identifier !~ '^[a-z0-9]{4,32}$'
     and normalized_identifier !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return null;
  end if;

  select min(lower(profile.username)), count(*)
    into matched_username, matched_count
  from public.echo_user_profiles as profile
  left join auth.users as auth_user on auth_user.id = profile.user_id
  where lower(coalesce(profile.username, '')) = normalized_identifier
     or lower(coalesce(profile.recovery_email, '')) = normalized_identifier
     or lower(coalesce(auth_user.email, '')) = normalized_identifier;

  if matched_count <> 1 or matched_username !~ '^[a-z0-9]{4,32}$' then
    return null;
  end if;

  return matched_username;
end;
$$;

revoke all on function live_memory_private.resolve_login_username(text) from public, anon, authenticated;
grant usage on schema live_memory_private to anon, authenticated;
grant execute on function live_memory_private.resolve_login_username(text) to anon, authenticated;

create or replace function public.echo_resolve_login_username(input_identifier text)
returns text
language sql
security invoker
set search_path = public
as $$
  select live_memory_private.resolve_login_username(input_identifier)
$$;

grant execute on function public.echo_resolve_login_username(text) to anon, authenticated;

comment on function public.echo_resolve_login_username(text) is
  'Resolves a Live Memory login identifier (username, recovery email, or current auth email) to the canonical username without exposing stored email addresses.';
