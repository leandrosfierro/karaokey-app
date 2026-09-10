create or replace function public.rpc_is_superadmin()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select private.karaokey_is_superadmin();
$$;

revoke all on function public.rpc_is_superadmin() from public, anon;
grant execute on function private.karaokey_is_superadmin() to authenticated;
grant execute on function public.rpc_is_superadmin() to authenticated;
