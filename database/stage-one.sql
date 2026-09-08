-- Additive first release. Existing records and legacy clients remain readable.
alter table public.karaokey_temas_publico add column if not exists status text not null default 'review' check (status in ('review','pending','active','done','cancelled'));
alter table public.karaokey_temas_publico add column if not exists approved_at timestamptz;
alter table public.karaokey_canciones add column if not exists youtube_video_id text;
alter table public.karaokey_canciones add column if not exists youtube_thumbnail text;
alter table public.karaokey_performances add column if not exists ended_at timestamptz;
alter table public.karaokey_performances add column if not exists managed boolean not null default false;
alter table public.karaokey_performances add column if not exists turn_id uuid references public.karaokey_temas_publico(id) on delete set null;
alter table public.karaokey_performances add column if not exists youtube_video_id text;
alter table public.karaokey_performances add column if not exists youtube_thumbnail text;
create unique index if not exists karaokey_one_active_managed on public.karaokey_performances(user_id) where managed and ended_at is null;
create index if not exists karaokey_queue_order on public.karaokey_temas_publico(user_id,status,approved_at,id);

create or replace function public.rpc_queue_status(p_id uuid,p_status text)
returns public.karaokey_temas_publico language plpgsql security invoker set search_path='' as $$
declare t public.karaokey_temas_publico;
begin
  if auth.uid() is null then raise exception 'Iniciá sesión.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 14));
  select * into t from public.karaokey_temas_publico where id=p_id and user_id=auth.uid() for update;
  if not found then raise exception 'Turno no disponible.'; end if;
  if not ((t.status in ('review','cancelled') and p_status='pending') or (t.status in ('review','pending') and p_status='cancelled')) then raise exception 'El turno cambió. Actualizá la lista.'; end if;
  update public.karaokey_temas_publico set status=p_status, approved_at=case when p_status='pending' then clock_timestamp() else approved_at end where id=p_id returning * into t;
  return t;
end $$;

create or replace function public.rpc_stage_start(p_participantes text[],p_titulo text default null,p_artista text default null,p_video text default null,p_thumbnail text default null,p_turn uuid default null)
returns public.karaokey_performances language plpgsql security invoker set search_path='' as $$
declare t public.karaokey_temas_publico; result public.karaokey_performances;
begin
  if auth.uid() is null then raise exception 'Iniciá sesión.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 14));
  if exists(select 1 from public.karaokey_performances where user_id=auth.uid() and managed and ended_at is null) then raise exception 'Finalizá la actuación actual antes de iniciar otra.'; end if;
  if p_turn is not null then
    select * into t from public.karaokey_temas_publico where id=p_turn and user_id=auth.uid() for update;
    if not found or t.status <> 'pending' then raise exception 'El turno no está aprobado o ya fue iniciado.'; end if;
    p_participantes:=array[t.submitted_by]; p_titulo:=t.titulo; p_artista:=t.artista; p_video:=t.youtube_video_id; p_thumbnail:=t.youtube_thumbnail;
    update public.karaokey_temas_publico set status='active' where id=p_turn;
  end if;
  if coalesce(cardinality(p_participantes),0) not between 1 and 2 or exists(select 1 from unnest(p_participantes) n where length(trim(n))=0 or length(n)>120) then raise exception 'Elegí uno o dos cantantes.'; end if;
  if p_video is not null and p_video !~ '^[A-Za-z0-9_-]{11}$' then raise exception 'Video no válido.'; end if;
  insert into public.karaokey_performances(user_id,participantes,cancion_titulo,cancion_artista,managed,turn_id,youtube_video_id,youtube_thumbnail)
    values(auth.uid(),p_participantes,p_titulo,p_artista,true,p_turn,p_video,p_thumbnail) returning * into result;
  return result;
end $$;

create or replace function public.rpc_stage_finish(p_id uuid,p_return boolean default false)
returns void language plpgsql security invoker set search_path='' as $$
declare p public.karaokey_performances;
begin
  if auth.uid() is null then raise exception 'Iniciá sesión.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 14));
  select * into p from public.karaokey_performances where id=p_id and user_id=auth.uid() and managed for update;
  if not found then raise exception 'Actuación no disponible.'; end if;
  if p.ended_at is not null then return; end if;
  update public.karaokey_performances set ended_at=clock_timestamp() where id=p_id;
  if p.turn_id is not null then update public.karaokey_temas_publico set status=case when p_return then 'pending' else 'done' end where id=p.turn_id and user_id=auth.uid(); end if;
  if not p_return then update public.karaokey_participantes set ya_canto=true where user_id=auth.uid() and nombre=any(p.participantes); end if;
end $$;
revoke all on function public.rpc_queue_status(uuid,text) from public,anon;
revoke all on function public.rpc_stage_start(text[],text,text,text,text,uuid) from public,anon;
revoke all on function public.rpc_stage_finish(uuid,boolean) from public,anon;
grant execute on function public.rpc_queue_status(uuid,text),public.rpc_stage_start(text[],text,text,text,text,uuid),public.rpc_stage_finish(uuid,boolean) to authenticated;

-- Preserve the public applause API; reject votes once a performance has closed.
create or replace function public.rpc_registrar_aplauso(p_code text,p_performance_id uuid,p_device_id text)
returns table(total bigint) language plpgsql security definer set search_path='' as $$
declare v_host uuid; v_owner uuid; v_ended timestamptz;
begin
  select user_id into v_host from public.karaokey_hosts where party_code=upper(trim(p_code)) and participativo_enabled;
  if v_host is null then raise exception 'invalid_or_disabled_party'; end if;
  select user_id,ended_at into v_owner,v_ended from public.karaokey_performances where id=p_performance_id for share;
  if v_owner is null or v_owner<>v_host or v_ended is not null then raise exception 'invalid_performance'; end if;
  if p_device_id is null or length(trim(p_device_id)) not between 1 and 200 then raise exception 'device_id_required'; end if;
  insert into public.karaokey_aplausos(performance_id,device_id) values(p_performance_id,p_device_id) on conflict(performance_id,device_id) do nothing;
  return query select count(*) from public.karaokey_aplausos where performance_id=p_performance_id;
end $$;
revoke all on function public.rpc_registrar_aplauso(text,uuid,text) from public;
grant execute on function public.rpc_registrar_aplauso(text,uuid,text) to anon,authenticated;
