-- Requires database/stage-one.sql and database/stage-two.sql.
-- One transaction swaps the identified performer. Media ramps only after success.
create or replace function public.rpc_stage_handoff(p_from uuid, p_turn uuid)
returns public.karaokey_performances
language plpgsql security invoker set search_path = '' as $$
declare previous public.karaokey_performances; queued public.karaokey_temas_publico; result public.karaokey_performances;
begin
  if auth.uid() is null then raise exception 'Iniciá sesión.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,14));
  select * into previous from public.karaokey_performances
    where id=p_from and user_id=auth.uid() and managed and ended_at is null for update;
  if not found then raise exception 'La actuación cambió. Actualizá antes de pasar otro turno.'; end if;
  select * into queued from public.karaokey_temas_publico
    where id=p_turn and user_id=auth.uid() and status='pending' for update;
  if not found or queued.youtube_video_id is null then raise exception 'Prepará una versión aprobada antes de pasarla al aire.'; end if;
  perform public.rpc_stage_finish(p_from,false);
  select * into result from public.rpc_stage_start(array[queued.submitted_by],null,null,null,null,p_turn);
  return result;
end $$;
revoke all on function public.rpc_stage_handoff(uuid,uuid) from public,anon;
grant execute on function public.rpc_stage_handoff(uuid,uuid) to authenticated;
