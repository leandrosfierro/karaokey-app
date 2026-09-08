import type { TemaPublicoRow } from '../lib/supabase';

export const queueOrder = (rows: TemaPublicoRow[]) => [...rows].sort((a,b) => (a.approved_at || a.created_at).localeCompare(b.approved_at || b.created_at) || a.id.localeCompare(b.id));

export function StageQueue({ rows, simple, onStart, onPrepare, busy, blockedA, blockedB, prepared, onManage }: {
  rows: TemaPublicoRow[]; simple: boolean; onStart: (row: TemaPublicoRow) => void;
  onPrepare: (row: TemaPublicoRow, deck: 'A'|'B') => void; busy?: boolean;
  blockedA: boolean; blockedB: boolean; prepared: {A?: string;B?: string}; onManage: () => void;
}) {
  const pending = queueOrder(rows.filter(r=>r.status==='pending'));
  return <section className="kk-stage-queue" aria-label="Próximos en cantar">
    <div className="kk-queue-heading"><div><h2>Próximos en cantar</h2><p>Turnos aprobados, en orden. Preparar no inicia la actuación.</p></div><button onClick={onManage}>Ver próximos turnos</button></div>
    {pending.length===0 && <p>No hay turnos aprobados pendientes. Podés aprobar pedidos en Próximos turnos.</p>}
    <ol>{pending.map((r,i)=><li key={r.id}><div className="kk-queue-song"><strong>{i+1}. {r.submitted_by}</strong><span>{r.titulo}</span>{r.artista && <small>{r.artista}</small>}</div><div className="kk-queue-actions">
      {simple ? <button disabled={busy||blockedA} onClick={()=>onStart(r)}>Iniciar turno</button> : (['A','B'] as const).map(d=><button key={d} disabled={busy||(d==='A'?blockedA:blockedB)||prepared[d]===r.id} onClick={()=>onPrepare(r,d)}>{prepared[d]===r.id?`Preparado en ${d}`:`Preparar en ${d}`}</button>)}
    </div></li>)}</ol>
  </section>;
}

export function PerformanceBanner({name,count,visible=true}: {name:string;count:number;visible?:boolean}) {
  return <div className="kk-performance-banner" hidden={!visible || !name}><div><span>Ahora canta</span><strong>{name}</strong></div><p role="status" aria-live="polite" aria-atomic="true"><span aria-hidden="true">👏</span> <b>{count}</b> Aplausos</p></div>;
}
