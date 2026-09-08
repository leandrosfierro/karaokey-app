-- Duo names remain separate so completion marks both participants correctly.
alter table public.karaokey_temas_publico add column if not exists participantes text[];
create or replace function public.rpc_stage_start(p_participantes text[],p_titulo text default null,p_artista text default null,p_video text default null,p_thumbnail text default null,p_turn uuid default null)
returns public.karaokey_performances language plpgsql security invoker set search_path='' as $$
declare t public.karaokey_temas_publico; result public.karaokey_performances;
begin
  if auth.uid() is null then raise exception 'Iniciá sesión.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,14));
  if exists(select 1 from public.karaokey_performances where user_id=auth.uid() and managed and ended_at is null) then raise exception 'Finalizá la actuación actual antes de iniciar otra.'; end if;
  if p_turn is not null then
    select * into t from public.karaokey_temas_publico where id=p_turn and user_id=auth.uid() for update;
    if not found or t.status<>'pending' then raise exception 'El turno no está aprobado o ya fue iniciado.'; end if;
    p_participantes:=coalesce(t.participantes,array[t.submitted_by]);
    p_titulo:=nullif(t.titulo,''); p_artista:=t.artista; p_video:=t.youtube_video_id; p_thumbnail:=t.youtube_thumbnail;
    update public.karaokey_temas_publico set status='active' where id=p_turn;
  end if;
  if coalesce(cardinality(p_participantes),0) not between 1 and 2 or exists(select 1 from unnest(p_participantes) n where n is null or length(trim(n))=0 or length(n)>120) then raise exception 'Elegí uno o dos cantantes.'; end if;
  if (select count(distinct lower(trim(n))) from unnest(p_participantes) n)<>cardinality(p_participantes) then raise exception 'Elegí dos personas diferentes para el dúo.'; end if;
  if p_video is not null and p_video !~ '^[A-Za-z0-9_-]{11}$' then raise exception 'Video no válido.'; end if;
  insert into public.karaokey_performances(user_id,participantes,cancion_titulo,cancion_artista,managed,turn_id,youtube_video_id,youtube_thumbnail)
    values(auth.uid(),p_participantes,p_titulo,p_artista,true,p_turn,p_video,p_thumbnail) returning * into result;
  return result;
end $$;
revoke all on function public.rpc_stage_start(text[],text,text,text,text,uuid) from public,anon;
grant execute on function public.rpc_stage_start(text[],text,text,text,text,uuid) to authenticated;
