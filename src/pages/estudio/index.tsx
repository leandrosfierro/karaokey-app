import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Home,
  ListOrdered,
  Library,
  MonitorPlay,
  Plus,
  Shuffle,
  Play,
  CircleHelp,
  MoreHorizontal,
  Check,
} from "lucide-react";
import QRCode from "react-qr-code";
import { useAuth } from "../../lib/auth";
import { supabase } from "../../lib/supabase";
import type {
  ParticipanteRow,
  CancionRow,
  TemaPublicoRow,
  PerformanceRow,
  HostRow,
} from "../../lib/supabase";
import {
  Brand,
  Notice,
  Empty,
  Modal,
  SongBrowser,
  SongRow,
} from "../../components/preview/Shared";
import { PreviewPlayer } from "../../components/preview/Player";
import { QueueFilters } from "../../components/preview/QueueFilters";
import type { PreviewSong, PreviewTurn } from "../../lib/preview/model";
import {
  studioSearch,
  studioSong,
  studioTurns,
  saveStudioSongs,
} from "../../lib/studio";

type Section = "party" | "queue" | "library" | "stage";
type Snapshot = {
  people: ParticipanteRow[];
  songs: CancionRow[];
  queue: TemaPublicoRow[];
  performance: PerformanceRow | null;
  history: PerformanceRow[];
  applause: number;
  host: HostRow | null;
};
const EMPTY: Snapshot = {
  people: [],
  songs: [],
  queue: [],
  performance: null,
  history: [],
  applause: 0,
  host: null,
};

export default function Studio() {
  const { user, loading, modo, setModo, isSuperadmin, signOut } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Snapshot>(EMPTY);
  const [section, setSection] = useState<Section>("party");
  const [activeDeck, setActiveDeck] = useState<"A" | "B">("A");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [person, setPerson] = useState("");
  const [selected, setSelected] = useState("");
  const [second, setSecond] = useState("");
  const [duo, setDuo] = useState(false);
  const [singerOnly, setSingerOnly] = useState(false);
  const [noRepeats, setNoRepeats] = useState(true);
  const [origin, setOrigin] = useState("");
  const [repair, setRepair] = useState<CancionRow | null>(null);
  const [repairTurn, setRepairTurn] = useState<TemaPublicoRow | null>(null);
  const [queueFilter, setQueueFilter] = useState("pending");
  const [song, setSong] = useState<PreviewSong | null>(null);
  const [picker, setPicker] = useState(false);
  const [help, setHelp] = useState(false);
  const [summary, setSummary] = useState<{
    name: string;
    title: string;
    applause: number;
  } | null>(null);
  const [filter, setFilter] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<
    "all" | "ready" | "pending"
  >("all");
  const lock = useRef(false);
  const sequence = useRef(0);
  const fetching = useRef(false);
  const uid = user?.id;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate browser preferences only after identity is known.
    setOrigin(window.location.origin);
    try {
      const saved = JSON.parse(
        localStorage.getItem(`kk-studio-options-${uid}`) || "{}",
      );
      setDuo(!!saved.duo);
      setSingerOnly(!!saved.singerOnly);
      setNoRepeats(saved.noRepeats !== false);
    } catch {}
  }, [uid]);
  const options = (patch: {
    duo?: boolean;
    singerOnly?: boolean;
    noRepeats?: boolean;
  }) => {
    const next = { duo, singerOnly, noRepeats, ...patch };
    setDuo(next.duo);
    setSingerOnly(next.singerOnly);
    setNoRepeats(next.noRepeats);
    localStorage.setItem(`kk-studio-options-${uid}`, JSON.stringify(next));
    if (!next.duo) setSecond("");
  };
  const refresh = useCallback(async () => {
    if (!uid || fetching.current) return;
    fetching.current = true;
    try {
      const seq = ++sequence.current;
      const [people, songs, queue, performance, host, history] =
        await Promise.all([
          supabase
            .from("karaokey_participantes")
            .select("*")
            .eq("user_id", uid)
            .order("created_at"),
          supabase
            .from("karaokey_canciones")
            .select("*")
            .eq("user_id", uid)
            .order("created_at"),
          supabase
            .from("karaokey_temas_publico")
            .select("*")
            .eq("user_id", uid)
            .order("approved_at"),
          supabase
            .from("karaokey_performances")
            .select("*")
            .eq("user_id", uid)
            .eq("managed", true)
            .is("ended_at", null)
            .maybeSingle(),
          supabase
            .from("karaokey_hosts")
            .select("*")
            .eq("user_id", uid)
            .maybeSingle(),
          supabase
            .from("karaokey_performances")
            .select("*")
            .eq("user_id", uid)
            .eq("managed", true)
            .not("ended_at", "is", null)
            .order("ended_at", { ascending: false })
            .limit(50),
        ]);
      const failure = [people, songs, queue, performance, host, history].find(
        (r) => r.error,
      )?.error;
      if (failure) throw failure;
      let applause = 0;
      if (performance.data) {
        const count = await supabase
          .from("karaokey_aplausos")
          .select("id", { count: "exact", head: true })
          .eq("performance_id", performance.data.id);
        if (count.error) throw count.error;
        applause = count.count || 0;
      }
      if (seq !== sequence.current) return;
      setData({
        people: people.data || [],
        songs: songs.data || [],
        queue: queue.data || [],
        performance: performance.data,
        history: history.data || [],
        host: host.data,
        applause,
      });
      setReady(true);
    } finally {
      fetching.current = false;
    }
  }, [uid]);
  useEffect(() => {
    if (!loading && !user) void router.replace("/bienvenida");
  }, [loading, user, router]);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void refresh().catch((e) => {
        if (!cancelled) setError(e.message);
      });
    };
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && !lock.current) load();
    }, 4000);
    window.addEventListener("focus", load);
    window.addEventListener("online", load);
    return () => {
      cancelled = true;
      // eslint-disable-next-line react-hooks/exhaustive-deps -- This sequence invalidates network responses; it is not a DOM ref.
      sequence.current++;
      clearInterval(timer);
      window.removeEventListener("focus", load);
      window.removeEventListener("online", load);
    };
  }, [refresh]);
  const act = async (run: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    sequence.current++;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await run();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const songs = data.songs.map(studioSong).filter((s): s is PreviewSong => !!s);
  const turns = studioTurns(data.queue, data.performance, data.applause);
  for (const performed of data.history) {
    if (performed.turn_id && data.queue.some((q) => q.id === performed.turn_id))
      continue;
    const entry = studioTurns([], performed, 0)[0];
    if (entry) turns.push({ ...entry, status: "done" });
  }
  const current = turns.find((t) => t.status === "active") || null;
  const save = async (values: PreviewSong[]) => {
    if (!uid) throw new Error("Iniciá sesión.");
    const saved = await saveStudioSongs(uid, values);
    await refresh();
    setMessage(
      saved
        ? `${saved} versiones nuevas guardadas en tu cuenta.`
        : "Todas esas versiones ya estaban en tu biblioteca.",
    );
  };
  const start = (turn?: PreviewTurn, deck: "A" | "B" = "A") =>
    void act(async () => {
      const queued = turn ? data.queue.find((q) => q.id === turn.id) : null;
      if (queued?.titulo && !turn?.song) {
        setRepairTurn(queued);
        setPicker(true);
        return;
      }
      const picked = turn ? turn.song : singerOnly ? null : song;
      const names = turn
        ? data.queue.find((q) => q.id === turn.id)?.participantes || [
            turn.singers,
          ]
        : [selected, ...(duo ? [second] : [])].map(
            (id) => data.people.find((p) => p.id === id)?.nombre || "",
          );
      if (
        names.some((n) => !n) ||
        new Set(names).size !== names.length ||
        (!turn && !singerOnly && !picked)
      )
        throw new Error(
          "Elegí los cantantes y, para el sorteo completo, una versión de YouTube.",
        );
      const { error } = await supabase.rpc("rpc_stage_start", {
        p_participantes: names,
        p_titulo: picked?.title || null,
        p_artista: picked?.channel || null,
        p_video: picked?.id || null,
        p_thumbnail: picked?.thumbnail || null,
        p_turn: turn?.id || null,
      });
      if (error) throw error;
      setActiveDeck(deck);
      setSection("stage");
      setSummary(null);
    });
  const handoff = async (turn: PreviewTurn, deck: "A" | "B") => {
    if (lock.current || !data.performance || !uid)
      throw new Error("Esperá a que termine la operación actual.");
    const previous = data.performance;
    lock.current = true;
    sequence.current++;
    setBusy(true);
    setError("");
    try {
      const result = await supabase.rpc("rpc_stage_handoff", {
        p_from: previous.id,
        p_turn: turn.id,
      });
      if (result.error)
        throw new Error(
          result.error.code === "PGRST202"
            ? "El cambio continuo requiere la actualización de base de datos de esta versión. Podés usar Fiesta mientras tanto."
            : result.error.message,
        );
      const next = result.data as PerformanceRow;
      if (!next?.id)
        throw new Error(
          "No llegó la confirmación del turno. Actualizá antes de continuar.",
        );
      setData((prev) => ({
        ...prev,
        performance: next,
        applause: 0,
        people: prev.people.map((p) =>
          previous.participantes.includes(p.nombre)
            ? { ...p, ya_canto: true }
            : p,
        ),
        queue: prev.queue.map((q) =>
          q.id === previous.turn_id
            ? { ...q, status: "done" }
            : q.id === turn.id
              ? { ...q, status: "active" }
              : q,
        ),
      }));
      setActiveDeck(deck);
      setSummary(null);
      setMessage(
        `En escenario: ${next.participantes.join(" & ")}. Los aplausos anteriores quedaron cerrados.`,
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const finish = (returnToQueue = false) =>
    void act(async () => {
      if (!data.performance) return;
      const performance = data.performance;
      const { error } = await supabase.rpc("rpc_stage_finish", {
        p_id: performance.id,
        p_return: returnToQueue,
      });
      if (error) throw error;
      if (!returnToQueue) {
        const count = await supabase
          .from("karaokey_aplausos")
          .select("id", { count: "exact", head: true })
          .eq("performance_id", performance.id);
        setSummary({
          name: performance.participantes.join(" & "),
          title: performance.cancion_titulo || "",
          applause: count.count ?? data.applause,
        });
      } else {
        setSection("queue");
        setMessage("Turno devuelto a próximos turnos.");
      }
    });
  const draw = () => {
    const reserved = new Set(
      data.queue
        .filter((q) => q.status === "pending" || q.status === "active")
        .flatMap((q) => q.participantes || [q.submitted_by]),
    );
    const available = data.people.filter(
      (p) => (!noRepeats || !p.ya_canto) && !reserved.has(p.nombre),
    );
    if (available.length < (duo ? 2 : 1) || (!singerOnly && !songs.length)) {
      setError(
        "Faltan cantantes disponibles o versiones guardadas. Revisá los turnos reservados o empezá una nueva ronda.",
      );
      return;
    }
    for (let i = available.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [available[i], available[j]] = [available[j], available[i]];
    }
    setSelected(available[0].id);
    setSecond(duo ? available[1].id : "");
    if (!singerOnly) setSong(songs[Math.floor(Math.random() * songs.length)]);
    setSection("party");
    setMessage("Sorteo listo. Revisá la selección y tocá Ir al escenario.");
  };
  const enqueue = () =>
    void act(async () => {
      const names = [selected, ...(duo ? [second] : [])].map(
        (id) => data.people.find((p) => p.id === id)?.nombre || "",
      );
      if (
        names.some((n) => !n) ||
        new Set(names).size !== names.length ||
        (!singerOnly && !song)
      )
        throw new Error("Completá la selección de cantante y canción.");
      const { error } = await supabase.from("karaokey_temas_publico").insert({
        user_id: uid,
        submitted_by: names.join(" & "),
        participantes: names,
        titulo: singerOnly ? "" : song!.title,
        artista: singerOnly ? null : song!.channel,
        youtube_video_id: singerOnly ? null : song!.id,
        youtube_thumbnail: singerOnly ? null : song!.thumbnail,
        device_id: "host",
        status: "pending",
        approved_at: new Date().toISOString(),
      });
      if (error) throw error;
      setMessage("Turno aprobado y agregado al final de la cola.");
      setSection("queue");
    });
  const participation = () =>
    void act(async () => {
      const { error } = await supabase.from("karaokey_hosts").upsert(
        {
          user_id: uid,
          participativo_enabled: !data.host?.participativo_enabled,
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
    });
  const regenerate = () => {
    if (
      !window.confirm("El QR anterior dejará de funcionar. ¿Generar uno nuevo?")
    )
      return;
    void act(async () => {
      const generated = await supabase.rpc("generate_party_code");
      if (generated.error) throw generated.error;
      const { error } = await supabase
        .from("karaokey_hosts")
        .update({ party_code: generated.data })
        .eq("user_id", uid);
      if (error) throw error;
    });
  };
  const remove = (
    table: "karaokey_participantes" | "karaokey_canciones",
    id: string,
  ) => {
    if (
      !window.confirm(
        "¿Eliminar este elemento de tu lista? Los turnos guardados se conservan.",
      )
    )
      return;
    void act(async () => {
      const { error } = await supabase
        .from(table)
        .delete()
        .eq("id", id)
        .eq("user_id", uid);
      if (error) throw error;
      setSelected("");
      setSecond("");
    });
  };
  if (loading || !user)
    return (
      <div className="trial trial-app">
        <Notice>Ingresando a tu cuenta…</Notice>
      </div>
    );
  return (
    <div className="trial trial-app">
      <Head>
        <title>Karaokey · Tu fiesta, tu escenario</title>
      </Head>
      <header className="trial-header">
        <Brand />
        <div
          className="trial-tabs"
          title={
            current
              ? "Finalizá la actuación antes de cambiar de modo."
              : undefined
          }
        >
          <button
            disabled={busy || !!current}
            aria-pressed={modo !== "pro"}
            onClick={() => void setModo("simple")}
          >
            Simple
          </button>
          <button
            disabled={busy || !!current}
            aria-pressed={modo === "pro"}
            onClick={() => void setModo("pro")}
          >
            Karaokey Pro
          </button>
        </div>
        <button
          className="trial-icon"
          aria-label="Cómo empezar"
          onClick={() => setHelp(true)}
        >
          <CircleHelp />
        </button>
        <details className="studio-account">
          <summary aria-label="Cuenta y herramientas">
            <MoreHorizontal />
          </summary>
          <div className="studio-account-menu">
            <p>Tus listas se guardan en tu cuenta.</p>
            {isSuperadmin && <Link href="/superadmin">Dashboard general</Link>}
            <Link href="/clasico">Interfaz clásica</Link>
            <button onClick={() => void signOut()}>Cerrar sesión</button>
          </div>
        </details>
      </header>
      <div className="trial-layout">
        <nav className="trial-nav" aria-label="Navegación del estudio">
          {(
            [
              { id: "party", label: "Mi fiesta", Icon: Home },
              { id: "queue", label: "Próximos turnos", Icon: ListOrdered },
              { id: "library", label: "Biblioteca", Icon: Library },
              { id: "stage", label: "Escenario", Icon: MonitorPlay },
            ] as const
          ).map(({ id, label, Icon }) => (
            <button
              key={id}
              aria-current={section === id ? "page" : undefined}
              onClick={() => setSection(id)}
            >
              <Icon />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <main className="trial-content">
          {error && <Notice error>{error}</Notice>}
          {message && <Notice>{message}</Notice>}
          {!ready && <Notice>Cargando tus listas…</Notice>}
          {section === "party" && (
            <div className="trial-stack">
              <div className="trial-heading">
                <div>
                  <span className="trial-eyebrow">
                    Una canción, un gran momento
                  </span>
                  <h1>Tu fiesta empieza acá</h1>
                  <p>
                    Sumá participantes, elegí una canción y llevá el turno al
                    escenario.
                  </p>
                </div>
              </div>
              <ol
                className="studio-progress"
                aria-label="Preparación del turno"
              >
                {[
                  {
                    label: "Cantante",
                    done:
                      !!selected && (!duo || (!!second && second !== selected)),
                  },
                  {
                    label: singerOnly ? "Sin canción" : "Canción",
                    done: singerOnly || !!song,
                  },
                  { label: "Escenario", done: !!current },
                ].map(({ label, done }, i) => (
                  <li data-done={done} key={label}>
                    <span>{done ? <Check size={15} /> : i + 1}</span>
                    {label}
                  </li>
                ))}
              </ol>
              <div className="trial-card trial-stack">
                <h2>¿Quién canta?</h2>
                <form
                  className="trial-search"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(async () => {
                      const value = person.trim();
                      if (!value) return;
                      if (
                        data.people.some(
                          (p) =>
                            p.nombre.trim().toLocaleLowerCase() ===
                            value.toLocaleLowerCase(),
                        )
                      ) {
                        throw new Error(
                          "Ese nombre ya está en la lista. Si son dos personas distintas, agregá un apellido o apodo.",
                        );
                      }
                      const { error } = await supabase
                        .from("karaokey_participantes")
                        .insert({ nombre: value, user_id: uid });
                      if (error) throw error;
                      setPerson("");
                    });
                  }}
                >
                  <input
                    aria-label="Nombre del participante"
                    placeholder="Nombre del participante"
                    maxLength={120}
                    value={person}
                    onChange={(e) => setPerson(e.target.value)}
                  />
                  <button
                    className="trial-button"
                    disabled={busy || !person.trim()}
                  >
                    <Plus />
                    Agregar
                  </button>
                </form>
                <div className="trial-inline">
                  <label>
                    <input
                      type="checkbox"
                      checked={duo}
                      onChange={(e) => options({ duo: e.target.checked })}
                    />
                    Cantar en dúo
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={singerOnly}
                      onChange={(e) =>
                        options({ singerOnly: e.target.checked })
                      }
                    />
                    Sortear solo cantantes
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={noRepeats}
                      onChange={(e) => options({ noRepeats: e.target.checked })}
                    />
                    No repetir en la ronda
                  </label>
                </div>
                <label>
                  {duo ? "Primer cantante" : "Cantante"}
                  <select
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    <option value="">Elegí una persona</option>
                    {data.people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                        {p.ya_canto ? " · Ya cantó" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {duo && (
                  <label>
                    Segundo cantante
                    <select
                      value={second}
                      onChange={(e) => setSecond(e.target.value)}
                    >
                      <option value="">Elegí otra persona</option>
                      {data.people
                        .filter((p) => p.id !== selected)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nombre}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                {!singerOnly && (
                  <>
                    <button
                      className="trial-button secondary"
                      onClick={() => {
                        setRepair(null);
                        setPicker(true);
                      }}
                    >
                      Elegir canción o versión
                    </button>
                    {song && <SongRow song={song} />}
                  </>
                )}
                <div className="trial-song-actions">
                  <button
                    className="trial-button secondary"
                    disabled={busy || !!current}
                    onClick={draw}
                  >
                    <Shuffle />
                    Elegir al azar
                  </button>
                  <button
                    className="trial-button"
                    disabled={
                      busy ||
                      !!current ||
                      !selected ||
                      (duo && (!second || second === selected)) ||
                      (!singerOnly && !song)
                    }
                    onClick={() => start()}
                  >
                    <Play />
                    {selected
                      ? `Llevar a ${data.people.find((p) => p.id === selected)?.nombre || "cantante"}${duo ? " y su dúo" : ""} al escenario`
                      : "Ir al escenario"}
                  </button>
                  <button
                    className="trial-button secondary"
                    disabled={
                      busy ||
                      !selected ||
                      (duo && (!second || second === selected)) ||
                      (!singerOnly && !song)
                    }
                    onClick={enqueue}
                  >
                    Sumar a próximos turnos
                  </button>
                </div>
                {!current && (
                  <p className="trial-muted" role="status">
                    {!selected
                      ? "Elegí quién canta para continuar."
                      : duo && (!second || second === selected)
                        ? "Elegí a la segunda persona del dúo."
                        : !singerOnly && !song
                          ? "Falta elegir una versión de la canción."
                          : "Todo listo. Podés comenzar ahora o reservar un turno."}
                  </p>
                )}
                {current && (
                  <Notice>
                    Hay una actuación abierta. Finalizala desde Escenario para
                    iniciar otra.
                  </Notice>
                )}
                <details>
                  <summary>Administrar participantes y ronda</summary>
                  <div className="trial-stack">
                    {data.people.map((p) => (
                      <div className="trial-inline" key={p.id}>
                        <span>
                          {p.nombre}
                          {p.ya_canto ? " · Ya cantó" : ""}
                        </span>
                        <button
                          className="trial-link"
                          disabled={busy || !!current}
                          onClick={() => remove("karaokey_participantes", p.id)}
                        >
                          Eliminar {p.nombre}
                        </button>
                      </div>
                    ))}
                    <button
                      className="trial-button secondary"
                      disabled={
                        busy ||
                        !!current ||
                        !data.people.some((p) => p.ya_canto)
                      }
                      onClick={() =>
                        void act(async () => {
                          const { error } = await supabase
                            .from("karaokey_participantes")
                            .update({ ya_canto: false })
                            .eq("user_id", uid);
                          if (error) throw error;
                          setMessage(
                            "Nueva ronda: todos vuelven a estar disponibles.",
                          );
                        })
                      }
                    >
                      Empezar nueva ronda
                    </button>
                  </div>
                </details>
              </div>
              <div className="trial-card trial-stack">
                <h2>Participación del público</h2>
                <p>
                  Escaneá el QR para pedir canciones y aplaudir. No hace falta
                  estar en la misma red.
                </p>
                <button
                  className="trial-button"
                  disabled={busy}
                  onClick={participation}
                >
                  {data.host?.participativo_enabled
                    ? "Desactivar participación"
                    : "Activar participación y QR"}
                </button>
                {data.host?.participativo_enabled && (
                  <>
                    <div className="studio-qr">
                      <QRCode
                        value={`${origin}/vivo/${data.host.party_code}`}
                        size={180}
                      />
                    </div>
                    <strong>{data.host.party_code}</strong>
                    <Link
                      className="trial-button secondary"
                      href={`/vivo/${data.host.party_code}`}
                      target="_blank"
                    >
                      Abrir enlace del público
                    </Link>
                    <button
                      className="trial-button secondary"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(`${origin}/vivo/${data.host!.party_code}`)
                          .then(() => setMessage("Enlace copiado."))
                          .catch(() =>
                            setError(
                              "No se pudo copiar. Podés abrir el enlace y compartirlo.",
                            ),
                          );
                      }}
                    >
                      Copiar enlace
                    </button>
                    <button
                      className="trial-link"
                      disabled={busy}
                      onClick={regenerate}
                    >
                      Generar otro código QR
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          {section === "queue" && (
            <div className="trial-stack">
              <h1>Próximos turnos</h1>
              <p>
                Revisá los pedidos y aprobá las versiones antes de llevarlas al
                escenario.
              </p>
              <QueueFilters
                value={queueFilter}
                onChange={setQueueFilter}
                turns={turns}
              />
              {!turns.some((t) => t.status === queueFilter) && (
                <Empty title="No hay turnos en esta sección">
                  Los pedidos del público aparecerán en Por aprobar. También
                  podés preparar un turno desde Mi fiesta.
                </Empty>
              )}
              {turns
                .filter((t) => t.status === queueFilter)
                .map((t, i) => (
                  <div className="trial-card trial-stack" key={t.id}>
                    <h2>
                      {i + 1}. {t.singers}
                    </h2>
                    <p>
                      {t.song?.title ||
                        data.queue.find((q) => q.id === t.id)?.titulo ||
                        "Solo cantante"}
                    </p>
                    <div className="trial-song-actions">
                      {(t.status === "review" || t.status === "cancelled") && (
                        <button
                          className="trial-button"
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              const { error } = await supabase.rpc(
                                "rpc_queue_status",
                                { p_id: t.id, p_status: "pending" },
                              );
                              if (error) throw error;
                            })
                          }
                        >
                          {t.status === "review" ? "Aprobar" : "Restaurar"}
                        </button>
                      )}
                      {t.status === "pending" && (
                        <button
                          className="trial-button"
                          disabled={busy || !!current}
                          onClick={() => start(t)}
                        >
                          Iniciar turno
                        </button>
                      )}
                      {(t.status === "review" || t.status === "pending") && (
                        <button
                          className="trial-button secondary"
                          disabled={busy}
                          onClick={() =>
                            void act(async () => {
                              const { error } = await supabase.rpc(
                                "rpc_queue_status",
                                { p_id: t.id, p_status: "cancelled" },
                              );
                              if (error) throw error;
                            })
                          }
                        >
                          Retirar
                        </button>
                      )}
                      {t.status === "active" && (
                        <button
                          className="trial-button"
                          onClick={() => setSection("stage")}
                        >
                          Ir al escenario
                        </button>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          )}
          {section === "library" && (
            <div className="trial-stack">
              <div className="trial-heading">
                <h1>Tu biblioteca</h1>
                <button
                  className="trial-button"
                  onClick={() => {
                    setRepair(null);
                    setRepairTurn(null);
                    setPicker(true);
                  }}
                >
                  <Plus />
                  Sumar canciones
                </button>
              </div>
              <input
                aria-label="Buscar en biblioteca"
                placeholder="Título o artista…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <div className="trial-tabs" aria-label="Estado de las canciones">
                {(
                  [
                    ["all", "Todas"],
                    ["ready", "Listas para cantar"],
                    ["pending", "Elegir versión"],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    aria-pressed={libraryFilter === id}
                    onClick={() => setLibraryFilter(id)}
                  >
                    {label} (
                    {
                      data.songs.filter(
                        (s) =>
                          id === "all" ||
                          (id === "ready"
                            ? !!s.youtube_video_id
                            : !s.youtube_video_id),
                      ).length
                    }
                    )
                  </button>
                ))}
              </div>
              {libraryFilter !== "ready" &&
                data.songs.some((s) => !s.youtube_video_id) && (
                  <Notice>
                    Tus canciones anteriores siguen guardadas. Elegí una versión
                    de cada una para dejarlas listas para cantar.
                  </Notice>
                )}
              {data.songs
                .filter(
                  (s) =>
                    libraryFilter === "all" ||
                    (libraryFilter === "ready"
                      ? !!s.youtube_video_id
                      : !s.youtube_video_id),
                )
                .filter((s) =>
                  (s.titulo + " " + s.artista)
                    .toLowerCase()
                    .includes(filter.toLowerCase()),
                )
                .map((row) => {
                  const exact = studioSong(row);
                  return (
                    <div key={row.id}>
                      {exact ? (
                        <SongRow
                          song={exact}
                          actions={
                            <button
                              className="trial-button secondary small"
                              onClick={() => {
                                setSong(exact);
                                setSingerOnly(false);
                                setSection("party");
                              }}
                            >
                              Elegir
                            </button>
                          }
                        />
                      ) : (
                        <div className="trial-card">
                          <strong>{row.titulo}</strong>
                          <p className="trial-muted">
                            {row.artista || "Versión pendiente"}
                          </p>
                          <button
                            className="trial-button secondary"
                            onClick={() => {
                              setRepair(row);
                              setRepairTurn(null);
                              setPicker(true);
                            }}
                          >
                            Buscar versión
                          </button>
                        </div>
                      )}
                      <details className="studio-row-menu">
                        <summary aria-label={`Opciones de ${row.titulo}`}>
                          <MoreHorizontal size={18} /> Opciones
                        </summary>
                        <button
                          disabled={busy}
                          onClick={() => remove("karaokey_canciones", row.id)}
                        >
                          Eliminar canción
                        </button>
                      </details>
                    </div>
                  );
                })}
              {!data.songs.length && (
                <Empty title="Tus versiones favoritas, a mano">
                  Buscá una canción o importá una lista para guardarla en tu
                  cuenta.
                </Empty>
              )}
            </div>
          )}
          <section
            hidden={section !== "stage"}
            className="trial-stack"
            aria-label="Escenario"
          >
            <h1>{modo === "pro" ? "Karaokey Pro" : "Escenario"}</h1>
            {current && (
              <div className="trial-card">
                <h2>{current.singers}</h2>
                <p>{current.song?.title}</p>
                <p>👏 {data.applause} aplausos</p>
              </div>
            )}
            <PreviewPlayer
              authoritative
              performanceDeck={activeDeck}
              celebration={summary}
              mode={modo === "pro" ? "pro" : "simple"}
              song={current?.song || null}
              performanceId={current?.id || null}
              songs={songs}
              turns={turns}
              onStart={start}
              onHandoff={handoff}
              onSave={save}
              onSearch={studioSearch}
              scope={`studio-${uid}`}
              outputPath="/estudio/pantalla"
              busy={busy}
              onEnded={() => finish()}
            />
            {current && (
              <div className="trial-song-actions">
                <button
                  className="trial-button"
                  disabled={busy}
                  onClick={() => finish()}
                >
                  Finalizar actuación
                </button>
                <button
                  className="trial-button secondary"
                  disabled={busy}
                  onClick={() => finish(true)}
                >
                  Devolver a próximos turnos
                </button>
              </div>
            )}
          </section>
        </main>
      </div>
      {picker && (
        <SongBrowser
          initialQuery={repair?.titulo || repairTurn?.titulo || ""}
          songs={songs}
          onSearch={studioSearch}
          onSave={save}
          onClose={() => {
            setPicker(false);
            setRepair(null);
            setRepairTurn(null);
          }}
          onChoose={(picked) => {
            void act(async () => {
              if (repair || repairTurn) {
                const { error } = await supabase
                  .from(
                    repair ? "karaokey_canciones" : "karaokey_temas_publico",
                  )
                  .update({
                    titulo: picked.title,
                    artista: picked.channel,
                    youtube_video_id: picked.id,
                    youtube_thumbnail: picked.thumbnail,
                  })
                  .eq("id", (repair || repairTurn)!.id)
                  .eq("user_id", uid);
                if (error) throw error;
              } else await save([picked]);
              setSong(picked);
              setPicker(false);
              setSection(repairTurn ? "queue" : "party");
              setRepair(null);
              setRepairTurn(null);
            });
          }}
        />
      )}
      {help && (
        <Modal
          title="Tu primera canción en tres pasos"
          onClose={() => setHelp(false)}
        >
          <ol>
            <li>En Mi fiesta, agregá y elegí quién canta.</li>
            <li>Buscá una canción, revisá el canal y elegí su versión.</li>
            <li>Tocá Ir al escenario y después Reproducir.</li>
          </ol>
          <p>
            Los pedidos del público pasan por Próximos turnos. En Pro podés
            preparar el siguiente video en el otro deck sin cambiar el que está
            sonando.
          </p>
        </Modal>
      )}
      {summary && (
        <Modal
          title="¡Un aplauso enorme!"
          onClose={() => {
            setSummary(null);
            setSection("queue");
          }}
        >
          <div className="studio-celebration">
            <span aria-hidden="true">👏 ✨ 👏</span>
            <h1>{summary.name}</h1>
            <p>{summary.title}</p>
            <strong>{summary.applause} aplausos del público</strong>
            <p>Actuación guardada. ¿Cómo seguimos?</p>
            <button
              className="trial-button full"
              onClick={() => {
                setSummary(null);
                setSection("queue");
              }}
            >
              Volver a próximos turnos
            </button>
            <button
              className="trial-button secondary full"
              onClick={() => {
                setSummary(null);
                draw();
              }}
            >
              Volver a sortear
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
