-- 007_account_recovery_rpc.sql
-- RPC: bridge username → auth email for password reset via recovery email.
-- The client calls resetPasswordForEmail with the auth email (synthetic),
-- which Supabase Auth can find in auth.users. The reset link goes to the
-- redirectTo URL where the user completes the password change.

create or replace function public.echo_find_auth_email(p_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_email text;
  v_recovery_email text;
begin
  -- 1. Verify profile exists and has a recovery email
  select p.recovery_email into v_recovery_email
    from public.echo_user_profiles p
   where lower(p.username) = lower(p_username);

  if v_recovery_email is null or trim(v_recovery_email) = '' then
    raise exception 'no_recovery_email';
  end if;

  -- 2. Find the auth email for this user
  select u.email into v_auth_email
    from public.echo_user_profiles p
    join auth.users u on u.id = p.user_id
   where lower(p.username) = lower(p_username);

  if v_auth_email is null then
    raise exception 'user_not_found';
  end if;

  return v_auth_email;
end;
$$;

comment on function public.echo_find_auth_email(text) is
  'Looks up the auth email for a username. Used by the password reset flow to bridge the gap between the recovery email in echo_user_profiles and the synthetic email in auth.users.';

-- Allow anonymous calls (the user is not logged in when resetting password)
grant execute on function public.echo_find_auth_email(text) to anon;
grant execute on function public.echo_find_auth_email(text) to authenticated;

