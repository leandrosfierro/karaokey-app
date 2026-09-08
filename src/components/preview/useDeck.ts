import { useCallback, useEffect, useRef, useState } from "react";
import { LocalAudioDeckAdapter } from "../../lib/deckAdapter";
import type { DeckAdapter } from "../../lib/deckAdapter";
import type { PreviewSong } from "../../lib/preview/model";
import type { RemoteState, TransportAction } from "../../lib/studio-output";
type Remote = {
  state: RemoteState | null;
  send: (action: TransportAction, value?: number) => void;
};

let youtubeReady: Promise<void> | null = null;
function youtube() {
  if (window.YT?.Player) return Promise.resolve();
  if (youtubeReady) return youtubeReady;
  youtubeReady = new Promise<void>((resolve, reject) => {
    if (
      !document.querySelector(
        'script[src="https://www.youtube.com/iframe_api"]',
      )
    ) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.head.append(script);
    }
    const start = Date.now();
    const timer = setInterval(() => {
      if (window.YT?.Player) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - start > 15000) {
        clearInterval(timer);
        youtubeReady = null;
        reject(
          new Error(
            "No se pudo conectar con YouTube. Revisá la conexión y reintentá.",
          ),
        );
      }
    }, 100);
  });
  return youtubeReady;
}
export function useDeck(
  song: PreviewSong | null,
  volume: number,
  program = false,
  remote?: Remote,
) {
  const host = useRef<HTMLDivElement>(null);
  const player = useRef<DeckAdapter | null>(null);
  const mount = useCallback((node: HTMLDivElement | null) => {
    host.current = node;
  }, []);
  const remoteRef = useRef(remote);
  useEffect(() => {
    remoteRef.current = remote;
  }, [remote]);
  const getPlayer = useCallback((): DeckAdapter | null => {
    const r = remoteRef.current;
    if (!r) return player.current;
    return {
      playVideo: () => r.send("play"),
      pauseVideo: () => r.send("pause"),
      seekTo: (s) => r.send("seek", s),
      getCurrentTime: () => r.state?.time || 0,
      getDuration: () => r.state?.duration || 0,
      getPlayerState: () => (r.state?.playing ? 1 : r.state?.ended ? 0 : 2),
      setVolume: () => {},
      mute: () => {},
      unMute: () => {},
      isMuted: () => false,
      destroy: () => {},
    };
  }, []);
  const vol = useRef(volume);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const songId = song?.id;
  const songUrl = song?.url;
  const songKind = song?.kind;
  const remoteEnabled = !!remote;
  useEffect(() => {
    vol.current = volume;
    if (ready && player.current) {
      player.current.setVolume(volume);
      if (volume > 0) player.current.unMute();
      else player.current.mute();
    }
  }, [volume, ready]);
  // Reset UI to the lifecycle of this media instance. React owns only the outer
  // host; YouTube owns the appended inner node, avoiding reconciliation crashes.
  useEffect(() => {
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Reset readiness with the imperative media lifecycle.
    setReady(false);
    setPlaying(false);
    setEnded(false);
    setTime(0);
    setDuration(0);
    setError("");
    const container = host.current;
    const onReady = () => {
      if (cancelled) return;
      clearTimeout(timeout);
      player.current?.setVolume(vol.current);
      if (vol.current > 0) player.current?.unMute();
      else player.current?.mute();
      setReady(true);
    };
    const fail = (message: string) => {
      if (!cancelled) {
        clearTimeout(timeout);
        setError(message);
        setReady(false);
      }
    };
    if (songId && !remoteEnabled) {
      timeout = setTimeout(
        () =>
          fail(
            "La canción no terminó de cargar. Podés reintentar o elegir otra versión.",
          ),
        20000,
      );
      if (songKind === "local" && songUrl) {
        player.current = new LocalAudioDeckAdapter(
          songUrl,
          {
            onReady,
            onStateChange: (e) => {
              if (!cancelled) {
                setPlaying(e.data === 1);
                setEnded(e.data === 0);
              }
            },
            onError: () =>
              fail(
                "No pudimos reproducir este archivo. Probá con un MP3 o WAV válido.",
              ),
          },
          { autoCue: true },
        );
      } else if (container) {
        void youtube()
          .then(() => {
            if (cancelled) return;
            container.replaceChildren();
            const target = document.createElement("div");
            container.append(target);
            player.current = new window.YT.Player(target, {
              width: "100%",
              height: "100%",
              videoId: songId,
              playerVars: {
                controls: program ? 0 : 1,
                playsinline: 1,
                rel: 0,
                origin: window.location.origin,
              },
              events: {
                onReady,
                onStateChange: (e: { data: number }) => {
                  if (!cancelled) {
                    setPlaying(e.data === 1);
                    setEnded(e.data === 0);
                  }
                },
                onError: () =>
                  fail(
                    "Esta versión no permite reproducirse aquí. Elegí otra desde Buscar canción.",
                  ),
              },
            });
          })
          .catch((e) => fail(e.message));
      }
    }
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      try {
        player.current?.destroy();
      } catch {}
      player.current = null;
      container?.replaceChildren();
    };
  }, [songId, songUrl, songKind, revision, program, remoteEnabled]);
  useEffect(() => {
    if (!ready) return;
    const timer = setInterval(() => {
      const p = player.current;
      if (!p) return;
      setTime(p.getCurrentTime());
      setDuration(p.getDuration());
      setPlaying(p.getPlayerState() === 1);
    }, 250);
    return () => clearInterval(timer);
  }, [ready]);
  const remoteState =
    remote && remote.state?.id === songId ? remote.state : null;
  return {
    mount,
    getPlayer,
    ready: remoteEnabled ? !!remoteState?.ready : ready,
    playing: remoteEnabled ? !!remoteState?.playing : playing,
    ended: remoteEnabled ? !!remoteState?.ended : ended,
    time: remoteEnabled ? remoteState?.time || 0 : time,
    duration: remoteEnabled ? remoteState?.duration || 0 : duration,
    error: remoteEnabled ? remoteState?.error || "" : error,
    remote: remoteEnabled,
    retry: () => setRevision((v) => v + 1),
    toggle: () => {
      if (remote) {
        if (remoteState?.ready)
          remote.send(remoteState.playing ? "pause" : "play");
        return;
      }
      const p = player.current;
      if (!ready || !p) return;
      if (p.getPlayerState() === 1) p.pauseVideo();
      else p.playVideo();
    },
    pause: () => {
      if (remote) {
        remote.send("pause");
        return;
      }
      if (ready) player.current?.pauseVideo();
    },
    seek: (s: number) => {
      if (remote) {
        remote.send("seek", s);
        return;
      }
      if (ready) player.current?.seekTo(s, true);
    },
    pitch: (s: number) => {
      if (player.current instanceof LocalAudioDeckAdapter)
        player.current.setPitchSemitones(s);
    },
    tempo: (s: number) => {
      if (player.current instanceof LocalAudioDeckAdapter)
        player.current.setTempo(s);
    },
  };
}

export async function localFiles(
  scope: string,
  file?: File,
): Promise<PreviewSong[]> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open("karaokey-preview-files", 1);
    open.onupgradeneeded = () =>
      open.result.createObjectStore("files", { keyPath: "id" });
    open.onsuccess = () => resolve(open.result);
    open.onerror = () =>
      reject(new Error("Este navegador no permite guardar archivos locales."));
  });
  try {
    if (file) {
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction("files", "readwrite");
        tx.objectStore("files").put({ id: crypto.randomUUID(), scope, file });
        tx.oncomplete = () => resolve();
        tx.onerror = () =>
          reject(new Error("No hay espacio para guardar el archivo."));
      });
    }
    const rows = await new Promise<{ id: string; scope: string; file: File }[]>(
      (resolve, reject) => {
        const request = database
          .transaction("files")
          .objectStore("files")
          .getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () =>
          reject(new Error("No se pudo abrir Mis archivos."));
      },
    );
    return rows
      .filter((row) => row.scope === scope)
      .map((row) => ({
        id: row.id,
        title: row.file.name,
        channel: "Archivo guardado en este dispositivo",
        thumbnail: "",
        kind: "local",
        url: URL.createObjectURL(row.file),
      }));
  } finally {
    database.close();
  }
}
