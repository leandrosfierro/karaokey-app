import { useCallback, useEffect, useMemo, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import {
  Activity,
  BarChart3,
  Clock3,
  Headphones,
  LogOut,
  Music2,
  RefreshCw,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";

type Metrics = {
  total_users: number;
  new_users_7d: number;
  online_now: number;
  active_24h: number;
  active_performances: number;
  songs: number;
  turns: number;
  applause: number;
};
type AdminUser = {
  id: string;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  last_activity_at: string;
  page: string | null;
  mode: string | null;
  online: boolean;
  songs: number;
  participants: number;
  turns: number;
  open_turns: number;
  performances: number;
  active_performances: number;
  applause: number;
};
type Snapshot = {
  generated_at: string;
  metrics: Metrics;
  users: AdminUser[];
  registrations: { day: string; registrations: number }[];
};
const EMPTY: Metrics = {
  total_users: 0,
  new_users_7d: 0,
  online_now: 0,
  active_24h: 0,
  active_performances: 0,
  songs: 0,
  turns: 0,
  applause: 0,
};

function relativeTime(value: string | null) {
  if (!value) return "Sin actividad";
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 1000),
  );
  if (seconds < 60) return "Ahora";
  if (seconds < 3600) return `Hace ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `Hace ${Math.floor(seconds / 3600)} h`;
  return `Hace ${Math.floor(seconds / 86400)} días`;
}

function pageName(path: string | null) {
  if (!path) return "Fuera de la app";
  if (path.startsWith("/estudio/pantalla")) return "Pantalla pública";
  if (path.startsWith("/estudio")) return "Estudio";
  if (path.startsWith("/vivo")) return "Participando";
  if (path.startsWith("/clasico")) return "Versión clásica";
  if (path.startsWith("/superadmin")) return "Superadministración";
  return path === "/" ? "Inicio" : path;
}

export default function Superadmin() {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "online" | "recent">("all");

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    const { data, error: requestError } = await supabase.rpc(
      "rpc_superadmin_snapshot",
    );
    if (requestError)
      setError(
        requestError.code === "42501"
          ? "Esta cuenta no tiene permisos de superadministrador."
          : "No se pudo actualizar el dashboard. Probá nuevamente.",
      );
    else {
      setSnapshot(data as Snapshot);
      setError("");
    }
    if (!quiet) setRefreshing(false);
  }, []);

  useEffect(() => {
    if (!loading && !user) void router.replace("/login?next=/superadmin");
  }, [loading, user, router]);
  useEffect(() => {
    if (!user) return;
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, 15_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [user, refresh]);

  const users = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (snapshot?.users ?? []).filter((entry) => {
      if (scope === "online" && !entry.online) return false;
      const generatedAt = snapshot
        ? new Date(snapshot.generated_at).getTime()
        : 0;
      if (
        scope === "recent" &&
        generatedAt - new Date(entry.last_activity_at).getTime() > 86_400_000
      )
        return false;
      return !needle || entry.email.toLowerCase().includes(needle);
    });
  }, [snapshot, query, scope]);

  if (loading || (user && !snapshot && !error))
    return (
      <main className="superadmin-loading">
        <RefreshCw className="spin" /> Preparando dashboard…
      </main>
    );
  if (!user) return null;
  if (error && !snapshot)
    return (
      <main className="superadmin-loading">
        <div className="superadmin-access-card">
          <Headphones size={34} />
          <h1>Acceso restringido</h1>
          <p>{error}</p>
          <button onClick={() => void router.push("/")}>
            Volver a Karaokey
          </button>
        </div>
      </main>
    );

  const metrics = snapshot?.metrics ?? EMPTY;
  const maxRegistration = Math.max(
    1,
    ...(snapshot?.registrations ?? []).map((entry) => entry.registrations),
  );
  return (
    <main className="superadmin-shell">
      <Head>
        <title>Superadministración · Karaokey</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <header className="superadmin-header">
        <div>
          <span className="superadmin-eyebrow">
            LSF PRODUCCIONES · CONTROL GENERAL
          </span>
          <h1>Dashboard Karaokey</h1>
          <p>Usuarios, uso de la plataforma y actividad operativa.</p>
        </div>
        <div className="superadmin-actions">
          <span className="superadmin-live">
            <i /> Actualización cada 15 segundos
          </span>
          <button onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw className={refreshing ? "spin" : ""} /> Actualizar
          </button>
          <button className="secondary" onClick={() => void signOut()}>
            <LogOut /> Salir
          </button>
        </div>
      </header>
      {error && (
        <div className="superadmin-warning" role="alert">
          {error}
        </div>
      )}

      <section className="superadmin-kpis" aria-label="Resumen general">
        <Kpi
          icon={<Users />}
          label="Cuentas registradas"
          value={metrics.total_users}
          detail={`+${metrics.new_users_7d} esta semana`}
        />
        <Kpi
          icon={<Activity />}
          label="En línea ahora"
          value={metrics.online_now}
          detail={`${metrics.active_24h} activas en 24 h`}
          accent="blue"
        />
        <Kpi
          icon={<Headphones />}
          label="Escenarios activos"
          value={metrics.active_performances}
          detail={`${metrics.turns} turnos históricos`}
          accent="purple"
        />
        <Kpi
          icon={<Music2 />}
          label="Canciones guardadas"
          value={metrics.songs}
          detail={`${metrics.applause} aplausos recibidos`}
          accent="gold"
        />
      </section>

      <section className="superadmin-grid">
        <article className="superadmin-panel superadmin-chart-panel">
          <div className="superadmin-panel-heading">
            <div>
              <BarChart3 />
              <div>
                <h2>Altas de usuarios</h2>
                <p>Últimos 14 días</p>
              </div>
            </div>
            <strong>
              {metrics.new_users_7d}
              <small>últimos 7 días</small>
            </strong>
          </div>
          <div className="superadmin-chart" aria-label="Registraciones por día">
            {(snapshot?.registrations ?? []).map((entry) => (
              <div
                className="superadmin-bar"
                key={entry.day}
                title={`${entry.day}: ${entry.registrations}`}
              >
                <span
                  style={{
                    height: `${Math.max(5, (entry.registrations / maxRegistration) * 100)}%`,
                  }}
                  data-empty={entry.registrations === 0}
                />
                <small>
                  {new Date(`${entry.day}T12:00:00`).toLocaleDateString(
                    "es-AR",
                    { day: "2-digit", month: "2-digit" },
                  )}
                </small>
              </div>
            ))}
          </div>
        </article>
        <article className="superadmin-panel superadmin-health">
          <div className="superadmin-panel-heading">
            <div>
              <Sparkles />
              <div>
                <h2>Actividad general</h2>
                <p>Acumulado de la plataforma</p>
              </div>
            </div>
          </div>
          <dl>
            <div>
              <dt>Participantes</dt>
              <dd>
                {snapshot?.users.reduce(
                  (sum, entry) => sum + entry.participants,
                  0,
                ) ?? 0}
              </dd>
            </div>
            <div>
              <dt>Actuaciones</dt>
              <dd>
                {snapshot?.users.reduce(
                  (sum, entry) => sum + entry.performances,
                  0,
                ) ?? 0}
              </dd>
            </div>
            <div>
              <dt>Pedidos pendientes</dt>
              <dd>
                {snapshot?.users.reduce(
                  (sum, entry) => sum + entry.open_turns,
                  0,
                ) ?? 0}
              </dd>
            </div>
            <div>
              <dt>Aplausos</dt>
              <dd>{metrics.applause}</dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="superadmin-panel superadmin-users">
        <div className="superadmin-users-heading">
          <div>
            <h2>Cuentas</h2>
            <p>
              {users.length} de {metrics.total_users} usuarios
            </p>
          </div>
          <div className="superadmin-filters">
            <label>
              <Search />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por email"
              />
            </label>
            <div className="superadmin-segments">
              <button
                data-active={scope === "all"}
                onClick={() => setScope("all")}
              >
                Todas
              </button>
              <button
                data-active={scope === "online"}
                onClick={() => setScope("online")}
              >
                En línea
              </button>
              <button
                data-active={scope === "recent"}
                onClick={() => setScope("recent")}
              >
                24 horas
              </button>
            </div>
          </div>
        </div>
        <div className="superadmin-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Estado</th>
                <th>Uso</th>
                <th>Contenido</th>
                <th>Actividad</th>
              </tr>
            </thead>
            <tbody>
              {users.map((entry) => (
                <tr key={entry.id}>
                  <td data-label="Usuario">
                    <strong>{entry.email}</strong>
                    <small>
                      Alta{" "}
                      {new Date(entry.created_at).toLocaleDateString("es-AR")}
                    </small>
                  </td>
                  <td data-label="Estado">
                    <span
                      className={
                        entry.online ? "status-online" : "status-offline"
                      }
                    >
                      <i />
                      {entry.online ? "En línea" : "Fuera de línea"}
                    </span>
                    <small>{relativeTime(entry.last_activity_at)}</small>
                  </td>
                  <td data-label="Uso">
                    <strong>
                      {entry.mode === "pro"
                        ? "Pro"
                        : entry.mode === "simple"
                          ? "Simple"
                          : "Sin elegir"}
                    </strong>
                    <small>{pageName(entry.page)}</small>
                  </td>
                  <td data-label="Contenido">
                    <strong>
                      {entry.songs} canciones · {entry.participants} personas
                    </strong>
                    <small>
                      {entry.turns} turnos · {entry.performances} actuaciones
                    </small>
                  </td>
                  <td data-label="Actividad">
                    <strong>
                      {entry.active_performances
                        ? "Escenario activo"
                        : `${entry.applause} aplausos`}
                    </strong>
                    <small>{entry.open_turns} solicitudes abiertas</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && (
            <div className="superadmin-empty">
              No hay cuentas que coincidan con este filtro.
            </div>
          )}
        </div>
      </section>
      <footer className="superadmin-footer">
        <Clock3 /> Datos actualizados{" "}
        {snapshot ? relativeTime(snapshot.generated_at).toLowerCase() : ""}. Las
        contraseñas nunca se muestran.
      </footer>
    </main>
  );
}

function Kpi({
  icon,
  label,
  value,
  detail,
  accent = "pink",
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  detail: string;
  accent?: string;
}) {
  return (
    <article className="superadmin-kpi" data-accent={accent}>
      <span>{icon}</span>
      <div>
        <small>{label}</small>
        <strong>{value.toLocaleString("es-AR")}</strong>
        <p>{detail}</p>
      </div>
    </article>
  );
}
