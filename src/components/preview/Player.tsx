/* eslint-disable react-hooks/refs -- The mixed deck API carries a callback DOM ref. All actual player reads occur inside effects/events; JSX reads only React state. */
import { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  Volume2,
  Maximize2,
  Minimize2,
  Search,
  MonitorPlay,
  Upload,
  SkipBack,
  Flag,
  Square,
  Music2,
} from "lucide-react";
import type { PreviewSong, PreviewTurn } from "../../lib/preview/model";
import { Modal, SongBrowser, SongRow, Notice } from "./Shared";
import type { SongSearch } from "./Shared";
import { useDeck, localFiles } from "./useDeck";
import { validTransport, mixVolumes } from "../../lib/studio-output";
import type { RemoteState, TransportAction } from "../../lib/studio-output";

type Deck = ReturnType<typeof useDeck>;
type Celebration = { name: string; title: string; applause: number };
type Mix = {
  type: "mix";
  a: PreviewSong | null;
  b: PreviewSong | null;
  mix: number;
  volA: number;
  volB: number;
  timeA: number;
  timeB: number;
  playA: boolean;
  playB: boolean;
  signature: string;
  performance: { id: string; singers: string; applause: number } | null;
  celebration?: Celebration | null;
};
const timeLabel = (n: number) =>
  `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`;
function ios() {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}

export function PreviewPlayer({
  mode,
  song,
  performanceId,
  songs,
  onSave,
  scope = "trial",
  turns = [],
  onStart,
  busy = false,
  onSearch,
  outputPath = "/prueba/pantalla",
  onEnded,
  authoritative = false,
  celebration = null,
  performanceDeck = "A",
}: {
  mode: "simple" | "pro";
  song: PreviewSong | null;
  performanceId: string | null;
  songs: PreviewSong[];
  onSave: (songs: PreviewSong[]) => Promise<void>;
  scope?: string;
  turns?: PreviewTurn[];
  onStart?: (turn: PreviewTurn, deck?: "A" | "B") => void;
  busy?: boolean;
  onSearch?: SongSearch;
  outputPath?: string;
  onEnded?: () => void;
  authoritative?: boolean;
  celebration?: Celebration | null;
  performanceDeck?: "A" | "B";
}) {
  const [a, setA] = useState<PreviewSong | null>(null);
  const [b, setB] = useState<PreviewSong | null>(null);
  const [prepared, setPrepared] = useState<{ A?: string; B?: string }>({});
  const [mix, setMix] = useState(0);
  const [volA, setVolA] = useState(100);
  const [volB, setVolB] = useState(100);
  const [source, setSource] = useState<"A" | "B" | null>(null);
  const [filesFor, setFilesFor] = useState<"A" | "B" | null>(null);
  const [files, setFiles] = useState<PreviewSong[]>([]);
  const [fileError, setFileError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [full, setFull] = useState(false);
  const [external, setExternal] = useState(false);
  const [outputChannel, setOutputChannel] = useState("");
  const [telemetry, setTelemetry] = useState<{
    A: RemoteState | null;
    B: RemoteState | null;
  }>({ A: null, B: null });
  const ownsOutput = useRef(false);
  const [mobileIOS, setMobileIOS] = useState(false);
  const [autoMix, setAutoMix] = useState(false);
  const [ramping, setRamping] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const channel = useRef<BroadcastChannel | null>(null);
  const channelId = useRef("");
  const lastAck = useRef(0);
  const payload = useRef<Mix | null>(null);
  const ramp = useRef<ReturnType<typeof setInterval> | null>(null);
  const filesRef = useRef<PreviewSong[]>([]);
  const externalWindow = useRef<Window | null>(null);
  const effectiveMix = mode === "simple" ? 0 : mix;
  const currentTurn = turns.find(
    (t) => t.id === performanceId && t.status === "active",
  );
  const singers = currentTurn?.singers || "";
  const applause = currentTurn?.applause || 0;
  const signature = `${a?.id || ""}|${mode === "pro" ? b?.id || "" : ""}`;
  const sendCommand = (
    deck: "A" | "B",
    action: TransportAction,
    value?: number,
  ) =>
    channel.current?.postMessage({
      type: "transport",
      signature,
      deck,
      action,
      value,
    });
  const remoteA = authoritative && external && a?.kind !== "local";
  const remoteB = authoritative && external && b?.kind !== "local";
  const deckA = useDeck(
    a,
    external && !authoritative ? 0 : (1 - effectiveMix) * volA,
    false,
    remoteA
      ? {
          state: telemetry.A,
          send: (action, value) => sendCommand("A", action, value),
        }
      : undefined,
  );
  const deckB = useDeck(
    mode === "pro" ? b : null,
    external && !authoritative ? 0 : effectiveMix * volB,
    false,
    remoteB
      ? {
          state: telemetry.B,
          send: (action, value) => sendCommand("B", action, value),
        }
      : undefined,
  );
  const latest = useRef({ deckA, deckB, signature });
  const loadedPerformance = useRef<string | null>(null);
  const reportedEnd = useRef<string | null>(null);
  const playedPerformance = useRef<string | null>(null);
  useEffect(() => {
    if (!performanceId || !song?.id || reportedEnd.current === performanceId)
      return;
    if (performanceDeck === "B" ? deckB.playing : deckA.playing)
      playedPerformance.current = performanceId;
    const ended =
      performanceDeck === "B"
        ? b?.id === song.id && deckB.ended
        : a?.id === song.id && deckA.ended;
    if (ended && playedPerformance.current === performanceId) {
      reportedEnd.current = performanceId;
      onEnded?.();
    }
  }, [
    performanceId,
    song?.id,
    a?.id,
    b?.id,
    deckA.ended,
    deckB.ended,
    deckA.playing,
    deckB.playing,
    performanceDeck,
    onEnded,
  ]);
  useEffect(() => {
    latest.current = { deckA, deckB, signature };
  }, [deckA, deckB, signature]);
  useEffect(() => {
    if (celebration) {
      latest.current.deckA.pause();
      latest.current.deckB.pause();
    }
  }, [celebration]);
  // Trial song identity is passed directly, never resolved through shared caches.
  useEffect(() => {
    const identity = `${performanceId || ""}:${song?.id || ""}:${performanceDeck}:${mode}`;
    if (loadedPerformance.current === identity) return;
    loadedPerformance.current = identity;
    if (performanceDeck === "B" && mode === "pro") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- A committed performance selects its deck; snapshot refreshes do not reload it.
      setB(song);
      setMix(1);
    } else {
      setA(song);
      setMix(0);
    }
  }, [song, performanceId, performanceDeck, mode]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Capability detection is only available after hydration.
    setMobileIOS(ios());
    let cancelled = false;
    localFiles(scope)
      .then((value) => {
        if (cancelled) {
          value.forEach((f) => f.url && URL.revokeObjectURL(f.url));
          return;
        }
        filesRef.current = value;
        setFiles(value);
      })
      .catch((e) => setFileError(e.message));
    return () => {
      cancelled = true;
      filesRef.current.forEach((f) => f.url && URL.revokeObjectURL(f.url));
    };
  }, [scope]);
  useEffect(() => {
    if (mode === "simple") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Stop the hidden second media deck when Simple is selected.
      setB(null);
      setAutoMix(false);
    }
  }, [mode]);
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFull(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  useEffect(() => {
    if (!full) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [full]);
  const fullscreen = async () => {
    if (full) {
      if (document.fullscreenElement)
        await document.exitFullscreen().catch(() => {});
      setFull(false);
    } else {
      setFull(true);
      if (row.current?.requestFullscreen)
        await row.current.requestFullscreen().catch(() => {});
    }
  };
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    channelId.current = crypto.randomUUID();
    setOutputChannel(channelId.current);
    const ch = new BroadcastChannel("kk-trial-output-" + channelId.current);
    channel.current = ch;
    ch.onmessage = (e) => {
      if (e.data.type === "hello" && payload.current) {
        ch.postMessage(payload.current);
        if (authoritative && ownsOutput.current) lastAck.current = Date.now();
      }
      if (
        authoritative &&
        e.data.type === "telemetry" &&
        e.data.signature === latest.current.signature
      )
        setTelemetry({ A: e.data.A, B: e.data.B });
      if (
        e.data.type === "ready" &&
        e.data.signature === latest.current.signature
      ) {
        lastAck.current = Date.now();
        if (authoritative && !ownsOutput.current) {
          const snapshot = payload.current;
          // Freeze the operator decks before moving playback to the audience.
          if (snapshot?.a?.kind !== "local") latest.current.deckA.pause();
          if (snapshot?.b?.kind !== "local") latest.current.deckB.pause();
          for (const deck of ["A", "B"] as const) {
            ch.postMessage({
              type: "transport",
              signature: latest.current.signature,
              deck,
              action: "seek",
              value: deck === "A" ? snapshot?.timeA || 0 : snapshot?.timeB || 0,
            });
            if (deck === "A" ? snapshot?.playA : snapshot?.playB)
              ch.postMessage({
                type: "transport",
                signature: latest.current.signature,
                deck,
                action: "play",
              });
          }
          ownsOutput.current = true;
        }
        setExternal(true);
      }
      if (e.data.type === "not-ready" && !authoritative) {
        lastAck.current = 0;
        setExternal(false);
      }
    };
    const timer = setInterval(() => {
      if (Date.now() - lastAck.current > (authoritative ? 4500 : 2500)) {
        setExternal(false);
        ownsOutput.current = false;
      }
    }, 500);
    return () => {
      clearInterval(timer);
      ch.postMessage({ type: "closed" });
      ch.close();
      channel.current = null;
      if (ramp.current) clearInterval(ramp.current);
    };
  }, [authoritative]);
  useEffect(() => {
    if (!authoritative) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Invalidate the readiness handshake when media changes.
      setExternal(false);
      lastAck.current = 0;
    }
  }, [signature, authoritative]);
  useEffect(() => {
    const send = () => {
      const data: Mix = {
        type: "mix",
        a,
        b: mode === "pro" ? b : null,
        mix: effectiveMix,
        volA,
        volB,
        timeA: deckA.ready ? deckA.getPlayer()?.getCurrentTime() || 0 : 0,
        timeB: deckB.ready ? deckB.getPlayer()?.getCurrentTime() || 0 : 0,
        playA: deckA.ready && deckA.getPlayer()?.getPlayerState() === 1,
        playB: deckB.ready && deckB.getPlayer()?.getPlayerState() === 1,
        signature,
        performance:
          performanceId && singers
            ? { id: performanceId, singers, applause }
            : null,
        celebration,
      };
      payload.current = data;
      channel.current?.postMessage(data);
    };
    send();
    const timer = setInterval(send, 500);
    return () => clearInterval(timer);
  }, [
    a,
    b,
    mode,
    effectiveMix,
    volA,
    volB,
    deckA,
    deckB,
    signature,
    performanceId,
    singers,
    applause,
    celebration,
  ]);
  const crossfade = () => {
    if (ramp.current) return;
    const start = effectiveMix;
    const end = start < 0.5 ? 1 : 0;
    const incoming = end === 1 ? deckB : deckA;
    if (!incoming.ready) return;
    if (incoming.getPlayer()?.getPlayerState() !== 1)
      incoming.getPlayer()?.playVideo();
    const began = Date.now();
    setRamping(true);
    ramp.current = setInterval(() => {
      const fraction = Math.min((Date.now() - began) / 4000, 1);
      setMix(start + (end - start) * fraction);
      if (fraction === 1) {
        clearInterval(ramp.current!);
        ramp.current = null;
        setRamping(false);
      }
    }, 40);
  };
  useEffect(() => {
    if (!autoMix || ramping || mode !== "pro") return;
    const active = effectiveMix < 0.5 ? deckA : deckB;
    const incoming = effectiveMix < 0.5 ? deckB : deckA;
    if (
      active.playing &&
      active.duration > 0 &&
      active.duration - active.time < 6 &&
      incoming.ready &&
      incoming.time < incoming.duration - 6
    )
      // eslint-disable-next-line react-hooks/set-state-in-effect -- The media clock triggers an optional automatic transition.
      crossfade();
  });
  const choose = (picked: PreviewSong) => {
    (source === "B" ? setB : setA)(picked);
    setSource(null);
  };
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setFileError("");
    if (
      file.size > 25 * 1024 * 1024 ||
      !/\.(mp3|wav|m4a|ogg)$/i.test(file.name)
    ) {
      setFileError("Elegí un archivo MP3, WAV, M4A u OGG de hasta 25 MB.");
      return;
    }
    setUploading(true);
    try {
      const next = await localFiles(scope, file);
      filesRef.current = [...filesRef.current, ...next];
      setFiles(next);
    } catch (e) {
      setFileError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };
  const openOutput = () => {
    if (!channel.current) {
      setFileError("Este navegador no permite conectar la pantalla externa.");
      return;
    }
    externalWindow.current = window.open(
      `${outputPath}?channel=${channelId.current}`,
      "kk-trial-output",
      "width=1100,height=650",
    );
    if (!externalWindow.current)
      setFileError(
        "El navegador bloqueó la ventana. Permití ventanas emergentes para abrir la pantalla del público.",
      );
  };
  return (
    <div className="trial-stack">
      {fileError && <Notice error>{fileError}</Notice>}
      <div ref={row} className={full ? "trial trial-fullscreen" : ""}>
        <PerformanceBanner
          singers={singers}
          applause={applause}
          visible={full && !!singers}
        />
        {full && (
          <button
            className="trial-button secondary"
            onClick={() => void fullscreen()}
          >
            <Minimize2 /> Salir de pantalla completa
          </button>
        )}
        {performanceId && !song ? (
          <div className="studio-singer">
            <p>¡Al escenario!</p>
            <h1>{singers}</h1>
            <strong>👏 {applause} aplausos</strong>
          </div>
        ) : (
          <div className={`trial-player-grid ${mode === "pro" ? "pro" : ""}`}>
            <DeckCard
              letter="A"
              mode={mode}
              song={a}
              deck={deckA}
              volume={volA}
              onVolume={setVolA}
              audible={effectiveMix < 1 && volA > 0}
              ios={mobileIOS}
              onSearch={() => setSource("A")}
              onFiles={() => setFilesFor("A")}
            />
            {mode === "pro" && (
              <DeckCard
                letter="B"
                mode={mode}
                song={b}
                deck={deckB}
                volume={volB}
                onVolume={setVolB}
                audible={effectiveMix > 0 && volB > 0}
                ios={mobileIOS}
                onSearch={() => setSource("B")}
                onFiles={() => setFilesFor("B")}
              />
            )}
          </div>
        )}
        {!full && (
          <div className="trial-player-tools">
            <button
              className="trial-button secondary"
              onClick={() => void fullscreen()}
            >
              <Maximize2 /> Pantalla completa
            </button>
            {mode === "pro" && (
              <button className="trial-button secondary" onClick={openOutput}>
                <MonitorPlay />{" "}
                {external
                  ? "Pantalla del público conectada"
                  : "Abrir pantalla del público"}
              </button>
            )}
            {mode === "pro" && authoritative && outputChannel && (
              <a
                className="trial-link"
                href={`${outputPath}?channel=${outputChannel}`}
                target="kk-trial-output"
              >
                Enlace de la pantalla pública
              </a>
            )}
          </div>
        )}
      </div>
      {authoritative && mode === "pro" && (
        <p className="trial-muted">
          La pantalla pública se abre en este mismo equipo. Al activar su audio,
          los videos se reproducen allí y este panel solo envía controles. Los
          archivos locales siguen sonando en este dispositivo. Si se pierde la
          conexión, la reproducción queda en pausa.
        </p>
      )}
      {!full && onStart && (
        <section
          className="trial-card trial-stack"
          aria-label="Próximos en cantar"
        >
          <h2>Próximos en cantar</h2>
          {turns
            .filter((t) => t.status === "active")
            .map((t) => (
              <p key={t.id}>
                <strong>Ahora en escenario: {t.singers}</strong>
                <br />
                {t.song?.title || "Solo cantante"}
              </p>
            ))}
          <p className="trial-muted">
            Turnos aprobados, en orden. Preparar un deck no inicia la actuación.
          </p>
          {turns.filter((t) => t.status === "pending").length === 0 && (
            <p>
              No hay turnos aprobados pendientes. Podés aprobar pedidos en
              Próximos turnos.
            </p>
          )}
          {turns
            .filter((t) => t.status === "pending")
            .map((t, index) => (
              <div className="trial-card trial-stack" key={t.id}>
                <div>
                  <strong>
                    {index + 1}. {t.singers}
                  </strong>
                  <p>{t.song?.title || "Solo cantante"}</p>
                </div>
                <div className="trial-inline">
                  {mode === "simple" || !t.song ? (
                    <button
                      className="trial-button"
                      disabled={busy || !!performanceId}
                      onClick={() => onStart(t)}
                    >
                      Iniciar turno
                    </button>
                  ) : (
                    (["A", "B"] as const).map((letter) => {
                      const deck = letter === "A" ? deckA : deckB;
                      const selected = letter === "A" ? a : b;
                      const loaded =
                        prepared[letter] === t.id &&
                        selected?.id === t.song?.id;
                      return (
                        <button
                          key={letter}
                          className="trial-button secondary"
                          disabled={
                            busy ||
                            deck.playing ||
                            (loaded && !!performanceId) ||
                            (letter === performanceDeck && !!performanceId)
                          }
                          onClick={() => {
                            if (loaded) {
                              onStart(t, letter);
                              return;
                            }
                            if (!t.song || deck.playing) return;
                            (letter === "A" ? setA : setB)(t.song);
                            setPrepared((prev) => ({
                              ...prev,
                              [letter]: t.id,
                            }));
                          }}
                        >
                          {loaded
                            ? performanceId
                              ? `Preparado en ${letter}`
                              : `Iniciar en ${letter}`
                            : `Preparar en ${letter}`}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            ))}
          {performanceId && (
            <p className="trial-muted">
              Finalizá o devolvé la actuación actual antes de iniciar otro
              turno.
            </p>
          )}
        </section>
      )}
      {mode === "pro" && (
        <div className="trial-mixer">
          <div className="trial-section-heading">
            <h2>Mezcla de salida</h2>
            <span className="trial-status active">
              {external
                ? "Audio en la pantalla del público"
                : "Audio en este dispositivo"}
            </span>
          </div>
          <div className="trial-crossfade">
            <span>A</span>
            <input
              aria-label="Mezcla entre deck A y deck B"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={mix}
              disabled={ramping}
              onChange={(e) => setMix(Number(e.target.value))}
            />
            <span>B</span>
          </div>
          <div className="trial-inline">
            <button
              className="trial-button secondary"
              disabled={
                ramping || !(effectiveMix < 0.5 ? deckB.ready : deckA.ready)
              }
              onClick={crossfade}
            >
              {ramping ? "Mezclando…" : "Transición suave · 4 segundos"}
            </button>
            <label style={{ flexDirection: "row", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={autoMix}
                onChange={(e) => setAutoMix(e.target.checked)}
              />{" "}
              Mezclar al terminar la canción
            </label>
          </div>
          <p className="trial-muted" style={{ fontSize: ".8rem" }}>
            Preparado: cargado y en pausa. Reproduciendo: avanza sin salir al
            público. Al aire: reproduce con volumen en la mezcla.
          </p>
          {mobileIOS && (
            <Notice>
              En iPhone/iPad, la mezcla de volumen entre videos de YouTube puede
              no estar disponible. Probá el mezclador en una computadora.
            </Notice>
          )}
        </div>
      )}
      {source && (
        <SongBrowser
          songs={songs}
          onClose={() => setSource(null)}
          onChoose={choose}
          onSave={onSave}
          onSearch={onSearch}
        />
      )}
      {filesFor && (
        <Modal
          title={`Mis archivos · ${mode === "pro" ? `Deck ${filesFor}` : "Reproductor"}`}
          onClose={() => setFilesFor(null)}
        >
          <p className="trial-muted">
            Se guardan solo en este navegador, separados por cuenta. Permiten
            ajustar tono y tempo.
          </p>
          <label className="trial-button secondary">
            <Upload /> {uploading ? "Guardando…" : "Elegir archivo de audio"}
            <input
              type="file"
              accept="audio/*"
              disabled={uploading}
              style={{ display: "none" }}
              onChange={(e) => void upload(e.target.files?.[0])}
            />
          </label>
          {fileError && <Notice error>{fileError}</Notice>}
          <div className="trial-results">
            {files.map((file) => (
              <SongRow
                key={file.id}
                song={file}
                actions={
                  <button
                    className="trial-button secondary small"
                    onClick={() => {
                      (filesFor === "B" ? setB : setA)(file);
                      setFilesFor(null);
                    }}
                  >
                    Cargar {mode === "pro" ? `en ${filesFor}` : "canción"}
                  </button>
                }
              />
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function DeckCard({
  letter,
  mode,
  song,
  deck,
  volume,
  onVolume,
  audible,
  ios,
  onSearch,
  onFiles,
}: {
  letter: "A" | "B";
  mode: "simple" | "pro";
  song: PreviewSong | null;
  deck: Deck;
  volume: number;
  onVolume: (n: number) => void;
  audible: boolean;
  ios: boolean;
  onSearch: () => void;
  onFiles: () => void;
}) {
  const [cue, setCue] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [tempo, setTempo] = useState(100);
  const [muted, setMuted] = useState(false);
  const lastVolume = useRef(100);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset controls when a new media instance is loaded.
    setCue(0);
    setPitch(0);
    setTempo(100);
  }, [song?.id]);
  const toggleMute = () => {
    if (muted) {
      onVolume(lastVolume.current);
      setMuted(false);
    } else {
      lastVolume.current = volume || 100;
      onVolume(0);
      setMuted(true);
    }
  };
  return (
    <section
      className="trial-deck"
      aria-label={mode === "simple" ? "Reproductor" : `Deck ${letter}`}
    >
      <div className="trial-deck-bar">
        <strong>{mode === "simple" ? "Tu karaoke" : `DECK ${letter}`}</strong>
        <span
          className={`trial-status ${deck.playing && audible ? "active" : ""}`}
        >
          {deck.error
            ? "Revisar canción"
            : !song
              ? "Sin canción"
              : !deck.ready
                ? "Cargando…"
                : deck.playing
                  ? audible
                    ? "Al aire"
                    : "Reproduciendo · sin salida"
                  : "Preparado"}
        </span>
      </div>
      <div className="trial-video">
        <div ref={deck.mount} />
        {(!song || song.kind === "local" || deck.remote) && (
          <div className="trial-video-placeholder">
            <Music2 size={42} />
            <strong>{song?.title || "La pantalla es tuya"}</strong>
            <p>
              {song
                ? deck.remote
                  ? "Video en la pantalla del público · Control remoto"
                  : "Audio listo para cantar"
                : "Elegí una canción para empezar"}
            </p>
          </div>
        )}
      </div>
      {deck.error && (
        <div style={{ padding: 16 }}>
          <Notice error>{deck.error}</Notice>
          <button className="trial-link" onClick={deck.retry}>
            Reintentar carga
          </button>
        </div>
      )}
      <div className="trial-transport">
        <div className="trial-seek">
          <span>{timeLabel(deck.time)}</span>
          <input
            aria-label={`Avance de la canción ${letter}`}
            type="range"
            min="0"
            max={Math.max(deck.duration, 1)}
            step="0.1"
            value={deck.time}
            disabled={!deck.ready}
            onChange={(e) => deck.seek(Number(e.target.value))}
          />
          <span>{timeLabel(deck.duration)}</span>
        </div>
        <div className="trial-controls">
          <button
            className="trial-play"
            aria-label={`${deck.playing ? "Pausar" : "Reproducir"} ${letter}`}
            disabled={!deck.ready}
            onClick={deck.toggle}
          >
            {deck.playing ? <Pause /> : <Play />}
          </button>
          {ios && song?.kind !== "local" ? (
            <span className="trial-muted" style={{ fontSize: ".85rem" }}>
              Volumen: usá los botones del celular.
            </span>
          ) : (
            <div className="trial-volume">
              <button
                className="trial-icon"
                aria-label={muted ? "Activar sonido" : "Silenciar"}
                onClick={toggleMute}
              >
                <Volume2 />
              </button>
              <input
                aria-label={`Volumen ${letter}`}
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(e) => {
                  onVolume(Number(e.target.value));
                  setMuted(false);
                }}
              />
              <span>{volume}%</span>
            </div>
          )}
        </div>
      </div>
      {song && <p className="trial-deck-caption">{song.title}</p>}
      <div className="trial-inline" style={{ padding: "0 16px 16px" }}>
        <button className="trial-button secondary" onClick={onSearch}>
          <Search />{" "}
          {mode === "simple" ? "Buscar canción" : `Cargar en ${letter}`}
        </button>
        <button className="trial-button secondary" onClick={onFiles}>
          <Upload /> Mis archivos
        </button>
      </div>
      <details className="trial-advanced">
        <summary>
          {mode === "simple" ? "Más opciones" : "Cue y ajustes"}
        </summary>
        <div className="trial-advanced-content">
          <div className="trial-inline">
            <button
              className="trial-button secondary small"
              disabled={!deck.ready}
              onClick={() => {
                deck.seek(cue);
                deck.pause();
              }}
            >
              <SkipBack /> Volver a {timeLabel(cue)}
            </button>
            <button
              className="trial-button secondary small"
              disabled={!deck.ready}
              onClick={() => setCue(deck.time)}
            >
              <Flag /> Marcar inicio
            </button>
            <button
              className="trial-button secondary small"
              disabled={!deck.ready}
              onClick={() => {
                deck.pause();
                deck.seek(0);
              }}
            >
              <Square /> Detener
            </button>
          </div>
          {song?.kind === "local" && (
            <>
              <label>
                Tono · {pitch > 0 ? "+" : ""}
                {pitch} semitonos
                <input
                  type="range"
                  min="-12"
                  max="12"
                  value={pitch}
                  onChange={(e) => {
                    setPitch(Number(e.target.value));
                    deck.pitch(Number(e.target.value));
                  }}
                />
              </label>
              <label>
                Tempo · {tempo}%
                <input
                  type="range"
                  min="70"
                  max="130"
                  value={tempo}
                  onChange={(e) => {
                    setTempo(Number(e.target.value));
                    deck.tempo(Number(e.target.value));
                  }}
                />
              </label>
              <button
                className="trial-link"
                onClick={() => {
                  setPitch(0);
                  setTempo(100);
                  deck.pitch(0);
                  deck.tempo(100);
                }}
              >
                Restablecer tono y tempo
              </button>
            </>
          )}
        </div>
      </details>
    </section>
  );
}

function PerformanceBanner({
  singers,
  applause,
  visible,
}: {
  singers: string;
  applause: number;
  visible: boolean;
}) {
  return (
    <div className="trial-performance-banner" hidden={!visible}>
      <div className="trial-performance-name">
        <span>Ahora canta</span>
        <strong>{singers}</strong>
      </div>
      <div
        className="trial-performance-applause"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span aria-hidden="true">👏</span> <strong>{applause}</strong>
        <span>Aplausos</span>
      </div>
    </div>
  );
}

export function ProgramOutput({
  channelId,
  authoritative = false,
}: {
  channelId: string;
  authoritative?: boolean;
}) {
  const [mix, setMix] = useState<Mix | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [connected, setConnected] = useState(false);
  const ack = useRef<BroadcastChannel | null>(null);
  const last = useRef(0);
  const latest = useRef<Mix | null>(null);
  const [gainA, gainB] = mixVolumes(
    mix?.mix || 0,
    mix?.volA || 0,
    mix?.volB || 0,
  );
  const a = useDeck(
    authoritative && mix?.a?.kind === "local" ? null : mix?.a || null,
    enabled && connected ? gainA : 0,
    true,
  );
  const b = useDeck(
    authoritative && mix?.b?.kind === "local" ? null : mix?.b || null,
    enabled && connected ? gainB : 0,
    true,
  );
  const players = useRef({ a, b, enabled });
  useEffect(() => {
    players.current = { a, b, enabled };
    latest.current = mix;
  }, [a, b, enabled, mix]);
  useEffect(() => {
    if (!channelId || typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel("kk-trial-output-" + channelId);
    ack.current = ch;
    ch.onmessage = (e) => {
      if (
        authoritative &&
        latest.current &&
        players.current.enabled &&
        validTransport(e.data, latest.current.signature)
      ) {
        const deck =
          e.data.deck === "A" ? players.current.a : players.current.b;
        if (!deck.ready) return;
        if (e.data.action === "play") deck.getPlayer()?.playVideo();
        if (e.data.action === "pause") deck.pause();
        if (e.data.action === "seek")
          deck.seek(
            Math.min(e.data.value || 0, deck.duration || e.data.value || 0),
          );
      }
      if (e.data.type === "mix") {
        setMix(e.data);
        last.current = Date.now();
        setConnected(true);
      }
      if (e.data.type === "closed") {
        setConnected(false);
        setEnabled(false);
        setMix(null);
      }
    };
    const ping = () => {
      ch.postMessage({ type: "hello" });
      if (Date.now() - last.current > 3000) {
        setConnected(false);
        players.current.a.pause();
        players.current.b.pause();
        return;
      }
      const data = latest.current;
      const p = players.current;
      if (authoritative && data) {
        const snapshot = (deck: Deck, id: string): RemoteState => ({
          id,
          ready: deck.ready,
          playing: deck.playing,
          time: deck.time,
          duration: deck.duration,
          ended: deck.ended,
          error: deck.error,
        });
        ch.postMessage({
          type: "telemetry",
          signature: data.signature,
          A: snapshot(p.a, data.a?.id || ""),
          B: snapshot(p.b, data.b?.id || ""),
        });
      }
      if (
        data &&
        p.enabled &&
        (!data.a || (authoritative && data.a.kind === "local") || p.a.ready) &&
        (!data.b || (authoritative && data.b.kind === "local") || p.b.ready)
      ) {
        ch.postMessage({ type: "ready", signature: data.signature });
      } else ch.postMessage({ type: "not-ready" });
    };
    ping();
    const timer = setInterval(ping, authoritative ? 250 : 750);
    return () => {
      clearInterval(timer);
      ch.postMessage({ type: "not-ready" });
      ch.close();
    };
  }, [channelId, authoritative]);
  useEffect(() => {
    if (!mix || !enabled || !connected || authoritative) return;
    for (const [deck, targetTime, playing] of [
      [a, mix.timeA, mix.playA],
      [b, mix.timeB, mix.playB],
    ] as const) {
      const p = deck.getPlayer();
      if (!deck.ready || !p) continue;
      if (Math.abs(p.getCurrentTime() - targetTime) > 0.8)
        p.seekTo(targetTime, true);
      if (playing && p.getPlayerState() !== 1) p.playVideo();
      if (!playing && p.getPlayerState() === 1) p.pauseVideo();
    }
  }, [mix, enabled, connected, a, b, authoritative]);
  return (
    <div className="trial trial-program">
      <PerformanceBanner
        singers={mix?.performance?.singers || ""}
        applause={mix?.performance?.applause || 0}
        visible={enabled && connected && !!mix?.performance}
      />
      <div className="trial-program-media">
        <div className="trial-program-layer" ref={a.mount} />
        {mix?.a?.kind === "local" && (
          <div className="trial-program-card">
            <h1>{mix.a.title}</h1>
          </div>
        )}
        <div className="trial-program-layer" style={{ opacity: mix?.mix || 0 }}>
          <div ref={b.mount} style={{ position: "absolute", inset: 0 }} />
          {mix?.b?.kind === "local" && (
            <div className="trial-program-card">
              <h1>{mix.b.title}</h1>
            </div>
          )}
        </div>
      </div>
      {mix?.celebration && enabled && connected && (
        <div className="trial-program-card">
          <div className="studio-celebration">
            <span aria-hidden="true">👏 ✨ 👏</span>
            <h1>{mix.celebration.name}</h1>
            <p>{mix.celebration.title}</p>
            <strong>{mix.celebration.applause} aplausos del público</strong>
          </div>
        </div>
      )}
      {(!enabled || !connected) && (
        <div className="trial-program-card">
          <h1>Karaokey</h1>
          <p>
            {!connected
              ? "Esperando al control de la fiesta…"
              : "Pantalla del público lista"}
          </p>
          {connected && (
            <button
              className="trial-button"
              style={{ marginTop: 24 }}
              onClick={() => {
                setEnabled(true);
                void document.documentElement
                  .requestFullscreen?.()
                  .catch(() => {});
              }}
            >
              Activar audio y mostrar al público
            </button>
          )}
        </div>
      )}
    </div>
  );
}
