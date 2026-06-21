alter table public.echo_user_profiles
  add column if not exists preferences jsonb not null default '{}'::jsonb;

comment on column public.echo_user_profiles.preferences is
  'Private per-user display, map, backup and sync preferences restored after Live Memory login.';
