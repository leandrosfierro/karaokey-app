create schema if not exists private;
revoke all on schema private from public, anon;

create table if not exists private.karaokey_superadmins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists private.karaokey_user_activity (
  user_id uuid primary key references auth.users(id) on delete cascade,
  page text not null default '/',
  mode text,
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint karaokey_user_activity_page_length check (char_length(page) between 1 and 120),
  constraint karaokey_user_activity_mode check (mode is null or mode in ('simple', 'pro'))
);

create index if not exists karaokey_user_activity_online_idx
  on private.karaokey_user_activity(last_seen_at desc);

insert into private.karaokey_superadmins(user_id)
select id
from auth.users
where lower(email) in ('leandrosfierro@gmail.com', 'leandro.fierro@bs360.com.ar')
on conflict (user_id) do nothing;

create or replace function private.karaokey_is_superadmin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.karaokey_superadmins a
    where a.user_id = (select auth.uid())
  );
$$;

create or replace function private.karaokey_touch_activity(p_page text, p_mode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Iniciá sesión.' using errcode = '42501';
  end if;

  insert into private.karaokey_user_activity(user_id, page, mode, last_seen_at, updated_at)
  values (
    auth.uid(),
    left(coalesce(nullif(trim(p_page), ''), '/'), 120),
    case when p_mode in ('simple', 'pro') then p_mode else null end,
    now(),
    now()
  )
  on conflict (user_id) do update
    set page = excluded.page,
        mode = excluded.mode,
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at;
end;
$$;

create or replace function private.karaokey_admin_snapshot()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not private.karaokey_is_superadmin() then
    raise exception 'Acceso exclusivo para superadministradores.' using errcode = '42501';
  end if;

  with
  song_counts as (
    select user_id, count(*)::int as total
    from public.karaokey_canciones
    where user_id is not null
    group by user_id
  ),
  participant_counts as (
    select user_id, count(*)::int as total
    from public.karaokey_participantes
    where user_id is not null
    group by user_id
  ),
  turn_counts as (
    select user_id, count(*)::int as total,
      count(*) filter (where status in ('review', 'pending', 'active'))::int as open
    from public.karaokey_temas_publico
    group by user_id
  ),
  performance_counts as (
    select user_id, count(*)::int as total,
      count(*) filter (where ended_at is null)::int as active
    from public.karaokey_performances
    group by user_id
  ),
  applause_counts as (
    select p.user_id, count(a.id)::int as total
    from public.karaokey_performances p
    left join public.karaokey_aplausos a on a.performance_id = p.id
    group by p.user_id
  ),
  user_rows as (
    select
      u.id,
      u.email,
      u.created_at,
      u.last_sign_in_at,
      coalesce(ac.last_seen_at, u.last_sign_in_at, u.created_at) as last_activity_at,
      ac.page,
      coalesce(ac.mode, u.raw_user_meta_data ->> 'modo') as mode,
      (ac.last_seen_at >= now() - interval '2 minutes') as online,
      coalesce(sc.total, 0) as songs,
      coalesce(pc.total, 0) as participants,
      coalesce(tc.total, 0) as turns,
      coalesce(tc.open, 0) as open_turns,
      coalesce(pfc.total, 0) as performances,
      coalesce(pfc.active, 0) as active_performances,
      coalesce(ap.total, 0) as applause
    from auth.users u
    left join private.karaokey_user_activity ac on ac.user_id = u.id
    left join song_counts sc on sc.user_id = u.id
    left join participant_counts pc on pc.user_id = u.id
    left join turn_counts tc on tc.user_id = u.id
    left join performance_counts pfc on pfc.user_id = u.id
    left join applause_counts ap on ap.user_id = u.id
  ),
  daily as (
    select date_trunc('day', day)::date as day,
      (select count(*)::int from auth.users u where u.created_at >= day and u.created_at < day + interval '1 day') as registrations
    from generate_series(
      date_trunc('day', now()) - interval '13 days',
      date_trunc('day', now()),
      interval '1 day'
    ) day
  )
  select jsonb_build_object(
    'generated_at', now(),
    'metrics', jsonb_build_object(
      'total_users', (select count(*) from auth.users),
      'new_users_7d', (select count(*) from auth.users where created_at >= now() - interval '7 days'),
      'online_now', (select count(*) from user_rows where online),
      'active_24h', (select count(*) from user_rows where last_activity_at >= now() - interval '24 hours'),
      'active_performances', (select coalesce(sum(active_performances), 0) from user_rows),
      'songs', (select coalesce(sum(songs), 0) from user_rows),
      'turns', (select coalesce(sum(turns), 0) from user_rows),
      'applause', (select coalesce(sum(applause), 0) from user_rows)
    ),
    'users', coalesce((select jsonb_agg(to_jsonb(user_rows) order by online desc, last_activity_at desc) from user_rows), '[]'::jsonb),
    'registrations', coalesce((select jsonb_agg(to_jsonb(daily) order by day) from daily), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

create or replace function public.rpc_activity_ping(p_page text, p_mode text default null)
returns void
language sql
security invoker
set search_path = ''
as $$ select private.karaokey_touch_activity(p_page, p_mode); $$;

create or replace function public.rpc_superadmin_snapshot()
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.karaokey_admin_snapshot(); $$;

revoke all on function private.karaokey_is_superadmin() from public, anon;
revoke all on function private.karaokey_touch_activity(text, text) from public, anon;
revoke all on function private.karaokey_admin_snapshot() from public, anon;
revoke all on function public.rpc_activity_ping(text, text) from public, anon;
revoke all on function public.rpc_superadmin_snapshot() from public, anon;

grant usage on schema private to authenticated;
grant execute on function private.karaokey_touch_activity(text, text) to authenticated;
grant execute on function private.karaokey_admin_snapshot() to authenticated;
grant execute on function public.rpc_activity_ping(text, text) to authenticated;
grant execute on function public.rpc_superadmin_snapshot() to authenticated;
