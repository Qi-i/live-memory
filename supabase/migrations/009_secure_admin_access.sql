-- Management data is now served by the authenticated admin-users Edge Function.
-- Revoke the legacy aggregate RPCs because they previously exposed platform-wide
-- information to any anon/authenticated caller.

revoke execute on function public.echo_admin_stats_overview() from public, anon, authenticated;
revoke execute on function public.echo_admin_stats_trends(int) from public, anon, authenticated;
revoke execute on function public.echo_admin_storage_breakdown() from public, anon, authenticated;
revoke execute on function public.echo_admin_visitor_stats(int) from public, anon, authenticated;
