-- Protect visitor telemetry from direct access via Supabase Data API.
-- Reads/writes remain exclusively through existing owner-controlled RPCs:
-- public.echo_record_page_view() -> live_memory_private.record_page_view()
-- public.echo_admin_visitor_stats() -> live_memory_private.admin_visitor_stats().
-- They run with server-side privileges; public roles never access the table.
alter table if exists public.echo_page_views enable row level security;
revoke all on table public.echo_page_views from public, anon, authenticated;
revoke all on sequence public.echo_page_views_id_seq from public, anon, authenticated;
-- Explicitly deny all direct SELECT / INSERT / UPDATE / DELETE operations.

-- Explicit deny-only policy keeps the telemetry table closed even if a
-- future migration accidentally re-grants base table privileges.
drop policy if exists echo_page_views_no_direct_access on public.echo_page_views;
create policy echo_page_views_no_direct_access on public.echo_page_views
  for all to anon, authenticated using (false) with check (false);
