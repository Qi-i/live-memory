create extension if not exists pgcrypto with schema extensions;

create schema if not exists live_memory_private;

revoke all on schema live_memory_private from public, anon, authenticated;

create or replace function live_memory_private.recover_account_password(
  input_username text,
  input_recovery_email text,
  input_new_password text
)
returns boolean
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  normalized_username text := lower(trim(coalesce(input_username, '')));
  normalized_email text := lower(trim(coalesce(input_recovery_email, '')));
  target_user_id uuid;
begin
  if normalized_username !~ '^[a-z0-9]{4,32}$' then
    perform pg_sleep(0.35);
    return false;
  end if;

  if normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    perform pg_sleep(0.35);
    return false;
  end if;

  if length(coalesce(input_new_password, '')) < 8 or length(input_new_password) > 256 then
    perform pg_sleep(0.35);
    return false;
  end if;

  select profile.user_id
    into target_user_id
  from public.echo_user_profiles as profile
  where lower(profile.username) = normalized_username
    and lower(coalesce(profile.recovery_email, '')) = normalized_email
  limit 1;

  if target_user_id is null then
    perform pg_sleep(0.35);
    return false;
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(input_new_password, extensions.gen_salt('bf')),
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      updated_at = now()
  where id = target_user_id;

  return found;
end;
$$;

revoke all on function live_memory_private.recover_account_password(text, text, text) from public, anon, authenticated;
grant usage on schema live_memory_private to anon, authenticated;
grant execute on function live_memory_private.recover_account_password(text, text, text) to anon, authenticated;

create or replace function public.echo_recover_account_password(
  input_username text,
  input_recovery_email text,
  input_new_password text
)
returns boolean
language sql
security invoker
set search_path = public
as $$
  select live_memory_private.recover_account_password(input_username, input_recovery_email, input_new_password)
$$;

grant execute on function public.echo_recover_account_password(text, text, text) to anon, authenticated;

comment on function public.echo_recover_account_password(text, text, text) is
  'Resets a Live Memory account password only when username and recovery email match. The recovery email is never returned to the client.';
