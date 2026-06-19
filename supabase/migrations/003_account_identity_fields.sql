alter table public.echo_user_profiles
  add column if not exists username text,
  add column if not exists nickname text,
  add column if not exists avatar_url text,
  add column if not exists recovery_email text;

create unique index if not exists echo_user_profiles_username_key
  on public.echo_user_profiles (lower(username))
  where username is not null and username <> '';

comment on column public.echo_user_profiles.username is
  'Human-readable login/display handle. Passwords are managed by Supabase Auth, not this table.';
comment on column public.echo_user_profiles.nickname is
  'Display nickname shown in the app header and account card.';
comment on column public.echo_user_profiles.avatar_url is
  'Optional user-provided avatar URL for display only.';
comment on column public.echo_user_profiles.recovery_email is
  'Optional email for account recovery guidance. Do not use this column as a secret.';
