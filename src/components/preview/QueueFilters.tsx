import type { PreviewTurn } from "../../lib/preview/model";

export function QueueFilters({
  value,
  onChange,
  turns,
}: {
  value: string;
  onChange: (value: string) => void;
  turns: PreviewTurn[];
}) {
  const count = (status: string) =>
    turns.filter((t) => t.status === status).length;
  return (
    <div className="studio-queue-filters">
      <div className="trial-tabs" aria-label="Cola de turnos">
        <button
          aria-pressed={value === "pending"}
          onClick={() => onChange("pending")}
        >
          Aprobados ({count("pending")})
        </button>
        <button
          aria-pressed={value === "review"}
          onClick={() => onChange("review")}
        >
          Por aprobar ({count("review")})
        </button>
      </div>
      <label>
        <span className="trial-muted">Más vistas</span>
        <select
          aria-label="Más vistas de turnos"
          value={["active", "done", "cancelled"].includes(value) ? value : ""}
          onChange={(e) => {
            if (e.target.value) onChange(e.target.value);
          }}
        >
          <option value="" disabled>
            Elegir…
          </option>
          <option value="active">En escenario ({count("active")})</option>
          <option value="done">Historial ({count("done")})</option>
          <option value="cancelled">Retirados ({count("cancelled")})</option>
        </select>
      </label>
    </div>
  );
}
